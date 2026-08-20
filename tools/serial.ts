/**
 * The serial link to the board, and what the board says back.
 *
 * Split out of `tools/blit.ts` to keep that file under its line limit, but the
 * boundary is real: everything here is about the wire and nothing about
 * pixels. `tools/usb-throughput.ts` opens the same port the same way and would
 * be the next caller.
 */
import type { FileHandle } from 'node:fs/promises';

import { execFileSync } from 'node:child_process';
import { open } from 'node:fs/promises';

/**
 * How long to wait after opening the port before writing anything.
 *
 * See `connect` — the board reboots when the port opens.
 */
const BOOT_SETTLE_MS = 1500;

export type Link = {
  readonly handle: FileHandle;
  readonly close: () => Promise<void>;
  readonly health: Health;
};

/**
 * What the device says about itself, and whether it has lost anything.
 *
 * The firmware reports `# rects N resync A/B abort C` once a second. Any
 * movement in resync or abort means a packet was destroyed, and from that
 * moment every diff sent is being applied to content the device never
 * received — the panel keeps a stale frame with fragments painted onto it and
 * never converges again. `lost` latches that so the sender can re-prime.
 */
type Health = {
  resyncs: number;
  aborts: number;
  lost: boolean;
  /** What the firmware says it was built for, once it has said anything. */
  orientation?: string;
};

// ── The link ──────────────────────────────────────────────────────

/**
 * Read one status line and fold it into what we know about the device.
 *
 * Split out so the reader stays a reader. It also means the parsing has one
 * place to live, which matters more than it looks: the firmware's line is a
 * second wire format that `packages/protocol` does not define, so this is the
 * whole of the contract on our side.
 */
function absorb(text: string, health: Health): void {
  const counters = /resync (\d+)\/\d+ abort (\d+)/.exec(text);
  if (!counters) {
    // A status line we cannot read is worse than none: the recovery it drives
    // would go quiet with nothing to say so, leaving only the periodic timer.
    console.log('  device| (unparsed status line — has the format drifted?)');
    return;
  }
  const resyncs = Number(counters[1]);
  const aborts = Number(counters[2]);
  // Not `>`. A counter that goes *backwards* means the device reset — a
  // brownout, a watchdog, an accidental replug — and its panel is back to the
  // splash with everything the host believes about it now stale. That is the
  // most unambiguous loss signal available, and `>` reads it as nothing
  // having happened.
  if (resyncs !== health.resyncs || aborts !== health.aborts) {
    health.lost = true;
  }
  health.resyncs = resyncs;
  health.aborts = aborts;

  const panel = /panel \d+x\d+ (\w+)/.exec(text);
  if (panel) health.orientation = panel[1];
}

/** Print whatever the firmware says, and watch its counters for losses. */
async function echoDeviceLines(
  stream: AsyncIterable<Buffer | string>,
  health: Health,
): Promise<void> {
  let pending = '';
  for await (const block of stream) {
    pending += String(block);
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      console.log(`  device| ${text}`);
      if (text.startsWith('#')) absorb(text, health);
    }
  }
}

/**
 * Open the port in raw mode and start draining what the device says.
 *
 * Raw mode first, or the terminal line discipline gets a vote on our bytes: a
 * /dev/cu.* device arrives in canonical mode, buffers by line, expands control
 * characters and honours flow control. Every one of those corrupts a binary
 * stream, and the corruption looks exactly like a firmware bug from up here.
 * `tools/usb-throughput.ts` carries the same call for the same reason.
 *
 * Draining matters as much as writing. The firmware reports its resync count
 * over this same CDC endpoint, and a device whose tx buffer fills stops
 * servicing its rx path — which arrives here as a link that mysteriously slows
 * down. Reading is also the only way the resync count is ever seen.
 */
export async function connect(port: string): Promise<Link> {
  execFileSync('stty', ['-f', port, 'raw', '-echo', '-crtscts']);
  const handle = await open(port, 'r+');
  // Opening the port resets the board — the USB-Serial/JTAG peripheral reboots
  // it on the DTR/RTS transition, the same mechanism esptool uses to enter the
  // bootloader. Anything written before it finishes booting is simply gone.
  //
  // That is not hypothetical: the first landscape run wrote its clear and its
  // priming frame immediately, the device reported having received one rect
  // rather than two, and the splash it drew on boot then survived everywhere
  // the surviving packet did not paint. A blue panel with a stray border on
  // it, from a race at startup.
  //
  // A C6 reaches app_main in roughly 300ms. A second and a half is generous
  // and costs nothing once per run.
  await new Promise((done) => setTimeout(done, BOOT_SETTLE_MS));
  const stream = handle.createReadStream({ autoClose: false });
  const health: Health = { resyncs: 0, aborts: 0, lost: false };
  const reader = echoDeviceLines(stream, health);
  const close = async (): Promise<void> => {
    // Stream before handle: closing the handle underneath a live stream
    // surfaces as ERR_STREAM_PREMATURE_CLOSE, a teardown artefact that would
    // discard the summary we came for.
    stream.destroy();
    await reader.catch(() => undefined);
    await handle.close().catch(() => undefined);
  };
  return { handle, close, health };
}

/**
 * Write a whole packet, however many syscalls that takes.
 *
 * A short write is the one corruption this tool could cause on its own: the
 * firmware would read a header, find the next header's bytes where it expected
 * payload, and resynchronise by discarding — a dropped frame with no visible
 * cause on either side.
 */
export async function writeAll(
  handle: FileHandle,
  bytes: Uint8Array,
): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      written,
      bytes.byteLength - written,
    );
    if (bytesWritten <= 0) throw new Error('port stopped accepting bytes');
    written += bytesWritten;
  }
}
