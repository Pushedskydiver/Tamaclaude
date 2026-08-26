/**
 * The birthday QR, baked by
 * `node tools/bake-qr.ts https://alexclapperton.co.uk/j --ec L --write`.
 *
 * **Generated — do not edit by hand.** Re-bake it instead. The URL is the
 * source of truth and this is a build artefact of it, the way
 * `sprites/*.data.ts` are of their SVGs.
 *
 * One bit per module, MSB-first, row-major, base64. `qr.ts` reads it back;
 * nothing else should.
 *
 * Baked at version 2, EC L — 25 modules, which
 * `panelBands('landscape')` gives a 4px pitch.
 */

import type { QrCode } from './qr.js';

/** What the symbol encodes. Kept so `tools/bake-qr.test.ts` can re-encode it. */
export const BIRTHDAY_URL = 'https://alexclapperton.co.uk/j';

export const BIRTHDAY_QR: QrCode = {
  size: 25,
  modules:
    '/te/wWIQbrrrt1zl26Xa7BcRB/qq/gBDAM44l7AKxp7ezZ6LOGAwB3ynnEj/3ngyljbauf4AbUQ/j6oQWRH7ra/105+e6X6VBUL+/qkjgA==',
};
