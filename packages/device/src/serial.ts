/**
 * The host's serial stack, behind a seam narrow enough to fake.
 *
 * Everything in this file needs a board plugged into a Mac, which is exactly
 * why it is separated from the transport that uses it: `panel.ts` holds the
 * behaviour worth testing — reconnection, whole-packet writes, refusing a
 * mismatched firmware — and gets a fake `SerialSystem` in its tests, while
 * this file holds the three facts about a real `/dev/cu.*` device that no test
 * without hardware could establish anyway.
 *
 * The seam is deliberately lower-level than "send a packet". `write` reports
 * how many bytes the port took rather than looping until they have all gone,
 * so that the loop lives in `panel.ts` where a fake can short-write on purpose.
 * A short write is this program's one opportunity to corrupt the stream by
 * itself, and it would be a shame for the code that prevents it to be the code
 * that cannot be tested.
 */

import type { FileHandle } from 'node:fs/promises';

import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { promisify } from 'node:util';

/**
 * How long to wait after opening the port before writing anything.
 *
 * Opening the port resets the board: the USB-Serial/JTAG peripheral reboots it
 * on the DTR/RTS transition, the same mechanism esptool uses to enter the
 * bootloader. Anything written before it finishes booting is simply gone.
 *
 * That is not hypothetical. The first landscape run wrote its clear and its
 * priming frame immediately, the device reported receiving one rect rather
 * than two, and the boot splash then survived everywhere the surviving packet
 * did not paint — a blue panel with a stray border on it, from a race at
 * startup. A C6 reaches app_main in roughly 300ms; a second and a half is
 * generous and is paid once per connect.
 */
const BOOT_SETTLE_MS = 1500;

export type SerialWatch = {
  /** Bytes the device sent, in whatever chunks USB delivered them. */
  readonly onData: (chunk: Uint8Array) => void;
  /** The port is gone: unplugged, or the kernel dropped it under us. */
  readonly onClosed: () => void;
};

export type SerialPort = {
  /** Write what the port will take now, and report how much that was. */
  write(bytes: Uint8Array): Promise<number>;
  close(): Promise<void>;
};

export type SerialSystem = {
  /** Open `path`, ready to write, with `watch` already draining it. */
  open(path: string, watch: SerialWatch): Promise<SerialPort>;
};

const run = promisify(execFile);

/**
 * Take the terminal line discipline out of the path.
 *
 * A `/dev/cu.*` device arrives in canonical mode: it buffers by line, expands
 * and translates control characters, and honours flow control. Every one of
 * those corrupts a binary stream, and the corruption looks exactly like a
 * firmware bug from up here — which is how it was first found.
 *
 * `stty -f` is the BSD spelling, so this is macOS-only. That matches where the
 * daemon runs (a launchd agent, per `BUILD_PLAN.md`); a Linux host would need
 * `-F`, and adding that branch before anything can exercise it would be adding
 * an untested path, not portability.
 */
async function raw(path: string): Promise<void> {
  try {
    await run('stty', ['-f', path, 'raw', '-echo', '-crtscts']);
  } catch (error) {
    // `execFile` attaches its entire result to the error — status, pid, and
    // stdout and stderr as printed byte arrays. The daemon logs this on every
    // failed reconnect, once a second, for as long as the panel is unplugged.
    throw new Error(`${path} is not there, or is not a serial port`, {
      cause: error,
    });
  }
}

/** Drain the device's output, and notice when it stops existing. */
function watchHandle(handle: FileHandle, watch: SerialWatch): () => void {
  const stream = handle.createReadStream({ autoClose: false });
  stream.on('data', (chunk: Buffer | string) => {
    watch.onData(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  });
  // Both events mean the same thing to us, and either may arrive first or
  // alone. Resolving a promise twice is a no-op, which is a cheaper latch than
  // a flag — and this package holds its mutable state in exactly one place.
  const gone = new Promise<void>((settle) => {
    stream.on('error', () => {
      settle();
    });
    stream.on('close', () => {
      settle();
    });
  });
  void gone.then(() => {
    watch.onClosed();
  });
  return () => {
    stream.destroy();
  };
}

/**
 * The real thing: `stty`, `open`, wait out the reboot, start reading.
 *
 * Draining matters as much as writing. The firmware reports over this same CDC
 * endpoint, and a device whose tx buffer fills stops servicing its rx path —
 * which arrives here as a link that mysteriously slows down. Reading is also
 * the only way its counters are ever seen.
 */
async function openPort(path: string, watch: SerialWatch): Promise<SerialPort> {
  await raw(path);
  const handle = await open(path, 'r+');
  await new Promise((done) => setTimeout(done, BOOT_SETTLE_MS));
  // Reading starts after the settle, not before it. A stream opened first
  // would be free to report the port gone while this function was still
  // sleeping, handing the caller a closure for a port it had not been given
  // yet — and the caller would then be reconnecting and connecting at once.
  const stop = watchHandle(handle, watch);
  return {
    write: async (bytes) => {
      const { bytesWritten } = await handle.write(bytes, 0, bytes.byteLength);
      return bytesWritten;
    },
    close: async () => {
      // Stream before handle: closing the handle underneath a live stream
      // surfaces as ERR_STREAM_PREMATURE_CLOSE, a teardown artefact that reads
      // like a fault and is not one.
      stop();
      await handle.close().catch(() => undefined);
    },
  };
}

/** The host's real serial stack. */
export function nodeSerial(): SerialSystem {
  return { open: openPort };
}
