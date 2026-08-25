#!/usr/bin/env node
/**
 * Quantise a logo SVG to a pack's palette, at panel pixel density.
 *
 *   node tools/logo2pixel.ts <logo.svg> [out.png] [--pack packs/other]
 *                            [--width 48] [--over '#RRGGBB']
 *
 * `BUILD_PLAN.md` Stage 5 calls this "SVG → nearest-neighbour → palette
 * quantise (`sharp`)", and the screen spec's asset table calls it the logo
 * pixelation script. **It needs no `sharp`.** Both halves already existed for
 * the animation pipeline: Playwright rasterises the SVG the way
 * `tools/svg2frames.ts` does, and `snapToPalette` in `tools/frame-palette.ts`
 * is already nearest-neighbour in RGB against a palette it is handed. That
 * function was written to snap frames to an SVG's *own* declared colours, to
 * undo antialiasing; the palette is a parameter, so pointing it at a pack's
 * palette instead is the whole of the difference.
 *
 * **The pack is the palette source, and the logo is never in this repo.** A
 * logo is personal content, so it lives in a gitignored pack directory beside
 * `manifest.json` — `packages/cli/src/pack.ts` explains why a pack is a
 * directory rather than a file. This script takes a path and a pack and writes
 * a PNG; it names no company and ships no artwork.
 *
 * ## Putting one on the laptop lid
 *
 * `typing.svg`'s `#fx-laptop-logo` is the slot, and its own comment says a
 * pack "replaces it wholesale". Measured, at the stage's 8 device pixels per
 * user unit: the lid is `x 2.25..12.75, y 11..13.5`, so **84 x 20 px**. That
 * height is the binding constraint, not the width.
 *
 *   node tools/logo2pixel.ts pack/logo.svg --width 12 \
 *     --over '#RRGGBB' --format rects
 *
 * then wrap the output in `<g transform="translate(6.75,11.375)">` inside the
 * logo group. **12 px wide is the size to beat.** A portrait mark at 12 comes
 * out 14 tall, which centres with 3 px of lid above and below; 15 wide fills
 * the lid to within a pixel and reads as crammed; below 12 the interior detail
 * of a mark starts merging into its outline. Those numbers are for an
 * 0.83-aspect mark — recompute for another, since it is height that has to
 * fit.
 *
 * A wider mark gets more pixels inside the same 20 px, which sounds like it
 * should win and does not: recognition at this size comes from structure, and
 * a letterform survives where an abstract shape becomes a blob. Tested.
 *
 * **Nothing renders the output yet.** `packages/packs` has no logo field —
 * "props and a logo land with the renderer" — so this produces the asset and
 * the schema work is a separate item. That is deliberate: the pixel art is
 * what needs judging by eye against a real palette, and it can be judged
 * before anything draws it.
 *
 * **A logo is quantised against a ground, and the ground is a choice.** Partly
 * transparent pixels are composited over `--over` before the nearest colour is
 * picked, and `snapToPalette` clears alpha only where a pixel both resolved to
 * that ground and arrived non-opaque. The default is the pack's background,
 * `palette[0]`, because that is the only ground a pack defines. A logo bound
 * for the laptop lid in `typing` sits on the lid instead, so it wants
 * `--over` set to the lid colour and a re-bake — the same art quantised
 * against a different ground is a different picture at the edges.
 */
import type { Rgb } from './frame-palette.ts';

import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { loadPack } from './blit-scene.ts';
import { snapToPalette } from './frame-palette.ts';
import { collisions, declaredFills } from './palette-map.ts';
import { opaqueRuns, runsToRects } from './pixel-rects.ts';
import { scaleToWidth, viewBoxUnits } from './svg-viewbox.ts';

/**
 * Default width in panel pixels.
 *
 * The landscape stage is 168px wide and the message band 152px, so 48 is
 * roughly a third of either — small enough to sit as a prop rather than as
 * the subject, and large enough that a wordmark is still legible at 1:1.
 * Nothing consumes it yet, so this is a starting point for looking, not a
 * measurement of a slot that exists.
 */
const DEFAULT_WIDTH = 48;

/** `#RRGGBB` to a triple, for `--over`. */
function parseHex(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    pack: { type: 'string', default: 'packs/example' },
    width: { type: 'string', default: String(DEFAULT_WIDTH) },
    over: { type: 'string' },
    // `png` to look at, `rects` to paste. An animation SVG cannot embed a
    // raster and stay hard-edged — `tools/bake-splash.ts` expands the splash
    // wordmark to rects for the same reason — so the mark that goes into
    // `typing.svg`'s logo group is geometry, not an image.
    format: { type: 'string', default: 'png' },
    // Device pixels per user unit, matching `tools/svg2frames.ts`'s third
    // argument. The stage renders at 8, so a pixel is 0.125 units.
    scale: { type: 'string', default: '8' },
  },
});
if (values.format !== 'png' && values.format !== 'rects') {
  console.error(`--format takes 'png' or 'rects', not '${values.format}'`);
  process.exit(1);
}

const [svgArg, outArg] = positionals;
if (svgArg === undefined) {
  console.error(
    'usage: node tools/logo2pixel.ts <logo.svg> [out.png] ' +
      "[--pack <dir>] [--width 48] [--over '#RRGGBB']",
  );
  process.exit(1);
}

const width = Number(values.width);
const svg = await readFile(resolve(svgArg), 'utf8');
const pack = await loadPack(resolve(values.pack));
const palette = pack.palette.map((entry) => [...entry] as unknown as Rgb);
const background = palette[0];
if (background === undefined) throw new Error('pack palette is empty');
const over = values.over === undefined ? background : parseHex(values.over);

/** `#RRGGBB` for a report line. */
function hexOf(colour: Rgb): string {
  return `#${colour.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// **The failure this tool has that nothing else would catch.** A pack palette
// is four colours; a logo is not. Two marks whose nearest entry is the same
// one merge, and the mark that lost simply is not in the output — no error, no
// empty file, just a picture missing a shape. A fixture with a purple field
// and a yellow disc came back as a flat orange rectangle.
for (const clash of collisions(declaredFills(svg), palette)) {
  const names = clash.sources.map((colour) => hexOf(colour));
  const listed = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  console.warn(
    `warning: ${listed} all become ${hexOf(clash.target)} — this palette ` +
      `cannot tell them apart, so whichever is drawn over the others will ` +
      `absorb them`,
  );
}

const size = scaleToWidth(viewBoxUnits(svg), width);
const out = outArg ?? `out/${basename(resolve(svgArg), '.svg')}-${width}.png`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: size,
    deviceScaleFactor: 1,
  });
  // The SVG is stretched to the viewport rather than the viewport sized to the
  // SVG's own width/height attributes, which a logo may not carry at all — the
  // viewBox is the only dimension guaranteed to be there.
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0}
       svg{display:block;width:100%;height:100%}
     </style>${svg}`,
  );
  // `omitBackground`, unlike the splash: a logo is a prop drawn over whatever
  // is behind it, so it needs the alpha that tells the renderer which pixels
  // are its own.
  const raw = await page.screenshot({ omitBackground: true });
  const snapped = await page.evaluate(snapToPalette, {
    uri: `data:image/png;base64,${raw.toString('base64')}`,
    palette,
    bg: over,
  });
  const total = size.width * size.height;
  if (values.format === 'rects') {
    // Rects are emitted from the origin so placement is the caller's, via an
    // enclosing `<g transform="translate(x,y)">`. Baking a position in would
    // mean three more flags and a tool that only knows about one slot.
    const pixels = await page.evaluate(async (uri: string) => {
      const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('no 2d context');
      context.drawImage(bitmap, 0, 0);
      return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
    }, snapped.uri);
    const runs = opaqueRuns(
      new Uint8ClampedArray(pixels),
      size.width,
      size.height,
    );
    const unitsPerPixel = 1 / Number(values.scale);
    console.log(
      `<!-- ${basename(resolve(svgArg))} at ${size.width}x${size.height}px, ` +
        `${runs.length} rects, ${unitsPerPixel} units per pixel -->`,
    );
    console.log(runsToRects(runs, { unitsPerPixel, x: 0, y: 0 }).join('\n'));
  } else {
    const base64 = snapped.uri.replace(/^data:image\/png;base64,/, '');
    await writeFile(resolve(out), Buffer.from(base64, 'base64'));
    console.log(
      `logo -> ${out} (${size.width}x${size.height}, ` +
        `${palette.length} colours, ${snapped.soft} of ${total} px snapped)`,
    );
  }
} finally {
  await browser.close();
}
