/**
 * Decode rendered PNG frames to RGB565, in Chromium.
 *
 * Split out of `tools/measure-compression.ts` when `tools/blit.ts` needed the
 * same decode. Two copies of a pixel loop is precisely how a channel order or
 * a stride drifts between the tool that measures what the wire costs and the
 * tool that actually drives it — and the two disagreeing would be invisible
 * from either side.
 *
 * Frames are decoded in Chromium because Playwright is already a dependency;
 * adding a PNG decoder to ship one number would be worse.
 *
 * Same constraint as `tools/frame-palette.ts`: `toRgb565` runs inside the
 * page, so it must not close over anything in this module. Playwright
 * serialises the function source and evaluates it in a context where this file
 * does not exist.
 */
import type { Frame } from '@tamaclaude/protocol';
import type { Page } from 'playwright';

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { frame as makeFrame } from '@tamaclaude/protocol';

/**
 * A decoded raster and which of its pixels are actually drawn.
 *
 * Two arrays rather than one, because RGB565 has no alpha and the alternative
 * — reserving a colour to mean "transparent" — cannot work here: the art's own
 * palette contains black, so a key on black would punch holes through Clawd's
 * eyes.
 */
export type Sprite = {
  readonly frame: Frame;
  /** 1 where the pixel is drawn, 0 where the background shows through. */
  readonly mask: Uint8Array;
};

/**
 * Decode a PNG to RGB565 in the page, where a canvas already exists.
 *
 * Not exported: `loadFrames` is the only sane way to call it, since it is
 * meaningless outside a `page.evaluate`.
 */
function toRgb565(
  dataUri: string,
): Promise<{ pixels: number[]; width: number; mask: number[] }> {
  return new Promise((done, fail) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) return fail(new Error('no 2d context'));
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const pixels: number[] = [];
      // Alpha travels alongside as a 1-bit mask, because RGB565 has nowhere to
      // put it and dropping it is not harmless: `svg2frames.ts` captures with
      // `omitBackground`, so a raster's transparent pixels arrive as alpha 0
      // over black. Discarding that made the sprite an opaque black rectangle
      // which painted over the pack background — and a colour key cannot
      // recover it, because Clawd's eyes and mouth are black too. Keeping the
      // mask is the only thing that distinguishes "nothing here" from "here is
      // something black".
      const mask: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push(
          ((data[i] & 0xf8) << 8) |
            ((data[i + 1] & 0xfc) << 3) |
            ((data[i + 2] & 0xf8) >> 3),
        );
        mask.push(data[i + 3] > 8 ? 1 : 0);
      }
      done({ pixels, width: image.width, mask });
    });
    image.addEventListener('error', () => fail(new Error('decode failed')));
    image.src = dataUri;
  });
}

/** PNG file names in a frame directory, in the order they play. */
export async function frameNames(frameDir: string): Promise<string[]> {
  // Lexicographic, which is why `svg2frames.ts` pads the index wide enough
  // that frame_100 cannot sort between frame_10 and frame_11.
  return (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
}

/** Every PNG in a directory, in play order, decoded to RGB565. */
export async function loadFrames(
  page: Page,
  frameDir: string,
): Promise<Sprite[]> {
  const names = await frameNames(frameDir);
  if (names.length === 0) throw new Error(`no PNGs in ${frameDir}`);
  const frames: Sprite[] = [];
  for (const name of names) {
    const bytes = await readFile(resolve(frameDir, name));
    const uri = `data:image/png;base64,${bytes.toString('base64')}`;
    const decoded = await page.evaluate(toRgb565, uri);
    frames.push({
      frame: makeFrame(Uint16Array.from(decoded.pixels), decoded.width),
      mask: Uint8Array.from(decoded.mask),
    });
  }
  return frames;
}
