import type { PackManifest } from '@tamaclaude/packs';
import type { EnvironmentExtent, StageSprite } from '@tamaclaude/renderer';

import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { packPalette } from '@tamaclaude/packs';
import { encodeRect, frame } from '@tamaclaude/protocol';
import { spriteSlots } from '@tamaclaude/renderer';

import { composePanels } from './blit-scene.ts';

/**
 * `composePanels` has to pass `extent` through, because the plan and two
 * packages now tell a reader to use it.
 *
 * `BUILD_PLAN.md`, `packages/cli/src/daemon.ts` and
 * `packages/renderer/src/scene.ts` each send a reader to
 * `tools/panel-mock.ts --extent stage` to see the side the 22 Aug wiring
 * rejected. That instruction is what makes the extent cut a cut rather than a
 * deferral: it keeps the judgement re-checkable by looking.
 *
 * Nothing else would notice the option being dropped. Hardcode `'panel'` at
 * the `options.extent ?? 'panel'` in `blit-scene.ts` and every other test in
 * the repo stays green — 537 across 44 files, measured. `packages/renderer`
 * tests `render()` directly and never goes through this file, and no other
 * `tools/` test passes an extent. The flag would still parse, still validate,
 * still print a path — and draw the wrong panel.
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

function compose(extent: EnvironmentExtent | undefined) {
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

type Panel = ReturnType<typeof compose>;

function pixelAt(panel: Panel, x: number, y: number) {
  const value = panel.pixels[y * panel.width + x];
  if (value === undefined) throw new Error(`no pixel at ${x},${y}`);
  return value;
}

/**
 * A pixel to the right of the stage band, where only `panel` reaches.
 *
 * The **x** is what puts it outside the scenery under `stage`, not the y: the
 * slot is 168 wide on a 320-wide panel, so `width - 1` is 151px clear of its
 * right edge. The row is only two below the slot's last, and it sits inside
 * the message band — neither of which matters, but a later edit that moves
 * this sample vertically would be trusting the wrong reason.
 */
function pixelRightOfStage(panel: Panel) {
  return pixelAt(panel, panel.width - 1, SLOT.y + SLOT.height + 1);
}

/** A pixel in the middle of the stage band, where both extents paint. */
function pixelInStage(panel: Panel) {
  return pixelAt(
    panel,
    SLOT.x + Math.floor(SLOT.width / 2),
    SLOT.y + Math.floor(SLOT.height / 2),
  );
}

describe('composePanels threads the extent option', () => {
  it('paints scenery inside the stage band under `stage`', () => {
    // The positive control, and the assertion the rest of this file needs to
    // mean anything: every "is still the pack background" below is satisfied
    // by a renderer that draws no scenery at all. `pack-swap.test.ts` names
    // the same trap about its own zeroes. Make `withEnvironment` return the
    // painter unchanged for `stage` and this is what goes red.
    expect(pixelInStage(compose('stage'))).not.toBe(packPalette(PACK)[0]);
  });

  it('leaves the pack background outside the stage under `stage`', () => {
    // The defining property of `stage`: scenery is confined to the slot, so
    // what is left is `clearToPackBackground`'s fill.
    expect(pixelRightOfStage(compose('stage'))).toBe(packPalette(PACK)[0]);
  });

  it('covers that same pixel with scenery under `panel`', () => {
    expect(pixelRightOfStage(compose('panel'))).not.toBe(packPalette(PACK)[0]);
  });

  it('defaults to `panel`, which is what the daemon sets', () => {
    expect(pixelRightOfStage(compose(undefined))).toBe(
      pixelRightOfStage(compose('panel')),
    );
  });
});

describe('the pack mark, through composePanels', () => {
  // **The three lines that meet Stage 5's exit, gated.** `BUILD_PLAN.md` says
  // the exit is "met rather than argued" because `panel-mock` draws a
  // pack-supplied mark — and the wiring that does it was covered by nothing. A
  // review changed `'typing'` to `'thinking'` in `markFor` and all six gates
  // stayed green, so the exit could stop being met with no signal at all.
  //
  // `packages/cli/src/daemon.test.ts` gates the identical decision for the
  // daemon. The tool got the wiring and not the test.
  const MARK = 0xf81f;

  /** A logo the renderer will accept: every pixel drawn, one colour. */
  function solidLogo(width: number, height: number): PackManifest['logo'] {
    const words = new Uint16Array(width * height).fill(MARK);
    const bits = new Uint8Array(Math.ceil((width * height) / 8)).fill(0xff);
    const padded = new Uint8Array(Math.ceil(bits.length / 2) * 2);
    padded.set(bits);
    const blob = (from: Uint16Array): string => {
      const { mode, payload } = encodeRect(from);
      const bytes = new Uint8Array(payload.length + 1);
      bytes[0] = mode;
      bytes.set(payload, 1);
      return Buffer.from(bytes).toString('base64');
    };
    return {
      width,
      height,
      pixels: blob(words),
      mask: blob(new Uint16Array(padded.buffer)),
    };
  }

  const withLogo: PackManifest = { ...PACK, logo: solidLogo(12, 14) };

  function marked(name: string, pack: PackManifest): number {
    const [panel] = composePanels([BLANK], {
      orientation: 'landscape',
      pack,
      name,
    });
    if (panel === undefined) return -1;
    return [...panel.pixels].filter((value) => value === MARK).length;
  }

  it('draws a pack logo on typing and on nothing else', () => {
    expect(marked('typing', withLogo)).toBe(12 * 14);
    for (const name of ['thinking', 'gym', 'idle', 'bouldering']) {
      expect(marked(name, withLogo), name).toBe(0);
    }
  });

  it('draws nothing for a pack that carries no logo', () => {
    // Every pack but the recipient's. The placeholder square in the artwork
    // shows through, as it always did.
    expect(marked('typing', PACK)).toBe(0);
  });
});
