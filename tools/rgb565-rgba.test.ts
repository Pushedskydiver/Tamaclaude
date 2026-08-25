import { describe, expect, it } from 'vitest';

import { rgb565 } from '@tamaclaude/protocol';

import { toRgba } from './rgb565-rgba.ts';

/**
 * Values that survive 8 -> n -> 8 exactly, per channel.
 *
 * `toRgba` is the one operation in the review path with no device counterpart:
 * the panel writes RGB565 straight to SPI and never expands it, so nothing on
 * the hardware can disagree and nothing downstream can catch a wrong widening.
 * It would tint every review artefact uniformly, which is the kind of error an
 * eye calibrates to rather than notices — and the artefact is the sole input to
 * the mandatory `animation-critic`.
 *
 * **Separate lists, because the channels are not the same width.** A shared
 * list plus a tolerance is how the first version of this asserted nothing:
 * four plausible one-token mutants passed it, including one that shifts nine
 * tenths of representable colours by up to 3%. Three of that list's seven
 * values are also inexact in green — 33 lands on 32, 66 on 65, 132 on 134.
 *
 * Round-tripped against `rgb565` rather than a table of bytes, so this cannot
 * drift from the packer it inverts.
 */
const EXACT_5_BIT = [0, 8, 16, 33, 66, 132, 255];
const EXACT_6_BIT = [0, 4, 16, 32, 65, 130, 195, 255];

describe('toRgba, exact widening', () => {
  it('returns 5-bit channels exactly, not merely close', () => {
    for (const value of EXACT_5_BIT) {
      const [r, , ,] = toRgba(Uint16Array.of(rgb565(value, 0, 0)));
      const [, , b] = toRgba(Uint16Array.of(rgb565(0, 0, value)));
      expect({ channel: 'red', value, got: r }).toEqual({
        channel: 'red',
        value,
        got: value,
      });
      expect({ channel: 'blue', value, got: b }).toEqual({
        channel: 'blue',
        value,
        got: value,
      });
    }
  });

  it('returns 6-bit green exactly, on the values green can hold', () => {
    for (const value of EXACT_6_BIT) {
      const [, g] = toRgba(Uint16Array.of(rgb565(0, value, 0)));
      expect({ value, got: g }).toEqual({ value, got: value });
    }
  });

  it('never drifts further than the format forces, on every value', () => {
    // The exact lists above pin the widening; this pins that nothing else is
    // wrong across the whole 8-bit range.
    //
    // 7 and 3, not 4 and 2, and the reason is worth knowing: `rgb565` *masks*
    // — `r & 0xf8`, `g & 0xfc` — so it truncates rather than rounds. A
    // rounding quantiser would cost at most half a step; truncation costs a
    // full step minus one. A first version of this bound said "half a step"
    // and used the full step; this one says truncation and uses it.
    for (let value = 0; value < 256; value += 1) {
      const [r, , b] = toRgba(Uint16Array.of(rgb565(value, 0, value)));
      const [, g] = toRgba(Uint16Array.of(rgb565(0, value, 0)));
      expect(Math.abs((r ?? -1) - value)).toBeLessThanOrEqual(7);
      expect(Math.abs((b ?? -1) - value)).toBeLessThanOrEqual(7);
      expect(Math.abs((g ?? -1) - value)).toBeLessThanOrEqual(3);
    }
  });
});

describe('toRgba, shape and order', () => {
  it('puts a saturated channel on 255, not 248', () => {
    // The whole reason for replicating high bits into low ones. Plain shifting
    // gives 248/252/248 — a 3% darkening applied to every pixel of every
    // review artefact, uniform enough that no reviewer would ever name it.
    const white = toRgba(Uint16Array.of(rgb565(255, 255, 255)));
    expect([...white]).toEqual([255, 255, 255, 255]);
    const black = toRgba(Uint16Array.of(rgb565(0, 0, 0)));
    expect([...black]).toEqual([0, 0, 0, 255]);
  });

  it('keeps the channels in the right order', () => {
    // A swapped pair survives every symmetric test above. `docs/GIT.md` uses
    // "correct RGB565 channel order" as an example commit *subject*, which is
    // a format illustration rather than history — the repo's one real packing
    // bug was an unmasked blue channel. Both are the same class: silent, and
    // only visible against a reference.
    expect([...toRgba(Uint16Array.of(rgb565(255, 0, 0)))]).toEqual([
      255, 0, 0, 255,
    ]);
    expect([...toRgba(Uint16Array.of(rgb565(0, 255, 0)))]).toEqual([
      0, 255, 0, 255,
    ]);
    expect([...toRgba(Uint16Array.of(rgb565(0, 0, 255)))]).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it('unpacks a run, not just one pixel', () => {
    const packed = Uint16Array.of(rgb565(255, 0, 0), rgb565(0, 0, 255));
    expect([...toRgba(packed)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('returns four bytes per pixel and nothing else', () => {
    expect(toRgba(new Uint16Array(7)).length).toBe(28);
    expect(toRgba(new Uint16Array(0)).length).toBe(0);
  });
});
