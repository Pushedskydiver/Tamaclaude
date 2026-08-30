/**
 * Pack format: the entire customisation surface.
 *
 * A pack is a palette, a quip table, an optional birthday, an optional logo
 * and an optional pet. Props beyond the pet are planned (`BUILD_PLAN.md`
 * Stage 5) and are not fields yet.
 * The character
 * is deliberately not part of it: there is one base geometry and one animation
 * set, and the sprites are baked to fixed RGB565 by `tools/bake-sprites.ts`, so
 * nothing recolours Clawd per pack — a claim this block made until 25 Aug.
 *
 * **"Changes every screen" is aspirational, and measured it is not true today.**
 * `packages/renderer/src/pack-swap.test.ts` records what a swap actually moves
 * on the shipping panel: nothing at all with an empty session strip, and one
 * 240px chip per working session — which no longer enumerates it, because a
 * pack carrying a `logo` also moves the mark on the `typing` screen, and
 * `pack-swap.test.ts` does not measure that. How many pixels depends on the
 * mark; it is not written down here because the only one measured so far is in
 * a private pack and nobody else can reproduce the figure. The
 * palette's larger role is what quantises to it: the logo does, since 26 Aug,
 * and the pet sprite will.
 *
 * The schema below is `name`, `palette`, `quips`, an optional `birthday`, an
 * optional `logo`, an optional `pet` and an optional `scene`. Props land with the renderer. This line enumerates the
 * schema exhaustively on purpose, so adding a field without touching it is a
 * visible omission — and it has now caught two: `birthday` went in under the
 * wording that named only the first three, and `logo` went in under the
 * wording that named four and said a logo was not a field yet. Both were
 * correct when written and neither was updated by the commit that falsified
 * it, which is the failure this paragraph exists to make visible rather than
 * to prevent.
 */

import { rgb565 } from '@tamaclaude/protocol';
import { z } from 'zod';

const rgbChannel = z.number().int().min(0).max(255);

/**
 * Quips come in two tiers, and the distinction is the joke.
 *
 * `mapped` fires on a specific state — a failed turn, a permission request —
 * where the timing is what makes it land. `idle` surfaces rarely when nothing
 * is happening. Randomising a mapped quip wastes it.
 */
const quipsSchema = z.object({
  mapped: z.record(z.string(), z.string()),
  idle: z.array(z.string()),
});

/**
 * Days per month, with February at 29 so `02-29` stays legal.
 *
 * The leap-year question is deliberately not asked here: a `MM-DD` string has
 * no year to ask it of, and the one date where it matters is handled by
 * `isBirthday` rather than by refusing the pack.
 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Whether `MM-DD` names a day that occurs in some year. */
function dayExists(date: string): boolean {
  const month = Number(date.slice(0, 2));
  const day = Number(date.slice(3));
  return day <= (DAYS_IN_MONTH[month - 1] ?? 0);
}

/**
 * What a base64 payload looks like. Deliberately shape-only.
 *
 * A pack is hand-edited and is a genuine trust boundary, but this cannot check
 * that the bytes decode to a mark of the right size — that needs the codec,
 * which lives above this package. It rejects the obvious paste error and
 * leaves the rest to the renderer, which treats a bad payload as no logo.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

const packManifestSchema = z.object({
  name: z.string().min(1),
  // Two, not one. Entry 0 is the background and entry 1 is the ink; a pack
  // carrying only a background is schema-valid nonsense that renders an
  // entirely blank panel — every glyph and chip drawn in the background
  // colour, no error anywhere. The renderer deliberately will not invent a
  // colour a pack does not contain (`packages/renderer/src/band.ts`), so the
  // place to refuse it is here, at the boundary where untrusted input is
  // parsed, with a message that names the problem.
  palette: z
    .array(z.tuple([rgbChannel, rgbChannel, rgbChannel]))
    .min(2, 'a pack needs at least a background and an ink colour'),
  quips: quipsSchema,
  /**
   * The one day of the year the panel says something else.
   *
   * `MM-DD`, with no year, because a birthday recurs — a pack written for the
   * gift's first morning should still work on its fifth. The regex rejects
   * `9-23` and `2026-09-23` outright rather than coercing them, since a pack
   * that silently never fires is the failure that cannot be noticed until the
   * day has passed.
   *
   * **The same test is applied to the day, which the regex alone fails.**
   * `0[1-9]|[12]\d|3[01]` accepts `04-31`, `06-31`, `09-31`, `11-31`, `02-30`
   * and `02-31` — six dates that exist in no year at all and would therefore
   * do exactly what the paragraph above refuses. `dayExists` rejects them.
   *
   * `02-29` is kept, because it is a real birthday and rejecting it would be a
   * calendar judgement the schema has no business making. But accepting it and
   * then firing in one year out of four is the silent miss under another name,
   * so `isBirthday` falls back to 28 February in a common year — see there for
   * why the 28th and not the 1st.
   */
  birthday: z
    .object({
      date: z
        .string()
        .regex(
          /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u,
          'birthday.date must be MM-DD',
        )
        .refine(dayExists, 'birthday.date must be a day that exists'),
      quip: z.string().min(1),
    })
    .optional(),
  /**
   * A company mark for the laptop lid in `typing`, or nothing.
   *
   * **Pixels, not a picture.** The renderer's runtime dependencies are
   * `@tamaclaude/packs` and `@tamaclaude/protocol` and nothing else — there is
   * no image decoder anywhere in the shipping graph — so a pack cannot ship a
   * PNG or an SVG. What it can ship is what the sprites already are: RGB565
   * through `encodeRect`, base64 of a mode byte and its payload, plus a
   * separately encoded bit-mask saying which pixels are drawn.
   * `tools/logo2pixel.ts --format pack` writes both.
   *
   * **The lid, not the boot splash**, which is the one place a reader might
   * expect it. The splash is drawn by the firmware before the daemon is
   * running, and firmware is flashed rather than configured — so a splash
   * logo could not be a pack field at all.
   */
  logo: z
    .object({
      /**
       * **Bounded by the lid it is drawn on**, which is 84x20 device pixels —
       * `LID_SLOT` in `packages/renderer/src/logo.ts`, where the numbers come
       * from and where a test asserts these two agree. This package sits below
       * the renderer in the dependency order and cannot import them, so the
       * limits are repeated here and the drift is caught by that test rather
       * than by a mark drawn across Clawd's face.
       *
       * Refused rather than clipped: a clipped mark is a wrong mark shown
       * confidently, and the pack boundary is where a bad value should be
       * named.
       */
      width: z.number().int().min(1).max(84),
      height: z.number().int().min(1).max(20),
      /**
       * `.min(1)` because the empty string is valid base64 and decodes to
       * nothing, which `logo.ts` then treats as no logo at all — a pack that
       * looks configured and shows no mark, with no error anywhere. That is
       * the class of fault this boundary exists to name.
       */
      pixels: z.string().min(1).regex(BASE64, 'logo.pixels must be base64'),
      mask: z.string().min(1).regex(BASE64, 'logo.mask must be base64'),
    })
    .optional(),
  /**
   * The recipient's pet, asleep on the sand, or nothing.
   *
   * Same shape as `logo` and for the same reason — pixels rather than a
   * picture, because nothing in the shipping graph decodes an image.
   * `tools/logo2pixel.ts --format pack` writes this one too; it is not
   * logo-specific, it quantises any SVG to a pack's palette.
   *
   * **Unlike the logo it is not drawn on the character**, so it is bounded by
   * the stage rather than by a slot on him, and it is painted after him — over
   * him where they meet, which is what being in front means. An earlier
   * version of this bounded it to the sand the character never covers; that is
   * a rule for a prop drawn behind, and following it made the pet a quarter of
   * his width. `BUILD_PLAN.md` carries the numbers and the reversal.
   */
  pet: z
    .object({
      /**
       * **Bounded by the slot it stands in**, 60x42 device pixels — `PET_SLOT` in
       * `packages/renderer/src/pet.ts`, where the reasoning lives, with a test
       * there asserting these agree. This package sits below the renderer and cannot
       * import them, so the limits are repeated and the drift is caught by
       * that test.
       *
       * **Not the logo's bounds.** That field caps height at 20 and this one
       * is 42, so copying it refuses the art this field exists for.
       */
      width: z.number().int().min(1).max(60),
      height: z.number().int().min(1).max(42),
      /** `.min(1)` for the same reason as the logo's: see above. */
      pixels: z.string().min(1).regex(BASE64, 'pet.pixels must be base64'),
      mask: z.string().min(1).regex(BASE64, 'pet.mask must be base64'),
    })
    .optional(),
  /**
   * The rare scene, shown to somebody still working in the small hours.
   *
   * **The third piece of pack art, and the first that covers rather than
   * decorates.** `logo` marks the laptop lid and `pet` stands on the sand; this
   * replaces the stage picture outright while the desk is resting, which is why
   * `packages/cli/src/midnight.ts` restricts it to `IDLE` and `ASLEEP` — a
   * picture that *is* the stage must not take the stage away from work in
   * progress.
   *
   * **It is a pack field for the reason the logo and the pet are.** The scene
   * depicts two real people. `CLAUDE.md` is unconditional that a personal
   * detail does not enter a tracked file, so this repo carries the bounds, the
   * painter and the trigger, and the picture itself lives in a private pack.
   * `packs/example` has no scene and should never gain one.
   */
  scene: z
    .object({
      /**
       * **Bounded by the stage it covers**, 168x160 device pixels —
       * `COVER_SLOT` in `packages/renderer/src/cover.ts`, where the reasoning
       * lives, with a test there asserting these agree. This package sits below
       * the renderer and cannot import them, so the limits are repeated and the
       * drift is caught by that test.
       *
       * **Not the pet's bounds.** That field caps at 60x42 for a prop standing
       * in a corner of the sand; copying it here would refuse every picture
       * this field exists for. The pet's own comment records the same mistake
       * being made from the logo's bounds one field earlier.
       *
       * Smaller is allowed and costs less: a scene is centred in the stage
       * rather than required to fill it, so the pack author chooses what the
       * manifest carries. A full 168x160 is roughly fourteen times the pet's
       * pixel count.
       */
      width: z.number().int().min(1).max(168),
      height: z.number().int().min(1).max(160),
      /** `.min(1)` for the same reason as the logo's and the pet's. */
      pixels: z.string().min(1).regex(BASE64, 'scene.pixels must be base64'),
      mask: z.string().min(1).regex(BASE64, 'scene.mask must be base64'),
    })
    .optional(),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

/**
 * Parse an untrusted pack manifest.
 *
 * Packs are hand-edited by whoever owns the device — this is a genuine trust
 * boundary, not ceremony. Throws on invalid input rather than coercing.
 */
export function parsePackManifest(input: unknown): PackManifest {
  return packManifestSchema.parse(input);
}

/** Pre-pack a manifest's palette into the panel's native pixel format. */
export function packPalette(manifest: PackManifest): readonly number[] {
  return manifest.palette.map(([red, green, blue]) => rgb565(red, green, blue));
}

/**
 * Whether `now` falls on the pack's birthday, in the panel's own timezone.
 *
 * Local time, deliberately. The device sits on a desk and the day it should
 * celebrate is the day the person next to it is having, not UTC's. `new Date`
 * `getMonth`/`getDate` are host-local — `new Date(ms)` is not, it names an
 * absolute instant — so this lands on local midnight boundaries without any
 * timezone arithmetic. `vitest.config.ts` pins a zone that is off UTC for the
 * dates the tests use, because CI runs UTC and a local-vs-UTC test under UTC
 * is a tautology.
 *
 * A pack with no `birthday` is never a birthday, so the whole feature is opt-in
 * and the default pack behaves exactly as it did.
 *
 * **29 February falls back to the 28th in a common year.** The schema accepts
 * `02-29` because it is a real birthday; firing in one year out of four would
 * make that acceptance a silent miss, which is the failure the schema's own
 * comment refuses. The 28th rather than the 1st keeps a February birthday in
 * February, and the two failure modes are not symmetric: silence cannot be
 * noticed until the day has passed, while a fallback is at worst one day's
 * disagreement with a preference and is visible on the glass.
 */
export function isBirthday(pack: PackManifest, now: number): boolean {
  const { birthday } = pack;
  if (birthday === undefined) return false;
  const local = new Date(now);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  const today = `${month}-${day}`;
  if (today === birthday.date) return true;
  return birthday.date === '02-29' && today === '02-28' && !isLeapYear(local);
}

/** Whether this date's year has a 29 February. */
function isLeapYear(date: Date): boolean {
  const year = date.getFullYear();
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
