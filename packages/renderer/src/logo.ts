/**
 * The company mark on the laptop lid.
 *
 * **The lid, not the boot splash.** The screen spec's easter-egg table routes
 * a logo to the splash, and `BUILD_PLAN.md` overrules it for a reason the
 * spec did not have in view: the splash is drawn by the firmware, which runs
 * before the daemon exists and is flashed rather than configured. A splash
 * logo could not be a pack field at all. The lid can be.
 *
 * **The mark is clipped to the sprite's own slot**, so a layout that does not
 * render the lid cannot put a company logo somewhere else on the panel.
 *
 * **Fixed position, and that is safe because the lid does not move.** Measured
 * from the baked frames rather than assumed: across all sixteen frames of
 * `typing` the lid is identical pixel for pixel, the only thing that changes
 * inside it is the placeholder square this replaces, and nothing ever occludes
 * it — the mask is set on every pixel of the slot on every frame. `logo.test.ts`
 * re-checks that against the sprite so re-authoring the animation cannot
 * quietly leave the mark floating over Clawd.
 */

import type { PackManifest } from '@tamaclaude/packs';
import type { Rect } from '@tamaclaude/protocol';

import { frame } from '@tamaclaude/protocol';

import { decodeBlob, maskWords, unpackMask } from './blob.js';
import { drawFrame, fillRect } from './draw.js';
import { type Framebuffer } from './framebuffer.js';

/** A pack's logo, once the schema has accepted it. */
type PackLogo = NonNullable<PackManifest['logo']>;

/**
 * The lid face, in the sprite's own coordinates — not the panel's.
 *
 * `typing`'s raster is 168x200 and the lid occupies x 42..125, y 160..179.
 * Sprite coordinates rather than device ones because the sprite is blitted at
 * an offset that depends on orientation and layout: `paintLogo` takes the same
 * origin the sprite was drawn at, so the mark follows it instead of needing
 * its own copy of that arithmetic.
 */
export const LID_SLOT: Rect = { x: 42, y: 160, width: 84, height: 20 };

/**
 * The pulsing square baked into the artwork, which a pack mark must cover.
 *
 * `typing.svg` carries `#logo-lit` and `#logo-dim` — two rects alternating on a
 * one-second loop. On the old grey lid that read as a lit screen; on the red it reads as an inlaid badge, which suits the back of a lid better. They stay,
 * because a pack without a logo should still have a lit screen, and because
 * the SVG calls them load-bearing: the two `#logo-*` rules match nothing else
 * and removing them kills the pulse silently.
 *
 * **What that costs is this rectangle.** A mark drawn straight over the lid
 * shows the blue through its own transparent parts — through the counter of a
 * letter, which is exactly where the eye goes. Found by rendering one and
 * looking at it, not by reasoning about it. So the slot is cleared to the lid
 * colour first, and cleared whether or not the mark would cover it: a mark
 * smaller than 8x8 does not.
 */
export const PLACEHOLDER: Rect = { x: 80, y: 166, width: 8, height: 8 };

/**
 * A pixel of plain lid, well clear of the placeholder, in sprite coordinates.
 *
 * The lid colour is read from the framebuffer here rather than written down as
 * a constant. The sprite has already been drawn by the time this runs, so the
 * pixel is right there — and a constant would be a second copy of a value that
 * lives in the artwork, drifting the first time the lid is recoloured with
 * nothing to catch it.
 */
const LID_SAMPLE = { x: LID_SLOT.x + 4, y: LID_SLOT.y + 4 };

/** Where a mark of this size sits on the lid, in sprite coordinates. */
export function logoSlot(logo: Pick<PackLogo, 'width' | 'height'>): Rect {
  return {
    x: LID_SLOT.x + Math.floor((LID_SLOT.width - logo.width) / 2),
    y: LID_SLOT.y + Math.floor((LID_SLOT.height - logo.height) / 2),
    width: logo.width,
    height: logo.height,
  };
}

/**
 * Draw `logo` on the lid, given where the sprite's own origin landed.
 *
 * Returns the rectangle it filled, or `null` if the payload could not be read.
 * **Null rather than a throw**: a pack is hand-edited and the schema can only
 * check that the base64 is base64 — it cannot check the bytes decode to a mark
 * of the stated size, so a truncated paste arrives here. Losing the mark is
 * survivable. Taking the panel down on the recipient's machine is not.
 */
export function paintLogo(
  target: Framebuffer,
  where: {
    /** Where the sprite's own (0,0) landed on the panel. */
    readonly origin: { readonly x: number; readonly y: number };
    /**
     * The slot the sprite was clipped to, which clips the mark too.
     *
     * **Without it the mark escapes.** `drawFrame` clips the sprite to its
     * slot, and in `twoUp` that slot is 80 or 100 pixels tall while the lid
     * lives at sprite y 160-179 — so the lid is not drawn at all, and a mark
     * positioned from `LID_SLOT` lands over the session strip in portrait and
     * off the panel entirely in landscape. Latent, because the daemon only
     * ever asks for `hero`; a review found it by evaluating all four
     * combinations rather than the one that ships.
     */
    readonly within: Rect;
  },
  logo: PackLogo,
): Rect | null {
  const spriteOrigin = where.origin;
  const pixels = logo.width * logo.height;
  const slot = logoSlot(logo);
  const decoded = read(logo, pixels);
  if (decoded === null) return null;
  const at = {
    x: spriteOrigin.x + slot.x,
    y: spriteOrigin.y + slot.y,
    width: slot.width,
    height: slot.height,
  };
  // Clear the pulsing square to the lid's own colour before the mark goes on.
  // Sampled from the target, which already has the sprite on it.
  const lid =
    target.pixels[
      (spriteOrigin.y + LID_SAMPLE.y) * target.width +
        spriteOrigin.x +
        LID_SAMPLE.x
    ];
  const clear = intersect(
    {
      x: spriteOrigin.x + PLACEHOLDER.x,
      y: spriteOrigin.y + PLACEHOLDER.y,
      width: PLACEHOLDER.width,
      height: PLACEHOLDER.height,
    },
    where.within,
  );
  if (lid !== undefined && clear !== null) fillRect(target, clear, lid);
  drawFrame(target, frame(decoded.words, logo.width), {
    x: at.x,
    y: at.y,
    within: where.within,
    mask: decoded.mask,
  });
  return at;
}

/** The overlap of two rectangles, or nothing if they do not touch. */
function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function read(
  logo: PackLogo,
  pixels: number,
): { readonly words: Uint16Array; readonly mask: Uint8Array } | null {
  try {
    // No length check: `decodeRect` allocates `pixelCount` words and throws on
    // any mismatch, on both the raw and RLE paths, so a guard here is
    // unreachable. A review deleted one and the suite stayed green. The
    // `catch` is doing all of the work.
    const words = decodeBlob(logo.pixels, pixels);
    const mask = unpackMask(decodeBlob(logo.mask, maskWords(pixels)), pixels);
    return { words, mask };
  } catch {
    return null;
  }
}
