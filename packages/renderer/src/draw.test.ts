import type { Framebuffer } from './framebuffer.js';
import type { Frame, Rect } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import { dirtyRect, frame, rectArea } from '@tamaclaude/protocol';

import { drawBorder, drawFrame, fillRect } from './draw.js';
import { createFramebuffer } from './framebuffer.js';
import {
  panelBands,
  safeAreaCropUnits,
  spriteSlots,
  STAGE_WIDTH,
  stageScale,
} from './layout.js';

/**
 * Tiny buffers with single-digit colours, rendered as rows of characters.
 *
 * A wrapped write — the classic framebuffer bug — shows up here as a visible
 * diagonal smear rather than as an off-by-one in a pixel index, which is the
 * whole reason the assertions are strings.
 */
function buffer(width: number, height: number): Framebuffer {
  return { pixels: new Uint16Array(width * height), width, height };
}

function grid(target: Framebuffer): readonly string[] {
  return Array.from({ length: target.height }, (_, y) =>
    Array.from(target.pixels.subarray(y * target.width, (y + 1) * target.width))
      .map((pixel) => (pixel === 0 ? '.' : String(pixel)))
      .join(''),
  );
}

describe('fillRect', () => {
  it('fills exactly the rect it is given', () => {
    const target = buffer(5, 4);
    fillRect(target, { x: 1, y: 1, width: 3, height: 2 }, 1);
    expect(grid(target)).toEqual(['.....', '.111.', '.111.', '.....']);
  });

  it('clips at the right edge instead of wrapping onto the next row', () => {
    const target = buffer(5, 4);
    fillRect(target, { x: 3, y: 1, width: 4, height: 1 }, 1);
    expect(grid(target)).toEqual(['.....', '...11', '.....', '.....']);
  });

  it('clips at the left edge instead of wrapping onto the previous row', () => {
    const target = buffer(5, 4);
    fillRect(target, { x: -2, y: 2, width: 4, height: 1 }, 1);
    expect(grid(target)).toEqual(['.....', '.....', '11...', '.....']);
  });

  it('clips at the top and bottom edges', () => {
    const target = buffer(5, 4);
    fillRect(target, { x: 1, y: -1, width: 1, height: 2 }, 1);
    fillRect(target, { x: 3, y: 3, width: 1, height: 9 }, 2);
    expect(grid(target)).toEqual(['.1...', '.....', '.....', '...2.']);
  });

  it('does nothing for a rect wholly outside the buffer', () => {
    const target = buffer(5, 4);
    for (const rect of [
      { x: -9, y: 1, width: 4, height: 1 },
      { x: 5, y: 1, width: 4, height: 1 },
      { x: 1, y: -9, width: 1, height: 4 },
      { x: 1, y: 4, width: 1, height: 4 },
    ]) {
      fillRect(target, rect, 1);
    }
    expect(grid(target)).toEqual(['.....', '.....', '.....', '.....']);
  });

  it('does nothing for a degenerate rect', () => {
    const target = buffer(5, 4);
    fillRect(target, { x: 1, y: 1, width: 0, height: 2 }, 1);
    fillRect(target, { x: 1, y: 1, width: 2, height: -3 }, 1);
    expect(grid(target)).toEqual(['.....', '.....', '.....', '.....']);
  });

  it('fills a buffer that the rect entirely contains', () => {
    const target = buffer(5, 2);
    fillRect(target, { x: -4, y: -4, width: 40, height: 40 }, 3);
    expect(grid(target)).toEqual(['33333', '33333']);
  });
});

/** A 3x2 raster whose every pixel is distinct, so a misplaced copy is legible. */
function sprite(): Frame {
  return frame(Uint16Array.from([1, 2, 3, 4, 5, 6]), 3);
}

describe('drawFrame', () => {
  it('blits the raster at the position it is given', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: 1, y: 1 });
    expect(grid(target)).toEqual(['.....', '.123.', '.456.', '.....']);
  });

  it('takes the right-hand columns of the source when clipped on the left', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: -1, y: 1 });
    // Not '.12..' — a clip that shortens the row but keeps reading from
    // source column 0 draws the correct number of pixels from the wrong place.
    expect(grid(target)).toEqual(['.....', '23...', '56...', '.....']);
  });

  it('clips at the right edge instead of wrapping onto the next row', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: 3, y: 0 });
    expect(grid(target)).toEqual(['...12', '...45', '.....', '.....']);
  });

  it('takes the lower rows of the source when clipped at the top', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: 0, y: -1 });
    expect(grid(target)).toEqual(['456..', '.....', '.....', '.....']);
  });

  it('clips at the bottom edge', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: 0, y: 3 });
    expect(grid(target)).toEqual(['.....', '.....', '.....', '123..']);
  });

  it('clips both axes at once', () => {
    const target = buffer(5, 4);
    drawFrame(target, sprite(), { x: -2, y: -1 });
    expect(grid(target)).toEqual(['6....', '.....', '.....', '.....']);
  });

  it('does nothing for a raster wholly outside the buffer', () => {
    const target = buffer(5, 4);
    for (const at of [
      { x: -3, y: 0 },
      { x: 5, y: 0 },
      { x: 0, y: -2 },
      { x: 0, y: 4 },
    ]) {
      drawFrame(target, sprite(), at);
    }
    expect(grid(target)).toEqual(['.....', '.....', '.....', '.....']);
  });

  it('blits a raster wider than the buffer without wrapping', () => {
    const target = buffer(2, 2);
    drawFrame(target, sprite(), { x: 0, y: 0 });
    expect(grid(target)).toEqual(['12', '45']);
  });
});

describe('drawBorder', () => {
  it('draws a one-pixel outline and leaves the interior alone', () => {
    const target = buffer(6, 5);
    drawBorder(target, { x: 1, y: 1, width: 4, height: 3 }, 1);
    expect(grid(target)).toEqual([
      '......',
      '.1111.',
      '.1..1.',
      '.1111.',
      '......',
    ]);
  });

  it('drops the edges that fall off the buffer and keeps the rest', () => {
    const target = buffer(5, 4);
    drawBorder(target, { x: -2, y: 1, width: 4, height: 3 }, 1);
    // The left edge is off-panel entirely; the right edge is still at x 1.
    expect(grid(target)).toEqual(['.....', '11...', '.1...', '11...']);
  });

  it('draws a single pixel for a 1x1 rect', () => {
    const target = buffer(3, 3);
    drawBorder(target, { x: 1, y: 1, width: 1, height: 1 }, 2);
    expect(grid(target)).toEqual(['...', '.2.', '...']);
  });

  it('does nothing for a degenerate rect', () => {
    const target = buffer(5, 4);
    // A zero extent puts the far edge one pixel *before* the near one, so an
    // unguarded implementation draws a stray line outside the rect entirely.
    drawBorder(target, { x: 2, y: 2, width: 0, height: 3 }, 1);
    drawBorder(target, { x: 2, y: 2, width: 3, height: 0 }, 1);
    expect(grid(target)).toEqual(['.....', '.....', '.....', '.....']);
  });

  it('does nothing for a rect wholly outside the buffer', () => {
    const target = buffer(5, 4);
    drawBorder(target, { x: 8, y: 8, width: 3, height: 3 }, 1);
    expect(grid(target)).toEqual(['.....', '.....', '.....', '.....']);
  });
});

/**
 * The 5x4 buffers above make a wrap look like a one-row shift. At panel scale
 * it is a 168-wide raster going into a 172-wide buffer, and that four-pixel
 * difference is the exact trap `dirtyRect` and `extractRect` were both caught
 * in — worth asserting against the real geometry, not just a toy one.
 *
 * Both cases assert the same two things: the bounding box of what changed is
 * the rect that was asked for, which a wrapped row would drag out sideways;
 * and the count of pixels drawn matches its area, which catches holes and
 * double-writes that a bounding box alone cannot see.
 */
function litBox(target: Framebuffer): Rect | null {
  const blank = frame(new Uint16Array(target.pixels.length), target.width);
  return dirtyRect(blank, frame(target.pixels, target.width));
}

function litCount(target: Framebuffer): number {
  return target.pixels.filter((pixel) => pixel !== 0).length;
}

describe('drawFrame at panel scale', () => {
  it('keeps a 168-wide stage raster inside the 172-wide panel', () => {
    const target = createFramebuffer();
    const stage = panelBands().stage;
    const raster = frame(new Uint16Array(rectArea(stage)).fill(1), stage.width);

    drawFrame(target, raster, { x: stage.x, y: stage.y });

    expect(litBox(target)).toEqual(stage);
    expect(litCount(target)).toBe(rectArea(stage));
  });

  it('crops landscape off the top without smearing into the text column', () => {
    const target = createFramebuffer('landscape');
    const [slot] = spriteSlots('hero', 'landscape');
    const authored = panelBands().stage.height;
    // Landscape shows only the safe area, so the sprite is pulled up by the
    // prop headroom that portrait keeps — far enough that it starts above the
    // top of the panel rather than merely high in it.
    const top = slot.y - safeAreaCropUnits() * stageScale('hero');
    expect(top).toBeLessThan(0);
    const raster = frame(
      new Uint16Array(slot.width * authored).fill(1),
      slot.width,
    );

    drawFrame(target, raster, { x: slot.x, y: top });

    // The three text bands live at x >= STAGE_WIDTH; a blit that ran past the
    // end of a row would put the box's right edge in them.
    const visible = {
      x: slot.x,
      y: 0,
      width: slot.width,
      height: top + authored,
    };
    expect(slot.width).toBe(STAGE_WIDTH);
    expect(litBox(target)).toEqual(visible);
    expect(litCount(target)).toBe(rectArea(visible));
  });
});

describe('drawFrame with a mask', () => {
  it('leaves masked-out pixels untouched', () => {
    const target = buffer(5, 4);
    const source = frame(Uint16Array.from([1, 2, 3, 4]), 2);
    // Only the diagonal is drawn.
    const mask = Uint8Array.from([1, 0, 0, 1]);
    drawFrame(target, source, { x: 1, y: 1, mask });
    expect(grid(target)).toEqual(['.....', '.1...', '..4..', '.....']);
  });

  it('refuses a mask that does not match the raster', () => {
    // A short mask would otherwise read `undefined` past its end, which is
    // not `=== 0`, so the tail would draw opaque — the exact failure the mask
    // exists to prevent, and silent.
    const target = buffer(4, 4);
    const source = frame(Uint16Array.from([1, 2, 3, 4]), 2);
    expect(() =>
      drawFrame(target, source, { x: 0, y: 0, mask: Uint8Array.from([1, 1]) }),
    ).toThrow(/2 entries for 4 pixels/);
  });

  it('clips a masked raster the same way as an unmasked one', () => {
    // Two code paths — a whole-row `set` when there is no mask, a per-pixel
    // loop when there is — and they must clip identically. A divergence here
    // shows up on one caller only.
    const source = frame(Uint16Array.from([1, 2, 3, 4, 5, 6]), 3);
    const opaque = new Uint8Array(6).fill(1);
    for (const at of [
      { x: -1, y: 0 },
      { x: 3, y: 1 },
      { x: 0, y: -1 },
      { x: -2, y: -1 },
    ]) {
      const plain = buffer(4, 3);
      const masked = buffer(4, 3);
      drawFrame(plain, source, at);
      drawFrame(masked, source, { ...at, mask: opaque });
      expect(grid(masked)).toEqual(grid(plain));
    }
  });
});
