/**
 * The installer, pointed at a settings file that is not anybody's.
 *
 * `TAMACLAUDE_SETTINGS` exists for exactly this: the thing under test writes
 * to `~/.claude/settings.json`, and a test suite that occasionally edits the
 * machine it runs on is not a test suite. Every case below asserts on the file
 * afterwards rather than only on the output, because "printed the right thing
 * and wrote anyway" is the failure that matters.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BUILT = resolve(fileURLToPath(import.meta.url), '../../dist/install.js');

type Run = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
};

function runInstaller(settings: string, apply = false): Run {
  try {
    const stdout = execFileSync(
      process.execPath,
      apply ? [BUILT, '--apply'] : [BUILT],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, TAMACLAUDE_SETTINGS: settings },
      },
    );
    return { stdout, stderr: '', code: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.status ?? -1,
    };
  }
}

describe('tamaclaude-install-hooks', () => {
  let dir = '';
  let settings = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tamaclaude-install-'));
    settings = join(dir, 'settings.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('by default it only says what it would do', () => {
    it('writes no file at all when there is none', () => {
      const run = runInstaller(settings);

      expect(run.code).toBe(0);
      expect(run.stdout).toContain('Dry run');
      expect(existsSync(settings)).toBe(false);
    });

    it('leaves an existing file byte for byte', () => {
      const before = '{"model":"opus"}';
      writeFileSync(settings, before);

      const run = runInstaller(settings);

      expect(run.stdout).toContain('+ PreToolUse');
      expect(readFileSync(settings, 'utf8')).toBe(before);
      expect(readdirSync(dir)).toEqual(['settings.json']);
    });

    it('prints the hooks it would add, and nothing else from the file', () => {
      // `settings.json` can hold an API key helper, and a terminal keeps
      // scrollback. Only the `hooks` subtree is ever printed.
      writeFileSync(
        settings,
        JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-do-not-print-me' } }),
      );

      const run = runInstaller(settings);

      expect(run.stdout).toContain('"PreToolUse"');
      expect(run.stdout).not.toContain('sk-do-not-print-me');
    });
  });

  describe('with --apply', () => {
    it('registers the binary for every event we asked for', () => {
      runInstaller(settings, true);

      const written = JSON.parse(readFileSync(settings, 'utf8')) as {
        hooks: Record<string, unknown>;
      };
      expect(Object.keys(written.hooks)).toContain('PreToolUse');
      expect(JSON.stringify(written)).toContain('hooks/dist/index.js');
    });

    it('keeps what was already in the file, and backs it up first', () => {
      writeFileSync(settings, JSON.stringify({ model: 'opus' }));

      runInstaller(settings, true);

      const written = JSON.parse(readFileSync(settings, 'utf8')) as {
        model: string;
      };
      expect(written.model).toBe('opus');
      const backups = readdirSync(dir).filter((name) =>
        name.includes('tamaclaude-backup'),
      );
      expect(backups).toHaveLength(1);
      expect(readFileSync(join(dir, backups[0] ?? ''), 'utf8')).toBe(
        '{"model":"opus"}',
      );
    });

    it('does nothing the second time, including no second backup', () => {
      runInstaller(settings, true);
      const after = readFileSync(settings, 'utf8');

      const run = runInstaller(settings, true);

      expect(run.stdout).toContain('Already registered');
      expect(readFileSync(settings, 'utf8')).toBe(after);
      expect(
        readdirSync(dir).filter((name) => name.includes('backup')),
      ).toHaveLength(0);
    });

    it('leaves no temporary file behind', () => {
      runInstaller(settings, true);

      expect(readdirSync(dir)).toEqual(['settings.json']);
    });

    it('refuses a file it cannot parse, and does not touch it', () => {
      // A settings file with comments in it lands here too. Refusing is right:
      // rewriting it as JSON would delete them.
      const before = '{ "model": "opus", // a comment\n}';
      writeFileSync(settings, before);

      const run = runInstaller(settings, true);

      expect(run.code).toBe(1);
      expect(readFileSync(settings, 'utf8')).toBe(before);
      expect(readdirSync(dir)).toEqual(['settings.json']);
    });

    it('refuses a file that parses to something other than an object', () => {
      writeFileSync(settings, '[1, 2, 3]');

      const run = runInstaller(settings, true);

      expect(run.code).toBe(1);
      expect(run.stderr).toContain('refusing');
      expect(readFileSync(settings, 'utf8')).toBe('[1, 2, 3]');
    });
  });
});

describe('file permissions', () => {
  it('preserves the mode of an existing settings file', () => {
    // `writeFileSync` creates with `0666 & ~umask` and `rename` carries that
    // onto the target, so a 0600 settings file was being silently widened to
    // 0644 — on the same file this installer's threat model calls out as
    // holding credentials. A test planting a token proved it was never
    // *printed*; nothing checked whether it became readable by every account
    // on the machine.
    const settings = join(
      mkdtempSync(join(tmpdir(), 'tc-mode-')),
      'settings.json',
    );
    writeFileSync(settings, '{}\n', { mode: 0o600 });
    runInstaller(settings, true);
    expect(statSync(settings).mode & 0o777).toBe(0o600);
  });

  it('creates a new settings file owner-only', () => {
    const settings = join(
      mkdtempSync(join(tmpdir(), 'tc-mode-')),
      'settings.json',
    );
    runInstaller(settings, true);
    expect(statSync(settings).mode & 0o777).toBe(0o600);
  });
});
