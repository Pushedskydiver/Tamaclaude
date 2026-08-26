import { describe, expect, it } from 'vitest';

import { scaleToWidth, viewBoxUnits } from './svg-viewbox.ts';

/**
 * The viewBox parse, which has been wrong before in a way that hid.
 *
 * `stageDimensions` in `tools/svg2frames.ts` split on whitespace alone until
 * its comment records the fix: SVG permits commas between viewBox values and
 * leading whitespace is legal, so `"0,0,40,50"` destructured by one position
 * and yielded a negative width that died inside Playwright rather than at the
 * guard. Extracted here so the animation rasteriser and the logo pixelator
 * share one parse rather than two with divergent bug histories.
 */
describe('viewBoxUnits', () => {
  it('reads a plain space-separated viewBox', () => {
    expect(viewBoxUnits('<svg viewBox="0 0 40 50"></svg>')).toEqual({
      width: 40,
      height: 50,
    });
  });

  it('reads commas, which SVG permits between values', () => {
    expect(viewBoxUnits('<svg viewBox="0,0,40,50"></svg>')).toEqual({
      width: 40,
      height: 50,
    });
  });

  it('tolerates leading whitespace and mixed separators', () => {
    expect(viewBoxUnits('<svg viewBox="  0, 0 40,  50 "></svg>')).toEqual({
      width: 40,
      height: 50,
    });
  });

  it('reads a non-zero origin without letting it reach the size', () => {
    // The first two values are min-x and min-y. A parse that returned them, or
    // that subtracted them, would still look right on the `0 0` cases above.
    expect(viewBoxUnits('<svg viewBox="10 20 40 50"></svg>')).toEqual({
      width: 40,
      height: 50,
    });
  });

  it('reads fractional units without rounding them here', () => {
    // Rounding belongs to whoever picks a pixel size, not to the parse.
    expect(viewBoxUnits('<svg viewBox="0 0 40.5 50.25"></svg>')).toEqual({
      width: 40.5,
      height: 50.25,
    });
  });

  it('reads a single-quoted viewBox, which the same exporters emit', () => {
    // The other half of the quoting hole. `declaredFills` in
    // `tools/palette-map.ts` was widened to both quote styles on 26 Aug and
    // this was not, so a logo exported with single quotes failed here — on the
    // very first thing `logo2pixel.ts` does with it — while the fix for the
    // same problem sat one module over.
    expect(viewBoxUnits(`<svg viewBox='0 0 40 50'></svg>`)).toEqual({
      width: 40,
      height: 50,
    });
  });
});

describe('viewBoxUnits refuses what it cannot use', () => {
  it('refuses an SVG with no viewBox', () => {
    expect(() => viewBoxUnits('<svg width="40"></svg>')).toThrow(/viewBox/);
  });

  it('refuses a viewBox with the wrong number of values', () => {
    expect(() => viewBoxUnits('<svg viewBox="0 0 40"></svg>')).toThrow(
      /viewBox/,
    );
  });

  it('refuses zero and negative extents, which render as nothing', () => {
    for (const bad of ['0 0 0 50', '0 0 40 0', '0 0 -40 50']) {
      expect(() => viewBoxUnits(`<svg viewBox="${bad}"></svg>`)).toThrow(
        /viewBox/,
      );
    }
  });
});

/**
 * Pixel size for a target width, which is what a logo is scaled by.
 *
 * A logo has no fixed aspect — it is whatever the recipient's is — so the
 * caller picks one dimension and this derives the other. Rounding the derived
 * side rather than truncating it matters at logo sizes: a 48x11.6 logo
 * truncates to 11 and loses a row that is over half covered.
 */
describe('scaleToWidth', () => {
  it('scales height by the aspect ratio', () => {
    expect(scaleToWidth({ width: 40, height: 50 }, 80)).toEqual({
      width: 80,
      height: 100,
    });
  });

  it('rounds the derived side rather than truncating it', () => {
    // 48 * (29/120) = 11.6 -> 12. Truncation would drop a row that is 60% lit.
    expect(scaleToWidth({ width: 120, height: 29 }, 48)).toEqual({
      width: 48,
      height: 12,
    });
  });

  it('never derives a zero height, however wide the source', () => {
    // A 1000x1 rule scaled to 8px wide is 0.008 tall. Zero is not a raster
    // Playwright will take, and silently emitting nothing is worse than a
    // one-pixel line.
    expect(scaleToWidth({ width: 1000, height: 1 }, 8).height).toBe(1);
  });

  it('refuses a width that is not a positive whole number', () => {
    for (const bad of [0, -8, 2.5]) {
      expect(() => scaleToWidth({ width: 40, height: 50 }, bad)).toThrow(
        /width/,
      );
    }
  });
});
