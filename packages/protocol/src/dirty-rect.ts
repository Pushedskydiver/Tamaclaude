/**
 * Dirty-rect diffing: the difference between fitting down the wire and not.
 *
 * `docs/ARCHITECTURE.md` rests the whole host-renders design on only sending
 * what changed. A full 172x320 frame is 110,080 bytes; at the panel's 8fps
 * that is 880 KB/s against a USB full-speed ceiling of roughly 700KB-1MB/s, so
 * full frames do not fit even before the header.
 */

import type { Rect } from './geometry.js';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

/**
 * Pixels plus the stride they are laid out at.
 *
 * The stride travels with the pixels deliberately. `dirtyRect` and
 * `extractRect` used to take it as a defaulted parameter each, and every
 * animation frame in this project is 168 wide while the panel is 172 — so the
 * default was wrong for every asset in the repo, and passing it to one call
 * but not the other produced silently wrong pixels rather than an error.
 */
export type Frame = {
  readonly pixels: Uint16Array;
  readonly width: number;
};

/** Wrap pixels with their stride, checking the two agree. */
export function frame(pixels: Uint16Array, width: number): Frame {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`frame width must be a positive integer, got ${width}`);
  }
  if (pixels.length % width !== 0) {
    throw new Error(
      `${pixels.length} pixels is not a whole number of ${width}-pixel rows`,
    );
  }
  return { pixels, width };
}

/**
 * The smallest rectangle containing every pixel that differs, or `null` if the
 * frames are identical.
 *
 * A bounding box rather than a set of disjoint regions. That is cheap and
 * keeps the firmware blitter trivial, and it is fine while the only thing
 * moving is a character and its props. It stops being fine the moment a second
 * region changes independently — a clock ticking in the message band expands
 * the box to nearly the whole panel and drags every unchanged pixel between
 * them onto the wire. See `docs/ARCHITECTURE.md` §What it actually costs.
 */
export function dirtyRect(previous: Frame, next: Frame): Rect | null {
  if (previous.width !== next.width) {
    throw new Error(`stride mismatch: ${previous.width} vs ${next.width}`);
  }
  if (previous.pixels.length !== next.pixels.length) {
    throw new Error(
      `frame size mismatch: ${previous.pixels.length} vs ${next.pixels.length}`,
    );
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < next.pixels.length; index += 1) {
    if (previous.pixels[index] === next.pixels[index]) continue;
    const x = index % next.width;
    const y = Math.trunc(index / next.width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Copy the pixels inside `rect` out of a frame, row by row.
 *
 * Range-checked. `subarray` clamps rather than throwing, so an out-of-range
 * rect used to come back zero-filled — black pixels instead of an exception.
 */
export function extractRect(source: Frame, rect: Rect): Uint16Array {
  const height = source.pixels.length / source.width;
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > source.width ||
    rect.y + rect.height > height
  ) {
    throw new Error(
      `rect ${rect.x},${rect.y} ${rect.width}x${rect.height} does not fit a ` +
        `${source.width}x${height} frame`,
    );
  }
  const out = new Uint16Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const from = (rect.y + row) * source.width + rect.x;
    out.set(source.pixels.subarray(from, from + rect.width), row * rect.width);
  }
  return out;
}

/** A whole-screen rect, for the first frame after a connect. */
export function fullScreenRect(): Rect {
  return { x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
}
