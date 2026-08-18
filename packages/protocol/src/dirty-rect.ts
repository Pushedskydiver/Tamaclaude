/**
 * Dirty-rect diffing: the difference between fitting down the wire and not.
 *
 * `docs/ARCHITECTURE.md` rests the whole host-renders design on only sending
 * what changed. A full 172x320 frame is 110,080 bytes and at 10fps that is
 * 1.1 MB/s against a USB full-speed ceiling of roughly 700KB-1MB/s. A typical
 * sprite region is a fraction of that.
 */

import type { Rect } from './geometry.js';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

/**
 * The smallest rectangle containing every pixel that differs, or `null` if the
 * frames are identical.
 *
 * A bounding box rather than a set of disjoint regions. Two changes at
 * opposite corners produce one large rect, which is worse than sending two
 * small ones — but scenes here are a character and its props moving together,
 * not scattered updates, and a single rect keeps the wire format and the
 * firmware blitter trivial. Revisit only if a real animation measures badly.
 */
export function dirtyRect(
  previous: Uint16Array,
  next: Uint16Array,
  width: number = SCREEN_WIDTH,
): Rect | null {
  if (previous.length !== next.length) {
    throw new Error(
      `frame size mismatch: ${previous.length} vs ${next.length} pixels`,
    );
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] === next[index]) continue;
    const x = index % width;
    const y = Math.trunc(index / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** Copy the pixels inside `rect` out of a full frame, row by row. */
export function extractRect(
  frame: Uint16Array,
  rect: Rect,
  width: number = SCREEN_WIDTH,
): Uint16Array {
  const out = new Uint16Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const from = (rect.y + row) * width + rect.x;
    out.set(frame.subarray(from, from + rect.width), row * rect.width);
  }
  return out;
}

/** A whole-screen rect, for the first frame after a connect. */
export function fullScreenRect(): Rect {
  return { x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
}
