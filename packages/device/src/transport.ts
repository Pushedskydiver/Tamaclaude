/**
 * Anything that can receive dirty rectangles.
 *
 * Implemented by the USB-CDC transport in `panel.ts`, and — if BUILD_PLAN
 * Stage 3 allows — by a TCP transport so a remote host can drive the display.
 */

import type { LinkStatus } from './link.js';
import type { Encoded, Rect } from '@tamaclaude/protocol';

export type Transport = {
  /**
   * Send one encoded RGB565 rectangle.
   *
   * Takes the `Encoded` from `encodeRect` rather than a bare payload because
   * the encoding mode lives in the packet header, and a transport handed only
   * the bytes cannot build one. Framing is the transport's job; choosing the
   * rectangle and compressing it is the caller's — which is also what keeps
   * diffing and RLE off the frame budget, where they would surface as jitter.
   *
   * **This never rejects because the device is gone.** Losing the panel is an
   * expected condition on a desk toy: the bytes are dropped, `status()` says
   * so, and the caller carries on. It resolves when the bytes have left the
   * host, so awaiting it is the backpressure.
   */
  send(region: Rect, encoded: Encoded): Promise<void>;
  /**
   * **When `status().needsPrime` is set, send the frame you are currently on,
   * not the first one.** The transport cannot check this: it sees rectangles,
   * and which frame they belong to is yours to know.
   *
   * `tools/blit.ts` got it wrong on hardware. Re-priming with frame 0 while
   * the diff sequence continued from wherever it had reached left every
   * subsequent update painting onto the wrong base — 120 of 300 frames wrong,
   * and visible only as a stripe of a yawn hanging above a resting Clawd.
   *
   * The durable fix is to give this type the frames rather than the rects, so
   * the current frame is the only one it could prime with. That waits for a
   * caller; until then the rule lives here, where a caller will read it.
   */
  /** What the sender needs to know before the next frame. */
  status(): LinkStatus;
  close(): Promise<void>;
};
