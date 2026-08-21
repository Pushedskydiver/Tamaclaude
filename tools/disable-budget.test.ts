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
 * was missing.
 *
 * Test files are excluded because the budget is about production code, not
 * because a disable there is meaningless — the test override switches off two
 * of the four functional rules, and leaves `no-loop-statements`,
 * `prefer-readonly-type`, `complexity`, `max-params` and the rest on. An
 * earlier version of this comment said a disable in a test "buys nothing",
 * which is wrong on all of those.
 */
const BUDGET: Readonly<Record<string, readonly string[]>> = {
  'packages/daemon/src/socket-server.ts': ['functional/prefer-readonly-type'],
  'packages/device/src/cell.ts': ['functional/no-let'],
  'packages/hooks/src/install.ts': ['functional/immutable-data'],
};

/**
 * A disable directive, as ESLint itself recognises one.
 *
 * The comment must *begin* with `eslint-disable`, which is ESLint's own rule
 * and is also what keeps this from matching prose: `cell.ts`'s header
 * documents the audit grep and so contains the word.
 *
 * The first version of this matched only comments that started their line, and
 * required a rule name to follow. Both holes were demonstrated live against
 * `packages/device/src`, with ESLint honouring the suppression and this gate
 * staying green:
 *
 * - `let a = 1; // eslint-disable-line functional/no-let` — the trailing form
 *   is the *only* way `-line` is ever written, since alone on a line it has no
 *   code to suppress. The entire `-line` branch was unreachable.
 * - `/* eslint-disable *\/` — the blanket form, which suppresses every rule
 *   rather than one, captured no rule name and so was dropped from the tally
 *   entirely. The most dangerous form was the one it was blindest to.
 */
const DIRECTIVE =
  /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b([^\n*]*)/g;

/** What a blanket `/* eslint-disable *\/` buys, named so it cannot hide. */
const EVERY_RULE = '(every rule)';

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
  return [...text.matchAll(DIRECTIVE)].flatMap((match) => {
    // Everything after the directive up to `--`, which is ESLint's separator
    // for the human explanation. A comma-separated list is one directive
    // buying several rules, and every one of them counts.
    const listed = (match[1] ?? '').split('--')[0] ?? '';
    const rules = listed
      .split(',')
      .map((rule) => rule.trim())
      .filter(Boolean);
    return rules.length > 0 ? rules : [EVERY_RULE];
  });
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
