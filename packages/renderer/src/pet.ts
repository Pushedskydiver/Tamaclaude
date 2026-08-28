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
 * Its base sits on the stage's last row, well in front of his contact shadow
 * at 158 — nearer the viewer on a receding beach — so it reads as a foreground
 * prop and may overlap him. `BUILD_PLAN.md` carries the measurement and
 * records that "background prop", the plan's wording since 18 Aug, was retired
 * against it.
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
 * **Not the clear sand, and that was an error worth naming.** The first
 * version of this was 36x22, derived from the largest rectangle that avoids
 * the character's mask entirely. That bound belongs to a prop drawn *behind*
 * him. This one is drawn in front, so overlapping his legs is what being in
 * front means, and avoiding it bought nothing — it only made the pet a
 * quarter of his width, which on glass read as a dark lump rather than as an
 * animal. The photograph is what settled it; every render up to that point
 * had been judged at eight times size.
 *
 * 60x42, bottom-left, with its base on the stage's last row: `y` is
 * stage-relative, so 118 + 42 - 1 = 159, which is panel row 165 and the last
 * row the stage paints. A first version said 124 and ran six rows past the
 * bottom of the stage; the clip hid it and a test caught it.
 *
 * **60 and 42 are chosen, not derived, and the reasons differ.** 60 is a
 * judgement: much wider and the prop competes with the character rather than
 * sitting in front of him. Do not read it as a third of the stage — a third of
 * 168 is 56, and `tools/logo2pixel.ts` already calls 48 "roughly a third",
 * so that phrasing was doing no work.
 *
 * 42 has one hard floor under it, found after the fact rather than aimed at.
 * The top lands on panel row 124, and the lowest black pixel of the
 * character's eye inside these columns is row 123 — so 42 is the largest
 * height that clears his face, by one row. What it crosses is his torso and
 * his lower arm, not his legs, which sit at rows 146-157 in columns 48-55; an
 * earlier version of this sentence said legs and was wrong. **That one-row
 * margin is undocumented anywhere else**: a re-bake that drops the eyes a
 * pixel breaks it silently.
 *
 * **It clips the drooping claw, and the amount was worth measuring.**
 * `asleep.svg` calls that claw "what distinguishes this from `idle` at a
 * glance", and the pet's box overlaps its rows. A review read that as the pet
 * being able to hide the one feature telling the two screens apart. Measured
 * against the pet's actual mask rather than its box, it hides **13%** of the
 * claw band per frame — 86 of 643 pixels — so the claw still reads, and the
 * `Zzz` and the closed eyes are untouched. Real, small, and recorded so a
 * larger pet is not drawn without re-checking it.
 *
 * `packages/packs/src/index.ts` repeats these two numbers because it sits
 * below this package and cannot import them; `pet.test.ts` asserts they agree.
 */
export const PET_SLOT: Rect = { x: 0, y: 118, width: 60, height: 42 };

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
