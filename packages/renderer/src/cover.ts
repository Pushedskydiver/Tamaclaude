/**
 * The rare scene, drawn over the stage in the small hours.
 *
 * The pack's third piece of art and the first that *covers* rather than
 * decorates. `logo.ts` puts a mark on the laptop lid and clips it to the
 * character's own slot, because the lid moves with him. `pet.ts` stands a prop
 * on the sand and bottom-aligns it, because a creature with its feet off the
 * ground reads as a rendering fault. This replaces the picture, so it is
 * centred in what it replaces and clipped to the stage.
 *
 * **Named for what it does structurally, not for what it depicts.** The daemon
 * side is `SCENE_COVERS` — which states a scene may cover — and this is the
 * painter that does the covering; the pair read together. It cannot be called
 * `scene.ts`, which is the compositor that draws every band, and should not be
 * named after its subject, because its subject is two real people and
 * `CLAUDE.md` keeps them out of tracked files. The pack field is `scene`; what
 * is in it is the pack's business.
 *
 * **The art is not here and never will be.** This repo carries the bounds, the
 * centring, the decode contract and the tests. A pack that has no scene shows
 * the ordinary animation, which is what `packs/example` does and should keep
 * doing.
 */
import type { Framebuffer } from './framebuffer.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Rect } from '@tamaclaude/protocol';

import { frame } from '@tamaclaude/protocol';

import { decodeBlob, maskWords, unpackMask } from './blob.js';
import { drawFrame } from './draw.js';

type PackScene = NonNullable<PackManifest['scene']>;

/**
 * The stage, in stage-relative coordinates.
 *
 * The whole of it: 168x160 is what `layout.ts` gives the stage band in
 * landscape — `STAGE_WIDTH`, and `STAGE_UNITS.landscape.height` at
 * `LAYOUT_SCALE.hero`. Unlike `PET_SLOT` these are not a judgement about
 * composition; they are the surface being covered, so a scene cannot be
 * larger and there is nothing to choose.
 *
 * `packages/packs` repeats them as literals in its `scene` field because it
 * sits below this package and cannot import them. `cover.test.ts` asserts the
 * two agree, which is the only thing standing between a schema that accepts a
 * picture and a stage that would clip it.
 */
export const COVER_SLOT: Rect = { x: 0, y: 0, width: 168, height: 160 };

/**
 * Draw the scene over the stage, and report where it landed.
 *
 * `null` when the payload does not decode — the same contract `paintLogo` and
 * `paintPet` have, so a caller can tell "no scene" from "a scene that would
 * not decode". Only the second is a bug, and a pack that looks configured
 * while showing nothing is exactly the fault this boundary exists to name.
 */
export function paintCover(
  target: Framebuffer,
  stage: Rect,
  scene: PackScene,
): Rect | null {
  const decoded = read(scene, scene.width * scene.height);
  if (decoded === null) return null;
  // Centred. A scene need not fill the stage, and one anchored to a corner
  // would read as a picture that failed to load rather than as a small one.
  const at = {
    x:
      stage.x + COVER_SLOT.x + Math.round((COVER_SLOT.width - scene.width) / 2),
    y:
      stage.y +
      COVER_SLOT.y +
      Math.round((COVER_SLOT.height - scene.height) / 2),
    width: scene.width,
    height: scene.height,
  };
  drawFrame(target, frame(decoded.words, scene.width), {
    x: at.x,
    y: at.y,
    within: stage,
    mask: decoded.mask,
  });
  return at;
}

function read(
  scene: PackScene,
  count: number,
): { readonly words: Uint16Array; readonly mask: Uint8Array } | null {
  try {
    // No length check, for the reason `logo.ts` records: `decodeRect` throws on
    // any mismatch on both paths, so a guard here is unreachable and the
    // `catch` does the work.
    return {
      words: decodeBlob(scene.pixels, count),
      mask: unpackMask(decodeBlob(scene.mask, maskWords(count)), count),
    };
  } catch {
    return null;
  }
}
