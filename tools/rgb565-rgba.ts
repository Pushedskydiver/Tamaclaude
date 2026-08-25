/**
 * RGB565 back to RGBA, for the tools that have to show a panel to a person.
 *
 * Its own module, and not part of `tools/panel-mock.ts`, for the reason
 * `tools/blit-types.ts` gives: `panel-mock.ts` is a script with a CLI at module
 * scope, so importing it to reach one function runs the tool. Its own module is
 * also what lets this be tested at all.
 */
import type { Frame } from '@tamaclaude/protocol';

/**
 * RGB565 back to RGBA, the inverse of `rgb565()` in `@tamaclaude/protocol`.
 *
 * **The one operation in this file with no device counterpart** — the panel
 * writes those bytes straight to SPI and never expands them — so it is the
 * single place the review artefact can be wrong while the device is right.
 * That is why it lives here, exported and tested, rather than inside the
 * function serialised into the page.
 *
 * Each channel's high bits are replicated into the low ones, which is what
 * puts a saturated channel on 255 rather than 248: `(31 << 3) | (31 >> 2)` is
 * `248 | 7`. Plain shifting would darken every colour on the sheet by up to
 * 3%, uniformly and invisibly.
 */
export function toRgba(pixels: Frame['pixels']): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  for (const [i, value] of pixels.entries()) {
    const r = (value >> 11) & 0x1f;
    const g = (value >> 5) & 0x3f;
    const b = value & 0x1f;
    rgba.set(
      [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255],
      i * 4,
    );
  }
  return rgba;
}
