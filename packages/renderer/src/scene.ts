import type { Painter } from './band.js';
import type { EnvironmentExtent, TimeOfDay } from './environment.js';
import type { Framebuffer } from './framebuffer.js';
import type { BandName, Orientation, StageLayout } from './layout.js';
import type { QrCode } from './qr.js';
import type { SessionChip } from './strip.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame, Rect } from '@tamaclaude/protocol';

import {
  centredTextY,
  rightAlignedX,
  sceneColours,
  TEXT_INSET,
} from './band.js';
import { drawFrame } from './draw.js';
import { environmentInk, paintEnvironment } from './environment.js';
import { GLYPH_WIDTH } from './font-data.js';
import { clearToPackBackground, createFramebuffer } from './framebuffer.js';
import {
  panelBands,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from './layout.js';
import { paintQr } from './qr.js';
import { paintStrip } from './strip.js';
import { drawText, drawTextBlock, ELLIPSIS, measureText } from './text.js';

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

/**
 * A raster for one stage slot, and which of its pixels are drawn.
 *
 * Production art always carries one: `svg2frames.ts` captures with `omitBackground`, so a
 * raster's background is transparent, and treating it as opaque black paints
 * over whatever the pack — or later the environment — put behind Clawd.
 */
export type StageSprite = {
  readonly frame: Frame;
  /**
   * Required, not optional. `drawFrame` validates a mask's *length* loudly but
   * cannot validate its absence — and a caller who omits it gets an opaque
   * black rectangle with no type error and no throw, which is the defect this
   * type exists to prevent. Tests that genuinely want every pixel drawn say so
   * with `opaqueMask`.
   */
  readonly mask: Uint8Array;
};

/** A mask that draws every pixel, for callers with nothing to cut out. */
export function opaqueMask(frame: Frame): Uint8Array {
  return new Uint8Array(frame.pixels.length).fill(1);
}

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
  readonly sprites: readonly StageSprite[];
  /**
   * The rock pool behind Clawd, or nothing.
   *
   * `extent` is the caller's choice, not this type's. Confining the scenery to
   * the stage keeps the pack's ink legible but makes the panel look like a
   * picture bolted to a terminal; letting the sky run behind the text is one
   * coherent object but needs the scheme's ink rather than the pack's, because
   * white on a midday sky is invisible.
   *
   * Both are built. `packages/cli` sets `panel` as a constant, chosen on
   * 22 Aug when the scenery was wired; the pack field that would have exposed
   * the other was cut on 25 Aug. `tools/panel-mock.ts --extent stage` renders
   * the rejected side, so the choice can be re-checked by looking.
   *
   * Omitting this entirely is what tests mostly want — a scene on the pack
   * background is far easier to assert about than one on scenery.
   */
  readonly environment?: {
    readonly time: TimeOfDay;
    readonly extent: EnvironmentExtent;
    /**
     * Whether to darken the ground under the sprite. Default true.
     *
     * False for an animation that is not standing on it — `bouldering` is on a
     * wall, and a floor shadow under a climber is worse than none. The caller
     * decides because the environment is painted before any sprite exists, so
     * this layer cannot tell what it is about to be behind.
     */
    readonly contact?: boolean;
  };
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
  /**
   * A QR to show instead of the strip and the message band.
   *
   * Set by the daemon on the birthday and on no other day. It is a whole
   * *instead of*, not an overlay: a session chip or a line of quip showing
   * through a QR is not decoration, it is a symbol that does not decode.
   *
   * The strip and the message are what it costs, and that is the trade. The
   * stage still shows Clawd and the status band still shows the clock, so
   * nothing that says *when to look* is given up — and the day's quip is on
   * the page the QR leads to, at more length than a band could carry.
   */
  readonly qr?: QrCode;
};

/**
 * Magnification for the status bar. See `TextPen.scale` for why this is a
 * scale rather than a second font, and why it is not applied everywhere.
 */
const STATUS_TEXT_SCALE = 2;

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
function fitted(text: string, budget: number, scale: number): string {
  if (measureText(text, scale) <= budget) return text;
  const cells = Math.floor(budget / (GLYPH_WIDTH * scale));
  const columns = Math.max(0, cells - ELLIPSIS.length);
  return `${text.slice(0, columns)}${ELLIPSIS}`;
}

/**
 * Paint the status band: clock hard left, subagent count hard right.
 *
 * The right-hand string is laid out from its own measured width rather than
 * from a column count, so a count that grows from `x2` to `x12` stays pinned
 * to the same edge.
 *
 * See `rightAlignedX` for why that edge is clamped.
 */
function paintStatus(painter: Painter, scene: Scene): void {
  const band = painter.bands.status;
  // Doubled here and nowhere else. This band holds a clock and a subagent
  // count — short, glanceable, and the things read from across a desk — and
  // the 24px band has room for a 22px glyph. The message band keeps 1x
  // because doubling would take it from 21 columns to 10, and capacity is
  // what that band is for.
  const scale = STATUS_TEXT_SCALE;
  const y = centredTextY(band, scale);
  const colour = painter.colours.ink;
  // Half the band each, so neither string can reach the other's territory.
  const budget = Math.floor((band.width - TEXT_INSET * 3) / 2);
  const left = fitted(scene.status.left, budget, scale);
  const right = fitted(scene.status.right, budget, scale);
  drawText(painter.target, left, { x: band.x + TEXT_INSET, y, colour, scale });
  drawText(painter.target, right, {
    x: rightAlignedX(band, right, scale),
    y,
    colour,
    scale,
  });
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
    drawFrame(painter.target, sprite.frame, {
      x: slot.x,
      y: slot.y - crop,
      within: slot,
      mask: sprite.mask,
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
 * Paint the scenery, and hand back a painter whose ink reads against it.
 *
 * The ink swap only happens for a panel-wide environment, because that is the
 * only case where the bands stop sitting on the pack background. A stage-only
 * environment leaves them exactly where they were.
 */
function withEnvironment(painter: Painter, scene: Scene): Painter {
  const environment = scene.environment;
  if (environment === undefined) return painter;
  const into =
    environment.extent === 'panel'
      ? { x: 0, y: 0, ...panelSize(scene.orientation) }
      : painter.bands.stage;
  paintEnvironment(
    painter.target,
    { into, stage: painter.bands.stage },
    {
      layout: scene.layout,
      orientation: scene.orientation,
      time: environment.time,
      contact: environment.contact ?? true,
    },
  );
  if (environment.extent !== 'panel') return painter;
  return {
    ...painter,
    colours: { ...painter.colours, ink: environmentInk(environment.time) },
  };
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
  const base: Painter = {
    target,
    bands: panelBands(scene.orientation),
    colours: sceneColours(scene.pack),
  };
  // Behind everything, and before the sprite: the environment is a ground for
  // Clawd to stand on, not a decoration over him.
  const painter = withEnvironment(base, scene);
  paintStatus(painter, scene);
  paintStage(painter, scene);
  // The QR takes both lower bands or neither of them. `paintQr` returns `null`
  // when it cannot give every module a whole pixel, and then the ordinary
  // bands draw: losing the QR is survivable, losing the panel's only text
  // because something silently drew nothing is not.
  if (
    scene.qr === undefined ||
    paintQr(target, qrArea(painter.bands), scene.qr) === null
  ) {
    paintStrip(painter, scene.sessions);
    paintMessage(painter, scene);
  }
  return target;
}

/**
 * The region the QR occupies: the strip and the message band together.
 *
 * Derived from the bands rather than written down, so a layout change moves
 * the QR with them instead of leaving it over the top of something.
 */
function qrArea(bands: Readonly<Record<BandName, Rect>>): Rect {
  const { strip, message } = bands;
  return {
    x: strip.x,
    y: strip.y,
    width: strip.width,
    height: message.y + message.height - strip.y,
  };
}
