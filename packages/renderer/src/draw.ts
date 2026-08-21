import type { Framebuffer } from './framebuffer.js';
import type { Frame, Rect } from '@tamaclaude/protocol';

/**
 * Drawing primitives: the smallest set of operations every screen is built
 * from.
 *
 * All three clip. A band rect can legitimately sit partly off the panel — the
 * landscape stage is pulled up by the safe-area crop, and a chip strip sized
 * for five sessions has to survive a sixth — and the failure mode when it does
 * is not a crash but a write that runs past the end of a row and lands at the
 * start of the next one. That looks like a diagonal smear and is invisible to
 * any test whose shapes all fit.
 */

/**
 * The overlap of two rectangles, or `null` if they do not overlap.
 *
 * Every clip in this file is one of these, so the arithmetic exists once. It
 * also absorbs degenerate rects: a zero or negative extent leaves the near
 * edge at or past the far one, which is the same `null` as being disjoint.
 */
function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** The part of `rect` that lies inside the buffer, or `null` if none of it does. */
function clipToBuffer(target: Framebuffer, input: Rect): Rect | null {
  // Rounded before anything else. Every coordinate in the repo reaches here as
  // an integer — layout constants through Math.round, rasters through
  // `frame()`, which rejects ragged input — so this is defensive rather than
  // load-bearing. But a fractional rect does not clip wrong, it renders wrong:
  // a half-pixel x offset lands the row at the wrong column and the result is
  // a mid-row smear, which is the exact class of bug the header of this file
  // exists to prevent. Cheaper to make unreachable than to reason about.
  const rect = {
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.round(input.width),
    height: Math.round(input.height),
  };
  return intersectRect(rect, {
    x: 0,
    y: 0,
    width: target.width,
    height: target.height,
  });
}

/** Fill a rectangle with a single RGB565 colour. */
export function fillRect(
  target: Framebuffer,
  rect: Rect,
  colour: number,
): void {
  const clipped = clipToBuffer(target, rect);
  if (clipped === null) return;
  for (let row = 0; row < clipped.height; row += 1) {
    const start = (clipped.y + row) * target.width + clipped.x;
    target.pixels.fill(colour, start, start + clipped.width);
  }
}

/**
 * Blit a raster at a position on the buffer — how an animation frame lands in
 * the stage band, and a mini-Clawd in a session chip.
 *
 * The position may be negative, and deliberately is: landscape pulls the
 * sprite up by the safe-area crop so the prop headroom portrait keeps falls
 * off the top. Clipping the row *length* without also advancing into the
 * source is the subtle version of the bug — it draws the right number of
 * pixels from the wrong column — so both offsets come off the same clip.
 *
 * `within` confines the blit to a band as well as to the panel. The landscape
 * hero sprite is the case that needs it: pulled up by a 40px crop it covers
 * y -34 to 165 while its stage band starts at y 6, so six rows of it land
 * above the band. Clipping to the buffer alone lets those rows through, and
 * they are only invisible for as long as nothing else is drawn up there.
 */
export function drawFrame(
  target: Framebuffer,
  source: Frame,
  at: { readonly x: number; readonly y: number; readonly within?: Rect },
): void {
  const height = source.pixels.length / source.width;
  const placed = { x: at.x, y: at.y, width: source.width, height };
  const bounded = at.within ? intersectRect(placed, at.within) : placed;
  const clipped = bounded === null ? null : clipToBuffer(target, bounded);
  if (clipped === null) return;
  const skipX = clipped.x - at.x;
  const skipY = clipped.y - at.y;
  for (let row = 0; row < clipped.height; row += 1) {
    const from = (skipY + row) * source.width + skipX;
    target.pixels.set(
      source.pixels.subarray(from, from + clipped.width),
      (clipped.y + row) * target.width + clipped.x,
    );
  }
}

/**
 * Outline a rectangle one pixel wide.
 *
 * One pixel is not a parameter because at 172px wide nothing thicker reads as
 * a line — it reads as a filled edge. This is what marks a session chip on the
 * strip and what encloses a progress track; the fill inside either is a
 * `fillRect`, which is why there is no separate chip primitive.
 *
 * Each edge clips on its own, so a rect hanging off the panel draws only the
 * edges that are actually on it — the far edge of a chip scrolled half out of
 * the strip simply does not appear.
 */
export function drawBorder(
  target: Framebuffer,
  rect: Rect,
  colour: number,
): void {
  const { x, y, width, height } = rect;
  // A zero or negative extent puts the far edge *before* the near one, which
  // would draw a stray line outside the rect rather than nothing at all.
  if (width <= 0 || height <= 0) return;
  fillRect(target, { x, y, width, height: 1 }, colour);
  fillRect(target, { x, y: y + height - 1, width, height: 1 }, colour);
  fillRect(target, { x, y, width: 1, height }, colour);
  fillRect(target, { x: x + width - 1, y, width: 1, height }, colour);
}
