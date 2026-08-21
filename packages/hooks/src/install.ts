#!/usr/bin/env node
/**
 * `tamaclaude-install-hooks` — register `tamaclaude-notify` with Claude Code.
 *
 * **It prints what it would do and writes nothing, unless given `--apply`.**
 * The file it edits is `~/.claude/settings.json`, which is not a test fixture:
 * it is where somebody keeps their model, their permission rules and possibly
 * their API key helper, and this program is the only thing in the repo that
 * writes outside it. Everything below is about deserving that.
 *
 * | Risk                                   | What stops it                                                |
 * | -------------------------------------- | ------------------------------------------------------------ |
 * | Writing something unintended           | Dry run by default; `--apply` is the whole opt-in.           |
 * | Clobbering a file we misread           | A file that does not parse, or parses to something other      |
 * |                                        | than an object, is refused — never rewritten.                 |
 * | Losing a setting we did not recognise  | The planner carries every key through and appends to hook     |
 * |                                        | lists rather than replacing them.                             |
 * | Losing the file to an interrupted write | Written to a temporary in the same directory and renamed,     |
 * |                                        | which is atomic. A copy is kept first regardless.             |
 * | Two handlers after a second run        | The planner repoints ours rather than appending.              |
 * | Printing a secret                      | Only the `hooks` subtree is ever printed. `settings.json`     |
 * |                                        | can hold credentials, and a terminal has scrollback.          |
 * | Editing the wrong file in a test       | `TAMACLAUDE_SETTINGS` overrides the path.                     |
 *
 * What it does not do: install a launchd agent, start the daemon, or check
 * that the daemon exists. Those are separate jobs and this one is finished
 * when Claude Code knows how to reach us.
 */
import type { HookInstallPlan } from './hook-settings.js';

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { hookCommand, planHookInstall } from './hook-settings.js';

function settingsPath(): string {
  return (
    process.env.TAMACLAUDE_SETTINGS ??
    join(homedir(), '.claude', 'settings.json')
  );
}

/**
 * The binary we are registering, found relative to this one.
 *
 * Both live in the same `dist`, so this resolves correctly from a repo
 * checkout and from an installed package without either being configured.
 */
function notifyScript(): string {
  return fileURLToPath(new URL('./index.js', import.meta.url));
}

type Existing = { readonly exists: boolean; readonly value: unknown };

/**
 * Read the file, or refuse.
 *
 * A missing file is normal — plenty of people have never written one — and
 * becomes an empty object. Anything present that we cannot read as a JSON
 * object throws instead, because the alternative is overwriting it with a file
 * containing only our hooks. Note this rules out a settings file with comments
 * in it: `JSON.parse` rejects those, and refusing is the correct outcome, since
 * rewriting would silently delete them.
 */
function readSettings(path: string): Existing {
  if (!existsSync(path)) return { exists: false, value: {} };
  const raw = readFileSync(path, 'utf8');
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} is not a JSON object — refusing to rewrite it`);
  }
  return { exists: true, value };
}

/** A backup name that sorts, and that says who made it. */
function backupPath(path: string): string {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  return `${path}.tamaclaude-backup-${stamp}`;
}

/**
 * Replace the file atomically, keeping a copy of what was there.
 *
 * The rename is what makes it atomic, and it only is because the temporary
 * sits in the same directory — across filesystems `rename` is a copy, and a
 * copy can be interrupted half way.
 */
function writeSettings(path: string, settings: unknown): string | undefined {
  mkdirSync(dirname(path), { recursive: true });
  const backup = existsSync(path) ? backupPath(path) : undefined;
  if (backup !== undefined) copyFileSync(path, backup);
  const temporary = `${path}.tamaclaude-${String(process.pid)}`;
  // Inherit the existing file's mode, and default to owner-only otherwise.
  //
  // `writeFileSync` creates with `0666 & ~umask` — typically 0644 — and
  // `rename` carries that onto the target. So writing a settings file that was
  // 0600 silently made it world-readable, on the same file this installer's
  // own threat model calls out as holding credentials, and with a test
  // planting a token to prove it is never *printed*. Printed, no; readable by
  // every account on the machine, yes. The backup kept its mode because
  // `copyFileSync` preserves one; only the live file was downgraded.
  const mode = existsSync(path) ? statSync(path).mode : 0o600;
  writeFileSync(temporary, `${JSON.stringify(settings, undefined, 2)}\n`, {
    encoding: 'utf8',
    mode,
  });
  renameSync(temporary, path);
  return backup;
}

/** Only the `hooks` subtree — the rest of the file is none of a terminal's business. */
function hooksSubtree(plan: HookInstallPlan): string {
  return JSON.stringify({ hooks: plan.settings.hooks }, undefined, 2);
}

function report(plan: HookInstallPlan, path: string, command: string): void {
  const lines = [
    'tamaclaude — Claude Code hook installer',
    '',
    `  settings  ${path}${existsSync(path) ? '' : ' (does not exist yet)'}`,
    `  command   ${command}`,
    '',
    ...(plan.changes.length === 0
      ? ['Already registered — nothing to change.']
      : ['Changes:', ...plan.changes.map((change) => `  ${change}`)]),
    '',
    'The "hooks" section as it would be written:',
    hooksSubtree(plan),
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const path = settingsPath();
  const command = hookCommand(process.execPath, notifyScript());
  const plan = planHookInstall(readSettings(path).value, command);
  report(plan, path, command);

  if (!apply) {
    process.stdout.write(
      'Dry run: nothing was written. Re-run with --apply to write it.\n',
    );
    return;
  }
  if (plan.changes.length === 0) return;
  const backup = writeSettings(path, plan.settings);
  process.stdout.write(
    `${backup === undefined ? 'Created' : `Backed up to ${backup}, wrote`} ${path}\n`,
  );
}

try {
  main();
} catch (error) {
  // Nothing has been written at this point — every throw above happens before
  // the write, and the write itself is a rename. Exit 1 rather than 0: unlike
  // the hook, a person is reading this.
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  // Setting `exitCode` rather than calling `process.exit(1)`: exit can cut off
  // the message just written to stderr, which is the only thing this branch
  // exists to deliver.
  // eslint-disable-next-line functional/immutable-data -- see above
  process.exitCode = 1;
}
