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
  // At module scope `functional/prefer-readonly-type` fires, and `--fix`
  // rewrites it to `readonly string[]` — which makes `.push` and `.splice`
  // type errors, so the autofix breaks the file. `pnpm lint` did not catch
  // that; the pre-commit hook runs `eslint --fix` and did.
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
    // The device is not dark meanwhile — the boot splash is baked into the
    // firmware and draws without a host.
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

  it('names the file when the manifest is not JSON', () => {
    const dir = tempDir();
    const pack = packAt(dir, '{ not json');
    expect(() =>
      resolvePack({ env: { TAMACLAUDE_PACK: pack }, home: dir }),
    ).toThrow(/manifest\.json/);
  });
});
