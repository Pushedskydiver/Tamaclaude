# Screen catalogue — spec

**Status:** revision 2, after one `spec-grill` discovery round. Freeze target
**Tue 25 Aug 2026**. §12 records what the grill changed and what it killed.
**Governs:** the ten remaining animations, the daemon's state machine, and the
panel layout. Everything downstream of the freeze reads this file.

---

## 1. The governing principle

A desk display's job is not to show what the computer is doing. It is to tell
you **when to look**.

That single line decides most of what follows. The panel is in peripheral
vision almost all the time, so its only real jobs are: be pleasant when nothing
needs you, and be unmissable when something does. Every priority rule below
derives from it, and it is the tie-breaker for anything the grill turns up.

The corollary is that **the hero slot belongs to whichever session most needs a
human**, not to the most recent one. A session blocked on a permission prompt
outranks four sessions happily working, because only one of them is costing you
time by being unseen.

## 2. Panel layout

172 x 320 portrait. Four bands, no scrolling, no overlap.

| Band    | y       | Height | Contents                                       |
| ------- | ------- | ------ | ---------------------------------------------- |
| Status  | 0–23    | 24px   | Clock (left), subagent count (right)           |
| Stage   | 24–223  | 200px  | The hero animation, 168px wide at x 2–169      |
| Strip   | 224–255 | 32px   | One mini-Clawd per session, up to 5, then `+N` |
| Message | 256–319 | 64px   | Quip, tool label, or state text                |

The stage is exactly the 21 x 25 unit canvas at 8 device pixels per unit that
`docs/ANIMATION.md` fixes, which is why animations are authored at that size and
no scaling happens at blit time.

Mini-Clawd on the strip is the same base geometry at 1px per unit — 15 x 16px.
Five of them plus gaps is 99px, leaving room for the overflow badge. They are
tinted by state, not separately animated: one shared frame, recoloured.

## 3. Session model

A session is
`{ id, origin, state, tool, startedAt, lastEventAt, subagents, oneshotUntil }`.

`startedAt` drives the tier-2 tie-break; `oneshotUntil` is the expiry a
pre-emptive oneshot needs and previously had nowhere to live.

`origin` is `local` or a remote host name. Jamie runs a Claude Code agent on a
Raspberry Pi media server, and that session appearing on the desk — _your house
is thinking_ — is the most personal feature available for near-zero cost, so
long as the transport accepts remote events from day one. Remote sessions carry
a distinct tint on the strip.

Sessions are evicted after **10 minutes** with no event.

## 4. Hero resolution

Evaluated on every event. First match wins.

1. **Pre-emptive oneshots** — `DONE` and `COMPACTING` seize the stage until
   `oneshotUntil`, regardless of anything else. These are the payoff and the
   punctuation; interrupting them defeats the point.

   **On expiry the session transitions to `IDLE`, not back to itself.** Without
   that, tier 1 re-matches on the next evaluation and one finished session
   loops the Model 3 forever.

   **Repeated `DONE`s inside one window collapse.** A second `Stop` while
   `oneshotUntil` is in the future extends nothing and re-triggers nothing —
   four sessions finishing in a row is one Model 3, not eight seconds of them.

2. **Needs you** — awaiting permission, or failed, or idle 60s+ awaiting input.
3. **Working** — most recently active.
4. **Thinking**.
5. **Idle**, then **asleep**, then **disconnected**.

Within tier 2, **oldest wins**. §1 says the display exists to surface what is
costing you time by going unseen, and an eight-minute-old permission prompt is
costing more than one raised ten seconds ago. Within every other tier, most
recent wins.

This needs `startedAt` on the session record, which §3 previously omitted.

## 5. State machine

| State              | Trigger                       | Animation                               | Tier          |
| ------------------ | ----------------------------- | --------------------------------------- | ------------- |
| `NEEDS_PERMISSION` | `PermissionRequest`           | Clawd holds up a sign                   | 2             |
| `FAILED`           | `StopFailure`                 | Dizzy                                   | 2             |
| `WAITING`          | 60s idle after `Notification` | Confused, stares at you                 | 2             |
| `DONE`             | `Stop`                        | **Red Model 3 pulls up, Clawd hops in** | 1, oneshot 2s |
| `COMPACTING`       | `PreCompact`                  | Sweeping                                | 1, oneshot 2s |
| `WORKING`          | `PreToolUse`                  | By tool, see below                      | 3             |
| `THINKING`         | `UserPromptSubmit`            | Gears, slow sway                        | 4             |
| `IDLE`             | Connected, no active session  | Clawd loafing, **Penny asleep**         | 5             |
| `ASLEEP`           | No session for 5 min          | Curled up                               | 5             |
| `DISCONNECTED`     | No host                       | Static message                          | 5             |

`WORKING` sub-states. The first three rows are **session conditions**, checked
before the tool table and in this order; the rest key on `PreToolUse.tool_name`,
first match wins:

| Tools                         | Animation                           | Why it fits Jamie                            |
| ----------------------------- | ----------------------------------- | -------------------------------------------- |
| `Read` `Grep` `Glob`          | Bouldering                          | Indoor climbing — reaching for the next hold |
| `Edit` `Write` `NotebookEdit` | Typing ✅ built                     | —                                            |
| `Bash`                        | Gym, heavy lifting                  | Gym                                          |
| `WebSearch` `WebFetch`        | Wizard                              | Upstream's, and it's good                    |
| `Agent` / subagents active    | Board game, moving pieces           | Board games                                  |
| `mcp__*` `LSP`                | Beacon                              | —                                            |
| Any tool, same session >90s   | **Road bike, scrolling background** | Cycling — loops forever naturally            |

## 6. Build order

Art is the critical path. The tiers are a shipping decision, not a wish list.

- **Tier A — must ship (9):** idle, asleep, thinking, typing ✅, bouldering,
  gym, **Model 3**, **permission sign**, **confused**.
- **Tier B — target (4):** wizard, board game, sweeping, dizzy.
- **Tier C — stretch (2):** road bike, beacon. Cut without regret.

The permission sign and the confused stare were absent from every tier in
revision 1 — the two screens that _are_ §1's governing principle had no art
budget at all. They are Tier A now. `WAITING` in particular may be the
most-seen screen on the device, since Claude Code asks for input constantly.

**The 2-day-per-animation box was the wrong model.** Generation is
embarrassingly parallel — `base.svg` plus a `PLANS.md` entry produces an SVG
independently per animation, and Alex runs concurrent sessions. The bottleneck
is **review at true size**, which is serial and needs the harness. So:

- Generate in batches, review in batches, against `PLANS.md`'s "Not wanted"
  line rather than against taste.
- The budget is **8 review days** across Stages 4–5, not 2 days per animation.
- If Tier A is not complete by **Sun 6 Sep**, Tier B is abandoned in full
  rather than partially. Eight good screens beat nine plus four rough ones.

Two Tier A entries are secretly larger than one animation each, and both need
their scope written down before the freeze:

**Model 3** is a new multi-rect object with no base geometry to animate against,
whose entire value is reading as _a Model 3_ rather than "a red car", plus a
full-stage translate, plus a non-looping oneshot format the pipeline has never
produced. Four novel problems in one slot, on the item `BUILD_PLAN.md` marks
"do not cut" — which disarms the only mitigation the risk register names.
**Fallback, decided now:** if it is not landing, ship a static red-car frame
with Clawd beside it and the quip. That is 90% of the joke at 10% of the risk,
and it is a decision made calmly today rather than at midnight on 22 September.

**Idle** is two loops (idle, asleep) plus **Penny**, who is a second character
designed from photographs and was filed in the easter-egg table as "one
background prop". Penny is Tier A art, not set dressing, and she is the
reason idle is budgeted as three slots rather than one.

## 7. Quips

Two tiers, because the tiering _is_ the joke.

**Mapped** — fired on a specific state, where the timing is what lands:

| State              | Quip                        |
| ------------------ | --------------------------- |
| `FAILED`           | `Turrrby, Turrrby, Turrrby` |
| `NEEDS_PERMISSION` | `Wansum?`                   |

**Idle pool** — surfaced rarely and unprompted: `your mum`, `Beajilpig`,
`Vaglig`, `Burst Pistol`.

**Cadence is wall-clock, never loop counts.** Revision 1 said "1 idle loop in
20", which at a 1.0s loop is one every twenty seconds — 180 airings an hour of
four jokes, in a document whose §8 opens "rare by design". The rule is: **at
most one idle quip every 3 minutes**, and never twice in a row from the same
entry. Quips render in the message band for 4s.

Mapped quips are keyed by **state**, not by hook name. This matters because of
§11.6: if `PermissionRequest` turns out not to exist and the screen rehomes onto
`Notification`, a state-keyed pack survives untouched and a hook-keyed pack
breaks. `packs/example/manifest.json` currently keys by hook and must be
changed before the freeze.

## 8. Easter eggs

Rare by design, and rarity is measured in **minutes of wall clock**, not loop
counts. Constant references stop being funny; that is the entire argument for
keeping the personal material as set dressing rather than system.

| Egg                        | Trigger                               | Cost                   |
| -------------------------- | ------------------------------------- | ---------------------- |
| Penny asleep in the corner | Always, on `IDLE`/`ASLEEP`            | One background prop    |
| Avatar meditation pose     | 1 idle loop in 50                     | One idle variant       |
| Pixel Alex + Jamie coding  | Session running past midnight         | One scene, Tier C      |
| Birthday screen            | 23 Sep                                | One static frame       |
| Company logo               | Splash, before host software connects | Logo pixelation script |

No Marvel or Avatar artwork ships in the public repo; the meditation pose is an
original silhouette, and anything franchise-flavoured lives in Jamie's
gitignored pack.

## 9. Timing

| Thing                         | Value            |
| ----------------------------- | ---------------- |
| Frame rate                    | 8fps, 1.0s loops |
| `DONE` / `COMPACTING` oneshot | 2s               |
| Quip display                  | 4s               |
| `WAITING` threshold           | 60s              |
| Long-run → road bike          | 90s              |
| Idle → asleep                 | 5 min            |
| Session eviction              | 10 min           |

**None of these are pack-configurable.** Revision 1 claimed they were, which
would have meant new schema, validation and tests for knobs nobody will ever
turn — nobody retunes a 60-second threshold via JSON on a birthday present. They
are constants in `packages/daemon`. The pack manifest stays `name`, `palette`,
`quips` plus props and logo.

## 10. Explicitly out of scope for v1

| Deferred                           | Why                                                                                                  | Re-entry                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Notification cards and dismissal   | There is no input device — the protocol is output-only, so a card could never be cleared             | If the BOOT button is wired as an input channel |
| Multiple full-size sprites         | Four crabs at 43px each on a 172px panel reads as mush, and would need every animation at two scales | Never, at this panel size                       |
| Per-session animation on the strip | Five animated mini-Clawds is five times the blit for a 15px sprite                                   | If bandwidth measurements say it is free        |
| Menu bar app                       | Needs a native shim or Electron, reintroducing a signed `.app`                                       | Post-birthday                                   |

## 11. Open questions

Three of revision 1's six were answerable by arithmetic or measurement rather
than opinion, and are now answered. What remains:

1. **Can these animations actually be made?** The base geometry has no joints —
   four 1x2 leg rects and two 2x2 claws — and rotation is banned. Revision 1
   specified a gear that cannot turn, a broom that cannot swing and a reach with
   no elbow. `docs/ANIMATION.md` now documents **pose swapping**: draw the
   rotated states as additional axis-aligned rects and toggle them by opacity,
   which is how pixel art has always done rotation. That is a plausible answer,
   not a proven one — **the next animation built should be `thinking`,
   specifically because it is the one that most needs it.**
2. **What is the worst-case dirty area per frame?** The Model 3 crossing the
   stage and the road bike's scrolling background dirty the full 168x200 every
   frame: ~537 KB/s uncompressed against a 700KB–1MB/s ceiling. RLE on flat
   pixel art should rescue it, but nothing here has measured a ratio, and the
   14:1 figure is upstream's whole-corpus number. Stage 1 must measure before
   two full-stage animations are committed to.
3. **Is the message band worth 64px** — a fifth of the panel for text that is
   empty most of the time?
4. **Does the strip earn 32px** when Alex and Jamie mostly run 2–3 sessions?
5. **`PermissionRequest`, `StopFailure`, `SubagentStart` and `LSP` are
   unverified** against live Claude Code documentation. `LSP` in particular
   appears nowhere else in this repo and may not be a tool name at all. If
   `PermissionRequest` does not exist, `NEEDS_PERMISSION` rehomes onto
   `Notification` — which then drives both it and `WAITING` with no
   disambiguator, so that fallback needs designing, not just naming.

### Answered since revision 1

**Four concurrent sprites are arithmetically impossible, not merely ugly.**
Revision 1 argued "43px each reads as mush", which is a number nobody would
build. The real constraint is `docs/ANIMATION.md`'s pixel-exactness rule — a
translation is only exact when `distance x scale / frameCount` is whole. Typing's
data bits rise 14 units over 8 frames:

| Scale | Sprite | Four-up | Bits move     | Legal?                       |
| ----- | ------ | ------- | ------------- | ---------------------------- |
| 2     | 30px   | 120px   | 3.5 px/frame  | no — sub-pixel               |
| 4     | 60px   | 240px   | 7.0 px/frame  | yes, but 240px > 172px panel |
| 8     | 120px  | 480px   | 14.0 px/frame | hero only                    |

The only legal scales are 4 and 8; four-up needs 240px on a 172px panel. Two-up
at scale 4 _does_ fit, and §10 records why it was still not taken.

**Quip and easter-egg cadence** was specified in loop counts, which made "rare"
mean every twenty seconds. Now wall-clock. See §7.

**`WAITING` frequency** decided the tier rather than staying an open question:
it is Tier A precisely because it is likely the most-seen screen.

## 12. What the grill changed

Recorded rather than absorbed, so the freeze is auditable.

**Killed outright:** the "43px reads as mush" argument, replaced by a proof;
pack-configurable timings; loop-count rarity.

**Added:** `NEEDS_PERMISSION` and `WAITING` to Tier A (they had no art budget
anywhere despite being the governing principle); a default row on the `WORKING`
table (every unlisted tool previously mapped to nothing); `startedAt` and
`oneshotUntil` on the session record; oneshot expiry and collapse rules; the
Model 3 fallback; Penny as Tier A art rather than set dressing; pose swapping in
`docs/ANIMATION.md`; a stage height check in `tools/svg2frames.ts`.

**Still open and honestly so:** whether pose swapping actually works, and the
dirty-area budget. Both are measurements, and both are scheduled before they
can hurt.

## 13. The one thing to do first

**Book the afternoon of Mon 24 Aug in the dev harness**, the day before the
freeze. Three questions — hero-vs-two-up, message band height, strip height —
are all answerable by looking at real frames at true size for an hour, and are
otherwise frozen as opinions. `docs/ANIMATION.md` is explicit that judging at
the wrong size means redoing eleven animations instead of one.

The remaining unknowns are measurements scheduled to happen before they can
hurt. That is the difference between a freeze and a guess.
