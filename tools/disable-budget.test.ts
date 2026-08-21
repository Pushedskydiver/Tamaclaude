import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every `eslint-disable` in production code, and what each one buys.
 *
 * `docs/CONVENTIONS.md` §"Holding mutable state" says two shapes for holding
 * state are allowed, the budget is one disable each, and nobody may add a
 * third. That rule had nothing behind it: `pnpm lint` runs without
 * `--max-warnings`, and the rule the class-shaped one suppresses is configured
 * `warn`, so a third idiom and a fourth disable would both land green.
 *
 * `CLAUDE.md` records the precedent — the review-order rule was a judgement
 * for seven PRs and was skipped every time, until `pnpm review-triggers` made
 * it a grep. This is that, for the disable budget.
 *
 * Adding a line here is allowed and is the point: it costs a moment deciding
 * whether the disable is really the cheapest answer, which is the moment that
 * was missing. Test files are excluded — `no-let` and `immutable-data` are off
 * there anyway, so a disable in one buys nothing and would not appear.
 */
const BUDGET: Readonly<Record<string, readonly string[]>> = {
  'packages/daemon/src/socket-server.ts': ['functional/prefer-readonly-type'],
  'packages/device/src/cell.ts': ['functional/no-let'],
  'packages/hooks/src/install.ts': ['functional/immutable-data'],
};

const DISABLE = /eslint-disable(?:-next-line|-line)?\s+([\w@/-]+)/g;

function productionFiles(): readonly string[] {
  return globSync('packages/*/src/**/*.ts', {
    cwd: ROOT,
    exclude: (path) =>
      path.includes('dist') ||
      path.includes('node_modules') ||
      path.endsWith('.test.ts'),
  });
}

function disabledIn(file: string): readonly string[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  // Only lines that actually start a disable directive. `cell.ts` documents
  // the audit grep in its own header, and that prose is not a disable.
  return text
    .split('\n')
    .filter((line) => /^\s*(?:\/\/|\/\*)\s*eslint-disable/.test(line))
    .flatMap((line) => [...line.matchAll(DISABLE)].map((match) => match[1]));
}

describe('the eslint-disable budget', () => {
  it('finds production files to check at all', () => {
    expect(productionFiles().length).toBeGreaterThan(20);
  });

  it('spends exactly what is recorded, and nothing more', () => {
    const spent = Object.fromEntries(
      productionFiles()
        .map((file) => [file, disabledIn(file)] as const)
        .filter(([, rules]) => rules.length > 0),
    );
    expect(spent).toEqual(BUDGET);
  });
});
