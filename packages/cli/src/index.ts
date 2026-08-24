#!/usr/bin/env node
/**
 * `tamaclaude` — the command line surface.
 *
 * There is deliberately no menu bar app: one would need a native shim or
 * Electron, which reintroduces a signed `.app` and Gatekeeper for a gift that
 * has to work on someone else's Mac on the day. The panel is its own UI, and
 * the CLI covers the rest. See BUILD_PLAN §Deliberately not scheduled.
 */
import type { ResolvedPack } from './pack.js';

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  animationFor,
  createDaemon,
  createRegistry,
  defaultSocketPath,
  observe,
  resolvePanel,
} from '@tamaclaude/daemon';
import { findPanels, nodeUsb } from '@tamaclaude/device';
import { isBirthday } from '@tamaclaude/packs';

import {
  AGENT_LABEL,
  agentPlist,
  agentPlistPath,
  describeAgentInstall,
} from './agent.js';
import { runDaemon } from './daemon.js';
import { chooseDevice } from './device.js';
import { resolvePack } from './pack.js';

/** One line naming the loaded pack and where it came from. */
function describePack(resolved: ResolvedPack): string {
  const how = resolved.source === 'default' ? 'default' : '$TAMACLAUDE_PACK';
  return `${resolved.parsed.name} at ${resolved.directory} (${how})`;
}

/**
 * The search window for the next birthday: long enough to contain every date.
 *
 * 366 rather than 365 so a 29 February pack is reachable from any starting
 * day. The index is never `-1` for a manifest that parsed: the schema refuses
 * a date that occurs in no month, and `isBirthday` falls 29 February back to
 * the 28th in a common year, so every valid date occurs exactly once in any
 * 366-day window — checked exhaustively over four timezones.
 *
 * This constant previously carried a docstring describing a helper returning
 * `number | undefined`, which had been inlined away. The comment outlived its
 * function, which is the class `tools/detached-docs.test.ts` exists for and
 * which it cannot see, because a line comment is not a bound doc block.
 */
const YEAR_AND_A_DAY = 366;

/**
 * `tamaclaude pack` — say which pack is loaded, and when it celebrates.
 *
 * **This is the answer to the failure no schema can catch.** A pack that is
 * valid but *wrong* — the example pack where the recipient's should be — loads
 * cleanly, renders beautifully, and has no birthday in it. Zod cannot see that
 * and neither can a person looking at the panel. So the surface that can see
 * it has to exist and has to be trivial to run.
 *
 * The countdown is computed by asking `isBirthday` about each of the next 366
 * days rather than by doing calendar arithmetic here. That is deliberate: it
 * cannot disagree with the function that actually drives the panel, including
 * about 29 February, which falls back to the 28th in a common year.
 */
function pack(): void {
  const resolved = resolvePack();
  const manifest = resolved.parsed;
  process.stdout.write(`pack ${describePack(resolved)}\n`);
  if (manifest.birthday === undefined) {
    process.stdout.write('birthday: none in this pack\n');
    return;
  }
  const now = Date.now();
  const days = Array.from({ length: YEAR_AND_A_DAY }, (_unused, offset) =>
    isBirthday(
      manifest,
      new Date(now).setHours(12, 0, 0, 0) + offset * 86_400_000,
    ),
  ).indexOf(true);
  const when =
    days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${String(days)} days`;
  process.stdout.write(
    `birthday: ${manifest.birthday.date} — fires ${when}, saying ` +
      `"${manifest.birthday.quip}"\n`,
  );
}

/**
 * `tamaclaude install-agent` — start the daemon at login, and keep it started.
 *
 * **Dry run by default**, exactly like `tamaclaude-install-hooks`, and for the
 * same reason: it writes into somebody's `~/Library/LaunchAgents` and loads
 * something that will run without them watching.
 *
 * `--apply` resolves the pack *before* writing anything. That ordering is the
 * point rather than tidiness: an agent installed on a Mac with no pack exits 2
 * on every start, and `KeepAlive` cannot tell exit 2 from exit 1 — launchd
 * only sees zero versus non-zero — so it would restart forever, writing `no
 * pack configured` into a log nobody opens while the panel showed whatever it
 * last showed. Refusing to install is the only place that loop can be stopped.
 *
 * `bootout` before `bootstrap`, always. A plist already loaded keeps running
 * with its old arguments no matter what is written to disk, so a second
 * `--apply` would look like it succeeded while the first agent carried on —
 * and the second `--apply` is exactly what happens on the day somebody fixes
 * a path.
 */
async function installAgent(argv: readonly string[]): Promise<void> {
  const apply = argv.includes('--apply');
  const home = homedir();
  const plistPath = agentPlistPath(home);
  // Resolved first, so `--apply` cannot install an agent that cannot start.
  // The error is `pack.ts`'s, which names the path and the reason.
  const resolved = resolvePack();
  const options = {
    node: process.execPath,
    script: fileURLToPath(import.meta.url),
    pack: resolved.directory,
    socket: defaultSocketPath(),
    log: join(home, '.tamaclaude', 'daemon.log'),
  };
  process.stdout.write(
    describeAgentInstall(options, plistPath, existsSync(plistPath)),
  );

  const panels = await findPanels(nodeUsb());
  process.stdout.write(
    `panel      ${panels[0]?.path ?? 'none found right now — the agent will look again each start'}\n`,
  );

  if (!apply) {
    process.stdout.write(
      'Dry run: nothing was written. Re-run with --apply to install.\n',
    );
    return;
  }
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(join(home, '.tamaclaude'), { recursive: true });
  writeFileSync(plistPath, agentPlist(options));
  const domain = `gui/${String(process.getuid?.() ?? 0)}`;
  // Unloading something that is not loaded is not an error worth stopping for,
  // so its failure is ignored and `bootstrap`'s is not.
  try {
    execFileSync('launchctl', ['bootout', `${domain}/${AGENT_LABEL}`], {
      stdio: 'ignore',
    });
  } catch {
    // Not loaded. Fine.
  }
  execFileSync('launchctl', ['bootstrap', domain, plistPath], {
    stdio: 'inherit',
  });
  process.stdout.write(`Installed and started. Logs go to ${options.log}\n`);
}

/** Printed for a missing device, an unknown command, and anything help-shaped. */
const USAGE =
  'usage: tamaclaude daemon [device]\n' +
  '       tamaclaude pack\n' +
  '  with no device, the panel is found by its USB descriptor\n' +
  '  e.g. tamaclaude daemon /dev/cu.usbmodem1101\n' +
  '  the pack comes from $TAMACLAUDE_PACK, else ~/.tamaclaude/pack/\n' +
  '  `tamaclaude pack` says which one, and when its birthday fires\n' +
  '  with no command, prints one line of smoke-test output\n' +
  '       tamaclaude install-agent [--apply]\n' +
  '  starts the daemon at login; dry run unless --apply\n';

async function devicePathFor(argv: readonly string[]): Promise<string> {
  const chosen = chooseDevice(argv[0], await findPanels(nodeUsb()));
  if ('refusal' in chosen) {
    process.stderr.write(`${chosen.refusal}\n${USAGE}`);
    process.exit(2);
  }
  return chosen.path;
}

/**
 * `tamaclaude daemon` — listen, render, and drive the panel until killed.
 */
async function daemon(argv: readonly string[]): Promise<void> {
  const devicePath = await devicePathFor(argv);
  // Resolved before the socket is opened, so a bad pack fails without leaving
  // a listener behind.
  const resolved = resolvePack();
  const running = await runDaemon({
    socketPath: defaultSocketPath(),
    devicePath,
    pack: resolved.manifest,
  });
  // The pack is named on the startup line, not just the socket. The failure
  // this whole file is arranged against is a *valid* pack that is the wrong
  // one, which no schema can catch — so the cheapest possible check is putting
  // the answer in the terminal every time the daemon starts.
  process.stdout.write(
    `listening on ${defaultSocketPath()}\n` +
      `pack ${describePack(resolved)}\n`,
  );
  // Stopped on a signal rather than left to the process teardown, so the
  // socket file goes with it — `socket-server.ts` only removes a path it can
  // still prove is its own, and it cannot prove that after the process is gone.
  const stop = (): void => {
    void running.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

/**
 * The default command: load the real pack, push one event through the real
 * session pipeline, print what the panel would show.
 *
 * It exists because five of the six gates can be green while this binary
 * throws on its first line — which is exactly what happened when the pack
 * schema tightened underneath it. One event is enough to prove the whole path
 * is wired; the daemon's own tests prove the path is right.
 *
 * It was called `main` and its documentation ended up above `daemon` when that
 * was added — the stranded-doc class `tools/detached-docs.test.ts` exists for,
 * caught by that gate on the first run.
 */
function smoke(): void {
  const state = createDaemon(resolvePack().manifest, []);
  const now = Date.now();
  const sessions = observe(
    createRegistry(now),
    { sessionId: 'placeholder', kind: 'PreToolUse', tool: 'Bash' },
    now,
  );
  const panel = resolvePanel(sessions, now);
  process.stdout.write(
    `pack=${state.pack.name} state=${panel.state} ` +
      `animation=${animationFor(panel.state, { tool: panel.tool })}\n`,
  );
}

/**
 * The failures this CLI composes a sentence for, printed without their stack.
 *
 * Everything else keeps the stack: a `TypeError` from a real bug arriving as
 * one context-free line is an hour lost on a day that cannot move.
 *
 * **The pack clauses were missing and every pack failure printed a stack** —
 * which is the one class of error whose whole value is the sentence, since it
 * names the path you got wrong. Found by a spec review before the resolver
 * shipped, so no version of this ever ran that way.
 */
const KNOWN =
  /already listening|not a socket|over the .*-byte limit|no pack configured|could not read the pack|is not a valid pack|TAMACLAUDE_PACK is set but empty/;

/** The subset of `KNOWN` meaning "not usable as typed" rather than "it failed". */
const MISCONFIGURED = /no pack configured|TAMACLAUDE_PACK is set but empty/;

const [, , command, ...rest] = process.argv;
// **One try/catch around every command, not just `daemon`.** `smoke()` used to
// sit outside it, so the one command that exists to prove the binary starts was
// also the one whose failure arrived as a raw stack. Now that both commands
// load a pack, that gap would have been the first thing a person hit.
try {
  if (command === 'daemon') {
    await daemon(rest);
  } else if (command === 'pack') {
    pack();
  } else if (command === 'install-agent') {
    await installAgent(rest);
  } else if (command === undefined) {
    smoke();
  } else {
    // Not the smoke test. `tamaclaude frobnicate` used to print a cheerful
    // `pack=example state=WORKING` and exit 0, so a typo of `daemon` looked
    // like a successful run of something. With the usage, because the two most
    // likely things typed here are a typo of `daemon` and something
    // help-shaped.
    process.stderr.write(`${USAGE}unknown command: ${command}\n`);
    process.exit(2);
  }
} catch (cause) {
  const line =
    cause instanceof Error
      ? KNOWN.test(cause.message)
        ? cause.message
        : (cause.stack ?? cause.message)
      : String(cause);
  process.stderr.write(`${line}\n`);
  // 2 rather than 1 for a pack that was never configured, and for one named
  // by an empty variable: both are the same class as a missing device path,
  // which already exits 2 — the command was not usable as typed, rather than
  // something failing while it ran. The distinction is not cosmetic, because
  // the launchd agent in `BUILD_PLAN.md` Stage 3 is what will meet these
  // failures, and a wrapper that retries a crash should not retry a typo.
  process.exit(MISCONFIGURED.test(line) ? 2 : 1);
}
