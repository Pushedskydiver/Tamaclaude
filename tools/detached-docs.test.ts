import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * A TSDoc block immediately followed by another TSDoc block.
 *
 * TypeScript binds only the *last* comment before a declaration, so the first
 * attaches to nothing: it disappears from hover, from the emitted `.d.ts`, and
 * from every tool that reads a documentation comment. It stays in the file
 * looking authoritative, which is what makes it worth a gate.
 *
 * Both reviewers on the socket/transport PR caught this independently, in two
 * packages, in the same commit — a rule about priming moved onto
 * `Transport.send` landed on nothing, and a new constant inserted above
 * `observe` silently took its documentation. Twice in one change is a class.
 */
const CONSECUTIVE_DOC_BLOCKS = /\*\/\s*\r?\n\s*\/\*\*/g;

/**
 * Files whose consecutive blocks are deliberate, with how many each may have.
 *
 * The pattern is not always a bug: a file header or a section header written as
 * `/** *\/` is followed by the first documented declaration, and TypeScript
 * dropping it is what the author wanted. Those are the entries below.
 *
 * So this gate ratchets rather than forbids. A new pair in a listed file fails
 * until someone bumps the number, and a pair in an unlisted file fails until
 * someone adds it. Either way the cost is one line and a moment deciding which
 * kind it is — which is the moment that was missing when this shipped twice.
 */
const DELIBERATE: Readonly<Record<string, number>> = {
  'packages/daemon/src/state.ts': 2,
  'packages/device/src/report.ts': 1,
  'packages/hooks/src/hook-settings.ts': 2,
  'packages/protocol/src/rle.ts': 1,
  'packages/renderer/src/band.ts': 1,
  'packages/renderer/src/draw.ts': 1,
  'packages/renderer/src/font-data.ts': 1,
  'packages/renderer/src/framebuffer.ts': 1,
  'packages/renderer/src/layout.ts': 1,
  'packages/renderer/src/scene.ts': 2,
  'packages/renderer/src/strip.ts': 1,
  'packages/renderer/src/text.ts': 1,
  'tools/frame-palette.ts': 1,
  'tools/make-font-atlas.ts': 1,
  'tools/svg2frames.ts': 1,
};

function sourceFiles(): readonly string[] {
  return globSync(['packages/*/src/**/*.ts', 'tools/**/*.ts'], {
    cwd: ROOT,
    exclude: (path) => path.includes('dist') || path.includes('node_modules'),
  });
}

function countIn(file: string): number {
  const text = readFileSync(join(ROOT, file), 'utf8');
  return [...text.matchAll(CONSECUTIVE_DOC_BLOCKS)].length;
}

describe('TSDoc blocks are attached to something', () => {
  it('finds source files to check at all', () => {
    // Without this, a bad glob turns the gate below into a green no-op.
    expect(sourceFiles().length).toBeGreaterThan(30);
  });

  it('has no consecutive doc blocks beyond the recorded ones', () => {
    const counted = Object.fromEntries(
      sourceFiles()
        .map((file) => [file, countIn(file)] as const)
        .filter(([, count]) => count > 0),
    );
    expect(counted).toEqual(DELIBERATE);
  });
});
