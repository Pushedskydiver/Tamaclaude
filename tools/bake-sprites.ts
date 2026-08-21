/**
 * Bake rasterised frames into modules the shipped packages can read.
 *
 *   node tools/bake-sprites.ts [name...]
 *
 * `svg2frames.ts` rasterises an animation into `out/<name>/frame_NNN.png`, and
 * `out/` is gitignored build output that nothing in `packages/` can reach — so
 * until now no animation could appear on the panel at all. This is the bridge:
 * it reads those PNGs and writes `packages/renderer/src/sprites/<name>.data.ts`.
 *
 * **Why generated source rather than a binary asset.** `tsc -b` emits JavaScript
 * and nothing else, so a `.bin` beside the source would never reach `dist/` —
 * shipping one means adding a copy step to the build, and `BUILD_PLAN.md`
 * already records what a repo-relative path does to an installed package. A
 * generated module has neither problem and it is the precedent already in the
 * tree: `packages/renderer/src/font-data.ts` is Departure Mono baked the same
 * way, by `tools/make-font-atlas.ts`, for the same reason.
 *
 * **The format, and why it is two encodings rather than one.** Measured across
 * all six animations, in bytes so the units cannot drift: 24,192,000 bytes of
 * raw RGB565 becomes 570,508 through the repo's own RLE codec — pixel art is
 * nearly all flat runs. The mask is the awkward half. It carries one bit of
 * information per pixel and arrives as one *byte* per pixel, so exactly half
 * the pixel cost at 12,096,000 bytes, and still 1,512,000 merely packed to a
 * bit. Running the same codec over the packed bytes takes it to 558,428.
 *
 * So 1,128,216 bytes for six animations — 21.4:1 against the pixels alone, or
 * 32:1 if the mask's own raw cost is counted, which the sentence above says it
 * should be. Size is not what limits how many animations this device gets.
 *
 * Each frame is one base64 string: a mode byte, then the payload. The mode is
 * the codec's own — `encodeRect` emits raw when RLE would be larger, and a
 * frame that is mostly noise would take that branch — so it has to travel with
 * the payload rather than be assumed.
 */
import type { Page } from 'playwright';

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import { encodeRect } from '@tamaclaude/protocol';

import { loadFrames } from './png-rgb565.ts';

/** Where the generated modules go. Read by `packages/renderer/src/sprites`. */
const OUT_DIR = 'packages/renderer/src/sprites';

/**
 * One bit per pixel, most significant bit first.
 *
 * The mask says which pixels are drawn at all — `svg2frames.ts` captures with
 * `omitBackground`, so a transparent pixel is one the pack's background shows
 * through. RGB565 has nowhere to put an alpha bit, which is why it travels
 * alongside rather than inside.
 */
function packMask(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(mask.length / 8));
  mask.forEach((bit, index) => {
    if (bit === 0) return;
    const at = index >> 3;
    out[at] = (out[at] ?? 0) | (0x80 >> (index & 7));
  });
  return out;
}

/** A mode byte followed by the payload, base64'd. */
function blob(mode: number, payload: Uint8Array): string {
  const out = new Uint8Array(payload.byteLength + 1);
  out[0] = mode;
  out.set(payload, 1);
  return Buffer.from(out).toString('base64');
}

/**
 * The packed mask, through the same codec as the pixels.
 *
 * The codec works in 16-bit words because that is what a framebuffer is, so the
 * packed bytes are viewed as words to get through it. An odd byte length would
 * lose its last byte to that view, so the buffer is padded first — a trailing
 * zero byte is a run of eight undrawn pixels past the end of the frame, which
 * nothing reads.
 */
function encodeMask(mask: Uint8Array): { mode: number; payload: Uint8Array } {
  const packed = packMask(mask);
  const even =
    packed.byteLength % 2 === 0 ? packed : Uint8Array.from([...packed, 0]);
  const words = new Uint16Array(
    even.buffer,
    even.byteOffset,
    even.byteLength / 2,
  );
  const encoded = encodeRect(words);
  return { mode: encoded.mode, payload: encoded.payload };
}

type Baked = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly string[];
  readonly masks: readonly string[];
};

function moduleSource(baked: Baked): string {
  const { name, width, height, pixels, masks } = baked;
  const list = (items: readonly string[]): string =>
    items.map((item) => `  '${item}',`).join('\n');
  return `/**
 * ${name}, baked from \`out/${name}\` by \`node tools/bake-sprites.ts\`.
 *
 * **Generated — do not edit by hand.** Re-bake it instead; the SVG in
 * \`assets/clawd/animations/${name}.svg\` is the source of truth and this is a
 * build artefact of it, the same way \`font-data.ts\` is of the font.
 *
 * Each entry is base64 of one frame: a mode byte, then the payload, for the
 * codec in \`@tamaclaude/protocol\`. \`sprites/index.ts\` is what turns them back
 * into pixels; nothing else should read these strings.
 */
export const WIDTH = ${String(width)};
export const HEIGHT = ${String(height)};

/** RGB565, one string per frame, in play order. */
export const PIXELS: readonly string[] = [
${list(pixels)}
];

/** One bit per pixel, packed and then encoded the same way. */
export const MASKS: readonly string[] = [
${list(masks)}
];
`;
}

async function bake(page: Page, name: string): Promise<void> {
  const dir = ['out/' + name, 'out/measure/' + name].find((one) =>
    existsSync(one),
  );
  if (dir === undefined) {
    throw new Error(
      `no rasterised frames for ${name} — run \`node tools/svg2frames.ts assets/clawd/animations/${name}.svg out/${name}\` first`,
    );
  }
  const frames = await loadFrames(page, dir);
  const first = frames[0];
  if (first === undefined) throw new Error(`no frames in ${dir}`);
  const width = first.frame.width;
  const height = first.frame.pixels.length / width;

  const pixels = frames.map((sprite) => {
    const encoded = encodeRect(sprite.frame.pixels);
    return blob(encoded.mode, encoded.payload);
  });
  const masks = frames.map((sprite) => {
    const encoded = encodeMask(sprite.mask);
    return blob(encoded.mode, encoded.payload);
  });

  await mkdir(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, `${name}.data.ts`);
  await writeFile(
    path,
    moduleSource({ name, width, height, pixels, masks }),
    'utf8',
  );
  const bytes = (await readFile(path)).byteLength;
  process.stdout.write(
    `  ${name.padEnd(12)} ${String(frames.length).padStart(3)} frames  ${width}x${height}  -> ${(bytes / 1024).toFixed(0)}KB of source\n`,
  );
}

/**
 * Rewrite the `SOURCES` table in `sprites/index.ts` to match what is baked.
 *
 * A template-literal `import()` would need no table. `knip` is why one exists
 * anyway: it cannot follow one, so it reports all six generated modules as
 * unused files and fails the gate — measured, not assumed. Vite is *not* the
 * reason, whatever an earlier version of this comment said: it accepts the
 * template literal and compiles it into a glob map of exactly this shape.
 *
 * So the table has to exist and has to stay in step with the files beside it.
 * Writing it here means adding an animation is one command rather than one
 * command and a thing to remember.
 */
async function writeTable(names: readonly string[]): Promise<void> {
  const path = resolve(OUT_DIR, 'index.ts');
  const source = await readFile(path, 'utf8');
  const table =
    'const SOURCES: Readonly<Record<SpriteName, () => Promise<Baked>>> = {\n' +
    names
      .map((name) => `  ${name}: () => import('./${name}.data.js'),`)
      .join('\n') +
    '\n};';
  const list =
    'export const SPRITE_NAMES = [\n' +
    names.map((name) => `  '${name}',`).join('\n') +
    '\n] as const;';
  const next = source
    .replace(/const SOURCES: [\s\S]*?\n\};/, table)
    .replace(/export const SPRITE_NAMES = \[[\s\S]*?\] as const;/, list);
  if (next !== source) {
    await writeFile(path, next, 'utf8');
    process.stdout.write(
      `  ${'index.ts'.padEnd(12)} table rewritten for ${String(names.length)} animations\n`,
    );
  }
}

/**
 * Reject a name that cannot be a filename and a key.
 *
 * `permission sign` is one of the three animations `BUILD_PLAN.md` Stage 4
 * schedules, and interpolated raw it writes a file called
 * `permission sign.data.ts` and an `index.ts` that does not parse — into a
 * hand-maintained file this tool edits rather than owns. Failing here costs a
 * rerun; failing there costs repairing a file the header says is maintained.
 *
 * It is also what lets the generated key stay unquoted, which matters because
 * prettier strips unnecessary quotes — a quoted key would be rewritten on the
 * next format and put the generator back out of step with the file it writes.
 */
function checked(name: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `animation name ${JSON.stringify(name)} is not usable — lower-case letters, digits and hyphens only, because it becomes both a filename and an object key`,
    );
  }
  return name;
}

/** Every animation with an SVG, unless the command line names some. */
async function chosen(): Promise<readonly string[]> {
  const named = process.argv.slice(2);
  if (named.length > 0) return named.map((name) => checked(name));
  const files = await readdir('assets/clawd/animations');
  return files
    .filter((file) => file.endsWith('.svg'))
    .map((file) => checked(basename(file, '.svg')))
    .sort();
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const names = await chosen();
  for (const name of names) await bake(page, name);
  // Only when baking everything: a partial run must not drop the others.
  if (process.argv.length <= 2) await writeTable(names);
} finally {
  await browser.close();
}
