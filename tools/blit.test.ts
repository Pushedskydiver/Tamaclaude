/**
 * Does a stream of dirty rects actually reconstruct the frames it came from?
 *
 * This is the one property the whole host-renders design rests on, and it is
 * invisible from either end: the sender believes it sent the right diffs, the
 * firmware believes it blitted what it was given, and a panel showing the
 * wrong thing is the only symptom. Replaying the packets into a virtual panel
 * is the cheapest place to catch that, and the only one that does not need a
 * board.
 *
 * It exists because of a real bug. Re-priming — re-sending a whole frame to
 * recover from a lost packet — sent frame 0 while the diff sequence carried on
 * from wherever it had got to. Every subsequent update was then
 * `frame[n] - frame[n-1]` applied to a panel showing frame 0, and the error
 * compounded: 120 of 300 ticks rendered wrong, which on `idle` showed up as a
 * stripe of the yawn hanging above a resting Clawd. It reached hardware and
 * was spotted by eye, which is the expensive way to find it.
 */
import type { Rect } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import {
  decodeRect,
  dirtyRect,
  encodeRect,
  extractRect,
  frame,
  readRectHeader,
  RECT_HEADER_BYTES,
  writeRectHeader,
} from '@tamaclaude/protocol';

const PANEL_WIDTH = 40;
const PANEL_HEIGHT = 24;
const SPRITE_WIDTH = 16;
const SPRITE_HEIGHT = 12;
const ORIGIN: Rect = {
  x: 4,
  y: 6,
  width: SPRITE_WIDTH,
  height: SPRITE_HEIGHT,
};

/** A moving block, so consecutive frames differ in a known region. */
function syntheticFrames(count: number): Uint16Array[] {
  return Array.from({ length: count }, (_, index) => {
    const pixels = new Uint16Array(SPRITE_WIDTH * SPRITE_HEIGHT);
    const top = index % (SPRITE_HEIGHT - 3);
    for (let y = top; y < top + 3; y += 1) {
      for (let x = 2; x < SPRITE_WIDTH - 2; x += 1) {
        pixels[y * SPRITE_WIDTH + x] = 0xdc4d;
      }
    }
    return pixels;
  });
}

function packet(rect: Rect, pixels: Uint16Array): Uint8Array {
  const { mode, payload } = encodeRect(pixels);
  const header = writeRectHeader(rect, payload.byteLength, mode);
  const bytes = new Uint8Array(header.byteLength + payload.byteLength);
  bytes.set(header);
  bytes.set(payload, header.byteLength);
  return bytes;
}

/** Apply one packet to a virtual panel, as the firmware would. */
function blit(panel: Uint16Array, bytes: Uint8Array): void {
  const { rect, payloadLength, mode } = readRectHeader(
    bytes.subarray(0, RECT_HEADER_BYTES),
  );
  const payload = bytes.subarray(
    RECT_HEADER_BYTES,
    RECT_HEADER_BYTES + payloadLength,
  );
  const pixels = decodeRect({ mode, payload }, rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    for (let column = 0; column < rect.width; column += 1) {
      panel[(rect.y + row) * PANEL_WIDTH + rect.x + column] =
        pixels[row * rect.width + column];
    }
  }
}

/** The panel that frame `index` should produce: the sprite on black. */
function expected(sprite: Uint16Array): Uint16Array {
  const panel = new Uint16Array(PANEL_WIDTH * PANEL_HEIGHT);
  for (let row = 0; row < SPRITE_HEIGHT; row += 1) {
    for (let column = 0; column < SPRITE_WIDTH; column += 1) {
      panel[(ORIGIN.y + row) * PANEL_WIDTH + ORIGIN.x + column] =
        sprite[row * SPRITE_WIDTH + column];
    }
  }
  return panel;
}

/**
 * Play `ticks` frames, re-priming every `every` of them with whichever frame
 * `choose` names, and count how many ticks left the panel wrong.
 */
function mismatches(
  sprites: readonly Uint16Array[],
  every: number,
  choose: (tick: number) => number,
): number {
  const whole: Rect = {
    x: 0,
    y: 0,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
  };
  const full = sprites.map((pixels) =>
    packet(ORIGIN, extractRect(frame(pixels, SPRITE_WIDTH), whole)),
  );
  const diffs = sprites.map((pixels, index) => {
    const previous = frame(
      sprites[(index + sprites.length - 1) % sprites.length],
      SPRITE_WIDTH,
    );
    const next = frame(pixels, SPRITE_WIDTH);
    const rect = dirtyRect(previous, next);
    if (!rect) return null;
    return packet(
      {
        x: ORIGIN.x + rect.x,
        y: ORIGIN.y + rect.y,
        width: rect.width,
        height: rect.height,
      },
      extractRect(next, rect),
    );
  });

  const panel = new Uint16Array(PANEL_WIDTH * PANEL_HEIGHT);
  blit(panel, full[0]);
  let wrong = 0;
  for (let tick = 0; tick < 200; tick += 1) {
    if (tick > 0 && tick % every === 0) blit(panel, full[choose(tick)]);
    const index = (tick + 1) % sprites.length;
    const diff = diffs[index];
    if (diff) blit(panel, diff);
    const want = expected(sprites[index]);
    if (panel.some((value, at) => value !== want[at])) wrong += 1;
  }
  return wrong;
}

describe('replaying a dirty-rect stream', () => {
  const sprites = syntheticFrames(9);

  it('reconstructs every frame exactly when nothing is re-primed', () => {
    expect(mismatches(sprites, Number.MAX_SAFE_INTEGER, () => 0)).toBe(0);
  });

  it('reconstructs every frame when re-primed with the current frame', () => {
    expect(mismatches(sprites, 7, (tick) => tick % sprites.length)).toBe(0);
  });

  it('corrupts the panel when re-primed with the wrong frame', () => {
    // The bug this file exists for. Guarding the fix is not enough on its own:
    // a test that only asserts the good case still passes if re-priming stops
    // happening at all, and then the recovery it was added for is silently
    // gone. This asserts the failure is still reachable.
    expect(mismatches(sprites, 7, () => 0)).toBeGreaterThan(0);
  });
});
