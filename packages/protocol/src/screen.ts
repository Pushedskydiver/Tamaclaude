/**
 * Physical panel geometry, in pixels.
 *
 * The ST7789 on the Waveshare ESP32-C6-LCD-1.47 is 172 wide by 320 tall.
 * Everything downstream is sized from these two constants — nothing should
 * hard-code 172 or 320.
 */
export const SCREEN_WIDTH = 172;
export const SCREEN_HEIGHT = 320;
