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
