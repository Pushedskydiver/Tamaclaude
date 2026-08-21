# Conventions

## Language and runtime

TypeScript, ESM, Node 24. `verbatimModuleSyntax` is on — use
`import type` for type-only imports (ESLint enforces this).

Relative imports carry the `.js` suffix (NodeNext resolution), even though the
source file is `.ts`.

## Packages

Workspace imports only: `@tamaclaude/protocol`, never a deep relative path
across a package boundary. No path aliases.

Adding a package means three edits:

1. `packages/<name>/` with `package.json` + `tsconfig.json` + `src/index.ts`
2. `tsconfig.json` at the root — a `references` entry, or `tsc -b` never
   visits it and `pnpm typecheck` silently passes over the whole package
3. `eslint.config.ts` — a `boundaries/elements` entry **and** a
   `boundaries/dependencies` rule

`knip.json` needs nothing: it auto-discovers the pnpm workspace, and its only
entry is for `tools/`, which sits outside that workspace.

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
- Prefer pure functions. Four rules — `functional/no-let`,
  `immutable-data`, `no-loop-statements` and `prefer-readonly-type` — are on by
  default, with three exemptions: all four are off in `protocol` and
  `renderer`, where framebuffer work requires mutation, and in `tools/`, which
  drives a browser sequentially; and `no-let` and `immutable-data` (only those
  two) are off in **every package's test files**. See `eslint.config.ts` for
  the reasoning in each case.

When a limit fights you, the usual answer is that the function is doing two
things. Split it before reaching for a disable comment. If a disable is
genuinely right, it carries a comment saying why.

### Holding mutable state

In the packages where `functional/no-let` is on, something occasionally still
has to point at a new value. Two shapes are in the tree and both are allowed:

- a **class with `readonly` fields and one mutable private field**
  (`packages/daemon/src/socket-server.ts` — `#registry`). That file's own
  header counts _two_ things as mutating, and both counts are right about
  different questions: one binding is reassigned, two pieces of state change.
  The second is `#connections`, a readonly `Set` that is added to and deleted
  from — marking a collection readonly stops the field moving, not the
  contents, so a mutated one still needs accounting.
- a **`cell` closure** (`packages/device/src/cell.ts`)

The rule is not which shape you pick, it is the **budget: one disable comment,
naming the single binding that moves.** Both of these spend exactly one. A
change that needs two is a change that should have been split.

Do not add a third shape. A review flagged these two landing in one PR and
asked for arbitration; the answer was to write the budget down rather than
rewrite working, already-reviewed code for cosmetic uniformity — but a third
idiom would mean the budget is not being read.

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

The six-command suite in `CLAUDE.md` is the gate. Three of its members are
configured in ways worth knowing about:

**`typecheck` runs `tsc -b`, not `tsc -b --noEmit`.** A composite project may
not disable emit in a referenced project, so `tsc -b --noEmit` is `TS6310` —
five of them here. It appeared to pass only because `tsc -b` short-circuits
when every `.tsbuildinfo` is current: warm it was silent, cold it failed, and
a fresh checkout is always cold. It had been that way since the scaffold
commit, and was found by a review noticing the six-command suite did not
actually go green. Emitting is not a cost worth avoiding — `build` runs first
in the suite regardless.

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
