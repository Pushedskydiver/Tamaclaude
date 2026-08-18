/**
 * Pack 8-bit RGB into a 16-bit RGB565 word — the panel's native pixel format.
 *
 * Five bits red, six green (the eye is most sensitive to green), five blue.
 * The low bits of each channel are discarded rather than dithered: at 172x320
 * with pixel art, banding is not observable and dithering would wreck the RLE
 * compression ratio that the USB budget depends on.
 *
 * Every channel is masked. Blue was not, and `rgb565(0, 0, 524288)` returned
 * 65536 — outside 16 bits — while negative blue returned -1.
 */
export function rgb565(red: number, green: number, blue: number): number {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | ((blue & 0xf8) >> 3);
}
