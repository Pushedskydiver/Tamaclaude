/**
 * Pack format: the entire customisation surface.
 *
 * A pack is a palette, a quip table, props and an optional logo. The character
 * is deliberately not part of it — Clawd is shared across packs and recoloured,
 * so there is one base geometry and one animation set. Swapping the pack
 * changes every screen without a rebuild or a reflash.
 *
 * The schema below is `name`, `palette`, `quips` and an optional `birthday`.
 * Props and logo land with the renderer. This line enumerates the schema
 * exhaustively on purpose, so adding a field without touching it is a visible
 * omission — `birthday` was added under the previous wording, which named only
 * the first three and had been correct when written.
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
 * timezone arithmetic. The suite pins a non-UTC zone in `vitest.config.ts`,
 * because CI runs UTC and a local-vs-UTC test under UTC is a tautology.
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
