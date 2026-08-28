import type { Framebuffer } from './framebuffer.js';

import { describe, expect, it } from 'vitest';

import { parsePackManifest } from '@tamaclaude/packs';
import { encodeRect } from '@tamaclaude/protocol';

import { paintPet, PET_SLOT } from './pet.js';

/** Base64 of a `[mode][payload]` blob, the way a pack carries one. */
function blob(words: Uint16Array): string {
  const { mode, payload } = encodeRect(words);
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = mode;
  bytes.set(payload, 1);
  return btoa(String.fromCharCode(...bytes));
}

/** A solid block of `colour`, every pixel drawn. */
function solidPet(width: number, height: number, colour: number) {
  const packed = new Uint8Array(Math.ceil((width * height) / 8)).fill(0xff);
  const padded = new Uint8Array(Math.ceil(packed.length / 2) * 2);
  padded.set(packed);
  return {
    width,
    height,
    pixels: blob(new Uint16Array(width * height).fill(colour)),
    mask: blob(new Uint16Array(padded.buffer)),
  };
}

const buffer = (w: number, h: number): Framebuffer => ({
  width: w,
  height: h,
  pixels: new Uint16Array(w * h),
});

/** The shipping landscape-hero stage band. */
const STAGE = { x: 0, y: 6, width: 168, height: 160 };
const INK = 0xf81f;

describe('painting a pack pet', () => {
  it('stands it on the bottom of the slot, not the top', () => {
    // The drawn art fills the raster to its last row, so bottom-aligning is
    // what puts its feet on the sand. A shorter sprite top-aligned would
    // float, which reads as a rendering fault rather than as a creature.
    const target = buffer(168, 172);
    const at = paintPet(target, STAGE, solidPet(8, 10, INK));
    expect(at).not.toBeNull();
    expect(at?.y).toBe(STAGE.y + PET_SLOT.y + PET_SLOT.height - 10);
    expect(at?.x).toBe(STAGE.x + PET_SLOT.x);
  });

  it('paints the pixels it was given, and nothing outside them', () => {
    const target = buffer(168, 172);
    const at = paintPet(target, STAGE, solidPet(8, 10, INK));
    expect(at).not.toBeNull();
    const drawn = [...target.pixels].filter((p) => p === INK).length;
    expect(drawn).toBe(80);
    // The row above the sprite's top-left is untouched.
    expect(target.pixels[(at!.y - 1) * target.width + at!.x]).toBe(0);
  });

  it('refuses a payload it cannot decode rather than drawing rubbish', () => {
    const target = buffer(168, 172);
    const bad = { ...solidPet(8, 10, INK), pixels: 'AAAA' };
    expect(paintPet(target, STAGE, bad)).toBeNull();
    expect([...target.pixels].every((p) => p === 0)).toBe(true);
  });

  it('clips to the stage rather than escaping into the bands below', () => {
    // `logo.ts` records a mark escaping its slot into the session strip. The
    // stage is the clip here, and a stage shorter than the slot must cut.
    const target = buffer(168, 172);
    const shallow = { x: 0, y: 6, width: 168, height: PET_SLOT.y + 4 };
    paintPet(target, shallow, solidPet(8, 10, INK));
    const belowStage = [...target.pixels].filter(
      (p, i) =>
        p === INK && Math.floor(i / target.width) >= shallow.y + shallow.height,
    ).length;
    expect(belowStage).toBe(0);
  });
});

describe('the schema bound and the slot', () => {
  const pack = (width: number, height: number) => ({
    name: 'p',
    palette: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    quips: { mapped: {}, idle: [] },
    pet: { width, height, pixels: 'AAA=', mask: 'AAA=' },
  });

  it('agree, in both directions', () => {
    // `packages/packs` sits below the renderer and cannot import `PET_SLOT`,
    // so its two numbers are a hand-made copy. This is what catches the copy
    // drifting — asserted against the slot rather than against literals, or
    // it would pass while agreeing with nothing.
    expect(() =>
      parsePackManifest(pack(PET_SLOT.width, PET_SLOT.height)),
    ).not.toThrow();
    expect(() =>
      parsePackManifest(pack(PET_SLOT.width + 1, PET_SLOT.height)),
    ).toThrow();
    expect(() =>
      parsePackManifest(pack(PET_SLOT.width, PET_SLOT.height + 1)),
    ).toThrow();
  });
});
