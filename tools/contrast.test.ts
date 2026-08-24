import { describe, expect, it } from 'vitest';

import { contrast, luminance, parseHex } from './contrast.js';

describe('contrast', () => {
  it('gives the two ratios everyone knows', () => {
    // **These two prove less than they look.** A review tried five wrong
    // implementations — no linearisation, pure 2.2, pure 2.4, Rec.601
    // coefficients, and red and green swapped — and every one returns exactly
    // 21 here and exactly 1 below. All they pin is that the coefficients sum
    // to one and that the curve fixes 0 and 1. The assertions that actually
    // hold the formula are the two real-colour ones further down; the comment
    // here used to call this "the cheapest possible check that the formula was
    // transcribed", which told a future reader the wrong one was droppable.
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrast([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 10);
  });

  it('does not care which way round the pair is given', () => {
    const a = [178, 156, 128] as const;
    const b = [178, 34, 34] as const;
    expect(contrast(a, b)).toBeCloseTo(contrast(b, a), 10);
  });

  it('holds the formula: two real colours, at two decimal places', () => {
    // **This is the guard.** At 2 dp these reject no-linearisation, Rec.601
    // and swapped coefficients outright, and pure-2.2 and pure-2.4 each fail
    // one of the two. They read like documentation of a plan decision and are
    // in fact the only thing here that would notice a mistranscribed formula.
    // A mid-saturated body on dusk sand: flat invisible, and why the plan's
    // "measure against the sky" was the wrong pair — a ground-level prop is
    // never against sky.
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
