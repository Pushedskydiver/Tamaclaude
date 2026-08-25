import type { Scene } from './scene.js';
import type { PackManifest } from '@tamaclaude/packs';

import { describe, expect, it } from 'vitest';

import { frame } from '@tamaclaude/protocol';

import { render } from './scene.js';

/**
 * Two packs that agree on nothing a palette can carry.
 *
 * Inverted background and ink, and unrelated tones, so any pixel that depends
 * on the pack at all must differ between them. Anything identical under both
 * is a pixel the pack does not control.
 */
const DARK: PackManifest = {
  name: 'dark',
  palette: [
    [13, 17, 23],
    [201, 209, 217],
    [247, 120, 73],
    [63, 185, 80],
  ],
  quips: { mapped: {}, idle: [] },
};

const LOUD: PackManifest = {
  name: 'loud',
  palette: [
    [255, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
};

/** A pack carrying the schema minimum: a background and an ink, nothing else. */
const MINIMAL: PackManifest = {
  name: 'minimal',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
};

/** Blank, so every difference between two renders is the pack and not the art. */
const BLANK = {
  frame: frame(new Uint16Array(168 * 200), 168),
  mask: new Uint8Array(168 * 200),
};

/** What `packages/cli` composes: landscape, hero, environment over the panel. */
function shipping(pack: PackManifest, sessions: Scene['sessions']): Scene {
  return {
    orientation: 'landscape',
    layout: 'hero',
    pack,
    sprites: [BLANK],
    sessions,
    status: { left: '12:00', right: 'x1' },
    message: 'Bash',
    environment: { time: 'day', extent: 'panel', contact: true },
  };
}

function differing(a: Scene, b: Scene): number {
  const left = render(a);
  const right = render(b);
  let count = 0;
  for (const [index, pixel] of left.pixels.entries()) {
    if (pixel !== right.pixels[index]) count += 1;
  }
  return count;
}

/**
 * What a pack actually changes on the panel that ships.
 *
 * **Measured, and smaller than the plan assumes.** `packages/cli` composes
 * every scene with `extent: 'panel'`, and `withEnvironment` does two things
 * under that extent: it paints the environment across the whole framebuffer,
 * covering `clearToPackBackground`'s fill, and it replaces the painter's ink
 * with `environmentInk(time)`. So neither `palette[0]` nor `palette[1]` reaches
 * a shipping pixel. What is left is the tones the session strip draws chips
 * with.
 *
 * That matters for `BUILD_PLAN.md` Stage 5, whose first item is the recipient's
 * pack "palette, quips, `birthday`, logo, pet". Quips and birthday are text and
 * do reach the glass; the palette reaches it only when a session is on the
 * strip, which is why "environment as a pack field" is further down that same
 * list and is the item that would make a palette mean anything.
 *
 * These tests are the measurement, not a rule about what *should* happen. If
 * the environment becomes a pack field they will fail, and the numbers here are
 * what to compare the new ones against.
 */
describe('what a pack swap changes on the shipping panel', () => {
  it('changes nothing at all when no session is on the strip', () => {
    expect(differing(shipping(DARK, []), shipping(LOUD, []))).toBe(0);
  });

  it('changes exactly one chip per session, and nothing else', () => {
    // A chip is 15x16 = 240 px. Every differing pixel is inside one.
    const one = { tone: 'active', origin: 'local' } as const;
    expect(differing(shipping(DARK, [one]), shipping(LOUD, [one]))).toBe(240);
    expect(
      differing(
        shipping(DARK, [one, one, one]),
        shipping(LOUD, [one, one, one]),
      ),
    ).toBe(720);
  });

  it('paints over the pack background rather than showing it', () => {
    // Same pack but for `palette[0]`: the panel is identical, because the
    // environment covers the fill `clearToPackBackground` put down.
    const swapped: PackManifest = {
      ...DARK,
      palette: [
        [255, 0, 0],
        ...DARK.palette.slice(1),
      ] as PackManifest['palette'],
    };
    expect(differing(shipping(DARK, []), shipping(swapped, []))).toBe(0);
  });

  it('replaces the pack ink with the environment ink', () => {
    // `palette[1]` is the ink. Changing it changes nothing, because
    // `withEnvironment` substitutes `environmentInk(time)` under `panel`.
    const swapped: PackManifest = {
      ...DARK,
      palette: [
        DARK.palette[0],
        [255, 0, 0],
        ...DARK.palette.slice(2),
      ] as PackManifest['palette'],
    };
    expect(differing(shipping(DARK, []), shipping(swapped, []))).toBe(0);
  });

  it('renders a pack carrying only the schema minimum', () => {
    // Two entries is what `parsePackManifest` allows, so a real pack can have
    // no tone colours at all. `sceneColours` falls back to ink for both, which
    // must not throw and must still put a chip on the strip.
    const one = { tone: 'attention', origin: 'local' } as const;
    const target = render(shipping(MINIMAL, [one]));
    expect(target.pixels.length).toBe(320 * 172);
    // The chip is drawn: swapping the minimal pack's ink moves 240 px, because
    // with no tone entries the chip falls back to it.
    const inked: PackManifest = {
      ...MINIMAL,
      palette: [
        [0, 0, 0],
        [255, 0, 0],
      ],
    };
    expect(differing(shipping(MINIMAL, [one]), shipping(inked, [one]))).toBe(
      240,
    );
  });
});
