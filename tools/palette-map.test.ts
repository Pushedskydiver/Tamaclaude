import type { Rgb } from './frame-palette.ts';

import { describe, expect, it } from 'vitest';

import { collisions, declaredFills, nearestIn } from './palette-map.ts';

/**
 * A synthetic four-entry palette — black, white, crimson, blue.
 *
 * Deliberately **not** `packs/example`'s, and deliberately not similar to it.
 * These functions are pure and every assertion below is about a relationship
 * between numbers, so binding them to a shipped manifest would make this file
 * fail when that manifest changed for an unrelated reason.
 *
 * It carried `packs/example`'s four entries verbatim until 26 Aug, which
 * `tools/one-panel-renderer.test.ts` cannot catch — that gate builds hex
 * strings from the manifest and greps for them, and these are decimals. A
 * comment claiming the values were arbitrary landed before the values were.
 */
const PACK: Rgb[] = [
  [0, 0, 0],
  [255, 255, 255],
  [220, 20, 60],
  [20, 120, 200],
];

describe('nearestIn', () => {
  it('returns an exact match unchanged', () => {
    expect(nearestIn([220, 20, 60], PACK)).toEqual([220, 20, 60]);
  });

  it('picks the least-distant entry', () => {
    expect(nearestIn([225, 25, 55], PACK)).toEqual([220, 20, 60]);
  });

  it('refuses an empty palette rather than inventing a colour', () => {
    expect(() => nearestIn([0, 0, 0], [])).toThrow(/palette/);
  });
});

/**
 * Two source colours landing on one palette entry, which is how a logo loses a
 * mark without anything failing.
 *
 * Found by looking: a fixture with a purple field and a yellow disc quantised
 * to `packs/example` came back as a flat orange field — `#7B2D8E` and
 * `#FFD166` are both nearest to `#F77849`, so the disc vanished. Every stage
 * reported success. A four-colour palette cannot represent an arbitrary logo,
 * and the useful thing a tool can do is say so before someone puts the output
 * on a panel.
 */
describe('collisions', () => {
  it('finds two source colours sharing one palette entry', () => {
    const rose: Rgb = [200, 40, 80];
    const scarlet: Rgb = [240, 10, 40];
    const found = collisions([rose, scarlet], PACK);
    expect(found).toHaveLength(1);
    expect(found[0]?.target).toEqual([220, 20, 60]);
    expect(found[0]?.sources).toEqual([rose, scarlet]);
  });

  it('reports nothing when every source maps somewhere distinct', () => {
    expect(
      collisions(
        [
          [13, 17, 23],
          [200, 208, 216],
        ],
        PACK,
      ),
    ).toEqual([]);
  });

  it('does not count one source colour as colliding with itself', () => {
    expect(collisions([[220, 20, 60]], PACK)).toEqual([]);
  });

  it('groups three sources onto one entry as a single collision', () => {
    const found = collisions(
      [
        [225, 25, 55],
        [215, 15, 65],
        [230, 30, 70],
      ],
      PACK,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.sources).toHaveLength(3);
  });

  it('ignores duplicate source colours, which are not a collision', () => {
    // The same colour twice maps to one entry trivially; reporting it would
    // cry wolf on any SVG that reuses a fill, which is most of them.
    expect(
      collisions(
        [
          [250, 125, 70],
          [250, 125, 70],
        ],
        PACK,
      ),
    ).toEqual([]);
  });
});

/**
 * The colours a logo's own artwork declares.
 *
 * Deliberately not `paletteOf` from `tools/frame-palette.ts`, which answers a
 * different question: it injects the transparent ground and every fill
 * composited at its element's opacity, because it exists to decide what a
 * rasterised animation frame may legally contain. Asking that here would
 * report a collision against a ground the logo never draws, and would hide a
 * logo's own black behind the injected one.
 */
describe('declaredFills', () => {
  it('reads fills from attributes', () => {
    expect(
      declaredFills('<rect fill="#FFD166"/><rect fill="#06D6A0"/>'),
    ).toEqual([
      [255, 209, 102],
      [6, 214, 160],
    ]);
  });

  it('reads fills from inline style, which SVG editors emit', () => {
    expect(declaredFills('<rect style="fill:#7B2D8E"/>')).toEqual([
      [123, 45, 142],
    ]);
  });

  it('de-duplicates a fill reused across elements', () => {
    expect(
      declaredFills('<rect fill="#FFD166"/><circle fill="#ffd166"/>'),
    ).toEqual([[255, 209, 102]]);
  });

  it('injects no ground of its own', () => {
    // The distinguishing property against `paletteOf`, which always adds one.
    expect(declaredFills('<rect fill="#FFD166"/>')).toEqual([[255, 209, 102]]);
  });

  it('reads single-quoted fills, which several editors emit', () => {
    // The hole that mattered: a logo entirely hex-filled through `fill`
    // attributes escaped the collision warning completely if its exporter
    // used single quotes. The warning exists to be believed, so the cases it
    // silently skips have to be the ones nobody writes.
    expect(declaredFills(`<rect fill='#FFD166'/>`)).toEqual([[255, 209, 102]]);
  });
});

describe('declaredFills, and what it cannot see', () => {
  it('sees a fill in a style attribute, and anything else spelled `fill`', () => {
    // The pattern is `fill` followed by `:` or `=`, unanchored. That is wider
    // than "attributes only": CSS declarations count, and so does `data-fill`.
    // Recorded rather than tightened — over-reporting a colour the artwork
    // really contains is harmless, and the warning is advisory.
    expect(declaredFills(`<rect data-fill="#FFD166"/>`)).toEqual([
      [255, 209, 102],
    ]);
  });

  it('misses rgb() and gradients, which is the hole that matters', () => {
    // **A gradient logo gets no warning at all.** Company marks are
    // gradient-heavy, and a gradient resolves to a `url(#…)` fill that names
    // no colour, so `collisions` sees an empty set and reports nothing while
    // the quantiser flattens the whole ramp. Same for `rgb()` notation.
    // Asserted so the limitation is a recorded fact rather than a surprise.
    expect(declaredFills(`<rect fill="rgb(255,209,102)"/>`)).toEqual([]);
    expect(declaredFills(`<rect fill="url(#grad)"/>`)).toEqual([]);
  });

  it('ignores fill="none" and named colours rather than guessing', () => {
    expect(declaredFills('<rect fill="none"/><rect fill="red"/>')).toEqual([]);
  });
});
