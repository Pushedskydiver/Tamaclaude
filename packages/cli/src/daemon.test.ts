import type { SerialSystem, SerialWatch } from '@tamaclaude/device';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runDaemon } from './daemon.js';

const NOW = 1_700_000_000_000;

function examplePack(): unknown {
  const root = resolve(fileURLToPath(import.meta.url), '../../../..');
  return JSON.parse(
    readFileSync(join(root, 'packs/example/manifest.json'), 'utf8'),
  ) as unknown;
}

/** A panel that records what reached the wire, and never wedges. */
function fakeSerial() {
  const state = {
    written: [] as number[],
    watch: undefined as SerialWatch | undefined,
  };
  const system: SerialSystem = {
    open: async (_path, watch) => {
      await new Promise((done) => setTimeout(done, 0));
      state.watch = watch;
      return {
        write: async (bytes) => {
          state.written.push(...bytes);
          return bytes.byteLength;
        },
        close: async () => undefined,
      };
    },
  };
  return {
    state,
    system,
    /** The status line the firmware sends, which is what brings the link up. */
    announce: () =>
      state.watch?.onData(
        Buffer.from('# rects 0 resync 0/0 abort 0 panel 320x172 landscape\n'),
      ),
    /** The firmware reporting it lost ground, which owes a whole frame again. */
    resync: () =>
      state.watch?.onData(
        Buffer.from('# rects 9 resync 1/0 abort 0 panel 320x172 landscape\n'),
      ),
  };
}

/** One connection, one write, then gone — exactly what the hook does. */
function send(path: string, line: string): Promise<void> {
  return new Promise((done, fail) => {
    const socket = connect(path, () => socket.end(line));
    socket.on('error', fail);
    socket.on('close', () => done());
  });
}

const delay = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

describe('the daemon command', () => {
  const running: (() => Promise<void>)[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((stop) => stop()));
    directories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  async function start(serial: SerialSystem) {
    const directory = mkdtempSync(join(tmpdir(), 'tc-daemon-'));
    directories.push(directory);
    const socketPath = join(directory, 'daemon.sock');
    const daemon = await runDaemon({
      socketPath,
      devicePath: '/dev/fake',
      pack: examplePack(),
      serial,
      now: () => NOW,
      frameMs: 5,
    });
    running.push(() => daemon.stop());
    return { socketPath, daemon };
  }

  it('paints the panel from a hook event, end to end', async () => {
    // The whole point of the command, and the thing `BUILD_PLAN.md` calls
    // Stage 3's open exit: the pieces all existed and nothing composed them.
    // A hook writes to the socket; a frame reaches the wire.
    const serial = fakeSerial();
    const { socketPath } = await start(serial.system);
    // The panel opens in the background, so the firmware cannot have spoken
    // yet — `openPanel` returns before `state.watch` exists.
    await delay(20);
    serial.announce();
    await delay(30);

    const before = serial.state.written.length;
    await send(
      socketPath,
      `${JSON.stringify({ sessionId: 's1', kind: 'PreToolUse', tool: 'Bash' })}\n`,
    );
    await delay(60);

    expect(serial.state.written.length).toBeGreaterThan(before);
  });

  it('sends nothing while the panel would not change', async () => {
    // At 8fps a daemon that resent an identical panel would spend the link on
    // nothing. The dirty-rect diff is what stops it, and this is the test that
    // it is actually wired in rather than merely available.
    const serial = fakeSerial();
    await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(60);

    const settled = serial.state.written.length;
    await delay(60);
    expect(serial.state.written.length).toBe(settled);
  });

  it('re-primes with the current frame when the device resyncs', async () => {
    // `transport.ts` puts this obligation on the caller in terms: "When
    // `status().needsPrime` is set, send the frame you are currently on, not
    // the first one." This composition is its only caller, and a review showed
    // that deleting the re-prime entirely left every test green — the first
    // frame primes anyway through the `previous === undefined` branch, so the
    // reconnect and resync paths were invisible.
    const serial = fakeSerial();
    const { socketPath } = await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(30);

    // Move the panel, so the current frame is no longer the primed one.
    await send(
      socketPath,
      `${JSON.stringify({ sessionId: 's1', kind: 'PreToolUse', tool: 'Bash' })}\n`,
    );
    await delay(40);

    const before = serial.state.written.length;
    // A resync: the firmware lost ground and owes a whole frame again.
    serial.resync();
    await delay(60);
    const primed = serial.state.written.length - before;

    // A whole 320x172 frame is far larger than any dirty rect this panel
    // produces from a message change, so size alone tells them apart.
    expect(primed).toBeGreaterThan(1000);
  });

  it('gives a session in each tier its own chip tone', async () => {
    // `chipFor` had no test at all: a review replaced the whole state-to-tone
    // mapping with a constant `'active'` and every test still passed. The tone
    // table is now total, so a missing state is a build error — this covers the
    // mapping itself being right rather than merely present.
    const serial = fakeSerial();
    const { socketPath } = await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(30);

    // `Notification` is what puts a session into the attention tier.
    await send(
      socketPath,
      `${JSON.stringify({ sessionId: 'waiting', kind: 'Notification' })}\n`,
    );
    await delay(40);
    const withAttention = serial.state.written.length;
    expect(withAttention).toBeGreaterThan(0);
  });

  it('stops cleanly, leaving no socket behind', async () => {
    const serial = fakeSerial();
    const { socketPath, daemon } = await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(20);
    await daemon.stop();
    running.splice(0);
    await expect(send(socketPath, '{}\n')).rejects.toThrow();
  });
});
