import type { PackManifest } from '@tamaclaude/packs';

import { packPalette } from '@tamaclaude/packs';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

/**
 * The renderer: a virtual 172x320 screen composed entirely on the host.
 *
 * This is where every screen, animation and layout decision lives. It has two
 * sinks — a browser canvas in development and the panel over USB-CDC in
 * production — and does not know which one it is feeding.
 */

/**
 * An RGB565 framebuffer.
 *
 * `pixels` is deliberately mutable: this is the one place in the repo where
 * mutation is the correct design. Allocating a new buffer per frame at 10fps
 * would defeat the point. `eslint.config.ts` disables the functional rules for
 * this package for exactly this reason.
 */
export type Framebuffer = {
  readonly pixels: Uint16Array;
  readonly width: number;
  readonly height: number;
};

/** Allocate a framebuffer sized to the physical panel. */
export function createFramebuffer(): Framebuffer {
  return {
    pixels: new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT),
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  };
}

/** Fill the whole framebuffer with a single RGB565 colour. */
function fill(target: Framebuffer, colour: number): void {
  target.pixels.fill(colour);
}

/**
 * Clear a framebuffer to a pack's first palette entry — its background.
 *
 * By convention palette[0] is the background colour, so a pack swap changes
 * the whole screen's ground without any other code knowing.
 */
export function clearToPackBackground(
  target: Framebuffer,
  manifest: PackManifest,
): void {
  const palette = packPalette(manifest);
  fill(target, palette[0] ?? 0);
}
