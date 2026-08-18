# Git conventions

## Branch strategy

`main` is protected. All work happens on a branch and lands via PR.

## Branch naming

```
<type>/<short-description>
```

`feat/rle-encoder`, `fix/rgb565-channel-order`, `docs/hardware-pinout`.

## Commit messages

```
<gitmoji> <type>[(scope)]: <description>
```

### Types

| Type       | Gitmoji | Use for                                |
| ---------- | ------- | -------------------------------------- |
| `feat`     | ✨      | New feature                            |
| `fix`      | 🐛      | Bug fix                                |
| `chore`    | 📦      | Maintenance, deps, config              |
| `refactor` | ♻️      | Code change that doesn't fix or add    |
| `test`     | ✅      | Adding or updating tests               |
| `docs`     | 📝      | Documentation only                     |
| `style`    | 💄      | Formatting, cosmetic (no logic change) |
| `perf`     | ⚡️      | Performance improvement                |
| `security` | 🔒      | Security fix                           |
| `remove`   | 🔥      | Removing code or files                 |
| `build`    | 🔧      | Build system, dependency bumps         |

### Examples

```
✨ feat(protocol): add RLE dirty-rect encoder
🐛 fix(renderer): correct RGB565 channel order
📦 chore: scaffold monorepo with pnpm workspaces
📝 docs(hardware): record verified flash size
♻️ refactor(daemon): extract session eviction as pure function
✅ test(protocol): add compression-ratio assertions
```

### Gotchas

Nothing validates the format locally — `.husky/pre-commit` runs `lint-staged`
only. CI validates the **PR title**, which becomes the squash-merge subject.
Three ways a title that looks right still fails:

1. **Wrong gitmoji for the type** — each type has exactly one.
2. **Wrong Unicode form** — most types use the bare codepoint, but `refactor`
   (`♻️`) and `perf` (`⚡️`) include a trailing U+FE0F variation selector, and
   the CI check expects it for those two. Copy from the table rather than
   typing one.
3. **Punctuation in the scope** — the regex is `[a-zA-Z0-9_-]+`. A dot or a
   comma-joined list fails. Use a package name (`protocol`, `renderer`,
   `daemon`), and put stage references in the description.

Fix with `gh pr edit <n> --title "..."` — no re-commit needed.

### No `--amend`

Always create a new commit, even for a one-character follow-up. Never
`git commit --amend`. If a pre-commit hook fails: fix, re-stage, new commit.

## Labels

### Type labels (required — exactly one per PR)

`refactor/` and `docs/` branches both use `chore`.

| Label     | Branch prefix                  |
| --------- | ------------------------------ |
| `feature` | `feat/`                        |
| `fix`     | `fix/`                         |
| `chore`   | `chore/`, `refactor/`, `docs/` |

### Scope labels (additive)

One per package touched, matching the graph in `docs/ARCHITECTURE.md`:

| Label      | When to use                                  |
| ---------- | -------------------------------------------- |
| `protocol` | Changes to `packages/protocol/`              |
| `packs`    | Changes to `packages/packs/`                 |
| `renderer` | Changes to `packages/renderer/`              |
| `device`   | Changes to `packages/device/`                |
| `daemon`   | Changes to `packages/daemon/`                |
| `hooks`    | Changes to `packages/hooks/`                 |
| `cli`      | Changes to `packages/cli/`                   |
| `art`      | `assets/clawd/`, SVG animations, pack assets |

`art` is not a package — it's the surface that carries the schedule risk, and
it lives outside `packages/`, so no package label would ever cover it. Being
able to ask "how much art has actually landed?" is the single most useful
question this label set can answer.

PRs touching several packages get several scope labels. Root-only changes (CI,
config, top-level docs) get no scope label — a type label alone is correct.

### Rules

- **Do not create ad-hoc labels.** If a new one is needed, discuss it and add
  it to this table first.
- **Exactly one type label per PR.** If a change needs two, it's two PRs.
- **Scope labels are additive**, and may be zero.

## Merge strategy

Squash merge. The PR title is the commit subject. Alex merges.

## Blast-radius files

Changes to these need a second look, because they govern how everything else is
built rather than doing work themselves:

- `CLAUDE.md` (and therefore `AGENTS.md`)
- `docs/GIT.md`, `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`
- `eslint.config.ts` (especially `boundaries/dependencies`)
- `.github/workflows/**`
- `BUILD_PLAN.md` dates
