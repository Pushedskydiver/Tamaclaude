import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LID_SLOT, paintLogo } from '../packages/renderer/src/logo.ts';
import { PET_SLOT } from '../packages/renderer/src/pet.ts';
import { SLOTS } from './pack-slots.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The whole pipeline, on a synthetic mark — because the unit tests could not
 * see the bug that mattered.
 *
 * `opaqueRuns`, `runsToRects`, `viewBoxUnits`, `scaleToWidth` and `collisions`
 * are each covered in isolation and all of them passed while the tool's
 * documented workflow emitted a solid rectangle. The defect lived between
 * them: `snapToPalette` clears alpha only where a pixel's snapped colour
 * equals the ground it was composited over, and the snapped colour is always a
 * palette entry — so a `--over` outside the palette matched nothing, every
 * pixel came back opaque, and the mark became its own bounding box.
 *
 * The fix is not a refusal: the ground joins the snap candidates, so the edge
 * still resolves to it and drops out while the mark survives. That is why the
 * case below drives an out-of-palette ground and asserts the *output* rather
 * than an exit code — an exit-code assertion would stop testing the defect the
 * moment the guard changed shape.
 *
 * Nothing about that is visible from any one module. `tools/bake-splash.ts`
 * gates its equivalent against a committed artefact for the same reason; this
 * gates against a fixture written here, because a logo is pack content and a
 * two-shape stand-in is not.
 */
function fixture(top: string, bottom: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <rect x="4" y="4" width="32" height="10" fill="${top}"/>
  <rect x="4" y="26" width="32" height="10" fill="${bottom}"/>
</svg>`;
}

/** The pack in version control, so the test needs no fixture pack. */
const PACK = 'packs/example';

/**
 * Colours read from the manifest rather than written here.
 *
 * `tools/one-panel-renderer.test.ts` fails any file under `tools/` that names
 * a pack palette colour without declaring why, and it is right to: a hex
 * copied into a test is a second source of truth that goes stale silently.
 * Reading them also makes the fixture correct for any pack.
 */
const PALETTE: readonly string[] = (
  JSON.parse(readFileSync(join(ROOT, PACK, 'manifest.json'), 'utf8')) as {
    palette: readonly (readonly number[])[];
  }
).palette.map(
  (entry) => `#${entry.map((c) => c.toString(16).padStart(2, '0')).join('')}`,
);

function paletteAt(index: number): string {
  const colour = PALETTE[index];
  if (colour === undefined) throw new Error(`no palette[${index}]`);
  return colour;
}

/** `palette[0]` is the background, and the tool's own default ground. */
const BACKGROUND = paletteAt(0);

/**
 * Both streams, because the two things worth asserting use different ones.
 *
 * The rects go to stdout and the collision warning to stderr, and an earlier
 * version of this helper returned stdout on success and stderr only on
 * failure — so the warning test passed a stdout that could never contain it,
 * and failed for the right reason by luck rather than catching anything.
 */
function run(args: readonly string[]): { output: string; status: number } {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'tools/logo2pixel.ts'), ...args],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // Say what is actually wrong on a machine that has never built this repo.
  // `pnpm install` fetches no browser — pnpm 10 does not run a dependency's
  // install scripts — so every assertion here failed with `expected 1 to be
  // +0`, five times, with no mention of Playwright. `frame-palette.test.ts`
  // already had this guard; found by pointing `PLAYWRIGHT_BROWSERS_PATH` at an
  // empty directory, which is what Stage 6's clean-account dry run would do
  // for real.
  if (/executable doesn't exist/i.test(output)) {
    throw new Error(
      'headless Chromium is missing — run `pnpm exec playwright install ' +
        '--only-shell chromium` (README §Development)',
    );
  }
  return { output, status: result.status ?? 1 };
}

function fixturePath(svg: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'logo2pixel-'));
  const path = join(dir, 'mark.svg');
  writeFileSync(path, svg);
  return path;
}

/** Widths of every `<rect>` in a rects-mode run, in document order. */
function rectWidths(stdout: string): number[] {
  return [...stdout.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
}

/**
 * How many separated horizontal bands the rects fall into.
 *
 * The fixture is two bars with a gap, so a correct render is two bands. A
 * count of rects cannot see that: a solid block, one bar missing, and both
 * bars present all produce plausible counts. This is the structure.
 */
function bandCount(stdout: string): number {
  const ys = [
    ...new Set([...stdout.matchAll(/y="([\d.]+)"/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (ys.length === 0) return 0;
  // Derived from the tool's own header line rather than assuming `--scale`'s
  // default, so this stays correct if a caller passes one.
  const declared = /([\d.]+) units per pixel/.exec(stdout)?.[1];
  const step = declared === undefined ? 1 / 8 : Number(declared);
  return ys.reduce(
    (bands, y, i) =>
      i > 0 && y - (ys[i - 1] ?? 0) > step * 1.5 ? bands + 1 : bands,
    1,
  );
}

describe('logo2pixel, end to end', () => {
  it('does not emit the mark as its own bounding box', () => {
    // The happy path: a legal ground, which is what the tool was always
    // tested with and is exactly why the original defect survived. It is here
    // as the control — the case that catches the defect is the next one, which
    // supplies a ground the palette does not contain.
    const { output: stdout, status } = run([
      fixturePath(fixture(paletteAt(2), paletteAt(3))),
      '--pack',
      PACK,
      '--width',
      '14',
      '--over',
      BACKGROUND,
      '--format',
      'rects',
    ]);
    expect(status).toBe(0);
    const widths = rectWidths(stdout);
    expect(widths.length).toBeGreaterThan(0);
    // 16px at 0.125 units per pixel is 2 units, so a full-width run is 2.
    expect(Math.max(...widths)).toBeLessThan(2);
    // Two bars with a gap must render as two separated bands. A rect count
    // cannot tell that from a solid block or from one bar going missing —
    // an earlier version asserted `length < 20` against a 16-row raster,
    // which no outcome could exceed.
    expect(bandCount(stdout)).toBe(2);
  });

  it('keeps the mark when the ground is not a palette colour', () => {
    // The surface a mark sits on is usually not a pack colour: the laptop lid
    // in `typing` is a fixed `#A91326` in the artwork and no pack palette
    // reaches a baked sprite, so it is that on every install. The ground has
    // to join the snap candidates for anything to be transparent — without
    // that, every pixel comes back opaque and this is a solid block.
    const { output: stdout, status } = run([
      fixturePath(fixture(paletteAt(2), paletteAt(3))),
      '--pack',
      PACK,
      '--width',
      '16',
      '--over',
      '#A91326',
      '--format',
      'rects',
    ]);
    expect(status).toBe(0);
    const widths = rectWidths(stdout);
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.max(...widths)).toBeLessThan(2);
    expect(bandCount(stdout)).toBe(2);
  });
});

describe('logo2pixel writes its PNG', () => {
  it('writes into a directory that does not exist yet', () => {
    // The default format, and it had no test: `out/` is gitignored so it is
    // absent from every fresh checkout, and the tool wrote into it without
    // creating it. The failure was a raw ENOENT after Chromium had launched
    // and done all the work.
    const target = join(
      mkdtempSync(join(tmpdir(), 'logo2pixel-out-')),
      'nested',
      'mark.png',
    );
    const { status, output } = run([
      fixturePath(fixture(paletteAt(2), paletteAt(3))),
      target,
      '--pack',
      PACK,
      '--width',
      '16',
    ]);
    expect(output).not.toMatch(/ENOENT/);
    expect(status).toBe(0);
    expect(existsSync(target)).toBe(true);
  });
});

describe('logo2pixel refuses input that would ship silently wrong', () => {
  it('refuses a scale that would put NaN in the output', () => {
    // `coordinate()` stringifies NaN happily and Chromium ignores an invalid
    // attribute silently, so this reaches the panel as a blank lid.
    const { status, output } = run([
      fixturePath(fixture(paletteAt(2), paletteAt(3))),
      '--pack',
      PACK,
      '--width',
      '16',
      '--format',
      'rects',
      '--scale',
      'abc',
    ]);
    expect(status).toBe(1);
    // The message, not just the code: `run` reports a missing import or a
    // signal as status 1 too, so an exit-code-only assertion passes when the
    // tool cannot start at all.
    expect(output).toMatch(/--scale must be a positive number/);
  });
});

describe('logo2pixel warns about colours it cannot keep apart', () => {
  it('warns when a mark colour resolves to the ground it sits on', () => {
    // The hazard the ground-as-candidate fix introduces. A logo colour whose
    // nearest candidate is the ground snaps to it and renders invisible
    // against that surface — and it is not a *collision*, because no two mark
    // colours merged, so the collision warning cannot see it.
    const ground = '#A91326';
    // A shade off the ground, so its nearest candidate is the ground itself.
    // It tracked the lid colour when that was `#30363B` and had to move with
    // it — a near-miss of the *old* ground is a plain palette colour now, and
    // the test stopped exercising the warning at all.
    const nearlyTheGround = '#AA1427';
    const { output, status } = run([
      fixturePath(fixture(paletteAt(2), nearlyTheGround)),
      '--pack',
      PACK,
      '--width',
      '16',
      '--over',
      ground,
      '--format',
      'rects',
    ]);
    expect(status).toBe(0);
    expect(output).toMatch(/disappear into the ground|resolves to the ground/);
  });

  it('warns when the palette cannot tell two of the mark colours apart', () => {
    // The one safety feature, exercised through the real pipeline rather than
    // through `collisions` alone.
    // A nudge off `palette[2]`: distinct in the source, nearest to the same
    // entry, so it is exactly the merge the warning exists for.
    const near = paletteAt(2).replace(
      /^#(..)/,
      (_, r: string) =>
        `#${Math.min(255, Number.parseInt(r, 16) + 8)
          .toString(16)
          .padStart(2, '0')}`,
    );
    const { output: stdout, status } = run([
      fixturePath(fixture(paletteAt(2), near)),
      '--pack',
      PACK,
      '--width',
      '16',
      '--over',
      BACKGROUND,
      '--format',
      'rects',
    ]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/cannot tell them apart/);
  });
});

/** Paint a pack logo object where the shipping landscape-hero stage puts it. */
function paintOnHero(logo: unknown): {
  readonly target: { pixels: Uint16Array; width: number; height: number };
  readonly painted: ReturnType<typeof paintLogo>;
} {
  const target = {
    pixels: new Uint16Array(320 * 172).fill(0x1234),
    width: 320,
    height: 172,
  };
  const painted = paintLogo(
    target,
    {
      origin: { x: 0, y: -34 },
      within: { x: 0, y: 6, width: 168, height: 160 },
    },
    logo as { width: number; height: number; pixels: string; mask: string },
  );
  return { target, painted };
}

describe('--format pack', () => {
  it('round-trips through the renderer that reads it', () => {
    // **The gate this format did not have.** `pack565` and `blob` here are a
    // second hand-rolled copy of the framing `bake-sprites.ts` writes, and
    // their only decoder is `packages/renderer/src/blob.ts`. Nothing connected
    // the two: a review flipped the mask bit order to LSB-first, and swapped
    // red and blue in the RGB565 pack, and both left all 612 tests green.
    //
    // That is not a hypothetical. `packages/renderer/src/sprites/index.ts`
    // records a review flipping the bit order and byte-swapping every pixel,
    // and the whole renderer suite staying green — a near-identical pair, a
    // 16-bit endianness swap rather than a red/blue one, with the same
    // outcome. A codec with no round trip is silent corruption waiting.
    //
    // So this runs the real tool and hands its output to the real painter,
    // rather than re-encoding with a private helper the way the renderer's own
    // tests do — which is how both sides can agree with each other and be
    // wrong together.
    const dir = mkdtempSync(join(tmpdir(), 'logo-pack-'));
    const svg = join(dir, 'mark.svg');
    // **Asymmetric in both axes, deliberately.** A version of this test built
    // on the two-bar `fixture` above let the bit-order mutant through — not
    // because bars are self-mirroring, which a review checked and they are not
    // (each row packs to `0x3F 0xFC`, which reverses to `0xFC 0x3F` and opens
    // a four-column gap), but because the two pixels it happened to sample are
    // drawn under both orderings. A block in one corner and a block in the
    // opposite corner cannot be sampled into agreement that way.
    //
    // The colours are two of the example pack's own, so the snap is exact and
    // this is about framing rather than about quantising.
    writeFileSync(
      svg,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <rect x="2" y="2" width="14" height="14" fill="#F77849"/>
  <rect x="24" y="24" width="14" height="14" fill="#3FB950"/>
</svg>`,
    );

    const { output, status } = run([
      svg,
      '--width',
      '14',
      '--over',
      '#A91326',
      '--format',
      'pack',
    ]);
    expect(status, output).toBe(0);

    const logo: unknown = JSON.parse(
      output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1),
    );
    // **14, not 16, and the size is load-bearing.** 14x14 is 196 pixels, which
    // packs to 25 mask bytes — odd, so the encoder's pad-to-even step is doing
    // something. At 16x16 it is 32 bytes and the padding is a no-op, which let
    // a mutant that dropped it pass.
    expect(logo).toMatchObject({ width: 14, height: 14 });

    // Decode exactly as the panel does, then read the two blocks back out.
    const { target, painted } = paintOnHero(logo);
    expect(painted).not.toBeNull();
    if (painted === null) return;

    const at = (x: number, y: number): number =>
      target.pixels[y * target.width + x] ?? -1;
    // `#F77849` and `#3FB950` in RGB565. Written as literals rather than
    // computed, so a mutation of the pack's own conversion cannot agree with
    // the expectation.
    const top = 0xf3c9;
    const bottom = 0x3dca;
    // The blocks sit at 5%..40% and 60%..95% of a 40-unit box, so at 14px they
    // cover roughly columns and rows 1..5 and 8..13. Sampled near the middle
    // of each, and — the part that catches a mirror — in the two corners that
    // should be *empty*.
    const ground = 0x1234;
    expect(at(painted.x + 3, painted.y + 3), 'top-left block').toBe(top);
    expect(at(painted.x + 10, painted.y + 10), 'bottom-right block').toBe(
      bottom,
    );
    expect(at(painted.x + 10, painted.y + 3), 'top-right is empty').toBe(
      ground,
    );
    expect(at(painted.x + 3, painted.y + 10), 'bottom-left is empty').toBe(
      ground,
    );
  });
});

describe('the slots this tool quantises for', () => {
  it('agree with the renderer, which tools cannot import at runtime', () => {
    // The warning tells you what will and will not fit a pack field. It reads
    // from a hand-copy, because `tools/` is outside the dependency graph the
    // boundaries rule enforces — so this is what stops the copy drifting. It
    // was wrong once already: the warning named only the lid and told anyone
    // baking a pet that "the pack schema will refuse it", which was false.
    const named = Object.fromEntries(SLOTS.map((s) => [s.name, s]));
    expect(named.lid).toMatchObject({
      width: LID_SLOT.width,
      height: LID_SLOT.height,
    });
    expect(named.pet).toMatchObject({
      width: PET_SLOT.width,
      height: PET_SLOT.height,
    });
    expect(SLOTS.length).toBe(2);
  });
});
