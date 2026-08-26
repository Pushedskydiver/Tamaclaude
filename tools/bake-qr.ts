/**
 * Encode a URL as a QR module matrix, for the birthday screen.
 *
 *   node tools/bake-qr.ts <url> [--ec L|M|Q|H] [--write]
 *
 * Prints the geometry it would occupy on the panel, writes a 1:1 preview PNG
 * at the exact on-panel pitch, and with `--write` regenerates
 * `packages/renderer/src/qr.data.ts`.
 *
 * **Offline, and the encoder never ships.** `qrcode` is a root devDependency
 * like `playwright`; nothing under `packages/` imports it, and the renderer's
 * runtime dependencies stay at two workspace packages and zero third-party
 * ones. Reed-Solomon, mask selection and format bits are exactly the kind of
 * code that is wrong in a way no test written by its author would catch, and
 * the failure would surface on 23 September as a square that does not scan.
 *
 * **A matrix, not a raster.** The obvious route — author the QR as an SVG and
 * send it through `bake-sprites` — runs into the palette step:
 * `frame-palette.ts` reads declared fills as six-digit hex, so `fill="black"`
 * is not declared and the snapper has the wrong targets. Storing modules also
 * leaves the pixels-per-module a render-time number, so the same data draws at
 * 5px or 4px without re-baking.
 *
 * The preview is what settles the URL. Module size is the thing a camera
 * either resolves or does not, and it is not worth arguing about in a comment
 * when a phone can answer it in ten seconds.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import QRCode from 'qrcode';

import {
  MIN_SCANNABLE_PITCH,
  panelBands,
  QUIET_MODULES,
} from '../packages/renderer/src/layout.ts';

const DATA_PATH = 'packages/renderer/src/qr.data.ts';
const PREVIEW_PATH = 'out/qr-preview.png';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    ec: { type: 'string', default: 'M' },
    write: { type: 'boolean', default: false },
  },
});

const url = positionals.at(0);
if (url === undefined) {
  console.error('usage: node tools/bake-qr.ts <url> [--ec L|M|Q|H] [--write]');
  process.exit(1);
}

const level = values.ec.toUpperCase();
if (!['L', 'M', 'Q', 'H'].includes(level)) {
  console.error(`--ec ${values.ec}: expected one of L, M, Q, H`);
  process.exit(1);
}

const symbol = QRCode.create(url, {
  errorCorrectionLevel: level as 'L' | 'M' | 'Q' | 'H',
});
const size = symbol.modules.size;

// The region the birthday screen gives it: the strip and message bands, which
// the QR takes over for the day. Read from `panelBands` rather than written
// down, so a layout change moves this rather than silently misreporting.
const bands = panelBands('landscape');
const area = {
  width: bands.strip.width,
  height: bands.message.y + bands.message.height - bands.strip.y,
};
const across = size + QUIET_MODULES * 2;
const pitch = Math.floor(Math.min(area.width, area.height) / across);

console.log(`url      ${url}`);
console.log(
  `symbol   version ${String(symbol.version)}, ${String(size)} modules, EC ${level}`,
);
console.log(
  `area     ${String(area.width)}x${String(area.height)} (strip + message, landscape)`,
);
console.log(
  `pitch    ${String(pitch)} px/module -> block ${String(across * pitch)}px, symbol ${String(size * pitch)}px`,
);
if (pitch < MIN_SCANNABLE_PITCH) {
  console.log(
    `WARNING  a ${String(pitch)}px module is below anything proven to scan here; shorten the URL or drop the EC level`,
  );
}

// Row-major, MSB-first, one bit per module — the layout `qr.ts` reads back.
const bits = Buffer.alloc(Math.ceil((size * size) / 8));
for (let row = 0; row < size; row += 1) {
  for (let col = 0; col < size; col += 1) {
    if (!symbol.modules.get(row, col)) continue;
    const bit = row * size + col;
    bits[bit >> 3] |= 0x80 >> (bit & 7);
  }
}
const modules = bits.toString('base64');
console.log(`matrix   ${String(modules.length)} base64 chars`);

mkdirSync(dirname(resolve(PREVIEW_PATH)), { recursive: true });
await QRCode.toFile(resolve(PREVIEW_PATH), url, {
  errorCorrectionLevel: level as 'L' | 'M' | 'Q' | 'H',
  scale: Math.max(pitch, 1),
  margin: QUIET_MODULES,
  color: { dark: '#000000ff', light: '#ffffffff' },
});
// 247 PPI: sqrt(172^2 + 320^2) / 1.47in, from the panel in `docs/HARDWARE.md`.
const PANEL_PPI = 247;
const mm = (px: number): string => ((px / PANEL_PPI) * 25.4).toFixed(2);
console.log(
  `on glass ${mm(pitch)} mm per module, ${mm(across * pitch)} mm across`,
);
console.log(
  `preview  ${PREVIEW_PATH} at ${String(pitch)} image px/module — NOT life size`,
);

if (!values.write) {
  console.log('\n(dry run — pass --write to regenerate qr.data.ts)');
  process.exit(0);
}

writeFileSync(
  resolve(DATA_PATH),
  `/**
 * The birthday QR, baked by
 * \`node tools/bake-qr.ts ${url} --ec ${level} --write\`.
 *
 * **Generated — do not edit by hand.** Re-bake it instead. The URL is the
 * source of truth and this is a build artefact of it, the way
 * \`sprites/*.data.ts\` are of their SVGs.
 *
 * One bit per module, MSB-first, row-major, base64. \`qr.ts\` reads it back;
 * nothing else should.
 *
 * Baked at version ${String(symbol.version)}, EC ${level} — ${String(size)} modules, which
 * \`panelBands('landscape')\` gives a ${String(pitch)}px pitch.
 */

import type { QrCode } from './qr.js';

/** What the symbol encodes. Kept so \`tools/bake-qr.test.ts\` can re-encode it. */
export const BIRTHDAY_URL = '${url}';

export const BIRTHDAY_QR: QrCode = {
  size: ${String(size)},
  modules: '${modules}',
};
`,
);
console.log(`wrote    ${DATA_PATH}`);
