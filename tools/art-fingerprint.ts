/**
 * A hash of a piece of artwork, for tying generated output back to its source.
 *
 * The bakers here turn art into generated code committed beside it, and until
 * recently nothing compared the two. `tools/bake-splash.test.ts` was the first
 * to, using this hash; the sprites had no equivalent. `sprites/index.test.ts`
 * proves the baked sprites decode and re-encode to the bytes they were given —
 * which is internal consistency, not currency. Four of the six shipped with
 * data baked from an older SVG, and the difference was holes where Clawd's eyes
 * are: invisible for as long as the stage behind him was black, and windows
 * showing the sky through his face the moment the rock pool was wired on.
 *
 * Comments are stripped — XML and CSS both — so rewording an explanation does
 * not demand a re-bake that could not change a pixel, and whitespace is
 * collapsed so a reformat does not either. Everything that can move a pixel is
 * inside the hash.
 */
import { createHash } from 'node:crypto';

export function fingerprint(svg: string): string {
  const meaningful = svg
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    // CSS comments too. These sit inside `<style>`, so the XML strip above
    // does not reach them, and an animation's motion is explained almost
    // entirely in them — every keyframe block in this repo carries a paragraph
    // saying why its numbers are what they are. Leaving them in meant that
    // rewording one demanded a re-bake that could not change a pixel, which is
    // exactly the false alarm the comment strip exists to avoid.
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(meaningful).digest('hex').slice(0, 16);
}
