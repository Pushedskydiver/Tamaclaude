#!/usr/bin/env node
/**
 * Compose full-panel mockups so layout decisions are made by looking, not
 * arguing.
 *
 * `.claude/research/screens/spec.md` §11 leaves several questions open that
 * are measurements rather than opinions — hero versus two-up, whether the
 * message band earns its height, and now portrait versus landscape mounting —
 * and the design freeze is one day after the harness afternoon booked to
 * answer them. This renders every candidate at true panel size from real
 * animation frames.
 *
 *   node tools/svg2frames.ts assets/clawd/animations/typing.svg out/typing
 *   node tools/panel-mock.ts out/typing out/gym
 *
 * Geometry, scales and the safe-area crop all come from
 * `@tamaclaude/renderer` rather than from constants copied here, so the mock a
 * decision is made from cannot drift from the code that implements it. An
 * earlier version kept the scale and crop locally and got the landscape two-up
 * candidate wrong — which then went into the spec as a design verdict.
 */
import type { Orientation, StageLayout } from '@tamaclaude/renderer';

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import {
  panelBands,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from '@tamaclaude/renderer';

/** Sample text for the message band. A tool label, never a real quip — this
 *  file is tracked and the quips are not. See CLAUDE.md §Non-obvious constraints. */
const SAMPLE_MESSAGE = 'Grep';
const PANEL_BACKGROUND = '#0d1117';
const INK = '#c9d1d9';
const DIM = '#6e7681';
type PanelOptions = {
  readonly layout: StageLayout;
  readonly orientation: Orientation;
  readonly frames: readonly string[];
  readonly miniClawd: string;
};

async function firstFrame(frameDir: string): Promise<string> {
  const names = (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error(`no PNGs in ${frameDir}`);
  const bytes = await readFile(resolve(frameDir, names[0]));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function bandCss(orientation: Orientation): string {
  return Object.entries(panelBands(orientation))
    .map(
      ([name, rect]) =>
        `.${orientation} .band-${name}{left:${rect.x}px;top:${rect.y}px;` +
        `width:${rect.width}px;height:${rect.height}px;}`,
    )
    .join('');
}

function stageHtml(options: PanelOptions): string {
  // Frames are authored 21x25. Landscape shows only the 21x20 safe area, so
  // the sprite is clipped to its slot and pulled up by the prop headroom that
  // portrait keeps. See docs/ANIMATION.md §Safe area.
  //
  // The crop must use the scale this layout actually draws at, not the
  // authoring scale. A two-up sprite is drawn at scale 4, so a crop computed
  // at scale 8 removes ten authored units instead of five and leaves a void
  // beneath. Both constants come from the renderer for the same reason the
  // bands do.
  const crop =
    options.orientation === 'landscape'
      ? safeAreaCropUnits() * stageScale(options.layout)
      : 0;
  return spriteSlots(options.layout, options.orientation)
    .map((slot, index) => {
      const uri = options.frames[index] ?? options.frames[0];
      return `<div class="slot" style="left:${slot.x}px;top:${slot.y}px;width:${slot.width}px;height:${slot.height}px"><img class="sprite" src="${uri}" alt="" style="width:${slot.width}px;margin-top:-${crop}px"></div>`;
    })
    .join('');
}

function panelHtml(options: PanelOptions): string {
  const size = panelSize(options.orientation);
  const strip = Array.from(
    { length: 3 },
    (_, i) =>
      `<img class="mini" src="${options.miniClawd}" alt="" style="left:${8 + i * 21}px">`,
  ).join('');
  return `<div class="panel ${options.orientation}" style="width:${size.width}px;height:${size.height}px">
      <div class="band-status"><span>14:32</span><span>&times;2</span></div>
      ${stageHtml(options)}
      <div class="band-strip">${strip}<span class="overflow">+2</span></div>
      <div class="band-message"><span>${SAMPLE_MESSAGE}</span></div>
    </div>`;
}

function styles(): string {
  return `<style>
      body{margin:0;padding:24px;background:#010409;color:${DIM};
           font:12px ui-monospace,SFMono-Regular,monospace;display:inline-block}
      h2{color:${INK};font-size:13px;font-weight:400;margin:22px 0 10px}
      .row{display:flex;gap:32px;align-items:flex-start}
      .panel{position:relative;background:${PANEL_BACKGROUND};
             overflow:hidden;image-rendering:pixelated}
      [class^="band-"]{position:absolute}
      ${bandCss('portrait')}
      ${bandCss('landscape')}
      .band-status{display:flex;align-items:center;justify-content:space-between;
                   padding:0 6px;box-sizing:border-box;color:${INK};font-size:13px}
      .band-strip{border-top:1px solid #21262d;border-bottom:1px solid #21262d}
      .band-message{display:flex;align-items:center;padding:0 8px;
                    box-sizing:border-box;color:${INK};font-size:13px}
      .slot{position:absolute;overflow:hidden}
      .sprite{display:block;image-rendering:pixelated}
      .mini{position:absolute;top:8px;width:15px;height:16px;image-rendering:pixelated}
      .overflow{position:absolute;right:6px;top:9px}
    </style>`;
}

async function compose(frameDirs: readonly string[], outPath: string) {
  const frames = await Promise.all(frameDirs.map((dir) => firstFrame(dir)));
  const svg = await readFile('assets/clawd/base.svg');
  const miniClawd = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  const panel = (layout: StageLayout, orientation: Orientation) =>
    panelHtml({ layout, orientation, frames, miniClawd });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
  });
  await page.setContent(`${styles()}
    <h2>portrait 172&times;320 &mdash; true size</h2>
    <div class="row">
      <div><div>hero</div>${panel('hero', 'portrait')}</div>
      <div><div>two-up</div>${panel('twoUp', 'portrait')}</div>
    </div>
    <h2>landscape 320&times;172 &mdash; stage cropped to the 21&times;20 safe area</h2>
    <div><div>hero</div>${panel('hero', 'landscape')}</div>
    <div style="margin-top:14px"><div>two-up</div>${panel('twoUp', 'landscape')}</div>`);
  await page.locator('body').screenshot({ path: outPath });
  await browser.close();
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node tools/panel-mock.ts <frameDir> [frameDir2]');
  process.exit(1);
}
await compose(
  dirs.map((dir) => resolve(dir)),
  resolve('out/panel-mock.png'),
);
console.log('panel mock -> out/panel-mock.png');
