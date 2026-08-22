import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SOURCE as ASLEEP } from '../packages/renderer/src/sprites/asleep.data.ts';
import { SOURCE as BOULDERING } from '../packages/renderer/src/sprites/bouldering.data.ts';
import { SOURCE as CONFUSED } from '../packages/renderer/src/sprites/confused.data.ts';
import { SOURCE as DIZZY } from '../packages/renderer/src/sprites/dizzy.data.ts';
import { SOURCE as GYM } from '../packages/renderer/src/sprites/gym.data.ts';
import { SOURCE as IDLE } from '../packages/renderer/src/sprites/idle.data.ts';
import { loadSprite } from '../packages/renderer/src/sprites/index.ts';
import { SOURCE as PERMISSION_SIGN } from '../packages/renderer/src/sprites/permission-sign.data.ts';
import { SOURCE as THINKING } from '../packages/renderer/src/sprites/thinking.data.ts';
import { SOURCE as TYPING } from '../packages/renderer/src/sprites/typing.data.ts';
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
 * and nine full renders into `pnpm test`. It would also be flaky —
 * `svg2frames` is not bit-reproducible, and two runs of `confused` differ on
 * one frame of 96 at a claw edge that lands on a fractional pixel and snaps
 * either way.
 */

const BAKED: ReadonlyArray<readonly [string, string]> = [
  ['asleep', ASLEEP],
  ['bouldering', BOULDERING],
  ['confused', CONFUSED],
  ['dizzy', DIZZY],
  ['gym', GYM],
  ['idle', IDLE],
  ['permission-sign', PERMISSION_SIGN],
  ['thinking', THINKING],
  ['typing', TYPING],
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

describe("dizzy's orbiting stars", () => {
  it('stay clear of the body and of each other', async () => {
    // See `componentSizes` for what this is and why it is counted from the
    // bake. Three runs of 320 on every frame, or a star has merged with the
    // body or with another star.
    const frames = await loadSprite('dizzy');
    const stars = frames.map(
      (sprite) =>
        componentSizes(sprite.mask, 168).filter((size) => size === STAR_PIXELS)
          .length,
    );
    expect(stars).toEqual(frames.map(() => 3));
  });
});
