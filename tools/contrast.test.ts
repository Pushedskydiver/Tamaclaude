import { describe, expect, it } from 'vitest';

import { contrast, luminance, parseHex } from './contrast.js';

describe('contrast', () => {
  it('gives the two ratios everyone knows', () => {
    // The endpoints of the WCAG scale, which is the cheapest possible check
    // that the formula was transcribed rather than approximated.
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
  });

  it('does not care which way round the pair is given', () => {
    const a = [178, 156, 128] as const;
    const b = [178, 34, 34] as const;
    expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10);
  });

  it('reproduces the figure that moved the payoff plan', () => {
    // A mid-saturated body on dusk sand: 1.02:1, which is flat invisible and
    // is why the plan's "measure against the sky" was the wrong pair — a
    // ground-level prop is never against sky.
    expect(contrast([178, 34, 34], [112, 88, 82])).toBeCloseTo(1.02, 2);
    // And the fact that stops this being a gate: Clawd's own peach is 1.01:1
    // against day sand and reads perfectly well on the panel.
    expect(contrast([222, 136, 109], [178, 156, 128])).toBeCloseTo(1.01, 2);
  });

  it('weights green over red over blue, as the eye does', () => {
    // Guards the coefficients specifically. Swapping them is the mistake that
    // would leave every number plausible and every number wrong.
    expect(luminance([0, 255, 0])).toBeGreaterThan(luminance([255, 0, 0]));
    expect(luminance([255, 0, 0])).toBeGreaterThan(luminance([0, 0, 255]));
  });

  it('reads a hex with or without its hash, and refuses anything else', () => {
    expect(parseHex('#B22222')).toEqual([178, 34, 34]);
    expect(parseHex('b22222')).toEqual([178, 34, 34]);
    expect(parseHex('#fff')).toBeUndefined();
    expect(parseHex('rebecca')).toBeUndefined();
  });
});
