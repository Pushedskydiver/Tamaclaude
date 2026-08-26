/**
 * Turning a baked base64 blob back into pixels.
 *
 * Extracted from `sprites/index.ts` when the pack logo needed the same two
 * steps. Both store the identical thing — a mode byte, then an `encodeRect`
 * payload — and a second hand-rolled copy of a codec's framing is how the two
 * drift apart with no test to notice.
 */

import { decodeRect } from '@tamaclaude/protocol';

/**
 * A `[mode byte][payload]` blob as RGB565 words.
 *
 * `atob` rather than `Buffer`, because this package has no `node:` import and
 * `BUILD_PLAN.md` Stage 1's open exit is bundling this renderer for the
 * browser. A bare `node:buffer` in the barrel's graph would need a polyfill.
 */
export function decodeBlob(blob: string, words: number): Uint16Array {
  const bytes = Uint8Array.from(atob(blob), (char) => char.charCodeAt(0));
  const mode = bytes[0];
  if (mode === undefined) throw new Error('empty blob');
  return decodeRect({ mode, payload: bytes.subarray(1) }, words);
}

/** One byte per pixel — 1 drawn, 0 transparent — from packed mask bits. */
export function unpackMask(packed: Uint16Array, pixels: number): Uint8Array {
  const bytes = new Uint8Array(
    packed.buffer,
    packed.byteOffset,
    packed.byteLength,
  );
  const out = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const byte = bytes[index >> 3] ?? 0;
    out[index] = (byte & (0x80 >> (index & 7))) === 0 ? 0 : 1;
  }
  return out;
}

/**
 * Words a packed mask occupies.
 *
 * The encoder padded an odd-length packed mask to an even one, so the count
 * has to match what it wrote rather than what the pixels imply.
 */
export function maskWords(pixels: number): number {
  return Math.ceil(Math.ceil(pixels / 8) / 2);
}
