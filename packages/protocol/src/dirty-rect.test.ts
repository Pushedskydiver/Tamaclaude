import { describe, expect, it } from 'vitest';

import { dirtyRect, extractRect, frame, fullScreenRect } from './dirty-rect.js';
import { rectArea } from './geometry.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

const blank = (width = SCREEN_WIDTH, height = SCREEN_HEIGHT) =>
  frame(new Uint16Array(width * height), width);

describe('frame', () => {
  it('refuses a stride the pixels are not a whole number of rows of', () => {
    expect(() => frame(new Uint16Array(10), 3)).toThrow(/whole number/);
  });

  it('refuses a nonsense stride rather than reporting no change', () => {
    // width 0 used to make every index comparison NaN, so dirtyRect returned
    // null — "nothing changed" — for a frame that had entirely changed.
    expect(() => frame(new Uint16Array(10), 0)).toThrow(/positive integer/);
  });
});

describe('dirtyRect', () => {
  it('returns null when nothing changed', () => {
    expect(dirtyRect(blank(), blank())).toBeNull();
  });

  it('finds a single changed pixel', () => {
    const next = blank();
    next.pixels[5 * SCREEN_WIDTH + 9] = 0xf800;
    expect(dirtyRect(blank(), next)).toEqual({
      x: 9,
      y: 5,
      width: 1,
      height: 1,
    });
  });

  it('bounds two distant changes in one rect', () => {
    const next = blank();
    next.pixels[2 * SCREEN_WIDTH + 3] = 1;
    next.pixels[9 * SCREEN_WIDTH + 20] = 1;
    expect(dirtyRect(blank(), next)).toEqual({
      x: 3,
      y: 2,
      width: 18,
      height: 8,
    });
  });

  it('works at the 168-wide animation stride, not just the panel width', () => {
    // Every rendered frame in this project is 168 wide and the panel is 172.
    // A defaulted stride was wrong for every asset in the repo and produced
    // shifted pixels rather than an error.
    const stage = blank(168, 200);
    const next = frame(Uint16Array.from(stage.pixels), 168);
    next.pixels[3 * 168 + 4] = 0x07e0;
    expect(dirtyRect(stage, next)).toEqual({
      x: 4,
      y: 3,
      width: 1,
      height: 1,
    });
  });

  it('refuses mismatched strides and sizes', () => {
    expect(() => dirtyRect(blank(168, 2), blank(172, 2))).toThrow(
      /stride mismatch/,
    );
    expect(() => dirtyRect(blank(4, 1), blank(4, 3))).toThrow(/size mismatch/);
  });
});

describe('extractRect', () => {
  it('copies exactly the pixels inside the rect', () => {
    const source = frame(
      Uint16Array.from({ length: SCREEN_WIDTH * 4 }, (_, i) => i),
      SCREEN_WIDTH,
    );
    expect([
      ...extractRect(source, { x: 2, y: 1, width: 3, height: 2 }),
    ]).toEqual([
      SCREEN_WIDTH + 2,
      SCREEN_WIDTH + 3,
      SCREEN_WIDTH + 4,
      SCREEN_WIDTH * 2 + 2,
      SCREEN_WIDTH * 2 + 3,
      SCREEN_WIDTH * 2 + 4,
    ]);
  });

  it('throws on a rect that runs off the frame instead of wrapping', () => {
    // subarray clamps rather than throwing, so this used to return the next
    // row's pixels, or zero-fill — black pixels rather than an exception.
    const source = blank(172, 4);
    expect(() =>
      extractRect(source, { x: 170, y: 0, width: 5, height: 1 }),
    ).toThrow(/does not fit/);
    expect(() =>
      extractRect(source, { x: 0, y: 3, width: 1, height: 5 }),
    ).toThrow(/does not fit/);
  });
});

describe('fullScreenRect', () => {
  it('is the frame size the USB budget is argued against', () => {
    expect(rectArea(fullScreenRect()) * 2).toBe(110_080);
  });
});
