import { describe, expect, it } from 'vitest';

import { encodeRect } from '@tamaclaude/protocol';

import { COVER_SLOT, paintCover } from './cover.js';
import { createFramebuffer } from './framebuffer.js';

/** Base64 of a `[mode][payload]` blob, the way a pack carries one. */
function blob(words: Uint16Array): string {
  const { mode, payload } = encodeRect(words);
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = mode;
  bytes.set(payload, 1);
  return btoa(String.fromCharCode(...bytes));
}

/** A solid block of `colour`, every pixel drawn. */
function solidScene(width: number, height: number, colour: number) {
  const count = width * height;
  return {
    width,
    height,
    pixels: blob(new Uint16Array(count).fill(colour)),
    mask: blob(new Uint16Array(Math.ceil(count / 16)).fill(0xffff)),
  };
}

const STAGE = { x: 2, y: 6, width: 168, height: 160 };
const INK = 0xf81f;

describe('paintCover', () => {
  it('centres a scene smaller than the stage', () => {
    // **Centred, unlike the pet, and the difference is what each one is.** The
    // pet stands on the sand, so it is bottom-aligned or it floats. This
    // covers the stage, so anything less than the full raster belongs in the
    // middle of what it is covering — anchoring it to a corner would read as
    // a picture that failed to load rather than as a small picture.
    const at = paintCover(createFramebuffer(), STAGE, solidScene(68, 60, INK));
    expect(at).not.toBeNull();
    expect(at?.x).toBe(STAGE.x + (168 - 68) / 2);
    expect(at?.y).toBe(STAGE.y + (160 - 60) / 2);
  });

  it('takes the whole stage when the scene fills it', () => {
    const at = paintCover(
      createFramebuffer(),
      STAGE,
      solidScene(168, 160, INK),
    );
    expect(at).toEqual(STAGE);
  });

  it('agrees with the bounds the pack schema enforces', () => {
    // `packages/packs` sits below the renderer and cannot import this, so its
    // `scene` field repeats 168x160 as literals. This is the assertion that
    // catches them drifting apart — the same guard `pet.test.ts` carries, and
    // the reason that field's comment names this constant.
    expect(COVER_SLOT.width).toBe(168);
    expect(COVER_SLOT.height).toBe(160);
  });

  it('reports null rather than nothing when the payload will not decode', () => {
    // The contract `paintLogo` and `paintPet` both have: a pack that looks
    // configured and silently shows nothing is the fault this boundary exists
    // to name. The caller has to be able to tell "no scene" from "a scene that
    // would not decode", because only one of them is a bug.
    const broken = { ...solidScene(16, 16, INK), pixels: 'AAA=' };
    expect(paintCover(createFramebuffer(), STAGE, broken)).toBeNull();
  });
});
