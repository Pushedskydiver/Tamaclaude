import type { Scene } from './scene.js';
import type { PackManifest } from '@tamaclaude/packs';

import { describe, expect, it } from 'vitest';

import { frame } from '@tamaclaude/protocol';

import { panelBands } from './layout.js';
import { render } from './scene.js';

/**
 * Two packs that agree on nothing a palette can carry.
 *
 * Inverted background and ink, unrelated tones, so any pixel depending on the
 * pack at all must differ between them. Anything identical under both is a
 * pixel the pack does not control.
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

/**
 * Where two renders differ, not just how much.
 *
 * A count alone cannot tell "240 pixels changed inside the strip" from "240
 * pixels changed somewhere else entirely", and the claim these tests make is
 * about location as much as size.
 */
function differing(a: Scene, b: Scene) {
  const left = render(a);
  const right = render(b);
  const points: { x: number; y: number }[] = [];
  for (const [index, pixel] of left.pixels.entries()) {
    if (pixel === right.pixels[index]) continue;
    points.push({ x: index % left.width, y: Math.floor(index / left.width) });
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    count: points.length,
    box:
      points.length === 0
        ? undefined
        : {
            x0: Math.min(...xs),
            x1: Math.max(...xs),
            y0: Math.min(...ys),
            y1: Math.max(...ys),
          },
  };
}

const CHIP = { tone: 'active', origin: 'local' } as const;

/**
 * What a pack changes on the panel that ships, measured.
 *
 * `packages/cli` composes every scene with `extent: 'panel'`, and
 * `withEnvironment` then does two things: it paints the environment across the
 * whole framebuffer, over the fill `clearToPackBackground` put down, and it
 * replaces the painter's ink with `environmentInk(time)`. So `palette[0]`
 * never reaches a shipping pixel, and `palette[1]` reaches one only through
 * the tone fallback in `sceneColours` when a pack carries fewer than four
 * entries.
 *
 * What is left is `palette[2]` and `palette[3]` — and only through chips whose
 * tone is `attention` or `active`. `TONE_ROLE` maps `resting` to `ink`, so a
 * resting chip is painted in environment ink and carries no pack information
 * at all. `packages/cli` maps `DONE`, `IDLE` and `ASLEEP` to `resting`, which
 * are the states a desk panel sits in most of the time.
 *
 * These are measurements, not rules. `BUILD_PLAN.md` Stage 5 has an item for
 * making the environment a pack field; if it lands, these fail, and the numbers
 * here are what to compare the new ones against.
 */
describe('what a pack swap changes on the shipping panel', () => {
  it('changes nothing at all when no session is on the strip', () => {
    expect(differing(shipping(DARK, []), shipping(LOUD, [])).count).toBe(0);
  });

  it('moves half the panel under stage extent, which is the control', () => {
    // Every `toBe(0)` above is satisfied by a renderer that draws nothing, so
    // one positive case has to pin the difference to the environment rather
    // than to the harness. It is also the number the plan's extent-as-a-pack-
    // field item turns on: choosing `stage` is what would show a pack its own
    // background and ink again.
    const staged = (pack: PackManifest): Scene => ({
      ...shipping(pack, []),
      environment: { time: 'day', extent: 'stage', contact: true },
    });
    expect(differing(staged(DARK), staged(LOUD)).count).toBe(28_160);
  });

  it('changes nothing for a resting session, which is most of the time', () => {
    // The finding that matters. `resting` resolves to `ink`, which
    // `withEnvironment` has already replaced, so the chip tracks the sky rather
    // than the pack. `DONE`, `IDLE` and `ASLEEP` are all resting.
    const resting = { tone: 'resting', origin: 'local' } as const;
    expect(
      differing(shipping(DARK, [resting]), shipping(LOUD, [resting])).count,
    ).toBe(0);
  });

  it('changes one chip per active or attention session, inside the strip', () => {
    const attention = { tone: 'attention', origin: 'local' } as const;
    const strip = panelBands('landscape').strip;
    for (const tone of [CHIP, attention]) {
      const result = differing(shipping(DARK, [tone]), shipping(LOUD, [tone]));
      // 15 x 16, the chip geometry in `strip.ts`.
      expect({ tone: tone.tone, count: result.count }).toEqual({
        tone: tone.tone,
        count: 240,
      });
      // And inside the strip band, which a count alone would not establish.
      expect(result.box?.y0).toBeGreaterThanOrEqual(strip.y);
      expect(result.box?.y1).toBeLessThan(strip.y + strip.height);
      expect(result.box?.x0).toBeGreaterThanOrEqual(strip.x);
    }
  });

  it('scales with the number of chips that carry a tone', () => {
    const three = [CHIP, CHIP, CHIP];
    expect(differing(shipping(DARK, three), shipping(LOUD, three)).count).toBe(
      720,
    );
  });

  it('never shows the pack background, whatever it is', () => {
    const swapped: PackManifest = {
      ...DARK,
      palette: [[255, 0, 0], ...DARK.palette.slice(1)],
    };
    expect(differing(shipping(DARK, []), shipping(swapped, [])).count).toBe(0);
  });

  it('shows the pack background when there is no environment to cover it', () => {
    // The other half, and without it nothing in this package pins
    // `clearToPackBackground` at all: it can be deleted and the whole renderer
    // suite stays green, because every other test composes an environment over
    // the top. No scene `packages/cli` builds omits one, but the renderer
    // permits it and this is the only place the fill is observable.
    const bare = (pack: PackManifest): Scene => {
      const scene = shipping(pack, []);
      // Rebuilt without `environment` rather than destructured away, which
      // leaves an unused binding the lint rule refuses.
      return {
        orientation: scene.orientation,
        layout: scene.layout,
        pack: scene.pack,
        sprites: scene.sprites,
        sessions: scene.sessions,
        status: scene.status,
        message: scene.message,
      };
    };
    const swapped: PackManifest = {
      ...DARK,
      palette: [[255, 0, 0], ...DARK.palette.slice(1)],
    };
    expect(differing(bare(DARK), bare(swapped)).count).toBeGreaterThan(0);
  });

  it('replaces the pack ink with the environment ink', () => {
    const swapped: PackManifest = {
      ...DARK,
      palette: [DARK.palette[0], [255, 0, 0], ...DARK.palette.slice(2)],
    };
    expect(differing(shipping(DARK, []), shipping(swapped, [])).count).toBe(0);
  });

  it('falls a short palette back to its ink, so palette[1] can reach a chip', () => {
    // `parsePackManifest` allows two entries, and `sceneColours` resolves a
    // missing tone as `palette[ROLE_INDEX[role]] ?? ink` — the *pack's* ink,
    // read before `withEnvironment` substitutes. So "palette[1] never reaches
    // a shipping pixel" is true only of packs carrying all four entries.
    const attention = { tone: 'attention', origin: 'local' } as const;
    const inked: PackManifest = {
      ...MINIMAL,
      palette: [
        [0, 0, 0],
        [255, 0, 0],
      ],
    };
    expect(
      differing(shipping(MINIMAL, [attention]), shipping(inked, [attention]))
        .count,
    ).toBe(240);
  });
});
