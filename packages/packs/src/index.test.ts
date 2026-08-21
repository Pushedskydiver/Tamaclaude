/**
 * The pack manifest is untrusted input.
 *
 * `docs/DA-REVIEW.md` calls it out by name: a pack is a file a user writes,
 * and this is the boundary where it stops being arbitrary JSON. These tests
 * exist because the package had none, and a validation boundary with no tests
 * is a validation boundary nobody has checked can fail.
 */
import { describe, expect, it } from 'vitest';

import { packPalette, parsePackManifest } from './index.js';

const valid = {
  name: 'example',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
};

describe('parsePackManifest', () => {
  it('accepts a manifest with a background and an ink', () => {
    expect(parsePackManifest(valid).palette).toHaveLength(2);
  });

  it('refuses a palette of one, which renders an invisible panel', () => {
    // Entry 0 is the background and entry 1 is the ink. A pack carrying only a
    // background is schema-valid nonsense: every glyph and chip is drawn in
    // the background colour and the panel comes up blank with no error. The
    // renderer deliberately will not invent a colour the pack does not
    // contain, so refusing it has to happen here.
    expect(() =>
      parsePackManifest({ ...valid, palette: [[0, 0, 0]] }),
    ).toThrow(/background and an ink/);
  });

  it('refuses a channel outside 0..255', () => {
    expect(() =>
      parsePackManifest({
        ...valid,
        palette: [
          [0, 0, 0],
          [256, 0, 0],
        ],
      }),
    ).toThrow();
  });

  it('refuses a nameless pack', () => {
    expect(() => parsePackManifest({ ...valid, name: '' })).toThrow();
  });
});

describe('packPalette', () => {
  it('converts each triple to RGB565, background first', () => {
    const palette = packPalette(parsePackManifest(valid));
    expect(palette[0]).toBe(0x0000);
    expect(palette[1]).toBe(0xffff);
  });
});
