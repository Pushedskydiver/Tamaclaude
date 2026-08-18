import { describe, expect, it } from 'vitest';

import { rectArea, rgb565, SCREEN_HEIGHT, SCREEN_WIDTH } from './index.js';

describe('rgb565', () => {
  it('packs pure channels into the right bit positions', () => {
    expect(rgb565(255, 0, 0)).toBe(0xf800);
    expect(rgb565(0, 255, 0)).toBe(0x07e0);
    expect(rgb565(0, 0, 255)).toBe(0x001f);
  });

  it('maps black and white to the extremes', () => {
    expect(rgb565(0, 0, 0)).toBe(0x0000);
    expect(rgb565(255, 255, 255)).toBe(0xffff);
  });

  it('always produces a value that fits in 16 bits', () => {
    const samples = [0, 1, 7, 8, 127, 128, 254, 255];
    for (const red of samples) {
      for (const green of samples) {
        for (const blue of samples) {
          const packed = rgb565(red, green, blue);
          expect(packed).toBeGreaterThanOrEqual(0);
          expect(packed).toBeLessThanOrEqual(0xffff);
        }
      }
    }
  });
});

describe('panel geometry', () => {
  it('matches the ST7789 on the Waveshare ESP32-C6-LCD-1.47', () => {
    expect(SCREEN_WIDTH).toBe(172);
    expect(SCREEN_HEIGHT).toBe(320);
  });

  it('a full-screen rect is the frame size the USB budget assumes', () => {
    const fullScreen = {
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    };
    // 110,080 bytes at 2 bytes per pixel — the number docs/ARCHITECTURE.md
    // uses to rule out sending uncompressed full frames over USB.
    expect(rectArea(fullScreen) * 2).toBe(110_080);
  });
});
