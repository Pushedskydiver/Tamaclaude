import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
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
 * Every comment in a file, as the parser sees them.
 *
 * A comment is trivia, so each one is leading trivia of some token or trailing
 * trivia of one; walking to the leaves and asking for both is a complete
 * enumeration, and the end-of-file token carries the tail. Keyed by position
 * because an empty `SyntaxList` shares a start with the token after it, so the
 * same comment is reached twice.
 *
 * The point of asking the parser rather than searching the text: text that
 * merely looks like a directive inside a string or a template literal is part
 * of that literal's token and never becomes trivia, so it cannot appear here.
 * `detached-docs.test.ts` made the same move for the same reason.
 */
function commentsIn(text: string): readonly string[] {
  const source = ts.createSourceFile(
    'file.ts',
    text,
    ts.ScriptTarget.ESNext,
    true,
  );
  const found = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source);
    if (children.length === 0) {
      [
        ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
      ].forEach((range) => {
        found.set(range.pos, text.slice(range.pos, range.end));
      });
    }
    children.forEach((child) => visit(child));
  };
  visit(source);
  return [...found.values()];
}

/**
 * A disable directive, as ESLint itself recognises one.
 *
 * The comment must *begin* with `eslint-disable`, which is ESLint's own rule
 * and is also what keeps this from matching prose that merely mentions one.
 *
 * Two earlier versions each honoured less than ESLint does, and each gap ran
 * the same way — a suppression ESLint applied that this gate did not count.
 * Every one was demonstrated live against a planted file, ESLint reporting no
 * violation and the gate staying green.
 *
 * The first version filtered to comments starting their own line and required
 * a rule name to follow, which cost it three forms:
 *
 * - `let a = 1; // eslint-disable-line functional/no-let` — the trailing form
 *   is the *only* way `-line` is ever written, since alone on a line it has no
 *   code to suppress. The entire `-line` branch was unreachable.
 * - The blanket block form, which suppresses every rule rather than one,
 *   captured no rule name and so was dropped from the tally entirely. The most
 *   dangerous form was the one it was blindest to.
 * - Any directive that did not begin its line.
 *
 * The second version was one regex over the whole file text, and cost two more:
 *
 * - `[^\n*]` cut the capture at the first newline, so the second rule of a
 *   list wrapped inside a block comment was bought for free. Every entry in
 *   `BUDGET` holds exactly one rule, which is precisely the shape where a
 *   silently uncounted second one hides.
 * - It matched inside string and template literals, where there is no
 *   directive at all. That one fails loud rather than quiet, so it cost
 *   nothing — but it is why the comments come from the parser now and not
 *   from a search, which is the move `detached-docs.test.ts` had already made.
 *
 * Two forms are correctly *not* directives, and are not counted: `/** ... *\/`
 * is a doc comment, whose value begins with `*` rather than `eslint-disable`,
 * and a rule continued after a leading `*` reaches ESLint as the literal rule
 * name `* functional/no-let`, which it rejects as undefined. Both measured.
 */
const DIRECTIVE =
  /^(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b([\s\S]*?)(?:\*\/)?$/;

/** What a blanket disable of the whole file buys, named so it cannot hide. */
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
  return commentsIn(text).flatMap((comment) => {
    const match = DIRECTIVE.exec(comment);
    if (match === null) return [];
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
