#!/usr/bin/env node
/**
 * `tamaclaude-notify` — the binary Claude Code executes on every hook event.
 *
 * This package is deliberately near-leaf. Claude Code runs it many times per
 * turn, so its import graph is a latency budget rather than a style
 * preference. It will read an event from stdin, forward it to the daemon over a
 * Unix socket, and exit; today it emits a placeholder event to stdout, and the
 * socket client lands in Stage 3. It does not render, load packs, or reason
 * about sessions — and it exports nothing, because it is a program.
 */
import type { HookEvent } from '@tamaclaude/protocol';

/**
 * Forward an event to the daemon.
 *
 * Placeholder — the Unix socket client lands in BUILD_PLAN Stage 3. Writing to
 * stdout keeps the binary observable until then.
 */
function forward(event: HookEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function main(): void {
  forward({ sessionId: 'placeholder', kind: 'SessionStart' });
}

main();
