#!/usr/bin/env node
/**
 * Compose full-panel mockups so layout decisions are made by looking, not
 * arguing.
 *
 * `.claude/research/screens/spec.md` §11 leaves three questions open that are
 * measurements rather than opinions — hero versus two-up, whether the message
 * band earns 64px, whether the strip earns 32px — and the design freeze is one
 * day after the harness afternoon booked to answer them. This renders both
 * candidates at true panel size, side by side, from real animation frames.
 *
 *   node tools/svg2frames.ts assets/clawd/animations/typing.svg out/typing
 *   node tools/panel-mock.ts out/typing out/gym
 *
 * Band geometry comes from `@tamaclaude/renderer`, not from constants copied
 * here, so the mock a decision is made from cannot drift from the code that
 * implements it.
 */
import type { StageLayout } from '@tamaclaude/renderer';

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { panelBands, spriteSlots } from '@tamaclaude/renderer';

const PANEL_BACKGROUND = '#0d1117';
const INK = '#c9d1d9';
const DIM = '#6e7681';
const REVIEW_SCALE = 2;

async function firstFrame(frameDir: string): Promise<string> {
  const names = (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error(`no PNGs in ${frameDir}`);
  const bytes = await readFile(resolve(frameDir, names[0]));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function bandCss(): string {
  const bands = panelBands();
  return Object.entries(bands)
    .map(
      ([name, rect]) =>
        `.band-${name}{position:absolute;left:${rect.x}px;top:${rect.y}px;` +
        `width:${rect.width}px;height:${rect.height}px;}`,
    )
    .join('');
}

function panelHtml(
  layout: StageLayout,
  frames: readonly string[],
  miniClawd: string,
): string {
  const slots = spriteSlots(layout)
    .map((slot, index) => {
      const uri = frames[index] ?? frames[0];
      return `<img class="sprite" src="${uri}" alt="" style="left:${slot.x}px;top:${slot.y}px;width:${slot.width}px;height:${slot.height}px">`;
    })
    .join('');
  const strip = Array.from(
    { length: 3 },
    (_, i) =>
      `<img class="mini" src="${miniClawd}" alt="" style="left:${8 + i * 21}px">`,
  ).join('');
  return `
    <div class="panel">
      <div class="band-status"><span class="clock">14:32</span><span class="count">&times;2</span></div>
      ${slots}
      <div class="band-strip">${strip}<span class="overflow">+2</span></div>
      <div class="band-message"><span>Wansum?</span></div>
    </div>`;
}

async function compose(frameDirs: readonly string[], outPath: string) {
  const frames = await Promise.all(frameDirs.map((dir) => firstFrame(dir)));
  const miniClawd = `data:image/svg+xml;base64,${(await readFile('assets/clawd/base.svg')).toString('base64')}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  await page.setContent(`
    <style>
      body{margin:0;padding:24px;background:#010409;color:${DIM};
           font:12px ui-monospace,SFMono-Regular,monospace;display:inline-block}
      h2{color:${INK};font-size:13px;font-weight:400;margin:0 0 10px}
      .row{display:flex;gap:32px;align-items:flex-start}
      .panel{position:relative;width:172px;height:320px;background:${PANEL_BACKGROUND};
             overflow:hidden;image-rendering:pixelated}
      .scaled{transform:scale(${REVIEW_SCALE});transform-origin:top left}
      .scaled-box{width:${172 * REVIEW_SCALE}px;height:${320 * REVIEW_SCALE}px}
      ${bandCss()}
      .band-status{display:flex;align-items:center;justify-content:space-between;
                   padding:0 6px;box-sizing:border-box;color:${INK};font-size:13px}
      .band-strip{border-top:1px solid #21262d;border-bottom:1px solid #21262d}
      .band-message{display:flex;align-items:center;padding:0 8px;
                    box-sizing:border-box;color:${INK};font-size:13px}
      .sprite{position:absolute;image-rendering:pixelated}
      .mini{position:absolute;top:8px;width:15px;height:16px;image-rendering:pixelated}
      .overflow{position:absolute;right:6px;top:9px}
    </style>
    <h2>true size &mdash; 172&times;320, band geometry from @tamaclaude/renderer</h2>
    <div class="row">
      <div><div>hero</div>${panelHtml('hero', frames, miniClawd)}</div>
      <div><div>two-up</div>${panelHtml('twoUp', frames, miniClawd)}</div>
    </div>
    <h2 style="margin-top:28px">${REVIEW_SCALE}&times;</h2>
    <div class="row">
      <div class="scaled-box"><div class="scaled">${panelHtml('hero', frames, miniClawd)}</div></div>
      <div class="scaled-box"><div class="scaled">${panelHtml('twoUp', frames, miniClawd)}</div></div>
    </div>`);
  await page.locator('body').screenshot({ path: outPath });
  await browser.close();
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node tools/panel-mock.ts <frameDir> [frameDir2]');
  process.exit(1);
}
await compose(
  dirs.map((d) => resolve(d)),
  resolve('out/panel-mock.png'),
);
console.log('panel mock -> out/panel-mock.png');
