import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { capDaemonLog, isSameFile, rotateDaemonLog } from './log.js';

const root = mkdtempSync(join(tmpdir(), 'tamaclaude-log-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A log file and an append descriptor on it, standing in for launchd's stdout.
 *
 * One directory for the suite and a name per file, rather than a registry of
 * things to clean up: `functional/prefer-readonly-type` is autofixed by the
 * pre-commit hook, and it rewrites a `number[]` of open descriptors into a
 * `readonly number[]`, which has no `splice`. The tidy-up shape that survives
 * the repo's own autofix is the one with no mutable state in it.
 */
function openLog(
  name: string,
  contents: string,
): {
  readonly path: string;
  readonly fd: number;
} {
  const path = join(root, name);
  writeFileSync(path, contents);
  return { path, fd: openSync(path, 'a') };
}

describe('rotateDaemonLog', () => {
  it('caps the log without breaking the descriptor already writing to it', () => {
    // **Why truncate rather than rename.** launchd opens `StandardOutPath` and
    // hands the daemon the descriptor; a rename would leave every subsequent
    // write going to the renamed inode while `daemon.log` sat empty.
    // Truncating in place keeps the inode, and a write after it lands at
    // offset 0 — measured on 30 Aug with a throwaway launchd job, and again on
    // the real agent, rather than assumed.
    const { path, fd } = openLog('capped.log', 'x'.repeat(4096));
    const inode = statSync(path).ino;

    expect(rotateDaemonLog(path, 1024, fd)).toBe('rotated');

    expect(statSync(path).size).toBe(0);
    expect(statSync(path).ino).toBe(inode);
    // The generation just closed is still readable, which is the point of
    // capping rather than deleting: the log is where ambiguous failures live.
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('x'.repeat(4096));
    closeSync(fd);
  });

  it('refuses a path that is not the descriptor it is writing to', () => {
    // The whole safety property. A daemon run by hand has a stdout that is a
    // terminal or some other file, while the path it was told about belongs to
    // the agent — truncating that would destroy a running install's log from a
    // process with no business touching it.
    const mine = openLog('mine.log', 'x'.repeat(4096));
    const stranger = openLog('stranger.log', 'y'.repeat(4096));

    expect(rotateDaemonLog(stranger.path, 1024, mine.fd)).toBe(
      'not-our-stdout',
    );

    expect(statSync(stranger.path).size).toBe(4096);
    closeSync(mine.fd);
    closeSync(stranger.fd);
  });

  it('leaves a log that is still under the cap alone', () => {
    const { path, fd } = openLog('small.log', 'x'.repeat(1024));
    expect(rotateDaemonLog(path, 1024, fd)).toBe('under-cap');
    expect(statSync(path).size).toBe(1024);
    closeSync(fd);
  });

  it('gives up rather than taking the daemon down with it', () => {
    // **Rotation is housekeeping; the panel is the job.** If the copy or the
    // truncate throws — a full disk, a permission change, anything — an
    // uncaught error here happens before `devicePathFor`, so the daemon exits
    // non-zero, `KeepAlive` restarts it, and it fails again in the same place.
    // A log that will not rotate is the status quo. A panel that never comes
    // up is a broken gift.
    //
    // Forced by making the destination a directory, so `copyFileSync` gets
    // EISDIR without needing to fill a disk.
    const { path, fd } = openLog('undeletable.log', 'x'.repeat(4096));
    mkdirSync(`${path}.1`);

    expect(rotateDaemonLog(path, 1024, fd)).toBe('failed');

    // And the live log is untouched, rather than half-rotated.
    expect(statSync(path).size).toBe(4096);
    closeSync(fd);
  });

  it('is not an error before the log exists', () => {
    // The first start on a machine that has never run this, which is the
    // 19 Sep dry run. launchd creates the file when it spawns, so this is
    // reachable only by running the daemon by hand first — but an exception
    // here would kill a daemon over a file that was never required to exist.
    const { path, fd } = openLog('gone.log', '');
    rmSync(path);
    expect(rotateDaemonLog(path, 1024, fd)).toBe('absent');
    closeSync(fd);
  });
});

describe('capDaemonLog', () => {
  it('caps the log under ~/.tamaclaude and says which file the old one is', () => {
    // The wiring, end to end: the path the agent's plist points at, the cap
    // itself, and the sentence a person reads in the log — asserted together,
    // because each of the three has been right while the join between them
    // was not.
    const home = join(root, 'home');
    mkdirSync(join(home, '.tamaclaude'), { recursive: true });
    const path = join(home, '.tamaclaude', 'daemon.log');
    writeFileSync(path, 'x'.repeat(1024 * 1024 + 1));
    const fd = openSync(path, 'a');

    const said = capDaemonLog(home, fd);

    expect(said).toContain(`${path}.1`);
    expect(statSync(path).size).toBe(0);
    expect(statSync(`${path}.1`).size).toBe(1024 * 1024 + 1);
    closeSync(fd);
  });

  it('says nothing at all when there is nothing to say', () => {
    const home = join(root, 'quiet');
    mkdirSync(join(home, '.tamaclaude'), { recursive: true });
    const path = join(home, '.tamaclaude', 'daemon.log');
    writeFileSync(path, 'still small\n');
    const fd = openSync(path, 'a');
    expect(capDaemonLog(home, fd)).toBe('');
    closeSync(fd);
  });
});

describe('isSameFile', () => {
  it('separates two volumes that reused an inode number', () => {
    // **The arm no pair of real files can exercise.** Inode numbers are
    // per-volume, so a cross-volume collision cannot be arranged on demand,
    // and every fixture above lives in one temporary directory — which is why
    // a review's mutant deleting the `dev` comparison passed the whole suite.
    // Fabricated stats can make that comparison decide something.
    expect(isSameFile({ dev: 1, ino: 42 }, { dev: 1, ino: 42 })).toBe(true);
    expect(isSameFile({ dev: 2, ino: 42 }, { dev: 1, ino: 42 })).toBe(false);
    expect(isSameFile({ dev: 1, ino: 43 }, { dev: 1, ino: 42 })).toBe(false);
  });
});
