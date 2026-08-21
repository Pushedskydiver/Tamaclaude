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
 * that with a `chmod` after `listen`. This is the layer underneath, covering
 * the moment in between.
 *
 * **The directory does not change the socket's mode, and never did.** The
 * socket's mode in that window is a pure function of the process umask —
 * measured at umask 022, 077 and 000, a socket bound inside a 0700 directory
 * and one bound inside a 0755 directory both come out 0755, 0700 and 0777
 * respectively. What a private directory buys is *traversal*: the socket is
 * still group-and-world-writable for those microseconds, and nobody else can
 * reach it to care. Getting this backwards is why an earlier version of this
 * comment claimed a guarantee the code does not make.
 *
 * **And only when we created the directory.** `recursive: true` leaves an
 * existing one's mode alone — deliberately, since `TAMACLAUDE_SOCKET` may
 * point somewhere shared and tightening a directory out from under its owner
 * is a worse surprise. So with a pre-existing `~/.tamaclaude` at 0755 the
 * window is genuinely uncovered.
 *
 * It is left uncovered on purpose. It is microseconds wide and needs a second
 * local user on the machine to matter. A local fix does exist — bind inside a
 * 0700 directory of our own, `chmod` to 0600, then rename onto the shared path,
 * which arrives already private — so this is a judgement about cost, not an
 * impossibility. It is not taken because the rename has to be ordered against
 * the stale/live takeover probe below, and clobbering another daemon's live
 * socket is a worse failure than the hole being closed is a win.
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
 * The longest path that will bind. `sizeof(sockaddr_un.sun_path)` is 104 on
 * macOS (`sys/un.h`) and 108 on Linux, but the longest *bindable* path is not
 * the same number on both: macOS carries a separate `sun_len` and does not
 * require a NUL inside the array, so all 104 bytes are usable, while Linux
 * needs the terminator and stops at 107. We check against 104, which is under
 * both, so a path never binds on one platform and not the other.
 *
 * This is the *inclusive* maximum, not the first failing length. Measured on
 * darwin 25.5.0 / Node 24: 104 bytes binds and accepts a connection, 105 is
 * `EINVAL`. The first version of this guard rejected at `>= 104` and threw
 * "104 bytes, over the 104-byte limit", which was both an off-by-one and a
 * sentence that contradicted itself.
 *
 * Worth a named error at all because the kernel's is `EINVAL: invalid
 * argument`, which says nothing about length and sends you looking at
 * permissions. What actually hits it is `TAMACLAUDE_SOCKET` pointed at a deep
 * directory. The suite's own temp paths are not close on their own — macOS
 * `tmpdir()` is 48 bytes and `mkdtemp` takes this file's three prefixes to
 * 62-66 (across the whole suite the range is 60 to 74) — but the nested case
 * below reaches 85, so the tightest margin in the tree is 19 bytes rather than
 * the comfortable 26 a first read suggested.
 */
const SUN_PATH_MAX = 104;

function assertPathFitsSunPath(path: string): void {
  // Bytes, not characters — the limit is on what goes into the struct.
  const bytes = Buffer.byteLength(path, 'utf8');
  if (bytes <= SUN_PATH_MAX) return;
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
