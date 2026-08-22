/**
 * Compose animation rasters into whole panels.
 *
 * `tools/blit.ts` used to send the sprite alone: it cropped a frame to the
 * safe area, worked out where the stage slot was, and blitted that rectangle.
 * The status, strip and message bands never existed on the device at all.
 *
 * This routes the same rasters through `render()` instead, so the panel is
 * composed by the renderer rather than by this file.
 *
 * **It is not yet what the harness draws with, and Stage 2's exit is not met.**
 * `BUILD_PLAN.md` makes that exit "browser and panel show the same thing", and
 * a review caught this file claiming to satisfy it. `tools/harness.ts` imports
 * only the layout helpers and has its own browser-side draw — its own header
 * says so: "Text layout within a band is this page's approximation." So the
 * two agree by inspection, which is exactly what the criterion is written to
 * rule out, and the gap widened here: the panel now draws 2x bitmap status
 * text that no browser view renders at all.
 *
 * Closing it means bundling the renderer into the harness page so both ends
 * call this same function. That is the remaining Stage 1 work, not this.
 *
 * It also deletes arithmetic rather than adding it. Slot placement and the
 * landscape safe-area crop are `paintStage`'s job, and having them here as
 * well was a second copy of a rule that had already been got wrong once.
 */
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame } from '@tamaclaude/protocol';
import type {
  EnvironmentExtent,
  Orientation,
  Scene,
  StageSprite,
  TimeOfDay,
} from '@tamaclaude/renderer';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parsePackManifest } from '@tamaclaude/packs';
import { frame } from '@tamaclaude/protocol';
import {
  castsShadow,
  render,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from '@tamaclaude/renderer';

/** Rows the stage crops off the top, in device pixels. */
function cropRows(orientation: Orientation): number {
  return orientation === 'landscape'
    ? safeAreaCropUnits() * stageScale('hero')
    : 0;
}

/** Load and validate a pack manifest from its directory. */
export async function loadPack(dir: string): Promise<PackManifest> {
  const raw = await readFile(resolve(dir, 'manifest.json'), 'utf8');
  return parsePackManifest(JSON.parse(raw));
}

/**
 * Placeholder band content, so the bands can be seen to work.
 *
 * The daemon owns all of this in Stage 3 — a real clock, real session chips,
 * the quip for the current state. Until then the panel would show three empty
 * bands and there would be no way to tell "correct and empty" from "not drawn
 * at all", which is exactly the ambiguity the splash exists to avoid
 * elsewhere.
 *
 * Called per frame, so the clock actually ticks. It used to be read once and
 * baked into every panel for the life of the run, under a comment claiming it
 * was "real because a wrong clock is obvious and a hard-coded one is not" — it
 * was hard-coded after the first second, and the comment was the only thing
 * saying otherwise. Costing one dirty rect a minute is worth a placeholder
 * that cannot quietly become a lie.
 */
function placeholderBands(name: string): Pick<Scene, 'status' | 'message'> {
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`;
  return { status: { left: clock, right: 'x0' }, message: name };
}

/**
 * Render every animation raster into a full-panel framebuffer.
 *
 * Returns `Frame`s rather than `Framebuffer`s because everything downstream —
 * `dirtyRect`, `extractRect` — speaks that, and the height is implied by the
 * pixel count.
 */
export function composePanels(
  rasters: readonly StageSprite[],
  options: {
    readonly orientation: Orientation;
    readonly pack: PackManifest;
    readonly name: string;
    /**
     * Which sky to compose against, for judging an animation in context.
     *
     * `BUILD_PLAN.md` calls judging animations against a black stage "judging
     * them in the wrong context", and until the daemon started passing an
     * environment there was no context to judge in. It is an option rather
     * than the clock because the thing worth checking is a pale prop against
     * `day` and the same prop against `night` — a tool that only ever showed
     * the current hour could not show you the pair.
     */
    readonly time?: TimeOfDay;
    readonly extent?: EnvironmentExtent;
  },
): readonly Frame[] {
  // The crop `paintStage` applies is derived from the *layout's* scale, and
  // `layout.ts` warns in `safeAreaCropUnits`' own docstring that consumers
  // must use the scale they are actually drawing at. `tools/blit.ts` accepts
  // an arbitrary directory of PNGs and `tools/svg2frames.ts` takes a scale
  // argument, so the two can genuinely disagree — a scale-4 raster would lose
  // forty rows instead of twenty and be drawn small in the corner of its slot,
  // silently. The version of this that lived in `blit.ts` derived the crop
  // from the raster's own height and could not be fooled; deleting it traded
  // that away, so the check moves here where the raster's size is known.
  const slot = spriteSlots('hero', options.orientation)[0];
  const authored = {
    width: slot.width,
    height: slot.height + cropRows(options.orientation),
  };
  for (const raster of rasters) {
    const height = raster.frame.pixels.length / raster.frame.width;
    if (raster.frame.width !== authored.width || height !== authored.height) {
      throw new Error(
        `frames are ${raster.frame.width}x${height}, but a ${options.orientation} ` +
          `hero stage expects ${authored.width}x${authored.height} — were they ` +
          'rendered at a different scale?',
      );
    }
  }
  return rasters.map((raster) => {
    const panel = render({
      orientation: options.orientation,
      layout: 'hero',
      pack: options.pack,
      sprites: [raster],
      sessions: [],
      ...placeholderBands(options.name),
      environment: {
        time: options.time ?? 'day',
        extent: options.extent ?? 'panel',
        // Same rule the daemon applies: `bouldering` is on a wall.
        contact: castsShadow(options.name),
      },
    });
    return frame(panel.pixels, panel.width);
  });
}
