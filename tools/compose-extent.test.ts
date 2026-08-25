import type { PackManifest } from '@tamaclaude/packs';
import type { StageSprite } from '@tamaclaude/renderer';

import { describe, expect, it } from 'vitest';

import { packPalette } from '@tamaclaude/packs';
import { frame } from '@tamaclaude/protocol';
import { spriteSlots } from '@tamaclaude/renderer';

import { composePanels } from './blit-scene.ts';

/**
 * `composePanels` has to pass `extent` through, because four files now say it
 * does.
 *
 * `BUILD_PLAN.md`, `docs/ANIMATION.md`, `packages/cli/src/daemon.ts` and
 * `packages/renderer/src/scene.ts` all tell a reader to run
 * `tools/panel-mock.ts --extent stage` to see the side the 22 Aug wiring
 * rejected — that instruction is the only reason the extent cut is a cut
 * rather than a deferral, since it is what makes the judgement re-checkable.
 *
 * Nothing else would notice the option being dropped. Hardcode `'panel'` at
 * the `options.extent ?? 'panel'` in `blit-scene.ts` and every other test in
 * the repo stays green: `packages/renderer` tests `render()` directly and
 * never goes through this file, and no other `tools/` test passes an extent.
 * The flag would still parse, still validate, still print a path — and draw
 * the wrong panel. That is the same shape as the four animations that shipped
 * with holes for eyes, which also failed by rendering something plausible.
 */
const PACK: PackManifest = {
  name: 'test',
  palette: [
    [13, 17, 23],
    [201, 209, 217],
    [247, 120, 73],
    [63, 185, 80],
  ],
  quips: { mapped: {}, idle: [] },
};

const SLOT = spriteSlots('hero', 'landscape')[0];
if (SLOT === undefined) throw new Error('no hero slot');

/**
 * The authored raster height: the slot plus the rows `composePanels` crops.
 *
 * Hardcoded because `cropRows` is private to `blit-scene.ts`, and safe to
 * hardcode because `composePanels` validates it and throws with both numbers
 * — a stale constant here fails loudly rather than passing quietly.
 */
const AUTHORED_HEIGHT = 200;

/** Transparent, so every lit pixel is scenery or band rather than sprite. */
const BLANK: StageSprite = {
  frame: frame(new Uint16Array(SLOT.width * AUTHORED_HEIGHT), SLOT.width),
  mask: new Uint8Array(SLOT.width * AUTHORED_HEIGHT),
};

function compose(extent: 'stage' | 'panel' | undefined) {
  const [panel] = composePanels([BLANK], {
    orientation: 'landscape',
    pack: PACK,
    name: 'idle',
    time: 'day',
    ...(extent === undefined ? {} : { extent }),
  });
  if (panel === undefined) throw new Error('composePanels returned nothing');
  return panel;
}

/** A row well below the stage slot, so it is outside the scenery under `stage`. */
function pixelBelowStage(panel: ReturnType<typeof compose>) {
  const x = panel.width - 1;
  const y = SLOT.y + SLOT.height + 1;
  const value = panel.pixels[y * panel.width + x];
  if (value === undefined) throw new Error('sampled outside the panel');
  return value;
}

describe('composePanels threads the extent option', () => {
  it('leaves the pack background outside the stage under `stage`', () => {
    // The defining property of `stage`: scenery is confined to the slot, so
    // what is left is `clearToPackBackground`'s fill.
    expect(pixelBelowStage(compose('stage'))).toBe(packPalette(PACK)[0]);
  });

  it('covers that same pixel with scenery under `panel`', () => {
    expect(pixelBelowStage(compose('panel'))).not.toBe(packPalette(PACK)[0]);
  });

  it('defaults to `panel`, which is what the daemon sets', () => {
    expect(pixelBelowStage(compose(undefined))).toBe(
      pixelBelowStage(compose('panel')),
    );
  });
});
