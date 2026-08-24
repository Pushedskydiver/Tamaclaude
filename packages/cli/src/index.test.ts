/**
 * Does the binary actually run?
 *
 * This executes a *built* artefact, so `pnpm test` builds first — otherwise
 * the gate can green-light code that no longer exists: edit `src`, run the
 * tests alone, and this happily runs the previous build. An mtime comparison
 * was tried and is wrong here, because `tsc -b` is incremental and skips emit
 * when content has not changed, so a fresh build leaves `dist` older than
 * `src` and the check fails on correct code.
 *
 * `packages/cli` had no tests, and nothing in the suite executed it. So when
 * `packages/packs` tightened its palette schema — a one-colour pack renders an
 * invisible panel, so it is refused at the boundary — the CLI's inlined
 * placeholder became invalid and every run threw, while build, test, lint,
 * typecheck, format and knip all stayed green.
 *
 * A binary nothing executes is a binary nobody knows is broken. This runs it.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const BUILT = resolve(ROOT, 'packages/cli/dist/index.js');

/**
 * Run the binary with an environment this test controls entirely.
 *
 * **`env` is not optional here, and leaving it off was a live bug.** The old
 * version inherited `process.env`, so it inherited `HOME` and any
 * `TAMACLAUDE_PACK` the developer had set. Once a personal pack exists at
 * `~/.tamaclaude/pack/` — which is the install step this very change
 * documents, and which happens before the 19 Sep dry run — `pnpm test` on that
 * machine would either fail on the `pack=example` assertion or, worse, pass
 * while quietly reading somebody's private pack. The precedent for injecting
 * instead is `packages/hooks/src/index.test.ts`, which passes an explicit
 * `TAMACLAUDE_SOCKET`.
 *
 * `HOME` points at a directory that does not exist, so the default-location
 * layer can never resolve by accident. A test that means "no pack" has to be
 * able to say it.
 */
function run(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): { readonly out: string; readonly status: number } {
  // A timeout, because vitest's own runs on a timer and cannot interrupt a
  // synchronous call. This binary is about to grow a socket client and a
  // launchd agent; one that fails to exit would otherwise hang the suite until
  // the CI job limit rather than failing.
  const result = spawnSync(process.execPath, [BUILT, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { PATH: process.env.PATH ?? '', HOME: NO_HOME, ...env },
  });
  return {
    out: `${result.stdout}${result.stderr}`,
    status: result.status ?? -1,
  };
}

const NO_HOME = resolve(ROOT, 'packages/cli/dist/no-such-home');
const EXAMPLE = resolve(ROOT, 'packs/example');

describe('the tamaclaude binary', () => {
  it('starts, loads the pack it is pointed at, and exits cleanly', () => {
    // Pointed at the example pack by the variable that ships, rather than
    // finding it by walking up from `dist/`. The old version proved the binary
    // could load a *bundled* pack — the one path the recipient will never
    // take, and one that broke the moment the package was installed anywhere
    // but the repo.
    const { out, status } = run([], { TAMACLAUDE_PACK: EXAMPLE });
    expect(out).toContain('pack=example');
    expect(status).toBe(0);
  });

  it('refuses to start with no pack rather than inventing one', () => {
    // The whole design in one assertion. There is no bundled fallback, so this
    // cannot quietly succeed against the wrong pack.
    const { out, status } = run([]);
    expect(out).toContain('no pack configured');
    expect(status).toBe(2);
  });

  it('never falls through from a pack it was told about', () => {
    const { out, status } = run([], { TAMACLAUDE_PACK: resolve(ROOT, 'nope') });
    expect(out).toContain('could not read the pack');
    expect(out).not.toContain('pack=example');
    // The sentence, not a stack: `KNOWN` has to match this or the one line
    // worth reading arrives under six lines of Node internals.
    expect(out).not.toContain('at Object.');
    expect(status).toBe(1);
  });

  it('says which pack is loaded, because no schema can catch the wrong one', () => {
    const { out, status } = run(['pack'], { TAMACLAUDE_PACK: EXAMPLE });
    expect(out).toContain('pack example at');
    expect(out).toContain('$TAMACLAUDE_PACK');
    expect(out).toContain('birthday: none in this pack');
    expect(status).toBe(0);
  });
});
