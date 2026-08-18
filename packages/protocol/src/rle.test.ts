import { describe, expect, it } from 'vitest';

import { decodeRect, encodeRect, RAW_MODE, RLE_MODE } from './rle.js';

const roundTrips = (pixels: Uint16Array) =>
  [...decodeRect(encodeRect(pixels), pixels.length)].every(
    (value, index) => value === pixels[index],
  );

const encodedBytes = (pixels: Uint16Array) =>
  encodeRect(pixels).payload.byteLength;

/**
 * A frame shaped like the ones this project actually sends: a flat background
 * with a detailed sprite in it. The earlier version of the ratio test used a
 * three-run buffer and asserted `> 20` against a result of 5,169:1 — it passed
 * by a factor of 258 and could not have failed.
 */
function spriteLikeFrame(): Uint16Array {
  const width = 168;
  const height = 200;
  const pixels = new Uint16Array(width * height).fill(0x0882);
  for (let y = 60; y < 160; y += 1) {
    for (let x = 20; x < 148; x += 1) {
      // 8px blocks with a scatter of single-pixel detail, which is what puts
      // real run lengths in the tens rather than the thousands.
      const block = (Math.trunc(x / 8) + Math.trunc(y / 8)) % 3;
      const speckle = (x * 7 + y * 13) % 29 === 0;
      pixels[y * width + x] = speckle ? 0x0000 : block === 0 ? 0xde88 : 0xf7be;
    }
  }
  return pixels;
}

describe('encodeRect / decodeRect', () => {
  it('round-trips a flat run', () => {
    expect(roundTrips(new Uint16Array(1000).fill(0xf800))).toBe(true);
  });

  it('round-trips noise, which falls back to raw', () => {
    const noisy = Uint16Array.from(
      { length: 1000 },
      (_, i) => (i * 37) & 0xffff,
    );
    expect(encodeRect(noisy).mode).toBe(RAW_MODE);
    expect(roundTrips(noisy)).toBe(true);
  });

  it('round-trips the degenerate sizes', () => {
    expect(roundTrips(new Uint16Array(0))).toBe(true);
    expect(roundTrips(Uint16Array.of(0x07e0))).toBe(true);
  });

  it('splits a run longer than a u16 counter can hold', () => {
    const long = new Uint16Array(0xffff + 500).fill(0x001f);
    expect(roundTrips(long)).toBe(true);
    expect(encodeRect(long).mode).toBe(RLE_MODE);
  });

  it('never produces more than raw', () => {
    const worst = Uint16Array.from({ length: 2000 }, (_, i) => i % 2);
    expect(encodedBytes(worst)).toBeLessThanOrEqual(worst.length * 2);
  });

  it('compresses a dense sprite frame between 5:1 and 15:1', () => {
    // Bounded on both sides deliberately. A floor alone passes for any
    // non-broken codec; the ceiling is what catches the test buffer drifting
    // into something too flat to mean anything — the version this replaced
    // asserted > 20 against a three-run buffer that scored 5,169:1.
    //
    // This frame is far denser than anything the panel actually sends: every
    // pixel of a 128x100 region is speckled. Real animations measure 42:1 to
    // 120:1, because a real dirty rect is mostly flat background. 8:1 here is
    // the codec working on close to its worst realistic input.
    const frame = spriteLikeFrame();
    const ratio = (frame.length * 2) / encodedBytes(frame);
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(15);
    expect(roundTrips(frame)).toBe(true);
  });

  it('rejects every shape of corrupt stream, in both modes', () => {
    expect(() =>
      decodeRect({ mode: 9, payload: new Uint8Array(2) }, 1),
    ).toThrow(/unknown/);
    // Raw used to decode short and silently: four pixels of payload read as
    // two, rendering a subtly wrong image where RLE would have thrown.
    expect(() =>
      decodeRect({ mode: RAW_MODE, payload: Uint8Array.of(1, 0, 2, 0) }, 1),
    ).toThrow(/raw payload is 4 bytes/);
    expect(() =>
      decodeRect(encodeRect(new Uint16Array(100).fill(1)), 200),
    ).toThrow(/expected 200/);
    expect(() =>
      decodeRect({ mode: RLE_MODE, payload: Uint8Array.of(5, 0, 1, 0, 7) }, 5),
    ).toThrow(/whole runs/);
    expect(() =>
      decodeRect({ mode: RLE_MODE, payload: Uint8Array.of(0, 0, 1, 0) }, 5),
    ).toThrow(/length zero/);
    expect(() =>
      decodeRect({ mode: RLE_MODE, payload: Uint8Array.of(9, 0, 1, 0) }, 5),
    ).toThrow(/overruns/);
  });
});
