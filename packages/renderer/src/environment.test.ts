/**
 * Does the ground meet Clawd's feet, and does the sky actually change?
 *
 * The first is the one that matters. `assets/clawd/animations/PLANS.md` says
 * the shelf line must be derived from the sprite slot rather than chosen by
 * eye, because every prop in every animation — the barbell, the laptop base —
 * already rests where the base geometry puts his feet. A shelf that disagrees
 * by one pixel makes him float, and that is far harder to notice once there is
 * scenery drawing the eye than it was against a black stage.
 */
import type { Framebuffer } from './framebuffer.js';

import { describe, expect, it } from 'vitest';

import {
  castsShadow,
  ENVIRONMENT_EXTENTS,
  groundRow,
  paintEnvironment,
  TIMES_OF_DAY,
} from './environment.js';
import { createFramebuffer } from './framebuffer.js';
import {
  ORIENTATIONS,
  panelBands,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from './layout.js';

/** Where the base geometry actually puts the bottom of his legs. */
function feetRow(orientation: 'portrait' | 'landscape'): number {
  const slot = spriteSlots('hero', orientation)[0];
  const scale = stageScale('hero');
  const crop = orientation === 'landscape' ? safeAreaCropUnits() * scale : 0;
  // base.svg legs end at unit y=15; the animation canvas starts at y=-9.
  return slot.y - crop + (15 - -9) * scale;
}

function paint(
  orientation: 'portrait' | 'landscape',
  extent: 'stage' | 'panel',
  time: (typeof TIMES_OF_DAY)[number] = 'day',
): Framebuffer {
  const target = createFramebuffer(orientation);
  const stage = panelBands(orientation).stage;
  const into =
    extent === 'panel' ? { x: 0, y: 0, ...panelSize(orientation) } : stage;
  paintEnvironment(
    target,
    { into, stage },
    { layout: 'hero', orientation, time },
  );
  return target;
}

describe('groundRow', () => {
  for (const orientation of ORIENTATIONS) {
    it(`lands exactly on the sprite's feet in ${orientation}`, () => {
      expect(groundRow('hero', orientation)).toBe(feetRow(orientation));
    });

    it(`sits inside the stage band in ${orientation}`, () => {
      const stage = panelBands(orientation).stage;
      const ground = groundRow('hero', orientation);
      expect(ground).toBeGreaterThan(stage.y);
      expect(ground).toBeLessThanOrEqual(stage.y + stage.height);
    });
  }
});

describe('paintEnvironment', () => {
  it('gives every time of day a different sky', () => {
    // The whole time-of-day idea is a palette swap and no new geometry, so the
    // thing worth asserting is that the palettes are genuinely distinct rather
    // than four names for one scheme.
    // Sampled inside the stage band, not at pixel zero: in landscape the stage
    // starts at y=6, so row zero is untouched framebuffer and every scheme
    // looked identical.
    const stage = panelBands('landscape').stage;
    const { width } = panelSize('landscape');
    const at = (stage.y + 2) * width + stage.x + 2;
    const skies = TIMES_OF_DAY.map(
      (time) => paint('landscape', 'stage', time).pixels[at],
    );
    expect(new Set(skies).size).toBe(TIMES_OF_DAY.length);
  });

  for (const extent of ENVIRONMENT_EXTENTS) {
    it(`fills what ${extent} promises and no more`, () => {
      const target = paint('landscape', extent);
      const bands = panelBands('landscape');
      const { width } = panelSize('landscape');
      // A pixel in the message band, well clear of the stage.
      const outside =
        target.pixels[(bands.message.y + 4) * width + bands.message.x + 4];
      expect(outside === 0).toBe(extent === 'stage');
    });
  }

  it('darkens the ground where Clawd is standing on it', () => {
    // Every animation used to declare its own `#ground-shadow`, inherited from
    // base.svg as black at half opacity — and every one of the eight drew zero
    // pixels of it, because that is exactly what `snapToPalette` drops. It was
    // invisible for as long as the stage behind him was black. Drawn here, it
    // cannot be dropped and it can know which ground it is falling on.
    const target = paint('landscape', 'panel');
    const row = groundRow('hero', 'landscape');
    const slot = spriteSlots('hero', 'landscape')[0];
    expect(slot).toBeDefined();
    const scale = stageScale('hero');
    const at = (unit: number): number | undefined =>
      target.pixels[
        row * target.width + Math.round((slot?.x ?? 0) + unit * scale)
      ];
    // base.svg puts the shadow at units 3..12 of a canvas starting at -3, so
    // it spans 6..15 of the raster. Sample inside it, and beside it.
    const beneath = at(10);
    const beside = at(2);
    expect(beneath).toBeDefined();
    expect(beside).toBeDefined();
    expect(beneath).not.toBe(beside);
    // and it is a band, not a stray pixel
    expect(at(7)).toBe(beneath);
    expect(at(13)).toBe(beneath);
  });

  it('darkens the ground at every time of day, not just the bright ones', () => {
    // An earlier version of this test sampled the four shadow pixels and
    // asserted they were distinct. That passed with the shadow deleted, because
    // the four *sands* are already distinct — it was re-testing the sky check
    // above. It also could not fail under the design it claimed to rule out: a
    // uniform 30% multiply of each sand gives four distinct values too.
    //
    // What matters is that the shadow is visible against its own ground at
    // every sky, which is exactly what a multiply loses at night.
    const row = groundRow('hero', 'landscape');
    const slot = spriteSlots('hero', 'landscape')[0];
    expect(slot).toBeDefined();
    const scale = stageScale('hero');
    TIMES_OF_DAY.forEach((time) => {
      const target = paint('landscape', 'panel', time);
      const at = (unit: number): number | undefined =>
        target.pixels[
          row * target.width + Math.round((slot?.x ?? 0) + unit * scale)
        ];
      expect(at(10), `no shadow at ${time}`).not.toBe(at(2));
    });
  });

  it('draws no shadow under an animation that is not on the ground', () => {
    // `bouldering` is on a wall. The plan says a floor shadow under a climber
    // is worse than none, and the file records two separate versions
    // overriding that — the second being the one that moved the shadow here.
    expect(castsShadow('idle')).toBe(true);
    expect(castsShadow('bouldering')).toBe(false);

    const stage = panelBands('landscape').stage;
    const target = createFramebuffer('landscape');
    paintEnvironment(
      target,
      { into: { x: 0, y: 0, ...panelSize('landscape') }, stage },
      { layout: 'hero', orientation: 'landscape', time: 'day', contact: false },
    );
    const row = groundRow('hero', 'landscape');
    const slot = spriteSlots('hero', 'landscape')[0];
    const scale = stageScale('hero');
    const at = (unit: number): number | undefined =>
      target.pixels[
        row * target.width + Math.round((slot?.x ?? 0) + unit * scale)
      ];
    expect(at(10)).toBe(at(2));
  });

  it('draws a continuous sky across the whole panel', () => {
    // The first comparison of this was composited from two separate renders
    // and the bands stepped where the stage met the text. Alex spotted it. One
    // pass cannot do that, and this is the assertion that says so: every row
    // of the sky is one colour all the way across.
    const target = paint('landscape', 'panel');
    const { width } = panelSize('landscape');
    const ground = groundRow('hero', 'landscape');
    for (let y = 0; y < ground - 12; y += 1) {
      const row = target.pixels.subarray(y * width, (y + 1) * width);
      // Stars are single pixels, so allow one extra colour per row.
      expect(new Set(row).size).toBeLessThanOrEqual(2);
    }
  });
});
