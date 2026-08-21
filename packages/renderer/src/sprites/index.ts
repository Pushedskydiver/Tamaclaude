/**
 * Clawd, as frames the panel can show.
 *
 * `tools/svg2frames.ts` rasterises an animation into `out/<name>` and
 * `tools/bake-sprites.ts` turns that into a generated module beside this one.
 * This is the other end: it turns those strings back into the `StageSprite` a
 * scene wants. Nothing outside this directory should read the generated data.
 *
 * **Loaded on demand, and that is the point.** All six animations together are
 * about 1.1 MB of encoded data and roughly 3.5 MB of source; every consumer of
 * `@tamaclaude/renderer` would pay to parse all of it on import if the barrel
 * pulled them in eagerly. A dynamic import means a daemon showing `idle` parses
 * `idle` and nothing else, and an animation nobody reaches costs nothing at all.
 *
 * The imports are a table of thunks rather than one template literal, which is
 * what a bundler needs — Vite rejects `import(\`./${name}.js\`)` outright as an
 * "unknown variable dynamic import" — and what lets `knip` see that the
 * generated modules are used at all. `tools/bake-sprites.ts` writes this table
 * along with the data, so adding an animation is one command.
 *
 * The cache is a `Map` rather than a binding: it is added to and never
 * reassigned, which is the shape `socket-server.ts`'s `#connections` already
 * uses and which `docs/CONVENTIONS.md` §"Holding mutable state" does not spend
 * a disable on.
 */
import type { Frame } from '@tamaclaude/protocol';

import { Buffer } from 'node:buffer';

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
  'gym',
  'idle',
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
  gym: () => import('./gym.data.js'),
  idle: () => import('./idle.data.js'),
  thinking: () => import('./thinking.data.js'),
  typing: () => import('./typing.data.js'),
};

const loaded = new Map<SpriteName, readonly Sprite[]>();

/** A mode byte, then the payload — the shape `bake-sprites.ts` writes. */
function decode(blob: string, words: number): Uint16Array {
  const bytes = Buffer.from(blob, 'base64');
  const mode = bytes[0];
  if (mode === undefined) throw new Error('empty sprite frame');
  return decodeRect(
    {
      mode,
      payload: new Uint8Array(
        bytes.buffer,
        bytes.byteOffset + 1,
        bytes.byteLength - 1,
      ),
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
