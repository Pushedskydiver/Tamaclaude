/**
 * Rasterise a CSS-animated SVG into a deterministic PNG frame sequence.
 *
 * Build-time tooling, deliberately outside `packages/` — it is never shipped
 * and has no business in the runtime dependency graph. Run with Node's native
 * TypeScript support:
 *
 *   node tools/svg2frames.ts <input.svg> [outDir] [scale]
 *
 * Determinism is the whole point, and it takes two things rather than one:
 * nothing may depend on wall-clock time, *and* the capture has to wait for the
 * seek to be painted. Only the first was here until 24 Aug, while this header
 * claimed the guarantee outright — see `seekAnimations` for what that cost.
 * With both, the same SVG always produces the same bytes.
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
import type { Rgb } from './frame-palette.ts';
import type { Browser, Page } from 'playwright';

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

// Panel width comes from the package that owns it.
//
// This was a hand-maintained copy of 172, justified by a claim that `tools/`
// could not import the workspace. That was never the mechanism — what keeps
// Playwright out of the shipped graph is that nothing imports `tools`, which
// `eslint.config.ts` enforces — and it stopped being true at all once the
// boundary rule started allowing `tools` to read `protocol`.
//
// A line comment rather than a block: measured, a block above an import is
// surfaced by no hover — neither on the binding here nor on `PANEL_WIDTH` at
// its use below — so it would buy a reader nothing while adding one more node
// to the doc AST that `tools/detached-docs.test.ts` walks.
import { SCREEN_WIDTH as PANEL_WIDTH } from '@tamaclaude/protocol';

import { fingerprint } from './art-fingerprint.ts';
import {
  BACKGROUND,
  paletteOf,
  reportSnapping,
  shadowedAnimations,
  snapToPalette,
} from './frame-palette.ts';

/** Frames per second the panel plays sprites at. */
const FPS = 8;
/**
 * Default loop length. Every sub-animation period must divide it — see
 * docs/ANIMATION.md.
 *
 * An animation may override this with `data-loop-seconds` on its root `<svg>`,
 * which is how `idle` and `asleep` get a calm cadence. At a one-second loop a
 * blink happens sixty times a minute and a breath is a pant; a resting
 * creature needs about four seconds, and idle is the screen that is on most of
 * the time. The attribute lives in the SVG rather than in an argument so that
 * every tool downstream — the harness, the contact sheet, the compression
 * measurement — gets the right frame count without being told.
 */
const DEFAULT_LOOP_SECONDS = 1;
/** Device pixels per SVG user unit. 21 units x 8 = 168px, inside the 172 panel. */
const SCALE = 8;
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

/**
 * Loop length this SVG asks for, in whole seconds.
 *
 * Whole seconds only, so the frame count is always an integer and the "every
 * period divides the loop" invariant in docs/ANIMATION.md stays checkable by
 * eye.
 */
function loopSecondsOf(svg: string): number {
  const declared = /data-loop-seconds="([^"]+)"/.exec(svg)?.[1];
  if (declared === undefined) return DEFAULT_LOOP_SECONDS;
  const seconds = Number(declared);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error(
      `data-loop-seconds must be a positive whole number, got "${declared}"`,
    );
  }
  return seconds;
}

/**
 * Warn when an animation does not animate.
 *
 * A stylesheet can lose a keyframe block — to a bad edit, a stray brace, a
 * renamed selector — and still render perfectly valid, perfectly identical
 * frames. Nothing else notices: the six-command suite passes, the safe-area
 * check passes, the frames are the right size and the right colours. `gym` had
 * every keyframe but two silently deleted by an over-greedy regex and rendered
 * eight copies of one static image; the only thing that caught it was
 * `tools/measure-compression.ts` reporting a dirty rect of nothing at all.
 */
function reportMotion(frames: number, distinct: number): void {
  if (frames > 1 && distinct === 1) {
    console.warn(
      'warning: all frames are identical — this animation does not animate',
    );
    return;
  }
  if (frames > 2 && distinct === 2) {
    console.warn(`warning: only 2 distinct frames of ${frames}`);
  }
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

/**
 * Seek every animation to `elapsed` ms, and wait for the seek to be painted.
 *
 * The effect applies its own delay, so setting `currentTime` is the whole
 * seek. The two `requestAnimationFrame`s are not: without them
 * `page.screenshot` races the compositor and can rasterise a partially applied
 * state.
 *
 * **This was shipping wrong frames, not just unstable ones.** Measured on
 * `payoff`: renders of an unchanged SVG disagreed with each other on 4 of 9
 * comparisons, always a handful of pixels on one antialiased edge — the right
 * eye's, at ~32% coverage in one run and ~27% in another. That was the visible
 * symptom, and it is why re-baking a clean tree produced diffs in sprites
 * nobody had touched. The cause is worse: with the wait, **9 of 64 frames come
 * out different from what the tool produced before**, and 8 of those matched
 * none of ten unwaited runs. So those frames were consistently captured
 * mid-settle rather than occasionally.
 *
 * That the waited raster is the converged one rather than merely another
 * variant is checked rather than assumed: replacing the two frames with a flat
 * 250 ms sleep gives output identical to this on all 64 frames, and differing
 * from the unwaited tool on the same 9. Two frames cost nothing; the sleep
 * costs 16 seconds an animation.
 *
 * One frame is not enough. The first callback runs before the paint that the
 * style change schedules; the second runs after it, which is the point at
 * which the screenshot has something settled to capture.
 */
async function seekAnimations(elapsed: number): Promise<void> {
  document.getAnimations().forEach((animation) => {
    animation.currentTime = elapsed;
  });
  await new Promise((painted) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(painted);
    });
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

/**
 * Load the SVG into a fresh page with every animation frozen at time zero.
 *
 * `animation-play-state: paused` in the page's own stylesheet means the
 * animations never advance between load and capture — without it the first
 * frame silently depends on how long Chromium took to start.
 */
async function openStage(
  browser: Browser,
  svg: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${viewport.width}px;height:${viewport.height}px}` +
      `*{animation-play-state:paused !important}</style>${svg}`,
  );
  const shadowed = await page.evaluate(shadowedAnimations);
  if (shadowed.length > 0) {
    console.warn(
      `warning: ${shadowed.length} animation(s) lost to the \`animation\` ` +
        `shorthand — a later rule replaced an earlier one, it did not merge ` +
        `(docs/ANIMATION.md §Smoothness): ${shadowed.join('; ')}`,
    );
  }
  const delays = await page.evaluate(freezeAnimations);
  // Reports what the SVG declares, so a stylesheet that accidentally hands
  // several elements the same offset — an nth-child stride is the easy way to
  // do this — shows up as a suspiciously small count rather than as two
  // streams that mysteriously mirror each other.
  console.log(
    `${delays.length} animations, ${new Set(delays).size} distinct delays`,
  );
  return page;
}

/**
 * Seek to one frame, capture it, snap it to the palette, and write it.
 *
 * Capture and snap are two round trips into the page rather than one because
 * the source is an SVG document, not a canvas: Playwright has to rasterise it
 * before there are pixels to quantise.
 */
async function captureFrame(
  page: Page,
  frame: { elapsed: number; palette: Rgb[]; path: string },
): Promise<{ bytes: Buffer; soft: number }> {
  await page.evaluate(seekAnimations, frame.elapsed);
  const raw = await page.screenshot({ omitBackground: true });
  const snapped = await page.evaluate(snapToPalette, {
    uri: `data:image/png;base64,${raw.toString('base64')}`,
    palette: frame.palette,
    bg: [...BACKGROUND] as unknown as Rgb,
  });
  const bytes = Buffer.from(
    snapped.uri.slice(snapped.uri.indexOf(',') + 1),
    'base64',
  );
  await writeFile(frame.path, bytes);
  return { bytes, soft: snapped.soft };
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
  const frameCount = options.fps * loopSecondsOf(svg);
  // Width the frame index needs, so filenames sort lexicographically. Every
  // consumer — the contact sheet, the harness, the compression measurement —
  // reads the directory and sorts by name. A fixed two-digit pad was fine
  // while every loop was eight frames; at 128 it puts frame_100 immediately
  // after frame_10 and silently shuffles the animation.
  const pad = Math.max(2, String(frameCount - 1).length);
  const viewBoxTop = Number(
    /viewBox="([^"]+)"/
      .exec(svg)?.[1]
      ?.trim()
      .split(/[\s,]+/)[1] ?? 0,
  );

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await openStage(browser, svg, { width, height });
  const written: string[] = [];
  const distinct = new Set<string>();
  const palette = paletteOf(svg);
  let soft = 0;
  let highest = Number.POSITIVE_INFINITY;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const path = `${outDir}/frame_${String(frame).padStart(pad, '0')}.png`;
    const captured = await captureFrame(page, {
      elapsed: (frame / options.fps) * 1000,
      palette,
      path,
    });
    soft += captured.soft;
    written.push(path);
    distinct.add(createHash('md5').update(captured.bytes).digest('hex'));
    highest = Math.min(
      highest,
      await page.evaluate(topmostVisibleUnit, options.scale),
    );
  }

  // The fingerprint travels *with* the frames, and that is the whole point.
  // `bake-sprites.ts` reads PNGs from this directory and the SVG separately,
  // so nothing tied the two together: a review recoloured Clawd bright green,
  // re-baked without re-rendering, and got byte-identical pixels stamped with
  // the new SVG's hash — a stale bake carrying a green certificate. Writing it
  // here means the hash describes the input the pixels actually came from.
  await writeFile(`${outDir}/source.fingerprint`, fingerprint(svg), 'utf8');

  reportSafeArea(highest, viewBoxTop);
  reportMotion(written.length, distinct.size);
  reportSnapping(soft, written.length * width * height);

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
  scale: scaleArg ? Number(scaleArg) : SCALE,
});
console.log(`${files.length} frames -> ${out}`);
