import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

describe('logo2pixel, end to end', () => {
  it('does not emit the mark as its own bounding box', () => {
    // The assertion that would have caught it. Two bars with a gap between
    // them must produce rows that are *not* full width — a solid block is
    // every run spanning the mark, which is what a broken alpha rule gives.
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
    // And the empty band between the bars must leave rows with no run at all.
    expect(widths.length).toBeLessThan(20);
  });

  it('refuses a ground the palette does not contain', () => {
    // Any colour outside the palette produces a solid block rather than an
    // error, so this has to be refused rather than warned about.
    const { status, output: stdout } = run([
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
    expect(status).toBe(1);
    expect(stdout).toMatch(/not in .* palette/);
  });
});

describe('logo2pixel refuses input that would ship silently wrong', () => {
  it('refuses a scale that would put NaN in the output', () => {
    // `coordinate()` stringifies NaN happily and Chromium ignores an invalid
    // attribute silently, so this reaches the panel as a blank lid.
    const { status } = run([
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
