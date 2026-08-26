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
    // mutant that used the width survived the suite. A band shorter than it is
    // wide separates them: 152 would give 5 and overflow the height, 100 gives
    // 3 and fits.
    const fb = buffer(320, 172);
    const short = { x: 168, y: 24, width: 152, height: 100 };
    const painted = paintQr(fb, short, { size: 21, modules: corner(21) });

    expect(painted?.height).toBe(87);
    expect(painted?.height).toBeLessThanOrEqual(short.height);
    expect(painted?.width).toBe(87);

    // And the other way round, because both real areas so far are wider than
    // they are tall — so a bare `height` reads identically to `min` and
    // survived too. Only a narrow, tall band separates all three.
    const narrow = { x: 0, y: 0, width: 100, height: 148 };
    const tall = paintQr(fb, narrow, { size: 21, modules: corner(21) });
    expect(tall?.width).toBe(87);
    expect(tall?.width).toBeLessThanOrEqual(narrow.width);
  });

  it('refuses to draw a symbol it cannot give whole pixels to', () => {
    const fb = buffer(320, 172);
    // 177 modules is QR version 40. Plus the quiet zone that is 185 across a
    // 148px band, so the pitch floors to zero: there is no drawing that could
    // be scanned, and a zero-pitch loop would silently paint nothing anyway.
    expect(paintQr(fb, area, { size: 177, modules: solid(177) })).toBeNull();
    expect(at(fb, 200, 90)).toBe(0x1234);
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
