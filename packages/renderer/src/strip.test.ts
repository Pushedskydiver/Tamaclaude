import type { Scene } from './scene.js';
import type { SessionChip } from './strip.js';
import type { PackManifest } from '@tamaclaude/packs';

import { describe, expect, it } from 'vitest';

import { packPalette } from '@tamaclaude/packs';

import { panelBands } from './layout.js';
import { render } from './scene.js';

const PACK: PackManifest = {
  name: 'test',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
  ],
  quips: { mapped: {}, idle: [] },
};

const BACKGROUND = packPalette(PACK)[0];

const EMPTY: Scene = {
  orientation: 'portrait',
  layout: 'hero',
  pack: PACK,
  sprites: [],
  status: { left: '', right: '' },
  sessions: [],
  message: '',
};

/**
 * Lit pixels inside the strip band, and the bounding box they occupy.
 *
 * Derived entirely from what was rendered. An earlier version computed each
 * chip's rect from copied constants and used `8` where `paintStrip` uses
 * `TEXT_INSET`, which is `4` — the assertions still passed, because the
 * window was wrong by less than the gap between chips. A test that is green
 * for a reason its own comment misstates is the thing this file exists to
 * stop, so it measures the output instead of re-deriving the input.
 */
function stripInk(sessions: readonly SessionChip[]) {
  const target = render({ ...EMPTY, sessions });
  const band = panelBands('portrait').strip;
  const lit: { x: number; y: number }[] = [];
  for (const [i, pixel] of target.pixels.entries()) {
    if (pixel === BACKGROUND) continue;
    const x = i % target.width;
    const y = Math.floor(i / target.width);
    if (y >= band.y && y < band.y + band.height) lit.push({ x, y });
  }
  const xs = lit.map((p) => p.x);
  const ys = lit.map((p) => p.y);
  return {
    lit,
    has: (x: number, y: number) => lit.some((p) => p.x === x && p.y === y),
    box: {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    },
  };
}

/**
 * The one thing `origin` decides, and until 25 Aug nothing asserted it.
 *
 * `paintStrip` draws a remote session as an outline and a local one as a solid
 * block. Three comments — here, in `packages/cli`'s `chipFor`, and in
 * `BUILD_PLAN.md` — justify keeping that branch after the TCP transport was
 * cut on the grounds that it is "built and tested". It was built. The only
 * test constructing a remote chip was `scene.test.ts`'s band-containment
 * sweep, whose assertions are "nothing strays outside the band" and "something
 * is lit" — both of which a solid block satisfies just as well as an outline.
 * So the branch could have been deleted, or inverted, with the suite green.
 *
 * That matters more than usual for this branch specifically: nothing on the
 * device can produce a remote session any more, so no one will ever notice it
 * being wrong by looking at a panel.
 */
describe('a chip draws its origin', () => {
  it('fills a local chip and outlines a remote one', () => {
    const local = stripInk([{ tone: 'active', origin: 'local' }]);
    const remote = stripInk([{ tone: 'active', origin: 'remote' }]);

    // Same footprint: one chip, same place, same size.
    expect(remote.box).toEqual(local.box);

    // The outline is strictly fewer pixels — the fill minus its interior.
    expect(remote.lit.length).toBeLessThan(local.lit.length);

    // The assertion that matters: the middle of that footprint is lit for
    // local and unlit for remote. The count alone would pass for any two
    // shapes of different size.
    const midX = Math.floor((local.box.x0 + local.box.x1) / 2);
    const midY = Math.floor((local.box.y0 + local.box.y1) / 2);
    expect(local.has(midX, midY)).toBe(true);
    expect(remote.has(midX, midY)).toBe(false);

    // And the outline's own edge is lit, so "fewer pixels" is not "none".
    expect(remote.has(local.box.x0, local.box.y0)).toBe(true);
  });

  it('decides per chip, not once for the strip', () => {
    // An implementation reading `sessions[0].origin` once passes the test
    // above. A mixed strip is also the case the band exists for.
    const mixed = stripInk([
      { tone: 'active', origin: 'local' },
      { tone: 'active', origin: 'remote' },
    ]);
    const bothLocal = stripInk([
      { tone: 'active', origin: 'local' },
      { tone: 'active', origin: 'local' },
    ]);
    const bothRemote = stripInk([
      { tone: 'active', origin: 'remote' },
      { tone: 'active', origin: 'remote' },
    ]);
    expect(mixed.lit.length).toBeLessThan(bothLocal.lit.length);
    expect(mixed.lit.length).toBeGreaterThan(bothRemote.lit.length);
  });
});
