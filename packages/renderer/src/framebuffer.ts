import type { Orientation } from './layout.js';
import type { PackManifest } from '@tamaclaude/packs';

import { packPalette } from '@tamaclaude/packs';

import { panelSize } from './layout.js';

/**
 * Framebuffer allocation, sized from the layout rather than from the panel
 * constants.
 *
 * `SCREEN_WIDTH x SCREEN_HEIGHT` is the panel's native portrait geometry, and
 * allocating straight from it silently assumed the board is mounted that way.
 * Landscape is not rotated portrait — `panelSize` is the one thing that knows
 * which way round 172x320 goes, and going through it means a landscape
 * framebuffer is the right shape rather than a portrait one drawn into
 * sideways.
 *
 * The buffer and the two operations over the whole of it live here rather than
 * in `index.js` so that `index.js` can be a pure barrel. `scene.ts` needs
 * `clearToPackBackground` as a *value*, and a value imported from the barrel
 * that re-exports `scene.ts` is a genuine runtime cycle — not the harmless
 * type-only kind that `verbatimModuleSyntax` erases.
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

/**
 * Allocate a framebuffer sized to the panel as mounted.
 *
 * Portrait is the default because it is what ships and what every existing
 * caller means; an explicit orientation is how landscape asks for the other
 * one.
 */
export function createFramebuffer(
  orientation: Orientation = 'portrait',
): Framebuffer {
  const { width, height } = panelSize(orientation);
  return { pixels: new Uint16Array(width * height), width, height };
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
  target.pixels.fill(palette[0] ?? 0);
}
