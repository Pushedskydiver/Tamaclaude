import type { Rect } from '@tamaclaude/protocol';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

/**
 * Panel layout: the four bands the 172x320 display is divided into.
 *
 * Defined by `.claude/research/screens/spec.md` §2 and shared by everything
 * that needs to know where things go — the renderer at run time, and
 * `tools/panel-mock.ts` when composing layout candidates for review. One
 * source of truth, so a band height cannot drift between the mock used to make
 * a decision and the code that implements it.
 */

/**
 * Bands top to bottom. `BandName` is derived from this rather than declared
 * alongside it, so the order and the name set cannot drift — a band added to
 * one and forgotten in the other used to yield `undefined` typed as `Rect`,
 * which every test still passed.
 */
const BAND_ORDER = ['status', 'stage', 'strip', 'message'] as const;

export type BandName = (typeof BAND_ORDER)[number];

/**
 * How the board is mounted.
 *
 * The panel is 172x320 natively. Landscape is not a rotated portrait layout —
 * it is a different composition, because the stage as authored is 200px tall
 * and landscape has only 172px of height. Landscape crops the stage to the
 * safe area (`docs/ANIMATION.md` §Safe area) and puts the three text bands in
 * a column beside it rather than stacked beneath.
 */
export const ORIENTATIONS = ['portrait', 'landscape'] as const;

export type Orientation = (typeof ORIENTATIONS)[number];

/** Panel dimensions for a given mounting. */
export function panelSize(orientation: Orientation): {
  readonly width: number;
  readonly height: number;
} {
  return orientation === 'portrait'
    ? { width: SCREEN_WIDTH, height: SCREEN_HEIGHT }
    : { width: SCREEN_HEIGHT, height: SCREEN_WIDTH };
}

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

/**
 * Animation stage width in device pixels.
 *
 * 21 SVG units at 8 device pixels per unit, which is the size every animation
 * is authored at (`docs/ANIMATION.md`). The 4px of slack against the panel
 * width is 2px of margin each side.
 */
export const STAGE_WIDTH = 168;

function portraitBands(): Record<BandName, Rect> {
  const bands: Partial<Record<BandName, Rect>> = {};
  let y = 0;
  for (const name of BAND_ORDER) {
    const height = BAND_HEIGHTS[name];
    const inset = name === 'stage' ? (SCREEN_WIDTH - STAGE_WIDTH) / 2 : 0;
    bands[name] = { x: inset, y, width: SCREEN_WIDTH - inset * 2, height };
    y += height;
  }
  return bands as Record<BandName, Rect>;
}

function landscapeBands(): Record<BandName, Rect> {
  const { width, height } = panelSize('landscape');
  const stageHeight = STAGE_UNITS.landscape.height * LAYOUT_SCALE.hero;
  const columnX = STAGE_WIDTH;
  const columnWidth = width - columnX;
  const stack = BAND_HEIGHTS.status + BAND_HEIGHTS.strip;
  return {
    stage: {
      x: 0,
      y: Math.round((height - stageHeight) / 2),
      width: STAGE_WIDTH,
      height: stageHeight,
    },
    status: {
      x: columnX,
      y: 0,
      width: columnWidth,
      height: BAND_HEIGHTS.status,
    },
    strip: {
      x: columnX,
      y: BAND_HEIGHTS.status,
      width: columnWidth,
      height: BAND_HEIGHTS.strip,
    },
    // The message band takes what is left, which is more generous than
    // portrait's — text is the thing landscape has room for.
    message: {
      x: columnX,
      y: stack,
      width: columnWidth,
      height: height - stack,
    },
  };
}

/** Band rectangles for a given mounting. */
export function panelBands(
  orientation: Orientation = 'portrait',
): Readonly<Record<BandName, Rect>> {
  return orientation === 'portrait' ? portraitBands() : landscapeBands();
}

/**
 * How many sessions the stage shows at once.
 *
 * `hero` is the shipping choice: one session at the full authoring scale.
 * `twoUp` exists because the spec grill pointed out it had never been
 * considered — two sprites at scale 4 are 84px each and tile the 168px stage
 * exactly.
 *
 * A sprite on the panel is a whole 21-unit stage, not just the 15-unit
 * character, so four-up needs 4 x 21 x scale pixels: 336px at scale 4 and
 * 672px at scale 8. It fits only at scale 2 (168px) — and scale 2 is ruled out
 * by the pixel-exactness rule in `docs/ANIMATION.md`, since typing's data bits
 * would move 3.5 device pixels a frame. Width alone never ruled four-up out;
 * pixel-exactness does.
 */
export const STAGE_LAYOUTS = ['hero', 'twoUp'] as const;

export type StageLayout = (typeof STAGE_LAYOUTS)[number];

/** Device pixels per SVG unit for each layout. Both are pixel-exact scales. */
const LAYOUT_SCALE: Readonly<Record<StageLayout, number>> = {
  hero: 8,
  twoUp: 4,
};

/**
 * Stage size in SVG units per orientation — `docs/ANIMATION.md` §Canvas
 * conventions. Portrait uses the full authored canvas; landscape uses the
 * safe area, because 25 units at scale 8 is 200px and landscape is 172px tall.
 */
const STAGE_UNITS: Readonly<
  Record<Orientation, { readonly width: number; readonly height: number }>
> = {
  portrait: { width: 21, height: 25 },
  landscape: { width: 21, height: 20 },
};

export function stageScale(layout: StageLayout): number {
  return LAYOUT_SCALE[layout];
}

/**
 * Authored units of prop headroom that landscape crops off the top.
 *
 * Consumers must multiply this by the scale they are actually drawing at, not
 * by the authoring scale — a two-up landscape sprite is drawn at scale 4, so a
 * crop computed at scale 8 removes ten units instead of five.
 */
export function safeAreaCropUnits(): number {
  return STAGE_UNITS.portrait.height - STAGE_UNITS.landscape.height;
}

/** Where each session's sprite is drawn, vertically centred in the stage band. */
export function spriteSlots(
  layout: StageLayout,
  orientation: Orientation = 'portrait',
): readonly Rect[] {
  const stage = panelBands(orientation).stage;
  const scale = LAYOUT_SCALE[layout];
  const units = STAGE_UNITS[orientation];
  const width = units.width * scale;
  const height = units.height * scale;
  const count = layout === 'hero' ? 1 : 2;
  const y = stage.y + Math.round((stage.height - height) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: stage.x + index * width,
    y,
    width,
    height,
  }));
}
