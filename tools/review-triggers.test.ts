import { describe, expect, it } from 'vitest';

import { countChanged } from './review-triggers.js';

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
