#!/usr/bin/env node
/**
 * `tamaclaude` — the command line surface.
 *
 * There is deliberately no menu bar app: one would need a native shim or
 * Electron, which reintroduces a signed `.app` and Gatekeeper for a gift that
 * has to work on someone else's Mac on the day. The panel is its own UI, and
 * the CLI covers the rest. See BUILD_PLAN §Deliberately not scheduled.
 */
import { animationFor, createDaemon } from '@tamaclaude/daemon';

const PLACEHOLDER_PACK = {
  name: 'example',
  palette: [[0, 0, 0]],
  quips: { mapped: {}, idle: [] },
};

function main(): void {
  const state = createDaemon(PLACEHOLDER_PACK, []);
  const animation = animationFor({
    sessionId: 'placeholder',
    kind: 'SessionStart',
  });
  process.stdout.write(`pack=${state.pack.name} animation=${animation}\n`);
}

main();
