import { describe, expect, it } from 'vitest';

import { dirtyRect, extractRect, fullScreenRect } from './dirty-rect.js';
import { rectArea } from './geometry.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

const blank = () => new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT);

describe('dirtyRect', () => {
  it('returns null when nothing changed', () => {
    expect(dirtyRect(blank(), blank())).toBeNull();
  });

  it('finds a single changed pixel', () => {
    const next = blank();
    next[5 * SCREEN_WIDTH + 9] = 0xf800;
    expect(dirtyRect(blank(), next)).toEqual({
      x: 9,
      y: 5,
      width: 1,
      height: 1,
    });
  });

  it('bounds two distant changes in one rect', () => {
    const next = blank();
    next[2 * SCREEN_WIDTH + 3] = 1;
    next[9 * SCREEN_WIDTH + 20] = 1;
    expect(dirtyRect(blank(), next)).toEqual({
      x: 3,
      y: 2,
      width: 18,
      height: 8,
    });
  });

  it('refuses mismatched frames rather than reading past the end', () => {
    expect(() => dirtyRect(new Uint16Array(4), new Uint16Array(9))).toThrow(
      /size mismatch/,
    );
  });
});

describe('extractRect', () => {
  it('copies exactly the pixels inside the rect', () => {
    const frame = Uint16Array.from({ length: SCREEN_WIDTH * 4 }, (_, i) => i);
    const rect = { x: 2, y: 1, width: 3, height: 2 };
    expect([...extractRect(frame, rect)]).toEqual([
      SCREEN_WIDTH + 2,
      SCREEN_WIDTH + 3,
      SCREEN_WIDTH + 4,
      SCREEN_WIDTH * 2 + 2,
      SCREEN_WIDTH * 2 + 3,
      SCREEN_WIDTH * 2 + 4,
    ]);
  });
});

describe('fullScreenRect', () => {
  it('is the frame size the USB budget is argued against', () => {
    // 110,080 bytes — the number docs/ARCHITECTURE.md uses to rule out
    // sending uncompressed full frames over a 12 Mbps link.
    expect(rectArea(fullScreenRect()) * 2).toBe(110_080);
    expect(fullScreenRect()).toEqual({
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    });
  });
});
