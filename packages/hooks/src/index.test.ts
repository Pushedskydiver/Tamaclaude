import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The near-leaf invariant, enforced.
 *
 * Claude Code executes this package's binary on every hook event, many times
 * per turn, so its dependency list is a latency budget rather than a style
 * preference. That invariant is asserted in `CLAUDE.md`, `docs/ARCHITECTURE.md`
 * and `docs/DA-REVIEW.md`, and until this test existed it was enforced in none
 * of them: `eslint-plugin-boundaries` governs workspace edges only, so an
 * `import { z } from 'zod'` here passed the entire quality suite silently.
 *
 * Asserting against the manifest rather than the import graph is deliberate.
 * pnpm's strict `node_modules` means this package can only import what it
 * declares, so the manifest is the real gate — and unlike a lint rule it does
 * not depend on a plugin's deprecation cycle.
 */
describe('hooks stays near-leaf', () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('declares exactly one runtime dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      '@tamaclaude/protocol',
    ]);
  });

  it('has no non-workspace runtime dependency', () => {
    const external = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => !name.startsWith('@tamaclaude/'),
    );
    expect(external).toEqual([]);
  });
});
