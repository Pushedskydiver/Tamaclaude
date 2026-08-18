# Screen catalogue — spec

**Status:** draft for grilling. Freeze target **Tue 25 Aug 2026**.
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

A session is `{ id, origin, state, tool, lastEventAt, subagents }`.

`origin` is `local` or a remote host name. Jamie runs a Claude Code agent on a
Raspberry Pi media server, and that session appearing on the desk — _your house
is thinking_ — is the most personal feature available for near-zero cost, so
long as the transport accepts remote events from day one. Remote sessions carry
a distinct tint on the strip.

Sessions are evicted after **10 minutes** with no event.

## 4. Hero resolution

Evaluated on every event. First match wins.

1. **Pre-emptive oneshots** — `DONE` and `COMPACTING` seize the stage for their
   duration regardless of anything else, then resolution runs again. These are
   the payoff and the punctuation; interrupting them defeats the point.
2. **Needs you** — awaiting permission, or failed, or idle 60s+ awaiting input.
3. **Working** — most recently active.
4. **Thinking**.
5. **Idle**, then **asleep**, then **disconnected**.

Within a tier, most recent wins. Ties break to the longest-running session, on
the grounds that it is the one you have most likely forgotten about.

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

`WORKING` sub-states, keyed on `PreToolUse.tool_name`:

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

Art is the critical path with a 2-day hard time-box each, so the catalogue is
tiered and the tiers are a shipping decision, not a wish list.

- **Tier A — must ship (7):** idle, asleep, thinking, typing ✅, bouldering,
  gym, **Model 3**. This set alone is a device worth giving.
- **Tier B — target (4):** wizard, board game, sweeping, dizzy. Takes it to the
  11 in `BUILD_PLAN.md`.
- **Tier C — stretch (2):** road bike, beacon. Cut without regret.

The Model 3 is in Tier A deliberately. It is the once-per-turn payoff and the
single most personal frame in the device; a version without it is worse than a
version missing three working animations.

## 7. Quips

Two tiers, because the tiering _is_ the joke.

**Mapped** — fired on a specific state, where the timing is what lands:

| State              | Quip                        |
| ------------------ | --------------------------- |
| `FAILED`           | `Turrrby, Turrrby, Turrrby` |
| `NEEDS_PERMISSION` | `Wansum?`                   |

**Idle pool** — surfaced rarely, unprompted, roughly 1 idle loop in 20:
`your mum`, `Beajilpig`, `Vaglig`, `Burst Pistol`.

Quips render in the message band for 4s. Both tiers live in the pack, so Alex's
pack carries different text and no code changes.

## 8. Easter eggs

Rare by design. Constant references stop being funny; that is the entire
argument for keeping the personal material as set dressing rather than system.

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

All configurable via the pack manifest except frame rate, which is fixed by the
animation format.

## 10. Explicitly out of scope for v1

| Deferred                           | Why                                                                                                  | Re-entry                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Notification cards and dismissal   | There is no input device — the protocol is output-only, so a card could never be cleared             | If the BOOT button is wired as an input channel |
| Multiple full-size sprites         | Four crabs at 43px each on a 172px panel reads as mush, and would need every animation at two scales | Never, at this panel size                       |
| Per-session animation on the strip | Five animated mini-Clawds is five times the blit for a 15px sprite                                   | If bandwidth measurements say it is free        |
| Menu bar app                       | Needs a native shim or Electron, reintroducing a signed `.app`                                       | Post-birthday                                   |

## 11. Open questions

1. **Is one hero plus a strip actually better than upstream's four sprites?**
   Upstream shows four concurrent Clawds and it demonstrably works on the same
   panel. This spec argues that at 172px wide it reads as mush and doubles the
   art, but that is an assertion — upstream is evidence against it.
2. **Is `DONE` pre-empting correct?** If Jamie has four sessions finishing in a
   row, the stage is a Model 3 on a loop for eight seconds while real work goes
   unshown. Should repeated `DONE`s within a window collapse into one?
3. **Does `WAITING` at 60s fire too often?** Claude Code asks for input
   constantly. This could be the single most-seen screen, which would make the
   confused animation Tier A rather than B.
4. **Is the message band worth 64px?** It is a fifth of the panel for text that
   is empty most of the time. The alternative is a taller stage and quips
   overlaid on it.
5. **Does the strip earn 32px** when Alex and Jamie mostly run 2–3 sessions?
6. **`PermissionRequest`, `StopFailure`, `SubagentStart` are unverified**
   against live Claude Code docs (`BUILD_PLAN.md` Stage 3). If
   `PermissionRequest` does not exist, the `Wansum?` screen loses its trigger
   and needs rehoming onto `Notification`.
