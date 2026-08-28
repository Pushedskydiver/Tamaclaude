/**
 * The recipient's pet, asleep on the sand.
 *
 * The pack's second piece of art, and the same shape as the logo — a blob of
 * RGB565 through `encodeRect` plus a bit-mask — decoded through the shared
 * `blob.ts`. What differs is where it goes and when it is drawn.
 *
 * **It is not on the character, so it is not clipped to him.** `logo.ts` puts
 * a mark on the laptop lid and clips it to the sprite's own slot, because the
 * lid moves with him. This stands on the ground, so its rect is the stage's
 * and the stage is what clips it.
 *
 * **It is painted after him, and that is a decision rather than an accident.**
 * `PET_SLOT` is the only unoccluded home a prop this size has: measured
 * against the character's mask union over all 128 `idle` and 96 `asleep`
 * frames, columns 19-31 are covered on every row from 136 to 143 and clear
 * only at 144. Sitting there puts it seven rows in front of his contact
 * shadow — nearer the viewer on a receding beach — so it reads as a
 * foreground prop. `BUILD_PLAN.md` carries the measurement and records that
 * "background prop", the plan's wording since 18 Aug, was retired against it.
 */
import type { Framebuffer } from './framebuffer.js';
import type { PackManifest } from '@tamaclaude/packs';
import type { Rect } from '@tamaclaude/protocol';

import { frame } from '@tamaclaude/protocol';

import { decodeBlob, maskWords, unpackMask } from './blob.js';
import { drawFrame } from './draw.js';

type PackPet = NonNullable<PackManifest['pet']>;

/**
 * Where the pet stands, relative to the stage band.
 *
 * Panel row 144 in landscape hero, which is `stage.y + 138`. The width is the
 * measured clear sand: up to 36 leaves 22 rows, and 37 or more leaves six.
 * `packages/packs/src/index.ts` repeats these two numbers because it sits
 * below this package and cannot import them; `pet.test.ts` asserts they agree.
 */
export const PET_SLOT: Rect = { x: 0, y: 138, width: 36, height: 22 };

/**
 * Draw the pet into the stage, and report where it landed.
 *
 * `null` when the payload does not decode, which is the same contract
 * `paintLogo` has: a pack that looks configured and silently shows nothing is
 * the fault this boundary exists to name, so the caller can tell the
 * difference between "no pet" and "a pet that would not decode".
 */
export function paintPet(
  target: Framebuffer,
  stage: Rect,
  pet: PackPet,
): Rect | null {
  const count = pet.width * pet.height;
  const decoded = read(pet, count);
  if (decoded === null) return null;
  // Bottom-aligned. The art fills its raster to the last row, so this is what
  // puts its feet on the sand; a shorter sprite hung from the top would float,
  // which reads as a rendering fault rather than as a creature.
  const at = {
    x: stage.x + PET_SLOT.x,
    y: stage.y + PET_SLOT.y + PET_SLOT.height - pet.height,
    width: pet.width,
    height: pet.height,
  };
  drawFrame(target, frame(decoded.words, pet.width), {
    x: at.x,
    y: at.y,
    within: stage,
    mask: decoded.mask,
  });
  return at;
}

function read(
  pet: PackPet,
  count: number,
): { readonly words: Uint16Array; readonly mask: Uint8Array } | null {
  try {
    // No length check, for the reason `logo.ts` records: `decodeRect` throws on
    // any mismatch on both paths, so a guard here is unreachable and the
    // `catch` does the work.
    return {
      words: decodeBlob(pet.pixels, count),
      mask: unpackMask(decodeBlob(pet.mask, maskWords(count)), count),
    };
  } catch {
    return null;
  }
}
