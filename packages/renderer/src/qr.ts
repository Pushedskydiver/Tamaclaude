/**
 * Drawing a QR code onto the panel.
 *
 * **A packed module matrix, not a raster.** The alternative was to author the
 * QR as an SVG and send it through `bake-sprites`, and that path has a trap in
 * it: `tools/frame-palette.ts` reads declared fills with `/#[0-9a-fA-F]{6}/`
 * (lines 46 and 54), so `fill="black"` is not a declared colour at all and the
 * snapper has the wrong targets for every pixel in the symbol. What exactly it
 * would produce is untested — the point is that a QR is the one raster where
 * being approximately right is worth nothing, and the palette step exists to
 * be approximately right.
 *
 * Storing modules also keeps the pixels-per-module a *render-time* number, so
 * the pitch can change with the space available without re-baking anything.
 *
 * The matrix is one bit per module, MSB-first, row-major, base64-encoded. The
 * symbol this ships is 29x29: 841 bits in 106 bytes, which is 144 base64
 * characters — small enough to sit in a source file without anyone minding.
 * (An earlier draft gave the version-1 figures instead. The arithmetic was
 * right and the symbol was not the one in `qr.data.ts`.)
 */

import type { Framebuffer } from './framebuffer.js';
import type { Rect } from '@tamaclaude/protocol';

import { fillRect } from './draw.js';

/** A QR symbol as its module matrix. `modules` is base64, MSB-first, row-major. */
export type QrCode = {
  /** Modules per side. 21 for version 1, 25 for version 2, and so on. */
  readonly size: number;
  readonly modules: string;
};

/**
 * The quiet zone the QR specification requires, in modules, on every side.
 *
 * Four, and not negotiable downwards here even though many scanners tolerate
 * two. The panel's ground is the pack's darkest colour, so a symbol drawn with
 * too little margin has no border at all from the camera's point of view —
 * and the failure is total rather than degraded: a QR either decodes or does
 * not.
 */
const QUIET_MODULES = 4;

/**
 * The two colours, fixed rather than taken from the pack.
 *
 * **A deliberate exception to the rule `band.ts` states** — "the renderer will
 * not invent a colour the pack does not contain" — and the only one. A QR is a
 * machine-readable target, not decoration: a pack whose darkest and lightest
 * entries are two mid-tones would produce a symbol that looks right on the
 * glass, raises no error anywhere, and cannot be decoded, on the one day of the
 * year the panel has something to say that the picture alone cannot.
 */
const DARK = 0x0000;
const LIGHT = 0xffff;

/** A decoded matrix. Bytes and side length travel together — see `darkIn`. */
type Unpacked = { readonly bytes: Uint8Array; readonly size: number };

/** Whether the module at `(col, row)` is dark. Out-of-range reads are light. */
export function moduleAt(qr: QrCode, col: number, row: number): boolean {
  return darkIn(unpack(qr), col, row);
}

/**
 * `qr.modules` as bytes, with its side length.
 *
 * One object rather than two arguments because `darkIn` would otherwise take
 * four and `max-params` is three — and the pair is genuinely one thing: bytes
 * without the stride cannot be indexed at all.
 *
 * Called once per paint. An earlier draft decoded inside `moduleAt`, which put
 * a base64 decode on every one of the 841 modules this symbol has, every
 * frame.
 */
function unpack(qr: QrCode): Unpacked {
  return {
    bytes: new Uint8Array(Buffer.from(qr.modules, 'base64')),
    size: qr.size,
  };
}

function darkIn(matrix: Unpacked, col: number, row: number): boolean {
  const { bytes, size } = matrix;
  if (col < 0 || row < 0 || col >= size || row >= size) return false;
  const bit = row * size + col;
  const byte = bytes[bit >> 3];
  if (byte === undefined) return false;
  return (byte & (0x80 >> (bit & 7))) !== 0;
}

/**
 * Draw `qr` centred in `area`, and return the block it filled — or `null` if
 * the area cannot give every module a whole pixel.
 *
 * **Whole pixels or nothing.** A fractional pitch means some modules are one
 * pixel wider than their neighbours, which is exactly the distortion a decoder
 * fails on, and it fails silently: the symbol still looks like a QR. Flooring
 * the pitch and centring the remainder costs a few pixels of margin and keeps
 * every module identical.
 *
 * Returning the rect rather than nothing so a caller can tell whether the QR
 * took the space — the message band cannot also draw there, and a caller that
 * assumed it had is how two things end up on top of each other.
 */
export function paintQr(
  target: Framebuffer,
  area: Rect,
  qr: QrCode,
): Rect | null {
  const across = qr.size + QUIET_MODULES * 2;
  const pitch = Math.floor(Math.min(area.width, area.height) / across);
  if (pitch < 1) return null;

  const side = across * pitch;
  const block = {
    x: area.x + Math.floor((area.width - side) / 2),
    y: area.y + Math.floor((area.height - side) / 2),
    width: side,
    height: side,
  };
  // The quiet zone is drawn, not assumed. The panel's ground is the pack's
  // background and is usually dark, so an undrawn margin is no margin.
  fillRect(target, block, LIGHT);

  const matrix = unpack(qr);
  const originX = block.x + QUIET_MODULES * pitch;
  const originY = block.y + QUIET_MODULES * pitch;
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (!darkIn(matrix, col, row)) continue;
      fillRect(
        target,
        {
          x: originX + col * pitch,
          y: originY + row * pitch,
          width: pitch,
          height: pitch,
        },
        DARK,
      );
    }
  }
  return block;
}
