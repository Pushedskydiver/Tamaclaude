#!/usr/bin/env node
/**
 * Measure what the wire actually costs, on real frames.
 *
 * `docs/ARCHITECTURE.md` rests the host-renders design on dirty rectangles
 * plus RLE fitting inside a 12 Mbps USB link, and quotes a ~14:1 compression
 * ratio — which is upstream's whole-corpus figure for their on-flash sprites,
 * not a measurement of anything in this repo. This produces ours.
 *
 *   node tools/svg2frames.ts assets/clawd/animations/typing.svg out/typing
 *   node tools/measure-compression.ts out/typing out/gym
 *
 * Frames are decoded in Chromium because it is already a dependency; adding a
 * PNG decoder to ship one number would be worse.
 */
import type { Page } from 'playwright';

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { dirtyRect, encodeRect, extractRect } from '@tamaclaude/protocol';

/** Frames per second the panel plays sprites at. */
const FPS = 8;

/** Decode a PNG to RGB565 in the page, where a canvas already exists. */
function toRgb565(
  dataUri: string,
): Promise<{ pixels: number[]; width: number }> {
  return new Promise((done, fail) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) return fail(new Error('no 2d context'));
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push(
          ((data[i] & 0xf8) << 8) |
            ((data[i + 1] & 0xfc) << 3) |
            ((data[i + 2] & 0xf8) >> 3),
        );
      }
      done({ pixels, width: image.width });
    });
    image.addEventListener('error', () => fail(new Error('decode failed')));
    image.src = dataUri;
  });
}

async function loadFrames(page: Page, frameDir: string) {
  const names = (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
  const frames = [];
  for (const name of names) {
    const bytes = await readFile(resolve(frameDir, name));
    const uri = `data:image/png;base64,${bytes.toString('base64')}`;
    const decoded = await page.evaluate(toRgb565, uri);
    frames.push({
      pixels: Uint16Array.from(decoded.pixels),
      width: decoded.width,
    });
  }
  return frames;
}

function summarise(
  name: string,
  frames: readonly { pixels: Uint16Array; width: number }[],
) {
  const stats = frames.map((frame, index) => {
    const previous = frames[(index + frames.length - 1) % frames.length];
    const rect = dirtyRect(previous.pixels, frame.pixels, frame.width);
    if (!rect) return { area: 0, bytes: 1 };
    const encoded = encodeRect(extractRect(frame.pixels, rect, frame.width));
    return { area: rect.width * rect.height, bytes: encoded.length + 9 };
  });
  const total = stats.reduce((sum, s) => sum + s.bytes, 0);
  const worst = Math.max(...stats.map((s) => s.bytes));
  const fullFrame = frames[0].pixels.length * 2;
  const perSecond = (total / frames.length) * FPS;
  console.log(
    `  ${name.padEnd(12)} full frame ${String(fullFrame).padStart(6)}B | ` +
      `mean on wire ${String(Math.round(total / frames.length)).padStart(5)}B | ` +
      `worst ${String(worst).padStart(5)}B | ` +
      `${String(Math.round(perSecond)).padStart(6)} B/s | ` +
      `${(fullFrame / (total / frames.length)).toFixed(0)}:1`,
  );
  return perSecond;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node tools/measure-compression.ts <frameDir>...');
  process.exit(1);
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
console.log(`  at ${FPS}fps, dirty-rect + RLE, 9-byte header per rect\n`);
const rates: number[] = [];
for (const dir of dirs) {
  const frames = await loadFrames(page, resolve(dir));
  rates.push(summarise(dir.split('/').pop() ?? dir, frames));
}
await browser.close();
const busiest = Math.max(...rates);
console.log(
  `\n  busiest animation: ${Math.round(busiest)} B/s ` +
    `(${((busiest / 700_000) * 100).toFixed(2)}% of a 700 KB/s floor)`,
);
