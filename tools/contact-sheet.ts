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
 * **Every frame is composed through `render()` and cropped to the stage slot**,
 * so what a reviewer sees is the sprite on the ground it will actually stand
 * on. It used to composite the transparent PNGs over a flat `#0d1117` — a
 * `packs/example` palette entry copied by hand, under a comment claiming it was
 * "the panel's background — review on the real ground". It was neither. The
 * daemon sets `extent: 'panel'`, so the rock pool covers the whole framebuffer
 * and the device never shows a flat background anywhere; and a pack swap
 * changed the device without changing this sheet.
 *
 * That mattered more here than in the other tools, because `BUILD_PLAN.md`
 * records four animations shipping with holes for eyes that only a non-black
 * stage could reveal, and this is the artefact the mandatory `animation-critic`
 * reads. It was judging art against a background the panel cannot display.
 *
 * `--sky` picks the scheme; `dusk` is the second-darkest and so the hardest
 * case for a pale prop. `tools/panel-mock.ts` is the whole-panel view and shows
 * all four at once — this one stays cropped to the stage, because motion is
 * what a sheet is for and bands repeated twelve times are noise.
 */
import type { TimeOfDay } from '@tamaclaude/renderer';

import { basename, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { spriteSlots, TIMES_OF_DAY } from '@tamaclaude/renderer';

import { composePanels, loadPack } from './blit-scene.ts';
import { loadFrames } from './png-rgb565.ts';
import { toRgba } from './rgb565-rgba.ts';

const INSPECT_SCALE = 3;

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

/**
 * Crop a composed panel to the stage slot.
 *
 * The slot is where `paintStage` drew the sprite, so cropping to it gives the
 * sprite plus exactly the ground behind it — no bands, which would be the same
 * pixels repeated under every frame.
 */
function cropToStage(
  pixels: Uint16Array,
  panelWidth: number,
  slot: { x: number; y: number; width: number; height: number },
): Uint16Array {
  const out = new Uint16Array(slot.width * slot.height);
  for (let row = 0; row < slot.height; row += 1) {
    const from = (slot.y + row) * panelWidth + slot.x;
    out.set(pixels.subarray(from, from + slot.width), row * slot.width);
  }
  return out;
}

function sheetHtml(): string {
  return `<style>${SHEET_STYLE}</style>
    <h2 id="trueCaption"></h2>
    <div class="row" id="trueRow"></div>
    <div class="section">
      <h2>${INSPECT_SCALE}&times; &mdash; frames 0 and 1 (the fastest cycle)</h2>
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
    if (cell.index < 2) bigRow.append(make(scale));
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
    const cells = panels.map((panel, index) => ({
      index,
      width: slot.width,
      height: slot.height,
      rgba: toRgba(cropToStage(panel.pixels, panel.width, slot)),
    }));
    await page.setContent(sheetHtml());
    await page.evaluate(paintSheet, {
      cells,
      scale: INSPECT_SCALE,
      caption:
        `true size — ${cells.length} frames at ${slot.width}px wide, ` +
        `panel pixel density, ${sky} sky, composed through render()`,
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
