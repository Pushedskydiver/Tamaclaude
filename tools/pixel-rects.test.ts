import { describe, expect, it } from 'vitest';

import { opaqueRuns, runsToRects } from './pixel-rects.ts';

/** RGBA for a `width`x`height` bitmap from a row-per-string mask. `#` = opaque. */
function bitmap(rows: readonly string[]): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      pixels[(y * width + x) * 4 + 3] = cell === '#' ? 255 : 0;
    });
  });
  return { pixels, width, height: rows.length };
}

/**
 * One `<rect>` per horizontal run of opaque pixels.
 *
 * The same expansion `tools/bake-splash.ts` does for the splash wordmark,
 * generalised so a quantised logo can be dropped into an animation's SVG. Runs
 * rather than one rect per pixel because a 12x14 mark is ~170 opaque pixels
 * and ~30 runs, and every rect is a node the rasteriser walks on all 8 frames.
 *
 * Rects on whole pixels also cannot antialias, which is the property the splash
 * header calls out: the art arrives already snapped, and re-rendering it as
 * geometry keeps it that way rather than handing Chromium another chance to
 * soften the edges.
 */
describe('opaqueRuns', () => {
  it('finds one run in a solid row', () => {
    const { pixels, width, height } = bitmap(['###']);
    expect(opaqueRuns(pixels, width, height)).toEqual([
      { x: 0, y: 0, length: 3 },
    ]);
  });

  it('splits a row broken by a gap', () => {
    const { pixels, width, height } = bitmap(['#.##']);
    expect(opaqueRuns(pixels, width, height)).toEqual([
      { x: 0, y: 0, length: 1 },
      { x: 2, y: 0, length: 2 },
    ]);
  });

  it('closes a run that reaches the right edge', () => {
    // The off-by-one that drops the last run: a loop testing `x < width` only
    // inside the body never sees the row end, so a mark touching the edge
    // loses its rightmost run and the shape silently narrows.
    const { pixels, width, height } = bitmap(['.##']);
    expect(opaqueRuns(pixels, width, height)).toEqual([
      { x: 1, y: 0, length: 2 },
    ]);
  });

  it('does not join runs across a row boundary', () => {
    // Two full rows are two runs, not one of length 4. A flat index that
    // forgets the row width produces exactly that.
    const { pixels, width, height } = bitmap(['##', '##']);
    expect(opaqueRuns(pixels, width, height)).toEqual([
      { x: 0, y: 0, length: 2 },
      { x: 0, y: 1, length: 2 },
    ]);
  });

  it('treats half-transparent pixels as absent', () => {
    const { pixels, width, height } = bitmap(['##']);
    pixels[4 + 3] = 127;
    expect(opaqueRuns(pixels, width, height)).toEqual([
      { x: 0, y: 0, length: 1 },
    ]);
  });

  it('finds nothing in a fully transparent bitmap', () => {
    const { pixels, width, height } = bitmap(['..', '..']);
    expect(opaqueRuns(pixels, width, height)).toEqual([]);
  });
});

describe('runsToRects', () => {
  it('places a run at the origin, scaled to user units', () => {
    expect(
      runsToRects([{ x: 0, y: 0, length: 2 }], {
        unitsPerPixel: 0.125,
        x: 6.75,
        y: 11.5,
      }),
    ).toEqual(['<rect x="6.75" y="11.5" width="0.25" height="0.125"/>']);
  });

  it('offsets by pixel position, not by run index', () => {
    // Using the array index instead of `run.x`/`run.y` passes the first test
    // and scrambles every mark with more than one run.
    expect(
      runsToRects([{ x: 3, y: 2, length: 1 }], {
        unitsPerPixel: 0.125,
        x: 0,
        y: 0,
      }),
    ).toEqual(['<rect x="0.375" y="0.25" width="0.125" height="0.125"/>']);
  });

  it('emits no trailing zeros, so the SVG stays readable', () => {
    const [rect] = runsToRects([{ x: 0, y: 0, length: 8 }], {
      unitsPerPixel: 0.125,
      x: 1,
      y: 2,
    });
    expect(rect).toBe('<rect x="1" y="2" width="1" height="0.125"/>');
  });
});
