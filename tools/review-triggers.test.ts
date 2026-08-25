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

describe('the trigger table', () => {
  const fires = (what: string, files: readonly string[]): boolean => {
    const row = triggers([]).find((each) => each.what.includes(what));
    if (row === undefined) throw new Error(`no trigger row matching ${what}`);
    return row.fires(files, 0);
  };

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
