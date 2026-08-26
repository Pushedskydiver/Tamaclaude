import type { Framebuffer } from './framebuffer.js';
import type { BandName } from './layout.js';
import type { Scene, StageSprite } from './scene.js';
import type { SessionChip } from './strip.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame, Rect } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import { packPalette } from '@tamaclaude/packs';
import { frame } from '@tamaclaude/protocol';

import { sceneColours } from './band.js';
import {
  ORIENTATIONS,
  panelBands,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  STAGE_LAYOUTS,
  stageScale,
} from './layout.js';
import { opaqueMask, render } from './scene.js';
import { stripFit } from './strip.js';

const PACK: PackManifest = {
  name: 'test',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
  ],
  quips: { mapped: {}, idle: [] },
};

const BACKGROUND = packPalette(PACK)[0];

/** A scene with nothing in any band, so each test lights exactly one. */
const EMPTY: Scene = {
  orientation: 'portrait',
  layout: 'hero',
  pack: PACK,
  sprites: [],
  status: { left: '', right: '' },
  sessions: [],
  message: '',
};

/** Every pixel that is not the pack background, as {x, y}. */
function litPixels(target: Framebuffer): readonly { x: number; y: number }[] {
  const lit: { x: number; y: number }[] = [];
  for (const [index, pixel] of target.pixels.entries()) {
    if (pixel === BACKGROUND) continue;
    lit.push({ x: index % target.width, y: Math.floor(index / target.width) });
  }
  return lit;
}

function within(at: { x: number; y: number }, rect: Rect): boolean {
  return (
    at.x >= rect.x &&
    at.y >= rect.y &&
    at.x < rect.x + rect.width &&
    at.y < rect.y + rect.height
  );
}

/** Lit pixels falling outside every one of `rects` — the bleed to catch. */
function strayFrom(
  target: Framebuffer,
  rects: readonly Rect[],
): readonly { x: number; y: number }[] {
  return litPixels(target).filter(
    (at) => !rects.some((rect) => within(at, rect)),
  );
}

function pixelAt(target: Framebuffer, x: number, y: number): number {
  return target.pixels[y * target.width + x] ?? -1;
}

/** A fully-lit raster, so any stray pixel is attributable and visible. */
function solidFrame(width: number, height: number, value = 0x1234): Frame {
  return frame(new Uint16Array(width * height).fill(value), width);
}

/** A raster whose every row carries its own value, so a crop is measurable. */
function stripedFrame(width: number, height: number): Frame {
  const pixels = new Uint16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    pixels.fill(row + 1, row * width, (row + 1) * width);
  }
  return frame(pixels, width);
}

/** A stage sprite with no mask: every pixel of the raster is drawn. */
function solidSprite(
  width: number,
  height: number,
  value = 0x1234,
): StageSprite {
  const frame = solidFrame(width, height, value);
  return { frame, mask: opaqueMask(frame) };
}

function stripedSprite(width: number, height: number): StageSprite {
  const frame = stripedFrame(width, height);
  return { frame, mask: opaqueMask(frame) };
}

const BAND_NAMES = [
  'status',
  'stage',
  'strip',
  'message',
] as const satisfies readonly BandName[];

/**
 * The single-band scenes the containment test renders, one band lit each.
 *
 * The strip carries eight sessions rather than three so the overflow badge is
 * drawn too — it is laid out from the far edge inwards, which is the end of
 * the band most likely to spill.
 */
const ONLY: Readonly<Record<BandName, Partial<Scene>>> = {
  status: { status: { left: '14:32', right: 'x12' } },
  stage: { sprites: [solidSprite(168, 200)] },
  strip: {
    sessions: Array.from({ length: 8 }, (_, index) => ({
      tone:
        (['attention', 'active', 'resting'] as const)[index % 3] ?? 'resting',
      origin: index % 2 === 0 ? ('local' as const) : ('remote' as const),
    })),
  },
  message: { message: 'mcp__linear__create_issue' },
};

describe('render', () => {
  it('sizes the framebuffer to the orientation', () => {
    for (const orientation of ORIENTATIONS) {
      const target = render({ ...EMPTY, orientation });
      const size = panelSize(orientation);
      expect({ orientation, w: target.width, h: target.height }).toStrictEqual({
        orientation,
        w: size.width,
        h: size.height,
      });
      expect(target.pixels.length).toBe(size.width * size.height);
    }
  });

  it('grounds every pixel in the pack background', () => {
    const target = render(EMPTY);
    expect([...new Set(target.pixels)]).toStrictEqual([BACKGROUND]);
  });

  it('follows the pack when the background changes', () => {
    const other: PackManifest = { ...PACK, palette: [[8, 16, 24]] };
    const target = render({ ...EMPTY, pack: other });
    expect([...new Set(target.pixels)]).toStrictEqual([packPalette(other)[0]]);
  });
});

// The test that matters most: each band's content stays in that band's rect,
// in both mountings. Landscape is where this bites — the stage band is 6px
// down from the top and the cropped hero sprite is taller than its slot, so an
// unclipped blit puts six rows of Clawd above the band it belongs to.
describe('band containment', () => {
  for (const orientation of ORIENTATIONS) {
    for (const name of BAND_NAMES) {
      it(`keeps ${name} content inside the ${name} band (${orientation})`, () => {
        const target = render({ ...EMPTY, ...ONLY[name], orientation });
        const band = panelBands(orientation)[name];
        expect({ name, stray: strayFrom(target, [band]) }).toStrictEqual({
          name,
          stray: [],
        });
        // Without this the containment above passes for a renderer that draws
        // nothing at all.
        expect(litPixels(target).length).toBeGreaterThan(0);
      });
    }

    it(`puts nothing outside the four bands (${orientation})`, () => {
      const full = Object.values(ONLY).reduce<Scene>(
        (scene, content) => ({ ...scene, ...content }),
        { ...EMPTY, orientation },
      );
      const bands = panelBands(orientation);
      expect(strayFrom(render(full), Object.values(bands))).toStrictEqual([]);
    });
  }
});

describe('the stage', () => {
  for (const layout of STAGE_LAYOUTS) {
    it(`fills every slot it is given in ${layout}`, () => {
      const slots = spriteSlots(layout, 'portrait');
      const sprites = slots.map(() => solidSprite(8, 8));
      const target = render({ ...EMPTY, layout, sprites });
      // One lit block per slot, each inside its own slot and nowhere else.
      expect(strayFrom(target, slots)).toEqual([]);
      expect(litPixels(target)).toHaveLength(slots.length * 8 * 8);
    });

    it(`leaves slots with no sprite empty in ${layout}`, () => {
      // `sprites` is per-slot and may be short: two-up with one session must
      // show one crab and one empty half, not the same crab twice.
      const target = render({ ...EMPTY, layout, sprites: [solidSprite(8, 8)] });
      expect(litPixels(target)).toHaveLength(8 * 8);
    });
  }

  it('pulls the sprite up by the safe-area crop in landscape', () => {
    // Landscape's stage is shorter than the authored canvas, and the top of
    // that canvas is prop headroom rather than character. The sprite is drawn
    // with its top above the slot so the crop lands on the headroom — which
    // means the raster must be clipped to the slot, not merely positioned.
    const layout = 'hero';
    const slot = spriteSlots(layout, 'landscape')[0];
    const crop = safeAreaCropUnits() * stageScale(layout);
    expect(crop).toBeGreaterThan(0);
    const tall = solidSprite(slot.width, slot.height + crop);
    const target = render({
      ...EMPTY,
      orientation: 'landscape',
      layout,
      sprites: [tall],
    });
    expect(strayFrom(target, [slot])).toEqual([]);
    expect(litPixels(target)).toHaveLength(slot.width * slot.height);
  });

  it('crops the top of the sprite in landscape, not the bottom', () => {
    // Row-numbered stripes, so this asserts *which* rows survive rather than
    // how many. Counting alone cannot tell a correct crop from one that keeps
    // the right number of rows off the wrong end — and the wrong end is the
    // character's legs, which is the half that must never be lost. The top is
    // prop headroom, which is what landscape is entitled to drop.
    const layout = 'hero';
    const slot = spriteSlots(layout, 'landscape')[0];
    const crop = safeAreaCropUnits() * stageScale(layout);
    const sprite = stripedSprite(slot.width, slot.height + crop);
    const target = render({
      ...EMPTY,
      orientation: 'landscape',
      layout,
      sprites: [sprite],
    });
    // The slot's first row must hold stripe `crop + 1`, not stripe 1.
    expect(pixelAt(target, slot.x, slot.y)).toBe(crop + 1);
    // And its last row must be the sprite's last row, untouched.
    expect(pixelAt(target, slot.x, slot.y + slot.height - 1)).toBe(
      slot.height + crop,
    );
  });

  it('lets the background through where the sprite is masked out', () => {
    // A raster's background arrives as transparent-over-black, so treating it
    // as opaque paints a black rectangle over whatever is behind Clawd. That
    // is invisible while the pack background is also black and wrong the
    // moment it is not — and it would hide the environment entirely.
    //
    // A colour key cannot substitute: the art's palette contains black, so
    // keying on it would punch holes through his eyes. Hence a mask.
    const slot = spriteSlots('hero', 'portrait')[0];
    const size = 8;
    const frame = solidFrame(size, size, 0x1234);
    // Only the left half is drawn.
    const mask = new Uint8Array(size * size);
    for (let row = 0; row < size; row += 1) {
      mask.fill(1, row * size, row * size + size / 2);
    }
    const target = render({ ...EMPTY, sprites: [{ frame, mask }] });
    expect(litPixels(target)).toHaveLength(size * (size / 2));
    // The masked-out half is the pack background, not the raster's black.
    expect(pixelAt(target, slot.x + size - 1, slot.y)).toBe(BACKGROUND);
    expect(pixelAt(target, slot.x, slot.y)).toBe(0x1234);
  });

  it('clips a sprite larger than its slot rather than bleeding', () => {
    const slot = spriteSlots('hero', 'portrait')[0];
    const huge = solidSprite(slot.width + 40, slot.height + 40);
    const target = render({ ...EMPTY, sprites: [huge] });
    expect(strayFrom(target, [slot])).toEqual([]);
  });
});

describe('the session strip', () => {
  it('shows what fits and hides the rest', () => {
    const band = panelBands('portrait').strip;
    const many: SessionChip[] = Array.from({ length: 20 }, () => ({
      tone: 'active',
      origin: 'local',
    }));
    const fit = stripFit(many.length, band.width);
    expect(fit.shown).toBeGreaterThan(0);
    expect(fit.shown + fit.hidden).toBe(many.length);
    const target = render({ ...EMPTY, sessions: many });
    expect(strayFrom(target, [band])).toEqual([]);
  });

  it('draws nothing when there are no sessions', () => {
    expect(litPixels(render(EMPTY))).toEqual([]);
  });
});

describe('pack colours', () => {
  // True of a scene with no environment, which every fixture here builds.
  // `packages/cli` always composes one, and `pack-swap.test.ts` records that it
  // covers this fill — so the pack background reaches no shipping pixel. Both
  // are true; they describe different scenes.
  it('paints the whole panel in the pack background before anything else', () => {
    const target = render(EMPTY);
    expect(pixelAt(target, 0, 0)).toBe(BACKGROUND);
    expect(pixelAt(target, target.width - 1, target.height - 1)).toBe(
      BACKGROUND,
    );
  });

  // Same caveat as above: with an environment at `panel` extent,
  // `withEnvironment` substitutes `environmentInk(time)` for the pack's ink, so
  // on the shipping panel this is the sky's ink rather than the pack's.
  it('draws ink in the pack ink colour, not a literal', () => {
    const colours = sceneColours(PACK);
    expect(colours.ink).not.toBe(colours.background);
    const target = render({ ...EMPTY, message: 'x' });
    const lit = litPixels(target);
    expect(lit.length).toBeGreaterThan(0);
    for (const at of lit) {
      expect(pixelAt(target, at.x, at.y)).toBe(colours.ink);
    }
  });
});

describe('the status band', () => {
  it('cuts over-long strings rather than letting the two overprint', () => {
    // Both strings are short by contract, but `text.ts` says clipping in
    // silence is never allowed, and right-alignment clamps to the same inset
    // as the left string — so without a budget the two collide into an
    // unreadable smear rather than merely running off the panel.
    const scene: Scene = {
      ...EMPTY,
      status: { left: 'a'.repeat(80), right: 'b'.repeat(80) },
    };
    const target = render(scene);
    const band = panelBands(scene.orientation).status;
    // Nothing may land outside the band it belongs to.
    expect(strayFrom(target, [band])).toEqual([]);
    // And the band must not be a solid wall of overprinted ink: a smear fills
    // essentially every cell, a pair of fitted strings does not.
    const lit = litPixels(target).filter((at) => within(at, band)).length;
    expect(lit).toBeLessThan(band.width * band.height * 0.5);
  });
});

describe('the status band marker', () => {
  it('marks a cut string in glyphs the atlas actually has', () => {
    // U+2026 is outside the atlas's U+0020..U+007E, so `glyphOffset` fell back
    // to `?` and an over-long string rendered as `ab?`. `text.ts` states the
    // rule — ASCII, because the atlas is — and this broke it.
    //
    // Asserted by rendering the string the truncation should produce and
    // demanding the two panels be pixel-identical. A fallback glyph would make
    // them differ, and so would truncating to a different length.
    const long: Scene = { ...EMPTY, status: { left: 'abcdefghij', right: '' } };
    // 172px band, 4px insets, half each: 81px of budget, five 14px cells at
    // 2x, three of them spent on the marker.
    const cut: Scene = { ...EMPTY, status: { left: 'ab...', right: '' } };
    expect(litPixels(render(long))).toEqual(litPixels(render(cut)));
  });

  it('leaves a string that fits completely alone', () => {
    const short: Scene = { ...EMPTY, status: { left: '06:40', right: '' } };
    const marked: Scene = { ...EMPTY, status: { left: '06...', right: '' } };
    expect(litPixels(render(short))).not.toEqual(litPixels(render(marked)));
  });
});

describe('the birthday QR', () => {
  // 0xaa is alternating bits, so the matrix has both dark and light modules.
  // An all-zero fill draws a white square with no dark modules at all, which
  // made the "black and white only" assertion vacuous on the first run.
  // **25 modules, which is the version the real URL encodes to** — not 21.
  // At 21 the block is 145px in a 148px band and covers everything the two
  // bands could ever draw, so "the QR replaces them" and "the QR is painted
  // over them" are indistinguishable and the overlay mutant is equivalent. At
  // 25 the pitch drops to 4px, the block to 132px, and the margin is wide
  // enough for a chip to show. Test the geometry that ships.
  const qr = { size: 25, modules: Buffer.alloc(79, 0xaa).toString('base64') };

  // **A pack whose background is neither black nor white.** `PACK` above has
  // `[0, 0, 0]` first, which is exactly `DARK` — so a QR drawn in the wrong
  // place is indistinguishable from untouched ground, and a mutant that moved
  // the block down 32px passed the whole suite.
  const blue: PackManifest = {
    ...PACK,
    palette: [[0, 0, 128], ...PACK.palette.slice(1)] as PackManifest['palette'],
  };
  const ground = packPalette(blue)[0];
  const landscape = { ...EMPTY, pack: blue, orientation: 'landscape' as const };

  const bands = panelBands('landscape');
  const area = {
    x: bands.strip.x,
    y: bands.strip.y,
    width: bands.strip.width,
    height: bands.message.y + bands.message.height - bands.strip.y,
  };
  const block = { x: 178, y: 32, width: 132, height: 132 };

  it('takes the strip and message bands, and they do not draw underneath', () => {
    const busy = {
      ...landscape,
      sessions: [{ tone: 'attention' as const, origin: 'local' as const }],
      message: 'happy birthday',
    };
    const painted = render({ ...busy, qr });

    // The stage and the status band are untouched: the crab keeps his half and
    // the clock still runs on the day.
    const plain = render(busy);
    expect(column(painted, bands.stage)).toEqual(column(plain, bands.stage));
    expect(column(painted, bands.status)).toEqual(column(plain, bands.status));

    // The block is where it should be, and its edge is quiet zone. Pinning a
    // corner rather than just "some white exists" — a block drawn 32px low is
    // still all black and white.
    expect(at(painted, block.x + 2, block.y + 2)).toBe(0xffff);
    expect(
      at(painted, block.x + block.width - 3, block.y + block.height - 3),
    ).toBe(0xffff);

    // The block itself carries nothing but the two QR colours: no chip, no
    // quip, no pack ink surviving underneath.
    expect([...new Set(column(painted, block))].sort((a, b) => a - b)).toEqual([
      0x0000, 0xffff,
    ]);

    // **And the margin around it is bare ground.** This is what says the bands
    // did not draw at all, rather than drawing and being covered — a chip one
    // pixel taller than the block would show here. Asserting only inside the
    // block passes with the QR as an overlay, which it is not.
    // All four sides. The left and right strips alone are not enough: both
    // bands inset their content, so an overlay-drawn QR left them clean and
    // the mutant survived. The row above the block is inside the strip band,
    // where a chip does reach.
    for (const margin of [
      { x: area.x, y: area.y, width: block.x - area.x, height: area.height },
      {
        x: block.x + block.width,
        y: area.y,
        width: area.x + area.width - block.x - block.width,
        height: area.height,
      },
      { x: area.x, y: area.y, width: area.width, height: block.y - area.y },
      {
        x: area.x,
        y: block.y + block.height,
        width: area.width,
        height: area.y + area.height - block.y - block.height,
      },
    ]) {
      expect(
        [...new Set(column(painted, margin))],
        `margin ${String(margin.x)}`,
      ).toEqual([ground]);
    }
  });

  it('falls back to the strip and message when the QR cannot be drawn', () => {
    // A symbol too big for the band. Losing the QR is survivable; losing the
    // panel's only text because something silently drew nothing is not.
    const huge = {
      size: 177,
      modules: Buffer.alloc(3922, 0xaa).toString('base64'),
    };
    const busy = { ...landscape, message: 'happy birthday' };
    expect(render({ ...busy, qr: huge }).pixels).toEqual(render(busy).pixels);
  });
});

/** One pixel, by panel coordinates. */
function at(target: Framebuffer, x: number, y: number): number {
  return target.pixels[y * target.width + x] ?? -1;
}

/** Every pixel inside a rect, row-major. */
function column(target: Framebuffer, rect: Rect): readonly number[] {
  const out: number[] = [];
  for (let row = 0; row < rect.height; row += 1) {
    for (let col = 0; col < rect.width; col += 1) {
      out.push(
        target.pixels[(rect.y + row) * target.width + rect.x + col] ?? -1,
      );
    }
  }
  return out;
}
