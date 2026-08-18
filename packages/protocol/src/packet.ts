/**
 * Rect packet framing.
 *
 * A frame update on the wire is a header followed by an encoded payload:
 *
 * | Offset | Size | Field |
 * | --- | --- | --- |
 * | 0 | u16 | `x` |
 * | 2 | u16 | `y` |
 * | 4 | u16 | `width` |
 * | 6 | u16 | `height` |
 * | 8 | u32 | payload length in bytes |
 * | 12 | u16 | encoding mode |
 * | 14 | u16 | reserved, zero |
 *
 * All little-endian, which is what the ESP32-C6 reads natively.
 *
 * Sixteen bytes, and the size is load-bearing. The mode started out as a byte
 * at the front of the payload, which put the first `u16` of pixel data at an
 * odd offset — a misaligned halfword read, and undefined behaviour on the
 * RISC-V core that has to decode this. Moving it into the header leaves the
 * payload pure `u16` data starting on a 16-byte boundary, so the firmware can
 * cast rather than `memcpy`. The reserved halfword exists to keep the `u32`
 * length aligned and to leave somewhere to put a flag later.
 *
 * Length is `u32` rather than `u16` because a full-screen raw payload is
 * 110,080 bytes and would overflow a 16-bit count — the one case where a
 * smaller field would have been silently wrong rather than obviously so.
 */

import type { Rect } from './geometry.js';

/** Bytes of framing per rect update, before the payload. */
export const RECT_HEADER_BYTES = 16;

/** Write a rect packet header. The payload follows immediately after. */
export function writeRectHeader(
  rect: Rect,
  payloadLength: number,
  mode: number,
): Uint8Array {
  const out = new Uint8Array(RECT_HEADER_BYTES);
  const view = new DataView(out.buffer);
  view.setUint16(0, rect.x, true);
  view.setUint16(2, rect.y, true);
  view.setUint16(4, rect.width, true);
  view.setUint16(6, rect.height, true);
  view.setUint32(8, payloadLength, true);
  view.setUint16(12, mode, true);
  return out;
}

/** Read a rect packet header back. */
export function readRectHeader(header: Uint8Array): {
  readonly rect: Rect;
  readonly payloadLength: number;
  readonly mode: number;
} {
  if (header.byteLength < RECT_HEADER_BYTES) {
    throw new Error(`rect header needs ${RECT_HEADER_BYTES} bytes`);
  }
  const view = new DataView(header.buffer, header.byteOffset);
  return {
    rect: {
      x: view.getUint16(0, true),
      y: view.getUint16(2, true),
      width: view.getUint16(4, true),
      height: view.getUint16(6, true),
    },
    payloadLength: view.getUint32(8, true),
    mode: view.getUint16(12, true),
  };
}
