/**
 * RLE codec for RGB565 rectangles.
 *
 * `docs/ARCHITECTURE.md`'s bandwidth argument depends on compression, and the
 * ~14:1 figure quoted there is upstream's whole-corpus number, not ours.
 * `tools/measure-compression.ts` measures the real ratio on real frames.
 *
 * Format: a mode byte, then the payload.
 *
 * - Mode 0, raw: little-endian RGB565 words, exactly as given.
 * - Mode 1, RLE: repeated `(count: u16, value: u16)` pairs, little-endian.
 *
 * Four bytes per run means RLE loses badly on noisy input — worst case is
 * double the raw size. `encodeRect` therefore encodes both ways and emits
 * whichever is smaller, so the codec can never make a frame bigger than raw
 * plus one byte. Pixel art is nearly all flat runs, so mode 1 wins in
 * practice; the fallback exists so that a future photographic asset cannot
 * quietly blow the wire budget.
 */

/** Longest run a single `(count, value)` pair can express. */
const MAX_RUN = 0xffff;

export const RAW_MODE = 0;
export const RLE_MODE = 1;

/** RLE-encode a pixel run, without the mode byte or the raw comparison. */
function encodeRuns(pixels: Uint16Array): Uint8Array {
  const runs: number[] = [];
  let index = 0;
  while (index < pixels.length) {
    const value = pixels[index];
    let length = 1;
    while (
      index + length < pixels.length &&
      pixels[index + length] === value &&
      length < MAX_RUN
    ) {
      length += 1;
    }
    runs.push(length, value);
    index += length;
  }
  const out = new Uint8Array(runs.length * 2);
  const view = new DataView(out.buffer);
  for (const [position, word] of runs.entries()) {
    view.setUint16(position * 2, word, true);
  }
  return out;
}

function encodeRaw(pixels: Uint16Array): Uint8Array {
  const out = new Uint8Array(pixels.length * 2);
  const view = new DataView(out.buffer);
  for (const [index, value] of pixels.entries()) {
    view.setUint16(index * 2, value, true);
  }
  return out;
}

/**
 * Encode a rectangle's pixels, choosing whichever mode is smaller.
 *
 * The returned buffer starts with the mode byte, so a decoder needs nothing
 * else to read it back.
 */
export function encodeRect(pixels: Uint16Array): Uint8Array {
  const rle = encodeRuns(pixels);
  const raw = encodeRaw(pixels);
  const useRle = rle.length < raw.length;
  const body = useRle ? rle : raw;
  const out = new Uint8Array(body.length + 1);
  out[0] = useRle ? RLE_MODE : RAW_MODE;
  out.set(body, 1);
  return out;
}

/** Decode a buffer produced by `encodeRect` back to pixels. */
export function decodeRect(
  encoded: Uint8Array,
  pixelCount: number,
): Uint16Array {
  const mode = encoded[0];
  const view = new DataView(
    encoded.buffer,
    encoded.byteOffset + 1,
    encoded.byteLength - 1,
  );
  const out = new Uint16Array(pixelCount);

  if (mode === RAW_MODE) {
    for (let index = 0; index < pixelCount; index += 1) {
      out[index] = view.getUint16(index * 2, true);
    }
    return out;
  }
  if (mode !== RLE_MODE) throw new Error(`unknown encoding mode ${mode}`);

  let written = 0;
  for (let offset = 0; offset + 3 < view.byteLength; offset += 4) {
    const count = view.getUint16(offset, true);
    const value = view.getUint16(offset + 2, true);
    if (written + count > pixelCount) {
      throw new Error(`RLE overruns ${pixelCount} pixels`);
    }
    out.fill(value, written, written + count);
    written += count;
  }
  if (written !== pixelCount) {
    throw new Error(`RLE produced ${written} pixels, expected ${pixelCount}`);
  }
  return out;
}
