import type { Framebuffer } from './framebuffer.js';
import type { BandName } from './layout.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Rect } from '@tamaclaude/protocol';

import { packPalette } from '@tamaclaude/packs';

import { GLYPH_HEIGHT } from './font-data.js';
import { measureText } from './text.js';

/**
 * The shared vocabulary of band painting: the colours a band draws with, and
 * the insets it draws within.
 *
 * Separate from `scene.ts` because every band painter needs it and none of
 * them needs the others. Keeping it here is also what stops the strip
 * importing the scene that imports the strip.
 */

/**
 * The four jobs a colour does on this panel, and where each comes from in the
 * pack palette. Palette entry 0 is the background by convention; the rest
 * follow the example pack's order — ink, then a warm accent, then a cool one.
 */
const ROLE_INDEX = {
  background: 0,
  ink: 1,
  attention: 2,
  active: 3,
} as const;

export type ColourRole = keyof typeof ROLE_INDEX;

export type SceneColours = Readonly<Record<ColourRole, number>>;

/**
 * Resolve the pack's palette into the roles the bands paint with.
 *
 * The schema guarantees a background and an ink and nothing beyond that, so
 * every role past those two has to survive a pack that does not carry it.
 * Missing roles fall back to ink rather than to the nearest entry: a
 * two-colour pack then draws a permission prompt in its only ink colour, which
 * is legible, where falling back to the last entry would tint half the roles
 * with whatever happened to be last. The renderer will not invent a colour the
 * pack does not contain — which is why `packages/packs` refuses a palette of
 * one outright rather than letting it reach here and render an invisible
 * panel.
 */
export function sceneColours(manifest: PackManifest): SceneColours {
  const palette = packPalette(manifest);
  const background = palette[0] ?? 0;
  const ink = palette[ROLE_INDEX.ink] ?? background;
  const of = (role: ColourRole): number => palette[ROLE_INDEX[role]] ?? ink;
  return { background, ink, attention: of('attention'), active: of('active') };
}

/** What a band paints with: the buffer, the geometry, the resolved palette. */
export type Painter = {
  readonly target: Framebuffer;
  readonly bands: Readonly<Record<BandName, Rect>>;
  readonly colours: SceneColours;
};

/**
 * Inset of content from its band's edge.
 *
 * Not band geometry — `layout.ts` owns that — but typographic breathing room,
 * and the one number here that is chosen rather than derived. Four pixels is
 * roughly half a glyph cell, enough that a descender does not sit against the
 * panel bezel.
 */
export const TEXT_INSET = 4;

/** Top of a single line of text centred in a band. */
export function centredTextY(rect: Rect): number {
  return rect.y + Math.floor((rect.height - GLYPH_HEIGHT) / 2);
}

/**
 * Left edge for a string pinned to a band's right inset.
 *
 * Measured rather than counted in columns, so a subagent count growing from
 * `x2` to `x12` stays on the same edge. Clamped to the band's left inset,
 * because right-alignment is a subtraction and a subtraction goes negative:
 * landscape's status band starts at x 168, so an unclamped long string would
 * lay itself out from off-panel and draw back through the stage. Clamped, it
 * overruns to the right instead, where both right-hand bands are flush with
 * the panel edge and the buffer clip catches it.
 */
export function rightAlignedX(rect: Rect, text: string): number {
  return Math.max(
    rect.x + TEXT_INSET,
    rect.x + rect.width - TEXT_INSET - measureText(text),
  );
}
