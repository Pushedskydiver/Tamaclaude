#!/usr/bin/env node
/**
 * Compose the panel the way the device does, and screenshot it for review.
 *
 * This is the artefact that goes into a pull request, which is exactly why it
 * used to be the most dangerous file in `tools/`: it drew its own panel in
 * browser CSS, with its own hardcoded `#0d1117` background and `#c9d1d9` ink,
 * hand-synced to `packs/example`'s palette. A pack swap changed the panel and
 * did not change the mock. Reviewers looked at the mock.
 *
 * It now composes through `render()` in Node — the same `composePanels` that
 * `tools/blit.ts` sends to the panel — and the page does nothing but blit the
 * pixels it is handed. **That is what makes `BUILD_PLAN.md`'s Stage 2 exit
 * ("browser and panel show the same thing") true by construction rather than
 * by inspection: there is no second panel-drawing code path left to diverge.**
 *
 *   node tools/panel-mock.ts out/typing [out/thinking ...]
 *
 * **Landscape hero only, and that is a narrowing rather than a regression.**
 * The old mock drew four panels — portrait and landscape, hero and two-up. The
 * daemon hardcodes `landscape` and `'hero'` (`packages/cli/src/daemon.ts`), and
 * a portrait firmware build is refused by a `_Static_assert` until portrait
 * splash art exists. So three of those four panels showed a configuration that
 * cannot ship, and comparing candidates was the job of a design freeze that has
 * since happened.
 *
 * What replaces them is the variable that is still live: the same frame against
 * `day` and against `night`. The daemon passes `timeOfDay(now)`, so both are
 * real states of the shipping panel, and `BUILD_PLAN.md` names judging an
 * animation against the wrong sky as a thing worth catching.
 *
 * The one thing here with no device counterpart is the RGB565 unpack below —
 * the panel writes those bytes straight to SPI and never expands them. It is
 * the single place this file can be wrong while the device is right, which is
 * why it is six lines and commented rather than folded into something clever.
 */
import type { SessionChip } from '@tamaclaude/renderer';

import { resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { panelSize } from '@tamaclaude/renderer';

import { composePanels, loadPack } from './blit-scene.ts';
import { loadFrames } from './png-rgb565.ts';

/** The sky states the daemon can actually be in, and both are worth seeing. */
const SKIES = ['day', 'night'] as const;

/**
 * Chips for the strip, so the band is judgeable rather than a 32px void.
 *
 * Three rather than one, and mixed tones rather than uniform, because the
 * question this band raises is whether several sessions at different states
 * read apart at 15px wide — so it is one chip of each of the three tones. The old CSS mock drew three minis plus a `+2`
 * overflow badge; the overflow needs six sessions and `paintStrip` owns that
 * rule, so it is left to the renderer rather than staged here.
 */
const CHIPS: readonly SessionChip[] = [
  { tone: 'active', origin: 'local' },
  { tone: 'attention', origin: 'local' },
  { tone: 'resting', origin: 'remote' },
];

/** How much the enlarged copy is blown up, for inspecting individual pixels. */
const ZOOM = 3;

type Panel = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
};

/**
 * Turn one animation's first frame into a composed panel per sky.
 *
 * The first frame rather than the whole loop, because this is the fixed
 * comparison image — `tools/contact-sheet.ts` is the artefact for judging
 * motion, and `pnpm harness` is the one for scrubbing it.
 */
function panelsFor(
  name: string,
  raster: Parameters<typeof composePanels>[0][number],
  pack: Awaited<ReturnType<typeof loadPack>>,
): readonly Panel[] {
  const size = panelSize('landscape');
  return SKIES.map((sky) => {
    const [composed] = composePanels([raster], {
      orientation: 'landscape',
      pack,
      name,
      time: sky,
      sessions: CHIPS,
    });
    if (composed === undefined) {
      throw new Error(`composePanels returned nothing for ${name}`);
    }
    return {
      label: `${name} — ${sky}`,
      width: size.width,
      height: size.height,
      pixels: [...composed.pixels],
    };
  });
}

const SHEET_STYLE = `
  body{margin:0;padding:24px;background:#010409;color:#6e7681;
       font:12px ui-monospace,SFMono-Regular,monospace;display:inline-block}
  .row{display:flex;gap:32px;align-items:flex-start;margin-bottom:22px}
  canvas{display:block;image-rendering:pixelated}
  .label{margin-bottom:8px}
`;

/**
 * Paint the composed panels, in the browser.
 *
 * Serialised into the page, so it may not reference anything outside its own
 * arguments. Everything it knows about a panel is a width, a height and a run
 * of pixels — no bands, no palette, no layout. All of that happened in
 * `render()` before the browser saw anything, which is the point.
 */
function paintSheet({
  panels,
  zoom,
}: {
  readonly panels: readonly Panel[];
  readonly zoom: number;
}) {
  const sheet = document.getElementById('sheet');
  if (sheet === null) throw new Error('no #sheet');
  for (const panel of panels) {
    // RGB565 -> RGBA, and the one operation here with no device counterpart:
    // the panel writes these bytes straight to SPI and never expands them.
    // Each channel's high bits are replicated into the low ones, which is what
    // puts 0b11111 on 255 rather than 248. Any other widening shifts every
    // colour on the sheet away from what the panel shows.
    const image = new ImageData(panel.width, panel.height);
    for (const [i, value] of panel.pixels.entries()) {
      const r = (value >> 11) & 0x1f;
      const g = (value >> 5) & 0x3f;
      const b = value & 0x1f;
      const rgba = [
        (r << 3) | (r >> 2),
        (g << 2) | (g >> 4),
        (b << 3) | (b >> 2),
        255,
      ];
      image.data.set(rgba, i * 4);
    }
    const row = document.createElement('div');
    row.className = 'row';
    for (const scale of [1, zoom]) {
      const wrap = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent =
        scale === 1 ? `${panel.label} — true size` : `${scale}x`;
      const canvas = document.createElement('canvas');
      canvas.width = panel.width;
      canvas.height = panel.height;
      canvas.style.width = `${panel.width * scale}px`;
      canvas.style.height = `${panel.height * scale}px`;
      canvas.getContext('2d')?.putImageData(image, 0, 0);
      wrap.append(label, canvas);
      row.append(wrap);
    }
    sheet.append(row);
  }
}

/** Blit the composed panels onto canvases and screenshot the page. */
async function shoot(panels: readonly Panel[], outPath: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  await page.setContent(`<style>${SHEET_STYLE}</style><div id="sheet"></div>`);
  await page.evaluate(paintSheet, { panels, zoom: ZOOM });
  await page.locator('body').screenshot({ path: outPath });
  await browser.close();
}

async function compose(frameDirs: readonly string[], outPath: string) {
  const pack = await loadPack(resolve('packs/example'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const panels: Panel[] = [];
  try {
    for (const dir of frameDirs) {
      const rasters = await loadFrames(page, dir);
      const first = rasters[0];
      if (first === undefined) throw new Error(`no frames in ${dir}`);
      // The directory name is the animation name, which `composePanels` needs
      // for `castsShadow` — `bouldering` is on a wall and casts none.
      panels.push(
        ...panelsFor(resolve(dir).split('/').at(-1) ?? dir, first, pack),
      );
    }
  } finally {
    await browser.close();
  }
  await shoot(panels, outPath);
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node tools/panel-mock.ts <frameDir> [frameDir2]');
  process.exit(1);
}
await compose(dirs, resolve('out/panel-mock.png'));
console.log('panel mock -> out/panel-mock.png');
