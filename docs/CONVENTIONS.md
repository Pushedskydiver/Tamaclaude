# Conventions

## Language and runtime

TypeScript, ESM, Node 24. `verbatimModuleSyntax` is on — use
`import type` for type-only imports (ESLint enforces this).

Relative imports carry the `.js` suffix (NodeNext resolution), even though the
source file is `.ts`.

## Packages

Workspace imports only: `@tamaclaude/protocol`, never a deep relative path
across a package boundary. No path aliases.

Adding a package means three edits, all required, or lint and knip drift apart:

1. `packages/<name>/` with `package.json` + `tsconfig.json` + `src/index.ts`
2. `eslint.config.ts` — a `boundaries/elements` entry **and** a
   `boundaries/dependencies` rule
3. `knip.json` — a `workspaces` entry

## Validation

**Zod** for anything crossing a trust boundary: pack manifests, hook payloads,
the wire protocol, config files. A pack manifest is untrusted input — it can be
hand-edited by whoever owns the device.

Internal function arguments do not need runtime validation; TypeScript is
enough.

## Style

Enforced, not discussed — Prettier for formatting, ESLint for the rest.

- `type` over `interface` (enforced)
- No `any` (enforced)
- Functions ≤ 50 lines, files ≤ 300 lines, ≤ 3 params, ≤ 3 nesting levels,
  cyclomatic complexity ≤ 10 (all enforced)
- Prefer pure functions. `functional/no-let` and `immutable-data` are on
  everywhere **except** `protocol` and `renderer`, where framebuffer and RLE
  work requires mutation — see `eslint.config.ts` for the reasoning.

When a limit fights you, the usual answer is that the function is doing two
things. Split it before reaching for a disable comment. If a disable is
genuinely right, it carries a comment saying why.

## Naming

- Files: `kebab-case.ts`
- Types: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` only for genuine compile-time constants

## Tests

Colocated: `src/foo.ts` → `src/foo.test.ts`. Vitest.

Test behaviour, not implementation. The protocol package has the highest test
value in the repo — encoder round-trips and compression ratios are cheap to
assert and catch real corruption.

## Quality gates

The six-command suite in `CLAUDE.md` is the gate. Two of its members are
configured in ways worth knowing about:

**`knip` runs with `includeEntryExports: true`.** By default knip treats every
export in a package's entry file as public API and never reports it — correct
for a published library, vacuous here, since nothing in this repo is published.
Without the flag, an export nobody imports passes silently. With it, dead
surface is caught the day it appears.

**`eslint` gives root config files an explicit `defaultProject`.**
`eslint.config.ts` and `vitest.config.ts` sit in no tsconfig by design, so they
fall to `allowDefaultProject`. An inferred project's module setting predates
`import.meta`, which makes `import.meta.dirname` an error type and trips
`no-unsafe-assignment` on a file that is perfectly fine.

### Verify a gate can fail

A gate that has never failed is indistinguishable from one that cannot. When
adding or reconfiguring one, plant a violation, watch it fail, then remove it.
Both gates here were caught being vacuous exactly this way — `knip` passed an
unused export, and the boundaries rule was confirmed only by planting a
forbidden `hooks -> renderer` import. Neither would have been noticed by a
green run.

## Comments

Comments explain **why**, not what. A comment restating the code is noise; a
comment recording a decision, a constraint, or a bug that bit us is the most
valuable thing in the file. See `eslint.config.ts` for the register to match.
