import { describe, expect, it } from 'vitest';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tamaclaude/protocol';

import { createFramebuffer } from './framebuffer.js';
import { ORIENTATIONS, panelSize } from './layout.js';

describe('createFramebuffer', () => {
  it('defaults to portrait', () => {
    const target = createFramebuffer();
    expect(target.width).toBe(SCREEN_WIDTH);
    expect(target.height).toBe(SCREEN_HEIGHT);
  });

  it('sizes itself from the layout for every orientation', () => {
    // Driven off ORIENTATIONS rather than a hard-coded pair, so a third
    // mounting cannot be added to the layout and forgotten here.
    for (const orientation of ORIENTATIONS) {
      const target = createFramebuffer(orientation);
      expect({ width: target.width, height: target.height }).toEqual(
        panelSize(orientation),
      );
      expect(target.pixels).toHaveLength(target.width * target.height);
    }
  });

  it('gives landscape the long axis across', () => {
    const target = createFramebuffer('landscape');
    expect(target.width).toBeGreaterThan(target.height);
  });
});
