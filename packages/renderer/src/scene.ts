import type { Painter } from './band.js';
import type { Framebuffer } from './framebuffer.js';
import type { Orientation, StageLayout } from './layout.js';
import type { SessionChip } from './strip.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame } from '@tamaclaude/protocol';

import {
  centredTextY,
  rightAlignedX,
  sceneColours,
  TEXT_INSET,
} from './band.js';
import { drawFrame } from './draw.js';
import { GLYPH_WIDTH } from './font-data.js';
import { clearToPackBackground, createFramebuffer } from './framebuffer.js';
import {
  panelBands,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from './layout.js';
import { paintStrip } from './strip.js';
import { drawText, drawTextBlock, measureText } from './text.js';

/**
 * The scene: a declarative description of what is on the panel, and the one
 * function that turns it into pixels.
 *
 * Every position comes from `panelBands` and `spriteSlots`. Nothing here knows
 * a coordinate, which is what lets the same code compose a portrait panel and
 * a landscape one whose bands are rearranged rather than rotated.
 *
 * The scene is a description of a *frame*, not of the world. It carries no
 * clock, no session ids and no state machine: those belong to the daemon,
 * which resolves them into the strings and tones below. Keeping the boundary
 * there is what lets a test render any panel state from a literal.
 */

/** Everything the panel shows at one instant. */
export type Scene = {
  readonly orientation: Orientation;
  readonly layout: StageLayout;
  readonly pack: PackManifest;
  /**
   * One raster per stage slot, in slot order. An array rather than a single
   * `Frame` because `twoUp` has two slots showing two different sessions —
   * repeating one sprite across both would claim they were the same session.
   * Slots past the end of the array stay empty.
   */
  readonly sprites: readonly Frame[];
  /**
   * The status band's two ends: clock on the left, subagent count on the
   * right (spec §2). Both are opaque strings — formatting a clock is a
   * question of locale and of 12-versus-24 hour, which is the daemon's
   * business and not the renderer's.
   */
  readonly status: { readonly left: string; readonly right: string };
  /** One chip per live session, in the order the strip should show them. */
  readonly sessions: readonly SessionChip[];
  /** Quip, tool label or state text. Wrapped to the band; never clipped silently. */
  readonly message: string;
};

/**
 * Paint the status band: clock hard left, subagent count hard right.
 *
 * The right-hand string is laid out from its own measured width rather than
 * from a column count, so a count that grows from `x2` to `x12` stays pinned
 * to the same edge.
 *
 * See `rightAlignedX` for why that edge is clamped.
 */
/**
 * Cut a string to a pixel budget, marking that it was cut.
 *
 * The status band is the one place two strings share a row, so an over-long
 * left string does not simply clip at the panel edge — `rightAlignedX` clamps
 * to the same inset, and the two overprint into an unreadable smear. Both are
 * short by contract, but `text.ts` says plainly that clipping in silence is
 * never allowed, and "the daemon owns the contract" is exactly the
 * rationalisation `docs/DA-REVIEW.md` says not to accept.
 */
function fitted(text: string, budget: number): string {
  if (measureText(text) <= budget) return text;
  const columns = Math.max(0, Math.floor(budget / GLYPH_WIDTH) - 1);
  return `${text.slice(0, columns)}\u2026`;
}

function paintStatus(painter: Painter, scene: Scene): void {
  const band = painter.bands.status;
  const y = centredTextY(band);
  const colour = painter.colours.ink;
  // Half the band each, so neither string can reach the other's territory.
  const budget = Math.floor((band.width - TEXT_INSET * 3) / 2);
  const left = fitted(scene.status.left, budget);
  const right = fitted(scene.status.right, budget);
  drawText(painter.target, left, { x: band.x + TEXT_INSET, y, colour });
  drawText(painter.target, right, { x: rightAlignedX(band, right), y, colour });
}

/**
 * Paint the stage: one sprite per slot, pulled up by the safe-area crop and
 * clipped to the slot.
 *
 * Two things here are easy to get subtly wrong, and both have already been got
 * wrong once.
 *
 * The crop must use the scale this layout actually draws at, not the authoring
 * scale — a two-up sprite is drawn at scale 4, so a crop computed at scale 8
 * removes ten authored units instead of five and leaves a void beneath.
 * `tools/panel-mock.ts` did that, and the mistake reached the spec as a design
 * verdict about two-up being weak.
 *
 * The clip must be the *slot*, not the stage band. Pulling a sprite up without
 * clipping it does not remove the prop headroom landscape has no room for; it
 * relocates that headroom above the character, still inside the stage band and
 * so invisible to any test that only asks which band a pixel landed in. In
 * landscape two-up that is twenty rows of it. `spriteSlots` returns a slot only
 * as tall as the safe area precisely so this clip has something to cut against,
 * which is the same job `overflow: hidden` does on the mock's `.slot`.
 */
function paintStage(painter: Painter, scene: Scene): void {
  const crop =
    scene.orientation === 'landscape'
      ? safeAreaCropUnits() * stageScale(scene.layout)
      : 0;
  const slots = spriteSlots(scene.layout, scene.orientation);
  for (const [index, slot] of slots.entries()) {
    const sprite = scene.sprites[index];
    if (sprite === undefined) continue;
    drawFrame(painter.target, sprite, {
      x: slot.x,
      y: slot.y - crop,
      within: slot,
    });
  }
}

/** Paint the message band, wrapped to the inset box. */
function paintMessage(painter: Painter, scene: Scene): void {
  const band = painter.bands.message;
  drawTextBlock(painter.target, scene.message, {
    rect: {
      x: band.x + TEXT_INSET,
      y: band.y + TEXT_INSET,
      width: band.width - TEXT_INSET * 2,
      height: band.height - TEXT_INSET * 2,
    },
    colour: painter.colours.ink,
  });
}

/**
 * Compose a scene into a fresh framebuffer.
 *
 * The buffer is cleared first, so a render is total: every pixel is defined by
 * this scene and none is left over from the last one. That is what makes
 * `dirtyRect` between two renders mean what it says.
 */
export function render(scene: Scene): Framebuffer {
  const target = createFramebuffer(scene.orientation);
  clearToPackBackground(target, scene.pack);
  const painter: Painter = {
    target,
    bands: panelBands(scene.orientation),
    colours: sceneColours(scene.pack),
  };
  paintStatus(painter, scene);
  paintStage(painter, scene);
  paintStrip(painter, scene.sessions);
  paintMessage(painter, scene);
  return target;
}
