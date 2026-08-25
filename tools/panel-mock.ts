#!/usr/bin/env node
/**
 * Compose the panel the way the device does, and screenshot it for review.
 *
 * This is the artefact that goes into a pull request, and it used to draw its
 * own panel in browser CSS with `#0d1117` and `#c9d1d9` hardcoded, hand-synced
 * to `packs/example`'s palette — so a pack swap changed the device and not the
 * mock, and reviewers looked at the mock.
 *
 * It composes through `render()` in Node, via the same `composePanels` that
 * `tools/blit.ts` sends to the panel, and the page only blits the RGBA it is
 * handed. **No tool composes a `Scene` outside `render()`**, which is most of
 * `BUILD_PLAN.md`'s Stage 2 exit. Not all: `bake-splash.ts` and
 * `colour-bars.ts` draw whole panels deliberately, and `contact-sheet.ts` and
 * the harness still paint a flat backdrop behind transparent frames.
 *
 *   node tools/panel-mock.ts out/typing [out/gym ...] [--message <text>]
 *                             [--layout hero|twoUp]
 *
 * **Landscape, and hero unless `--layout twoUp`.** The daemon hardcodes both
 * (`packages/cli/src/daemon.ts`), and portrait is refused by a
 * `_Static_assert` in the firmware until portrait splash art exists.
 *
 * Landscape two-up is not refused, though — nothing selects it, and the screen
 * spec calls it "a genuine trade rather than a settled rejection". Until 25 Aug
 * no tool could compose it, so the question could not be answered by looking.
 * `--layout twoUp` is that picture. It is not a recommendation: `daemon.ts`
 * still picks hero, with a bare literal and no rationale beside it, which is
 * what `BUILD_PLAN.md` carries as open.
 *
 * What it varies instead is what the shipping panel actually varies: all four
 * skies, since the daemon passes `timeOfDay(now)`; the strip at its
 * five-chips-plus-badge limit; and `--message`, so a long MCP tool name can be
 * put through the real `wrapText`. That last answers the question for
 * landscape, whose message band is derived as `height - (status + strip)` =
 * 116px. `BAND_HEIGHTS.message` = 64 reaches `portraitBands()` alone, so the
 * constant `BUILD_PLAN.md` calls unjudged is not the band this renders.
 *
 * It composes frame 0 only. That answers "does this read against its ground",
 * not "does this move" — `tools/contact-sheet.ts` is still the artefact for
 * motion and the loop seam.
 */
import type { SessionChip, StageLayout } from '@tamaclaude/renderer';

import { basename, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';

import { TIMES_OF_DAY } from '@tamaclaude/renderer';

import { composePanels, loadPack } from './blit-scene.ts';
import { loadFrames } from './png-rgb565.ts';
import { toRgba } from './rgb565-rgba.ts';

/**
 * Every sky the daemon can pass, read from the renderer rather than listed.
 *
 * `timeOfDay()` returns all four and dawn plus dusk are six hours of every
 * twenty-four. Dusk matters most: it is the second-darkest scheme, so it is
 * the second-worst case for a pale prop against its ground.
 */
const SKIES = TIMES_OF_DAY;

/**
 * Chips for the strip, at the limit `paintStrip` imposes.
 *
 * `MAX_CHIPS` is five, so a sixth session becomes a `+1` badge rather than a
 * chip — the case worth seeing, and the case no artefact in the repo could
 * show before. **Only the first five are drawn**, so the sixth entry never
 * appears; the five that do cover every tone.
 *
 * **All local, because that is all the device can produce.** These were mixed
 * local and remote until the TCP transport was cut on 25 Aug. Drawing remote
 * chips now would put a state no panel can reach into the artefact people
 * judge the panel from, which is the exact defect this file was rewritten to
 * remove. `packages/renderer/src/strip.test.ts` pins the hollow-chip branch
 * instead — a test is the right place for a shape nothing ships.
 *
 * Hardcoded at six, so the ordinary one-to-five case has no artefact. That is
 * the same gap this closed, rotated: `composePanels` already takes `sessions`,
 * so a `--sessions <n>` flag is three lines when someone wants it.
 */
const CHIPS: readonly SessionChip[] = [
  { tone: 'active', origin: 'local' },
  { tone: 'attention', origin: 'local' },
  { tone: 'resting', origin: 'local' },
  { tone: 'active', origin: 'local' },
  { tone: 'attention', origin: 'local' },
  { tone: 'resting', origin: 'local' },
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
   * `toRgba` can be imported and tested; see `rgb565-rgba.test.ts`.
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
  readonly layout: StageLayout;
}): readonly Panel[] {
  const { name, raster, pack, message, layout } = options;
  return SKIES.map((sky) => {
    const [composed] = composePanels([raster], {
      orientation: 'landscape',
      pack,
      name,
      time: sky,
      sessions: CHIPS,
      message,
      layout,
    });
    if (composed === undefined) {
      throw new Error(`composePanels returned nothing for ${name}`);
    }
    return {
      // Shape off the frame itself rather than off `panelSize` again — the
      // pixels and their dimensions should not come from two places.
      label: `${name} — ${sky}${layout === 'hero' ? '' : ` — ${layout}`}`,
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
  options: {
    readonly message: string | undefined;
    readonly layout: StageLayout;
  },
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
          message: options.message,
          layout: options.layout,
        }),
      );
    }
  } finally {
    await browser.close();
  }
  await shoot(panels, outPath);
}

/**
 * Flags, via `node:util` rather than by hand.
 *
 * A hand-rolled `indexOf`/`slice` version shipped first and broke on three
 * realistic inputs: `--message=text` fell through to the directory list, a
 * repeated flag left the stray value there too, and both then reached
 * `loadFrames` and died on an ENOENT naming a path nobody typed. `parseArgs`
 * is a builtin, so this costs no dependency.
 */
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    // Something other than the animation's name in the message band. The case
    // worth passing is a long MCP tool name — this is the only *review
    // artefact* that puts one through the real `wrapText` at true size; the
    // shipping daemon does it on the panel whenever such a tool runs.
    message: { type: 'string' },
    // `hero` or `twoUp`. See the header: two-up is an open question that no
    // tool could show a picture of until now.
    layout: { type: 'string', default: 'hero' },
  },
});

if (values.layout !== 'hero' && values.layout !== 'twoUp') {
  console.error(`--layout takes 'hero' or 'twoUp', not '${values.layout}'`);
  process.exit(1);
}
if (positionals.length === 0) {
  console.error(
    'usage: node tools/panel-mock.ts <frameDir> [frameDir2] ' +
      '[--message <text>] [--layout hero|twoUp]',
  );
  process.exit(1);
}
await compose(positionals, resolve('out/panel-mock.png'), {
  message: values.message,
  layout: values.layout,
});
console.log('panel mock -> out/panel-mock.png');
