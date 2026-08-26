/** A horizontal run of opaque pixels, in pixel coordinates. */
export type Run = {
  readonly x: number;
  readonly y: number;
  readonly length: number;
};

/**
 * Horizontal runs of opaque pixels in an RGBA bitmap.
 *
 * Runs rather than one entry per pixel. Measured on a 12x14 letterform: 93
 * opaque pixels of 168, in 24 runs. Each run becomes a node the rasteriser
 * walks on every frame of the animation it is pasted into, and `typing.svg`
 * is 16 frames.
 *
 * Opacity is the only channel read. The colour is decided before this — the
 * bitmap arrives already snapped to a palette — so a run carries position and
 * length and the caller supplies the fill.
 */
export function opaqueRuns(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < height; y += 1) {
    let start = -1;
    // `<= width` so a run touching the right edge is closed by the same branch
    // that closes an interior one, rather than needing its own case after the
    // loop — which is the case that gets forgotten.
    for (let x = 0; x <= width; x += 1) {
      const alpha = x < width ? pixels[(y * width + x) * 4 + 3] : 0;
      const on = alpha !== undefined && alpha > 127;
      if (on && start === -1) start = x;
      if (!on && start !== -1) {
        runs.push({ x: start, y, length: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

/** Trim a float to a readable SVG coordinate. */
function coordinate(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/**
 * Runs as SVG `<rect>` elements, positioned in user units.
 *
 * Whole-pixel rects cannot antialias, which is why the art is re-expressed as
 * geometry rather than embedded as a raster: the bitmap arrives snapped, and
 * this keeps it snapped instead of giving the rasteriser another chance to
 * soften the edges. `tools/bake-splash.ts` does the same for the splash
 * wordmark.
 *
 * No fill is emitted — the caller wraps these in a group that carries one, so
 * the mark's colour is one attribute rather than a property of every rect.
 */
export function runsToRects(
  runs: readonly Run[],
  at: {
    readonly unitsPerPixel: number;
    readonly x: number;
    readonly y: number;
  },
): string[] {
  return runs.map((run) => {
    const x = coordinate(at.x + run.x * at.unitsPerPixel);
    const y = coordinate(at.y + run.y * at.unitsPerPixel);
    const width = coordinate(run.length * at.unitsPerPixel);
    const height = coordinate(at.unitsPerPixel);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`;
  });
}
