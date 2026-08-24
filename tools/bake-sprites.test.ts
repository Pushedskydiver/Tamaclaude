import type { SpriteName } from '../packages/renderer/src/sprites/index.ts';

import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SOURCE as ASLEEP } from '../packages/renderer/src/sprites/asleep.data.ts';
import { SOURCE as BOULDERING } from '../packages/renderer/src/sprites/bouldering.data.ts';
import { SOURCE as CONFUSED } from '../packages/renderer/src/sprites/confused.data.ts';
import { SOURCE as DIZZY } from '../packages/renderer/src/sprites/dizzy.data.ts';
import { SOURCE as GYM } from '../packages/renderer/src/sprites/gym.data.ts';
import { SOURCE as IDLE } from '../packages/renderer/src/sprites/idle.data.ts';
import { loadSprite } from '../packages/renderer/src/sprites/index.ts';
import { SOURCE as OVERHEATED } from '../packages/renderer/src/sprites/overheated.data.ts';
import { SOURCE as PAYOFF } from '../packages/renderer/src/sprites/payoff.data.ts';
import { SOURCE as PERMISSION_SIGN } from '../packages/renderer/src/sprites/permission-sign.data.ts';
import { SOURCE as THINKING } from '../packages/renderer/src/sprites/thinking.data.ts';
import { SOURCE as TYPING } from '../packages/renderer/src/sprites/typing.data.ts';
import { SOURCE as WIZARD } from '../packages/renderer/src/sprites/wizard.data.ts';
import { fingerprint } from './art-fingerprint.ts';

/**
 * That each baked animation matches the SVG committed beside it.
 *
 * `packages/renderer/src/sprites/index.test.ts` already proves the baked data
 * decodes and re-encodes to the bytes it was given. That is internal
 * consistency, and it passes just as happily on data baked from an SVG that has
 * since changed — which is what had happened to four of the six.
 *
 * The symptom was holes where Clawd's eyes are. `svg2frames` captures with
 * `omitBackground` and the eyes are the background's own colour, so an older
 * pipeline had punched them through the mask. Every gate stayed green and the
 * panel looked right, because the stage behind him was black and a hole onto
 * black is indistinguishable from a black eye. Wiring the rock pool on turned
 * them into pale windows showing the sky through his face.
 *
 * A hash is enough here, and rasterising would not be: it would put Playwright
 * and twelve full renders into `pnpm test`.
 *
 * **It used to be flaky too, and that is no longer the reason.** `svg2frames`
 * screenshotted without waiting for the seek to be painted, so two runs of
 * `confused` could differ on one frame of 96 at a claw edge landing on a
 * fractional pixel. That was fixed on this branch, and the tool now refuses to
 * write a frame whose two consecutive captures disagree. The cost is the whole
 * argument now; the flakiness half is recorded because it was the stated
 * justification and would otherwise read as still standing.
 */

const BAKED: ReadonlyArray<readonly [string, string]> = [
  ['asleep', ASLEEP],
  ['bouldering', BOULDERING],
  ['confused', CONFUSED],
  ['dizzy', DIZZY],
  ['gym', GYM],
  ['idle', IDLE],
  ['overheated', OVERHEATED],
  ['payoff', PAYOFF],
  ['permission-sign', PERMISSION_SIGN],
  ['thinking', THINKING],
  ['typing', TYPING],
  ['wizard', WIZARD],
];

/**
 * One star: a 3-unit cross at 8 device pixels a unit, so 5 cells of 64.
 *
 * A literal rather than a measurement, because the point of the assertion is
 * that the number does not move. Redraw the star and this fails, which is the
 * moment to re-derive the clearance rather than re-derive the constant.
 */
const STAR_PIXELS = 320;

/**
 * One `wizard` mote: the same five-cell cross at half scale, so 5 cells of 16.
 *
 * Half scale is not decoration. At whole units three crosses converging on a
 * two-unit orb cannot avoid each other — measured, two were touching on 24 of
 * 96 frames — and quartering the area is what buys the clearance.
 */
const MOTE_PIXELS = 80;

/**
 * The eight neighbours of a pixel.
 *
 * Eight and not four: two crosses meeting at a corner are one glyph to the eye,
 * and that is the defect this is here to catch, so a diagonal has to join them.
 */
const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** A mask being walked: its pixels, its width, and what has been counted. */
type Walk = {
  readonly mask: Uint8Array;
  readonly seen: Uint8Array;
  readonly width: number;
};

/** The size of the drawn run reachable from `start`, marking it seen. */
function floodFrom(walk: Walk, start: number): number {
  const { mask, seen, width } = walk;
  const height = mask.length / width;
  const stack = [start];
  seen[start] = 1;
  let size = 0;
  while (stack.length > 0) {
    const at = stack.pop() ?? 0;
    size++;
    const y = Math.floor(at / width);
    const x = at % width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * width + nx;
      const inside = nx >= 0 && nx < width && ny >= 0 && ny < height;
      if (inside && mask[next] === 1 && seen[next] === 0) {
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return size;
}

/**
 * Every 8-connected run of drawn pixels in a mask, by size.
 *
 * **What the star assertion below rests on.** The invariant no reader can see
 * and no gate held: the stars orbit close enough to Clawd's head that a
 * one-unit change of radius welds them to him, and it has gone wrong twice in
 * one branch. The first version measured the *pip* for clearance and shipped a
 * cross whose bottom arm sat flush against the torso on 33 of 96 frames; the
 * fix for that chained two crosses corner-to-corner on 12 frames, which is the
 * same defect moved one step round the loop. `asleep` shipped a glyph across
 * the face once and it read as display corruption.
 *
 * Counted through the bake rather than read off the twelve orbit keyframes,
 * because what matters is the composite: orbit, stagger and breath together
 * decide the gap, and the keyframes only decide one of them. Touching the body
 * merges a star into the body's run and touching another star merges the pair,
 * so either defect shows up as fewer than three runs of `STAR_PIXELS`.
 *
 * The commit that fixed the chaining claimed the check "refuses to write the
 * file". It did not exist; it was a throwaway script. This is it.
 */
function componentSizes(mask: Uint8Array, width: number): number[] {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 1 && seen[start] === 0) {
      sizes.push(floodFrom({ mask, seen, width }, start));
    }
  }
  return sizes;
}

/**
 * The first structural fault in an SVG, or `undefined`.
 *
 * Comment delimiters are counted rather than stripped, because a stripping
 * regex pairs a runaway `<!--` with the next comment's `-->` and hides exactly
 * the fault it is looking for. Tags are walked on a stack, so a self-closing
 * element is not an unclosed one and a balanced-but-mis-nested pair is still a
 * fault.
 */
function nestingFault(body: string): string | undefined {
  const stack: string[] = [];
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (selfClosing === '/' || name === undefined) continue;
    if (closing !== '/') {
      stack.push(name);
      continue;
    }
    if (stack.pop() !== name) {
      return `</${name}> does not close the open element`;
    }
  }
  const unclosed = stack[stack.length - 1];
  return unclosed === undefined ? undefined : `unclosed <${unclosed}>`;
}

function faultIn(svg: string): string | undefined {
  const opens = (svg.match(/<!--/g) ?? []).length;
  const closes = (svg.match(/-->/g) ?? []).length;
  if (opens !== closes) {
    return `${String(opens)} <!-- against ${String(closes)} -->`;
  }
  return nestingFault(svg.replaceAll(/<!--[\s\S]*?-->/g, ''));
}

describe('the baked animations', () => {
  it('were baked from the SVGs committed beside them', () => {
    const stale = BAKED.filter(
      ([name, stamped]) =>
        stamped !==
        fingerprint(
          readFileSync(`assets/clawd/animations/${name}.svg`, 'utf8'),
        ),
    ).map(([name]) => name);
    expect(stale).toEqual([]);
  });

  it('has balanced comments and correctly nested elements', () => {
    // **Not an XML validator, and the name says so.** A first version claimed
    // to be one and was not: it stripped paired comments with a non-greedy
    // regex and compared `<g>` counts, which a review showed caught one of ten
    // planted malformations. It missed the exact case it was written for —
    // deleting a single `-->` lets the runaway opener pair with a *later*
    // comment's terminator, and all eight files passed — and it false-flagged
    // a legitimate `<g />`. A green assertion certifying a property it cannot
    // see is worse than no assertion, which is `docs/DA-REVIEW.md`'s point
    // about test code that lies.
    //
    // This walks the tags instead, so it catches both failure modes that
    // actually occurred during authoring — an unterminated `<!--` in `asleep`
    // and an unclosed `<g>` in `bouldering` — plus mis-nesting, which the
    // count comparison could not see. Neither reached a commit; a review
    // confirmed no malformed version exists anywhere in history. But nothing
    // here caught them either: `svg2frames` rasterises through
    // `page.setContent()`, so a browser recovers from broken markup, the
    // frames come out right and every gate stays green. `bouldering` went
    // through a full `animation-critic` review malformed and the critic did
    // not see it, because it was looking at frames.
    //
    // A real parse is available — Playwright's `DOMParser` is ~100ms — but it
    // needs a `playwright install` step in CI that does not exist, and this
    // catches what has actually gone wrong.
    const broken = readdirSync('assets/clawd/animations')
      .filter((file) => file.endsWith('.svg'))
      .map((file) => ({
        file,
        fault: faultIn(readFileSync(`assets/clawd/animations/${file}`, 'utf8')),
      }))
      .filter(({ fault }) => fault !== undefined);
    expect(broken).toEqual([]);
  });

  it("clips bouldering's wall to the same rects the rock is drawn from", () => {
    // `#rock-face` and `#fx-wall-face` are two hand-maintained copies of one
    // silhouette, and the copy is what stops the joints running off the rock
    // into the sky. Editing one without the other reopens that defect, and it
    // is invisible: the bake stamp covers both, so a drifted clip re-bakes
    // happily and only shows once there is scenery behind him.
    const svg = readFileSync('assets/clawd/animations/bouldering.svg', 'utf8');
    const rectsOf = (id: string): string[] => {
      const group = new RegExp(
        `id="${id}"[^>]*>([\\s\\S]*?)</(?:g|clipPath)>`,
      ).exec(svg);
      return [...(group?.[1] ?? '').matchAll(/<rect[^>]*\/>/g)].map((m) =>
        m[0].replace(/\s+/g, ' '),
      );
    };
    const face = rectsOf('fx-wall-face');
    const clip = rectsOf('rock-face');
    expect(face.length).toBeGreaterThan(0);
    expect(clip).toEqual(face);
  });

  it('covers every animation that has an SVG', () => {
    // Against the assets directory, which is what the name promises. An
    // earlier version read `SPRITE_NAMES` out of `sprites/index.ts` — a list
    // `bake-sprites.ts` writes itself — so a new SVG that had never been baked
    // matched a table that had never heard of it, and a review dropped a spare
    // SVG into the directory with both assertions staying green.
    //
    // The list above is hand-maintained and the failure mode of a
    // hand-maintained list is omission, so it has to be checked against the
    // thing an author actually adds: a file.
    const named = [...new Set(BAKED.map(([name]) => name))].sort();
    const onDisk = readdirSync('assets/clawd/animations')
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/\.svg$/, ''))
      .sort();
    expect(onDisk).toEqual(named);
  });
});

/**
 * Transparent rows separating the legs from the body, in one frame.
 *
 * Walks up from the bottom-most drawn row — the feet — through the legs, and
 * counts the empty rows immediately above them. Derived rather than measured
 * against a fixed row, so a pose that moves the legs is still covered.
 *
 * An earlier version of this sentence justified that by saying `typing` is
 * seated with its legs eight rows lower. It is not: `typing.svg` puts them at
 * `y="13"`, the same as every other animation, and its own comment says
 * "Planted." What makes it *look* seated is the laptop occluding the tops of
 * the legs. There is no seated pose anywhere in the corpus — the only pose
 * variant is `overheated`'s sploot, which kept the torso bottom on the ground
 * line precisely so the fixed contact shadow still fit. Corrected because a
 * plan was written against this sentence and inherited the error.
 *
 * Bounded to `LEG_BAND` rows above the feet. Unbounded, the walk runs past the
 * body entirely and returns the daylight between the body and a floating prop —
 * 31 rows for `asleep`'s Zs, which is the animation working as designed.
 *
 * **The bound fires on every correct pose, so the 0 is vacuous — and that is
 * not the problem.** Measured across all twelve bakes: the contiguous band
 * from the feet is 42 to 200 rows, well over the bound, so the walk never
 * looks for a gap. The exception proves the mechanism rather than the rule —
 * `dizzy` drops to 16 on the six frames where an orbiting star is the
 * bottom-most thing, and there the walk does run and returns 1.
 *
 * None of that matters while nothing is wrong. What matters is the behaviour
 * under a defect, and there the bound is the whole story. Planting a two-unit
 * torso lift and re-baking:
 *
 * - **`idle` is caught.** With a real gap the band collapses to the legs
 *   alone, inside the bound, so the walk runs and reports a gap.
 * - **`payoff` is not.** Its vehicle spans the rows beside his legs, so the
 *   band stays deep and the early return fires exactly as it does on a correct
 *   pose. A prop that bridges the body and the ground blinds this gate to the
 *   one defect it exists for.
 * - **`overheated` is not either**, and not for want of legs — it has four, in
 *   `legs-sploot`. They sit *above* the torso, so a walk from the bottom-most
 *   row never reaches them.
 *
 * Two earlier versions of this paragraph got it wrong in opposite directions:
 * one said the gate had never gated anything, the other that the 0 on a
 * correct pose was cheap rather than vacuous. It is vacuous, and harmless
 * until a prop makes it vacuous when it should not be.
 *
 * **A connectivity check would work, and the first attempt was abandoned on
 * arithmetic that was wrong.** Asking whether the bottom-most pixel in the
 * legs' columns belongs to the largest component catches the `idle` lift and
 * the `payoff` lift both. With the torso lifted the components are 5,440 for
 * the torso, 1,008 for the vehicle and 128 for each leg — the vehicle does not
 * hold the body together, because it touches the torso and not the legs. At
 * row 176 it ends at device column 39 and the first leg starts at 48; lower
 * down, where only its wheels are drawn, the gap is wider still.
 *
 * The attempt discarded components under 1,000 pixels, to stop `dizzy`'s stars
 * being read as body parts. That discards the legs too, so the scan found
 * nothing in their columns and passed vacuously — 0 frames flagged, where 100
 * flags all 64. A threshold artefact, published as a property of the
 * formulation, and recorded here because a wrong reason not to build something
 * forecloses it more thoroughly than never trying.
 *
 * What is genuinely unsolved is narrow: a star is 320 pixels and a leg is 128,
 * so no *minimum* size threshold can drop the stars while keeping the legs —
 * the stars are the larger. Size can separate them; a floor cannot. The
 * discriminator that does work is that the legs stand on the ground row and
 * the stars never get near it.
 */
const LEG_BAND = 24;

function hipGap(mask: Uint8Array, width: number): number {
  const height = mask.length / width;
  const drawn = (y: number): boolean => {
    for (let x = 0; x < width; x++) if (mask[y * width + x] === 1) return true;
    return false;
  };
  let y = height - 1;
  while (y >= 0 && !drawn(y)) y--;
  const feet = y;
  while (y >= 0 && drawn(y)) y--;
  if (feet - y > LEG_BAND) return 0;
  let gap = 0;
  while (y >= 0 && !drawn(y)) {
    gap++;
    y--;
  }
  // Empty all the way to the top is a frame with no body above the legs, not a
  // hip gap.
  return y < 0 ? 0 : gap;
}

describe('the body stays on its legs', () => {
  it('never lifts more than a device pixel clear of them', async () => {
    // `docs/ANIMATION.md` §Animating the whole sprite is not animating: pivot
    // at the body's own bottom edge and never translate upward. One device
    // pixel is an eased track crossing a boundary; a whole art unit is the
    // body leaving its feet, which reads as four free-floating stubs under a
    // levitating crab.
    //
    // Both animations that have ever failed this shipped and were reviewed
    // first: `thinking` at eleven device pixels on 50 of 64 frames, and `idle`
    // at nine on 14 of 128 — nearly two seconds of every loop, in the
    // animation that shows most. Neither is visible in a still frame and
    // neither changes the bake stamp, which is why this is a test and not a
    // reading.
    const worst = await Promise.all(
      BAKED.map(async ([name]) => {
        const frames = await loadSprite(name as SpriteName);
        const gaps = frames.map((s) => hipGap(s.mask, s.frame.width));
        return [name, Math.max(...gaps)] as const;
      }),
    );
    expect(worst.filter(([, gap]) => gap > 1)).toEqual([]);
  });
});

/**
 * How many separate effect glyphs a frame must show, per animation.
 *
 * `dizzy`'s three stars orbit continuously, so all three are on every frame.
 * `wizard`'s three motes each spend the first of twelve keyframes transparent
 * — the gap between one arriving and the next — and they are 8 and 16 frames
 * apart on a 24-frame track, so exactly one is away on six frames of every
 * twenty-four.
 *
 * **The `< 2` window is not "two frames a position", and the difference is
 * load-bearing.** `dizzy.svg` §Why nothing rotates measures the real dwell as
 * 2, 3, 1 repeating: the twelve keyframe percentages are written to six
 * decimals, `8.333333%` of 3s is 249.99999ms and `16.666667%` is 500.00001ms,
 * so a boundary falls either side of a sample depending on which way the
 * percentage rounded. `wizard` inherits those percentages, so it inherits the
 * dwell. This window is right only because keyframe 0 happens to draw the 2 of
 * that cycle — had the rounding put the 3 or the 1 there, the same reasoning
 * would produce a wrong expected sequence, and because the visibility signal
 * and the fusion signal are the same number, a wrong window can mask a real
 * merge. Re-derive it against `dizzy.svg` before trusting it for a third
 * animation.
 *
 * Both numbers are derived from the stylesheet rather than measured from the
 * bake, which is the point: a bake that disagrees is the defect.
 *
 * The table is hand-maintained and most animations have nothing separable to
 * count, so a full-coverage assertion would be wrong. What is not wrong is
 * remembering that this being hard-coded to `dizzy` is how `wizard` shipped
 * two motes fused into one glyph for two commits.
 */
const EFFECTS: ReadonlyArray<
  readonly [SpriteName, number, (frame: number) => number]
> = [
  ['dizzy', STAR_PIXELS, () => 3],
  [
    'wizard',
    MOTE_PIXELS,
    (frame) =>
      3 - [0, 8, 16].filter((delay) => (frame + delay) % 24 < 2).length,
  ],
];

describe('componentSizes', () => {
  // The fusion detector every effect assertion below leans on, and which
  // nothing exercised directly. `NEIGHBOURS` is eight rather than four
  // precisely so a corner touch joins two glyphs; until this test that choice
  // had never been shown to do anything.
  const cross = (
    grid: { mask: Uint8Array; width: number },
    cx: number,
    cy: number,
  ) => {
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ] as const)
      grid.mask[(cy + dy) * grid.width + (cx + dx)] = 1;
  };

  it('joins two crosses that touch only at a corner', () => {
    const width = 8;
    const mask = new Uint8Array(width * 8);
    cross({ mask, width }, 1, 1);
    cross({ mask, width }, 3, 3);
    // (2,1) and (3,2) are diagonal neighbours, so the ten cells are one glyph.
    expect(componentSizes(mask, width)).toEqual([10]);
  });

  it('keeps two crosses apart when nothing touches', () => {
    const width = 10;
    const mask = new Uint8Array(width * 10);
    cross({ mask, width }, 1, 1);
    cross({ mask, width }, 6, 6);
    expect(componentSizes(mask, width)).toEqual([5, 5]);
  });
});

describe('orbiting stars and arriving motes', () => {
  // This generalises what used to be a `dizzy`-only assertion, and the reason
  // is that the first two drafts of `wizard` shipped the exact defect it
  // exists for: two motes edge-adjacent, rasterising as one glyph, on 24 of 96
  // frames. Three lines away from catching it and hard-coded to the one
  // animation that had already been fixed.
  it.each(EFFECTS)('%s keeps its effects apart', async (name, size, want) => {
    const frames = await loadSprite(name);
    // `toEqual` against a list derived from `frames` passes on an empty list,
    // which is the shape a broken loader would hand back.
    expect(frames.length).toBeGreaterThan(0);
    const seen = frames.map(
      (sprite) =>
        componentSizes(sprite.mask, sprite.frame.width).filter(
          (each) => each === size,
        ).length,
    );
    expect(seen).toEqual(frames.map((_, frame) => want(frame)));
  });
});
