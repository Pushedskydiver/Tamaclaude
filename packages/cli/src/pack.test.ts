import type { PackManifest } from '@tamaclaude/packs';

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePack } from './pack.js';

/** The smallest manifest the schema accepts. */
const MANIFEST = JSON.stringify({
  name: 'fixture',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
});

describe('resolvePack', () => {
  // Declared in here rather than at module scope, matching `daemon.test.ts`.
  // At module scope `functional/prefer-readonly-type` fires — as a *warning*,
  // so `pnpm lint` exits 0 — and `eslint --fix` rewrites the type to
  // `readonly string[]`, after which `.push` and `.splice` do not exist on it.
  // The autofix breaks the file.
  //
  // Whether anything notices is luck. `eslint --fix` exits 0 on a minimal
  // repro of this, so the pre-commit hook would rewrite and commit it. Here it
  // exited 1, because a type-aware rule in the same pass saw the fallout of
  // its own autofix and flagged the argument as error-typed. So the honest
  // statement is not "the hook catches it" but "the hook is what breaks it,
  // and sometimes notices".
  const made: string[] = [];
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tamaclaude-pack-'));
    made.push(dir);
    return dir;
  }
  function packAt(dir: string, body = MANIFEST): string {
    const pack = join(dir, 'pack');
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, 'manifest.json'), body);
    return pack;
  }
  afterEach(() => {
    made.splice(0).forEach((dir) => {
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('has no bundled default: nothing configured is an error, not a fallback', () => {
    // **The finding that reversed this design.** An earlier spec had a fourth
    // layer — a bundled copy of the example pack — so that a fresh install
    // always rendered something. A spec review pointed out that this is the
    // silent-wrong-pack failure rather than a guard against it: nothing sets
    // `TAMACLAUDE_PACK` today, the launchd plist that would is unwritten, and
    // so the likeliest production path is a human typing the command without
    // the variable. With a fallback that hands back a working panel carrying
    // the example pack's generic quips and no `birthday`, nothing is red and
    // nobody finds out until 24 September.
    //
    // The device is not dark meanwhile, though less reassuringly than it
    // sounds: the firmware's splash is drawn once and never redrawn, so a
    // restart leaves the last painted frame up rather than the splash.
    const home = tempDir();
    expect(() => resolvePack({ env: {}, home })).toThrow(/no pack configured/);
  });

  it('takes TAMACLAUDE_PACK first, and says so', () => {
    const dir = tempDir();
    const pack = packAt(dir);
    const resolved = resolvePack({ env: { TAMACLAUDE_PACK: pack }, home: dir });
    expect(resolved.source).toBe('TAMACLAUDE_PACK');
    expect(resolved.directory).toBe(pack);
    expect((resolved.manifest as { name: string }).name).toBe('fixture');
  });

  it('falls back to ~/.tamaclaude/pack when nothing is named', () => {
    const home = tempDir();
    const dir = join(home, '.tamaclaude');
    mkdirSync(dir, { recursive: true });
    packAt(dir);
    const resolved = resolvePack({ env: {}, home });
    expect(resolved.source).toBe('default');
    expect(resolved.directory).toBe(join(home, '.tamaclaude', 'pack'));
  });

  it('never falls through from a pack it was told about', () => {
    // **The assertion this file exists for.** A named pack that cannot be
    // loaded must stop the process, not quietly resolve to something else.
    // Here the default location holds a perfectly good pack, so a fall-through
    // would succeed and look completely normal — which is the shape of the one
    // failure that cannot be noticed until the day has passed.
    const home = tempDir();
    const dir = join(home, '.tamaclaude');
    mkdirSync(dir, { recursive: true });
    packAt(dir);
    expect(() =>
      resolvePack({ env: { TAMACLAUDE_PACK: join(home, 'nope') }, home }),
    ).toThrow(/could not read the pack.*nope.*TAMACLAUDE_PACK names/s);
  });

  it('treats a directory somebody made but left empty as a mistake', () => {
    // Not "no pack configured" — that sentence tells you to create the
    // directory you have already created, which is the least useful thing it
    // could say.
    const home = tempDir();
    mkdirSync(join(home, '.tamaclaude', 'pack'), { recursive: true });
    expect(() => resolvePack({ env: {}, home })).toThrow(/could not read/);
  });

  it('treats a dangling symlink as a mistake, not as nothing', () => {
    // The shape a moved checkout leaves behind, and the case that decided
    // `lstat` over `existsSync`: `existsSync` follows the link, reports false,
    // and would tell you to create a path that is already occupied.
    const home = tempDir();
    mkdirSync(join(home, '.tamaclaude'), { recursive: true });
    symlinkSync(join(home, 'gone'), join(home, '.tamaclaude', 'pack'));
    expect(() => resolvePack({ env: {}, home })).toThrow(/could not read/);
  });

  it('treats a file where the directory should be as a mistake', () => {
    // `ENOTDIR`, not `ENOENT`. The first version caught every stat error and
    // called it absence, so this printed "put a pack at ~/.tamaclaude/pack" —
    // advice you cannot follow without deleting the thing already there.
    // Chosen over a chmod-000 test for the same class because permissions are
    // ignored when the suite runs as root, and a gate that silently stops
    // gating in one environment is the failure this repo keeps finding.
    const home = tempDir();
    writeFileSync(join(home, '.tamaclaude'), 'not a directory');
    expect(() => resolvePack({ env: {}, home })).toThrow(/could not read/);
  });

  it('refuses an empty TAMACLAUDE_PACK rather than quietly using the default', () => {
    // The blocking finding. A valid pack sits at the default location, so a
    // fall-through would succeed and print nothing unusual — and an empty
    // `<string></string>` in a launchd plist is how you get here in
    // production.
    const home = tempDir();
    mkdirSync(join(home, '.tamaclaude'), { recursive: true });
    packAt(join(home, '.tamaclaude'));
    expect(() => resolvePack({ env: { TAMACLAUDE_PACK: '' }, home })).toThrow(
      /set but empty/,
    );
  });

  it('explains a schema failure instead of printing a zod issue array', () => {
    // **Asserting the fields, not just the prefix.** The first version matched
    // only `/is not a valid pack/`, which is a hardcoded string — so emptying
    // the issue list entirely, dropping the field path, dropping the message
    // and truncating to the first issue all left it green. Five mutants, five
    // survivors, in the gate written to replace a vacuous one.
    const dir = tempDir();
    const pack = packAt(
      dir,
      JSON.stringify({ name: 'x', palette: [[0, 0, 0]] }),
    );
    const failed = (): PackManifest =>
      resolvePack({ env: { TAMACLAUDE_PACK: pack }, home: dir }).parsed;
    expect(failed).toThrow(/is not a valid pack/);
    // The palette is too short and `quips` is missing: both named, with their
    // paths, joined rather than truncated to the first.
    expect(failed).toThrow(/palette: /);
    expect(failed).toThrow(/quips: /);
    expect(failed).toThrow(/; /);
  });

  it('escapes a manifest key rather than letting it reach the terminal', () => {
    // A pack manifest is untrusted input — hand-edited, and this repo's own
    // named example of a trust boundary. Field names come out of it and land
    // in a message printed to somebody's terminal.
    //
    // A key containing a newline broke the one-sentence promise this CLI makes
    // about its errors; a key containing an ESC byte wrote raw ANSI. Both were
    // regressions against the zod dump this replaced, which was
    // `JSON.stringify` output and so escaped exactly these characters.
    const dir = tempDir();
    const pack = packAt(
      dir,
      JSON.stringify({
        name: 'x',
        palette: [
          [0, 0, 0],
          [1, 1, 1],
        ],
        quips: { mapped: { 'evil\nkey\u001b[31m': 42 }, idle: [] },
      }),
    );
    let message = '';
    try {
      resolvePack({ env: { TAMACLAUDE_PACK: pack }, home: dir });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('is not a valid pack');
    expect(message.split('\n')).toHaveLength(1);
    expect(message).not.toContain('\u001b');
    // Escaped, not dropped — the key is still identifiable.
    expect(message).toContain('evil');
  });

  it('names the file when the manifest is not JSON', () => {
    const dir = tempDir();
    const pack = packAt(dir, '{ not json');
    expect(() =>
      resolvePack({ env: { TAMACLAUDE_PACK: pack }, home: dir }),
    ).toThrow(/manifest\.json/);
  });
});
