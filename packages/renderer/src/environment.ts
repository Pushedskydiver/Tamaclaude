/**
 * The place Clawd lives: a rock pool, through the day.
 *
 * A renderer layer drawn behind the sprite rather than scenery baked into each
 * animation SVG — `docs/ANIMATION.md` §Clawd lives somewhere sets out why, and
 * the short version is that one definition cannot drift, a pack can swap it,
 * and the animation contract stays "the base geometry plus transforms".
 *
 * He is a crab. Putting him where a crab lives earns the mascot rather than
 * ignoring it, and it supplies the one thing every animation already assumes:
 * a ground line to stand on.
 *
 * **Static, deliberately.** The plan asks for almost no ambient motion — the
 * character moves, the place stays — and a still background costs nothing on
 * the wire, because the dirty rect between two frames never touches it. Motion
 * here would be paid for on every frame of every animation for the rest of the
 * project. A shifting water highlight can be added later if the place feels
 * dead; it cannot easily be taken back.
 */
import type { Framebuffer } from './framebuffer.js';
import type { Orientation, StageLayout } from './layout.js';
import type { Rect } from '@tamaclaude/protocol';

import { rgb565 } from '@tamaclaude/protocol';

import { fillRect } from './draw.js';
import { safeAreaCropUnits, spriteSlots, stageScale } from './layout.js';

/** Which sky the panel is wearing. */
export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/**
 * One scheme per time of day.
 *
 * Bands rather than a gradient: at 168px wide with RGB565 a smooth ramp shows
 * as banding anyway, so drawing the bands deliberately reads as pixel art
 * instead of as a failed gradient. Four is enough to suggest depth and few
 * enough to stay flat.
 *
 * The whole time-of-day idea is a palette swap and no new geometry, which is
 * what makes it nearly free — and what makes the object on the desk quietly
 * know when it is.
 */
type Scheme = {
  readonly sky: readonly [number, number, number, number];
  readonly sea: number;
  readonly sand: number;
  readonly pool: number;
  readonly rock: number;
  /**
   * The ground where Clawd is standing on it.
   *
   * Per scheme rather than a fixed darkening of `sand`, so each ground gets a
   * separation tuned to it rather than the same ratio applied to four very
   * different starting points.
   *
   * **Night is inherently the weakest and cannot be fixed by going darker.**
   * Measured as a luminance delta against each sand: day 18.9, dawn 9.4, dusk
   * 6.5, night 2.8 — and night only reaches 2.8 because the tone was taken to
   * about as dark as RGB565 allows here; at the first draft's value it was 2.1,
   * and the floor is near. The sand at night is already almost black, so there
   * is very little room beneath it. That is also true of real shadows after
   * dark, so it is the right kind of wrong, but a review looking at a true-size
   * strip could not find it at night and that should be checked on glass
   * before anyone calls it done: `node tools/blit.ts idle <port> landscape night`.
   */
  readonly shadow: number;
  readonly stars: boolean;
  /**
   * Text colour that reads on this sky.
   *
   * Only used when the environment covers the whole panel, because then the
   * status and message bands sit on sky rather than on the pack background.
   * The pack cannot answer this: its ink is chosen against its own background,
   * and white on a midday sky is nearly invisible. Whatever the text sits on
   * should decide what colour it is.
   */
  readonly ink: number;
};

const SCHEMES: Readonly<Record<TimeOfDay, Scheme>> = {
  dawn: {
    sky: [
      rgb565(58, 62, 104),
      rgb565(120, 92, 128),
      rgb565(214, 138, 122),
      rgb565(244, 190, 150),
    ],
    sea: rgb565(70, 84, 118),
    sand: rgb565(126, 108, 96),
    shadow: rgb565(84, 70, 64),
    pool: rgb565(92, 106, 126),
    rock: rgb565(72, 64, 68),
    stars: false,
    ink: rgb565(28, 24, 44),
  },
  day: {
    sky: [
      rgb565(74, 140, 200),
      rgb565(104, 164, 214),
      rgb565(140, 190, 226),
      rgb565(184, 214, 236),
    ],
    sea: rgb565(58, 110, 150),
    sand: rgb565(178, 156, 128),
    shadow: rgb565(126, 108, 88),
    pool: rgb565(96, 154, 168),
    rock: rgb565(96, 88, 84),
    stars: false,
    ink: rgb565(16, 40, 66),
  },
  dusk: {
    sky: [
      rgb565(46, 40, 78),
      rgb565(104, 62, 104),
      rgb565(190, 96, 96),
      rgb565(236, 148, 92),
    ],
    sea: rgb565(56, 54, 92),
    sand: rgb565(112, 88, 82),
    shadow: rgb565(74, 56, 56),
    pool: rgb565(84, 78, 104),
    rock: rgb565(58, 50, 56),
    stars: false,
    ink: rgb565(250, 236, 214),
  },
  night: {
    sky: [
      rgb565(8, 12, 30),
      rgb565(14, 20, 46),
      rgb565(22, 32, 64),
      rgb565(32, 46, 84),
    ],
    sea: rgb565(16, 26, 52),
    sand: rgb565(52, 50, 58),
    shadow: rgb565(16, 14, 20),
    pool: rgb565(34, 44, 70),
    rock: rgb565(26, 26, 34),
    stars: true,
    ink: rgb565(214, 226, 246),
  },
};

/**
 * Where the ground meets Clawd's feet, in panel rows.
 *
 * Derived, never chosen by eye. `spriteSlots` decides where the character
 * stands, the base geometry puts his feet at unit y=15 of a canvas that starts
 * at -9, and every prop in every animation — the barbell, the laptop base —
 * already rests on that same line. A shelf that disagrees by one pixel makes
 * him float, which is the defect the idle rebuild spent an evening on and
 * which will be far harder to see once there is scenery drawing the eye.
 */
export function groundRow(
  layout: StageLayout,
  orientation: Orientation,
): number {
  const slot = spriteSlots(layout, orientation)[0];
  const scale = stageScale(layout);
  const crop = orientation === 'landscape' ? safeAreaCropUnits() * scale : 0;
  const feetUnitsFromCanvasTop = 15 - -9;
  return slot.y - crop + feetUnitsFromCanvasTop * scale;
}

/** Stars, at fixed positions so the sky does not shimmer between frames. */
const STARS: readonly (readonly [number, number])[] = [
  [18, 12],
  [44, 26],
  [67, 9],
  [96, 20],
  [122, 14],
  [139, 31],
  [31, 40],
  [152, 6],
];

/**
 * Where the sea meets the sky, as a fraction of the stage's height.
 *
 * Not derived from the sprite, unlike the ground line. The first version put
 * the horizon just above Clawd's feet, which is where a shelf edge would be —
 * and it read as him standing waist-deep in the sea, because a horizon that
 * low leaves no ground plane between it and him. Pushing it up to two thirds
 * gives a beach receding behind him, which is what says "he is standing on
 * something" rather than "he is in something".
 */
const HORIZON_FRACTION = 0.62;

/** The three things every layer needs: where to draw, the sea line, and the palette. */
type Layer = {
  readonly into: Rect;
  readonly horizon: number;
  readonly scheme: Scheme;
};

function paintSky(target: Framebuffer, layer: Layer): void {
  const { into: stage, horizon, scheme } = layer;
  const depth = horizon - stage.y;
  const band = Math.max(1, Math.floor(depth / scheme.sky.length));
  for (const [index, colour] of scheme.sky.entries()) {
    const last = index === scheme.sky.length - 1;
    const y = stage.y + index * band;
    fillRect(
      target,
      {
        x: stage.x,
        y,
        width: stage.width,
        height: last ? horizon - y : band,
      },
      colour,
    );
  }
  if (!scheme.stars) return;
  for (const [x, y] of STARS) {
    fillRect(
      target,
      { x: stage.x + x, y: stage.y + y, width: 1, height: 1 },
      0xffff,
    );
  }
}

/** A stepped silhouette, so a rock reads as rock rather than as a box. */
function paintRock(
  target: Framebuffer,
  at: { readonly x: number; readonly base: number },
  colour: number,
): void {
  const steps: readonly (readonly [number, number, number])[] = [
    [0, 26, 6],
    [3, 20, 11],
    [7, 12, 17],
  ];
  for (const [inset, width, height] of steps) {
    fillRect(
      target,
      { x: at.x + inset, y: at.base - height, width, height },
      colour,
    );
  }
}

/**
 * Sea, beach, a pool and one rock.
 *
 * The pool sits to Clawd's right and the rock to his left, because
 * `spriteSlots` centres him — anything centred is behind the character and
 * invisible. Both are placed on the beach rather than on the horizon, so they
 * read as near rather than as distant scenery competing with him.
 */
function paintGround(target: Framebuffer, layer: Layer): void {
  const { into: stage, horizon, scheme } = layer;
  const bottom = stage.y + stage.height;
  const sea = Math.max(3, Math.round(stage.height * 0.06));
  fillRect(
    target,
    { x: stage.x, y: horizon, width: stage.width, height: sea },
    scheme.sea,
  );
  fillRect(
    target,
    {
      x: stage.x,
      y: horizon + sea,
      width: stage.width,
      height: bottom - horizon - sea,
    },
    scheme.sand,
  );

  // A pool wide enough to read at 168px, and shallow enough to sit clear of
  // the sprite. Two tones: the water, and a paler lip where it meets the sand.
  const poolWidth = Math.round(stage.width * 0.3);
  const poolX = stage.x + stage.width - poolWidth - 4;
  const poolY = bottom - Math.round(stage.height * 0.14);
  const poolHeight = Math.max(4, bottom - poolY - 3);
  fillRect(
    target,
    { x: poolX, y: poolY, width: poolWidth, height: poolHeight },
    scheme.pool,
  );
  fillRect(
    target,
    { x: poolX + 3, y: poolY, width: poolWidth - 6, height: 1 },
    scheme.sea,
  );

  paintRock(target, { x: stage.x + 6, base: horizon + sea + 6 }, scheme.rock);
}

/**
 * The ground darkening under Clawd's feet.
 *
 * Every animation used to draw its own, as `#ground-shadow` inherited from
 * `assets/clawd/base.svg` — black at `opacity="0.5"`. None of them ever
 * rendered it. `svg2frames` captures with `omitBackground` and `snapToPalette`
 * drops a pixel that snaps to the background and arrives part-transparent,
 * which is exactly what a half-opacity black over nothing does. Eight
 * animations declared a shadow and eight drew zero pixels of it, invisible for
 * as long as the stage behind him was black.
 *
 * Drawing it here fixes the mechanism and the medium at once. A per-animation
 * flat colour could survive the snap but could not know what it is falling on,
 * and this panel has four grounds; the renderer does know. It is also one
 * definition rather than eight, which `docs/ANIMATION.md` §Clawd lives
 * somewhere gives as the reason the scenery is a renderer layer at all.
 *
 * The geometry is base.svg's own shadow rect — units 3 to 12 of the character,
 * on the line its feet stand on — so it lands where every animation already
 * expected it. The height is two device pixels rather than the rect's eight: a
 * contact shadow is a line where he meets the ground, and a full unit reads as
 * a plinth he is standing on.
 *
 * **Not drawn for `bouldering`**, via `contact: false`. A first version drew it
 * for everything, on the grounds that its feet are on the same line as every
 * other animation's. Two things were wrong with that. The measurement behind it
 * — "unit 15.13" — was frame 0 of a 32-frame scrolling loop, and across the
 * loop the lowest drawn pixel reaches 15.625. And composed, the wall's joint
 * band scrolls through the shadow row and covers 89% of it for four frames of
 * every thirty-two, so the shadow blinked twice a loop. `PLANS.md` had already
 * ruled on this — "a shadow on the floor beneath a climber is worse than no
 * shadow" — and `bouldering.svg` records an earlier version overriding it too.
 */
function paintContactShadow(
  target: Framebuffer,
  at: { readonly layout: StageLayout; readonly orientation: Orientation },
  colour: number,
): void {
  const slot = spriteSlots(at.layout, at.orientation)[0];
  if (slot === undefined) return;
  const scale = stageScale(at.layout);
  const row = groundRow(at.layout, at.orientation);
  // base.svg: `ground-shadow` is x=3 width=9 on a canvas whose left edge is
  // unit -3, so it starts six units into the raster.
  fillRect(
    target,
    {
      x: slot.x + Math.round(6 * scale),
      y: row,
      width: Math.round(9 * scale),
      height: Math.max(1, Math.round(scale / 4)),
    },
    colour,
  );
}

/**
 * Animations where Clawd is not standing on the ground.
 *
 * `bouldering` puts him on a wall. Its plan says so — "a shadow on the floor
 * beneath a climber is worse than no shadow" — and its own SVG records an
 * earlier version overriding that, so this is the second time it has needed
 * defending.
 *
 * Here rather than in `packages/daemon` because the shadow is a renderer
 * concern and `tools/` composes panels too: the daemon is above the renderer in
 * the graph and the tools cannot reach it, so a rule kept there would have to
 * be duplicated to be applied while judging. Keyed on the name because the
 * environment is painted before any sprite exists — nothing else at that point
 * knows what is about to stand in front of it.
 */
const UNGROUNDED: ReadonlySet<string> = new Set(['bouldering']);

/** Whether the ground should be darkened under this animation. */
export function castsShadow(name: string): boolean {
  return !UNGROUNDED.has(name);
}

/** How far the scenery reaches. See `Scene.environment`. */
export const ENVIRONMENT_EXTENTS = ['stage', 'panel'] as const;

export type EnvironmentExtent = (typeof ENVIRONMENT_EXTENTS)[number];

/** The text colour that reads against a given sky. */
export function environmentInk(time: TimeOfDay): number {
  return SCHEMES[time].ink;
}

/** Paint the environment into the stage band, behind everything else. */
export function paintEnvironment(
  target: Framebuffer,
  region: { readonly into: Rect; readonly stage: Rect },
  at: {
    readonly layout: StageLayout;
    readonly orientation: Orientation;
    readonly time: TimeOfDay;
    /** False where Clawd is not on the ground. See `Scene.environment`. */
    readonly contact?: boolean;
  },
): void {
  const scheme = SCHEMES[at.time];
  // The horizon is placed against the *stage*, not against the region being
  // filled. They differ when the scenery covers the whole panel, and deriving
  // it from the fill region would float Clawd by however much taller the panel
  // is than his stage band.
  const horizon =
    region.stage.y + Math.round(region.stage.height * HORIZON_FRACTION);
  const layer: Layer = { into: region.into, horizon, scheme };
  paintSky(target, layer);
  paintGround(target, layer);
  if (at.contact !== false) paintContactShadow(target, at, scheme.shadow);
}
