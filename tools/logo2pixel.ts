#!/usr/bin/env node
/**
 * Quantise a logo SVG to a pack's palette, at panel pixel density.
 *
 *   node tools/logo2pixel.ts <logo.svg> [out.png] [--pack packs/other]
 *                            [--width 48] [--over '#RRGGBB']
 *
 * `BUILD_PLAN.md` Stage 5 calls this "SVG → nearest-neighbour → palette
 * quantise (`sharp`)", and the screen spec names a "logo pixelation script"
 * as the cost of putting one on the boot splash. **It needs no `sharp`.** Both halves already existed for
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
 * `typing.svg`'s `#fx-laptop-logo` is the slot a mark replaces. Measured, at
 * the stage's 8 device pixels per user unit: the lid is
 * `x 2.25..12.75, y 11..13.5`, so **84 x 20 px**. That height is the binding
 * constraint, not the width.
 *
 *   node tools/logo2pixel.ts pack/logo.svg --width 16 \
 *     --over '#RRGGBB' --format pack
 *
 * **`--format pack` is the one that reaches the panel.** `png` is to look at
 * and `rects` is to paste into the SVG; neither can be consumed by the
 * renderer, which has no image decoder in its graph. `pack` emits the object
 * that goes in a manifest's `logo` field, and `packages/renderer/src/logo.ts`
 * draws it on the lid at run time — so the mark stays in the private pack
 * instead of being baked into tracked animation frames.
 *
 * `--over` is the colour the mark sits on — for the lid that is `#A91326`,
 * fixed in the artwork. It was `#30363B` until the lid was recoloured on
 * 26 Aug; with `--format pack` it makes no difference to the bytes, because
 * crisp edges mean a transparent-background mark has no soft edges to snap
 * against the ground — *unless a mark colour's own nearest candidate is the
 * ground*, since `--over` joins the candidate list for opaque pixels too. On
 * the mark that ships it changes nothing; on one drawn in a near-miss of the
 * lid it changes everything, which is what the warning is for.
 *
 * **`--width` scales the viewBox, not the artwork.** A logo drawn inside a
 * generous viewBox — `0 0 140 140` for a mark that occupies `20 9 100 121` —
 * comes out proportionally smaller, and at these sizes that is the difference
 * between a readable mark and four pixels. Crop the viewBox to the artwork
 * before baking. This tool does not do it for you: guessing where a mark's
 * margins are meant to be is a design decision, and a wrong guess is silent.
 *
 * **Do not wrap the rects in a new group inside `#fx-laptop-logo`.** That
 * leaves `#logo-lit` and `#logo-dim` in place, so the mark is static and the
 * old one-pixel dot goes on flickering through a hole in it — 23 animations,
 * no warning, every gate green. The rects go *inside* those two elements,
 * which each become a `<g>` carrying its own fill and the shared
 * `transform="translate(x,y)"`; they alternate on a 1s loop and that is what
 * makes the screen read as lit. Emit the mark twice, once per element, and do
 * not give the copies a fill of their own — an explicit child fill beats the
 * inherited one and both shades render the same, which is the pulse gone by a
 * different route.
 *
 * Centring is arithmetic, not a constant. **Prefer even `w` and `h`**: an odd
 * pixel count puts the translate on a half device pixel, which the snap
 * recovers but which can resolve an edge to the wrong side. For a mark `w` x
 * `h` device pixels at 8 px per unit,
 * `x = 2.25 + (10.5 - w/8)/2` and `y = 11 + (2.5 - h/8)/2` —
 * a 16x16 mark gives `translate(6.5,11.25)` and leaves 2 px of lid above and
 * below. **Height is the constraint**: at 20 px there is not much of it, so
 * pick the width that lands the height you want rather than the other way
 * round.
 *
 * **`rects` output is a silhouette, not a picture.** `opaqueRuns` reads only
 * the alpha channel and the rects carry no fill, so the caller's group supplies
 * one colour for the whole mark. The snap still decides which pixels are
 * *there* — it is what resolves the antialiased edge to one side — but every
 * colour in the source becomes that single fill. So the collision warning
 * below is about the `png` path; in `rects` every colour merges by
 * construction, which is fine for a one-colour mark on a contrasting ground
 * and wrong for anything else.
 *
 * **`--format pack` is rendered; the other two are not.** `packages/packs`
 * takes a `logo` field and `packages/renderer/src/logo.ts` draws it, so the
 * pack route is complete. `png` and `rects` produce the asset only, which is still worth having early: the pixel art is what needs
 * judging by eye against a real palette, and it can be judged before anything
 * draws it. The other live route is a private re-bake of the animation
 * frames — see `typing.svg`'s note on the logo group for what that costs.
 *
 * There is a third, and it is closed: the boot splash, which is where the
 * screen spec originally put the logo. `tools/bake-splash.ts` writes a
 * firmware header, so it is flashed rather than configured, and the splash
 * shipped on 21 Aug without one. `BUILD_PLAN.md` records why the lid won.
 *
 * **A logo is quantised against a ground.** Partly transparent pixels are
 * composited over `--over` before the nearest colour is picked, and
 * `snapToPalette` clears alpha only where a pixel both resolved to that ground
 * and arrived non-opaque — so the ground joins the snap candidates, or nothing
 * would ever be transparent. The default is `palette[0]`. The same art
 * quantised against a different ground is a different picture at the edges, so
 * re-bake per surface rather than reusing one output.
 */
import type { Rgb } from './frame-palette.ts';
import type { Page } from 'playwright';

import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { encodeRect } from '@tamaclaude/protocol';

import { loadPack } from './blit-scene.ts';
import { snapToPalette } from './frame-palette.ts';
import { SLOTS } from './pack-slots.ts';
import { collisions, declaredFills, nearestIn } from './palette-map.ts';
import { opaqueRuns, runsToRects } from './pixel-rects.ts';
import { scaleToWidth, viewBoxUnits } from './svg-viewbox.ts';

/**
 * Slot name to manifest field, because they are not the same word.
 *
 * The lid's slot is `lid` — where the mark goes — and the field is `logo`.
 * That gap is why the old message hard-coded its two names rather than
 * deriving them, and hard-coding is why it never learned about the third.
 */
const FIELD_FOR: Readonly<Record<(typeof SLOTS)[number]['name'], string>> = {
  lid: 'logo',
  pet: 'pet',
  scene: 'scene',
};

/**
 * Default width in panel pixels.
 *
 * The landscape stage is 168px wide and the message band 152px, so 48 is
 * roughly a third of either — small enough to sit as a prop rather than as
 * the subject, and large enough that a wordmark is still legible at 1:1.
 * A starting point for looking. `--format pack` has real slots to fit — see
 * `SLOTS` in `tools/pack-slots.ts` — so it warns when the result fits none of
 * them, and prints it regardless.
 */
const DEFAULT_WIDTH = 48;

/** `#RRGGBB` for a report line. */
function hexOf(colour: Rgb): string {
  return `#${colour.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

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
if (!['png', 'rects', 'pack'].includes(values.format)) {
  console.error(
    `--format takes 'png', 'rects' or 'pack', not '${values.format}'`,
  );
  process.exit(1);
}

const [svgArg, outArg] = positionals;
if (svgArg === undefined) {
  console.error(
    'usage: node tools/logo2pixel.ts <logo.svg> [out.png] ' +
      "[--pack <dir>] [--width 48] [--over '#RRGGBB'] " +
      '[--format png|rects|pack] [--scale 8]\n' +
      '       --format pack is the one the panel can read',
  );
  process.exit(1);
}

const width = Number(values.width);
if (!Number.isInteger(width) || width <= 0) {
  console.error(
    `--width must be a positive whole number, not '${values.width}'`,
  );
  process.exit(1);
}
const svg = await readFile(resolve(svgArg), 'utf8');
const pack = await loadPack(resolve(values.pack));
const palette = pack.palette.map((entry) => [...entry] as unknown as Rgb);
const background = palette[0];
if (background === undefined) throw new Error('pack palette is empty');
// Both of these threw a raw stack trace until 26 Aug, while `--scale` — a
// flag that appears in no recipe — had a readable message.
let over: Rgb;
try {
  over = values.over === undefined ? background : parseHex(values.over);
} catch {
  console.error(`--over must be a #RRGGBB colour, not '${values.over}'`);
  process.exit(1);
}
/**
 * The palette the snap actually chooses from: the pack's, plus the ground.
 *
 * **The ground has to be a candidate or nothing is transparent.**
 * `snapToPalette` clears alpha only where a pixel's *snapped* colour equals
 * the ground and the capture was non-opaque — and the snapped colour comes
 * from this array. A ground outside it is therefore never matched, every pixel
 * comes back opaque, and the output is a solid rectangle the size of the
 * mark's bounding box: silent in `png`, and in `rects` it is what gets pasted.
 *
 * Adding it here rather than demanding a pack carry it. The surface a mark
 * sits on is often not a pack colour at all — the laptop lid in `typing` is a
 * fixed `#A91326` in the artwork, and no pack palette reaches a baked sprite,
 * so it is that colour on every install. Requiring `--over` to be a palette
 * entry would refuse the tool's own documented workflow.
 *
 * Opaque interior pixels survive even when they land on the ground, because
 * the alpha rule needs *both* conditions; only the antialiased edge, which
 * arrives part-transparent, resolves to the ground and drops out.
 */
const candidates: Rgb[] = palette.some((entry) =>
  entry.every((v, c) => v === over[c]),
)
  ? palette
  : [...palette, over];

const scale = Number(values.scale);
if (!Number.isFinite(scale) || scale <= 0) {
  console.error(`--scale must be a positive number, not '${values.scale}'`);
  process.exit(1);
}

// **The failure this tool has that nothing else would catch.** A pack palette
// is four colours; a logo is not. Two marks whose nearest entry is the same
// one merge, and the mark that lost simply is not in the output — no error, no
// empty file, just a picture missing a shape. A fixture with a purple field
// and a yellow disc came back as a flat orange rectangle.
// **A mark colour that resolves to the ground is invisible, and it is not a
// collision.** Adding the ground to the candidates can only split collisions
// apart, so a colour that used to merge with a palette entry may now snap to
// the ground instead — where it renders in the surface's own colour and
// vanishes against it. No two mark colours merged, so `collisions` cannot see
// it. Reported separately, and the collision check runs against the pack's
// palette so it still describes what the *pack* can represent.
/**
 * RGBA bytes as RGB565 words plus a packed drawn-mask.
 *
 * Its own function because inlining it nests four blocks deep and `max-depth`
 * is three — but it reads better out here anyway, since the two outputs are
 * different shapes of the same pass.
 */
function pack565(
  rgba: Uint8ClampedArray,
  total: number,
): {
  readonly words: Uint16Array;
  readonly padded: Uint8Array;
  readonly drawn: number;
} {
  const words = new Uint16Array(total);
  const bits = new Uint8Array(Math.ceil(total / 8));
  let drawn = 0;
  for (let index = 0; index < total; index += 1) {
    const r = rgba[index * 4] ?? 0;
    const g = rgba[index * 4 + 1] ?? 0;
    const b = rgba[index * 4 + 2] ?? 0;
    const alpha = rgba[index * 4 + 3] ?? 0;
    words[index] = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    // Alpha is 0 or 255 after snapping — the ground colour is cleared to
    // transparent — so a midpoint test is a formality rather than a choice.
    if (alpha < 128) continue;
    bits[index >> 3] |= 0x80 >> (index & 7);
    drawn += 1;
  }
  // Padded to an even byte count so it can be read back as 16-bit words,
  // which is what `maskWords` in the renderer expects.
  const padded = new Uint8Array(Math.ceil(bits.length / 2) * 2);
  padded.set(bits);
  return { words, padded, drawn };
}

/** The snapped image as RGBA bytes, read back out of the page. */
async function readPixels(page: Page, uri: string): Promise<number[]> {
  return page.evaluate(async (source: string) => {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(0, 0, canvas.width, canvas.height).data];
  }, uri);
}

/**
 * Base64 of a `[mode byte][payload]` blob — the framing the renderer reads.
 *
 * The same shape `tools/bake-sprites.ts` writes, because the renderer decodes
 * both through one function.
 *
 * **The decode side is shared; this side is not.** `packages/renderer/src/blob.ts`
 * consolidated the reading, and there are now three copies of the writing —
 * here, in `bake-sprites.ts`, and in the renderer's own test helper. That is
 * the drift this sentence used to warn against while being an instance of it.
 * What keeps it honest is the round-trip in `logo2pixel.test.ts`: it runs this
 * tool and hands the bytes to the real painter, so an encoder that disagrees
 * with the decoder goes red.
 */
function blob(words: Uint16Array): string {
  const { mode, payload } = encodeRect(words);
  const bytes = new Uint8Array(payload.length + 1);
  bytes[0] = mode;
  bytes.set(payload, 1);
  return Buffer.from(bytes).toString('base64');
}

const fills = declaredFills(svg);
for (const fill of fills) {
  if (nearestIn(fill, candidates).every((v, c) => v === over[c])) {
    console.warn(
      `warning: ${hexOf(fill)} is nearest to the ground ${hexOf(over)}, so ` +
        `it will disappear into the ground it is drawn on`,
    );
  }
}
for (const clash of collisions(fills, palette)) {
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
  // **`--format pack` renders without antialiasing, and that is not a
  // preference.** A mark for the lid is twelve to sixteen pixels across, and
  // the browser's antialiased edges become mid-tones that `snapToPalette` then
  // resolves to whichever palette entry happens to be nearest. Measured on a
  // one-colour white logo: the mark landed on *three* colours — the pack's ink
  // where it should, but its edges on the attention amber and the active teal,
  // so a monochrome mark arrived speckled with the two chip colours and
  // nothing warned, because the merge check looks for two declared fills
  // colliding and there was only ever one.
  //
  // With `crispEdges` every pixel is the fill or nothing. On the mark that
  // actually ships that is one drawn colour instead of two, and a payload 6.6%
  // smaller at `--width 14` and 19.3% at 16, because a two-colour image
  // run-length-encodes better. The three-colour figure above was measured on a
  // white logo that is not in this repo — it is why the option exists, not a
  // number anyone here can reproduce.
  //
  // `png` and `rects` keep the antialiasing. They are viewed and pasted at
  // larger sizes, where the dither reads as a smoother edge rather than noise.
  const crisp = values.format === 'pack' ? 'shape-rendering:crispEdges' : '';
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0}
       svg{display:block;width:100%;height:100%}
       svg *{${crisp}}
     </style>${svg}`,
  );
  // `omitBackground`, unlike the splash: a logo is a prop drawn over whatever
  // is behind it, so it needs the alpha that tells the renderer which pixels
  // are its own.
  const raw = await page.screenshot({ omitBackground: true });
  const snapped = await page.evaluate(snapToPalette, {
    uri: `data:image/png;base64,${raw.toString('base64')}`,
    palette: candidates,
    bg: over,
  });
  const total = size.width * size.height;
  if (values.format === 'pack') {
    // **The only format the renderer can consume.** `png` is to look at, and
    // `rects` reaches the panel only through a re-bake of the animation art —
    // the route this format exists to make unnecessary. Neither can be handed
    // to the renderer, because nothing in the shipping graph decodes an image.
    // This emits what the
    // sprites already are — RGB565 through `encodeRect`, base64 of a mode byte
    // and its payload — plus the bit-mask that says which pixels are drawn.
    // **Say so, and print it anyway.** Refusing would be worse: the object is
    // still useful for looking at, and a tool that prints nothing on a size
    // mistake sends you hunting the wrong thing. The
    // default width is 48, which on a square mark gives a 48-tall object the
    // schema refuses outright — and the recipe in this header omits `--width`
    // often enough that a review hit it.
    //
    // **Two slots, since 27 Aug.** This tool is not logo-specific — it
    // quantises any SVG to a pack's palette — and the pet uses it too. The lid
    // is 84x20 and the pet's slot is 60x42, so a tall mark can fit one and not
    // the other. Naming only the lid made the warning say "the pack schema will
    // refuse it" about art destined for a field that did not exist yet — so it
    // was misleading about a working tree rather than false about anything
    // shipped, which is a distinction a review had to make for me.
    const fits = SLOTS.filter(
      (slot) => size.width <= slot.width && size.height <= slot.height,
    );
    if (fits.length === 0) {
      console.error(
        `warning: ${String(size.width)}x${String(size.height)} fits no pack slot (` +
          SLOTS.map(
            (s) => `${s.name} ${String(s.width)}x${String(s.height)}`,
          ).join(', ') +
          ') — try a smaller --width',
      );
    }
    const rgba = new Uint8ClampedArray(await readPixels(page, snapped.uri));
    const { words, padded, drawn } = pack565(rgba, total);
    console.log(
      JSON.stringify(
        {
          width: size.width,
          height: size.height,
          pixels: blob(words),
          mask: blob(new Uint16Array(padded.buffer)),
        },
        null,
        2,
      ),
    );
    // **Names the fields it actually fits.** This said `"logo" or "pet"`
    // regardless, so a full-stage scene — a valid field since the rare scene
    // landed — was offered two slots it could not go in and not the one it
    // could. `fits` is already computed above for the warning; using it here
    // is what stops the two disagreeing.
    const where =
      fits.length === 0
        ? 'but it fits no pack field — see the warning above'
        : `paste the object above into the pack's manifest as ` +
          fits.map((slot) => `"${FIELD_FOR[slot.name]}"`).join(' or ');
    console.error(
      `${size.width}x${size.height}, ${String(drawn)} of ${String(total)} pixels drawn — ${where}`,
    );
  } else if (values.format === 'rects') {
    // Rects are emitted from the origin so placement is the caller's, via an
    // enclosing `<g transform="translate(x,y)">`. Baking a position in would
    // mean three more flags and a tool that only knows about one slot.
    const pixels = await readPixels(page, snapped.uri);
    const runs = opaqueRuns(
      new Uint8ClampedArray(pixels),
      size.width,
      size.height,
    );
    const unitsPerPixel = 1 / scale;
    console.log(
      `<!-- ${basename(resolve(svgArg))} at ${size.width}x${size.height}px, ` +
        `${runs.length} rects, ${unitsPerPixel} units per pixel -->`,
    );
    console.log(runsToRects(runs, { unitsPerPixel, x: 0, y: 0 }).join('\n'));
  } else {
    const base64 = snapped.uri.replace(/^data:image\/png;base64,/, '');
    // `out/` is gitignored, so it is absent from a fresh checkout. The tools
    // that screenshot through Playwright get the directory made for them; the
    // ones that write bytes themselves — `svg2frames.ts`, `harness.ts` —
    // mkdir like this. This one writes bytes and did not, and failed with a
    // raw ENOENT after the browser had launched and done the work.
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), Buffer.from(base64, 'base64'));
    console.log(
      `logo -> ${out} (${size.width}x${size.height}, ` +
        `${candidates.length} colours, ${snapped.soft} of ${total} px snapped)`,
    );
  }
} finally {
  await browser.close();
}
