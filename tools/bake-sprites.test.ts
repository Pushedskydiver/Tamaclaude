import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SOURCE as ASLEEP } from '../packages/renderer/src/sprites/asleep.data.ts';
import { SOURCE as BOULDERING } from '../packages/renderer/src/sprites/bouldering.data.ts';
import { SOURCE as CONFUSED } from '../packages/renderer/src/sprites/confused.data.ts';
import { SOURCE as GYM } from '../packages/renderer/src/sprites/gym.data.ts';
import { SOURCE as IDLE } from '../packages/renderer/src/sprites/idle.data.ts';
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
 * and eight full renders into `pnpm test`. It would also be flaky —
 * `svg2frames` is not bit-reproducible, and two runs of `confused` differ on
 * one frame of 96 at a claw edge that lands on a fractional pixel and snaps
 * either way.
 */

const BAKED: ReadonlyArray<readonly [string, string]> = [
  ['asleep', ASLEEP],
  ['bouldering', BOULDERING],
  ['confused', CONFUSED],
  ['gym', GYM],
  ['idle', IDLE],
  ['permission-sign', PERMISSION_SIGN],
  ['thinking', THINKING],
  ['typing', TYPING],
];

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

  it('is well-formed XML, every one of them', () => {
    // Two malformed SVGs shipped in a single session and neither was noticed:
    // an unterminated `<!--` in `asleep`, and an unclosed `<g>` in
    // `bouldering`. Both rendered correctly, because the rasteriser is a
    // browser and browsers recover from broken markup — so `svg2frames` was
    // silent, the frames were right, and every gate stayed green. Nothing else
    // here reads these files as XML.
    const broken = readdirSync('assets/clawd/animations')
      .filter((file) => file.endsWith('.svg'))
      .filter((file) => {
        const svg = readFileSync(`assets/clawd/animations/${file}`, 'utf8');
        const stripped = svg.replaceAll(/<!--[\s\S]*?-->/g, '');
        // Unbalanced groups, and any `<!--` the strip could not pair.
        const opens = (stripped.match(/<g[\s>]/g) ?? []).length;
        const closes = (stripped.match(/<\/g>/g) ?? []).length;
        return opens !== closes || stripped.includes('<!--');
      });
    expect(broken).toEqual([]);
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
