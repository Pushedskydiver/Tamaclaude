/**
 * Which reviews does the current branch need?
 *
 * `CLAUDE.md` carries a table of review triggers and says of it: "It is a grep
 * now, not a judgement." That was written because the original rule —
 * "non-trivial changes get reviewed" — was violated seven PRs running, always
 * in the direction of momentum. Making it a table helped. It did not fix it:
 * the table has since been skipped three more times, because running the grep
 * is still something a person has to remember, which is the same failure mode
 * wearing a different hat.
 *
 * So this is the grep.
 *
 *   pnpm review-triggers [base]
 *
 * It reports rather than blocks, because it cannot tell whether a review
 * actually happened — only which ones are owed. The pre-push hook runs it so
 * the answer arrives unprompted rather than being remembered.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/** Lines over which a diff needs both reviewers, per `CLAUDE.md`. */
const BIG_DIFF_LINES = 200;

/** Lockfiles are excluded from that count — they are generated bulk. */
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json']);

type Trigger = {
  readonly what: string;
  readonly reviews: readonly string[];
  readonly fires: (files: readonly string[], lines: number) => boolean;
};

/**
 * The blast-radius list, read out of `docs/GIT.md` rather than copied here.
 *
 * Copying it would create exactly the drift this repo keeps finding in review:
 * a list in two places is a list that is wrong in one of them. The doc owns
 * which files govern the others; this only owns how to act on that.
 */
function blastRadius(): readonly string[] {
  const doc = readFileSync(resolve(ROOT, 'docs/GIT.md'), 'utf8');
  // `(?=\n## |$)` rather than `\n## `: the section is currently the last one in
  // the file, so requiring a following heading matched nothing and silently
  // returned an empty list — a blast-radius check that could never fire.
  const section =
    /## Blast-radius files\n([\s\S]*?)(?=\n## |$)/.exec(doc)?.[1] ?? '';
  if (section.trim() === '') {
    throw new Error('no blast-radius list found in docs/GIT.md');
  }
  // Only things that look like paths. The prose names config keys in
  // backticks too — `boundaries/dependencies` is a rule, not a file — and
  // while those can never match a changed path, admitting them makes the
  // parsed list misleading to anyone who prints it.
  return [...section.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path) => /\.\w+$/.test(path) || path.endsWith('/**'));
}

function touches(files: readonly string[], prefix: string): boolean {
  return files.some((file) => file.startsWith(prefix));
}

function triggers(patterns: readonly string[]): readonly Trigger[] {
  return [
    {
      what: 'a change under packages/**',
      reviews: ['da-review'],
      fires: (files) => touches(files, 'packages/'),
    },
    {
      what: 'a change under assets/clawd/animations/**',
      reviews: ['animation-critic'],
      fires: (files) => touches(files, 'assets/clawd/animations/'),
    },
    {
      what: 'a change to a blast-radius file (docs/GIT.md)',
      reviews: ['copilot-surrogate'],
      fires: (files) =>
        files.some((file) =>
          patterns.some((pattern) =>
            pattern.endsWith('/**')
              ? file.startsWith(pattern.slice(0, -2))
              : file === pattern,
          ),
        ),
    },
    {
      what: `a diff over ${BIG_DIFF_LINES} lines, excluding lockfiles`,
      reviews: ['da-review', 'copilot-surrogate'],
      fires: (_files, lines) => lines > BIG_DIFF_LINES,
    },
  ];
}

/** Changed files and changed lines against `base`, lockfiles excluded. */
function diff(base: string): {
  files: string[];
  lines: number;
  binary: number;
} {
  const range = `${base}...HEAD`;
  const names = execFileSync('git', ['diff', '--name-only', range], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const numstat = execFileSync('git', ['diff', '--numstat', range], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  return { files: names, ...countChanged(numstat) };
}

/**
 * Sum a `git diff --numstat` into changed lines, skipping lockfiles.
 *
 * Exported only so it can be tested. Git writes `-\t-` for a file it treats as
 * binary, `Number('-')` is NaN, and one NaN turns the whole total into NaN —
 * which printed as "NaN lines" and answered *no* to the over-200-lines
 * trigger, on a diff of several hundred. It reported fewer reviews than were
 * owed, which is the one direction this tool must never fail in.
 *
 * Found because a test file had literal NUL bytes in it and git called it
 * binary. The next one will be a PNG under `assets/`, which is ordinary.
 */
export function countChanged(numstat: readonly string[]): {
  lines: number;
  binary: number;
} {
  let lines = 0;
  let binary = 0;
  for (const row of numstat) {
    const [added, removed, file] = row.split('\t');
    if (file !== undefined && LOCKFILES.has(file)) continue;
    if (added === '-' || removed === '-') {
      binary += 1;
      continue;
    }
    lines += Number(added ?? 0) + Number(removed ?? 0);
  }
  return { lines, binary };
}

/** The one-line summary above the trigger list. */
function headline(counts: {
  base: string;
  files: number;
  lines: number;
  binary: number;
}): string {
  const plural = counts.binary === 1 ? '' : 's';
  const note =
    counts.binary > 0
      ? ` (${counts.binary} binary file${plural} not counted)`
      : '';
  return `${counts.files} files, ${counts.lines} lines against ${counts.base}${note}`;
}

function main(): void {
  const base = process.argv[2] ?? 'main';
  const { files, lines, binary } = diff(base);
  if (files.length === 0) {
    console.log(`no changes against ${base}`);
    return;
  }

  const owed = new Set<string>();
  console.log(`\n${headline({ base, files: files.length, lines, binary })}\n`);
  for (const trigger of triggers(blastRadius())) {
    const fires = trigger.fires(files, lines);
    if (fires) for (const review of trigger.reviews) owed.add(review);
    console.log(
      `  ${fires ? 'YES' : ' no'}  ${trigger.what}` +
        (fires ? ` -> ${trigger.reviews.join(', ')}` : ''),
    );
  }

  console.log(
    owed.size === 0
      ? '\nself-review only (docs/SELF-REVIEW.md)\n'
      : `\nrequired before this PR: ${[...owed].join(', ')}` +
          '\nplus self-review (docs/SELF-REVIEW.md), always\n',
  );
}

// Only when run as a command. Importing this module — which the test does, to
// reach `countChanged` — must not shell out to git as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
