/**
 * A hash of a piece of artwork, for tying generated output back to its source.
 *
 * Every baker in this repo turns an SVG into generated code that is committed
 * beside it, and nothing in the six gates compares the two. `sprites/index.test.ts`
 * proves the baked sprites decode and re-encode to the bytes they were given —
 * which is internal consistency, not currency. Four of the six shipped with
 * data baked from an older SVG, and the difference was holes where Clawd's eyes
 * are: invisible for as long as the stage behind him was black, and windows
 * showing the sky through his face the moment the rock pool was wired on.
 *
 * Comments are stripped so rewording an explanation does not demand a re-bake
 * that would not change a pixel, and whitespace is collapsed so a reformat does
 * not either. Everything that can move a pixel is inside the hash.
 */
import { createHash } from 'node:crypto';

export function fingerprint(svg: string): string {
  const meaningful = svg
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(meaningful).digest('hex').slice(0, 16);
}
