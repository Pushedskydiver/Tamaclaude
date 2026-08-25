/**
 * Anything that can receive dirty rectangles.
 *
 * Implemented by the USB-CDC transport in `panel.ts`, and by nothing else.
 * Stage 3's TCP item — cut on 25 Aug — would not have been a second
 * implementation either: it carried session events from a remote agent
 * *towards* the daemon, the opposite direction to this type. A TCP
 * `Transport` would mean a remote panel, which nobody has asked for.
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
   *
   * **When `status().needsPrime` is set, send the frame you are currently on,
   * not the first one.** This transport cannot check it: it sees rectangles,
   * and which frame they belong to is yours to know.
   *
   * `tools/blit.ts` got it wrong on hardware. Re-priming with frame 0 while
   * the diff sequence continued from wherever it had reached left every
   * subsequent update painting onto the wrong base — 120 of 300 ticks wrong,
   * and visible only as a stripe of a yawn hanging above a resting Clawd.
   *
   * The durable fix is to give this type the frames rather than the rects, so
   * the current frame is the only one it could prime with. That waits for a
   * caller; until then the rule lives on the method it constrains. An earlier
   * attempt put it in its own block above `status()`, where TypeScript bound
   * it to nothing at all and no hover ever showed it.
   */
  send(region: Rect, encoded: Encoded): Promise<void>;
  /** What the sender needs to know before the next frame. */
  status(): LinkStatus;
  close(): Promise<void>;
};
