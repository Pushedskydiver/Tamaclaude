/**
 * Which files the repo-wide gates look at.
 *
 * Shared because the two gates that scan the tree — `detached-docs.test.ts` and
 * `disable-budget.test.ts` — had written this predicate separately and had
 * therefore written the same bug twice: `path.includes('dist')` is a substring
 * test, so an ordinary source file called `distance.ts` was excluded from both
 * gates by its name alone. Every suppression and every stranded doc in it was
 * free. Measured: `packages/device/src/distance.ts` carrying a blanket disable
 * passed both gates green.
 *
 * A path segment, then, not a substring. One place to get it right.
 */
export function inBuildOutput(path: string): boolean {
  const segments = path.split('/');
  return segments.includes('dist') || segments.includes('node_modules');
}
