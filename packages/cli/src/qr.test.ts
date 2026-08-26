/**
 * The birthday QR, read back out of the panel the daemon would push.
 *
 * Every other test about this feature asserts that pixels are where the code
 * puts them. None can tell whether the code puts them in the right place: a
 * transposed, mirrored or mis-masked symbol renders as a perfectly plausible
 * QR and scans as nothing at all, and the failure would surface on one
 * specific morning with no way to fix it.
 *
 * So this composes the real scene through the real `render`, widens the
 * framebuffer to RGBA, and hands it to a decoder that has never seen this
 * repo. `jsqr` is a root devDependency; the
 * shipping graph is untouched.
 *
 * **It proves less than it looks like it proves, and one of those gaps was
 * closable.** Real decoders are tolerant. `jsqr` reads a photographic negative
 * by default, so the mutant that swapped dark and light survived this file
 * until `inversionAttempts: 'dontInvert'` was passed; it dies here now. It
 * also reads a mirrored symbol, and a transposed matrix is exactly that — no
 * option turns that off, so transposition dies in
 * `tools/bake-qr.test.ts` instead, which compares module by module against a
 * fresh encode. Geometry lives in `renderer/src/qr.test.ts`. This is the
 * end-to-end check, not the only one.
 *
 * What it does *not* prove at all is that a phone can read it off the glass.
 * That is a question about a 4px module at 247 PPI and a camera, and only the
 * panel can answer it. `tools/bake-qr.ts` prints the physical size — 0.41mm
 * per module — and writes a preview, which is not life size: no monitor is
 * 247 PPI.
 */
import jsqr from 'jsqr';
import { describe, expect, it } from 'vitest';

import { createRegistry, observe } from '@tamaclaude/daemon';
import { parsePackManifest } from '@tamaclaude/packs';
import { BIRTHDAY_QR, loadSprite, render } from '@tamaclaude/renderer';

import { sceneFor } from './daemon.js';

const URL_IN_THE_SYMBOL = 'https://alexclapperton.co.uk/j';

/**
 * The decoder, reached through `.default`.
 *
 * `jsqr`'s UMD bundle sets `module.exports = factory()`, and the factory
 * returns the function — so `module.exports.default === module.exports` and
 * both are callable. TypeScript types the import as the namespace, which has
 * no call signature, so the bare `jsqr(...)` does not compile; `.default` does,
 * and is the same function.
 *
 * An earlier draft asserted this away with `as unknown as` and a restated
 * four-parameter signature, which needed an `eslint-disable` for `max-params`
 * and claimed `.default` "does not exist at runtime". It does — a review
 * checked, and `.default` typechecks and runs.
 */
const decode = jsqr.default;

/**
 * Read the symbol as it is painted, with no inversion pass.
 *
 * `jsqr` tries the negative by default, which means a panel drawing light
 * modules dark decodes perfectly — and the mutant that swapped the two colours
 * survived this file until this option was passed. The panel is not a photo of
 * a QR; it either paints the symbol or it does not.
 */
const AS_PAINTED = { inversionAttempts: 'dontInvert' } as const;

const PACK = parsePackManifest({
  name: 'qr-test',
  palette: [
    [40, 40, 72],
    [248, 236, 208],
    [232, 148, 88],
    [104, 60, 104],
  ],
  quips: { mapped: {}, idle: [] },
  birthday: { date: '09-23', quip: 'happy birthday' },
});

/**
 * The framebuffer as RGBA.
 *
 * **Not the same algorithm as `tools/rgb565-rgba.ts`**, which replicates bits
 * (`(r << 3) | (r >> 2)`) and says why: plain scaling darkens every colour by
 * up to 3%. The two disagree on 14 of 96 channel values. That is irrelevant
 * to a symbol whose only colours are 0x0000 and 0xffff, which both map to 0
 * and 255 either way — but an earlier draft claimed this converted "exactly
 * as" the display path, and it does not.
 */
function rgba(pixels: Uint16Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const v = pixels[i] ?? 0;
    out[i * 4] = (((v >> 11) & 0x1f) * 255) / 31;
    out[i * 4 + 1] = (((v >> 5) & 0x3f) * 255) / 63;
    out[i * 4 + 2] = ((v & 0x1f) * 255) / 31;
    out[i * 4 + 3] = 255;
  }
  return out;
}

async function panelAt(animation: 'birthday' | 'idle'): Promise<{
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}> {
  const now = new Date(2026, 8, 23, 10, 0, 1).getTime();
  const registry = observe(
    createRegistry(now),
    { sessionId: 's', kind: 'Stop' },
    now,
  );
  const sprites = (await loadSprite(animation)).slice(8, 9);
  const target = render(
    sceneFor({ registry, pack: PACK, now, sprites, animation }),
  );
  return {
    data: rgba(target.pixels),
    width: target.width,
    height: target.height,
  };
}

describe('the QR the panel actually paints', () => {
  it('decodes back to the URL it was baked from', async () => {
    const panel = await panelAt('birthday');
    const found = decode(panel.data, panel.width, panel.height, AS_PAINTED);
    expect(found?.data).toBe(URL_IN_THE_SYMBOL);
  });

  it('is absent when the animation is not the birthday', async () => {
    // The same instant and the same pack — only the animation differs. So this
    // says `sceneFor` keys the QR off the animation rather than off the date.
    // It does **not** exercise `animationForPanel`, which is what decides that
    // animation; an earlier draft claimed it did. The per-state coverage of
    // that decision is `daemon.test.ts`'s `BIRTHDAY_COVERS` table, which has a
    // row per state. And "any other screen" here is one screen: `idle`.
    const panel = await panelAt('idle');
    expect(
      decode(panel.data, panel.width, panel.height, AS_PAINTED),
    ).toBeNull();
  });

  it('is the symbol the baked data claims, at the size it claims', () => {
    // Guards the pair: a matrix whose `size` disagrees with its bit count
    // decodes as nothing, and the two are written by the same tool from the
    // same symbol, so nothing else would notice them drifting apart.
    expect(BIRTHDAY_QR.size).toBe(25);
    expect(Buffer.from(BIRTHDAY_QR.modules, 'base64').length).toBe(
      Math.ceil((25 * 25) / 8),
    );
  });
});
