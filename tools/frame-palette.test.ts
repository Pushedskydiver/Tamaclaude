/**
 * Does a drawn pixel in the background's own colour survive the snap?
 *
 * This exists because it did not. `snapToPalette` decided transparency from
 * the *snapped colour* alone — transparent iff it landed on the background —
 * which made the whole pipeline a black colour key. The art's palette contains
 * black, so every eye, the mouth and the ground shadow came out transparent,
 * and the sprite mask that consumes this alpha punched holes through Clawd's
 * face. It shipped, and was invisible only because the pack background was
 * also black; on a lighter pack he would have had windows for eyes.
 *
 * The irony is worth recording: the mask was introduced specifically because a
 * colour key cannot work here, and it was then fed by a colour key.
 *
 * End-to-end through the real script rather than against a copy of the rule,
 * because the rule lives inside a function that is serialised into a browser
 * and cannot be imported.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * A black square inside a transparent margin, at one device pixel per unit of
 * the 2x2 square. Both cases in one frame: ink that happens to be the
 * background colour, and background that genuinely is not drawn.
 */
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"
     width="32" height="32" data-loop-seconds="1">
  <defs><style>#ink { animation: nudge 1s infinite steps(1); }
    @keyframes nudge { 0% { opacity: 1 } 50% { opacity: 1 } }</style></defs>
  <rect id="ink" x="1" y="1" width="2" height="2" fill="#000000"/>
</svg>`;

let pixels: Uint8ClampedArray;
let width = 0;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const svg = join(dir, 'fixture.svg');
  writeFileSync(svg, FIXTURE);
  execFileSync(
    process.execPath,
    [resolve(ROOT, 'tools/svg2frames.ts'), svg, dir],
    {
      stdio: 'ignore',
    },
  );
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // `readFileSync`, not `base64` the command: its flags differ between macOS
  // and the Linux runner, which is a portable-looking way to fail only in CI.
  const png = readFileSync(join(dir, 'frame_00.png')).toString('base64');
  const uri = `data:image/png;base64,${png}`;
  const decoded = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    return { pixels: [...data.data], width: canvas.width };
  }, uri);
  await browser.close();
  pixels = Uint8ClampedArray.from(decoded.pixels);
  width = decoded.width;
}, 60_000);

function alphaAt(x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3];
}

describe('palette snapping', () => {
  it('keeps a drawn black pixel opaque', () => {
    // Centre of the square: unambiguously ink, and unambiguously the same
    // colour as the background it sits on.
    expect(alphaAt(width / 2, width / 2)).toBe(255);
  });

  it('leaves undrawn background transparent', () => {
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(width - 1, width - 1)).toBe(0);
  });

  it('resolves alpha to fully on or fully off, never between', () => {
    // The panel has no alpha channel, so anything in between would be a
    // decision deferred to whoever composites next.
    for (let index = 3; index < pixels.length; index += 4) {
      expect([0, 255]).toContain(pixels[index]);
    }
  });
});
