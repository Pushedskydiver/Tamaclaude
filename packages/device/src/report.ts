/**
 * What the device says back.
 *
 * `packages/protocol` defines everything the host sends and nothing that comes
 * the other way, because in one sense nothing does — the blitter is a sink.
 * What it emits instead is a status line, prefixed `#` so a host that never
 * reads can ignore it:
 *
 *     # rects 812 resync 0/0 abort 0 panel 320x172 landscape
 *
 * That is a second wire format, defined by
 * `packages/device/firmware/blitter/main/main.c` and by nothing else, so
 * parsing it is the whole of the contract on this side. It earns a module with
 * tests rather than a regex inside a send loop, because it carries the two
 * things the host cannot work out for itself: whether the device has lost
 * anything, and what its firmware was built for.
 *
 * The firmware only emits a line when a counter has moved, so a device that
 * has received nothing says nothing. Everything below is therefore reachable
 * only after the host has written at least one packet — including, awkwardly,
 * the orientation check, which is why that check cannot happen at connect.
 */

/**
 * The four numbers the firmware keeps, exactly as `main.c` names them.
 *
 * `dropped` is bytes discarded while hunting for a header, not packets.
 */
export type Counters = {
  readonly rects: number;
  readonly resyncs: number;
  readonly dropped: number;
  readonly aborts: number;
};

export type DeviceReport = Counters & {
  readonly width: number;
  readonly height: number;
  /** The word the firmware prints — `landscape` or `portrait` today. */
  readonly orientation: string;
};

/** A device that has told us nothing yet, and a freshly booted one. */
export const NO_COUNTERS: Counters = {
  rects: 0,
  resyncs: 0,
  dropped: 0,
  aborts: 0,
};

const REPORT =
  /^# rects (\d+) resync (\d+)\/(\d+) abort (\d+) panel (\d+)x(\d+) (\w+)$/;

/**
 * Read one status line, or `undefined` if it is not one.
 *
 * Anchored, and deliberately strict. `tools/blit.ts` matched the counters
 * loosely from anywhere in the line, which was right for a script whose only
 * consumer was a person reading the log. Here the result drives re-priming and
 * a refusal to run, so a line this end has misread is worse than one it
 * rejects: the caller can say "the format has drifted" about a rejection, and
 * cannot say anything at all about a misread. The firmware is flashed once and
 * never changes, so strictness costs nothing.
 */
export function parseReport(line: string): DeviceReport | undefined {
  const found = REPORT.exec(line.trim());
  if (!found) return undefined;
  const [, rects, resyncs, dropped, aborts, width, height, orientation] = found;
  return {
    rects: Number(rects),
    resyncs: Number(resyncs),
    dropped: Number(dropped),
    aborts: Number(aborts),
    width: Number(width),
    height: Number(height),
    orientation,
  };
}

/** Counters that only ever climb while the device stays up. */
const ALL = ['rects', 'resyncs', 'dropped', 'aborts'] as const;

/** Counters whose climbing means a packet was destroyed. */
const DAMAGE = ['resyncs', 'dropped', 'aborts'] as const;

/**
 * Has the device lost anything since we last looked?
 *
 * Two separate signals, and the second is the one that is easy to miss.
 *
 * Any of `resync`, `dropped` or `abort` moving **up** means a packet was
 * destroyed. From that moment every diff the host sends is being applied to
 * content the device never received, so the panel holds a stale frame with
 * fragments painted on it and never converges again. Only a whole frame
 * recovers it.
 *
 * Any counter moving **down** means the device reset — a brownout, a watchdog,
 * a replug — and everything the host believes about its panel is stale.
 * `tools/blit.ts` tested `!==` on resync and abort alone, which catches a reset
 * only if one of them was already non-zero; the common case is a healthy device
 * at 0/0/0 whose reset is invisible to that test. `rects` is the counter that
 * is actually moving on a healthy link, so watching it fall is what makes a
 * reset detectable at all.
 */
export function lostGround(previous: Counters, next: Counters): boolean {
  return (
    ALL.some((key) => next[key] < previous[key]) ||
    DAMAGE.some((key) => next[key] > previous[key])
  );
}

export type LineSplit = {
  readonly lines: readonly string[];
  readonly pending: string;
};

/**
 * The most unterminated text we will hold before giving up on it.
 *
 * `packages/daemon` bounds a connection for the same reason and says it best:
 * a line reader cannot bound a line that never ends. The daemon's peer is a
 * hook we wrote; this one is whatever is plugged into a `/dev/cu.*` path from
 * a config value, and a device that emits bytes without a newline would grow
 * the remainder forever. At the measured 562.5 KB/s that is about two
 * gigabytes an hour.
 *
 * A real status line is well under 200 characters, so this is generous by an
 * order of magnitude and no honest report can trip it.
 */
const MAX_PENDING = 4096;

/**
 * Cut complete lines out of a stream, keeping whatever is left over.
 *
 * The device's lines arrive in whatever chunks USB hands us, so a status line
 * routinely straddles two reads. Holding the remainder is the difference
 * between seeing every report and seeing the ones that happen to land whole.
 *
 * Past `MAX_PENDING` the remainder is dropped rather than carried. It is not a
 * line by then, and the next newline resynchronises us — the same trade the
 * firmware makes when it discards to find a header. Strictly the fragment
 * between the drop and that newline is still emitted as one line; it is
 * harmless because `parseReport` is anchored and rejects anything that does
 * not start with the report prefix.
 */
export function splitLines(pending: string, chunk: string): LineSplit {
  const parts = (pending + chunk).split('\n');
  const remainder = parts.at(-1) ?? '';
  return {
    lines: parts.slice(0, -1),
    pending: remainder.length > MAX_PENDING ? '' : remainder,
  };
}
