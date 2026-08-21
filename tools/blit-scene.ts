/**
 * Compose animation rasters into whole panels.
 *
 * `tools/blit.ts` used to send the sprite alone: it cropped a frame to the
 * safe area, worked out where the stage slot was, and blitted that rectangle.
 * The status, strip and message bands never existed on the device at all.
 *
 * This routes the same rasters through `render()` instead, which is the same
 * function the harness draws with. That is the whole point — `BUILD_PLAN.md`
 * makes Stage 2's exit "browser and panel show the same thing", and the only
 * way to mean it is for both to come out of one renderer rather than two
 * pipelines that agree by inspection.
 *
 * It also deletes arithmetic rather than adding it. Slot placement and the
 * landscape safe-area crop are `paintStage`'s job, and having them here as
 * well was a second copy of a rule that had already been got wrong once.
 */
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame } from '@tamaclaude/protocol';
import type { Orientation, Scene, StageSprite } from '@tamaclaude/renderer';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parsePackManifest } from '@tamaclaude/packs';
import { frame } from '@tamaclaude/protocol';
import { render } from '@tamaclaude/renderer';

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
 * elsewhere. The clock is real because a wrong clock is obvious and a
 * hard-coded one is not.
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
  },
): readonly Frame[] {
  const bands = placeholderBands(options.name);
  return rasters.map((raster) => {
    const panel = render({
      orientation: options.orientation,
      layout: 'hero',
      pack: options.pack,
      sprites: [raster],
      sessions: [],
      ...bands,
    });
    return frame(panel.pixels, panel.width);
  });
}
