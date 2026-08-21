import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

import { paletteOf } from './frame-palette.ts';

/**
 * The boot splash, against the header that is actually committed.
 *
 * **This is the only automated thing standing behind the splash.** The
 * firmware is in none of the six gates: `eslint.config.ts` ignores every
 * firmware path outright, `tsc -b` and `knip` only walk TypeScript, prettier
 * has no parser for C, and `vitest.config.ts` collects package sources and
 * this directory. A wrong `splash-data.h` would reach the panel with every gate
 * green, and the panel is the one place none of them can look.
 *
 * So this decodes the committed header with `decode_rle()`'s own rules and
 * asserts the things that function would reject on, plus the ones it would
 * happily accept and render wrong.
 */

const HEADER = 'packages/device/firmware/blitter/main/splash-data.h';
const SVG = 'assets/clawd/splash.svg';

const source = readFileSync(HEADER, 'utf8');
const svg = readFileSync(SVG, 'utf8');

function macro(name: string): number {
  const found = new RegExp(`#define ${name} (\\d+)`).exec(source);
  if (found === null) throw new Error(`no ${name} in ${HEADER}`);
  return Number(found[1]);
}

/** The `(count, value)` pairs, as `decode_rle` reads them. */
function runs(): { count: number; value: number }[] {
  const body = /splash_rle\[SPLASH_RUNS \* 2\] = \{([\s\S]*?)\};/.exec(source);
  if (body === null) throw new Error('no splash_rle table');
  const words = [...(body[1] ?? '').matchAll(/0x([0-9a-f]{4})/g)].map((m) =>
    parseInt(m[1] ?? '0', 16),
  );
  const out: { count: number; value: number }[] = [];
  for (let at = 0; at < words.length; at += 2) {
    out.push({ count: words[at] ?? 0, value: words[at + 1] ?? 0 });
  }
  return out;
}

/** `#rrggbb` in the panel's own encoding, as the RGB565 macro packs it. */
function to565(hex: string): number {
  const at = (from: number): number => parseInt(hex.slice(from, from + 2), 16);
  return ((at(1) & 0xf8) << 8) | ((at(3) & 0xfc) << 3) | ((at(5) & 0xf8) >> 3);
}

/** Every colour the artwork declares, in the panel's own encoding. */
function palette565(): Set<number> {
  return new Set(
    paletteOf(svg).map(
      ([r, g, b]) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xf8) >> 3),
    ),
  );
}

function decoded(): Uint16Array {
  const out = new Uint16Array(macro('SPLASH_WIDTH') * macro('SPLASH_HEIGHT'));
  let written = 0;
  runs().forEach(({ count, value }) => {
    out.fill(value, written, written + count);
    written += count;
  });
  return out;
}

describe('the baked boot splash', () => {
  it('is the panel the firmware addresses', () => {
    // main.c builds with PANEL_LANDSCAPE, so the long axis is the width. The
    // firmware's own constants derive from these; if they ever disagree, the
    // TypeScript is right and the C is the bug.
    expect(macro('SPLASH_WIDTH')).toBe(SCREEN_HEIGHT);
    expect(macro('SPLASH_HEIGHT')).toBe(SCREEN_WIDTH);
  });

  it('has the run count the table declares', () => {
    expect(runs()).toHaveLength(macro('SPLASH_RUNS'));
  });

  it('covers every pixel exactly once', () => {
    // `decode_rle` returns false unless `written == header->pixels`, and
    // main.c blits nothing on a false. A short table is a blank panel.
    const total = runs().reduce((sum, { count }) => sum + count, 0);
    expect(total).toBe(macro('SPLASH_WIDTH') * macro('SPLASH_HEIGHT'));
  });

  it('has no zero-length run', () => {
    // `if (count == 0) return false;` — one bad run discards the whole splash.
    expect(runs().filter(({ count }) => count === 0)).toEqual([]);
  });

  it('is a payload parse_header would admit', () => {
    const length = runs().length * 4;
    expect(length).toBeGreaterThanOrEqual(4);
    expect(length % 4).toBe(0);
    expect(length).toBeLessThanOrEqual(
      macro('SPLASH_WIDTH') * macro('SPLASH_HEIGHT') * 4,
    );
  });

  it('draws only colours the artwork declares', () => {
    // The snap collapses antialiasing onto declared colours. A value outside
    // the palette means a soft edge survived the bake — the one defect that
    // looks fine in a decoded PNG and muddy on the panel.
    const allowed = palette565();
    const escaped = [...new Set(runs().map(({ value }) => value))].filter(
      (value) => !allowed.has(value),
    );
    expect(escaped).toEqual([]);
  });

  it('draws Clawd and the wordmark, not just the ground', () => {
    // An empty or all-ground bake satisfies every assertion above. These are
    // the colours that make it a picture: the body, and the wordmark's two.
    const pixels = decoded();
    const count = (hex: number): number =>
      pixels.reduce<number>((sum, value) => sum + (value === hex ? 1 : 0), 0);
    // Derived from the hex rather than written out: the first draft hand-packed
    // #C9D1D9 as 0xce5b instead of 0xce9b and asserted a colour that is not in
    // the picture, which fails loudly here but would pass silently as a
    // *permitted* value in the palette check above.
    expect(count(to565('#DE886D'))).toBeGreaterThan(2000); // Clawd
    expect(count(to565('#C9D1D9'))).toBeGreaterThan(200); // 'tama'
    expect(count(to565('#F77849'))).toBeGreaterThan(200); // 'claude'
  });

  it('reaches the edges with the ground colour', () => {
    // The splash owns the whole panel. A corner in anything else means the
    // capture was offset or the viewport was wrong.
    const width = macro('SPLASH_WIDTH');
    const height = macro('SPLASH_HEIGHT');
    const pixels = decoded();
    const ground = to565('#0D1117');
    [0, width - 1, (height - 1) * width, height * width - 1].forEach((at) => {
      expect(pixels[at]).toBe(ground);
    });
  });
});
