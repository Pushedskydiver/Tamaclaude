/**
 * The panel, over USB-CDC.
 *
 * A `Transport` that survives the cable being pulled, because it will be: this
 * sits on a desk and somebody unplugs it mid-session. Losing the panel must
 * never take the daemon with it, so nothing here throws for a missing device —
 * `send` drops the bytes, `status()` says the link is offline, and a
 * supervisor keeps trying the port until it comes back. A daemon that dies
 * with its display is worse than no daemon, because the hooks keep firing into
 * nothing.
 *
 * The decisions all live in `link.ts` as pure folds, the serial calls in
 * `serial.ts` behind a fake-able seam, and the single piece of mutable state
 * in `cell.ts`. What is left here is the wiring: when to open, when to give
 * up, and how to get a whole packet onto the wire.
 */

import type { Cell } from './cell.js';
import type { LinkState, LinkStatus, PanelSize } from './link.js';
import type { SerialPort, SerialSystem } from './serial.js';
import type { Transport } from './transport.js';
import type { Encoded, Rect } from '@tamaclaude/protocol';

import { writeRectHeader } from '@tamaclaude/protocol';

import { cell } from './cell.js';
import {
  afterClose,
  afterOpen,
  afterRefresh,
  afterReport,
  afterWrite,
  newLink,
  statusOf,
} from './link.js';
import { parseReport, splitLines } from './report.js';
import { nodeSerial } from './serial.js';

/**
 * How long to wait before trying the port again.
 *
 * An absent device fails at `stty` in microseconds, so this is the whole cost
 * of the retry: one second of latency between plugging the panel in and
 * seeing it light up, against one process spawn per second while it is not
 * there. Both are the right way round for something that spends most of its
 * life connected.
 */
const RETRY_MS = 1000;

/** How often to owe a whole frame anyway. See `afterRefresh`. */
const REFRESH_MS = 5000;

export type PanelOptions = {
  /** The serial device, e.g. `/dev/cu.usbmodem1101`. */
  readonly path: string;
  /** The panel this host renders for. The device has to agree — see `link.ts`. */
  readonly panel: PanelSize;
  /** Told whenever what a sender can see about the link changes. */
  readonly onChange?: (status: LinkStatus) => void;
  /** Injected by tests. Defaults to the real thing. */
  readonly serial?: SerialSystem;
  readonly retryMs?: number;
  readonly refreshMs?: number;
};

type Runtime = {
  readonly link: LinkState;
  readonly port?: SerialPort;
  /**
   * The tail of the write chain.
   *
   * Two `send` calls that overlap would interleave their bytes, and a packet
   * cut in half by another packet is precisely the corruption the firmware
   * recovers from by discarding. Chaining costs nothing at 8fps and makes that
   * unreachable regardless of how the caller drives us.
   */
  readonly queue: Promise<void>;
  readonly retry?: NodeJS.Timeout;
  readonly stopped: boolean;
};

type Ctx = {
  readonly path: string;
  readonly serial: SerialSystem;
  readonly retryMs: number;
  readonly announce: (status: LinkStatus) => void;
  readonly state: Cell<Runtime>;
};

// ── State ─────────────────────────────────────────────────────────

function changed(before: LinkStatus, after: LinkStatus): boolean {
  return (
    before.phase !== after.phase ||
    before.needsPrime !== after.needsPrime ||
    before.refusal !== after.refusal
  );
}

/** Adopt a new link state, and tell the caller if it can see the difference. */
function commit(ctx: Ctx, link: LinkState): void {
  const before = statusOf(ctx.state.read().link);
  ctx.state.write({ ...ctx.state.read(), link });
  const after = statusOf(link);
  if (!changed(before, after)) return;
  try {
    ctx.announce(after);
  } catch {
    // A listener that throws is the listener's problem. This is called from
    // inside `attempt`'s try block and from a stream event handler, so letting
    // it through would either open a second port on top of a working one or
    // take the daemon down from a `console.log` — neither of which has
    // anything to do with the link.
  }
}

// ── The port ──────────────────────────────────────────────────────

/** Close the port without arranging for another one. */
function shutPort(ctx: Ctx): void {
  const now = ctx.state.read();
  ctx.state.write({ ...now, port: undefined });
  if (now.port) void now.port.close().catch(() => undefined);
}

function scheduleRetry(ctx: Ctx): void {
  const now = ctx.state.read();
  // A refused link is not waiting for a better moment: the firmware is flashed
  // and the next open finds the same one. Retrying would be the re-priming
  // into the void that the refusal exists to end.
  if (now.stopped || now.retry || now.link.phase === 'refused') return;
  const retry = setTimeout(() => {
    ctx.state.write({ ...ctx.state.read(), retry: undefined });
    void attempt(ctx);
  }, ctx.retryMs);
  // Never hold the process open for a panel that is not there. The daemon has
  // its own reasons to live and this is not one of them.
  retry.unref();
  ctx.state.write({ ...ctx.state.read(), retry });
}

/**
 * The port is gone.
 *
 * Reached from a failed write and from the read stream ending, which is what
 * makes an unplug visible even during a long still frame. A port raises this
 * at most once and ports are opened strictly one at a time, so there is no
 * risk of a dead port's news arriving after its successor is up.
 */
function dropped(ctx: Ctx): void {
  const now = ctx.state.read();
  if (now.stopped || !now.port) return;
  shutPort(ctx);
  commit(ctx, afterClose(now.link));
  scheduleRetry(ctx);
}

async function attempt(ctx: Ctx): Promise<void> {
  if (ctx.state.read().stopped) return;
  try {
    const port = await ctx.serial.open(ctx.path, {
      onData: (chunk) => {
        receive(ctx, chunk);
      },
      onClosed: () => {
        dropped(ctx);
      },
    });
    // Opening takes a second and a half, and `close()` can land inside it.
    if (ctx.state.read().stopped) {
      await port.close().catch(() => undefined);
      return;
    }
    ctx.state.write({ ...ctx.state.read(), port });
    commit(ctx, afterOpen(ctx.state.read().link));
  } catch {
    // Absent is an ordinary state for a desk toy, not an error. The reason is
    // deliberately not logged: it would be the same line once a second for as
    // long as the panel is unplugged.
    scheduleRetry(ctx);
  }
}

// ── Listening ─────────────────────────────────────────────────────

function absorbLine(link: LinkState, line: string): LinkState {
  const report = parseReport(line);
  return report ? afterReport(link, report) : link;
}

/**
 * Fold in whatever the device just said.
 *
 * Decoded as latin1 rather than utf8 on purpose: this is a byte stream that
 * happens to carry ASCII, and a multi-byte decoder split across two reads —
 * or handed noise from a resynchronising line — invents replacement
 * characters in the middle of a status line. Every byte maps to one character
 * this way, and the ASCII is identical.
 */
function receive(ctx: Ctx, chunk: Uint8Array): void {
  const now = ctx.state.read();
  const text = Buffer.from(chunk).toString('latin1');
  const split = splitLines(now.link.pending, text);
  const link = split.lines.reduce((state, line) => absorbLine(state, line), {
    ...now.link,
    pending: split.pending,
  });
  commit(ctx, link);
  // Nothing this host sends will ever be drawn, and every packet it sends
  // costs the device a resynchronisation. Stop talking to it.
  if (link.phase === 'refused') shutPort(ctx);
}

// ── Writing ───────────────────────────────────────────────────────

/**
 * Header and payload in one buffer, so one packet is one write.
 *
 * There is no sync word in this protocol, so a packet split across writes is
 * not wrong — the firmware reads a byte stream — but keeping them together
 * removes one way for a partial write to leave a header stranded.
 */
function packet(rect: Rect, encoded: Encoded): Uint8Array {
  const header = writeRectHeader(
    rect,
    encoded.payload.byteLength,
    encoded.mode,
  );
  return Buffer.concat([header, encoded.payload]);
}

/**
 * Write every byte, however many syscalls that takes.
 *
 * A short write is the one corruption this program could cause on its own: the
 * firmware reads a header, finds the next header's bytes where it expected
 * payload, and resynchronises by discarding — a dropped frame with no visible
 * cause on either side.
 */
async function writeWhole(
  port: SerialPort,
  bytes: Uint8Array,
  from = 0,
): Promise<void> {
  const wrote = await port.write(bytes.subarray(from));
  if (wrote <= 0) throw new Error('the port stopped accepting bytes');
  if (from + wrote < bytes.byteLength) {
    await writeWhole(port, bytes, from + wrote);
  }
}

async function transmit(ctx: Ctx, rect: Rect, encoded: Encoded): Promise<void> {
  const now = ctx.state.read();
  if (!now.port || now.link.phase !== 'online') return;
  try {
    await writeWhole(now.port, packet(rect, encoded));
  } catch {
    dropped(ctx);
    return;
  }
  commit(ctx, afterWrite(ctx.state.read().link, rect));
}

function send(ctx: Ctx, rect: Rect, encoded: Encoded): Promise<void> {
  // Tested here, where the frame is accepted, rather than in `transmit`, where
  // it runs. A frame handed over before `close()` still goes out; one handed
  // over afterwards is dropped. Testing it in `transmit` conflates the two,
  // because the queue defers by a microtask and `close()` lands in between —
  // which showed up as a shutdown that abandoned the frame it was meant to be
  // waiting for.
  if (ctx.state.read().stopped) return Promise.resolve();
  const queued = ctx.state
    .read()
    .queue.then(() => transmit(ctx, rect, encoded));
  ctx.state.write({
    ...ctx.state.read(),
    queue: queued.catch(() => undefined),
  });
  return queued;
}

// ── Shutdown ──────────────────────────────────────────────────────

async function shutdown(ctx: Ctx): Promise<void> {
  const now = ctx.state.read();
  if (now.retry) clearTimeout(now.retry);
  ctx.state.write({ ...now, stopped: true, retry: undefined });
  // Let anything mid-write finish first. Tearing the port out from under a
  // half-written packet is the corruption this file is arranged to avoid, and
  // doing it on the way out would be no less real.
  await now.queue.catch(() => undefined);
  shutPort(ctx);
}

// ── Opening ───────────────────────────────────────────────────────

/**
 * Start driving a panel, whether or not one is plugged in.
 *
 * Returns immediately and connects in the background, because the daemon must
 * come up either way — a transport that awaited its device would make the
 * panel a startup dependency of the session pipeline, which is the coupling
 * this design exists to avoid.
 */
export function openPanel(options: PanelOptions): Transport {
  const ctx: Ctx = {
    path: options.path,
    serial: options.serial ?? nodeSerial(),
    retryMs: options.retryMs ?? RETRY_MS,
    announce: options.onChange ?? (() => undefined),
    state: cell<Runtime>({
      link: newLink(options.panel),
      queue: Promise.resolve(),
      stopped: false,
    }),
  };
  const refresh = setInterval(() => {
    commit(ctx, afterRefresh(ctx.state.read().link));
  }, options.refreshMs ?? REFRESH_MS);
  refresh.unref();
  void attempt(ctx);
  return {
    send: (region, encoded) => send(ctx, region, encoded),
    status: () => statusOf(ctx.state.read().link),
    close: async () => {
      clearInterval(refresh);
      await shutdown(ctx);
    },
  };
}
