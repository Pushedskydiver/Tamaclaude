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
 * pixels it is handed. **No tool composes a scene outside `render()` any
 * more**, which is most of `BUILD_PLAN.md`'s Stage 2 exit.
 *
 * Not all of it, and the first draft of this paragraph overclaimed: whole
 * panels are still drawn outside `render()` by `tools/bake-splash.ts` (which
 * rasterises the splash the firmware owns) and `tools/colour-bars.ts` (a test
 * pattern), both deliberately; and `tools/contact-sheet.ts` and the harness
 * still paint a flat backdrop behind transparent frames where the device
 * paints scenery. The narrow claim is the true one.
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
 * The one thing here with no device counterpart is `toRgba` — see its own
 * note. It is exported and tested rather than buried in the page function,
 * because it is the single place this file can be wrong while the device is
 * right.
 *
 * Pass `--message <text>` to put something other than the animation's name in
 * the message band. That band's height is unjudged and a long MCP tool name is
 * the case it has to survive, so the flag is the instrument for answering it.
 */
import type { SessionChip } from '@tamaclaude/renderer';

import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { TIMES_OF_DAY } from '@tamaclaude/renderer';

import { composePanels, loadPack } from './blit-scene.ts';
import { loadFrames } from './png-rgb565.ts';
import { toRgba } from './rgb565-rgba.ts';

/**
 * Every sky, not a chosen pair.
 *
 * A first version hardcoded `['day', 'night']` and called them "the variable
 * that is still live", which was the same drift this file exists to remove:
 * `TIMES_OF_DAY` is exported, `timeOfDay()` returns all four, and dawn and dusk
 * are six hours of every twenty-four. Dusk in particular is the second-darkest
 * scheme and so the second-worst case for a pale prop against its ground.
 */
const SKIES = TIMES_OF_DAY;

/**
 * Chips for the strip, so the band is judgeable rather than a 32px void.
 *
 * Every tone appears, in both origins, because the question this band raises
 * is whether several sessions at different states read apart at 15px wide.
 *
 * **Six, because `MAX_CHIPS` is five.** The strip's worst case is five chips
 * plus an overflow badge, which is exactly what the deleted harness sessions
 * control existed to make viewable. A first draft passed three and deferred
 * the overflow to `paintStrip`, which left no artefact in the repo able to
 * show the badge at all.
 */
const CHIPS: readonly SessionChip[] = [
  { tone: 'active', origin: 'local' },
  { tone: 'attention', origin: 'local' },
  { tone: 'resting', origin: 'remote' },
  { tone: 'active', origin: 'remote' },
  { tone: 'resting', origin: 'local' },
  { tone: 'attention', origin: 'remote' },
];

/** How much the enlarged copy is blown up, for inspecting individual pixels. */
const ZOOM = 3;

type Panel = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /**
   * The composed panel, already unpacked to RGBA.
   *
   * A typed array rather than a spread `number[]`, because Playwright
   * serialises typed arrays natively as base64 and walks a plain array
   * element-by-element through its full recursion — measured at 23ms against
   * 345ms for the same output. Unpacked in Node rather than in the page so
   * `toRgba` can be imported and tested; see `panel-mock.test.ts`.
   */
  readonly rgba: Uint8ClampedArray;
};

/**
 * Turn one animation's first frame into a composed panel per sky.
 *
 * The first frame rather than the whole loop, because this is the fixed
 * comparison image — `tools/contact-sheet.ts` is the artefact for judging
 * motion, and `pnpm harness` is the one for scrubbing it.
 */
function panelsFor(options: {
  readonly name: string;
  readonly raster: Parameters<typeof composePanels>[0][number];
  readonly pack: Awaited<ReturnType<typeof loadPack>>;
  readonly message: string | undefined;
}): readonly Panel[] {
  const { name, raster, pack, message } = options;
  return SKIES.map((sky) => {
    const [composed] = composePanels([raster], {
      orientation: 'landscape',
      pack,
      name,
      time: sky,
      sessions: CHIPS,
      message,
    });
    if (composed === undefined) {
      throw new Error(`composePanels returned nothing for ${name}`);
    }
    return {
      // Shape off the frame itself rather than off `panelSize` again — the
      // pixels and their dimensions should not come from two places.
      label: `${name} — ${sky}`,
      width: composed.width,
      height: composed.pixels.length / composed.width,
      rgba: toRgba(composed.pixels),
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
    // Allocated then filled, rather than constructed from `panel.rgba`
    // directly: the `ImageData` overload wants a buffer it owns, and what
    // arrives here has crossed a serialisation boundary.
    const image = new ImageData(panel.width, panel.height);
    image.data.set(panel.rgba);
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
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d context');
      context.putImageData(image, 0, 0);
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
  try {
    await page.setContent(
      `<style>${SHEET_STYLE}</style><div id="sheet"></div>`,
    );
    await page.evaluate(paintSheet, { panels, zoom: ZOOM });
    await page.locator('body').screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
}

async function compose(
  frameDirs: readonly string[],
  outPath: string,
  message: string | undefined,
) {
  const pack = await loadPack(resolve('packs/example'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const panels: Panel[] = [];
  try {
    for (const dir of frameDirs) {
      const rasters = await loadFrames(page, dir);
      const first = rasters[0];
      if (first === undefined) throw new Error(`no frames in ${dir}`);
      // The directory name is the animation name. `composePanels` uses it
      // twice: for `castsShadow` — `bouldering` is on a wall and casts none —
      // and as the message band's text unless `--message` overrides it.
      panels.push(
        ...panelsFor({
          name: basename(resolve(dir)),
          raster: first,
          pack,
          message,
        }),
      );
    }
  } finally {
    await browser.close();
  }
  await shoot(panels, outPath);
}

const argv = process.argv.slice(2);
const flag = argv.indexOf('--message');
// `--message <text>` puts something other than the animation's name in the
// band. The case worth passing is a long MCP tool name: the band's height is
// unjudged, and this is the only way in the repo to put one through the real
// `wrapText` at true size.
const message = flag === -1 ? undefined : argv[flag + 1];
if (flag !== -1 && message === undefined) {
  console.error('--message needs a value');
  process.exit(1);
}
const dirs =
  flag === -1 ? argv : [...argv.slice(0, flag), ...argv.slice(flag + 2)];
if (dirs.length === 0) {
  console.error(
    'usage: node tools/panel-mock.ts <frameDir> [frameDir2] [--message <text>]',
  );
  process.exit(1);
}
await compose(dirs, resolve('out/panel-mock.png'), message);
console.log('panel mock -> out/panel-mock.png');
