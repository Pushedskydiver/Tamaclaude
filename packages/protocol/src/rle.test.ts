import { describe, expect, it } from 'vitest';

import { decodeRect, encodeRect, RAW_MODE, RLE_MODE } from './rle.js';

const roundTrips = (pixels: Uint16Array) =>
  [...decodeRect(encodeRect(pixels), pixels.length)].every(
    (value, index) => value === pixels[index],
  );

describe('encodeRect / decodeRect', () => {
  it('round-trips a flat run', () => {
    expect(roundTrips(new Uint16Array(1000).fill(0xf800))).toBe(true);
  });

  it('round-trips noise, which falls back to raw', () => {
    const noisy = Uint16Array.from(
      { length: 1000 },
      (_, i) => (i * 37) & 0xffff,
    );
    expect(encodeRect(noisy)[0]).toBe(RAW_MODE);
    expect(roundTrips(noisy)).toBe(true);
  });

  it('round-trips the degenerate sizes', () => {
    expect(roundTrips(new Uint16Array(0))).toBe(true);
    expect(roundTrips(Uint16Array.of(0x07e0))).toBe(true);
  });

  it('splits a run longer than a u16 counter can hold', () => {
    // 0xffff is the longest single run. A full-screen flat frame is 55,040
    // pixels, so this only bites on a larger buffer — but the encoder must not
    // silently truncate, and the decoder must not think the frame ended early.
    const long = new Uint16Array(0xffff + 500).fill(0x001f);
    expect(roundTrips(long)).toBe(true);
    expect(encodeRect(long)[0]).toBe(RLE_MODE);
  });

  it('never produces more than raw plus the mode byte', () => {
    // The whole point of the raw fallback. Without it, alternating pixels cost
    // four bytes each and a frame could double on the wire.
    const worst = Uint16Array.from({ length: 2000 }, (_, i) => i % 2);
    expect(encodeRect(worst).length).toBeLessThanOrEqual(worst.length * 2 + 1);
  });

  it('compresses flat pixel art by at least 20:1', () => {
    // docs/ARCHITECTURE.md's bandwidth argument depends on compression. This
    // is the floor the wire budget needs, not the ratio we expect — see
    // tools/measure-compression.ts for what real frames actually achieve.
    const frame = new Uint16Array(168 * 200).fill(0x0882);
    frame.fill(0xde88, 5000, 9000);
    const ratio = (frame.length * 2) / encodeRect(frame).length;
    expect(ratio).toBeGreaterThan(20);
  });

  it('rejects a corrupt stream rather than returning short data', () => {
    expect(() => decodeRect(Uint8Array.of(9, 0, 0), 1)).toThrow(/unknown/);
    const truncated = encodeRect(new Uint16Array(100).fill(1));
    expect(() => decodeRect(truncated, 200)).toThrow(/expected 200/);
  });
});
