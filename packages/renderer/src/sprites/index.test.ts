import { describe, expect, it } from 'vitest';

import { loadSprite, SPRITE_NAMES } from './index.js';

/**
 * The round trip, against the real baked data rather than a fixture.
 *
 * A fixture would prove the codec and nothing else. What matters is that what
 * `tools/bake-sprites.ts` wrote is what this reads back — the two are a matched
 * pair written days apart, and a mismatch between them would show up as a
 * corrupted Clawd on the panel and nowhere else.
 */
describe('baked sprites', () => {
  it('names only animations that are actually baked', async () => {
    // Without this, adding a name and forgetting to bake it is a runtime
    // failure on the panel rather than a red test.
    await Promise.all(
      SPRITE_NAMES.map(async (name) => {
        await expect(loadSprite(name)).resolves.toBeDefined();
      }),
    );
  });

  it('decodes every frame to the panel geometry', async () => {
    const frames = await loadSprite('typing');
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((sprite) => {
      // 21 units x 8 device pixels, which is `SCALE` in `svg2frames.ts`.
      expect(sprite.frame.width).toBe(168);
      expect(sprite.frame.pixels).toHaveLength(168 * 200);
      // A byte per pixel, which is what `drawFrame` validates the length of.
      expect(sprite.mask).toHaveLength(168 * 200);
    });
  });

  it('carries a mask that is one bit of information per pixel', async () => {
    const frames = await loadSprite('typing');
    const first = frames[0];
    expect(first).toBeDefined();
    const values = new Set(first?.mask ?? []);
    expect([...values].sort()).toEqual([0, 1]);
  });

  it('draws something, and does not draw everything', async () => {
    // The two ways the mask can be silently wrong: all zeroes renders an empty
    // stage that looks like the sprite is missing, and all ones paints the
    // transparent background over the pack's own, which is the bug
    // `scene.ts`'s `StageSprite` doc exists to warn about.
    const frames = await loadSprite('typing');
    const drawn = (frames[0]?.mask ?? []).reduce<number>(
      (total, bit) => total + bit,
      0,
    );
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(168 * 200);
  });

  it('gives the same array back rather than decoding twice', async () => {
    // The daemon asks eight times a second. Decoding 128 frames of `idle` on
    // each of them would be the whole frame budget spent on work already done.
    const once = await loadSprite('typing');
    const twice = await loadSprite('typing');
    expect(twice).toBe(once);
  });
});
