import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Linter } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { inBuildOutput } from './scan-scope.ts';

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
 * of the four functional rules and eight others, but leaves
 * `no-loop-statements`, `prefer-readonly-type`, `complexity` and `max-params`
 * on. An earlier version of this comment said a disable in a test "buys
 * nothing", which is wrong on all four; its correction said the override left
 * "the rest" on, which is wrong on the eight.
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
 * trivia of one; walking to the leaves and asking for both enumerates them, and
 * the end-of-file token carries the tail. One exception, measured against
 * ESLint's own `getAllComments` over every comment in the tree: a `#!` line is
 * shebang trivia to TypeScript rather than comment trivia, so
 * `packages/hooks/src/index.ts`'s first line is not here. ESLint reads no
 * directive out of a hashbang either, so nothing hides there — but "complete"
 * was the wrong word, and this is the one gap. Keyed by position
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
 * A suppression, as ESLint itself recognises one.
 *
 * Two shapes count, because ESLint honours two, and this gate has now missed
 * one of each. Both were demonstrated live against a planted file — ESLint
 * reporting no violation, the gate staying green.
 *
 * **Disable directives.** The comment must *begin* with `eslint-disable`,
 * which is ESLint's own rule and is what keeps this off prose that merely
 * mentions one. In a `//` comment only `-line` and `-next-line` are directives:
 * a bare `// eslint-disable` suppresses nothing, and counting it was this
 * gate's own over-count.
 *
 * **Inline config.** `/* eslint functional/no-let: "off" *\/` is not a disable
 * directive at all — it is a config override, block-comment only, and it turns
 * a rule off for the whole file. `eslint.config.ts` sets no `noInlineConfig`,
 * so it is honoured here. Three versions of this gate could not see it at all,
 * and a fourth saw only the unquoted spelling — see `CONFIGURED_RULE`, which is
 * where that went wrong and why. Rule names are read as every identifier before
 * a `:`, which over-reads an options object's keys. That is the safe direction
 * and there are none in the tree to over-read; it is not, as an earlier version
 * of this sentence claimed, the *only* way the reading can be wrong.
 *
 * The gaps that have been closed, each an under-count:
 *
 * - `let a = 1; // eslint-disable-line functional/no-let` — the trailing form
 *   is the *only* way `-line` is ever written, since alone on a line it has no
 *   code to suppress. The entire `-line` branch was unreachable.
 * - The blanket block form, which suppresses every rule rather than one,
 *   captured no rule name and so was dropped from the tally entirely. The most
 *   dangerous form was the one it was blindest to.
 * - Any directive that did not begin its line.
 * - `[^\n*]` cut the capture at the first newline, so the second rule of a
 *   list wrapped inside a block comment was bought for free. Every entry in
 *   `BUDGET` holds exactly one rule, which is the shape that hides it.
 * - The inline config form above.
 *
 * Two over-counts, both of which fail loud and cost nothing. A suppression that
 * was explicitly re-enabled is still charged: there is no `eslint-enable`
 * branch, so the gate reports a purchase that was refunded. Measured, no
 * under-count path runs through it — an enable alone suppresses nothing and is
 * counted as nothing — and the tree contains none. And matching inside
 * string and template literals. It is why the comments come from the parser
 * now rather than from a search — that, and only that. What keeps prose out is
 * the `^` anchor, not the parser.
 *
 * Not directives, measured against ESLint: `/** ... *\/`, whose value begins
 * with `*`. A rule continued after a leading `*` *is* inside a directive and
 * reaches ESLint as the literal rule name `* functional/no-let`, which it
 * rejects as undefined — so it is counted, under that name, which is what
 * keeps the wrapped-list fix from having a hole in it.
 */
const LINE_DIRECTIVE = /^\/\/\s*eslint-disable-(?:next-line|line)\b(.*)$/;
const BLOCK_DIRECTIVE =
  /^\/\*\s*eslint-disable(?:-next-line|-line)?\b([\s\S]*?)(?:\*\/)?$/;
const INLINE_CONFIG = /^\/\*\s*eslint\s+([\s\S]*?)(?:\*\/)?$/;

/**
 * Rule names inside an inline config block: every identifier before a `:`.
 *
 * The quotes are not optional decoration. ESLint parses an inline config with
 * `levn` first and `JSON.parse` as a fallback, so both spellings work — but the
 * quoted one is what `eslint.config.ts` writes for every rule name containing a
 * `/` or a `-`, which is all of them bar `complexity`. Copying a line out of
 * the config therefore produces the quoted form. Omitting `["']` here left the
 * capture unable to cross the closing quote, which returned no rules at all: a
 * whole-file suppression, counted as nothing.
 */
const CONFIGURED_RULE = /["']?([\w$@-]+(?:\/[\w$@-]+)*)["']?\s*:/g;

/** What a blanket disable buys, named so it cannot hide. */
const EVERY_RULE = '(every rule)';

/** Marks a rule reconfigured rather than disabled, so the two cannot blur. */
const asConfig = (rule: string): string => `${rule} (inline config)`;

/**
 * Rules a single comment buys, or nothing if it is not a suppression.
 *
 * Order matters: `eslint-disable` is tried first, because `\s+` after `eslint`
 * in `INLINE_CONFIG` cannot match the `-` that follows it, but relying on that
 * silently would be one more thing to get wrong.
 */
function boughtBy(comment: string): readonly string[] {
  const directive =
    LINE_DIRECTIVE.exec(comment) ?? BLOCK_DIRECTIVE.exec(comment);
  if (directive !== null) {
    // Everything after the directive up to `--`, which is ESLint's separator
    // for the human explanation. A comma-separated list is one directive
    // buying several rules, and every one of them counts.
    const listed = (directive[1] ?? '').split('--')[0] ?? '';
    const rules = listed
      .split(',')
      .map((rule) => rule.trim())
      .filter(Boolean);
    return rules.length > 0 ? rules : [EVERY_RULE];
  }
  const config = INLINE_CONFIG.exec(comment);
  if (config === null) return [];
  return [...(config[1] ?? '').matchAll(CONFIGURED_RULE)]
    .map((match) => match[1])
    .filter((rule) => rule !== undefined)
    .map((rule) => asConfig(rule));
}

function productionFiles(): readonly string[] {
  return globSync('packages/*/src/**/*.ts', {
    cwd: ROOT,
    exclude: (path) => inBuildOutput(path) || path.endsWith('.test.ts'),
  });
}

function disabledInText(text: string): readonly string[] {
  return commentsIn(text).flatMap((comment) => boughtBy(comment));
}

function disabledIn(file: string): readonly string[] {
  return disabledInText(readFileSync(join(ROOT, file), 'utf8'));
}

/**
 * One offending line, wrapped in every shape that might suppress it.
 *
 * `no-var` rather than one of the functional rules, and `.js` rather than
 * `.ts`, so this needs no plugin and no parser beyond the ones ESLint ships.
 *
 * What that does and does not buy. The matcher is textual and rule-agnostic, so
 * a core rule exercises it exactly as a plugin rule would — which is the part
 * this differential is for. What it cannot reach: a plugin rule does not
 * resolve in a `.js` probe at all, and inline-config *schema* validation is
 * per-rule, so an invalid option is rejected for one rule and honoured for
 * another. An earlier version of this paragraph claimed the answer "is the same
 * for every rule". That is the sentence a future reader would trust while
 * adding a shape, and it is false.
 */
const OFFENCE = 'var a = 1;';
const SHAPES: readonly string[] = [
  OFFENCE,
  `/* eslint-disable no-var */\n${OFFENCE}`,
  `/* eslint-disable */\n${OFFENCE}`,
  `/* eslint-disable no-var, no-undef */\n${OFFENCE}`,
  `/* eslint-disable no-var,\n   no-undef */\n${OFFENCE}`,
  `/* eslint-disable no-var -- because */\n${OFFENCE}`,
  `// eslint-disable-next-line no-var\n${OFFENCE}`,
  `${OFFENCE} // eslint-disable-line no-var`,
  `// eslint-disable\n${OFFENCE}`,
  `/** eslint-disable no-var */\n${OFFENCE}`,
  `/* eslint no-var: "off" */\n${OFFENCE}`,
  `/* eslint "no-var": "off" */\n${OFFENCE}`,
  `/* eslint 'no-var': 'off' */\n${OFFENCE}`,
  `/* eslint {"no-var": "off"} */\n${OFFENCE}`,
  `/* eslint "no-var": ["off"] */\n${OFFENCE}`,
  `/* eslint\n   "no-var": "off"\n */\n${OFFENCE}`,
  `${OFFENCE}\n/* eslint "no-var": "off" */`,
  `const s = '// eslint-disable no-var';\n${OFFENCE}`,
  `const s = \`// eslint-disable no-var\`;\n${OFFENCE}`,
  `// mentions eslint-disable in prose\n${OFFENCE}`,
];

/**
 * What ESLint does with one shape: did it parse, did it report, was it silenced.
 *
 * Two-sided, because the obvious one-sided form is unsound. Asking only "are
 * there no `no-var` messages" cannot tell three different things apart: the
 * rule was suppressed, the rule never had anything to report, and the file
 * never parsed. A fatal parse error carries `ruleId: null`, so a shape that is
 * not valid JavaScript reads as *suppressed* while no rule has run at all — and
 * `SHAPES` sits in a TypeScript repo, so one type annotation in a future entry
 * would silence it. The entry would then assert nothing, greenly, forever.
 *
 * So: lint twice, once with inline config and directives switched off. `reported`
 * is what the rule finds with nothing allowed to silence it, and a shape with
 * `reported === 0` is a broken shape rather than a suppressed one.
 */
type Verdict = {
  readonly fatal: boolean;
  readonly reported: number;
  readonly silenced: boolean;
};

function eslintVerdict(source: string): Verdict {
  const run = (allowInlineConfig: boolean): readonly Linter.LintMessage[] =>
    new Linter().verify(
      source,
      [
        {
          rules: { 'no-var': 'error' },
          linterOptions: { noInlineConfig: !allowInlineConfig },
        },
      ],
      'probe.js',
    );
  const control = run(false);
  const live = run(true);
  const count = (messages: readonly Linter.LintMessage[]): number =>
    messages.filter((message) => message.ruleId === 'no-var').length;
  return {
    fatal: [...control, ...live].some((message) => message.fatal === true),
    reported: count(control),
    silenced: count(live) < count(control),
  };
}

describe('the eslint-disable budget', () => {
  it('finds production files to check at all', () => {
    // Every package, not a lone total. All three `BUDGET` entries live in
    // daemon, device and hooks, so a glob that dropped renderer, protocol and
    // packs — 19 of 40 files — still cleared `> 20` with both tests green.
    // Measured. A package leaving the scan now fails by name.
    const files = productionFiles();
    const scanned = [
      ...new Set(files.map((file) => file.split('/')[1])),
    ].sort();
    expect(scanned).toEqual([
      'cli',
      'daemon',
      'device',
      'hooks',
      'packs',
      'protocol',
      'renderer',
    ]);
    expect(files.length).toBeGreaterThan(30);
  });

  /**
   * The assertion that closes the class rather than the instance.
   *
   * The matcher above has had five versions across five commits and four of
   * them were wrong, each fixed by a throwaway probe that was then deleted — so
   * the next divergence had nothing to catch it but another review round. This
   * is that probe, kept. (Five *versions*, four wrong: an earlier draft of this
   * sentence said five wrong commits, which is a miscount in the paragraph
   * about the recurring miscount.)
   *
   * One-directional on purpose. Over-counting is safe: it fails loud and costs
   * someone a `BUDGET` line they can argue with. Under-counting is the failure
   * that has actually happened, every time, and it is silent. Strict
   * equivalence would also be wrong — a rule reconfigured to `warn` is counted
   * here and still reported by ESLint, which is deliberate.
   */
  it('never misses a suppression ESLint honours', () => {
    const verdicts = SHAPES.map((source) => ({
      source,
      ...eslintVerdict(source),
    }));

    // The positive controls, and they are the point. Without them this test
    // cannot tell "the matcher covers every shape" from "the oracle never
    // fired": a review replaced the whole of `eslintVerdict` with a constant
    // and the suite stayed green. Every shape must parse, must carry a live
    // offence for the rule to find, and between them the shapes must exercise
    // both answers — otherwise the differential is measuring nothing.
    expect(verdicts.filter((verdict) => verdict.fatal)).toEqual([]);
    expect(verdicts.filter((verdict) => verdict.reported === 0)).toEqual([]);
    expect(
      verdicts.filter((verdict) => verdict.silenced).length,
    ).toBeGreaterThan(10);
    expect(
      verdicts.filter((verdict) => !verdict.silenced).length,
    ).toBeGreaterThan(3);

    const missed = verdicts.filter(
      (verdict) =>
        verdict.silenced && disabledInText(verdict.source).length === 0,
    );
    expect(missed).toEqual([]);
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
