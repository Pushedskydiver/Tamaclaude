# Example pack

The reference pack. Deliberately generic — this is the one pack committed to a
public repo, so it demonstrates the format and nothing else.

A pack is the entire customisation surface: a character, a palette, an
animation set and a quip table. Point the config at a different pack and every
screen changes, with no rebuild and no reflash.

## `manifest.json`

| Field | Meaning |
| --- | --- |
| `name` | Identifier. Also the directory name by convention. |
| `palette` | RGB triples. **`palette[0]` is the background** — the renderer clears to it, so a pack swap changes the screen's ground with no other code involved. |
| `quips.mapped` | Keyed by hook event. Fired at that exact moment. |
| `quips.idle` | Surfaced rarely when nothing is happening. |

Validated by `@tamaclaude/packs` with Zod. A pack is hand-edited by whoever
owns the device, so it is a genuine trust boundary — the daemon refuses an
invalid manifest rather than coercing it.

## Why quips have two tiers

`mapped` quips land because the timing is the joke: a failure message that
appears exactly when a turn fails is funny, and the same string on a timer is
noise. `idle` quips are the opposite — they work *because* they arrive
unprompted. Putting a mapped quip in the idle pool wastes it.

## Making your own

Copy this directory to `packs/<name>/` and edit. Everything outside
`packs/example/` is gitignored, so personal packs stay off the public repo by
default. That is deliberate: logos, pets, photographs and in-jokes belong to
the people in them, not to a git history.
