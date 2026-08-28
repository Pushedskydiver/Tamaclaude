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
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

/** Lines over which a diff needs both reviewers, per `CLAUDE.md`. */
const BIG_DIFF_LINES = 200;

/**
 * Every tracked file that decides what a still picture looks like.
 *
 * Three kinds, and the first version of this list held only the first — which
 * a review caught by asking what each of the four artefacts named in
 * `pixel-art-critic`'s own description actually fires:
 *
 * - **Painters**, which place art into a rect. The escape-its-slot defect
 *   lives here and no art file changes when it happens.
 * - **Baked output**, which _is_ the art once generated. Re-baking the QR
 *   changed every pixel and fired only `da-review`, while `qr.ts` — the
 *   painter that had not changed — fired this row. That inversion is the row
 *   run backwards.
 * - **Bake-time sources**, which decide what the baked output will be.
 *   `tools/splash-source.ts` is, by its own header, "what the splash is baked
 *   *from*", and it fired nothing at all.
 *
 * A list rather than a pattern, because there is no naming convention across
 * those three and inventing one to make this greppable would be the tail
 * wagging the dog. A test pins every entry — though by construction a test
 * cannot catch the _next_ omission, which is how this list went wrong the
 * first time.
 *
 * Animation bakes are absent deliberately and are handled by `isAnimation`
 * instead; an earlier comment here claimed `animation-critic` already owned
 * them, and it did not — `sprites/idle.data.ts` fired `da-review` alone.
 */
const STATIC_ART_FILES = new Set([
  // Painters.
  'packages/renderer/src/logo.ts',
  'packages/renderer/src/qr.ts',
  'packages/renderer/src/pet.ts',
  // Baked output.
  'packages/renderer/src/qr.data.ts',
  'packages/device/firmware/blitter/main/splash-data.h',
  // Bake-time sources.
  'tools/splash-source.ts',
  'tools/bake-splash.ts',
  'tools/bake-qr.ts',
  'tools/logo2pixel.ts',
  'tools/pack-slots.ts',
]);

/** Baked animation frames, which `isAnimation` routes rather than this row. */
const SPRITE_BAKE = /^packages\/renderer\/src\/sprites\/.*\.data\.ts$/;

/**
 * The one tracked pack.
 *
 * `.gitignore` un-ignores `packs/example/` explicitly, so "packs/ is
 * gitignored" is false of it — a claim this repo had already caught and
 * written down in `.gitignore` itself before it was made again here. The
 * schema lets a manifest carry a logo blob, so a diff touching it can change
 * a picture.
 */
const TRACKED_PACK = 'packs/example/';

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

/**
 * Is this an animation, rather than a still?
 *
 * `.svg` rather than the whole directory: `PLANS.md` lives there too, and a
 * plan-only diff was sending work to a reviewer whose job is to re-render
 * frames — of animations that diff had not touched. The spec-or-plan row is
 * what covers a plan.
 *
 * The baked frames count too. A re-bake changes every pixel and touches no
 * `.svg`, so the entire catalogue could be regenerated and fire `da-review`
 * alone — which is the reviewer that reads code, not frames.
 */
function isAnimation(file: string): boolean {
  return (
    (file.startsWith('assets/clawd/animations/') && file.endsWith('.svg')) ||
    SPRITE_BAKE.test(file)
  );
}

/**
 * Is this a still that a critic could render and read?
 *
 * Deliberately disjoint from the animation row: a still under `assets/` comes
 * here, anything under `assets/clawd/animations/` goes to `animation-critic`,
 * which re-renders frames. `base.svg` fired neither until this existed, which
 * was a hole rather than a decision — it is the geometry every animation is
 * drawn from.
 *
 * Images, not everything under `assets/`. The font there is a `.woff2` beside
 * its licence and neither is renderable art; routing them to a critic is noise
 * in the direction that gets a reporting tool ignored.
 *
 * **This cannot see the recipient's pack** — not because `packs/` is
 * gitignored, which is false of `packs/example/` and which the clause forty
 * lines up already corrects, but because their pack is a separate private
 * repository at `~/.tamaclaude/pack/` and is not in this repo at all.
 * Redrawing the logo or the pet fires nothing here, and no rule can change
 * that. This catches the tracked half; `CLAUDE.md` says the other half stays a
 * judgement, and that it is the half most likely to be skipped.
 *
 * That wrong reason had been written down and corrected twice before it was
 * written here a third time, which is why the correction now sits in the file
 * rather than only in the doc.
 */
function isStaticArt(file: string): boolean {
  // **Belt-and-braces, and measured to be so.** Deleting this line fails no
  // test today: nothing `isAnimation` matches can reach a clause below, since
  // the image rule is anchored to `assets/` and already excludes the
  // animations directory. It is kept because the two rows must be disjoint by
  // construction rather than by coincidence — the day someone adds a sprites
  // path to `STATIC_ART_FILES`, this is the line that was meant to stop both
  // rows firing on one file. `packages/renderer/src/scene.ts` keeps its
  // `index === 0` guard on exactly this reasoning.
  if (isAnimation(file)) return false;
  const image =
    /^assets\/.*\.(?:svg|png)$/.test(file) &&
    !file.startsWith('assets/clawd/animations/');
  return image || STATIC_ART_FILES.has(file) || file.startsWith(TRACKED_PACK);
}

function touches(files: readonly string[], prefix: string): boolean {
  return files.some((file) => file.startsWith(prefix));
}

/**
 * The trigger table from `CLAUDE.md`, as predicates.
 *
 * Exported so the rows can be tested. They could not be before, and three of
 * them were wrong: the animation row fired on markdown, the `spec-grill` row
 * did not exist at all, and the diff the rows are fed could not see uncommitted
 * work. A table that decides which reviews are owed is worth a test.
 */
export function triggers(patterns: readonly string[]): readonly Trigger[] {
  return [
    {
      what: 'a change under packages/**',
      reviews: ['da-review'],
      fires: (files) => touches(files, 'packages/'),
    },
    {
      what: 'an animation under assets/clawd/animations/**',
      reviews: ['animation-critic'],
      fires: (files) => files.some((file) => isAnimation(file)),
    },
    {
      what: 'a spec or plan changed in this diff',
      reviews: ['spec-grill'],
      // `CLAUDE.md`'s table has had this row since the table existed; this
      // tool never implemented it, so the one review the table asks for
      // *before* code moves was the one it could not report.
      fires: (files) =>
        files.some(
          (file) =>
            file.endsWith('PLANS.md') ||
            file === 'BUILD_PLAN.md' ||
            file.startsWith('docs/ARCHITECTURE'),
        ),
    },
    {
      what: 'static art, or a painter that places it in a slot',
      reviews: ['pixel-art-critic'],
      fires: (files) => files.some((file) => isStaticArt(file)),
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

/** `git`, with a non-zero exit treated as output rather than as a throw. */
function git(...args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8' });
  } catch (failure) {
    // `git diff --no-index` exits 1 when the files differ, which is the
    // ordinary case here rather than an error.
    const output: unknown = (failure as { stdout?: unknown }).stdout;
    return typeof output === 'string' ? output : '';
  }
}

/**
 * Changed files and changed lines against `base`, lockfiles excluded.
 *
 * **The working tree is included, and that is the point of this tool.** It
 * used to diff `base...HEAD`, which sees only what is committed. But the row
 * this table exists to enforce hardest — "a spec or plan, _before_ code moves
 * against it" — is by definition the case where nothing is committed yet, so
 * the one question it most needed to answer was the one it could not see. Run
 * against a branch holding a full plan rewrite, it printed "no changes against
 * main".
 *
 * So the diff runs from the merge base against the tree, and untracked files
 * are added separately: `git diff` cannot see a file git has never been told
 * about, and a brand-new `.svg` is exactly the change the animation row exists
 * for.
 */
function diff(base: string): {
  files: string[];
  lines: number;
  binary: number;
} {
  const from = git('merge-base', base, 'HEAD').trim() || base;
  const tracked = git('diff', '--name-only', from).split('\n').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter(Boolean);
  const numstat = [
    ...git('diff', '--numstat', from).split('\n').filter(Boolean),
    ...untracked.flatMap((file) =>
      git('diff', '--numstat', '--no-index', '/dev/null', file)
        .split('\n')
        .filter(Boolean),
    ),
  ];
  return { files: [...tracked, ...untracked], ...countChanged(numstat) };
}

/**
 * Sum a `git diff --numstat` into changed lines, skipping lockfiles.
 *
 * Exported only so it can be tested. Git writes `-\t-` for a file it treats as
 * binary, `Number('-')` is NaN, and one NaN turns the whole total into NaN —
 * which printed as "NaN lines" and answered *no* to the over-200-lines
 * trigger, on a diff of 3,194 lines. It reported fewer reviews than were
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

/**
 * Was this run as a command, rather than imported?
 *
 * Both sides are resolved through `realpath` because `import.meta.url` already
 * is and `process.argv[1]` is not, so reaching the script through a symlink
 * made a bare `===` false — and `.husky/pre-push` discarded the exit code, so
 * nothing downstream noticed either. The one direction this tool must never
 * fail in, reached by a path nobody would think to test. (The hook now prints a
 * line of its own when this exits non-zero; it used to end in `|| true`, and
 * this sentence went on describing that for a commit after it changed.)
 *
 * When there is an entry to compare and the comparison fails, run — whatever
 * the reason, not just the symlink case above: a `process.argv[1]` that does
 * not resolve lands here too. Deliberately. Over-reporting a review is the safe
 * error here; staying quiet is the unsafe one, and this file exists because
 * that is the direction things actually go wrong.
 *
 * Not running is the ordinary outcome, not an edge case, and it is reached both
 * ways. An import from a file inherits the *importer's* entry and so returns
 * false at the comparison — which is what `review-triggers.test.ts` does on
 * every `pnpm test`. An import from `node -e`, or from the REPL, has no entry to
 * inherit and returns false at the `undefined` branch instead. Measured, both.
 * Two earlier versions of this paragraph each picked one of those and claimed it
 * was the only one.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (invokedDirectly()) main();
