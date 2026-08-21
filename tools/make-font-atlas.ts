#!/usr/bin/env node
/**
 * Bake Departure Mono into 1-bit glyph bitmaps for the renderer.
 *
 * Build-time tooling, deliberately outside `packages/` — it is never shipped.
 * Run with Node's native TypeScript support:
 *
 *   node tools/make-font-atlas.ts
 *
 * `BUILD_PLAN.md` Stage 1 lists an `@napi-rs/canvas` sink, written before this
 * decision settled. Rasterising glyphs at run time would put a native
 * dependency inside `renderer`, which `daemon` imports, and would risk
 * antialiased text on a panel whose entire aesthetic is hard pixels. Departure
 * Mono is a *pixel* font: at its design size it rasterises exactly, so bake it
 * once here and let the renderer stay pure TypeScript with no dependencies.
 *
 * **The size is measured, not chosen.** A pixel font has exactly one size at
 * which the outlines land on pixel boundaries, and it is not guessable from
 * the file — 11px for this face, where the advance is exactly 7px. The scan
 * below proves it rather than asserting it, so swapping the typeface cannot
 * silently bake a blurry atlas.
 *
 * What "no antialiasing" means here, precisely: Skia puts a faint contrast
 * halo around every glyph mask whatever the size, so the test is not "no
 * non-opaque pixels". It is that coverage is *bimodal* — every pixel is either
 * fully inked or part of that halo, with nothing in between. At 11px the
 * alphas are {1..63} and {255}, a clean gap; at every neighbouring size they
 * spread across the middle, which is real partial coverage.
 */
import type { Browser, Page } from 'playwright';

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from 'playwright';

/** Printable ASCII. Nothing on this panel is outside it — see `text.ts`. */
const FIRST_CODE_POINT = 0x20;
const LAST_CODE_POINT = 0x7e;

/** Sizes to scan, in device pixels. Wide enough to catch a different face. */
const CANDIDATE_SIZES = Array.from({ length: 27 }, (_, index) => index + 6);

/**
 * A pixel counts as ink at half coverage or more, and as *partial* coverage —
 * the thing that disqualifies a size — between the halo ceiling and opaque.
 * The halo Skia adds at the design size tops out at alpha 63, so 64 is the
 * floor of the band where genuine antialiasing would land.
 */
const INK_THRESHOLD = 128;
const HALO_CEILING = 64;

const REPO_ROOT = join(import.meta.dirname, '..');
const FONT_PATH = join(REPO_ROOT, 'assets/fonts/DepartureMono-Regular.woff2');
const OUT_PATH = join(REPO_ROOT, 'packages/renderer/src/font-data.ts');

type Spec = {
  readonly size: number;
  readonly first: number;
  readonly last: number;
  readonly threshold: number;
  readonly halo: number;
};

type Coverage = {
  /** Advance width, as the font reports it. Fractional at the wrong size. */
  readonly advance: number;
  /** Pixels with genuine partial coverage. Zero at the design size. */
  readonly partial: number;
  /** Ink pixels across every glyph, wherever on the canvas they landed. */
  readonly inked: number;
};

/**
 * Measure how one size rasterises, without packing anything.
 *
 * Runs inside Chromium — it is serialised to source and cannot close over
 * anything above, which is why every constant arrives in `spec`.
 */
function coverage(spec: Spec): Coverage {
  const cell = spec.size * 4;
  const canvas = document.createElement('canvas');
  canvas.width = cell;
  canvas.height = cell;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d canvas context');
  context.font = `${spec.size}px atlas`;
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#000';
  let partial = 0;
  let inked = 0;
  for (let code = spec.first; code <= spec.last; code += 1) {
    context.clearRect(0, 0, cell, cell);
    context.fillText(String.fromCodePoint(code), spec.size, spec.size * 2);
    const data = context.getImageData(0, 0, cell, cell).data;
    for (let alpha = 3; alpha < data.length; alpha += 4) {
      if (data[alpha] >= spec.halo && data[alpha] < 255) partial += 1;
      if (data[alpha] >= spec.threshold) inked += 1;
    }
  }
  return { advance: context.measureText('M').width, partial, inked };
}

type Raster = {
  /** Advance width; also the number of bits each packed row uses. */
  readonly advance: number;
  /** Rows per glyph in `rows`, the first being `size` above the baseline. */
  readonly window: number;
  /** Flat row bitmasks, `window` per glyph, bit `advance - 1` leftmost. */
  readonly rows: readonly number[];
};

/**
 * Rasterise every glyph and pack each row to a bitmask. Also in-page.
 *
 * Reads back only the advance box rather than the whole canvas, so every
 * pixel it sees is inside the cell by construction and the packing loop needs
 * no bounds arithmetic. Ink that fell outside is therefore silently dropped
 * here — which is what the ink count from `coverage` is for.
 */
function rasterise(spec: Spec): Raster {
  const cell = spec.size * 4;
  const canvas = document.createElement('canvas');
  canvas.width = cell;
  canvas.height = cell;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d canvas context');
  context.font = `${spec.size}px atlas`;
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#000';
  const columns = Math.round(context.measureText('M').width);
  const window = spec.size * 2 + 1;
  const rows: number[] = [];
  for (let code = spec.first; code <= spec.last; code += 1) {
    context.clearRect(0, 0, cell, cell);
    context.fillText(String.fromCodePoint(code), spec.size, spec.size * 2);
    const box = context.getImageData(spec.size, spec.size, columns, window);
    const glyph = new Array<number>(window).fill(0);
    for (let pixel = 0; pixel < columns * window; pixel += 1) {
      if (box.data[pixel * 4 + 3] < spec.threshold) continue;
      const column = pixel % columns;
      glyph[(pixel - column) / columns] |= 1 << (columns - 1 - column);
    }
    rows.push(...glyph);
  }
  return { advance: columns, window, rows };
}

/** A page with the vendored font loaded under a fixed family name. */
async function openFontPage(browser: Browser): Promise<Page> {
  const font = await readFile(FONT_PATH);
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.setContent(
    `<style>@font-face{font-family:'atlas';src:url(data:font/woff2;base64,` +
      `${font.toString('base64')}) format('woff2')}</style>`,
  );
  // Without this the first measureText silently falls back to a system font,
  // and the scan then reports that no size is clean.
  await page.evaluate(async () => {
    await document.fonts.load('16px atlas');
    await document.fonts.ready;
  });
  return page;
}

function specFor(size: number): Spec {
  return {
    size,
    first: FIRST_CODE_POINT,
    last: LAST_CODE_POINT,
    threshold: INK_THRESHOLD,
    halo: HALO_CEILING,
  };
}

/**
 * Every size that rasterised cleanly, for the generated header to report.
 * Module-level because `emit` needs it and threading it through would push
 * that function past its parameter limit for the sake of one string.
 */
let cleanSizes: number[] = [];

/**
 * The smallest size at which the face rasterises exactly.
 *
 * Two conditions, both necessary. An integer advance means the glyph cells
 * tile the panel without drift; zero partial coverage means the outlines land
 * on pixel boundaries. A face can satisfy the first and fail the second.
 */
async function naturalSize(page: Page): Promise<number> {
  const clean: number[] = [];
  for (const size of CANDIDATE_SIZES) {
    const measured = await page.evaluate(coverage, specFor(size));
    const exact = Number.isInteger(measured.advance) && measured.partial === 0;
    if (exact) clean.push(size);
    console.log(
      `  ${String(size).padStart(2)}px  advance ` +
        `${measured.advance.toFixed(3)}  partial ` +
        `${String(measured.partial).padStart(5)}${exact ? '  <- clean' : ''}`,
    );
  }
  const [smallest] = clean;
  // Recorded so `emit` can state what was actually found rather than asserting
  // uniqueness nobody checked. The generated header used to claim 11px was the
  // *only* clean size in the range; this function returns the *smallest*, and
  // never compared the two. True for this face, unenforced for the next one.
  cleanSizes = clean;
  if (smallest === undefined) {
    throw new Error(
      `no size in ${CANDIDATE_SIZES[0]}..${CANDIDATE_SIZES.at(-1)} rasterises ` +
        `without antialiasing — is this still a pixel font?`,
    );
  }
  console.log(`clean sizes: ${clean.join(', ')} — baking at ${smallest}px`);
  return smallest;
}

type Atlas = {
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly glyphs: readonly (readonly number[])[];
};

/**
 * Trim the scan window down to the union ink box of every glyph.
 *
 * The cell has to be the union rather than per-glyph bounds: a shared cell is
 * what puts every baseline on the same row, and per-glyph trimming would mean
 * storing an offset per glyph to put it back.
 */
function crop(raster: Raster, size: number): Atlas {
  const count = LAST_CODE_POINT - FIRST_CODE_POINT + 1;
  const used = (row: number): boolean =>
    raster.rows.some(
      (mask, index) => mask !== 0 && index % raster.window === row,
    );
  const rows = Array.from({ length: raster.window }, (_, row) => row);
  const inked = rows.filter((row) => used(row));
  const top = inked[0];
  const bottom = inked.at(-1);
  if (top === undefined || bottom === undefined) {
    throw new Error('every glyph rasterised empty');
  }
  const glyphs = Array.from({ length: count }, (_, glyph) =>
    raster.rows.slice(
      glyph * raster.window + top,
      glyph * raster.window + bottom + 1,
    ),
  );
  return { size, width: raster.advance, height: bottom - top + 1, glyphs };
}

/**
 * Fail if any ink fell outside the advance box.
 *
 * `rasterise` reads back only the cell, so a glyph that overhangs its advance
 * loses those pixels and the atlas quietly ships a clipped letter. Comparing
 * the packed bit count against the ink `coverage` saw on the whole canvas is
 * what turns that into a build failure rather than a typo nobody spots.
 */
function checkNothingEscaped(atlas: Atlas, inked: number): void {
  const bits = atlas.glyphs
    .flat()
    .reduce(
      (total, mask) => total + mask.toString(2).replaceAll('0', '').length,
      0,
    );
  if (bits === inked) return;
  throw new Error(
    `${inked - bits} ink pixels fell outside the ${atlas.width}px advance — ` +
      `this face is not monospaced within its advance and needs per-glyph ` +
      `bounds, not a shared cell`,
  );
}

/** One source line per glyph: its rows in hex, labelled with its character. */
function glyphLines(atlas: Atlas): string {
  return atlas.glyphs
    .map((rows, index) => {
      const code = FIRST_CODE_POINT + index;
      const hex = rows
        .map((mask) => `0x${mask.toString(16).padStart(2, '0')}`)
        .join(', ');
      const label = code === 0x20 ? 'space' : String.fromCodePoint(code);
      return `  ${hex}, // U+${code.toString(16).toUpperCase().padStart(4, '0')} ${label}`;
    })
    .join('\n');
}

function emit(atlas: Atlas): string {
  return `/**
 * Departure Mono baked to 1-bit bitmaps, printable ASCII only.
 *
 * Generated by \`node tools/make-font-atlas.ts\` — do not edit by hand.
 *
 * ${atlas.size}px is the face's design size, measured rather than chosen. Sizes
 * in 6..32 that rasterise cleanly: ${cleanSizes.join(', ')} — the smallest is
 * baked.
 *
 * "Cleanly" is not "no pixel is partially covered", and the distinction
 * matters to anyone who checks: Skia puts a faint contrast halo around every
 * glyph at every size, so a few thousand pixels do come back at low alpha. The
 * test is that coverage is *bimodal* — at this size the alphas are exactly
 * {1..63} and {255}, with nothing in between, so thresholding recovers the
 * intended 1-bit mask with no judgement call. Rasterising at a size without
 * that gap would put genuinely antialiased edges on a panel with no colours to
 * blend towards.
 */

/** Advance width of every glyph. Departure Mono is monospaced. */
export const GLYPH_WIDTH = ${atlas.width};

/** Cell height: the union ink box of every glyph, so baselines align. */
export const GLYPH_HEIGHT = ${atlas.height};

/** Code point of the first glyph; the atlas runs contiguously from here. */
export const FIRST_CODE_POINT = 0x${FIRST_CODE_POINT.toString(16)};

/**
 * Row bitmasks, \`GLYPH_HEIGHT\` per glyph, top row first, bit
 * \`GLYPH_WIDTH - 1\` leftmost.
 */
// prettier-ignore
export const GLYPH_ROWS: readonly number[] = [
${glyphLines(atlas)}
];
`;
}

const browser = await chromium.launch();
const page = await openFontPage(browser);
const size = await naturalSize(page);
const measured = await page.evaluate(coverage, specFor(size));
const raster = await page.evaluate(rasterise, specFor(size));
await browser.close();
const atlas = crop(raster, size);
checkNothingEscaped(atlas, measured.inked);
await writeFile(OUT_PATH, emit(atlas), 'utf8');
console.log(
  `${atlas.glyphs.length} glyphs, ${atlas.width}x${atlas.height} cell -> ` +
    `${OUT_PATH.slice(REPO_ROOT.length + 1)}`,
);
