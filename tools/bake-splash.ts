/**
 * Bake the boot splash into a header the firmware can blit without a host.
 *
 *   node tools/bake-splash.ts
 *
 * `assets/clawd/splash.svg` is the source of truth; this writes
 * `packages/device/firmware/blitter/main/splash-data.h`. It is the sprite
 * pipeline's shape — rasterise, snap to the declared palette, encode with the
 * repo's own codec — with two differences that follow from where the output
 * goes.
 *
 * **It captures opaque, so there is no mask.** A sprite is drawn over a pack's
 * background and needs one bit per pixel saying which pixels are its own. The
 * splash *is* the whole screen: it declares its own ground and covers all
 * 55,040 pixels. `snapToPalette` only clears alpha where a pixel both snapped
 * to the background and arrived part-transparent, so a fully opaque capture
 * keeps every pixel — including the eyes, which are the background's own
 * colour and would be holes under a colour key.
 *
 * **It emits C, not TypeScript.** The firmware is flashed once and never
 * changes, and this is the only art it draws by itself. `main/CMakeLists.txt`
 * registers `INCLUDE_DIRS ""`, so a header beside `main.c` needs no build
 * change; `static const` puts the data in `.rodata` — flash, not the 273KB of
 * DRAM left over after the framebuffer.
 *
 * **The format is the wire format.** `encodeRect` emits exactly what
 * `decode_rle()` in `main.c` already consumes: `(count, value)` pairs, u16
 * little-endian, `value` in host RGB565 order for `panel_word()` to byte-swap
 * on the way to the panel. Nothing new is invented, so nothing new can be
 * wrong — the encoder is the one the daemon ships against, exercised the same
 * way.
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from 'playwright';

import { encodeRect } from '@tamaclaude/protocol';

import { BACKGROUND, paletteOf, snapToPalette } from './frame-palette.ts';

const SVG_PATH = 'assets/clawd/splash.svg';
const FONT_PATH = 'assets/fonts/DepartureMono-Regular.woff2';
const OUT_PATH = 'packages/device/firmware/blitter/main/splash-data.h';

/** The panel as the firmware addresses it. `PANEL_LANDSCAPE` is 1. */
const WIDTH = 320;
const HEIGHT = 172;

/** `MODE_RLE` in `main.c`, and `RLE_MODE` in `packages/protocol/src/rle.ts`. */
const MODE_RLE = 1;

/**
 * What the wordmark measures when Departure Mono actually loaded.
 *
 * A webfont that fails to load does not throw — the text silently falls back
 * to a system monospace, bakes a wordmark at the wrong metrics, and every
 * check after this point still passes because the pixels are self-consistent.
 * The only place that mistake is visible is the panel, which is the one place
 * nothing here can look. So it is asserted at the point of capture, against
 * the measurement the committed SVG produces.
 */
const WORDMARK_WIDTH = 165.47;
const WORDMARK_TOLERANCE = 1;

/** Decode our own payload back to runs, so the header shows real numbers. */
function runsOf(payload: Uint8Array): number[][] {
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const runs: number[][] = [];
  for (let offset = 0; offset < view.byteLength; offset += 4) {
    runs.push([view.getUint16(offset, true), view.getUint16(offset + 2, true)]);
  }
  return runs;
}

function headerSource(runs: number[][]): string {
  const hex = (value: number): string =>
    `0x${value.toString(16).padStart(4, '0')}`;
  const body: string[] = [];
  for (let at = 0; at < runs.length; at += 4) {
    const line = runs
      .slice(at, at + 4)
      .map(([count, value]) => `${hex(count ?? 0)}, ${hex(value ?? 0)},`)
      .join(' ');
    body.push(`    ${line}`);
  }
  return `/*
 * The boot splash, baked from ${SVG_PATH} by \`node tools/bake-splash.ts\`.
 *
 * Generated — do not edit by hand. Re-bake it instead.
 *
 * (count, value) pairs, exactly the encoding decode_rle() consumes off the
 * wire: little-endian u16s, value in host RGB565 order for panel_word() to
 * swap. static const, so it lives in flash rather than the framebuffer's DRAM.
 */
#pragma once

#include <stdint.h>

#define SPLASH_WIDTH ${String(WIDTH)}
#define SPLASH_HEIGHT ${String(HEIGHT)}
#define SPLASH_PIXELS (SPLASH_WIDTH * SPLASH_HEIGHT)
#define SPLASH_RUNS ${String(runs.length)}

static const uint16_t splash_rle[SPLASH_RUNS * 2] = {
${body.join('\n')}
};
`;
}

const svg = await readFile(SVG_PATH, 'utf8');
const font = await readFile(FONT_PATH);
const palette = paletteOf(svg);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       @font-face{font-family:'Departure Mono';
                  src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2')}
       html,body{margin:0;padding:0}svg{display:block}
     </style>${svg}`,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const measured = await page.evaluate(() => {
    const node = document.getElementById('wordmark');
    if (node === null) throw new Error('no #wordmark in the splash');
    const box = (node as unknown as SVGGraphicsElement).getBBox();
    return {
      width: box.width,
      loaded: document.fonts.check('26px "Departure Mono"'),
    };
  });
  if (!measured.loaded) {
    throw new Error(
      'Departure Mono did not load — the wordmark would be a fallback face',
    );
  }
  if (Math.abs(measured.width - WORDMARK_WIDTH) > WORDMARK_TOLERANCE) {
    throw new Error(
      `wordmark measured ${measured.width.toFixed(2)}px, expected ${String(WORDMARK_WIDTH)}±${String(WORDMARK_TOLERANCE)} — the font or the text changed`,
    );
  }

  // Opaque: no `omitBackground`. The splash owns every pixel on the panel.
  const raw = await page.screenshot();
  const snapped = await page.evaluate(snapToPalette, {
    uri: `data:image/png;base64,${raw.toString('base64')}`,
    palette,
    bg: [...BACKGROUND] as unknown as (typeof palette)[number],
  });

  const pixels = await page.evaluate(async (uri: string) => {
    const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const out: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      // The same packing as tools/png-rgb565.ts and the RGB565 macro in main.c.
      out.push(
        (((data[i] ?? 0) & 0xf8) << 8) |
          (((data[i + 1] ?? 0) & 0xfc) << 3) |
          (((data[i + 2] ?? 0) & 0xf8) >> 3),
      );
    }
    return { pixels: out, width: canvas.width, height: canvas.height };
  }, snapped.uri);

  if (pixels.width !== WIDTH || pixels.height !== HEIGHT) {
    throw new Error(
      `captured ${String(pixels.width)}x${String(pixels.height)}, expected ${String(WIDTH)}x${String(HEIGHT)}`,
    );
  }

  const encoded = encodeRect(Uint16Array.from(pixels.pixels));
  if (encoded.mode !== MODE_RLE) {
    throw new Error(
      'the splash encoded larger as RLE than raw — decode_rle() would reject it',
    );
  }
  const runs = runsOf(encoded.payload);
  await writeFile(OUT_PATH, headerSource(runs), 'utf8');

  const raw565 = WIDTH * HEIGHT * 2;
  process.stdout.write(
    `  splash  ${String(WIDTH)}x${String(HEIGHT)}  ${String(runs.length)} runs  ` +
      `${String(encoded.payload.byteLength)} bytes of flash  ` +
      `(${(raw565 / encoded.payload.byteLength).toFixed(1)}:1 against ${String(raw565)} raw)  ` +
      `${String(snapped.soft)} pixels snapped\n`,
  );
} finally {
  await browser.close();
}
