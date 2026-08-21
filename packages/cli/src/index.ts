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
  const root = resolve(fileURLToPath(import.meta.url), '../../../..');
  return JSON.parse(
    readFileSync(resolve(root, 'packs/example/manifest.json'), 'utf8'),
  );
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
