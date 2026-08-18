/**
 * Rasterise a CSS-animated SVG into a deterministic PNG frame sequence.
 *
 * Build-time tooling, deliberately outside `packages/` — it is never shipped
 * and has no business in the runtime dependency graph. Run with Node's native
 * TypeScript support:
 *
 *   node tools/svg2frames.ts assets/clawd/animations/typing.svg out/typing
 *
 * Determinism is the whole point. Animations are paused *before* the first
 * frame is taken, so every animation sits at its authored starting phase —
 * which is what makes a negative `animation-delay` (how we put the two claws
 * out of phase) survive into the output. Each animation's paused
 * `currentTime` is recorded once, then advanced by an exact frame interval.
 * Nothing depends on wall-clock time, so the same SVG always produces the same
 * bytes.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

/** Frames per second the panel plays sprites at. */
const FPS = 8;
/** One second of animation. Every sub-animation period must divide this. */
const FRAME_COUNT = 8;
/** Device pixels per SVG user unit. 21 units x 8 = 168px, inside the 172 panel. */
const SCALE = 8;

type Options = {
  readonly fps: number;
  readonly frameCount: number;
  readonly scale: number;
};

/** Pause every animation at its authored phase and record where that is. */
function freezeAnimations(): number[] {
  return document.getAnimations().map((animation) => {
    animation.pause();
    return Number(animation.currentTime ?? 0);
  });
}

/** Advance every animation to `elapsed` ms past its own authored phase. */
function seekAnimations(input: { starts: number[]; elapsed: number }): void {
  document.getAnimations().forEach((animation, index) => {
    animation.currentTime = (input.starts[index] ?? 0) + input.elapsed;
  });
}

async function renderFrames(
  svgPath: string,
  outDir: string,
  options: Options,
): Promise<string[]> {
  const svg = await readFile(svgPath, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new Error(`no viewBox in ${svgPath}`);
  const [, , unitsWide, unitsTall] = viewBox.split(/\s+/).map(Number);
  if (!unitsWide || !unitsTall) throw new Error(`bad viewBox: ${viewBox}`);

  const width = Math.round(unitsWide * options.scale);
  const height = Math.round(unitsTall * options.scale);

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

  const starts = await page.evaluate(freezeAnimations);
  const written: string[] = [];

  for (let frame = 0; frame < options.frameCount; frame += 1) {
    const elapsed = (frame / options.fps) * 1000;
    await page.evaluate(seekAnimations, { starts, elapsed });
    const path = `${outDir}/frame_${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path, omitBackground: true });
    written.push(path);
  }

  await browser.close();
  return written;
}

const [svgArg, outArg, scaleArg] = process.argv.slice(2);
if (!svgArg) {
  console.error('usage: node tools/svg2frames.ts <input.svg> [outDir]');
  process.exit(1);
}
const out = outArg ?? `out/${basename(svgArg, '.svg')}`;
const files = await renderFrames(resolve(svgArg), resolve(out), {
  fps: FPS,
  frameCount: FRAME_COUNT,
  scale: scaleArg ? Number(scaleArg) : SCALE,
});
console.log(`${files.length} frames -> ${out}`);
