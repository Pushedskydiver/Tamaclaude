import type { Rect } from '@tamaclaude/protocol';

import { SCREEN_WIDTH } from '@tamaclaude/protocol';

/**
 * Panel layout: the four bands the 172x320 display is divided into.
 *
 * Defined by `.claude/research/screens/spec.md` §2 and shared by everything
 * that needs to know where things go — the renderer at run time, and
 * `tools/panel-mock.ts` when composing layout candidates for review. One
 * source of truth, so a band height cannot drift between the mock used to make
 * a decision and the code that implements it.
 */

export type BandName = 'status' | 'stage' | 'strip' | 'message';

/**
 * Band heights, top to bottom. These must sum to the panel height — there is a
 * test for it, because a silent mismatch would push a band off the bottom of
 * the display rather than failing anywhere visible.
 */
const BAND_HEIGHTS: Readonly<Record<BandName, number>> = {
  status: 24,
  stage: 200,
  strip: 32,
  message: 64,
};

const BAND_ORDER: readonly BandName[] = ['status', 'stage', 'strip', 'message'];

/**
 * Animation stage width in device pixels.
 *
 * 21 SVG units at 8 device pixels per unit, which is the size every animation
 * is authored at (`docs/ANIMATION.md`). The 4px of slack against the panel
 * width is 2px of margin each side.
 */
export const STAGE_WIDTH = 168;

/** The four bands as absolute rectangles, stacked from the top. */
export function panelBands(): Readonly<Record<BandName, Rect>> {
  const bands: Partial<Record<BandName, Rect>> = {};
  let y = 0;
  for (const name of BAND_ORDER) {
    const height = BAND_HEIGHTS[name];
    const inset = name === 'stage' ? (SCREEN_WIDTH - STAGE_WIDTH) / 2 : 0;
    bands[name] = {
      x: inset,
      y,
      width: SCREEN_WIDTH - inset * 2,
      height,
    };
    y += height;
  }
  return bands as Record<BandName, Rect>;
}

/**
 * How many sessions the stage shows at once.
 *
 * `hero` is the shipping choice: one session at the full authoring scale.
 * `twoUp` exists because the spec grill pointed out it had never been
 * considered — two sprites at scale 4 are 84px each and tile the 168px stage
 * exactly, which is the only multi-sprite layout the pixel-exactness rule in
 * `docs/ANIMATION.md` permits. Four-up would need 240px on a 172px panel.
 */
export type StageLayout = 'hero' | 'twoUp';

/** Device pixels per SVG unit for each layout. Both are pixel-exact scales. */
const LAYOUT_SCALE: Readonly<Record<StageLayout, number>> = {
  hero: 8,
  twoUp: 4,
};

/** Authored stage size in SVG units — see `docs/ANIMATION.md` §Canvas conventions. */
const STAGE_UNITS = { width: 21, height: 25 } as const;

export function stageScale(layout: StageLayout): number {
  return LAYOUT_SCALE[layout];
}

/** Where each session's sprite is drawn, vertically centred in the stage band. */
export function spriteSlots(layout: StageLayout): readonly Rect[] {
  const stage = panelBands().stage;
  const scale = LAYOUT_SCALE[layout];
  const width = STAGE_UNITS.width * scale;
  const height = STAGE_UNITS.height * scale;
  const count = layout === 'hero' ? 1 : 2;
  const y = stage.y + Math.round((stage.height - height) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: stage.x + index * width,
    y,
    width,
    height,
  }));
}
