/**
 * RLE codec for RGB565 rectangles.
 *
 * `docs/ARCHITECTURE.md`'s bandwidth argument depends on compression.
 * `tools/measure-compression.ts` measures the real ratio on real frames, and
 * that document quotes those measurements.
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

/**
 * The blitter has these numbers too, in
 * `packages/device/firmware/blitter/main/main.c`, and validates against them
 * while hunting for a header. Adding a mode here without adding it there
 * produces packets the device rejects as noise: it resyncs, the host re-primes
 * forever, and the panel holds a stale frame with no error on either side.
 */
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

export type Encoded = {
  readonly mode: number;
  readonly payload: Uint8Array;
};

/** Encode a rectangle's pixels, choosing whichever mode is smaller. */
export function encodeRect(pixels: Uint16Array): Encoded {
  const rle = encodeRuns(pixels);
  const raw = encodeRaw(pixels);
  return rle.length < raw.length
    ? { mode: RLE_MODE, payload: rle }
    : { mode: RAW_MODE, payload: raw };
}

function decodeRaw(view: DataView, pixelCount: number): Uint16Array {
  // Raw used to read pixelCount words and ignore the rest, so a payload that
  // disagreed with the header decoded short and rendered subtly wrong — while
  // the RLE path threw on the same corruption. One fault, one behaviour.
  if (view.byteLength !== pixelCount * 2) {
    throw new Error(
      `raw payload is ${view.byteLength} bytes, expected ${pixelCount * 2}`,
    );
  }
  const out = new Uint16Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    out[index] = view.getUint16(index * 2, true);
  }
  return out;
}

function decodeRuns(view: DataView, pixelCount: number): Uint16Array {
  if (view.byteLength % 4 !== 0) {
    throw new Error(
      `RLE payload of ${view.byteLength} bytes is not whole runs`,
    );
  }
  const out = new Uint16Array(pixelCount);
  let written = 0;
  for (let offset = 0; offset < view.byteLength; offset += 4) {
    const count = view.getUint16(offset, true);
    const value = view.getUint16(offset + 2, true);
    if (count === 0) throw new Error('RLE run of length zero');
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

/** Decode a payload produced by `encodeRect` back to pixels. */
export function decodeRect(encoded: Encoded, pixelCount: number): Uint16Array {
  const view = new DataView(
    encoded.payload.buffer,
    encoded.payload.byteOffset,
    encoded.payload.byteLength,
  );
  if (encoded.mode === RAW_MODE) return decodeRaw(view, pixelCount);
  if (encoded.mode === RLE_MODE) return decodeRuns(view, pixelCount);
  throw new Error(`unknown encoding mode ${encoded.mode}`);
}
