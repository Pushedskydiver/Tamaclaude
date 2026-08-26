import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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

/** `palette[0]` is the background, and so a legal `--over`. */
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
  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status ?? 1,
  };
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
      '16',
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
    // in `typing` is a fixed `#30363B` in the artwork and no pack palette
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
      '#30363B',
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
    const ground = '#30363B';
    const { output, status } = run([
      fixturePath(fixture(paletteAt(2), '#31373C')),
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
