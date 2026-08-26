import { Buffer } from 'node:buffer';

import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';

import { BIRTHDAY_QR, BIRTHDAY_URL } from '../packages/renderer/src/qr.data.ts';
import { moduleAt } from '../packages/renderer/src/qr.ts';

describe('the baked birthday QR', () => {
  it('decodes back to the symbol the URL encodes to', () => {
    // **The one check that matters, and the only one that can be made without
    // a camera.** Every other test in this repo asserts that the pixels are
    // where the code puts them; none of them can tell whether the code is
    // putting them in the right place, because a QR with its rows and columns
    // swapped is still a plausible-looking QR. Re-encoding from the URL and
    // comparing module by module is what catches a transposed, mirrored or
    // bit-reversed matrix — all of which render beautifully and scan not at
    // all.
    const expected = QRCode.create(BIRTHDAY_URL, {
      errorCorrectionLevel: 'Q',
    }).modules;

    expect(BIRTHDAY_QR.size).toBe(expected.size);
    const wrong: string[] = [];
    for (let row = 0; row < expected.size; row += 1) {
      for (let col = 0; col < expected.size; col += 1) {
        // `qrcode` indexes (row, col); `moduleAt` takes (col, row). Getting
        // this pair the wrong way round is exactly the defect being hunted, so
        // the call sites are deliberately spelled differently.
        // `get` returns 0 or 1, not a boolean — comparing it to one directly
        // makes every module mismatch and looks like a catastrophic packing
        // bug rather than a test bug, which is how the first run read.
        if (
          moduleAt(BIRTHDAY_QR, col, row) !== Boolean(expected.get(row, col))
        ) {
          wrong.push(`${String(col)},${String(row)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is packed MSB-first, so the first module is the top bit of byte zero', () => {
    // Pins the encoding itself rather than its round trip. Both sides of the
    // test above are written by me, so a consistently wrong bit order passes
    // it; this asserts against the format the renderer's own doc block
    // promises.
    const bytes = Buffer.from(BIRTHDAY_QR.modules, 'base64');
    expect(bytes.length).toBe(
      Math.ceil((BIRTHDAY_QR.size * BIRTHDAY_QR.size) / 8),
    );
    expect(moduleAt(BIRTHDAY_QR, 0, 0)).toBe(((bytes[0] ?? 0) & 0x80) !== 0);
    // A finder pattern's top-left module is always dark, in every QR ever
    // made — so this also says the matrix is not upside down or all-zero.
    expect(moduleAt(BIRTHDAY_QR, 0, 0)).toBe(true);
  });
});
