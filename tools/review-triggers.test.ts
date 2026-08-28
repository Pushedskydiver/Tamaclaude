import { describe, expect, it } from 'vitest';

import { countChanged, triggers } from './review-triggers.js';

describe('counting a numstat', () => {
  it('adds insertions and deletions', () => {
    expect(countChanged(['10\t5\ta.ts', '3\t0\tb.ts'])).toEqual({
      lines: 18,
      binary: 0,
    });
  });

  it('skips lockfiles, which are not review surface', () => {
    expect(countChanged(['9000\t8000\tpnpm-lock.yaml', '2\t0\ta.ts'])).toEqual({
      lines: 2,
      binary: 0,
    });
  });

  it('does not let a binary file poison the total', () => {
    // Git writes `-` for both counts on a binary file. `Number('-')` is NaN,
    // and NaN propagates: the whole diff reported as "NaN lines", and
    // `NaN > 200` is false, so the over-200-lines trigger answered *no* on a
    // diff of 3,194 lines. Under-reporting the reviews owed is the
    // one direction this tool must never fail in, and it did it silently.
    const counted = countChanged(['-\t-\tclawd.png', '300\t0\ta.ts']);
    expect(counted.lines).toBe(300);
    expect(Number.isNaN(counted.lines)).toBe(false);
    expect(counted.binary).toBe(1);
  });

  it('still fires the size trigger when a binary file is present', () => {
    // The property that actually matters, stated as the trigger sees it.
    expect(countChanged(['-\t-\ta.png', '250\t0\tb.ts']).lines).toBeGreaterThan(
      200,
    );
  });
});

/** Does the row whose `what` contains `phrase` fire on these paths? */
const fires = (what: string, files: readonly string[]): boolean => {
  const row = triggers([]).find((each) => each.what.includes(what));
  if (row === undefined) throw new Error(`no trigger row matching ${what}`);
  return row.fires(files, 0);
};

describe('the trigger table', () => {
  it('does not send a plan to the animation critic', () => {
    // `PLANS.md` lives under `assets/clawd/animations/`, so a prefix match
    // sends a docs-only diff to a reviewer whose whole job is to re-render
    // frames — of animations the diff did not touch. The row is for art.
    expect(fires('animations', ['assets/clawd/animations/PLANS.md'])).toBe(
      false,
    );
    expect(fires('animations', ['assets/clawd/animations/wizard.svg'])).toBe(
      true,
    );
  });

  it('sends static art to the art critic, and animations to neither', () => {
    // The row this repo added last, because it is the one that had already
    // failed once: static art sat on `self-review only` while animations were
    // routed away from it. The two must not overlap — an animation goes to
    // `animation-critic`, which re-renders frames; a still goes to
    // `pixel-art-critic`, which reads it cold.
    expect(fires('static art', ['assets/clawd/splash.svg'])).toBe(true);
    expect(fires('static art', ['assets/clawd/base.svg'])).toBe(true);
    expect(fires('static art', ['assets/clawd/animations/wizard.svg'])).toBe(
      false,
    );
    // Images, not everything under `assets/`. The font there is a `.woff2`
    // beside its licence, and neither is something a critic can render and
    // read — routing them to one would be noise in the direction that gets a
    // reporting tool ignored.
    expect(
      fires('static art', ['assets/fonts/DepartureMono-Regular.woff2']),
    ).toBe(false);
    expect(
      fires('static art', ['assets/fonts/DepartureMono-LICENSE.txt']),
    ).toBe(false);
  });
});

describe('routing a picture to the critic that looks at it', () => {
  it('sends re-baked animation frames to the animation critic', () => {
    // A re-bake changes every pixel and touches no `.svg`, so before this the
    // whole catalogue could be regenerated and fire nothing but `da-review`.
    // The frames are animation, so they go to the critic that scrubs motion —
    // and explicitly not to the static one, or both rows fire on one file.
    expect(
      fires('animations', ['packages/renderer/src/sprites/idle.data.ts']),
    ).toBe(true);
    expect(
      fires('static art', ['packages/renderer/src/sprites/idle.data.ts']),
    ).toBe(false);
  });

  it('sends baked static art and the files it is baked from to the art critic', () => {
    // The row said "static art, or a painter that places it in a slot" and
    // caught neither the art itself once baked nor the file that decides what
    // it looks like. `tools/splash-source.ts` is by its own header "what the
    // splash is baked *from*" and fired nothing at all; the baked QR fired
    // only `da-review`, while `qr.ts` — the painter that did not change —
    // fired this row. That inversion is the row's intent run backwards.
    expect(fires('static art', ['packages/renderer/src/qr.data.ts'])).toBe(
      true,
    );
    expect(
      fires('static art', [
        'packages/device/firmware/blitter/main/splash-data.h',
      ]),
    ).toBe(true);
    expect(fires('static art', ['tools/splash-source.ts'])).toBe(true);
    expect(fires('static art', ['tools/bake-splash.ts'])).toBe(true);
    expect(fires('static art', ['tools/bake-qr.ts'])).toBe(true);
    expect(fires('static art', ['tools/logo2pixel.ts'])).toBe(true);
    // The one tracked pack. `packs/example/` is un-ignored by `.gitignore`,
    // and the schema lets a manifest carry a logo blob.
    expect(fires('static art', ['packs/example/manifest.json'])).toBe(true);
    expect(fires('static art', ['tools/review-triggers.ts'])).toBe(false);
  });

  it('sends a painter that places art into a slot to the art critic', () => {
    // Where the defect this row exists for actually lives. A logo drawn
    // correctly still landed in the session strip, because the code choosing
    // its rect had never been composed under two-up. The art was fine; the
    // placement was not, and no art file changed in that diff.
    expect(fires('static art', ['packages/renderer/src/logo.ts'])).toBe(true);
    expect(fires('static art', ['packages/renderer/src/qr.ts'])).toBe(true);
    // The painter added by the commit that wrote this list fired nothing but
    // `da-review`. The docstring predicted exactly that — "by construction a
    // test cannot catch the next omission" — and the next omission was the
    // author's own, one commit later.
    expect(fires('static art', ['packages/renderer/src/pet.ts'])).toBe(true);
    // The file that decides what can be baked at all, which is a bake-time
    // source by the same taxonomy as `splash-source.ts`.
    expect(fires('static art', ['tools/pack-slots.ts'])).toBe(true);
    expect(fires('static art', ['packages/renderer/src/strip.ts'])).toBe(false);
  });

  it('sends a plan to the grill', () => {
    // The row `CLAUDE.md` has always had and this tool never implemented.
    expect(fires('spec or plan', ['assets/clawd/animations/PLANS.md'])).toBe(
      true,
    );
    expect(fires('spec or plan', ['BUILD_PLAN.md'])).toBe(true);
    expect(fires('spec or plan', ['packages/daemon/src/animation.ts'])).toBe(
      false,
    );
  });
});
