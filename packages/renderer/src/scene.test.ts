import type { Framebuffer } from './framebuffer.js';
import type { BandName } from './layout.js';
import type { Scene } from './scene.js';
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
import { render } from './scene.js';
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
function solidSprite(width: number, height: number, value = 0x1234): Frame {
  return frame(new Uint16Array(width * height).fill(value), width);
}

/** A raster whose every row carries its own value, so a crop is measurable. */
function stripedSprite(width: number, height: number): Frame {
  const pixels = new Uint16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    pixels.fill(row + 1, row * width, (row + 1) * width);
  }
  return frame(pixels, width);
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
  it('paints the whole panel in the pack background before anything else', () => {
    const target = render(EMPTY);
    expect(pixelAt(target, 0, 0)).toBe(BACKGROUND);
    expect(pixelAt(target, target.width - 1, target.height - 1)).toBe(
      BACKGROUND,
    );
  });

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
