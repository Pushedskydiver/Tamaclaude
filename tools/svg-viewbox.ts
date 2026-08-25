/**
 * The width and height an SVG's viewBox declares, in user units.
 *
 * The one place this repo reads a viewBox. Extracted from `stageDimensions` in
 * `tools/svg2frames.ts` when the logo pixelator needed the same parse: two
 * copies would mean two bug histories, and this parse already has one worth
 * keeping. Splitting on whitespace alone mis-handles `viewBox="0,0,40,50"`,
 * which SVG permits — the destructure shifts by one position and yields a
 * negative width that dies inside Playwright rather than at the guard here.
 *
 * Returns the extents only. The first two values are the origin, and a caller
 * wanting a pixel size wants `width`/`height` unrounded, because rounding
 * belongs to whoever picks the scale.
 */
export function viewBoxUnits(svg: string): {
  readonly width: number;
  readonly height: number;
} {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (viewBox === undefined) throw new Error('no viewBox in input SVG');
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , width, height] = parts;
  if (
    parts.length !== 4 ||
    width === undefined ||
    height === undefined ||
    !(width > 0) ||
    !(height > 0)
  ) {
    throw new Error(`bad viewBox: "${viewBox}"`);
  }
  return { width, height };
}

/**
 * Pixel size for a target width, preserving the source's aspect ratio.
 *
 * A logo's aspect is whatever the recipient's logo is, so the caller fixes one
 * dimension and this derives the other. The derived side is rounded rather
 * than truncated — at logo sizes truncation drops a row that may be most of
 * the way covered — and floored at one, because a wide thin rule scaled small
 * otherwise asks Playwright for a zero-height raster and gets nothing.
 */
export function scaleToWidth(
  units: { readonly width: number; readonly height: number },
  width: number,
): { readonly width: number; readonly height: number } {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`width must be a positive whole number, got ${width}`);
  }
  return {
    width,
    height: Math.max(1, Math.round((width * units.height) / units.width)),
  };
}
