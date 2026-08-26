/**
 * The birthday QR, baked by `node tools/bake-qr.ts <url> --write`.
 *
 * **Generated — do not edit by hand.** Re-bake it instead. The URL is the
 * source of truth and this is a build artefact of it, the way
 * `sprites/*.data.ts` are of their SVGs.
 *
 * One bit per module, MSB-first, row-major, base64. `qr.ts` reads it back;
 * nothing else should.
 *
 * Baked at version 3, EC Q — 29 modules, which
 * `panelBands('landscape')` gives a 4px pitch.
 */

import type { QrCode } from './qr.js';

/** What the symbol encodes. Kept so `tools/bake-qr.test.ts` can re-encode it. */
export const BIRTHDAY_URL = 'https://alexclapperton.co.uk/j';

export const BIRTHDAY_QR: QrCode = {
  size: 29,
  modules:
    '/ssz/BaD0G60ALt1p2XbrV0uwQcJB/qqr+AYPwBrafL9BzB4W8JqHzksnSz6DbQmeseMSxcU5yU+4upPTknuWjLirxlGoM7VOmml/QBpTEf76erwS2kSurSvzdJMZC695GsFpbov5L3JgA==',
};
