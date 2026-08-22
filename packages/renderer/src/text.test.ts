import type { Framebuffer } from './framebuffer.js';

import { describe, expect, it } from 'vitest';

import {
  FIRST_CODE_POINT,
  GLYPH_HEIGHT,
  GLYPH_ROWS,
  GLYPH_WIDTH,
} from './font-data.js';
import {
  drawText,
  drawTextBlock,
  LINE_HEIGHT,
  measureText,
  wrapText,
} from './text.js';

/** Any distinctive non-zero colour; the tests only care that it round-trips. */
const RED = 0xf800;

describe('measureText', () => {
  it('is one cell per character, because the face is monospaced', () => {
    expect(measureText('Grep')).toBe(4 * GLYPH_WIDTH);
    expect(measureText('')).toBe(0);
  });

  it('counts code points, not UTF-16 units', () => {
    // An astral character draws as one substitute glyph, so it must measure
    // as one cell — otherwise every layout past it is a cell too wide.
    expect(measureText('\u{1F980}')).toBe(GLYPH_WIDTH);
  });
});

/** A framebuffer just big enough for the case under test. */
function scratch(width: number, height: number): Framebuffer {
  return { pixels: new Uint16Array(width * height), width, height };
}

/** Read a framebuffer row back as a bitmask, so it can face the atlas. */
function maskOf(target: Framebuffer, row: number, colour: number): number {
  let mask = 0;
  for (let column = 0; column < GLYPH_WIDTH; column += 1) {
    const pixel = target.pixels[row * target.width + column];
    if (pixel === colour) mask |= 1 << (GLYPH_WIDTH - 1 - column);
  }
  return mask;
}

function glyphRows(character: string): readonly number[] {
  const index = (character.codePointAt(0) ?? 0) - FIRST_CODE_POINT;
  const start = index * GLYPH_HEIGHT;
  return GLYPH_ROWS.slice(start, start + GLYPH_HEIGHT);
}

describe('drawText', () => {
  it('plots the atlas bitmap, in the colour asked for', () => {
    const target = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(target, 'A', { x: 0, y: 0, colour: RED });
    const drawn = Array.from({ length: GLYPH_HEIGHT }, (_, row) =>
      maskOf(target, row, RED),
    );
    expect(drawn).toEqual([...glyphRows('A')]);
  });

  it('advances one cell per character', () => {
    const target = scratch(GLYPH_WIDTH * 2, GLYPH_HEIGHT);
    drawText(target, ' A', { x: 0, y: 0, colour: RED });
    // The space leaves the first cell untouched and the A lands in the second.
    expect(target.pixels.slice(0, GLYPH_WIDTH)).toEqual(
      new Uint16Array(GLYPH_WIDTH),
    );
    const secondCell = Array.from({ length: GLYPH_HEIGHT }, (_, row) => {
      let mask = 0;
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        const at = row * target.width + GLYPH_WIDTH + column;
        if (target.pixels[at] === RED) mask |= 1 << (GLYPH_WIDTH - 1 - column);
      }
      return mask;
    });
    expect(secondCell).toEqual([...glyphRows('A')]);
  });
});

describe('drawText clipping', () => {
  it('does not spill past the right edge into the next row', () => {
    // The bug this guards: `y * width + x` with x past the width lands on the
    // next row rather than off the buffer, so a glyph clipped on the right
    // reappears as confetti down the left-hand side.
    const target = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(target, 'A', { x: GLYPH_WIDTH, y: 0, colour: RED });
    expect(target.pixels).toEqual(new Uint16Array(GLYPH_WIDTH * GLYPH_HEIGHT));
  });

  it('draws the visible part of a glyph that starts off-buffer', () => {
    const whole = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(whole, 'A', { x: 0, y: 0, colour: RED });
    const clipped = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(clipped, 'A', { x: -2, y: 0, colour: RED });
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      // Every column that survives the shift must match the unshifted glyph.
      expect(maskOf(clipped, row, RED) & 0b0001111).toBe(
        (maskOf(whole, row, RED) << 2) & 0b0001111,
      );
    }
  });

  it('draws off the top and bottom without touching anything', () => {
    const target = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(target, 'A', { x: 0, y: -GLYPH_HEIGHT, colour: RED });
    drawText(target, 'A', { x: 0, y: GLYPH_HEIGHT, colour: RED });
    expect(target.pixels).toEqual(new Uint16Array(GLYPH_WIDTH * GLYPH_HEIGHT));
  });

  it('substitutes a question mark for anything the atlas lacks', () => {
    const target = scratch(GLYPH_WIDTH, GLYPH_HEIGHT);
    drawText(target, '\u{1F980}', { x: 0, y: 0, colour: RED });
    const drawn = Array.from({ length: GLYPH_HEIGHT }, (_, row) =>
      maskOf(target, row, RED),
    );
    expect(drawn).toEqual([...glyphRows('?')]);
  });
});

/** The portrait message band is 172px wide, which is 24 cells of 7px. */
const BAND_COLUMNS = 24;
const BAND_WIDTH = BAND_COLUMNS * GLYPH_WIDTH;

describe('wrapText', () => {
  it('breaks at spaces and drops the space it broke on', () => {
    expect(wrapText('Skitter, Skitter, Skitter', BAND_WIDTH)).toEqual([
      'Skitter, Skitter,',
      'Skitter',
    ]);
  });

  // A token that fills a line exactly used to leave the following space
  // stranded as the whole of the next line. At 23 columns the band holds four
  // lines, so a blank one costs a quarter of it and pushes real text under the
  // ellipsis; the near miss produced a leading space, which reads as a wonky
  // indent. Both were found by review rather than by these tests, which is why
  // they are here now.
  it('does not leave a blank line when a token fills one exactly', () => {
    const columns = 23;
    const width = columns * GLYPH_WIDTH;
    const wrapped = wrapText(
      `${'a'.repeat(columns)} ${'b'.repeat(columns)}`,
      width,
    );
    expect(wrapped).toEqual(['a'.repeat(columns), 'b'.repeat(columns)]);
  });

  it('does not indent the line after a token that fills one exactly', () => {
    const columns = 23;
    const wrapped = wrapText(
      `${'a'.repeat(columns)} tail`,
      columns * GLYPH_WIDTH,
    );
    expect(wrapped).toEqual(['a'.repeat(columns), 'tail']);
  });

  it('returns no lines for text that is empty or only spaces', () => {
    expect(wrapText('', BAND_WIDTH)).toEqual([]);
    expect(wrapText('   ', BAND_WIDTH)).toEqual([]);
  });

  it('breaks a long tool name after an underscore', () => {
    // `tools/harness.ts` records why: an underscore is not a wrap opportunity
    // in CSS, so `mcp__linear__create_issue` rendered as one 207px line inside
    // a 172px panel and was clipped with no marker — five characters gone,
    // while the band looked like one short line in a large box. Breaking after
    // `_` keeps both halves readable. (At this font's own 7px cell the same
    // string measures 175px; 207 is what the harness recorded in CSS, and the
    // two are not the same measurement.)
    expect(wrapText('mcp__linear__create_issue', BAND_WIDTH)).toEqual([
      'mcp__linear__create_',
      'issue',
    ]);
  });

  it('splits mid-token when a token has no break opportunity at all', () => {
    expect(wrapText('a'.repeat(30), 10 * GLYPH_WIDTH)).toEqual([
      'aaaaaaaaaa',
      'aaaaaaaaaa',
      'aaaaaaaaaa',
    ]);
  });

  it('honours a newline as a hard break', () => {
    expect(wrapText('one\ntwo', BAND_WIDTH)).toEqual(['one', 'two']);
  });

  it('turns anything outside the atlas into the substitute glyph', () => {
    // Wrapping counts columns, so a character that draws as one cell has to
    // count as one — otherwise a quip with an emoji in it wraps a cell early.
    expect(wrapText('a\u{1F980}b', BAND_WIDTH)).toEqual(['a?b']);
  });

  it('gives up rather than looping when the box is narrower than a cell', () => {
    expect(wrapText('anything', GLYPH_WIDTH - 1)).toEqual([]);
  });
});

/** What the same content looks like drawn line by line, for comparison. */
function expected(lines: readonly string[], like: Framebuffer): Framebuffer {
  const target = scratch(like.width, like.height);
  for (const [index, line] of lines.entries()) {
    drawText(target, line, { x: 0, y: index * LINE_HEIGHT, colour: RED });
  }
  return target;
}

describe('drawTextBlock', () => {
  it('stacks wrapped lines one line height apart', () => {
    const rect = { x: 0, y: 0, width: BAND_WIDTH, height: LINE_HEIGHT * 2 };
    const target = scratch(rect.width, rect.height);
    drawTextBlock(target, 'Skitter, Skitter, Skitter', { rect, colour: RED });
    expect(target.pixels).toEqual(
      expected(['Skitter, Skitter,', 'Skitter'], target).pixels,
    );
  });

  it('marks what it could not fit instead of dropping it silently', () => {
    // The whole point. A band that shows `mcp__linear__create_issu` and looks
    // like one tidy short line is worse than one that admits it ran out.
    const rect = { x: 0, y: 0, width: BAND_WIDTH, height: GLYPH_HEIGHT };
    const target = scratch(rect.width, rect.height);
    drawTextBlock(target, 'mcp__linear__create_issue', { rect, colour: RED });
    expect(target.pixels).toEqual(
      expected(['mcp__linear__create_...'], target).pixels,
    );
  });

  it('draws nothing below the box', () => {
    const rect = { x: 0, y: 0, width: BAND_WIDTH, height: GLYPH_HEIGHT };
    const target = scratch(rect.width, LINE_HEIGHT * 4);
    drawTextBlock(target, 'a '.repeat(60), { rect, colour: RED });
    const below = target.pixels.slice(rect.height * rect.width);
    expect(below).toEqual(new Uint16Array(below.length));
  });

  it('draws nothing at all in a box too short for one line', () => {
    const rect = { x: 0, y: 0, width: BAND_WIDTH, height: GLYPH_HEIGHT - 1 };
    const target = scratch(rect.width, LINE_HEIGHT);
    drawTextBlock(target, 'Grep', { rect, colour: RED });
    expect(target.pixels).toEqual(new Uint16Array(target.pixels.length));
  });

  it('draws at the box origin, not at the framebuffer origin', () => {
    const rect = { x: 3, y: 5, width: BAND_WIDTH, height: GLYPH_HEIGHT };
    const target = scratch(rect.x + rect.width, rect.y + LINE_HEIGHT);
    drawTextBlock(target, 'Grep', { rect, colour: RED });
    const control = scratch(target.width, target.height);
    drawText(control, 'Grep', { x: rect.x, y: rect.y, colour: RED });
    expect(target.pixels).toEqual(control.pixels);
  });
});

describe('scaled text', () => {
  it('magnifies each glyph pixel into a scale x scale block', () => {
    // Nearest-neighbour on the 1-bit mask, not a second atlas: Departure Mono
    // only rasterises cleanly at 11px, so a 22px face would reintroduce the
    // antialiasing `font-data.ts` exists to avoid.
    const plain = scratch(GLYPH_WIDTH * 2, GLYPH_HEIGHT * 2);
    drawText(plain, 'M', { x: 0, y: 0, colour: 1 });
    const doubled = scratch(GLYPH_WIDTH * 2, GLYPH_HEIGHT * 2);
    drawText(doubled, 'M', { x: 0, y: 0, colour: 1, scale: 2 });

    // Every lit pixel of the 1x glyph becomes a 2x2 block in the 2x one.
    for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
      for (let x = 0; x < GLYPH_WIDTH; x += 1) {
        const lit = plain.pixels[y * plain.width + x] !== 0;
        for (const [dy, dx] of [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ]) {
          const at = (y * 2 + dy) * doubled.width + (x * 2 + dx);
          expect(doubled.pixels[at] !== 0).toBe(lit);
        }
      }
    }
  });

  it('advances by a scaled cell, so a measure agrees with the draw', () => {
    // A measure that disagrees with the draw puts everything laid out after it
    // in the wrong place — the defect `rightAlignedX` already guards against.
    //
    // Asserting only that nothing spills past the measured width does not
    // catch this: an advance that is too *small* overlaps the glyphs inside
    // that width and passes. The first version of this test did exactly that,
    // and survived deleting the `* scale`. So it asserts the second glyph
    // actually begins where the measure says it does.
    expect(measureText('abc', 2)).toBe(3 * GLYPH_WIDTH * 2);

    const width = GLYPH_WIDTH * 6;
    const one = scratch(width, GLYPH_HEIGHT * 2);
    drawText(one, 'M', { x: 0, y: 0, colour: 1, scale: 2 });
    const two = scratch(width, GLYPH_HEIGHT * 2);
    drawText(two, 'MM', { x: 0, y: 0, colour: 1, scale: 2 });

    const rightmost = (target: Framebuffer): number => {
      let found = -1;
      for (let index = 0; index < target.pixels.length; index += 1) {
        if (target.pixels[index] !== 0) {
          found = Math.max(found, index % target.width);
        }
      }
      return found;
    };
    // The second glyph must push the rightmost lit column out by exactly one
    // scaled cell — not by one unscaled cell, and not by nothing at all.
    expect(rightmost(two) - rightmost(one)).toBe(GLYPH_WIDTH * 2);
    // And nothing may spill past what the measure promised.
    expect(rightmost(two)).toBeLessThan(measureText('MM', 2));
  });
});
