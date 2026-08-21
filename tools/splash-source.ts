/**
 * What the splash is baked *from*, for the baker and the gate both.
 *
 * Split out of `bake-splash.ts` because `bake-splash.test.ts` needs the same
 * two things and cannot import the baker — that is a script with top-level
 * await, so importing it would run it.
 *
 * `withWordmark` matters to the gate because the palette it checks against is
 * derived from the SVG's `fill` attributes, and until the placeholder is
 * expanded the wordmark's two colours are `data-ink` and `data-accent`, which
 * no `fill` names.
 *
 * `fingerprint` is what ties the committed header to the committed artwork. A
 * review moved Clawd 190 pixels across the panel without re-baking and every
 * assertion in that gate still passed, because they all read the header and
 * the header had not changed. Nothing there rasterises — doing so would put
 * Playwright in `pnpm test` for one assertion. Recording the source's hash in
 * the generated file costs nothing and fails loudly instead: the firmware is
 * flashed once, so "edited the art, forgot to re-bake" ships the old picture
 * permanently.
 */
import { createHash } from 'node:crypto';

import {
  FIRST_CODE_POINT,
  GLYPH_HEIGHT,
  GLYPH_ROWS,
  GLYPH_WIDTH,
} from '../packages/renderer/src/font-data.ts';

/** Where the placeholder says the wordmark goes, and in what colours. */
type Wordmark = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly accentFrom: number;
  readonly inks: readonly [string, string];
};

function placeholder(svg: string): { tag: string; mark: Wordmark } {
  const found = /<g id="wordmark"([\s\S]*?)\/>/.exec(svg);
  if (found === null)
    throw new Error('no #wordmark placeholder in the splash SVG');
  const attr = (name: string): string => {
    const match = new RegExp(`data-${name}="([^"]*)"`).exec(found[1] ?? '');
    if (match === null) throw new Error(`#wordmark has no data-${name}`);
    return match[1] ?? '';
  };
  return {
    tag: found[0],
    mark: {
      text: attr('text'),
      x: Number(attr('x')),
      y: Number(attr('y')),
      scale: Number(attr('scale')),
      accentFrom: Number(attr('accent-from')),
      inks: [attr('ink'), attr('accent')],
    },
  };
}

/**
 * One glyph, as rectangles.
 *
 * A rect per horizontal run of set pixels rather than per pixel, which is the
 * difference between about a hundred rects and about seven hundred. The scan
 * runs one column past the glyph so a run reaching the right edge is closed.
 */
function glyphRects(character: string, at: number, mark: Wordmark): string[] {
  const code = character.codePointAt(0) ?? 0;
  const first = (code - FIRST_CODE_POINT) * GLYPH_HEIGHT;
  if (first < 0 || first + GLYPH_HEIGHT > GLYPH_ROWS.length) {
    throw new Error(`no glyph for ${JSON.stringify(character)} in the atlas`);
  }
  const { x, y, scale } = mark;
  const out: string[] = [];
  for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
    const mask = GLYPH_ROWS[first + row] ?? 0;
    let run = 0;
    for (let column = 0; column <= GLYPH_WIDTH; column += 1) {
      const lit =
        column < GLYPH_WIDTH &&
        (mask & (1 << (GLYPH_WIDTH - 1 - column))) !== 0;
      if (lit) {
        run += 1;
      } else if (run > 0) {
        const left = x + (at * GLYPH_WIDTH + column - run) * scale;
        out.push(
          `<rect x="${String(left)}" y="${String(y + row * scale)}" width="${String(run * scale)}" height="${String(scale)}"/>`,
        );
        run = 0;
      }
    }
  }
  return out;
}

/**
 * Expand `#wordmark` into rectangles from the renderer's glyph table.
 *
 * The expansion has to happen before `paletteOf` runs, because the placeholder
 * carries its colours in `data-` attributes and that function only reads
 * `fill`.
 */
export function withWordmark(svg: string): string {
  const { tag, mark } = placeholder(svg);
  const groups: [string[], string[]] = [[], []];
  [...mark.text].forEach((character, at) => {
    const into = groups[at < mark.accentFrom ? 0 : 1];
    into.push(...glyphRects(character, at, mark));
  });
  if (groups[0].length === 0 || groups[1].length === 0) {
    throw new Error('the wordmark expanded to nothing — check the glyph table');
  }
  const drawn = groups
    .map(
      (rects, at) => `<g fill="${mark.inks[at] ?? ''}">${rects.join('')}</g>`,
    )
    .join('');
  return svg.replace(tag, `<g id="wordmark">${drawn}</g>`);
}

/**
 * A hash of the artwork, ignoring comments and whitespace.
 *
 * Comments are stripped so that rewording the long explanation in the SVG does
 * not demand a re-bake it would not change the output of, and whitespace is
 * collapsed so a reformat does not either. Everything that can move a pixel is
 * in here.
 */
export function fingerprint(svg: string): string {
  const meaningful = svg
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(meaningful).digest('hex').slice(0, 16);
}
