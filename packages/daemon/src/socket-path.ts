/**
 * Where the daemon listens, and what to do about a file that is already there.
 *
 * ## The stale socket
 *
 * A Unix socket is a file, and a process that dies without closing its server
 * leaves the file behind — every `SIGKILL`, every panic, every unplugged
 * laptop. The next `listen` on that path fails with `EADDRINUSE`, and the file
 * is byte-for-byte indistinguishable by `stat` from one a running daemon owns.
 *
 * **The obvious fix is to unlink it and bind, and the obvious fix is wrong.**
 * If a daemon really is listening, unlinking takes its name away without
 * touching its listener: it keeps running, keeps its accepted connections, and
 * never hears from a hook again, because the path those hooks connect to is
 * now a different inode. Two daemons, one of them permanently deaf, no error
 * anywhere. That is worse than refusing to start, which is at least visible.
 *
 * ## There is a way to tell them apart
 *
 * Connect to it. A Unix socket with a listener accepts; one whose listener is
 * gone refuses with `ECONNREFUSED` immediately, in the kernel, with no timeout
 * and no ambiguity. So the file is not the evidence — the answer to a
 * connection is, and it is the only evidence there is.
 *
 * | Probe result       | Means                            | Do                       |
 * | ------------------ | -------------------------------- | ------------------------ |
 * | `ENOENT`           | nothing there                    | bind                     |
 * | `ECONNREFUSED`     | a file that outlived its daemon  | unlink, bind             |
 * | connects           | a daemon is running              | refuse to start          |
 * | `ENOTSOCK`, others | not ours, or not understood      | refuse, and do not touch |
 *
 * The last row is the important one to get right: we unlink on one specific
 * signal, never on the absence of a signal. An `EACCES`, a path that turns out
 * to be somebody's regular file, a timeout — every one of them leaves the file
 * where it is.
 *
 * ## What this does not close
 *
 * Two daemons started in the same instant can both probe, both see
 * `ECONNREFUSED`, both unlink, and both bind; the loser ends up listening on
 * an inode with no name. The window is the microseconds between probe and
 * bind, on a machine with one person on it, and the recovery is to start the
 * daemon again.
 *
 * A pidfile does not fix it — a `SIGKILL` leaves a stale pidfile too, and pids
 * are reused, so you end up probing the socket to decide whether the pidfile is
 * real and are back here with an extra file to keep consistent. `flock` would,
 * but Node does not expose it. The race is accepted; a blind unlink is not,
 * because it is not a race at all — it corrupts every double start, reliably.
 *
 * One known false negative, on macOS specifically: a listener whose accept
 * backlog is full also answers `ECONNREFUSED`, so a daemon wedged with 511
 * connections queued would read as stale. The hook connects, writes ~150 bytes
 * and closes, so reaching that backlog means the daemon has already stopped
 * accepting, which is not a state worth protecting.
 */

import { Buffer } from 'node:buffer';
import { mkdirSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

/**
 * How long a probe waits before giving up.
 *
 * Both real answers — accepted, or `ECONNREFUSED` — come from the kernel
 * without touching the peer's code, so a healthy path never approaches this.
 * It is here so that a pathological socket cannot hang startup for ever, and
 * timing out counts as "not understood", which means the file is left alone.
 */
const PROBE_TIMEOUT_MS = 250;

/**
 * The directory the socket lives in, when we are the ones creating it.
 *
 * The socket's own mode is what governs who may connect, and the server sets
 * that. This is the layer underneath: for the moment between `listen` and that
 * `chmod`, the socket carries whatever the process umask gave it, and a
 * private directory covers the gap.
 *
 * **Only when we created the directory.** `recursive: true` leaves an existing
 * one's mode alone — deliberately, since `TAMACLAUDE_SOCKET` may point
 * somewhere shared and tightening a directory out from under its owner is a
 * worse surprise. So with a pre-existing `~/.tamaclaude` at 0755 the window is
 * genuinely uncovered: measured, the socket is mode 0755 between `listen` and
 * `chmod`. It is microseconds wide and needs a second local user to matter, so
 * it is documented rather than closed — closing it properly needs a
 * process-global umask change, whose blast radius is worse than the hole.
 *
 * A review caught this comment asserting a guarantee the code does not make.
 */
const SOCKET_DIRECTORY_MODE = 0o700;

/**
 * The socket path, matching `packages/hooks` exactly.
 *
 * `TAMACLAUDE_SOCKET` is the only agreement between the two packages that is
 * not a type — `eslint-plugin-boundaries` stops them importing each other, so
 * this string is duplicated on purpose and both sides read the same variable.
 * It is also what lets a test point the whole daemon at a temporary directory
 * instead of somebody's home.
 */
export function defaultSocketPath(): string {
  return (
    process.env.TAMACLAUDE_SOCKET ??
    join(homedir(), '.tamaclaude', 'daemon.sock')
  );
}

/**
 * The `sockaddr_un.sun_path` limit: 104 bytes on macOS, 108 on Linux. We check
 * against the smaller so a path never binds on one platform and not the other.
 *
 * Worth a named error because the kernel's is `EINVAL: invalid argument`, which
 * says nothing about length and sends you looking at permissions. The case that
 * actually hits it is a test pointing `TAMACLAUDE_SOCKET` at a temporary
 * directory — macOS `mkdtemp` paths are long enough to blow the limit on their
 * own, before any filename is joined on. Found by tripping it.
 */
const SUN_PATH_MAX = 104;

function assertPathFitsSunPath(path: string): void {
  // Bytes, not characters — the limit is on what goes into the struct.
  const bytes = Buffer.byteLength(path, 'utf8');
  if (bytes < SUN_PATH_MAX) return;
  throw new Error(
    `socket path is ${String(bytes)} bytes, over the ${String(SUN_PATH_MAX)}-byte limit: ${path}`,
  );
}

/** What is at a socket path. See the table in the header. */
export type SocketProbe = 'free' | 'live' | 'stale' | 'occupied';

function errorCode(error: unknown): string | undefined {
  return error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function classify(error: unknown): SocketProbe {
  const code = errorCode(error);
  if (code === 'ENOENT') return 'free';
  if (code === 'ECONNREFUSED') return 'stale';
  return 'occupied';
}

/**
 * Ask the path whether anything is listening.
 *
 * Nothing is written and nothing is read: the connection is destroyed the
 * moment it answers either way, so a daemon on the other end sees a peer that
 * connected and left, which its own connection handling already survives.
 */
export function probeSocket(path: string): Promise<SocketProbe> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const settle = (result: SocketProbe): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => settle('occupied'));
    socket.on('connect', () => settle('live'));
    socket.on('error', (error) => settle(classify(error)));
  });
}

/**
 * Make the path bindable, or explain why it is not.
 *
 * Throws rather than returning a result: there is exactly one correct
 * response to "somebody else is already the daemon", and it is to stop.
 */
export async function prepareSocketPath(path: string): Promise<void> {
  assertPathFitsSunPath(path);
  // `recursive: true` leaves an existing directory's mode alone, which is the
  // behaviour we want — `TAMACLAUDE_SOCKET` can point into a directory the
  // whole machine shares, and tightening one out from under its owner would be
  // a worse surprise than a socket in a public place.
  mkdirSync(dirname(path), { recursive: true, mode: SOCKET_DIRECTORY_MODE });
  const probe = await probeSocket(path);
  if (probe === 'free') return;
  if (probe === 'stale') {
    unlinkSync(path);
    return;
  }
  throw new Error(
    probe === 'live'
      ? `another tamaclaude daemon is already listening on ${path}`
      : `${path} exists and is not a socket this daemon can take over`,
  );
}
