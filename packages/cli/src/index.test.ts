/**
 * Does the binary actually run?
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

describe('the tamaclaude binary', () => {
  it('starts, loads the example pack, and exits cleanly', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(ROOT, 'packages/cli/dist/index.js')],
      { encoding: 'utf8' },
    );
    expect(output).toContain('pack=example');
  });
});
