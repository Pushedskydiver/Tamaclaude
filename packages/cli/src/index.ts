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

import { animationFor, createDaemon } from '@tamaclaude/daemon';

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

function main(): void {
  const state = createDaemon(examplePack(), []);
  const animation = animationFor({
    sessionId: 'placeholder',
    kind: 'SessionStart',
  });
  process.stdout.write(`pack=${state.pack.name} animation=${animation}\n`);
}

main();
