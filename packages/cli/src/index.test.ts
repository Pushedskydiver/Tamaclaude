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
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const BUILT = resolve(ROOT, 'packages/cli/dist/index.js');

describe('the tamaclaude binary', () => {
  it('starts, loads the example pack, and exits cleanly', () => {
    // A timeout, because vitest's own runs on a timer and cannot interrupt a
    // synchronous call. This binary is about to grow a socket client and a
    // launchd agent; one that fails to exit would otherwise hang the suite
    // until the CI job limit rather than failing.
    const output = execFileSync(process.execPath, [BUILT], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(output).toContain('pack=example');
  });
});
