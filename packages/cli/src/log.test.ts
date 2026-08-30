import {
  closeSync,
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

import { rotateDaemonLog } from './log.js';

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
