import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

import { fingerprint } from './art-fingerprint.ts';
import { paletteOf } from './frame-palette.ts';
import { withWordmark } from './splash-source.ts';

/**
 * The boot splash, against the header that is actually committed.
 *
 * **This and the `_Static_assert` in `main.c` are all that stand behind the
 * splash.** The firmware is in none of the six gates: `eslint.config.ts`
 * ignores every firmware path outright, `tsc -b` and `knip` only walk
 * TypeScript, prettier has no parser for C, and `vitest.config.ts` collects
 * package sources and this directory. A wrong `splash-data.h` would reach the
 * panel with every gate green, and the panel is the one place none of them can
 * look. The assertion only fires when somebody builds the firmware, and no CI
 * job does; this runs on every push.
 *
 * The splash never goes through `decode_rle()` — it is not a packet and has no
 * rect header. It shares that function's *payload* encoding and nothing else,
 * so the failures below are `draw_splash()`'s, not the wire's: it clamps
 * rather than refusing, so a short table draws a black band where the
 * framebuffer's `.bss` zeros show through, and an over-long one is truncated
 * instead of corrupting memory. Both are silent. That is what these assert
 * against.
 *
 * **Geometry is asserted exactly, and that is deliberate.** An earlier version
 * of this file checked only order-invariant properties — sums, run counts,
 * palette membership, colour tallies — and a review showed it passed on a
 * table with all 723 runs reversed, which is the splash upside down, and on a
 * header left stale after the artwork moved 190 pixels. Both are exactly what
 * a picture gate is for. Bounding boxes catch both, because reversing the
 * table mirrors every box and moving the art moves them. The cost is that
 * changing the composition means re-baking and updating the numbers here,
 * which is the point rather than the price.
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

const WIDTH = macro('SPLASH_WIDTH');
const HEIGHT = macro('SPLASH_HEIGHT');

/** The `(count, value)` pairs, in the order `draw_splash()` walks them. */
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

function decoded(): Uint16Array {
  const out = new Uint16Array(WIDTH * HEIGHT);
  let written = 0;
  runs().forEach(({ count, value }) => {
    out.fill(value, written, written + count);
    written += count;
  });
  return out;
}

const pixels = decoded();

/** Where one colour actually lands, which is what a picture gate must see. */
function box(hex: string): {
  count: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const wanted = to565(hex);
  let count = 0;
  let left = WIDTH;
  let right = -1;
  let top = HEIGHT;
  let bottom = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (pixels[y * WIDTH + x] !== wanted) continue;
      count += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { count, left, right, top, bottom };
}

const GROUND = '#0D1117';
const BODY = '#DE886D';
const EYES = '#000000';
const SHADOW = '#060910';
const INK = '#C9D1D9';
const ACCENT = '#F77849';

describe('the baked boot splash table', () => {
  it('is the panel the firmware addresses', () => {
    // main.c builds with PANEL_LANDSCAPE, so the long axis is the width. The
    // `_Static_assert` beside `draw_splash()` checks the same thing in C, and
    // refuses to compile a portrait build against landscape artwork.
    expect(WIDTH).toBe(SCREEN_HEIGHT);
    expect(HEIGHT).toBe(SCREEN_WIDTH);
  });

  it('was baked from the artwork that is committed beside it', () => {
    // The gate that has nothing to do with the picture being right, and
    // everything to do with it being *current*. Every other assertion here
    // reads the header, so a header left stale after the artwork moved passes
    // all of them — demonstrated, with Clawd 190 pixels off his mark.
    const stamped = /#define SPLASH_SOURCE "([0-9a-f]+)"/.exec(source);
    expect(stamped?.[1]).toBe(fingerprint(svg));
  });

  it('has the run count the table declares', () => {
    expect(runs()).toHaveLength(macro('SPLASH_RUNS'));
  });

  it('covers every pixel exactly once', () => {
    // Short and `draw_splash()` leaves the tail at its .bss zeros — a black
    // band across the panel. Long and the clamp silently drops the overflow.
    const total = runs().reduce((sum, { count }) => sum + count, 0);
    expect(total).toBe(WIDTH * HEIGHT);
  });

  it('has no zero-length run', () => {
    // `draw_splash()` skips one rather than failing, so the table would go on
    // decoding and simply fall short of the pixel count.
    expect(runs().filter(({ count }) => count === 0)).toEqual([]);
  });

  it('draws only colours the artwork declares', () => {
    // Through the same expansion the baker uses: until `#wordmark` becomes
    // rectangles its two colours are `data-` attributes, and `paletteOf` reads
    // `fill` only — so the unexpanded SVG declares a palette the picture
    // legitimately exceeds.
    const allowed = new Set(
      paletteOf(withWordmark(svg)).map(
        ([r, g, b]) =>
          ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xf8) >> 3),
      ),
    );
    const escaped = [...new Set(runs().map(({ value }) => value))].filter(
      (value) => !allowed.has(value),
    );
    expect(escaped).toEqual([]);
  });
});

describe('the picture the boot splash decodes to', () => {
  it('places Clawd and the wordmark where the composition puts them', () => {
    // The fingerprint. Reverse the table and every one of these mirrors;
    // move the artwork without re-baking and they shift.
    expect(box(BODY)).toEqual({
      count: 4352,
      left: 13,
      right: 114,
      top: 57,
      bottom: 132,
    });
    expect(box(INK)).toEqual({
      count: 256,
      left: 150,
      right: 201,
      top: 77,
      bottom: 92,
    });
    expect(box(ACCENT)).toEqual({
      count: 360,
      left: 206,
      right: 285,
      top: 77,
      bottom: 92,
    });
  });

  it('keeps Clawd out of the wordmark and the wordmark off Clawd', () => {
    // The defect this replaced a `<text>` element to kill: antialiased glyph
    // edges snapped to Clawd's body salmon, because the midpoint of #C9D1D9
    // over #0D1117 is nearer #DE886D than either end. 120 pixels of it, 11%
    // of the wordmark's ink, in a stripe along the top of "tama". It is inside
    // the palette, so the check above cannot see it — only position can.
    expect(box(BODY).right).toBeLessThan(box(INK).left);
    expect(box(ACCENT).right).toBeLessThan(WIDTH);
    expect(box(INK).top).toBe(box(ACCENT).top);
    expect(box(INK).bottom).toBe(box(ACCENT).bottom);
  });

  it('keeps the eyes on the face and the shadow under the feet', () => {
    const body = box(BODY);
    const eyes = box(EYES);
    const shadow = box(SHADOW);
    // Eyes are the ground's own colour. `snapToPalette` clears alpha only on a
    // part-transparent capture, so an opaque splash keeps them; if that ever
    // changed they would become ground and vanish into the face.
    expect(eyes.count).toBeGreaterThan(0);
    expect(eyes.left).toBeGreaterThan(body.left);
    expect(eyes.right).toBeLessThan(body.right);
    expect(shadow.count).toBeGreaterThan(0);
    expect(shadow.top).toBeGreaterThan(body.bottom - 1);
  });

  it('reaches the edges with the ground colour', () => {
    const ground = to565(GROUND);
    [0, WIDTH - 1, (HEIGHT - 1) * WIDTH, HEIGHT * WIDTH - 1].forEach((at) => {
      expect(pixels[at]).toBe(ground);
    });
  });
});
