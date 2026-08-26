import type { Framebuffer } from './framebuffer.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Rect } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import { parsePackManifest } from '@tamaclaude/packs';
import { encodeRect } from '@tamaclaude/protocol';

import { LID_SLOT, logoSlot, paintLogo, PLACEHOLDER } from './logo.js';
import { render } from './scene.js';
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

/** The shipping landscape-hero placement: origin and the slot it clips to. */
const HERO = {
  origin: { x: 0, y: -34 },
  within: { x: 0, y: 6, width: 168, height: 160 },
};

const buffer = (w: number, h: number): Framebuffer => ({
  pixels: new Uint16Array(w * h).fill(0x1234),
  width: w,
  height: h,
});
const at = (fb: Framebuffer, x: number, y: number): number =>
  fb.pixels[y * fb.width + x] ?? -1;

/** What is in the lid slot on one frame: how many colours, and any gaps. */
function censusOfSlot(sprite: Awaited<ReturnType<typeof loadSprite>>[number]): {
  readonly undrawn: number;
  readonly seen: Map<number, number>;
} {
  const width = sprite.frame.width;
  const seen = new Map<number, number>();
  let undrawn = 0;
  for (let y = LID_SLOT.y; y < LID_SLOT.y + LID_SLOT.height; y += 1) {
    for (let x = LID_SLOT.x; x < LID_SLOT.x + LID_SLOT.width; x += 1) {
      const at = y * width + x;
      if ((sprite.mask[at] ?? 0) === 0) undrawn += 1;
      const colour = sprite.frame.pixels[at] ?? -1;
      seen.set(colour, (seen.get(colour) ?? 0) + 1);
    }
  }
  return { undrawn, seen };
}

describe('the lid slot', () => {
  it('is a flat panel of laptop on every frame, not part of Clawd', async () => {
    // **The assertion that stops this drifting**, and it took two goes. The
    // first version checked only that every pixel of the slot was *drawn* —
    // `mask === 1` — which a review falsified by shifting the rectangle twenty
    // rows up onto Clawd's body, where every pixel is also drawn. It passed.
    //
    // What actually distinguishes the lid is that it is flat: one colour over
    // almost all of it, plus the small pulsing square. Clawd's body in the same
    // rectangle carries his shell, his eyes and the gaps between his legs. So
    // this counts distinct colours, and pins how flat the slot is, on every
    // frame rather than the first.
    //
    // **Two assertions, because neither covers the range alone.** Measured at
    // the real slot and at four shifts: y 160 gives 2 colours, y 150 gives 4-5,
    // y 140 gives 3 — so the colour count catches the twenty-rows-up case by
    // one colour, not by a wide margin. At y 130 it gives 2, exactly like the
    // lid, and only the flatness share separates them (0.867 against the 0.9
    // gate). An earlier comment here said a rectangle over the crab has "five
    // or more", which is true of one shift and not the others.
    const frames = await loadSprite('typing');
    expect(frames.length).toBeGreaterThan(0);
    const area = LID_SLOT.width * LID_SLOT.height;
    for (const [index, sprite] of frames.entries()) {
      const { undrawn, seen } = censusOfSlot(sprite);
      expect(undrawn, `frame ${String(index)}: every slot pixel is drawn`).toBe(
        0,
      );
      // The lid and one shade of the pulse. A rectangle over the crab has
      // five or more.
      expect(
        seen.size,
        `frame ${String(index)}: distinct colours`,
      ).toBeLessThanOrEqual(2);
      expect(
        Math.max(...seen.values()) / area,
        `frame ${String(index)}: the slot is mostly one flat colour`,
      ).toBeGreaterThan(0.9);
    }
  });

  it('is exactly what the pack schema will accept', () => {
    // `packages/packs` repeats these two numbers because it sits below this
    // package and cannot import them. An earlier version of this test pinned
    // `LID_SLOT` against its own literals and claimed to catch the two
    // disagreeing — it could not, because it never touched the schema. This
    // package *can* import `packs`, so it asserts the relation directly: a
    // mark the size of the slot parses, and one pixel more on either axis does
    // not.
    const base = {
      name: 'p',
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      quips: { mapped: {}, idle: [] },
    };
    const logo = (width: number, height: number) => ({
      ...base,
      logo: { width, height, pixels: 'AAA=', mask: 'AAA=' },
    });
    expect(() =>
      parsePackManifest(logo(LID_SLOT.width, LID_SLOT.height)),
    ).not.toThrow();
    expect(() =>
      parsePackManifest(logo(LID_SLOT.width + 1, LID_SLOT.height)),
    ).toThrow();
    expect(() =>
      parsePackManifest(logo(LID_SLOT.width, LID_SLOT.height + 1)),
    ).toThrow();
  });
});

describe('painting a pack logo', () => {
  it('centres the mark on the lid and draws only its own pixels', () => {
    const fb = buffer(320, 172);
    const logo = solidLogo(12, 14, 0xf81f);
    const painted = paintLogo(fb, HERO, logo);

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
    // **The word count matters, and the first version got it wrong.** `read()`
    // asks `decodeBlob` for `maskWords(168)` = 11 words; a 4-word blob makes
    // `decodeRect` throw, `read` return null, and `paintLogo` draw nothing —
    // so the assertion below passed while testing the null path instead of the
    // mask, duplicating the next test exactly. A review caught it.
    const words = Math.ceil(Math.ceil((logo.width * logo.height) / 8) / 2);
    const invisible = { ...logo, mask: blob(new Uint16Array(words)) };
    // Prove the payload is readable before asserting nothing was drawn —
    // otherwise this passes on the null path again, which is the exact fault
    // being repaired and which a bad `words` would silently reintroduce.
    expect(paintLogo(buffer(320, 172), HERO, invisible)).not.toBeNull();
    paintLogo(fb, HERO, invisible);
    expect(at(fb, 78, 129)).toBe(0x1234);
  });

  it('draws nothing when the slot does not contain the lid', () => {
    // `twoUp` gives each sprite an 80px slot, and the lid lives at sprite
    // y 160-179 — so the lid is never rendered and a mark positioned from
    // `LID_SLOT` would land over the session strip, or off the panel. The
    // clip is what stops it. Latent today because the daemon only asks for
    // `hero`, and found by evaluating the other three combinations rather than
    // the one that ships.
    // **Portrait two-up, and the orientation matters to what this proves.** In
    // landscape the mark lands at y 189 on a 172-tall panel — two-up's crop is
    // 20, not hero's 34, which an earlier version of this comment used to get
    // 175 — so the framebuffer bounds stop it and the clip is never exercised.
    // A mutant that removed the clip passed a test written that way. Portrait
    // is 320
    // tall and the mark lands at y 237, comfortably on the panel and 63 pixels
    // below the slot it belongs to. Only the clip stops that one.
    const fb = buffer(172, 320);
    const twoUp = {
      origin: { x: 2, y: 74 },
      within: { x: 2, y: 74, width: 84, height: 100 },
    };
    const painted = paintLogo(fb, twoUp, solidLogo(12, 14, 0xf81f));

    // It still reports where the mark belongs — the caller may want to know —
    // but not one pixel of it reached the panel.
    expect(painted).toEqual({ x: 80, y: 237, width: 12, height: 14 });
    expect([...fb.pixels].filter((v) => v === 0xf81f)).toEqual([]);
  });

  it('treats an unreadable payload as no logo rather than throwing', () => {
    // A pack is hand-edited. The schema checks the shape of the base64 and
    // cannot check that the bytes decode to a mark of the stated size, so a
    // truncated paste arrives here. Losing the mark is survivable; taking the
    // panel down on the recipient's machine is not.
    const fb = buffer(320, 172);
    const broken = { width: 12, height: 14, pixels: 'AAAA', mask: 'AAAA' };
    expect(paintLogo(fb, HERO, broken)).toBeNull();
    expect(at(fb, 78, 129)).toBe(0x1234);
  });
});

/** A framebuffer with the lid painted, and the pulse on top, as the sprite would. */
function lidUnder(origin: {
  readonly x: number;
  readonly y: number;
}): Framebuffer {
  const fb: Framebuffer = {
    pixels: new Uint16Array(320 * 172).fill(0x1234),
    width: 320,
    height: 172,
  };
  const fill = (rect: Rect, colour: number): void => {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        fb.pixels[(origin.y + y) * fb.width + origin.x + x] = colour;
      }
    }
  };
  fill(LID_SLOT, 0x31a7);
  fill(PLACEHOLDER, 0x5d3f);
  return fb;
}

/** The pulsing square after a mark went on: pulse left, and wrong ground. */
function censusOfPlaceholder(
  fb: Framebuffer,
  origin: { readonly x: number; readonly y: number },
  mark: Rect,
): { readonly blue: number; readonly wrongGround: number } {
  let blue = 0;
  let wrongGround = 0;
  for (let y = PLACEHOLDER.y; y < PLACEHOLDER.y + PLACEHOLDER.height; y += 1) {
    for (let x = PLACEHOLDER.x; x < PLACEHOLDER.x + PLACEHOLDER.width; x += 1) {
      const seen = fb.pixels[(origin.y + y) * fb.width + origin.x + x];
      if (seen === 0x5d3f) blue += 1;
      const inMark =
        x >= mark.x &&
        x < mark.x + mark.width &&
        y >= mark.y &&
        y < mark.y + mark.height;
      if (!inMark && seen !== 0x31a7) wrongGround += 1;
    }
  }
  return { blue, wrongGround };
}

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
    const origin = { x: 0, y: -34 };
    const fb = lidUnder(origin);

    paintLogo(
      fb,
      { origin, within: { x: 0, y: 6, width: 168, height: 160 } },
      solidLogo(4, 4, 0xf81f),
    );

    // Outside the mark the clear must have left the *lid* colour. `mark` is
    // derived from `logoSlot`, not written down: a 4x4 centres at x 82, and
    // hardcoding 80 made this fail by exactly the 8-pixel overlap.
    const mark = logoSlot({ width: 4, height: 4 });
    const { blue, wrongGround } = censusOfPlaceholder(fb, origin, mark);

    expect(blue, 'no pulse showing around a small mark').toBe(0);
    // **Asserting the replacement, not just the removal.** The first version
    // counted only how many pulse-coloured pixels survived, so any colour at
    // all passed — including the buffer's own filler. A review moved
    // `LID_SAMPLE` thirty pixels off the lid, where the sprite is transparent,
    // and nothing noticed: on a real panel that fills the square with whatever
    // the sky painted there.
    expect(wrongGround, 'the cleared square is the lid colour').toBe(0);
  });
});

describe('a logo through render', () => {
  // **The composition, which `paintLogo` tests cannot reach.** Everything
  // above builds a framebuffer by hand and calls the painter directly, so the
  // arithmetic that connects a `Scene` to the lid — the slot and the safe-area
  // crop — is exercised nowhere.
  //
  // **What is still not covered is `scene.ts`'s `index === 0`**, and it cannot
  // be from here: hero has one slot, and two-up clips the lid away on both, so
  // deleting the guard changes no pixel in any layout that exists. A review
  // deleted it and all 618 tests stayed green — twice, once before these tests
  // and once after. `scene.ts` says as much on the line itself. This file used
  // to claim otherwise in its title, which is the worse of the two failures:
  // an untested guard is a gap, an untested guard advertised as tested is a
  // gap nobody looks for.
  const PACK: PackManifest = {
    name: 'test',
    palette: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    quips: { mapped: {}, idle: [] },
  };
  const base = {
    orientation: 'landscape' as const,
    layout: 'hero' as const,
    pack: PACK,
    status: { left: '', right: '' },
    sessions: [],
    message: '',
  };
  const MARK = 0xf81f;

  it('puts the mark on the lid, at the origin the stage gave the sprite', async () => {
    const typing = (await loadSprite('typing')).slice(0, 1);
    const logo = solidLogo(12, 14, MARK);
    const lit = render({ ...base, sprites: typing, logo });
    const dark = render({ ...base, sprites: typing });

    const changed: number[] = [];
    for (let i = 0; i < lit.pixels.length; i += 1) {
      if (lit.pixels[i] !== dark.pixels[i]) changed.push(i);
    }
    expect(changed.length).toBeGreaterThan(0);

    // Every changed pixel is inside the lid, mapped to panel coordinates the
    // way `paintStage` maps the sprite: slot origin, less the safe-area crop.
    const lid = { x: LID_SLOT.x + 0, y: LID_SLOT.y - 34 };
    const strays = changed.filter((i) => {
      const x = i % lit.width;
      const y = Math.floor(i / lit.width);
      return (
        x < lid.x ||
        x >= lid.x + LID_SLOT.width ||
        y < lid.y ||
        y >= lid.y + LID_SLOT.height
      );
    });
    expect(strays, 'nothing changed outside the lid').toEqual([]);

    // The mark itself reached the panel, at the centred slot.
    const slot = logoSlot(logo);
    expect(lit.pixels[(slot.y - 34) * lit.width + slot.x]).toBe(MARK);
  });

  it('does not mark the second machine in two-up', async () => {
    // Two sessions, two laptops. A logo on both would say they are the same
    // machine, which is the reason `scene.ts` gates on the first slot.
    const typing = await loadSprite('typing');
    const two = [typing[0], typing[1]].filter((s) => s !== undefined);
    const portrait = {
      ...base,
      orientation: 'portrait' as const,
      layout: 'twoUp' as const,
    };
    const lit = render({
      ...portrait,
      sprites: two,
      logo: solidLogo(12, 14, MARK),
    });
    // In two-up the lid is clipped away entirely, so the mark cannot land at
    // all — on either slot. What this pins is that it does not land somewhere
    // else instead.
    expect([...lit.pixels].filter((v) => v === MARK)).toEqual([]);
  });
});
