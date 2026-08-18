import { describe, expect, it } from 'vitest';

import { fullScreenRect } from './dirty-rect.js';
import { rectArea } from './geometry.js';
import {
  readRectHeader,
  RECT_HEADER_BYTES,
  writeRectHeader,
} from './packet.js';

describe('rect packet header', () => {
  it('round-trips a rect and its payload length', () => {
    const rect = { x: 7, y: 219, width: 96, height: 96 };
    const header = writeRectHeader(rect, 1234, 1);
    expect(header.byteLength).toBe(RECT_HEADER_BYTES);
    expect(readRectHeader(header)).toEqual({
      rect,
      payloadLength: 1234,
      mode: 1,
    });
  });

  it('holds a full-screen raw payload, which a u16 length could not', () => {
    // 110,080 bytes — a full-screen raw payload. This is why the length
    // field is u32; a u16 would have wrapped to 44,544 silently.
    const worst = rectArea(fullScreenRect()) * 2;
    expect(worst).toBeGreaterThan(0xffff);
    expect(
      readRectHeader(writeRectHeader(fullScreenRect(), worst, 0)).payloadLength,
    ).toBe(worst);
  });

  it('refuses a short header rather than reading past the end', () => {
    expect(() => readRectHeader(new Uint8Array(4))).toThrow(/needs 16 bytes/);
  });
});
