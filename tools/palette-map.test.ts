import type { Rgb } from './frame-palette.ts';

import { describe, expect, it } from 'vitest';

import { collisions, declaredFills, nearestIn } from './palette-map.ts';

/**
 * A four-entry palette shaped like a real one, not read from any pack.
 *
 * Deliberately not `packs/example`'s. These functions are pure and the
 * assertions below are about relationships between the numbers, so binding
 * them to a shipped manifest would make this test fail when that manifest
 * changed for unrelated reasons. Writing the same values here and *calling*
 * them `packs/example`'s would be worse again: a second source of truth that
 * `tools/one-panel-renderer.test.ts` cannot catch, because that gate greps
 * hex strings and these are decimals.
 */
const PACK: Rgb[] = [
  [13, 17, 23],
  [201, 209, 217],
  [247, 120, 73],
  [63, 185, 80],
];

describe('nearestIn', () => {
  it('returns an exact match unchanged', () => {
    expect(nearestIn([247, 120, 73], PACK)).toEqual([247, 120, 73]);
  });

  it('picks the least-distant entry', () => {
    expect(nearestIn([250, 125, 70], PACK)).toEqual([247, 120, 73]);
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
    const purple: Rgb = [123, 45, 142];
    const yellow: Rgb = [255, 209, 102];
    const found = collisions([purple, yellow], PACK);
    expect(found).toHaveLength(1);
    expect(found[0]?.target).toEqual([247, 120, 73]);
    expect(found[0]?.sources).toEqual([purple, yellow]);
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
    expect(collisions([[247, 120, 73]], PACK)).toEqual([]);
  });

  it('groups three sources onto one entry as a single collision', () => {
    const found = collisions(
      [
        [250, 125, 70],
        [245, 118, 75],
        [240, 130, 80],
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

  it('ignores fill="none" and named colours rather than guessing', () => {
    expect(declaredFills('<rect fill="none"/><rect fill="red"/>')).toEqual([]);
  });
});
