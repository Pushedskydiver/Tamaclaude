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
 * One mebibyte. The unplugged-panel rate is one 66-byte line per respawn and
 * a respawn every thirty seconds — 186 KiB a day, and measured at eleven lines
 * in five minutes on the live agent rather than derived from the throttle
 * alone. So a generation lasts about five and a half days, and the history on
 * disk at any moment is between that and twice it, depending where in the
 * cycle you look. Never a week guaranteed: five and a half is the floor.
 *
 * The count on disk is always two, the live file and `daemon.log.1`. The
 * *size* is bounded only as far as the check below runs, which is at startup —
 * see the note at the end of this comment.
 */
const LOG_MAX_BYTES = 1024 * 1024;

/**
 * What happened, so the caller can say so rather than guess.
 *
 * `not-our-stdout` is the safe refusal — a caller seeing it in the wild has a
 * daemon whose stdout is not the log it was told about. `failed` is the one
 * worth a line of output: the log is over the cap and could not be rotated, so
 * it will go on growing.
 */
export type Rotation =
  'rotated' | 'under-cap' | 'absent' | 'not-our-stdout' | 'failed';

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
  // whole test, with no separate `isFile` check: file type is a property of
  // the inode, so two handles on one inode cannot disagree about it. A stdout
  // that is a terminal or a pipe has neither the device nor the inode of a
  // file on the data volume and fails here.
  if (
    stdout === undefined ||
    stdout.dev !== onDisk.dev ||
    stdout.ino !== onDisk.ino
  ) {
    return 'not-our-stdout';
  }
  if (onDisk.size <= maxBytes) return 'under-cap';
  try {
    // Copy before truncating: `renameSync` would take the inode with it.
    copyFileSync(path, `${path}.1`);
    truncateSync(path, 0);
    return 'rotated';
  } catch {
    // **Housekeeping must not be able to stop the daemon starting.** This runs
    // before device discovery, so an uncaught error here exits non-zero,
    // `KeepAlive` restarts, and the next start fails in the same place — a
    // full disk would turn a log that is merely too big into a panel that
    // never comes up. A log that will not rotate is the status quo ante.
    return 'failed';
  }
}

/**
 * Cap the log, and the one line worth printing about it.
 *
 * The daemon's whole involvement, so the decision and the words for it stay in
 * one place rather than being reassembled at the call site. Usually there is
 * nothing to say and this returns the empty string, which `process.stdout` is
 * happy to write.
 *
 * `fd` is the descriptor to compare against, defaulting to this process's own
 * stdout; a test passes a real one, which is what lets the path, the cap and
 * the message be exercised together rather than one at a time.
 */
export function capDaemonLog(home: string, fd = 1): string {
  const path = daemonLogPath(home);
  const rotation = rotateDaemonLog(path, LOG_MAX_BYTES, fd);
  if (rotation === 'rotated') {
    return `log capped; the previous one is at ${path}.1\n`;
  }
  if (rotation === 'failed') {
    // Costs a second line per respawn on a log that is already too big, which
    // is the wrong direction. Said anyway: silence here is a log growing
    // without bound behind the one feature meant to bound it, and this is the
    // only place that could ever say so.
    return 'log is over its cap and could not be rotated\n';
  }
  return '';
}
