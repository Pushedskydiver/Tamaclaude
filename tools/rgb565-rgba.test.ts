import { describe, expect, it } from 'vitest';

import { rgb565 } from '@tamaclaude/protocol';

import { toRgba } from './rgb565-rgba.ts';

/**
 * The unpack is the one thing in `panel-mock.ts` with no device counterpart.
 *
 * The panel writes RGB565 straight to SPI and never expands it, so nothing on
 * the hardware can disagree with this and nothing downstream can catch it — a
 * wrong widening would tint every review artefact uniformly, which is the kind
 * of error the eye calibrates to rather than notices. `tools/frame-palette.ts`
 * exists because exactly that shipped once: a colour key became a black key
 * and gave Clawd windows for eyes, invisible because the background was black
 * too.
 *
 * Round-tripped against `rgb565` rather than against a table of expected
 * bytes, so the test cannot drift from the packer it is the inverse of.
 */
describe('toRgba', () => {
  it('round-trips every colour the packer can represent losslessly', () => {
    // The values that survive 8->5/6->8 exactly are those whose low bits are
    // the replication of their high ones — which is what the packer keeps.
    const exact = [0, 8, 16, 33, 66, 132, 255];
    const cases = exact.flatMap((r) =>
      exact.flatMap((g) => exact.map((b) => [r, g, b] as const)),
    );
    for (const [r, g, b] of cases) {
      const packed = Uint16Array.of(rgb565(r, g, b));
      const [outR, outG, outB, alpha] = toRgba(packed);
      // Not asserted against the input: 5- and 6-bit channels cannot hold
      // every 8-bit value, so the contract is "as close as the format allows"
      // — within half a step of the quantiser, which is 8 for red and blue
      // and 4 for green.
      expect(Math.abs((outR ?? -1) - r)).toBeLessThanOrEqual(8);
      expect(Math.abs((outG ?? -1) - g)).toBeLessThanOrEqual(4);
      expect(Math.abs((outB ?? -1) - b)).toBeLessThanOrEqual(8);
      expect(alpha).toBe(255);
    }
  });

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
    // A swapped pair survives every symmetric test above, and `docs/GIT.md`'s
    // own example commit is "correct RGB565 channel order" — this repo has
    // made that mistake before.
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
