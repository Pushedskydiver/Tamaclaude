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
  palette: z.array(z.tuple([rgbChannel, rgbChannel, rgbChannel])).min(1),
  quips: quipsSchema,
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
