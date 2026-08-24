/**
 * Pack format: the entire customisation surface.
 *
 * A pack is a palette, a quip table, props and an optional logo. The character
 * is deliberately not part of it — Clawd is shared across packs and recoloured,
 * so there is one base geometry and one animation set. Swapping the pack
 * changes every screen without a rebuild or a reflash.
 *
 * The schema below is Stage 1's subset: `name`, `palette` and `quips`. Props
 * and logo land with the renderer.
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
   * `02-29` is accepted. It is a real birthday, and a schema that rejected it
   * would be making a calendar judgement it has no business making; the
   * comparison below simply never matches in a common year, which is the same
   * thing the calendar does.
   */
  birthday: z
    .object({
      date: z
        .string()
        .regex(
          /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u,
          'birthday.date must be MM-DD',
        ),
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
 * with a millisecond argument and `getMonth`/`getDate` are all host-local, so
 * this lands on local midnight boundaries without any timezone arithmetic.
 *
 * A pack with no `birthday` is never a birthday, so the whole feature is opt-in
 * and the default pack behaves exactly as it did.
 */
export function isBirthday(pack: PackManifest, now: number): boolean {
  const { birthday } = pack;
  if (birthday === undefined) return false;
  const local = new Date(now);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${month}-${day}` === birthday.date;
}
