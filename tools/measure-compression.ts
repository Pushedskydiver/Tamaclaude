#!/usr/bin/env node
/**
 * Measure what the wire actually costs, on real frames.
 *
 * `docs/ARCHITECTURE.md` rests the host-renders design on dirty rectangles
 * plus RLE fitting inside a 12 Mbps USB link. It used to support that with
 * upstream's whole-corpus ~14:1 figure, which was never a measurement of
 * anything in this repo. This produces ours, and the doc quotes these.
 *
 *   node tools/svg2frames.ts assets/clawd/animations/typing.svg out/typing
 *   node tools/measure-compression.ts out/typing out/gym
 *
 * PNG decoding lives in `tools/png-rgb565.ts`, shared with `tools/blit.ts` so
 * the numbers quoted in the architecture doc and the bytes actually put on the
 * wire cannot come from two different decoders.
 */
import type { Frame } from '@tamaclaude/protocol';

import { resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import {
  dirtyRect,
  encodeRect,
  extractRect,
  RECT_HEADER_BYTES,
} from '@tamaclaude/protocol';

import { loadFrames } from './png-rgb565.ts';

/** Frames per second the panel plays sprites at. */
const FPS = 8;

/**
 * What the USB-CDC link actually carries, measured on the board.
 *
 * This was a 700 KB/s guess — a conservative reading of what USB 2.0
 * full-speed gives CDC after overhead — until `tools/usb-throughput.ts` put a
 * number on it: 562.5 KB/s, held flat across write sizes from 256 B to 64 KB,
 * with the host and the device agreeing to within 200 B/s. Flat across a 256x
 * range means this is the wire and not a tuning problem, so there is no write
 * size the daemon could pick that would do better.
 *
 * This tool used to divide by `700_000` — decimal, i.e. 683.6 KB/s — while the
 * prose around it said "700 KB/s". Against the measured figure every
 * percentage it printed was 21.5% too generous. Both sides are binary now, so
 * the constant and the prose finally mean the same thing.
 *
 * The measurement is what this firmware sustains rather than what the link can
 * carry: it sits at 47% of the theoretical full-speed bulk ceiling, so the
 * constraint is more likely the device's read path. A conservative floor, and
 * possibly a pessimistic one.
 */
const LINK_BYTES_PER_SECOND = 562.5 * 1024;

function summarise(name: string, frames: readonly Frame[]) {
  const stats = frames.map((frame, index) => {
    const previous = frames[(index + frames.length - 1) % frames.length];
    const rect = dirtyRect(previous, frame);
    if (!rect) return { area: 0, bytes: RECT_HEADER_BYTES };
    const encoded = encodeRect(extractRect(frame, rect));
    return {
      area: rect.width * rect.height,
      bytes: encoded.payload.byteLength + RECT_HEADER_BYTES,
    };
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
console.log(
  `  at ${FPS}fps, dirty-rect + RLE, ${RECT_HEADER_BYTES}-byte header per rect\n`,
);
const rates: number[] = [];
for (const dir of dirs) {
  // Bare rasters, dropping the mask: these figures are the stage band in
  // isolation, which is what `docs/ARCHITECTURE.md` scopes them to.
  //
  // They are no longer what goes on the wire. `tools/blit.ts` now sends whole
  // composed panels, and a panel's dirty rect happens to measure the same —
  // only the sprite changes between frames — but that is a coincidence of the
  // bands being static placeholders today, not a property. When the daemon
  // gives them content the two diverge, and the doc already says to measure
  // the composite case then.
  const frames = (await loadFrames(page, resolve(dir))).map((s) => s.frame);
  rates.push(summarise(dir.split('/').pop() ?? dir, frames));
}
await browser.close();
const busiest = Math.max(...rates);
console.log(
  `\n  busiest animation: ${Math.round(busiest)} B/s ` +
    `(${((busiest / LINK_BYTES_PER_SECOND) * 100).toFixed(2)}% of the measured ${(LINK_BYTES_PER_SECOND / 1024).toFixed(1)} KB/s link)`,
);
