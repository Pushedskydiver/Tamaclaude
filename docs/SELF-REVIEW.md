# Self-review

Run before opening a PR, after `da-review` has reported and you have acted on
it. You are checking your own work with fresh eyes — read the diff, not your
memory of writing it.

## Gate

```bash
pnpm build && pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm knip
```

All six green. No exceptions, no "it's only a docs change" — `knip` in
particular catches exports added for a use that never landed.

## Diff walk

Read `git diff main...HEAD` top to bottom. For each file:

- [ ] Does every change belong in **this** PR? Unrelated fixes get their own.
- [ ] Would a reader understand _why_ from the code and comments alone?
- [ ] Any commented-out code, stray `console.log`, or `TODO` without an owner?
- [ ] Any `eslint-disable` without a comment justifying it?

## Correctness

- [ ] The failure mode is handled, not just the happy path.
- [ ] Anything crossing a trust boundary (pack manifest, hook payload, wire
      bytes, config) is Zod-validated.
- [ ] Numeric/buffer code: are the boundaries tested? Empty input, single
      pixel, full screen, and a run that spans the RLE counter limit.

## Tests

- [ ] Each new behaviour has a test that fails without the change.
- [ ] Tests assert behaviour, not implementation detail.
- [ ] No test that only asserts a mock was called.

## Claims

- [ ] Every factual claim in new prose or TSDoc is true **now** — grep it.
      Especially claims about what another package does.
- [ ] Docs referenced by path actually exist at that path.

## Scope and the date

- [ ] This PR moves a `BUILD_PLAN.md` stage forward, or fixes something
      broken. If it does neither, why is it open?
- [ ] Nothing here quietly adds a feature the plan defers. The deadline is a
      birthday; it does not move.

## PR

- [ ] Title matches `<gitmoji> <type>(scope): description` — copy the emoji
      from `docs/GIT.md`, don't type it.
- [ ] Description says what changed and why, not a file listing.
