/**
 * What `tools/blit.ts` prints while it streams.
 *
 * Split out to keep that file under its line limit. The boundary is real
 * enough: nothing here touches the wire or the pixels, it only turns counters
 * into sentences.
 */
import type { Plan, Totals, Window } from './blit-types.ts';
import type { Rect } from '@tamaclaude/protocol';

import { FPS } from './blit-types.ts';

// ── Reporting ─────────────────────────────────────────────────────

function human(bytesPerSecond: number): string {
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

/** What the stream will cost, before any of it is sent. */
export function describe(name: string, origin: Rect, plan: Plan): void {
  const sizes = plan.loop.map((update) => update?.bytes.byteLength ?? 0);
  const changed = sizes.filter((size) => size > 0);
  const mean = changed.reduce((sum, size) => sum + size, 0) / sizes.length;
  console.log(
    `${name}: ${sizes.length} frames of ${origin.width}x${origin.height} at ` +
      `panel ${origin.x},${origin.y} (${plan.orientation})\n` +
      `  priming frame ${plan.prime.bytes.byteLength} B | mean ` +
      `${Math.round(mean)} B/frame | worst ${Math.max(0, ...sizes)} B | ` +
      `${sizes.length - changed.length} unchanged\n` +
      `  at ${FPS}fps that is ${human(mean * FPS)}`,
  );
  if (changed.length === 0) {
    console.warn(
      'warning: no frame differs from the one before it — after the priming ' +
        'frame this will send nothing at all',
    );
  }
}

/**
 * One line a second: enough to see a stall the moment it starts.
 *
 * `lag` is the part that distinguishes the two failures that look alike. A
 * device that reads slowly blocks our write, the frame deadline passes, and
 * the fps figure sags — but so does a host that is merely busy. Lag is
 * measured from the schedule, so it says how far behind the stream has fallen
 * rather than how fast it managed to go, and it does not recover on its own
 * the way an averaged rate does. A link that keeps up holds it at 0.
 *
 * If the lines stop altogether, the write itself is blocked: the device has
 * stopped reading and its rx buffer is full.
 */
export function reportWindow(window: Window, totals: Totals): void {
  const seconds = Number(process.hrtime.bigint() - window.since) / 1e9;
  const mean = window.frames > 0 ? window.bytes / window.frames : 0;
  console.log(
    `  ${String(totals.frames).padStart(6)} frames | ` +
      `${(window.frames / seconds).toFixed(1).padStart(4)} fps | ` +
      `${String(Math.round(mean)).padStart(5)} B/frame | ` +
      `${human(window.bytes / seconds).padStart(10)} | ` +
      `lag ${String(Math.round(window.lag)).padStart(4)} ms | ` +
      `${(totals.bytes / 1024).toFixed(0)} KB total`,
  );
}

export function summarise(totals: Totals, start: bigint): void {
  if (totals.frames === 0) return;
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.log(
    `\n${totals.frames} frames in ${seconds.toFixed(1)}s -> ` +
      `${(totals.frames / seconds).toFixed(2)} fps, ${totals.bytes} bytes, ` +
      `${human(totals.bytes / seconds)}` +
      (totals.still > 0 ? ` (${totals.still} needed no update)` : ''),
  );
}
