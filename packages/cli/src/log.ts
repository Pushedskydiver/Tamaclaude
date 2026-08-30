/**
 * Keeping `~/.tamaclaude/daemon.log` from growing forever.
 *
 * **The log has one writer and no bound.** launchd's `StandardOutPath` appends
 * across every respawn and rotates nothing, so the file only ever grows. With
 * the panel unplugged the daemon exits `EXIT_NO_PANEL`, `KeepAlive` restarts
 * it thirty seconds later, and each pass writes one line — about 190 KB a day,
 * indefinitely, for a condition that is not even a fault. It reached 1.4 MB on
 * the author's machine before PR #70 made the line short; short is not
 * bounded.
 *
 * ## Truncate in place, never rename
 *
 * launchd opens the log and hands the daemon the fd. Renaming the file would
 * leave the running process writing into the renamed inode while `daemon.log`
 * sat empty — the log would look fixed and be broken. Truncating keeps the
 * inode, so the fd stays valid.
 *
 * That the following write then lands at offset 0, rather than leaving a
 * 1.4 MB hole of NULs, is a property of how launchd opens the file. It was
 * measured on 30 Aug with a throwaway launchd job — truncate, wait for the
 * respawn, `od -c` — and not assumed: 77 bytes apparent, one 4 KB block on
 * disk, no hole.
 *
 * ## Why it checks the fd rather than trusting the path
 *
 * The daemon is told a path. Truncating a file on the strength of a path is
 * how a bug deletes something that was never ours — a developer running
 * `tamaclaude daemon` in a terminal has a stdout that is not this file at all.
 * So the file is only touched when `fstat` on the daemon's own stdout and
 * `stat` on the path report the same device and inode. That is not a
 * heuristic: it is proof that the thing being truncated is the very fd the
 * process is about to write to.
 *
 * ## What this deliberately does not do
 *
 * **It runs at startup only.** The growth being fixed is driven by respawns,
 * so every byte of it arrives immediately after a start — checking once, there,
 * catches all of it. A daemon that stayed up for months while logging heavily
 * would outrun this, and nothing in the current design does that: once the
 * panel is open the daemon is quiet. A timer would be scope for a case that
 * does not exist.
 */
import type { Stats } from 'node:fs';

import { copyFileSync, fstatSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the agent's log goes.
 *
 * One definition, because three places name it — the plist written by
 * `install-agent`, the path `status` prints, and the rotation below. Two of
 * them were already separate copies of the same `join`.
 */
export function daemonLogPath(home: string): string {
  return join(home, '.tamaclaude', 'daemon.log');
}

/**
 * How large the log may get before the current generation is closed.
 *
 * One mebibyte, so at the unplugged-panel rate — one line per thirty seconds,
 * about 190 KB a day — a generation lasts the better part of a week and the
 * pair on disk covers a soak week and then some. The ceiling is two of these:
 * the live file and `daemon.log.1`.
 */
export const LOG_MAX_BYTES = 1024 * 1024;

/**
 * What happened, so the caller can say so rather than guess.
 *
 * `not-our-stdout` is the interesting one: it is the safe refusal, and a
 * caller seeing it in the wild has a daemon whose stdout is not the log it was
 * told about.
 */
export type Rotation = 'rotated' | 'under-cap' | 'absent' | 'not-our-stdout';

/** `statSync`, but a missing file is an answer rather than an exception. */
function statOrMissing(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/** `fstatSync`, likewise, for a descriptor that may have been closed. */
function fstatOrMissing(fd: number): Stats | undefined {
  try {
    return fstatSync(fd);
  } catch {
    return undefined;
  }
}

/**
 * Close the current generation of the log if it has grown past `maxBytes`.
 *
 * `fd` is the descriptor the caller writes its own output to — 1 in the daemon,
 * and an explicit one in tests, which is what lets the identity check above be
 * exercised without launchd.
 */
export function rotateDaemonLog(
  path: string,
  maxBytes: number,
  fd = 1,
): Rotation {
  const onDisk = statOrMissing(path);
  if (onDisk === undefined) return 'absent';
  const stdout = fstatOrMissing(fd);
  // Same device and inode, or it is not the file this process is writing to
  // and truncating it would be vandalism against a bystander. Identity is the
  // whole test — no separate `isFile` check, because two handles on one inode
  // cannot disagree about what kind of thing it is, and a stdout that is a
  // terminal or a pipe fails this comparison on `dev` alone.
  if (
    stdout === undefined ||
    stdout.dev !== onDisk.dev ||
    stdout.ino !== onDisk.ino
  ) {
    return 'not-our-stdout';
  }
  if (onDisk.size <= maxBytes) return 'under-cap';
  // Copy before truncating: `renameSync` would take the inode with it.
  copyFileSync(path, `${path}.1`);
  truncateSync(path, 0);
  return 'rotated';
}
