import type { Framebuffer } from './framebuffer.js';

import { describe, expect, it } from 'vitest';

import { encodeRect } from '@tamaclaude/protocol';

import { LID_SLOT, logoSlot, paintLogo, PLACEHOLDER } from './logo.js';
import { loadSprite } from './sprites/index.js';

/** Base64 of a `[mode][payload]` blob, the way a pack carries one. */
function blob(words: Uint16Array): string {
  const { mode, payload } = encodeRect(words);
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = mode;
  bytes.set(payload, 1);
  return btoa(String.fromCharCode(...bytes));
}

/** A solid mark of `colour`, every pixel drawn. */
function solidLogo(width: number, height: number, colour: number) {
  const pixels = new Uint16Array(width * height).fill(colour);
  const packedBytes = new Uint8Array(Math.ceil((width * height) / 8)).fill(
    0xff,
  );
  const padded = new Uint8Array(Math.ceil(packedBytes.length / 2) * 2);
  padded.set(packedBytes);
  return {
    width,
    height,
    pixels: blob(pixels),
    mask: blob(new Uint16Array(padded.buffer)),
  };
}

const buffer = (w: number, h: number): Framebuffer => ({
  pixels: new Uint16Array(w * h).fill(0x1234),
  width: w,
  height: h,
});
const at = (fb: Framebuffer, x: number, y: number): number =>
  fb.pixels[y * fb.width + x] ?? -1;

describe('the lid slot', () => {
  it('is where the laptop lid actually is in the baked sprite', async () => {
    // **The one assertion that stops this drifting.** `LID_SLOT` is a fixed
    // rectangle in sprite coordinates, and the lid it names is drawn inside
    // `typing.svg`. Re-authoring the animation would move the lid and leave
    // the mark floating over Clawd with nothing to notice — so this reads the
    // baked frames and checks the slot is entirely laptop.
    const frames = await loadSprite('typing');
    const first = frames[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const width = first.frame.width;
    let undrawn = 0;
    for (let y = LID_SLOT.y; y < LID_SLOT.y + LID_SLOT.height; y += 1) {
      for (let x = LID_SLOT.x; x < LID_SLOT.x + LID_SLOT.width; x += 1) {
        if ((first.mask[y * width + x] ?? 0) === 0) undrawn += 1;
      }
    }
    expect(undrawn, 'every pixel of the lid slot is drawn in typing').toBe(0);
  });

  it('matches the bounds the pack schema enforces', () => {
    // `packages/packs/src/index.ts` repeats these two numbers, because that
    // package sits below this one and cannot import them. This is the test
    // that catches them disagreeing.
    expect(LID_SLOT.width).toBe(84);
    expect(LID_SLOT.height).toBe(20);
  });
});

describe('painting a pack logo', () => {
  it('centres the mark on the lid and draws only its own pixels', () => {
    const fb = buffer(320, 172);
    const logo = solidLogo(12, 14, 0xf81f);
    const painted = paintLogo(fb, { x: 0, y: -34 }, logo);

    // Centred in an 84x20 slot: (84-12)/2 = 36 across, (20-14)/2 = 3 down.
    expect(logoSlot(logo)).toEqual({ x: 78, y: 163, width: 12, height: 14 });
    expect(painted).toEqual({ x: 78, y: 129, width: 12, height: 14 });

    expect(at(fb, 78, 129)).toBe(0xf81f);
    expect(at(fb, 89, 142)).toBe(0xf81f);
    // One pixel outside on every side is untouched.
    expect(at(fb, 77, 129)).toBe(0x1234);
    expect(at(fb, 90, 129)).toBe(0x1234);
    expect(at(fb, 78, 128)).toBe(0x1234);
    expect(at(fb, 78, 143)).toBe(0x1234);
  });

  it('leaves masked-out pixels showing whatever was underneath', () => {
    const fb = buffer(320, 172);
    const logo = solidLogo(12, 14, 0xf81f);
    // Blank the mask: nothing is drawn, so the lid keeps its own pixels.
    const invisible = { ...logo, mask: blob(new Uint16Array(4)) };
    paintLogo(fb, { x: 0, y: -34 }, invisible);
    expect(at(fb, 78, 129)).toBe(0x1234);
  });

  it('treats an unreadable payload as no logo rather than throwing', () => {
    // A pack is hand-edited. The schema checks the shape of the base64 and
    // cannot check that the bytes decode to a mark of the stated size, so a
    // truncated paste arrives here. Losing the mark is survivable; taking the
    // panel down on the recipient's machine is not.
    const fb = buffer(320, 172);
    const broken = { width: 12, height: 14, pixels: 'AAAA', mask: 'AAAA' };
    expect(paintLogo(fb, { x: 0, y: -34 }, broken)).toBeNull();
    expect(at(fb, 78, 129)).toBe(0x1234);
  });
});

describe('the placeholder underneath', () => {
  it('is where the pulsing square actually is in the baked sprite', async () => {
    // The same anti-drift check `LID_SLOT` gets. This rectangle exists to
    // cover two rects in `typing.svg`, and if the artwork moves them the mark
    // stops covering them — which shows as blue through the counter of a
    // letter and nothing red anywhere.
    const frames = await loadSprite('typing');
    const width = 168;
    const varying: string[] = [];
    for (let y = LID_SLOT.y; y < LID_SLOT.y + LID_SLOT.height; y += 1) {
      for (let x = LID_SLOT.x; x < LID_SLOT.x + LID_SLOT.width; x += 1) {
        const seen = new Set(frames.map((f) => f.frame.pixels[y * width + x]));
        if (seen.size > 1) varying.push(`${String(x)},${String(y)}`);
      }
    }
    // Every pixel that changes across the loop is inside PLACEHOLDER, and
    // PLACEHOLDER is entirely made of them — so it is exactly the pulse.
    const inside = (key: string): boolean => {
      const [x = 0, y = 0] = key.split(',').map(Number);
      return (
        x >= PLACEHOLDER.x &&
        x < PLACEHOLDER.x + PLACEHOLDER.width &&
        y >= PLACEHOLDER.y &&
        y < PLACEHOLDER.y + PLACEHOLDER.height
      );
    };
    expect(varying.length).toBe(PLACEHOLDER.width * PLACEHOLDER.height);
    expect(varying.filter((key) => !inside(key))).toEqual([]);
  });

  it('is covered even by a mark smaller than it is', () => {
    // A 4x4 mark centres inside the 8x8 square and would leave a ring of blue
    // around itself if the clear were skipped when the mark is small.
    const fb = buffer(320, 172);
    // Paint the lid colour under it, then the pulse on top of that, the way
    // the sprite would.
    const origin = { x: 0, y: -34 };
    for (let y = LID_SLOT.y; y < LID_SLOT.y + LID_SLOT.height; y += 1)
      for (let x = LID_SLOT.x; x < LID_SLOT.x + LID_SLOT.width; x += 1)
        fb.pixels[(origin.y + y) * fb.width + origin.x + x] = 0x31a7;
    for (let y = PLACEHOLDER.y; y < PLACEHOLDER.y + PLACEHOLDER.height; y += 1)
      for (let x = PLACEHOLDER.x; x < PLACEHOLDER.x + PLACEHOLDER.width; x += 1)
        fb.pixels[(origin.y + y) * fb.width + origin.x + x] = 0x5d3f;

    paintLogo(fb, origin, solidLogo(4, 4, 0xf81f));

    let blue = 0;
    for (let y = PLACEHOLDER.y; y < PLACEHOLDER.y + PLACEHOLDER.height; y += 1)
      for (let x = PLACEHOLDER.x; x < PLACEHOLDER.x + PLACEHOLDER.width; x += 1)
        if (fb.pixels[(origin.y + y) * fb.width + origin.x + x] === 0x5d3f)
          blue += 1;
    expect(blue, 'no pulse showing around a small mark').toBe(0);
  });
});
