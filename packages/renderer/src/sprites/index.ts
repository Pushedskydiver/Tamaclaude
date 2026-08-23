/**
 * Clawd, as frames the panel can show.
 *
 * `tools/svg2frames.ts` rasterises an animation into `out/<name>` and
 * `tools/bake-sprites.ts` turns that into a generated module beside this one.
 * This is the other end: it turns those strings back into the `StageSprite` a
 * scene wants. Nothing outside this directory should
 * read the generated data, with one recorded exception:
 * `tools/bake-sprites.test.ts` imports each module's `SOURCE` stamp to check
 * the bake still matches its SVG, which is a property no consumer of the
 * pixels can see.
 *
 * **Loaded on demand, and that is the point.** All ten animations together are
 * 1,918,964 bytes of encoded data and 2,581,059 of source — base64 is four
 * bytes for three, so the second number can only ever be about a third above
 * the first. (It read six, 1,128,216 and 1,515,153 until `permission-sign`,
 * `confused` and `dizzy` landed; only a re-bake refreshes these, so treat them
 * as of the last one.) Every consumer of `@tamaclaude/renderer` would pay to parse all of
 * it on import if the barrel pulled them in eagerly. A dynamic import means a
 * daemon showing `idle` parses `idle` and nothing else, and an animation nobody
 * reaches costs nothing at all.
 *
 * The imports are a table of thunks rather than one template literal because
 * `knip` cannot follow one: with a template literal it reports every
 * generated module as an unused file and fails the gate. Measured. Vite is not
 * the reason — an earlier version of this comment said it rejects the template
 * literal outright, and it does not; it compiles it into a glob map of exactly
 * this shape. `tools/bake-sprites.ts` writes this table along with the data, so
 * adding an animation is one command.
 *
 * The cache is a `Map`, added to and never reassigned. No budget is being spent
 * on that and none could be: `eslint.config.ts` turns the four functional rules
 * off for `packages/renderer/src/**`, because a framebuffer cannot be written
 * without mutation. `docs/CONVENTIONS.md` §"Holding mutable state" governs the
 * packages where they are *on*, and an earlier version of this comment cited it
 * as permission it is not in a position to give.
 */
import type { Frame } from '@tamaclaude/protocol';

import { decodeRect, frame } from '@tamaclaude/protocol';

/**
 * Every animation that has been baked.
 *
 * Named here rather than discovered, because a directory listing is not
 * something a bundled package can do and because an animation that exists but
 * is not listed should be a type error at its call site rather than a miss at
 * run time.
 */
export const SPRITE_NAMES = [
  'asleep',
  'bouldering',
  'confused',
  'dizzy',
  'gym',
  'idle',
  'overheated',
  'permission-sign',
  'thinking',
  'typing',
] as const;

export type SpriteName = (typeof SPRITE_NAMES)[number];

/** One frame of an animation: its pixels, and which of them are drawn. */
export type Sprite = {
  readonly frame: Frame;
  /** 1 where the pixel is drawn, 0 where the background shows through. */
  readonly mask: Uint8Array;
};

type Baked = {
  readonly WIDTH: number;
  readonly HEIGHT: number;
  readonly PIXELS: readonly string[];
  readonly MASKS: readonly string[];
};

const SOURCES: Readonly<Record<SpriteName, () => Promise<Baked>>> = {
  asleep: () => import('./asleep.data.js'),
  bouldering: () => import('./bouldering.data.js'),
  confused: () => import('./confused.data.js'),
  dizzy: () => import('./dizzy.data.js'),
  gym: () => import('./gym.data.js'),
  idle: () => import('./idle.data.js'),
  overheated: () => import('./overheated.data.js'),
  'permission-sign': () => import('./permission-sign.data.js'),
  thinking: () => import('./thinking.data.js'),
  typing: () => import('./typing.data.js'),
};

const loaded = new Map<SpriteName, readonly Sprite[]>();

/** A mode byte, then the payload — the shape `bake-sprites.ts` writes. */
function decode(blob: string, words: number): Uint16Array {
  // `atob` rather than `Buffer`, because this package had no `node:` import
  // before the sprites arrived and `BUILD_PLAN.md` Stage 1's open exit is
  // bundling this renderer for the browser so both ends call one function. A
  // bare `node:buffer` in the barrel's graph would make that need a polyfill.
  const binary = atob(blob);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const mode = bytes[0];
  if (mode === undefined) throw new Error('empty sprite frame');
  return decodeRect(
    {
      mode,
      payload: bytes.subarray(1),
    },
    words,
  );
}

/**
 * The packed mask, back to one byte per pixel.
 *
 * `drawFrame` wants a byte per pixel and the wire wants a bit, so the expansion
 * happens here rather than in the renderer — the renderer should not have to
 * know that the data it is given was ever packed.
 */
function unpack(words: Uint16Array, pixels: number): Uint8Array {
  const packed = new Uint8Array(
    words.buffer,
    words.byteOffset,
    words.byteLength,
  );
  const out = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const byte = packed[index >> 3] ?? 0;
    out[index] = (byte & (0x80 >> (index & 7))) === 0 ? 0 : 1;
  }
  return out;
}

function rebuild(baked: Baked): readonly Sprite[] {
  const pixels = baked.WIDTH * baked.HEIGHT;
  // The encoder padded an odd-length packed mask to an even one, so the word
  // count has to match what it wrote rather than what the pixels imply.
  const maskWords = Math.ceil(Math.ceil(pixels / 8) / 2);
  return baked.PIXELS.map((blob, index) => {
    const mask = baked.MASKS[index];
    if (mask === undefined) throw new Error('a frame has pixels but no mask');
    return {
      frame: frame(decode(blob, pixels), baked.WIDTH),
      mask: unpack(decode(mask, maskWords), pixels),
    };
  });
}

/**
 * The stored blobs for one animation, for the round-trip gate.
 *
 * Exported for `index.test.ts` and nothing else. The encode/decode pair here is
 * a second codec layered on `@tamaclaude/protocol` — MSB-first bit packing, an
 * even-byte pad, then `encodeRect` — and a mistake in it is silent: a review
 * flipped the bit order and byte-swapped every pixel and the whole renderer
 * suite stayed green. The gate needs the source blobs to compare against.
 */
export async function rawSprite(name: SpriteName): Promise<{
  readonly WIDTH: number;
  readonly HEIGHT: number;
  readonly PIXELS: readonly string[];
  readonly MASKS: readonly string[];
}> {
  return SOURCES[name]();
}

/**
 * Every frame of one animation, in play order.
 *
 * Cached, because a daemon asks for the same animation eight times a second and
 * decoding 128 frames of `idle` on each of them would be the whole frame budget
 * spent on work already done.
 */
export async function loadSprite(name: SpriteName): Promise<readonly Sprite[]> {
  const already = loaded.get(name);
  if (already !== undefined) return already;
  const baked = await SOURCES[name]();
  const frames = rebuild(baked);
  loaded.set(name, frames);
  return frames;
}
