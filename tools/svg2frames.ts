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
/** Stage band height. The other three panel bands occupy the remaining 120px. */
const STAGE_HEIGHT = 200;
/**
 * Units of prop headroom landscape crops off the top — `docs/ANIMATION.md`
 * §Safe area. Everything a frame actually shows must sit below this line, or
 * the animation is portrait-only and nobody finds out until the panel is
 * mounted the other way round.
 */
const SAFE_AREA_CROP_UNITS = 5;

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

/**
 * Topmost visible content in this frame, in SVG user units.
 *
 * Three things are excluded, each for a reason:
 *
 * - **Zero opacity**, checked up the ancestor chain since hiding a group is
 *   how pose swapping works. That exemption is what gives `typing` its
 *   headroom, since its data bits fade out before they reach the crop line.
 * - **Anything entirely above the viewBox**, which is already invisible in
 *   portrait and so cannot be a landscape regression.
 * - **Groups marked `data-safe-area="ignore"`**, for periodic scrolling
 *   backgrounds. `bouldering`'s wall tiles past the crop by design and loses
 *   nothing, because the pattern repeats. The marker makes that a stated
 *   exemption rather than a silently tolerated warning.
 */
function topmostVisibleUnit(scale: number): number {
  const svg = document.querySelector('svg');
  const viewBoxY = Number(
    svg?.getAttribute('viewBox')?.split(/[\s,]+/)[1] ?? 0,
  );
  const excluded = (element: Element): boolean => {
    let node: Element | null = element;
    while (node && node.tagName !== 'svg') {
      if (getComputedStyle(node).opacity === '0') return true;
      if (node.getAttribute('data-safe-area') === 'ignore') return true;
      node = node.parentElement;
    }
    return false;
  };
  const tops = [...(svg?.querySelectorAll('rect') ?? [])]
    .filter((element) => !excluded(element))
    .map((element) => element.getBoundingClientRect().top / scale + viewBoxY)
    .filter((top) => top >= viewBoxY);
  return tops.length > 0 ? Math.min(...tops) : Number.POSITIVE_INFINITY;
}

/** Warn if anything a frame shows sits in the strip landscape crops away. */
function reportSafeArea(highest: number, viewBoxTop: number): void {
  const safeAreaTop = viewBoxTop + SAFE_AREA_CROP_UNITS;
  if (highest >= safeAreaTop) return;
  console.warn(
    `warning: content reaches y=${highest} but the safe area starts at ` +
      `y=${safeAreaTop} — this animation is clipped when the panel is ` +
      `mounted landscape (docs/ANIMATION.md §Safe area)`,
  );
}

/** Seek every animation to `elapsed` ms. The effect applies its own delay. */
function seekAnimations(elapsed: number): void {
  document.getAnimations().forEach((animation) => {
    animation.currentTime = elapsed;
  });
}

type Stage = { readonly width: number; readonly height: number };

/**
 * Resolve an SVG's viewBox to device pixels, warning if it will not fit.
 *
 * `docs/ANIMATION.md` tells authors to grow the stage around the character to
 * make room for props, and both bounds are checked here rather than surfacing
 * at Stage 2 as a clipped sprite. Height matters as much as width: an over-tall
 * stage does not overflow the panel, it silently eats the session strip and
 * message bands below it.
 */
function stageDimensions(svg: string, scale: number): Stage {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new Error('no viewBox in input SVG');
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

  const width = Math.round(unitsWide * scale);
  const height = Math.round(unitsTall * scale);
  if (width > PANEL_WIDTH) {
    console.warn(
      `warning: stage is ${width}px wide at scale ${scale}, wider than the ` +
        `${PANEL_WIDTH}px panel — it will be clipped`,
    );
  }
  if (height > STAGE_HEIGHT) {
    console.warn(
      `warning: stage is ${height}px tall at scale ${scale}, taller than the ` +
        `${STAGE_HEIGHT}px stage band — it will overlap the session strip and ` +
        `message bands`,
    );
  }
  return { width, height };
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
  const { width, height } = stageDimensions(svg, options.scale);
  const viewBoxTop = Number(
    /viewBox="([^"]+)"/
      .exec(svg)?.[1]
      ?.trim()
      .split(/[\s,]+/)[1] ?? 0,
  );

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
  let highest = Number.POSITIVE_INFINITY;

  for (let frame = 0; frame < options.frameCount; frame += 1) {
    const elapsed = (frame / options.fps) * 1000;
    await page.evaluate(seekAnimations, elapsed);
    const path = `${outDir}/frame_${String(frame).padStart(2, '0')}.png`;
    await page.screenshot({ path, omitBackground: true });
    written.push(path);
    highest = Math.min(
      highest,
      await page.evaluate(topmostVisibleUnit, options.scale),
    );
  }

  reportSafeArea(highest, viewBoxTop);

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
