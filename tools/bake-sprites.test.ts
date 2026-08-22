import { readFileSync } from 'node:fs';

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
 * and six full renders into `pnpm test`.
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

  it('covers every animation that has an SVG', () => {
    // A new animation whose SVG lands without a bake would otherwise be
    // checked by nothing here — the list above is hand-maintained, and the
    // failure mode of a hand-maintained list is omission.
    const named = new Set(BAKED.map(([name]) => name));
    const onDisk = readFileSync(
      'packages/renderer/src/sprites/index.ts',
      'utf8',
    )
      .match(/export const SPRITE_NAMES = \[([\s\S]*?)\] as const;/)?.[1]
      ?.match(/'([a-z0-9-]+)'/g)
      ?.map((quoted) => quoted.slice(1, -1));
    expect(onDisk).toBeDefined();
    expect([...(onDisk ?? [])].sort()).toEqual([...named].sort());
  });
});
