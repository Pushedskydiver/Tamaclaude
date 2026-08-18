/**
 * The daemon: session state, tool-to-animation mapping, and transports.
 *
 * Owns the answer to "what should the panel show right now?" given every
 * Claude Code session currently running — including, if BUILD_PLAN Stage 3
 * allows, sessions on a remote host.
 */

import type { Transport } from '@tamaclaude/device';
import type { PackManifest } from '@tamaclaude/packs';
import type { HookEvent } from '@tamaclaude/protocol';
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

/**
 * Map a hook event to the animation the panel should show.
 *
 * Placeholder — the real mapping table lands in BUILD_PLAN Stage 3, alongside
 * multi-session compositing. Both Alex and Jamie run several sessions at once,
 * so "the current animation" is a resolution problem, not a single value.
 */
export function animationFor(event: HookEvent): string {
  return event.tool ?? event.kind;
}
