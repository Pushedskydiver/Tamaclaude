/**
 * Wire format and pixel primitives.
 *
 * This package is the root of the dependency graph and imports nothing. It
 * defines the vocabulary every other package speaks: panel geometry, the
 * native pixel format, dirty rectangles, and the shape of a Claude Code hook
 * event as it travels to the daemon.
 */

/**
 * Physical panel geometry, in pixels. The ST7789 on the Waveshare
 * ESP32-C6-LCD-1.47 is 172 wide by 320 tall. Everything downstream is sized
 * from these two constants — nothing should hard-code 172 or 320.
 */
export const SCREEN_WIDTH = 172;
export const SCREEN_HEIGHT = 320;

/** A dirty rectangle: the unit of everything we send to the device. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * A Claude Code hook event, as forwarded by `@tamaclaude/hooks` to the daemon.
 *
 * `tool` is present only for tool-scoped events (`PreToolUse`); it is the
 * `tool_name` field Claude Code supplies, and it is what the daemon maps to an
 * animation.
 */
export type HookEvent = {
  readonly sessionId: string;
  readonly kind: string;
  readonly tool?: string;
};

/**
 * Pack 8-bit RGB into a 16-bit RGB565 word — the panel's native pixel format.
 *
 * Five bits red, six green (the eye is most sensitive to green), five blue.
 * The low bits of each channel are discarded rather than dithered: at 172x320
 * with pixel art, banding is not observable and dithering would wreck the RLE
 * compression ratio that the USB budget depends on.
 */
export function rgb565(red: number, green: number, blue: number): number {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
}

/** Number of pixels a rectangle covers. */
export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}
