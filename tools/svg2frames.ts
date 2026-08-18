/**
 * Rasterise a CSS-animated SVG into a deterministic PNG frame sequence.
 *
 * Build-time tooling, deliberately outside `packages/` — it is never shipped
 * and has no business in the runtime dependency graph. Run with Node's native
 * TypeScript support:
 *
 *   node tools/svg2frames.ts <input.svg> [outDir] [scale]
 *
 * Determinism is the whole point: nothing depends on wall-clock time, so the
 * same SVG always produces the same bytes.
 *
 * Seeking sets each animation's `currentTime` to the elapsed time and nothing
 * else. Do **not** compensate for `animation-delay` here, however tempting it
 * looks: a paused CSS animation reports `currentTime: 0` in Chromium whatever
 * its delay, which suggests the offset has been lost. It has not. The delay
 * lives inside the effect, which computes its own active time as
 * `localTime - delay`, so setting `currentTime = elapsed` already yields the
 * right phase and subtracting the delay again double-counts it.
 *
 * That mistake is close to undetectable by eye. Negative delays are usually a
 * neat fraction of the period — the two claws tap alternately via `-0.125s`
 * against a `0.25s` cycle — so double-counting lands an exact whole period
 * away and renders as perfect lockstep: everything still moves, just together.
 * Verified by driving both formulas and reading back the computed transforms.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

/** Frames per second the panel plays sprites at. */
const FPS = 8;
/** Loop length. Every sub-animation period must divide this — see docs/ANIMATION.md. */
const LOOP_SECONDS = 1;
/** Derived, not coincidental: changing FPS must not silently change loop length. */
const FRAME_COUNT = FPS * LOOP_SECONDS;
/** Device pixels per SVG user unit. 21 units x 8 = 168px, inside the 172 panel. */
const SCALE = 8;
/**
 * Panel width in device pixels. Duplicated from `@tamaclaude/protocol`, which
 * this file cannot import: `tools/` sits outside the workspace on purpose, so
 * Playwright never enters the runtime dependency graph. Keep in step by hand.
 */
const PANEL_WIDTH = 172;

type Options = {
  readonly fps: number;
  readonly frameCount: number;
  readonly scale: number;
};

/** Pause every animation, reporting the delays declared in the SVG. */
function freezeAnimations(): number[] {
  return document.getAnimations().map((animation) => {
    animation.pause();
    return Number(animation.effect?.getTiming().delay ?? 0);
  });
}

/** Seek every animation to `elapsed` ms. The effect applies its own delay. */
function seekAnimations(elapsed: number): void {
  document.getAnimations().forEach((animation) => {
    animation.currentTime = elapsed;
  });
}

async function renderFrames(
  svgPath: string,
  outDir: string,
  options: Options,
): Promise<string[]> {
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error(`scale must be a positive number, got ${options.scale}`);
  }

  const svg = await readFile(svgPath, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new Error(`no viewBox in ${svgPath}`);
  // SVG permits commas as well as whitespace between viewBox values, and
  // leading whitespace is legal. Splitting on whitespace alone shifts the
  // destructure by one and yields a negative width that dies inside Playwright
  // instead of at this guard.
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [, , unitsWide, unitsTall] = parts;
  if (parts.length !== 4 || !(unitsWide > 0) || !(unitsTall > 0)) {
    throw new Error(`bad viewBox: "${viewBox}"`);
  }

  const width = Math.round(unitsWide * options.scale);
  const height = Math.round(unitsTall * options.scale);
  if (width > PANEL_WIDTH) {
    // docs/ANIMATION.md tells authors to grow the stage for props. Nothing
    // states the ceiling, so it is enforced here instead of surfacing at
    // Stage 2 when the panel finally shows a clipped sprite.
    console.warn(
      `warning: stage is ${width}px wide at scale ${options.scale}, ` +
        `wider than the ${PANEL_WIDTH}px panel — it will be clipped`,
    );
  }

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });

  // `animation-play-state: paused` in the page's own stylesheet means the
  // animations never advance between load and capture — without it the first
  // frame silently depends on how long Chromium took to start.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${width}px;height:${height}px}` +
      `*{animation-play-state:paused !important}</style>${svg}`,
  );

  const delays = await page.evaluate(freezeAnimations);
  // Reports what the SVG declares, so a stylesheet that accidentally hands
  // several elements the same offset — an nth-child stride is the easy way to
  // do this — shows up as a suspiciously small count rather than as two
  // streams that mysteriously mirror each other.
  console.log(
    `${delays.length} animations, ${new Set(delays).size} distinct delays`,
  );
  const written: string[] = [];

  for (let frame = 0; frame < options.frameCount; frame += 1) {
    const elapsed = (frame / options.fps) * 1000;
    await page.evaluate(seekAnimations, elapsed);
    const path = `${outDir}/frame_${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path, omitBackground: true });
    written.push(path);
  }

  await browser.close();
  return written;
}

const [svgArg, outArg, scaleArg] = process.argv.slice(2);
if (!svgArg) {
  console.error(
    'usage: node tools/svg2frames.ts <input.svg> [outDir] [scale]\n' +
      `       scale defaults to ${SCALE} device pixels per SVG user unit`,
  );
  process.exit(1);
}
const out = outArg ?? `out/${basename(svgArg, '.svg')}`;
const files = await renderFrames(resolve(svgArg), resolve(out), {
  fps: FPS,
  frameCount: FRAME_COUNT,
  scale: scaleArg ? Number(scaleArg) : SCALE,
});
console.log(`${files.length} frames -> ${out}`);
