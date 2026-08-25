/**
 * Compose a rendered frame sequence into a single contact sheet for review.
 *
 * `docs/ANIMATION.md` is explicit that animations must be judged at true size,
 * not zoomed in a browser — colours that read as distinct at 4x turn to mud on
 * a 1.47" panel, and a two-pixel limb swing disappears. Frames are rendered at
 * exactly the panel's pixel density, so the top row is 1:1; the bottom row is
 * enlarged for inspecting individual pixels.
 *
 *   node tools/contact-sheet.ts out/typing [out/typing-sheet.png] [--sky dusk]
 *
 * **Frames are composed through `render()` and cropped to the stage slot**, so
 * what a reviewer sees is the sprite on the ground it will actually stand on. It used to composite the transparent PNGs over a flat `#0d1117` — a
 * `packs/example` palette entry copied by hand. The daemon sets
 * `extent: 'panel'`, so the environment covers the whole framebuffer and the
 * device shows a flat background nowhere.
 *
 * The comment above that hex claimed it was "the panel's background — review on
 * the real ground" from 18 Aug until 25 Aug, when it was corrected to say the
 * opposite. This commit is the code catching up with that correction, a day
 * later; it is not the commit that found it.
 *
 * That matters because `BUILD_PLAN.md` records four animations shipping with
 * holes for eyes that only a non-black stage could reveal. Not the same
 * failure — those shipped when the *device* was black, before the environment
 * was reachable at all — but the same class, and a review artefact that keeps
 * a flat background after the device stopped having one is how the class
 * survives its own fix.
 *
 * Cropping to the stage slot gives the sprite plus the ground behind it — sky,
 * sea, sand, rock and contact shadow — without the bands, which are identical
 * under every frame. Not *all* the scenery: under `extent: 'panel'` the tide
 * pool sits at x 220-316 and the landscape stage ends at 168, so it is outside
 * every sheet. It ships visible beneath the text bands, and
 * `tools/panel-mock.ts` is where it can be seen.
 *
 * `--sky` picks the scheme, and `day` — the default — is the hard case for a
 * *pale* prop: measured sand luminance is day 19.1 against dusk's 6.5, so a
 * pale prop disappears against day and a dark one against night.
 * `tools/blit-scene.ts` says the same. `tools/panel-mock.ts` is the whole-panel
 * view and shows all four skies at once; this one stays cropped to the stage,
 * because motion is what a sheet is for and the bands are identical under
 * every frame.
 */
import type { TimeOfDay } from '@tamaclaude/renderer';

import { basename, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { extractRect } from '@tamaclaude/protocol';
import { spriteSlots, TIMES_OF_DAY } from '@tamaclaude/renderer';

import { composePanels, loadPack } from './blit-scene.ts';
import { loadFrames } from './png-rgb565.ts';
import { toRgba } from './rgb565-rgba.ts';

const INSPECT_SCALE = 3;

/**
 * How many frames a sheet shows, spread evenly across the loop.
 *
 * `.claude/agents/animation-critic.md` step 4 asks for "~10 frames spread
 * across the loop", and it asks for that because the sheet has to be *looked
 * at*: every frame of `idle` is 128 cells and about 21,500 pixels wide, which
 * no reviewer and no image read can take in. Rendering all of them is what
 * this file did until 25 Aug, which is why the critic wrote its own sampler
 * instead of using it.
 *
 * Evenly spread rather than the first ten, so a loop's second half is not
 * invisible — `idle` spends its first quarter almost still.
 */
const SAMPLE = 10;

/** `count` indices spread across `total`, always including the first. */
function sampleIndices(total: number, count: number): readonly number[] {
  if (total <= count) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: count }, (_, i) =>
    Math.round((i * (total - 1)) / (count - 1)),
  );
}

/** The sheet's own chrome. None of it is panel colour — see the header. */
const SHEET_STYLE = `
  body { margin: 0; padding: 24px; background: #010409; color: #7d8590;
         font: 12px ui-monospace, SFMono-Regular, monospace;
         display: inline-block; }
  h2 { color: #d0d7de; font-size: 13px; font-weight: 400; margin: 0 0 12px; }
  .row { display: flex; gap: 8px; align-items: flex-start; }
  figure { margin: 0; }
  canvas { display: block; image-rendering: pixelated; }
  figcaption { text-align: center; padding-top: 6px; }
  .section { margin-top: 28px; }
`;

type Cell = {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
};

function sheetHtml(): string {
  return `<style>${SHEET_STYLE}</style>
    <h2 id="trueCaption"></h2>
    <div class="row" id="trueRow"></div>
    <div class="section">
      <h2 id="bigCaption"></h2>
      <div class="row" id="bigRow"></div>
    </div>`;
}

/**
 * Draw the cells, in the browser.
 *
 * Serialised into the page, so it references nothing outside its arguments.
 * It knows a width, a height and a run of RGBA — no bands, no palette, no
 * layout, all of which happened in `render()` before the page saw anything.
 */
function paintSheet({
  cells,
  scale,
  caption,
}: {
  readonly cells: readonly Cell[];
  readonly scale: number;
  readonly caption: string;
}) {
  const trueRow = document.getElementById('trueRow');
  const bigRow = document.getElementById('bigRow');
  const trueCaption = document.getElementById('trueCaption');
  if (trueRow === null || bigRow === null || trueCaption === null) {
    throw new Error('sheet skeleton missing');
  }
  trueCaption.textContent = caption;
  const bigCaption = document.getElementById('bigCaption');
  // Named rather than hardcoded to "frames 0 and 1": the sheet samples across
  // the loop, so the enlarged pair is the first two *sampled* frames, which for
  // a 128-frame loop is 0 and 14 rather than 0 and 1.
  if (bigCaption !== null) {
    const shown = cells.slice(0, 2).map((cell) => cell.index);
    bigCaption.textContent = `${scale}x — frames ${shown.join(' and ')}`;
  }
  for (const cell of cells) {
    const image = new ImageData(cell.width, cell.height);
    image.data.set(cell.rgba);
    const make = (zoom: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = cell.width;
      canvas.height = cell.height;
      canvas.style.width = `${cell.width * zoom}px`;
      canvas.style.height = `${cell.height * zoom}px`;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      context.putImageData(image, 0, 0);
      return canvas;
    };
    const figure = document.createElement('figure');
    const caption_ = document.createElement('figcaption');
    caption_.textContent = String(cell.index);
    figure.append(make(1), caption_);
    trueRow.append(figure);
    // Two frames is one full 0.25s cycle at 8fps — the fastest motion in the
    // sprite, and the pair most worth inspecting pixel by pixel.
    if (bigRow.childElementCount < 2) bigRow.append(make(scale));
  }
}

async function composeSheet(
  frameDir: string,
  outPath: string,
  sky: TimeOfDay,
): Promise<void> {
  const pack = await loadPack(resolve('packs/example'));
  const slot = spriteSlots('hero', 'landscape')[0];
  if (slot === undefined) throw new Error('no hero slot');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
    });
    const rasters = await loadFrames(page, frameDir);
    const name = basename(resolve(frameDir));
    const panels = composePanels(rasters, {
      orientation: 'landscape',
      pack,
      name,
      time: sky,
    });
    const cells = sampleIndices(panels.length, SAMPLE).map((index) => {
      const panel = panels[index];
      if (panel === undefined) throw new Error(`no panel ${index}`);
      return {
        index,
        width: slot.width,
        height: slot.height,
        // `extractRect` rather than a crop written here: it is the repo's
        // tested one, and it throws on a rect that does not fit instead of
        // silently wrapping rows into each other, which is what a hand-rolled
        // version did until 25 Aug.
        rgba: toRgba(extractRect(panel, slot)),
      };
    });
    await page.setContent(sheetHtml());
    await page.evaluate(paintSheet, {
      cells,
      scale: INSPECT_SCALE,
      caption:
        `true size — ${cells.length} of ${panels.length} frames, ` +
        `${slot.width}px wide, panel pixel density, ${sky} sky, ` +
        `composed through render()`,
    });
    await page.locator('body').screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { sky: { type: 'string', default: 'day' } },
});
const sky = values.sky as TimeOfDay;
if (!TIMES_OF_DAY.includes(sky)) {
  console.error(`--sky takes one of ${TIMES_OF_DAY.join(', ')}`);
  process.exit(1);
}
const [dirArg, outArg] = positionals;
if (dirArg === undefined) {
  console.error(
    'usage: node tools/contact-sheet.ts <frameDir> [out.png] [--sky day]',
  );
  process.exit(1);
}
const out = outArg ?? `out/${basename(dirArg)}-sheet.png`;
await composeSheet(resolve(dirArg), resolve(out), sky);
console.log(`sheet -> ${out}`);
