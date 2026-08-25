import type { Rgb } from './frame-palette.ts';

/**
 * The colours a piece of artwork declares, in document order, de-duplicated.
 *
 * Deliberately not `paletteOf` from `tools/frame-palette.ts`. That answers
 * "what may legally reach the panel" for an animation frame, so it injects the
 * transparent ground and composites every fill at its element's opacity. Asked
 * of a logo it would report a collision against a ground the logo never draws,
 * and it cannot tell a logo's own `#000000` from the ground it injects.
 *
 * Hex fills only. `fill="none"` and named colours are skipped rather than
 * guessed at: a wrong colour in a collision report is worse than a missing
 * one, because the report exists to be believed.
 */
export function declaredFills(svg: string): Rgb[] {
  const found = new Map<string, Rgb>();
  for (const [, value] of svg.matchAll(/fill\s*[:=]\s*"?(#[0-9a-fA-F]{6})/g)) {
    const colour: Rgb = [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ];
    found.set(colour.join(','), colour);
  }
  return [...found.values()];
}

/**
 * The nearest palette entry to a colour, by squared distance in RGB.
 *
 * The same metric `snapToPalette` uses, so a report built from this describes
 * the bake that actually happens rather than a second opinion about it. Plain
 * RGB rather than a perceptual space for exactly that reason: matching the
 * quantiser matters more here than being right about human vision.
 */
export function nearestIn(colour: Rgb, palette: readonly Rgb[]): Rgb {
  let best: Rgb | undefined;
  let least = Infinity;
  for (const candidate of palette) {
    const distance =
      (colour[0] - candidate[0]) ** 2 +
      (colour[1] - candidate[1]) ** 2 +
      (colour[2] - candidate[2]) ** 2;
    if (distance < least) {
      least = distance;
      best = candidate;
    }
  }
  if (best === undefined) throw new Error('cannot snap to an empty palette');
  return best;
}

/** Distinct source colours that a palette cannot tell apart. */
export type Collision = {
  readonly target: Rgb;
  readonly sources: readonly Rgb[];
};

/**
 * Where a palette merges colours the source kept separate.
 *
 * A four-entry pack palette cannot represent an arbitrary logo, and the way
 * that fails is silent: two marks land on one entry and one of them disappears
 * into the other. Nothing errors, the PNG is written, and the loss is only
 * visible by looking at the output next to the input.
 *
 * Duplicates among the sources are not collisions — most SVGs reuse a fill —
 * so the sources are de-duplicated before grouping.
 */
export function collisions(
  sources: readonly Rgb[],
  palette: readonly Rgb[],
): readonly Collision[] {
  const distinct = new Map<string, Rgb>();
  for (const source of sources) distinct.set(source.join(','), source);

  const grouped = new Map<string, { target: Rgb; sources: Rgb[] }>();
  for (const source of distinct.values()) {
    const target = nearestIn(source, palette);
    const key = target.join(',');
    const entry = grouped.get(key) ?? { target, sources: [] };
    entry.sources.push(source);
    grouped.set(key, entry);
  }
  return [...grouped.values()].filter((entry) => entry.sources.length > 1);
}
