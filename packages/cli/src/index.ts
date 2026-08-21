#!/usr/bin/env node
/**
 * `tamaclaude` — the command line surface.
 *
 * There is deliberately no menu bar app: one would need a native shim or
 * Electron, which reintroduces a signed `.app` and Gatekeeper for a gift that
 * has to work on someone else's Mac on the day. The panel is its own UI, and
 * the CLI covers the rest. See BUILD_PLAN §Deliberately not scheduled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

import { runDaemon } from './daemon.js';

/**
 * The example pack, read from disk rather than inlined.
 *
 * It used to be a literal here with a one-colour palette. When
 * `packages/packs` tightened its schema to require a background *and* an ink —
 * a one-colour pack renders an entirely invisible panel — this file started
 * throwing on every run, and all six gates stayed green because nothing
 * executed the binary. Loading the real pack means the example cannot drift
 * from the format it is an example of.
 */
function examplePack(): unknown {
  // Repo-relative, and **this must not survive packaging**. Installed as a
  // `brew` formula (BUILD_PLAN Stage 3) the four `..` land in
  // `node_modules`, where `packs/` does not exist — and the smoke test cannot
  // catch it, because the test only ever runs from the repo. That is the same
  // shape of blind spot the test was added to close, one level out.
  const root = resolve(fileURLToPath(import.meta.url), '../../../..');
  const manifest = resolve(root, 'packs/example/manifest.json');
  try {
    return JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (cause) {
    // Named rather than left as a bare ENOENT or a JSON syntax error, both of
    // which point at Node's internals instead of at the file.
    throw new Error(`could not read the example pack at ${manifest}`, {
      cause,
    });
  }
}

/**
 * `tamaclaude daemon` — listen, render, and drive the panel until killed.
 *
 * The device path is an argument rather than a discovery, because guessing
 * which `/dev/cu.*` is the panel is a worse failure than being told: the wrong
 * guess writes packets at somebody's modem.
 */
async function daemon(argv: readonly string[]): Promise<void> {
  const devicePath = argv[0];
  if (devicePath === undefined) {
    process.stderr.write(
      'usage: tamaclaude daemon <device>\n' +
        '  e.g. tamaclaude daemon /dev/cu.usbmodem1101\n',
    );
    process.exit(2);
  }
  const running = await runDaemon({
    socketPath: defaultSocketPath(),
    devicePath,
    pack: examplePack(),
  });
  process.stdout.write(`listening on ${defaultSocketPath()}\n`);
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
  const state = createDaemon(examplePack(), []);
  const now = Date.now();
  const sessions = observe(
    createRegistry(now),
    { sessionId: 'placeholder', kind: 'PreToolUse', tool: 'Bash' },
    now,
  );
  const panel = resolvePanel(sessions, now);
  process.stdout.write(
    `pack=${state.pack.name} state=${panel.state} ` +
      `animation=${animationFor(panel.state, panel.tool)}\n`,
  );
}

const [, , command, ...rest] = process.argv;
if (command === 'daemon') {
  await daemon(rest);
} else {
  smoke();
}
