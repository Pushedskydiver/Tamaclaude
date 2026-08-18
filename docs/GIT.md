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
