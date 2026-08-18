import type { Orientation, StageLayout } from './layout.js';

import { describe, expect, it } from 'vitest';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

import {
  panelBands,
  panelSize,
  spriteSlots,
  STAGE_WIDTH,
  stageScale,
} from './layout.js';

describe('panelBands', () => {
  it('stacks the four bands with no gap and no overlap', () => {
    const bands = panelBands();
    const ordered = [bands.status, bands.stage, bands.strip, bands.message];
    for (const [index, band] of ordered.slice(1).entries()) {
      const previous = ordered[index];
      expect(band.y).toBe(previous.y + previous.height);
    }
  });

  it('fills the panel exactly', () => {
    const bands = panelBands();
    const last = bands.message;
    // A silent mismatch would push a band off the bottom of the display rather
    // than failing anywhere visible, which is why this is asserted.
    expect(last.y + last.height).toBe(SCREEN_HEIGHT);
  });

  it('insets only the stage, symmetrically', () => {
    const bands = panelBands();
    expect(bands.stage.width).toBe(STAGE_WIDTH);
    expect(bands.stage.x).toBe((SCREEN_WIDTH - STAGE_WIDTH) / 2);
    for (const name of ['status', 'strip', 'message'] as const) {
      expect(bands[name].x).toBe(0);
      expect(bands[name].width).toBe(SCREEN_WIDTH);
    }
  });
});

describe('spriteSlots', () => {
  it('gives the hero layout the whole stage width', () => {
    const [slot] = spriteSlots('hero');
    expect(slot?.width).toBe(STAGE_WIDTH);
  });

  it('tiles two-up across the stage exactly, with no overlap', () => {
    const slots = spriteSlots('twoUp');
    expect(slots).toHaveLength(2);
    expect(slots[0].x + slots[0].width).toBe(slots[1].x);
    expect(slots[1].x + slots[1].width).toBe(
      panelBands().stage.x + STAGE_WIDTH,
    );
  });

  it('keeps every slot inside the stage band', () => {
    const stage = panelBands().stage;
    for (const layout of ['hero', 'twoUp'] as const) {
      for (const slot of spriteSlots(layout)) {
        expect(slot.x).toBeGreaterThanOrEqual(stage.x);
        expect(slot.y).toBeGreaterThanOrEqual(stage.y);
        expect(slot.x + slot.width).toBeLessThanOrEqual(stage.x + stage.width);
        expect(slot.y + slot.height).toBeLessThanOrEqual(
          stage.y + stage.height,
        );
      }
    }
  });

  it('only offers scales that keep motion on whole pixels', () => {
    // docs/ANIMATION.md: a translation is pixel-exact when
    // distance x scale / frameCount is whole. The typing animation's data bits
    // rise 14 units over 8 frames, which is what rules out scale 2 — and with
    // it any four-up layout, since scale 4 would need 240px on a 172px panel.
    const bitsRise = 14;
    const frames = 8;
    for (const layout of ['hero', 'twoUp'] as const satisfies StageLayout[]) {
      const perFrame = (bitsRise * stageScale(layout)) / frames;
      expect(Number.isInteger(perFrame)).toBe(true);
    }
  });
});

describe('landscape', () => {
  it('swaps the panel dimensions', () => {
    expect(panelSize('portrait')).toEqual({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    });
    expect(panelSize('landscape')).toEqual({
      width: SCREEN_HEIGHT,
      height: SCREEN_WIDTH,
    });
  });

  it('keeps every band inside the panel', () => {
    const { width, height } = panelSize('landscape');
    for (const rect of Object.values(panelBands('landscape'))) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
  });

  it('crops the stage so it fits the short axis', () => {
    // The whole reason landscape is a different composition rather than a
    // rotation: the authored stage is 25 units at scale 8 = 200px, and
    // landscape has 172px of height. The safe area is 20 units = 160px.
    const stage = panelBands('landscape').stage;
    expect(stage.height).toBe(20 * 8);
    expect(stage.height).toBeLessThanOrEqual(panelSize('landscape').height);
    expect(panelBands('portrait').stage.height).toBe(25 * 8);
  });

  it('does not overlap the stage with the text column', () => {
    const bands = panelBands('landscape');
    for (const name of ['status', 'strip', 'message'] as const) {
      expect(bands[name].x).toBeGreaterThanOrEqual(
        bands.stage.x + bands.stage.width,
      );
    }
  });

  it('stacks the text column with no gap', () => {
    const bands = panelBands('landscape');
    expect(bands.strip.y).toBe(bands.status.y + bands.status.height);
    expect(bands.message.y).toBe(bands.strip.y + bands.strip.height);
    expect(bands.message.y + bands.message.height).toBe(
      panelSize('landscape').height,
    );
  });

  it('keeps sprite slots pixel-exact in both orientations', () => {
    for (const orientation of [
      'portrait',
      'landscape',
    ] as const satisfies Orientation[]) {
      for (const layout of ['hero', 'twoUp'] as const) {
        for (const slot of spriteSlots(layout, orientation)) {
          expect(Number.isInteger(slot.x)).toBe(true);
          expect(Number.isInteger(slot.y)).toBe(true);
        }
      }
    }
  });
});
