/**
 * Palette quantisation for rasterised frames, and the cascade gate.
 *
 * Split out of `svg2frames.ts` to keep that file under its line limit. These
 * belong together: all four run inside the page rather than in Node, so none
 * of them may close over anything — Playwright serialises the function source
 * and evaluates it in a context where this module does not exist.
 */

/**
 * Colour the panel shows where nothing is drawn.
 *
 * The stage band is black, and frames are captured with `omitBackground` so
 * transparency survives to the harness. Snapping still needs to know what a
 * partly-transparent pixel is sitting on, because that is the colour it
 * actually becomes on the panel.
 */
export const BACKGROUND: readonly [number, number, number] = [0, 0, 0];

export type Rgb = readonly [number, number, number];

/**
 * Every colour an SVG is allowed to put on the panel.
 *
 * Solid fills, the background, and — separately — any fill that an element
 * declares at partial opacity, composited over the background. That last part
 * is the whole reason this is derived from the document rather than passed in.
 * Blending *every* fill with *every* opacity would manufacture tones halfway
 * between the real ones, and an antialiased edge pixel would then find a
 * legitimate-looking neighbour to snap to instead of resolving to one side.
 * That is the exact soft edge this function exists to remove, so only pairs
 * the artwork actually declares are admitted.
 */
export function paletteOf(svg: string): Rgb[] {
  const hex = (value: string): Rgb => [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
  const palette = new Map<string, Rgb>();
  const add = (colour: Rgb): void => {
    palette.set(colour.join(','), colour);
  };
  add(BACKGROUND);

  for (const [, value] of svg.matchAll(/fill\s*[:=]\s*"?(#[0-9a-fA-F]{6})/g)) {
    add(hex(value));
  }
  // Elements carrying both a fill and an opacity: the shadow is the case that
  // matters. Over a black stage it composites to black and vanishes, which is
  // what the panel already does; over a pack that sets a lighter stage it
  // stays a real tone, and snapping must not flatten it.
  for (const [, tag] of svg.matchAll(/<(\w+\b[^>]*)>/g)) {
    const fill = /fill="(#[0-9a-fA-F]{6})"/.exec(tag)?.[1];
    const opacity = Number(/\bopacity="([\d.]+)"/.exec(tag)?.[1]);
    if (fill === undefined || !Number.isFinite(opacity)) continue;
    const [r, g, b] = hex(fill);
    add([
      Math.round(r * opacity + BACKGROUND[0] * (1 - opacity)),
      Math.round(g * opacity + BACKGROUND[1] * (1 - opacity)),
      Math.round(b * opacity + BACKGROUND[2] * (1 - opacity)),
    ]);
  }
  return [...palette.values()];
}

/**
 * Quantise one captured frame to the palette, in the page.
 *
 * This is the step that lets an animation use easing, rotation and non-uniform
 * scale without going soft, and it is the single biggest difference between
 * these frames and upstream clawd-tank's. Chromium antialiases a rotated or
 * sub-pixel edge into a gradient; snapping each pixel to the nearest declared
 * colour collapses that gradient back onto one side or the other, so the edge
 * lands on a whole device pixel after the fact rather than being forbidden
 * from leaving it in the first place.
 *
 * The panel has no alpha, so alpha is decided here too: composite over the
 * background, snap, and a pixel that resolves to the background becomes
 * transparent. Anything else is fully opaque. Frames therefore stay
 * hard-edged whatever the downstream consumer does with them.
 */
export async function snapToPalette(input: {
  uri: string;
  palette: Rgb[];
  bg: Rgb;
}): Promise<{ uri: string; soft: number }> {
  const bitmap = await createImageBitmap(await (await fetch(input.uri)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0);

  // Nearest declared colour to one composited pixel, and whether it was
  // already exact. `exact` is only used for the report — it is the count of
  // pixels the rasteriser antialiased, which is the number worth watching.
  const nearest = (over: number[]): { colour: Rgb; exact: boolean } => {
    let colour = input.bg;
    let least = Infinity;
    let exact = false;
    for (const candidate of input.palette) {
      const distance =
        (over[0] - candidate[0]) ** 2 +
        (over[1] - candidate[1]) ** 2 +
        (over[2] - candidate[2]) ** 2;
      if (distance === 0) exact = true;
      if (distance < least) {
        least = distance;
        colour = candidate;
      }
    }
    return { colour, exact };
  };

  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  let soft = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const { colour, exact } = nearest(
      [0, 1, 2].map((c) => pixels[i + c] * alpha + input.bg[c] * (1 - alpha)),
    );
    if (!exact) soft += 1;
    // Transparency needs both the snapped colour *and* the captured alpha.
    //
    // Deciding it from the colour alone makes this a black colour key, which
    // is the one mechanism the sprite mask exists to avoid: the art's palette
    // contains black, so every eye, the mouth and the ground shadow became
    // transparent and the sprite rendered with holes through its face. That
    // shipped, and was invisible only because the pack background was also
    // black — on a lighter pack Clawd would have had windows for eyes.
    //
    // The captured alpha alone is not enough either. An antialiased edge over
    // nothing arrives part-opaque, composites to something dark, and snapping
    // resolves it to the background — drawing it would ring the sprite in a
    // black fringe, which is the antialiasing the snap exists to remove.
    //
    // So: transparent where it snapped to the background *and* the capture was
    // not fully opaque. A pixel drawn solidly in the background's own colour —
    // an eye — is opaque, and an edge that resolved to background is not.
    const isBackground = colour.every((value, c) => value === input.bg[c]);
    [pixels[i], pixels[i + 1], pixels[i + 2]] = colour;
    pixels[i + 3] = isBackground && pixels[i + 3] < 255 ? 0 : 255;
  }
  context.putImageData(data, 0, 0);
  return { uri: canvas.toDataURL('image/png'), soft };
}

/** Report how much of the corpus needed snapping, so a spike is visible. */
export function reportSnapping(soft: number, total: number): void {
  const percent = (100 * soft) / total;
  console.log(
    `palette-snapped ${percent.toFixed(2)}% of pixels (antialiased edges) -> 0%`,
  );
}

/**
 * Find animations that the cascade silently threw away.
 *
 * The `animation` shorthand *replaces*; it does not merge. An element named in
 * one rule and given its own rule below loses the first animation entirely, and
 * nothing else notices: the frames render, the loop is the right length, the
 * colours are right, and the motion that is missing was never going to be
 * missed by a check that does not know it was asked for.
 *
 * This shipped twice in `idle.svg`. Both times `#fx-mouth` was named in the
 * breathing rule and also given its own rule underneath, so it lost the
 * breathing and hung eight device pixels below the torso through the whole
 * yawn. Both times it was looked straight at and not seen. So it is a gate
 * rather than a discipline: every render compares what the stylesheet declares
 * against what the cascade actually applies, and reports the difference.
 */
export function shadowedAnimations(): string[] {
  // Flattened to (selector, names) pairs first, so the walk that follows is
  // two shallow loops instead of four nested ones. Nested rather than a
  // sibling function because Playwright serialises only the function it is
  // handed — a helper defined outside would not exist in the page.
  const rulesWithAnimation = (): { selector: string; names: string[] }[] => {
    const found: { selector: string; names: string[] }[] = [];
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule) || !rule.style.animationName)
          continue;
        const names = rule.style.animationName
          .split(',')
          .map((name) => name.trim());
        for (const selector of rule.selectorText.split(',')) {
          found.push({ selector: selector.trim(), names });
        }
      }
    }
    return found;
  };

  const declared = new Map<Element, string[]>();
  for (const { selector, names } of rulesWithAnimation()) {
    for (const element of document.querySelectorAll(selector)) {
      declared.set(element, [...(declared.get(element) ?? []), ...names]);
    }
  }

  const applied = (element: Element): string[] =>
    getComputedStyle(element)
      .animationName.split(',')
      .map((name) => name.trim());

  return [...declared]
    .filter(([, names]) => names.length > 1)
    .map(([element, names]) => {
      const kept = applied(element);
      const lost = names.filter((name) => !kept.includes(name));
      return lost.length > 0
        ? `${element.id || element.tagName}: ${lost.join(', ')}`
        : '';
    })
    .filter(Boolean);
}
