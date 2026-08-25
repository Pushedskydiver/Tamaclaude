/**
 * One line off the socket, turned into a `HookEvent` or thrown away.
 *
 * **This is the daemon's trust boundary and the only one it has.** The hook
 * deliberately does not validate — it reads stdin, picks six strings out of it
 * and writes them, because it is on a latency budget paid by the user on every
 * tool call. So nothing has checked this data before it arrives here, and the
 * socket is not a private channel between two programs we wrote: it is a file,
 * and anything on the machine that can open it can write whatever it likes to
 * it.
 *
 * Every rejection below therefore returns `undefined` rather than throwing.
 * A bad line is an ordinary event on a socket, not an error condition, and the
 * caller's response to all of them is the same: drop it, keep reading.
 */

import type { HookEvent } from '@tamaclaude/protocol';

import { z } from 'zod';

/**
 * How long any one field may be.
 *
 * Not arbitrary caution. `sessionId` becomes a key in a map the daemon holds
 * for ten minutes, and `tool` and `agentType` are rendered onto a 172-pixel
 * panel — so an unbounded string is both a retained allocation and a display
 * somebody else controls. Claude Code's own session ids are UUIDs and its tool
 * names are short identifiers; 256 leaves room for an MCP server with a long
 * namespace and refuses everything that is not a name at all.
 */
export const MAX_FIELD_LENGTH = 256;

const field = z.string().min(1).max(MAX_FIELD_LENGTH);

/**
 * A field the daemon mostly decorates with rather than keys on.
 *
 * `.catch` degrades instead of rejecting: an empty, over-long or wrongly typed
 * `tool` costs the tool name, not the event. Losing the event would be the
 * worse failure by a distance — a `PreToolUse` that never lands leaves the
 * panel claiming the session is idle while it runs, which is the one direction
 * this display must never be wrong in.
 *
 * **`agentType` is the exception and is load-bearing**, since `SUBAGENT_DELTA`
 * in `session.ts` began keying the subagent count on its presence. Degrading it
 * here turns a real dispatch into a stray at both ends, so an over-long or
 * wrongly typed one costs a badge digit rather than a label. That is still the
 * right trade against dropping the event, and the risk is small — Claude Code's
 * agent types are short identifiers well inside `MAX_FIELD_LENGTH` — but the
 * two files should agree on which fields carry weight.
 */
const optionalField = field.optional().catch(undefined);

/**
 * The shape `packages/hooks` sends, mirroring `HookEvent` in `protocol`.
 *
 * `kind` is a plain bounded string rather than a union of
 * `HANDLED_HOOK_EVENTS`: Claude Code sends around thirty events, the daemon
 * acts on eleven, and an unhandled one is still proof that the session is
 * alive. Narrowing here would discard that — `PostToolUse` is the case that
 * matters, since it fires between every two calls of a chain and refreshing
 * liveness is the whole of its job.
 *
 * Unknown keys are stripped rather than rejected, which is zod's default and
 * the right one here: a future Claude Code adds a field, the hook forwards it,
 * and this daemon carries on rather than falling silent on every event.
 */
const hookEventSchema = z.object({
  sessionId: field,
  kind: field,
  tool: optionalField,
  agentId: optionalField,
  agentType: optionalField,
  errorType: optionalField,
});

/**
 * Parse one newline-delimited line.
 *
 * Trimmed first so a `\r\n` peer and a line with trailing space both work —
 * the framing is somebody else's byte stream, not a format we control.
 *
 * `JSON.parse` is what handles the prototype question: it creates `__proto__`
 * as an ordinary own property rather than invoking the setter, and zod then
 * builds its result from the known keys only, so a hostile line cannot reach
 * `Object.prototype` through either step.
 */
export function parseHookEventLine(line: string): HookEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = hookEventSchema.safeParse(safeJson(trimmed));
  return parsed.success ? parsed.data : undefined;
}

/** `JSON.parse`, with a syntax error demoted to "nothing useful arrived". */
function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
