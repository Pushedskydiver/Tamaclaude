import { describe, expect, it } from 'vitest';

import { inBuildOutput } from './scan-scope.ts';

/**
 * The gates that use this have nothing else that fails when it regresses.
 *
 * `inBuildOutput` was `path.includes('dist')` for six review rounds, and no
 * file in the tree has `dist` as a filename substring — so reverting the fix
 * leaves both gates green, which is the silent state that took six rounds to
 * find in the first place. `docs/CONVENTIONS.md` §"Verify a gate can fail"
 * asks for a planted violation; this is it, planted as a string rather than as
 * a file so it cannot be lost to a cleanup.
 *
 * Worth stating plainly: neither caller ever reaches the true branches. Their
 * globs do not descend into `dist/` or `node_modules/`, measured at 81 calls
 * with zero `dist` segments. The exclusion is belt-and-braces, and this test is
 * the only thing that says what it is supposed to do.
 */
describe('what counts as build output', () => {
  it('excludes a real build directory', () => {
    expect(inBuildOutput('packages/device/dist/cell.ts')).toBe(true);
    expect(inBuildOutput('packages/device/node_modules/x/index.ts')).toBe(true);
    expect(inBuildOutput('dist/thing.ts')).toBe(true);
  });

  it('keeps a source file whose name merely contains the word', () => {
    // The defect. `distance.ts` was excluded from both gates by its name, so
    // every suppression and every stranded doc in it was free.
    expect(inBuildOutput('packages/device/src/distance.ts')).toBe(false);
    expect(inBuildOutput('packages/renderer/src/redistribute.ts')).toBe(false);
    expect(inBuildOutput('tools/node_modules_report.ts')).toBe(false);
  });
});
