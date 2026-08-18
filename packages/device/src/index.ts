/**
 * The physical panel: USB-CDC transport, and the firmware source.
 *
 * The firmware (`firmware/`, added in BUILD_PLAN Stage 2) is a dumb blitter.
 * It is flashed once and never changes. If a change to it seems necessary,
 * that is a strong signal the change belongs on the host instead.
 */

import type { Rect } from '@tamaclaude/protocol';

/**
 * Anything that can receive dirty rectangles.
 *
 * Implemented by the USB-CDC transport, the browser-canvas sink used in
 * development, and — if BUILD_PLAN Stage 3 allows — a TCP transport so a
 * remote host can drive the display.
 */
export type Transport = {
  /** Send one RLE-compressed RGB565 rectangle. */
  send(region: Rect, payload: Uint8Array): Promise<void>;
  close(): Promise<void>;
};
