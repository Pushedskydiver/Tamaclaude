import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Declarations carrying more than one TSDoc block.
 *
 * **What actually happens**, measured rather than assumed, because the first
 * version of this file got it wrong: TypeScript *binds* every block to the
 * declaration, and `tsc` emits all of them into the `.d.ts`. What takes only
 * the last one is the checker's documentation comment — which is what hover
 * shows, and what every tool reading `getDocumentationComment` sees. So a doc
 * written for one symbol and stranded above another does not vanish from the
 * file or the types; it vanishes from the place people read it.
 *
 * This has now bitten three times in three commits: a priming rule for
 * `Transport.send` landed above `status()`, `observe` lost its documentation to
 * a constant inserted above it, and `render` — the renderer's public entry
 * point — was emitted with no doc at all because its block sat above a
 * different function.
 *
 * **What this does not catch.** Only *adjacent* blocks are visible here. The
 * third instance put a one-line `type` alias between the doc and its function,
 * which binds the doc to the alias and leaves the function bare — and no
 * regular shape distinguishes that from a type that is simply well documented.
 * A review caught that one, and a review is what will catch the next.
 */
function multiDocNodes(files: readonly string[]): readonly string[] {
  const program = ts.createProgram([...files], {
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  });
  return files.flatMap((file) => {
    const source = program.getSourceFile(file);
    if (source === undefined) return [];
    const found: string[] = [];
    // Every node, not just the top level. Members of a `type` literal carry
    // doc blocks too, and the first instance of this bug was one of them — a
    // top-level-only walk missed it, which a probe caught before this shipped.
    const visit = (node: ts.Node): void => {
      // `jsDoc` is internal but stable, and is the only way to see that two
      // blocks bound where one was meant. A regex over the text cannot tell a
      // real block from one inside a template literal, and did report a false
      // positive in `make-font-atlas.ts` for exactly that reason.
      const blocks = (node as { jsDoc?: readonly unknown[] }).jsDoc;
      if (blocks !== undefined && blocks.length > 1) {
        found.push(file.slice(ROOT.length));
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return found;
  });
}

/**
 * Files whose stacked blocks are deliberate, with how many each may have.
 *
 * A file header sits directly above the first documented declaration, and
 * TypeScript binding both is what the author wanted. Those are the entries
 * here. A section header written the same way is the other legitimate case.
 *
 * So this ratchets rather than forbids: a new pair in a listed file fails until
 * someone bumps the number, and one in an unlisted file fails until someone
 * adds it. The cost is a line and a moment deciding which kind it is — which is
 * the moment that was missing all three times.
 *
 * Two entries were removed rather than recorded when a review pointed out they
 * were the bug and not a header: `scene.ts` had `render`'s doc above
 * `withEnvironment`, and `hook-settings.ts` had two blocks describing the same
 * constant. Recording a count instead of deciding is the failure this list
 * invites, and its first draft committed it.
 */
const DELIBERATE: Readonly<Record<string, number>> = {
  'packages/daemon/src/state.ts': 2,
  'packages/device/src/report.ts': 1,
  'packages/hooks/src/hook-settings.ts': 1,
  'packages/protocol/src/rle.ts': 1,
  'packages/renderer/src/band.ts': 1,
  'packages/renderer/src/draw.ts': 1,
  'packages/renderer/src/font-data.ts': 1,
  'packages/renderer/src/framebuffer.ts': 1,
  'packages/renderer/src/layout.ts': 1,
  'packages/renderer/src/scene.ts': 1,
  'packages/renderer/src/strip.ts': 1,
  'packages/renderer/src/text.ts': 1,
  'tools/frame-palette.ts': 1,
  'tools/svg2frames.ts': 1,
};

function sourceFiles(): readonly string[] {
  return globSync(['packages/*/src/**/*.ts', 'tools/**/*.ts'], {
    cwd: ROOT,
    exclude: (path) =>
      path.includes('dist') ||
      path.includes('node_modules') ||
      path.endsWith('.test.ts'),
  }).map((file) => ROOT + file);
}

describe('TSDoc blocks are where their author put them', () => {
  it('finds source files to check at all', () => {
    // Without this, a bad glob turns the gate below into a green no-op.
    expect(sourceFiles().length).toBeGreaterThan(30);
  });

  it('has no stacked doc blocks beyond the recorded ones', () => {
    const counted: Record<string, number> = {};
    for (const file of multiDocNodes(sourceFiles())) {
      counted[file] = (counted[file] ?? 0) + 1;
    }
    expect(counted).toEqual(DELIBERATE);
  });
});
