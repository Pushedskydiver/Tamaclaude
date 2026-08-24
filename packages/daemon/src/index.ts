/**
 * The daemon: session state, tool-to-animation mapping, and transports.
 *
 * Owns the answer to "what should the panel show right now?" given every
 * Claude Code session currently running — including, if BUILD_PLAN Stage 3
 * allows, sessions on a remote host.
 */

import type { Transport } from '@tamaclaude/device';
import type { PackManifest } from '@tamaclaude/packs';
import type { Framebuffer } from '@tamaclaude/renderer';

import { parsePackManifest } from '@tamaclaude/packs';
import { clearToPackBackground, createFramebuffer } from '@tamaclaude/renderer';

export type DaemonState = {
  readonly framebuffer: Framebuffer;
  readonly pack: PackManifest;
  readonly transports: readonly Transport[];
};

/**
 * Stand up the daemon's initial state from an untrusted pack manifest.
 *
 * Validation happens here rather than at the call site because a pack is
 * hand-edited by whoever owns the device — the daemon is the trust boundary,
 * so it is the daemon's job to refuse a bad one.
 */
export function createDaemon(
  packInput: unknown,
  transports: readonly Transport[],
): DaemonState {
  const pack = parsePackManifest(packInput);
  const framebuffer = createFramebuffer();
  clearToPackBackground(framebuffer, pack);
  return { framebuffer, pack, transports };
}

// The session pipeline. Everything below is pure and takes `now` as an
// argument — there is no clock in this package, which is what lets a
// ten-minute eviction be proved in microseconds.
//
// Only what a consumer actually calls is here. `evictStale`, `liveSessions`
// and `applyEvent` are exported from their own modules and import cleanly from
// there; each joins
// this barrel the day something outside the package needs it, which is the
// same rule `packages/renderer/src/index.ts` applies to `band.js`. Adding one
// early is what `knip` is configured to catch.
export { animationFor } from './animation.js';
export type { AnimationName } from './animation.js';
export { createRegistry, observe } from './registry.js';
export { resolvePanel } from './resolve.js';
// Joined the barrel when `packages/cli`'s `daemon` command became the first
// thing outside this package to compose the listener with the registry.
export type { Session } from './session.js';
export { effectiveState } from './session.js';
export type { SessionState } from './state.js';
// `needsAttention` crosses the boundary for one caller: the message band has to
// know whether a state is asking for a human, so the birthday line can step
// aside for it. This was `ATTENTION_RANK` and `stateRank`, which let the caller
// open-code the comparison — see `state.ts` for the mutant that shape admitted.
export { needsAttention } from './state.js';
export { startSocketServer } from './socket-server.js';
export { defaultSocketPath } from './socket-path.js';
