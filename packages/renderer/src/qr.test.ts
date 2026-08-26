import type { Framebuffer } from './framebuffer.js';

import { describe, expect, it } from 'vitest';

import { moduleAt, paintQr } from './qr.js';

describe('reading a packed QR matrix', () => {
  it('reads bits MSB-first, row-major, across the byte boundary', () => {
    // A 3x3 matrix, so the nine bits straddle the first byte and land three
    // into the second — the case a row-major reader that forgets the row
    // stride gets wrong.
    //
    //   1 1 0
    //   0 0 0
    //   0 0 1
    //
    // 110000001 padded to 16 bits is 11000000 10000000 = 0xc0 0x80.
    //
    // **Asymmetric on purpose.** The first version of this used a diagonal,
    // which is its own transpose, so reading `col * size + row` passed it —
    // and a transposed QR is a QR that does not scan.
    const dark = new Set(['0,0', '1,0', '2,2']);
    const matrix = {
      size: 3,
      modules: Buffer.from([0xc0, 0x80]).toString('base64'),
    };
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        expect(moduleAt(matrix, col, row), `(${col},${row})`).toBe(
          dark.has(`${String(col)},${String(row)}`),
        );
      }
    }
  });
});

describe('painting a QR onto the panel', () => {
  const black = 0x0000;
  const white = 0xffff;
  const buffer = (w: number, h: number): Framebuffer => ({
    pixels: new Uint16Array(w * h).fill(0x1234),
    width: w,
    height: h,
  });
  const at = (fb: Framebuffer, x: number, y: number): number =>
    fb.pixels[y * fb.width + x] ?? -1;

  // The real region: the strip and message bands, which the birthday takes
  // over for the day. Hard-coded rather than derived, so a layout change that
  // shrinks it fails here instead of silently dropping the pitch.
  const area = { x: 168, y: 24, width: 152, height: 148 };

  it('centres the block and gives every module the same whole-pixel pitch', () => {
    const fb = buffer(320, 172);
    // 21 modules + 8 of quiet zone is 29; 148 / 29 floors to a 5px pitch, so
    // the block is 145x145 and there are 7px spare across and 3px down.
    // Exactly one dark module, at (0,0). An all-dark matrix cannot test the
    // pitch at all — every neighbour is dark too, so a 4px or 6px module reads
    // identically. The first version of this test used one and asserted a
    // white pixel one module across, which is the matrix being wrong rather
    // than the code.
    const painted = paintQr(fb, area, { size: 21, modules: corner(21) });

    expect(painted).toEqual({ x: 171, y: 25, width: 145, height: 145 });
    // Ground either side of the block is untouched.
    expect(at(fb, 170, 90)).toBe(0x1234);
    expect(at(fb, 316, 90)).toBe(0x1234);
    // The quiet zone is light, and it is four modules — so 20px in from the
    // block edge is still light and the 21st is the first dark module.
    expect(at(fb, 171 + 19, 25 + 19)).toBe(white);
    expect(at(fb, 171 + 20, 25 + 20)).toBe(black);
    // ...and that module is 5px wide, not 4 or 6: its last pixel is dark and
    // the next one, belonging to a light module, is not.
    expect(at(fb, 171 + 24, 25 + 20)).toBe(black);
    expect(at(fb, 171 + 25, 25 + 20)).toBe(white);
    expect(at(fb, 171 + 20, 25 + 25)).toBe(white);
  });

  it('takes the pitch from the shorter side, not the wider one', () => {
    // The real band is 152x148, and both floor to a 5px pitch at 21 modules —
    // so it cannot tell a `min(width, height)` from a bare `width`, and a
    // mutant that used either one alone survived the suite. Bands constrained
    // on one axis at a time separate all three. 120px gives a 4px pitch where
    // 148 or 152 would give 5, so a block sized from the wrong axis overflows.
    const fb = buffer(320, 172);
    const short = { x: 168, y: 24, width: 152, height: 120 };
    const wide = paintQr(fb, short, { size: 21, modules: corner(21) });
    expect(wide?.height).toBe(116);
    expect(wide?.height).toBeLessThanOrEqual(short.height);

    const narrow = { x: 0, y: 0, width: 120, height: 148 };
    const tall = paintQr(fb, narrow, { size: 21, modules: corner(21) });
    expect(tall?.width).toBe(116);
    expect(tall?.width).toBeLessThanOrEqual(narrow.width);
  });

  it('paints each module where the matrix says, not its transpose', () => {
    // **The one mutation the three-layer story missed.** Swapping the
    // arguments at `paintQr`'s one call to `darkIn` — `(matrix, row, col)`
    // instead of `(matrix, col, row)` — paints the transpose, and left all 599
    // tests green. Every layer looked past it:
    //
    // - `tools/bake-qr.test.ts` compares module by module, but through
    //   `moduleAt`, which is not on the paint path.
    // - the geometry tests here use `corner`, one module at (0,0), which is
    //   its own transpose.
    // - `scene.test.ts` used `0xaa` at an odd size, where dark-iff-even-bit
    //   makes the matrix transpose-invariant too.
    // - `jsqr` decodes a mirrored symbol, and a transpose is a mirror.
    //
    // So this reads the framebuffer back into a matrix and compares it to the
    // source. It is the only assertion in the repo that covers the code that
    // actually draws.
    const fb = buffer(320, 172);
    // **Dark iff the column is a multiple of three** — vertical stripes, which
    // become horizontal ones under transposition. Chosen after two fixtures
    // that looked asymmetric and were not: `corner` is a single module on the
    // diagonal, and `(col + 2*row) % 3 === 0` is invariant because
    // `col + 2*row ≡ 0 (mod 3)` forces `col ≡ row`, which makes `row + 2*col`
    // zero as well. The assertion below is what stops a third one.
    const size = 21;
    const dark = (col: number, _row: number): boolean => col % 3 === 0;

    // The fixture must actually distinguish a matrix from its transpose, or
    // this whole test is decoration. Two of the three tried so far did not.
    const asymmetric = (): boolean => {
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (dark(col, row) !== dark(row, col)) return true;
        }
      }
      return false;
    };
    expect(asymmetric(), 'fixture is its own transpose').toBe(true);
    const bits = Buffer.alloc(Math.ceil((size * size) / 8));
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (!dark(col, row)) continue;
        const bit = row * size + col;
        bits[bit >> 3] = (bits[bit >> 3] ?? 0) | (0x80 >> (bit & 7));
      }
    }
    const block = paintQr(fb, area, { size, modules: bits.toString('base64') });
    expect(block).not.toBeNull();
    if (block === null) return;

    const pitch = block.width / (size + 8);
    const originX = block.x + 4 * pitch;
    const originY = block.y + 4 * pitch;
    const wrong: string[] = [];
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        // Sample the middle of the module, so an off-by-one in the pitch is
        // not what this reports.
        const px = at(
          fb,
          originX + col * pitch + Math.floor(pitch / 2),
          originY + row * pitch + Math.floor(pitch / 2),
        );
        if ((px === 0x0000) !== dark(col, row)) {
          wrong.push(`${String(col)},${String(row)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('refuses to draw a symbol it cannot give whole pixels to', () => {
    const fb = buffer(320, 172);
    // 177 modules is QR version 40. Plus the quiet zone that is 185 across a
    // 148px band, so the pitch floors to zero.
    expect(paintQr(fb, area, { size: 177, modules: solid(177) })).toBeNull();
    expect(at(fb, 200, 90)).toBe(0x1234);

    // **And it refuses a pitch that is whole but unreadable.** Portrait gives
    // this area 172x96, where a 25-module symbol gets 2px modules — a square
    // no camera resolves, drawn over the strip and the message band. `null` is
    // what sends the caller back to the bands.
    const portraitArea = { x: 0, y: 224, width: 172, height: 96 };
    expect(
      paintQr(fb, portraitArea, { size: 25, modules: solid(25) }),
    ).toBeNull();
  });
});

/** Every module dark. Fine for "is anything drawn", useless for pitch. */
function solid(size: number): string {
  return Buffer.alloc(Math.ceil((size * size) / 8), 0xff).toString('base64');
}

/** Only the module at (0,0) dark, so a pitch assertion has a light neighbour. */
function corner(size: number): string {
  const bytes = Buffer.alloc(Math.ceil((size * size) / 8), 0x00);
  bytes[0] = 0x80;
  return bytes.toString('base64');
}
