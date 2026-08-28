# Example pack

The reference pack. Deliberately generic — this is the one pack committed to a
public repo, so it demonstrates the format and nothing else.

A pack is the customisation surface: a palette, a quip table and an optional
birthday, an optional logo and an optional pet. Further props are planned
and are not fields yet. Point `TAMACLAUDE_PACK` at a pack
directory, or put one at `~/.tamaclaude/pack/`, and the panel picks it up with
no rebuild and no reflash. What a swap actually moves is measured in
`packages/renderer/src/pack-swap.test.ts`, and it is less than "every screen":
the session chips today, with the pet sprite still to build.

A pack is the **directory**, not the manifest — `manifest.json` is a file
inside it, and a logo's source SVG is a sibling. The logo the panel reads is
*not* a sibling: it is baked into the manifest as a `logo` field, because
nothing in the shipping graph can decode an image. The pet sprite, when it
lands, will have the same shape. With no pack
configured the daemon refuses to start; there is no bundled default to fall
back to. Run `tamaclaude pack` to see which one is loaded.

The character is **not** in the pack. Clawd is shared and his colours are
baked into the sprites, so nothing here changes them: recolouring him means
editing every declared fill under `assets/clawd/` — they are not all inside
the colour groups — and re-baking, which for `splash.svg` means reflashing the
firmware rather than rebuilding a sprite. Making him swappable would mean a second animation set, and the
calendar has no room for one. See `docs/ARCHITECTURE.md` §Packs.

## `manifest.json`

| Field | Meaning |
| --- | --- |
| `name` | Identifier. Also the directory name by convention. |
| `palette` | RGB triples. **`palette[0]` is the background** — the renderer clears to it, so a pack swap changes the screen's ground with no other code involved. |
| `quips.mapped` | Keyed by **state**, not by hook event. One exception since 24 Aug: `FAILED` may also be keyed as `FAILED:<error>` — `FAILED:rate_limit` — to say something different when a usage limit is the reason. That embeds an upstream error value rather than a hook name, and it degrades gracefully: an unknown suffix falls through to the bare `FAILED` line. Fired on entering that state. **Omitting `FAILED` no longer shows the tool the session died running** — since 24 Aug the tool line is filtered to `WORKING` and `NEEDS_PERMISSION`, so a pack without a `FAILED` quip falls through to the state name instead. |
| `quips.idle` | Surfaced rarely when nothing is happening. |
| `birthday` | Optional `{ date, quip }`. `date` is `MM-DD` — no year, so it recurs. On the day the quip replaces the resting and working lines, but never a state asking for a human: a blocked session still says so. **The picture follows a stricter rule than the line does** — Clawd celebrates only when he would otherwise be idle or asleep, so a running tool keeps its own animation and the party hat waits for the gap. `02-29` is legal and falls back to the 28th in a common year. A day that exists in no month (`04-31`, `02-30`) is refused rather than accepted and silently never fired. |
| `logo` | Optional. The company mark on the laptop lid in `typing`. **Baked, not hand-written** — `pixels` and `mask` are base64 of a mode byte and an `encodeRect` payload, because nothing in the shipping graph decodes an image. Bounded by the lid at 84x20 — a bigger mark is refused rather than clipped. `node tools/logo2pixel.ts <logo.svg> --width 14 --over '#A91326' --format pack --pack <this dir>` writes the whole object; paste it in. `--over` is the lid's own colour, which is what the mark's edges snap against. |

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
