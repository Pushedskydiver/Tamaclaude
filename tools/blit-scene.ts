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
 * **Every tool that composes a _scene_ goes through here**, which is most of
 * Stage 2's exit and not all of it — see the qualification below. `BUILD_PLAN.md` makes that exit "browser and panel
 * show the same thing", and a review once caught this file claiming to satisfy
 * it while `tools/harness.ts` and `tools/panel-mock.ts` each composed their own
 * panel in browser CSS.
 *
 * It closed by deletion, not by bundling the renderer into a page. `panel-mock`
 * composes through this function and blits the pixels; `harness` stopped
 * drawing band contents at all. So no second path composes a *scene* — a
 * stronger guarantee than two paths agreeing, and it needs no bundler, no new
 * dependency and no build step.
 *
 * Whole *panels* are still drawn elsewhere on purpose — `bake-splash.ts` owns
 * the firmware's splash, `colour-bars.ts` is a test pattern — and two review
 * artefacts still paint a flat backdrop behind transparent frames.
 * `tools/panel-mock.ts`'s header lists all four; `BUILD_PLAN.md` carries the
 * two that are open rather than deliberate.
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
  SessionChip,
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
    /**
     * Chips for the strip band, when a caller wants to see it occupied.
     *
     * Defaults to none, which is what `tools/blit.ts` wants: it is showing an
     * animation on the device, not modelling a desk. `tools/panel-mock.ts`
     * passes some, because an empty strip is a 32px void in the landscape
     * right-hand column and a review artefact that can never show the band
     * populated cannot be used to judge it — which the CSS mock it replaced
     * could, and was the one thing that version did better.
     */
    readonly sessions?: readonly SessionChip[];
    /**
     * Message-band text, when the animation's own name is not the case worth
     * seeing. Defaults to the name, which is what the device-facing caller
     * wants.
     *
     * It exists because the band's height is an open question and the longest
     * string any artefact could otherwise show is `"permission-sign"`. A long
     * MCP tool name is the case the band has to survive, and the page that used
     * to display one wrapped it with CSS rather than with `wrapText`.
     */
    readonly message?: string;
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
      sessions: options.sessions ?? [],
      ...placeholderBands(options.message ?? options.name),
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
