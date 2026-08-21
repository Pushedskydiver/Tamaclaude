import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultSocketPath,
  prepareSocketPath,
  probeSocket,
} from './socket-path.js';

/** A server bound to `path`, torn down by the caller. */
async function listenAt(path: string) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A socket file whose listener is gone — what a `SIGKILL`ed daemon leaves.
 *
 * Renaming the file out from under a live server and then closing it gets
 * there without killing a process: `close` unlinks the path it bound, which is
 * no longer this one, so the inode survives with nothing listening on it.
 */
async function leaveStaleSocket(path: string): Promise<void> {
  const bound = `${path}.bound`;
  const server = await listenAt(bound);
  renameSync(bound, path);
  await server.close();
}

describe('defaultSocketPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is under the home directory by default', () => {
    vi.stubEnv('TAMACLAUDE_SOCKET', undefined);
    expect(defaultSocketPath()).toBe(
      join(homedir(), '.tamaclaude', 'daemon.sock'),
    );
  });

  it('honours the override the hook already reads', () => {
    // The hook and the daemon have to agree, and they cannot import each
    // other. `TAMACLAUDE_SOCKET` is the only thing holding them together.
    vi.stubEnv('TAMACLAUDE_SOCKET', '/tmp/somewhere.sock');
    expect(defaultSocketPath()).toBe('/tmp/somewhere.sock');
  });
});

describe('probeSocket', () => {
  let directory = '';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tc-probe-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('calls a path with nothing at it free', async () => {
    await expect(probeSocket(join(directory, 'nothing.sock'))).resolves.toBe(
      'free',
    );
  });

  it('calls a socket with a listener live', async () => {
    const path = join(directory, 'live.sock');
    const server = await listenAt(path);
    await expect(probeSocket(path)).resolves.toBe('live');
    await server.close();
  });

  it('calls a socket with no listener stale', async () => {
    // This is the whole question. A Unix socket refuses a connection outright
    // when nothing is bound to it, which is what tells a leftover file from a
    // running daemon — the two are indistinguishable by `stat`.
    const path = join(directory, 'stale.sock');
    await leaveStaleSocket(path);
    await expect(probeSocket(path)).resolves.toBe('stale');
  });

  it('calls anything that is not a socket occupied', async () => {
    const path = join(directory, 'regular.txt');
    writeFileSync(path, 'someone else lives here');
    await expect(probeSocket(path)).resolves.toBe('occupied');
  });
});

describe('prepareSocketPath', () => {
  let directory = '';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tc-prepare-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('does nothing to a path that is free', async () => {
    const path = join(directory, 'daemon.sock');
    await expect(prepareSocketPath(path)).resolves.toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });

  it('removes a socket file whose daemon is gone', async () => {
    const path = join(directory, 'daemon.sock');
    await leaveStaleSocket(path);
    await prepareSocketPath(path);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses to take a socket another daemon is listening on', async () => {
    // The failure a blind unlink causes: the second daemon rebinds, the first
    // keeps a listener nothing can reach, and every hook goes to whichever
    // bound last while the other silently receives nothing for ever.
    const path = join(directory, 'daemon.sock');
    const server = await listenAt(path);
    await expect(prepareSocketPath(path)).rejects.toThrow(/already listening/);
    expect(existsSync(path)).toBe(true);
    await server.close();
  });

  it('refuses a path that is not a socket, and leaves it alone', async () => {
    const path = join(directory, 'daemon.sock');
    writeFileSync(path, 'not ours');
    await expect(prepareSocketPath(path)).rejects.toThrow(/not a socket/);
    expect(existsSync(path)).toBe(true);
  });

  it('creates the directory private to its owner', async () => {
    const path = join(directory, 'nested', 'daemon.sock');
    await prepareSocketPath(path);
    expect(statSync(join(directory, 'nested')).mode & 0o777).toBe(0o700);
  });

  it('leaves an existing directory alone', async () => {
    // Never chmod a directory somebody else made. `TAMACLAUDE_SOCKET` can
    // point anywhere, and `/tmp` is a directory the whole machine shares.
    const path = join(directory, 'daemon.sock');
    const before = statSync(directory).mode;
    await prepareSocketPath(path);
    expect(statSync(directory).mode).toBe(before);
  });
});

describe('prepareSocketPath and the sun_path limit', () => {
  // The kernel's own error for this is `EINVAL: invalid argument`, which sends
  // you looking at permissions. These pin the length explanation in its place.
  it('rejects a path at or over the 104-byte limit', async () => {
    const path = `/tmp/${'x'.repeat(110)}.sock`;
    await expect(prepareSocketPath(path)).rejects.toThrow(/over the 104-byte/);
  });

  it('names the actual size, so the fix is obvious', async () => {
    const path = `/tmp/${'x'.repeat(110)}.sock`;
    await expect(prepareSocketPath(path)).rejects.toThrow(/is 120 bytes/);
  });

  it('counts bytes rather than characters', async () => {
    // 60 two-byte characters is 120 bytes but only 60 `.length`. Counting
    // characters would let this through to a confusing EINVAL.
    const path = `/tmp/${'é'.repeat(60)}`;
    expect(path.length).toBeLessThan(104);
    await expect(prepareSocketPath(path)).rejects.toThrow(/over the 104-byte/);
  });

  it('allows a path just under the limit', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tc-len-'));
    const path = join(directory, 'daemon.sock');
    expect(Buffer.byteLength(path)).toBeLessThan(104);
    await expect(prepareSocketPath(path)).resolves.toBeUndefined();
    rmSync(directory, { recursive: true, force: true });
  });
});
