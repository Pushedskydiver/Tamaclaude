/**
 * RGB565 back to RGBA, for the tools that have to show a panel to a person.
 *
 * Its own module, and not part of `tools/panel-mock.ts`, for the reason
 * `tools/splash-source.ts` gives about the baker: that is a script with
 * top-level `await`, so importing it to reach one function runs it. Its own
 * module is what lets this be tested at all.
 *
 * Not in `packages/protocol` beside `rgb565()`, which it inverts, because
 * nothing that ships ever unpacks — the device writes RGB565 straight to SPI.
 * `protocol` calls itself the vocabulary every package speaks, and this is a
 * build-time concern. If a package ever needs it, that is the moment to move
 * it, and the round-trip test should move with it.
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
