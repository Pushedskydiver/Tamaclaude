# Example pack

The reference pack. Deliberately generic — this is the one pack committed to a
public repo, so it demonstrates the format and nothing else.

A pack is the customisation surface: a palette, a quip table, props and an
optional logo. Point the config at a different pack and every screen changes,
with no rebuild and no reflash.

The character is **not** in the pack. Clawd is shared and recoloured via the
two colour groups in `assets/clawd/base.svg` — making him swappable would mean
a second animation set, and the calendar has no room for one. See
`docs/ARCHITECTURE.md` §Packs.

## `manifest.json`

| Field | Meaning |
| --- | --- |
| `name` | Identifier. Also the directory name by convention. |
| `palette` | RGB triples. **`palette[0]` is the background** — the renderer clears to it, so a pack swap changes the screen's ground with no other code involved. |
| `quips.mapped` | Keyed by **state**, not by hook event. One exception since 24 Aug: `FAILED` may also be keyed as `FAILED:<error>` — `FAILED:rate_limit` — to say something different when a usage limit is the reason. That embeds an upstream error value rather than a hook name, and it degrades gracefully: an unknown suffix falls through to the bare `FAILED` line. Fired on entering that state. |
| `quips.idle` | Surfaced rarely when nothing is happening. |

Validated by `@tamaclaude/packs` with Zod. A pack is hand-edited by whoever
owns the device, so it is a genuine trust boundary — the daemon refuses an
invalid manifest rather than coercing it.

Keying by state rather than hook is deliberate. If a hook name turns out to be
wrong or gets renamed, a state-keyed pack survives untouched while a hook-keyed
one breaks. The three hook names this project relies on —
`PermissionRequest`, `StopFailure`, `SubagentStart` — have since been confirmed
against live Claude Code documentation, but the indirection stays: it cost
nothing, and a pack should not care what the events are called.

## Why quips have two tiers

`mapped` quips land because the timing is the joke: a failure message that
appears exactly when a turn fails is funny, and the same string on a timer is
noise. `idle` quips are the opposite — they work *because* they arrive
unprompted. Putting a mapped quip in the idle pool wastes it.

## Making your own

Copy this directory to `packs/<name>/` and edit. Everything **under `packs/`**
other than `packs/example/` is gitignored, so personal packs stay off the
public repo by default. That is deliberate: logos, pets, photographs and
in-jokes belong to the people in them, not to a git history.
