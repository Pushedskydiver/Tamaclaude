import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePackManifest } from '@tamaclaude/packs';

const TOOLS = resolve(import.meta.dirname);

/**
 * Files allowed to name a pack colour, and why each one is.
 *
 * An allowlist rather than a ban, because two of these genuinely have to draw
 * a panel and the third has to put *something* behind a transparent frame. The
 * point is that adding a fourth is a deliberate edit to this list rather than
 * a thing nobody notices.
 */
const ALLOWED = new Map([
  [
    'contact-sheet.ts',
    'a flat backdrop for transparent frames, and it says so — the sheet judges' +
      ' motion, not context',
  ],
  [
    'harness.ts',
    'same: a backdrop behind sprite slots, on a page that draws no bands',
  ],
  [
    'bake-splash.test.ts',
    'fixture constants for the splash SVG, which is baked art that genuinely' +
      ' uses the pack colours',
  ],
  [
    'one-panel-renderer.test.ts',
    'this file, which has to name the colours to look for them',
  ],
]);

/**
 * Source with comments removed, because a hex in prose is not a hardcode.
 *
 * `tools/panel-mock.ts` names both colours in its header while describing the
 * defect it removed, and flagging that would make the gate a thing to argue
 * with rather than obey. Deliberately crude — it does not know about hexes
 * inside string literals that contain `//` — and that is the safe direction:
 * it can only ever report more than it should, never less.
 */
function code(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');
}

/**
 * The invariant `BUILD_PLAN.md`'s Stage 1 entry claims, as a grep.
 *
 * **This is the check that was missing.** `tools/panel-mock.ts` hardcoded
 * `#0d1117` and `#c9d1d9` — `packs/example` palette entries 0 and 1, copied by
 * hand — so a pack swap changed the device and not the artefact reviewers
 * looked at. It was fixed on 25 Aug, and in the same commit `contact-sheet.ts`
 * was found still holding the identical hardcode, having survived three review
 * passes. Nothing failed, because nothing was looking.
 *
 * `CLAUDE.md` names this shape directly: a rule that depends on someone
 * remembering to check "got skipped three times after that — because running
 * the grep was itself something to remember. The command is the grep."
 *
 * The colours are read from the pack rather than written here, so this cannot
 * drift from the palette it is protecting.
 */
describe('no tool quietly hardcodes a pack colour', () => {
  it('finds pack palette hexes only in files that declare why', async () => {
    const manifest = parsePackManifest(
      JSON.parse(
        await readFile(
          resolve(TOOLS, '../packs/example/manifest.json'),
          'utf8',
        ),
      ),
    );
    const hexes = manifest.palette.map(
      ([r, g, b]) =>
        `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')}`,
    );
    const names = (await readdir(TOOLS)).filter((name) => name.endsWith('.ts'));
    const offenders: string[] = [];
    for (const name of names) {
      if (ALLOWED.has(name)) continue;
      const source = code(await readFile(resolve(TOOLS, name), 'utf8'));
      const found = hexes.filter((hex) => source.toLowerCase().includes(hex));
      if (found.length > 0) offenders.push(`${name}: ${found.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest about which files exist', async () => {
    // An entry for a deleted file is the failure mode that turns an allowlist
    // into a place things go to be forgotten.
    const names = new Set(await readdir(TOOLS));
    expect([...ALLOWED.keys()].filter((name) => !names.has(name))).toEqual([]);
  });
});
