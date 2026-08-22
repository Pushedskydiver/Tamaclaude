/**
 * Bake the boot splash into a header the firmware can blit without a host.
 *
 *   pnpm bake:splash
 *
 * `assets/clawd/splash.svg` is the source of truth; this writes
 * `packages/device/firmware/blitter/main/splash-data.h`. It is the sprite
 * pipeline's shape — rasterise, snap to the declared palette, encode with the
 * repo's own codec — with three differences that follow from where the output
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
 * **It draws the wordmark instead of typing it.** `#wordmark` in the SVG is a
 * placeholder, expanded here into one rectangle per run of set pixels from
 * `packages/renderer/src/font-data.ts` — the glyph table the renderer draws
 * quips with. Two things fall out of that. The splash and the running device
 * share a face by construction rather than by both naming Departure Mono. And
 * rectangles on whole pixels cannot antialias, which is the only way to be rid
 * of the contamination described in the SVG: Chromium greyscale-antialiases
 * glyph outlines at every size, and the resulting soft edges snapped to
 * Clawd's body salmon rather than to either colour they sat between.
 *
 * **It emits C, not TypeScript.** The firmware is flashed once and never
 * changes, and this is the only art it draws by itself. `static const` puts
 * the table in `.rodata` — flash, rather than the DRAM the framebuffer already
 * has 110,080 bytes of. (`build/blitter.map` after a build: `.rodata` in
 * `drom_seg`, and 272,928 bytes of SRAM left unallocated, which is the figure
 * `main.c`'s "~270KB spare" rounds.) `#include "splash-data.h"` resolves
 * relative to `main.c`, so no build file changes; `main/CMakeLists.txt` lists
 * `SRCS "main.c"` only, and headers are not listed there in any case.
 *
 * **The format is the wire format.** `encodeRect` emits exactly what
 * `decode_rle()` in `main.c` consumes off USB: `(count, value)` pairs, u16
 * little-endian, `value` in host RGB565 order for `panel_word()` to byte-swap
 * on the way to the panel. Nothing new is invented, so nothing new can be
 * wrong — the encoder is the one the daemon ships against, exercised the same
 * way. The splash does not travel over USB and never meets `parse_header`;
 * only the payload encoding is shared.
 */
import type { Rgb } from './frame-palette.ts';

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from 'playwright';

import { encodeRect } from '@tamaclaude/protocol';

import { fingerprint } from './art-fingerprint.ts';
import { BACKGROUND, paletteOf, snapToPalette } from './frame-palette.ts';
import { withWordmark } from './splash-source.ts';

const SVG_PATH = 'assets/clawd/splash.svg';
const OUT_PATH = 'packages/device/firmware/blitter/main/splash-data.h';

/** The panel as the firmware addresses it, when `PANEL_LANDSCAPE` is 1. */
const WIDTH = 320;
const HEIGHT = 172;

/** `MODE_RLE` in `main.c`, and `RLE_MODE` in `packages/protocol/src/rle.ts`. */
const MODE_RLE = 1;

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

function headerSource(runs: number[][], source: string): string {
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
 * The boot splash, baked from ${SVG_PATH} by \`pnpm bake:splash\`.
 *
 * Generated — do not edit by hand. Re-bake it instead.
 *
 * SPLASH_SOURCE is a hash of the artwork this came from, comments and
 * whitespace excluded. tools/bake-splash.test.ts fails when it stops matching
 * assets/clawd/splash.svg, which is how "edited the art, forgot to re-bake"
 * is caught — the firmware is flashed once, so that mistake ships forever.
 *
 * (count, value) pairs, the same payload encoding decode_rle() consumes off
 * the wire: little-endian u16s, value in host RGB565 order for panel_word() to
 * swap. There is no mode byte here or there — on USB the mode travels in the
 * rect header instead. static const, so this lives in flash rather than the
 * DRAM the framebuffer already holds.
 */
#pragma once

#include <stdint.h>

#define SPLASH_WIDTH ${String(WIDTH)}
#define SPLASH_HEIGHT ${String(HEIGHT)}
#define SPLASH_PIXELS (SPLASH_WIDTH * SPLASH_HEIGHT)
#define SPLASH_RUNS ${String(runs.length)}
#define SPLASH_SOURCE "${source}"

static const uint16_t splash_rle[SPLASH_RUNS * 2] = {
${body.join('\n')}
};
`;
}

const artwork = await readFile(SVG_PATH, 'utf8');
const svg = withWordmark(artwork);
const palette = paletteOf(svg);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  // No @font-face: the wordmark is rectangles by the time it gets here, which
  // is why there is no "did the webfont load" guard to get wrong.
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0}svg{display:block}
     </style>${svg}`,
  );

  // Opaque: no `omitBackground`. The splash owns every pixel on the panel.
  const raw = await page.screenshot();
  const snapped = await page.evaluate(snapToPalette, {
    uri: `data:image/png;base64,${raw.toString('base64')}`,
    palette,
    bg: [...BACKGROUND] as unknown as Rgb,
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
      'the splash encoded larger as RLE than raw, so the table would not be runs',
    );
  }
  const runs = runsOf(encoded.payload);
  await writeFile(OUT_PATH, headerSource(runs, fingerprint(artwork)), 'utf8');

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
