/**
 * Compose a rendered frame sequence into a single contact sheet for review.
 *
 * `docs/ANIMATION.md` is explicit that animations must be judged at true size,
 * not zoomed in a browser — colours that read as distinct at 4x turn to mud on
 * a 1.47" panel, and a two-pixel limb swing disappears. Frames are rendered at
 * exactly the panel's pixel density, so the top row is 1:1; the bottom row is
 * enlarged for inspecting individual pixels.
 *
 *   node tools/contact-sheet.ts out/typing out/typing-sheet.png
 *
 * Frames are inlined as data URIs rather than referenced by path: the review
 * page is built with setContent, which leaves the document on an about:blank
 * origin, and Chromium refuses to load file:// subresources into it.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

/** The panel's background — frames are transparent, so review on the real ground. */
const PANEL_BACKGROUND = '#0d1117';
const INSPECT_SCALE = 3;

async function frameDataUris(frameDir: string): Promise<string[]> {
  const names = (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error(`no PNGs in ${frameDir}`);
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(resolve(frameDir, name));
      return `data:image/png;base64,${bytes.toString('base64')}`;
    }),
  );
}

function sheetHtml(uris: readonly string[]): string {
  const trueSize = uris
    .map(
      (uri, index) =>
        `<figure><img src="${uri}" alt=""><figcaption>${index}</figcaption></figure>`,
    )
    .join('');
  const enlarged = uris
    .map((uri) => `<img class="big" src="${uri}" alt="">`)
    .join('');
  return `
    <style>
      body { margin: 0; padding: 24px; background: #010409; color: #7d8590;
             font: 12px ui-monospace, SFMono-Regular, monospace;
             display: inline-block; }
      h2 { color: #c9d1d9; font-size: 13px; font-weight: 400; margin: 0 0 12px; }
      .row { display: flex; gap: 8px; align-items: flex-start; }
      figure { margin: 0; }
      img { display: block; background: ${PANEL_BACKGROUND};
            image-rendering: pixelated; }
      figcaption { text-align: center; padding-top: 6px; }
      .big { width: ${168 * INSPECT_SCALE}px; }
      .section { margin-top: 28px; }
    </style>
    <h2>true size &mdash; 8 frames at panel pixel density, 168&times;200 each</h2>
    <div class="row">${trueSize}</div>
    <div class="section">
      <h2>${INSPECT_SCALE}&times; &mdash; frames 0 and 1 (the fastest cycle)</h2>
      <div class="row">${enlarged.split('<img class="big"').slice(0, 3).join('<img class="big"')}</div>
    </div>
  `;
}

async function composeSheet(frameDir: string, outPath: string): Promise<void> {
  const uris = await frameDataUris(frameDir);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
  });
  await page.setContent(sheetHtml(uris));
  await page.locator('body').screenshot({ path: outPath });
  await browser.close();
}

const [dirArg, outArg] = process.argv.slice(2);
if (!dirArg) {
  console.error('usage: node tools/contact-sheet.ts <frameDir> [out.png]');
  process.exit(1);
}
const out = outArg ?? `out/${basename(dirArg)}-sheet.png`;
await composeSheet(resolve(dirArg), resolve(out));
console.log(`sheet -> ${out}`);
