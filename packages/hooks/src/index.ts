#!/usr/bin/env node
/**
 * `tamaclaude-notify` — the binary Claude Code executes on every hook event.
 *
 * Claude Code writes one JSON object to this process's stdin, **waits for it
 * to exit**, and only then continues the user's turn. Everything below follows
 * from those two facts: read stdin, translate the payload into a `HookEvent`,
 * write it to the daemon's socket, exit. No retries, no reply is read, nothing
 * is printed.
 *
 * This package is deliberately near-leaf — its import graph is a latency
 * budget rather than a style preference. The `HookEvent` import is type-only
 * and erases at compile time (`verbatimModuleSyntax`), so at run time this
 * file loads two Node builtins and nothing else. Validation deliberately does
 * not happen here: the daemon is the trust boundary, and a schema library on
 * this path would be paid for on every tool call of every session.
 *
 * ## Nothing is printed, and that is a correctness requirement
 *
 * Claude Code parses a hook's stdout when it exits 0: a first character of `{`
 * means "this is a decision object". The placeholder this file replaces wrote
 * `{"sessionId":"placeholder",...}` to stdout on every event, which is exactly
 * that shape. Silence is not tidiness here — it is the difference between
 * forwarding an event and feeding the user's session an unrecognised decision.
 *
 * ## Every failure exits 0, fast
 *
 * A dropped panel update is nothing. A hook that hangs, or writes to the
 * transcript, is the user's editor misbehaving. So:
 *
 * | What goes wrong                  | Surfaces as              | Decision                                       |
 * | -------------------------------- | ------------------------ | ---------------------------------------------- |
 * | No daemon listening              | `ECONNREFUSED` on connect | `error` -> exit 0. Costs microseconds.         |
 * | Stale socket file, daemon gone   | `ECONNREFUSED`            | Same path. We do not unlink it — a hook that   |
 * |                                  |                           | deletes files is a hook that can delete the    |
 * |                                  |                           | wrong one. The daemon owns its socket.         |
 * | Socket path absent / no such dir | `ENOENT`                  | `error` -> exit 0.                             |
 * | Socket not connectable by us     | `EACCES`                  | `error` -> exit 0.                             |
 * | Path over the 104-byte `sun_path` | throw or `error`          | Either way exit 0: a synchronous throw leaves  |
 * | limit (easy to hit on macOS)     |                           | `main()` and is caught by `.catch(bail)`.      |
 * | Daemon accepts but never reads   | the write flushes, no FIN | Exit 0 as soon as the bytes reach the kernel.  |
 * |                                  | ever comes back           | We wait on our own write finishing, not on the |
 * |                                  |                           | peer closing — see `send`.                     |
 * | Daemon accepts and stops reading | write parks in the buffer | The deadline fires. Only reachable with a      |
 * | with a full buffer               |                           | payload larger than the socket buffer; ours is |
 * |                                  |                           | ~150 bytes.                                    |
 * | Daemon dies mid-write            | `EPIPE`                   | `error` -> exit 0.                             |
 * | Malformed JSON on stdin          | `JSON.parse` throws       | Exit 0 **without connecting** — there is       |
 * |                                  |                           | nothing the daemon could do with it.           |
 * | Empty stdin / stdin closed       | empty string, parse fails | Same path.                                     |
 * | Payload without `session_id` or  | translation returns       | Same path. The daemon keys sessions on         |
 * | `hook_event_name`                | `undefined`               | `session_id`; an event without one is noise.   |
 * | stdin never ends (a TTY)         | the read never settles    | The deadline fires. This is why the read is    |
 * |                                  |                           | async: `readFileSync(0)` would block the event |
 * |                                  |                           | loop, and a blocked loop cannot run a timer.   |
 * | Absurdly large stdin             | slow read                 | Bounded by the deadline rather than a byte     |
 * |                                  |                           | cap — time is the dimension we actually care   |
 * |                                  |                           | about, and one limit beats two.                |
 * | Anything unforeseen              | `uncaughtException`       | exit 0.                                        |
 *
 * ## Watching it by hand
 *
 * There is no daemon yet, and this binary is silent by design, so:
 *
 * ```sh
 * nc -lU /tmp/tc.sock &
 * echo '{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash"}' \
 *   | TAMACLAUDE_SOCKET=/tmp/tc.sock node packages/hooks/dist/index.js
 * ```
 */
import type { HookEvent } from '@tamaclaude/protocol';

import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

/**
 * How long the whole operation gets — read, connect, write — before we give up
 * and exit 0.
 *
 * A person is waiting on this. Claude Code blocks on the hook and would allow
 * it 600 seconds by default, which for a display update is not a timeout so
 * much as a hang.
 *
 * 150 ms is chosen against three numbers. The healthy path is a local socket
 * write of ~150 bytes — hundreds of microseconds — so this is three orders of
 * magnitude of headroom, and no plausible load makes a working daemon look
 * broken. The common failures (no daemon, stale socket) refuse the connection
 * outright and never reach it. And in the one case that does — a daemon that
 * accepts and then wedges — the cost is 150 ms times the hook events in a
 * turn, so a second or two across a long turn rather than a stall.
 *
 * Lower would start dropping events on a loaded machine, and a dropped event
 * is a panel showing the wrong thing, which is the failure we are trading
 * against rather than a free win.
 */
const DEADLINE_MS = 150;

/**
 * Give up, successfully.
 *
 * Every path out of this program ends here, including the happy one. Exit code
 * 0 is the contract with Claude Code: anything else is an error in the user's
 * transcript, and there is no failure of ours that deserves one.
 */
function bail(): never {
  process.exit(0);
}

/**
 * The daemon's socket.
 *
 * `TAMACLAUDE_SOCKET` exists so tests never touch a real one. There is no
 * config file and no discovery: the hook cannot afford to look for anything.
 */
function socketPath(): string {
  return (
    process.env.TAMACLAUDE_SOCKET ??
    join(homedir(), '.tamaclaude', 'daemon.sock')
  );
}

/**
 * Claude Code's payload, as far as we read it.
 *
 * Every field is `unknown` because this is untrusted input that we are not
 * validating — we are picking six strings out of it and dropping the rest.
 * Notably `tool_input` is dropped: a `Write` carries the entire file contents
 * in it, and the daemon needs the tool's name, not its argument.
 */
type ClaudeCodePayload = {
  readonly session_id?: unknown;
  readonly hook_event_name?: unknown;
  readonly tool_name?: unknown;
  readonly agent_id?: unknown;
  readonly agent_type?: unknown;
  /**
   * `StopFailure`'s error, and **the field is `error`, not `error_type`.**
   * `error_type` appears nowhere in the hook documentation; it was assumed in
   * Stage 3 and the assumption survived a check that verified the *values*
   * against the docs and never the key. The consequence was silent and total:
   * `optionalString(payload.error_type)` returned `undefined` on every real
   * payload, so the daemon's `errorType` was never set, and the screen keyed on
   * it could not appear. Nothing failed, because a missing optional field is
   * indistinguishable from an error that carried no type.
   */
  readonly error?: unknown;
};

/** A present, non-empty string, or nothing. Empty is treated as absent. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Claude Code's field names to ours. This translation is the package's job:
 * everything downstream speaks one shape, and an upstream rename lands here.
 */
function translate(raw: string): HookEvent | undefined {
  const payload = JSON.parse(raw) as ClaudeCodePayload;
  const sessionId = optionalString(payload.session_id);
  const kind = optionalString(payload.hook_event_name);
  if (sessionId === undefined || kind === undefined) return undefined;
  return {
    sessionId,
    kind,
    // `JSON.stringify` drops undefined values, so absent stays absent on the
    // wire rather than becoming an explicit null the daemon has to think about.
    tool: optionalString(payload.tool_name),
    agentId: optionalString(payload.agent_id),
    agentType: optionalString(payload.agent_type),
    errorType: optionalString(payload.error),
  };
}

async function readEvent(): Promise<HookEvent | undefined> {
  try {
    return translate(await text(process.stdin));
  } catch {
    // Malformed JSON, a payload that is not an object, or a stdin that errored.
    // All three mean the same thing here: nothing worth sending.
    return undefined;
  }
}

/**
 * One connection, one event, then FIN.
 *
 * Newline-terminated so the stream is NDJSON: we send a single object and
 * close, so no framing is strictly needed today, but one byte buys the daemon
 * the option of accepting several events per connection later.
 *
 * `end()` before the connection is established is deliberate — `net` buffers
 * the write until connect resolves, so there is no `connect` handler and no
 * second round trip. We never read a reply; the daemon has nothing to say that
 * would change what this process does.
 *
 * We exit on our own write finishing rather than on `close`, which against a
 * daemon that accepts and then wedges is the difference between leaving at
 * once and waiting out the whole deadline: `close` waits for the peer's FIN,
 * and a wedged peer never sends one. This started as a `close` handler with a comment
 * claiming it fired anyway; deleting the deadline to check made the test hang,
 * which is the only reason the claim was caught. By the time this callback
 * runs the bytes are in the kernel's buffer and `shutdown` has been issued, so
 * exiting cannot truncate them.
 */
function send(event: HookEvent): void {
  const socket = connect(socketPath());
  socket.on('error', bail);
  socket.end(`${JSON.stringify(event)}\n`, bail);
}

async function main(): Promise<void> {
  // Armed first, so it covers the read as well as the write. `unref` so the
  // timer cannot itself hold the process open on the happy path.
  setTimeout(bail, DEADLINE_MS).unref();
  process.on('uncaughtException', bail);
  process.on('unhandledRejection', bail);

  const event = await readEvent();
  if (event === undefined) bail();
  send(event);
}

// A synchronous throw inside `send` — an over-long socket path is the real
// case — rejects this promise rather than escaping, so it lands here.
main().catch(bail);
