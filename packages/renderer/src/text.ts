import type { Framebuffer } from './framebuffer.js';
import type { Rect } from '@tamaclaude/protocol';

import {
  FIRST_CODE_POINT,
  GLYPH_HEIGHT,
  GLYPH_ROWS,
  GLYPH_WIDTH,
} from './font-data.js';

/**
 * Bitmap text on the panel.
 *
 * The glyphs come pre-baked from `tools/make-font-atlas.ts`; nothing here
 * rasterises anything at run time. See `font-data.ts` for why.
 */

/** Where and in what colour a line of text is drawn. `y` is the cell top. */
export type TextPen = {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
};

/** Glyphs in the atlas, derived so the two cannot drift apart. */
const GLYPH_COUNT = GLYPH_ROWS.length / GLYPH_HEIGHT;

/**
 * Where a code point's rows start in `GLYPH_ROWS`.
 *
 * Anything the atlas does not carry draws as `?`. Dropping it instead would
 * shorten the line silently and disagree with `measureText`; drawing a blank
 * would claim the character was a space.
 */
function glyphOffset(codePoint: number): number {
  const index = codePoint - FIRST_CODE_POINT;
  const known = index >= 0 && index < GLYPH_COUNT;
  const fallback = 0x3f - FIRST_CODE_POINT;
  return (known ? index : fallback) * GLYPH_HEIGHT;
}

/** Blit one glyph, clipped to the framebuffer. */
function drawGlyph(target: Framebuffer, codePoint: number, pen: TextPen): void {
  const offset = glyphOffset(codePoint);
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const mask = GLYPH_ROWS[offset + row] ?? 0;
    const y = pen.y + row;
    if (mask === 0 || y < 0 || y >= target.height) continue;
    for (let column = 0; column < GLYPH_WIDTH; column += 1) {
      const x = pen.x + column;
      const lit = (mask & (1 << (GLYPH_WIDTH - 1 - column))) !== 0;
      if (!lit || x < 0 || x >= target.width) continue;
      target.pixels[y * target.width + x] = pen.colour;
    }
  }
}

/**
 * Draw one line of text. Nothing wraps and a newline is just another
 * character the atlas lacks; pixels outside the framebuffer are dropped. For
 * text that has to fit a band, use `drawTextBlock`.
 */
export function drawText(
  target: Framebuffer,
  text: string,
  pen: TextPen,
): void {
  let x = pen.x;
  for (const character of text) {
    drawGlyph(target, character.codePointAt(0) ?? 0, { ...pen, x });
    x += GLYPH_WIDTH;
  }
}

/** Width in device pixels of one line of text. */
export function measureText(text: string): number {
  // Spread rather than `.length`: an astral code point is two UTF-16 units
  // and one glyph cell, and a measure that disagrees with the draw puts
  // everything laid out after it in the wrong place.
  return [...text].length * GLYPH_WIDTH;
}

/**
 * Rewrite text so one UTF-16 unit is one drawn cell.
 *
 * Wrapping counts columns with `.length`, and everything the atlas lacks
 * draws as a single `?`. Substituting first is what keeps those two counts
 * equal — otherwise a quip with an emoji in it wraps a cell early.
 */
function toAtlas(text: string): string {
  return [...text]
    .map((character) => {
      const index = (character.codePointAt(0) ?? 0) - FIRST_CODE_POINT;
      return index >= 0 && index < GLYPH_COUNT ? character : '?';
    })
    .join('');
}

/**
 * Break opportunities, as a zero-width split *after* the character.
 *
 * Spaces are the obvious ones. The rest are here because the strings this
 * panel shows are mostly identifiers and paths, not prose: `mcp__linear__`
 * `create_issue` reads perfectly well over two lines and is unreadable split
 * at whatever column it happens to reach.
 */
const BREAK_AFTER = /(?<=[ _/-])/;

/** Chop a token with no break opportunity in it into line-sized pieces. */
function hardSplit(chunk: string, columns: number): string[] {
  const pieces: string[] = [];
  for (let at = 0; at < chunk.length; at += columns) {
    pieces.push(chunk.slice(at, at + columns));
  }
  return pieces;
}

/**
 * Greedily pack chunks into lines, dropping the space each break lands on.
 *
 * The whitespace test runs on every new line, not only the first. It used to
 * guard the opening chunk alone, which was wrong whenever a token filled a
 * line exactly: the following space became the first chunk of the next line,
 * and a break after *it* left that line holding nothing but the space. At the
 * message band's real width — 23 columns — `'a' * 23 + ' ' + 'b' * 23` came
 * back as three lines with a blank in the middle, and the band only holds
 * four, so a quarter of it went to nothing and real text was pushed under the
 * ellipsis. The near miss produced a leading space instead, which is subtler
 * and reads as a wonky indent.
 */
function fill(chunks: readonly string[], columns: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const chunk of chunks) {
    const starting = current === '';
    if (starting && chunk.trim() === '') continue;
    if (starting || current.length + chunk.length <= columns) {
      current += chunk;
      continue;
    }
    lines.push(current.trimEnd());
    current = chunk.trim() === '' ? '' : chunk;
  }
  if (current !== '') lines.push(current.trimEnd());
  return lines;
}

/**
 * Break text to fit a pixel width, one line per element.
 *
 * Exported because callers have to lay out before they draw — how many lines
 * a label needs is what decides whether a band is tall enough for it, and
 * `measureText` alone cannot answer that.
 */
export function wrapText(text: string, width: number): readonly string[] {
  const columns = Math.floor(width / GLYPH_WIDTH);
  if (columns < 1) return [];
  return text.split('\n').flatMap((paragraph) => {
    const chunks = toAtlas(paragraph)
      .split(BREAK_AFTER)
      .flatMap((chunk) =>
        chunk.length > columns ? hardSplit(chunk, columns) : [chunk],
      );
    return fill(chunks, columns);
  });
}

/**
 * Baseline-to-baseline distance: the glyph cell plus one row of leading.
 *
 * Without the extra row a descender sits directly against the next line's
 * ascenders, which at 11px reads as one smudged block rather than two lines.
 */
export const LINE_HEIGHT = GLYPH_HEIGHT + 1;

/** Marker for text a box could not hold. ASCII, because the atlas is. */
const ELLIPSIS = '...';

/** Where a block of text goes, and in what colour. */
export type TextBox = {
  readonly rect: Rect;
  readonly colour: number;
};

/** Put the marker on a line, taking columns back from it if it has to. */
function markTruncated(line: string, columns: number): string {
  const room = columns - ELLIPSIS.length;
  if (room < 0) return ELLIPSIS.slice(0, columns);
  return `${line.slice(0, Math.min(line.length, room))}${ELLIPSIS}`;
}

/**
 * Draw text wrapped to a box, marking anything that did not fit.
 *
 * Wrap rather than truncate, and never clip in silence. Both come from the
 * same recorded failure (`tools/harness.ts`): a long MCP tool name overran
 * the 172px message band and lost five characters to `overflow: hidden`,
 * while the band still looked like one short line in a large box — which then
 * argued for making the band *smaller*. Truncating to one line would be the
 * same defect with better manners: it keeps `mcp__linear__` and throws away
 * `create_issue`, which is the half that says what is happening. At the
 * message band that name costs two lines of the four the band actually holds
 * once `paintMessage` insets it — 64px is five rows of 12, but the inset
 * spends one — so there is nothing to buy by truncating it.
 */
export function drawTextBlock(
  target: Framebuffer,
  text: string,
  box: TextBox,
): void {
  const columns = Math.floor(box.rect.width / GLYPH_WIDTH);
  // The last line needs its cell but not the leading below it, so a band
  // exactly one cell tall holds exactly one line.
  const leading = LINE_HEIGHT - GLYPH_HEIGHT;
  const rows = Math.floor((box.rect.height + leading) / LINE_HEIGHT);
  if (columns < 1 || rows < 1) return;
  const lines = wrapText(text, box.rect.width);
  const shown = lines.slice(0, rows);
  for (const [index, line] of shown.entries()) {
    const overflowed = lines.length > rows && index === shown.length - 1;
    drawText(target, overflowed ? markTruncated(line, columns) : line, {
      x: box.rect.x,
      y: box.rect.y + index * LINE_HEIGHT,
      colour: box.colour,
    });
  }
}
