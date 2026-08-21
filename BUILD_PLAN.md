# Tamaclaude — Build Plan

**Deliver:** Wednesday 23 September 2026. Immovable — it is a birthday.
**Written:** 2026-08-18 (36 days out). Research: `.claude/research/foundations/brief.md`.

## Key dates

| Date                | Milestone                                                                               |
| ------------------- | --------------------------------------------------------------------------------------- |
| Tue 18 – Wed 19 Aug | Stage 0 — repo foundations (no hardware needed)                                         |
| **Thu 20 Aug**      | Hardware arrives. Verify flash size. Measure board, brief the 3D printer.               |
| **Mon 24 Aug**      | **Harness afternoon** — hero vs two-up, message band, strip height, judged at true size |
| **Tue 25 Aug**      | **DESIGN FREEZE** — screen list, state machine, pack format locked                      |
| Mon 31 Aug          | End-to-end pipeline alive with placeholder art                                          |
| **Sun 13 Sep**      | **FEATURE FREEZE + art complete**                                                       |
| Mon 14 – Fri 18 Sep | Soak on Alex's desk. Bug fixes only, no new features.                                   |
| Sat 19 Sep          | Assemble in case, dry-run install on a clean macOS account                              |
| Sun 20 – Tue 22 Sep | **Buffer.** Unused is the goal, not waste.                                              |
| **Wed 23 Sep**      | 🎉                                                                                      |

## The always-giftable rule

Alex decided sprites are the product, not an optional layer. That decision
stands. But **every milestone from Stage 1 onward must leave a device that could
be handed over that day** — with placeholder art if necessary. This is not
scope reduction; the art still ships. It is the only thing standing between a
slipped animation and no present.

---

**Checkbox notation.** `[x]` means done. `[ ]` means not started or in
progress. `[~]` means neither — cancelled, or delivered in part with the rest
named on the line. They were all `[x]` for a while, which made the column
unreadable as progress: a cancelled item and a finished one looked identical.

## Stage 0 — Foundations (Tue 18 – Wed 19 Aug)

No hardware required.

- [x] `git init` and the GitHub remote `Pushedskydiver/Tamaclaude` — public, per Alex
- [x] pnpm workspace, Node 24, TypeScript
- [x] ESLint flat config (`typescript-eslint`, `unicorn`, `sonarjs`, `boundaries`), Prettier, husky + lint-staged, vitest, knip
- [x] CI: build / test / lint / typecheck / format:check / knip; PR title check
- [x] Gitmoji commit convention (`docs/GIT.md`)
- [x] Lean `CLAUDE.md` — trigger-phrase loading, not always-on detail
- [x] `docs/`: `CONVENTIONS.md`, `GIT.md`, `ARCHITECTURE.md`, `SELF-REVIEW.md`, `DA-REVIEW.md`
- [x] `.claude/agents/`: `spec-grill`, `da-review`, `copilot-surrogate` (ported from chief-clancy)
- [x] `CREDITS.md` — upstream clawd-tank, for both concept and animation technique
- [x] `.gitignore`: **`packs/*` except `packs/example/`**
- [x] `LICENSE` (MIT)

Package graph, enforced by `eslint-plugin-boundaries`:

```
protocol <- packs <- renderer <- daemon <- cli
protocol <- device <- daemon
protocol <- hooks
```

`A <- B` reads "B imports A". `hooks` depends on `protocol` and nothing else —
it is deliberately near-leaf, since Claude Code runs it on every hook event.

- `protocol` — wire format, RLE RGB565 encoder, dirty-rect diffing. Zero deps.
- `renderer` — virtual 172×320 screen, scene graph, sprite playback, fonts.
- `packs` — pack loader, manifest schema (zod), palette, quips.
- `daemon` — session state machine, tool→state mapping, transports.
- `hooks` — the Claude Code hook handler binary.
- `device` — USB-CDC transport + the ESP-IDF firmware source.
- `cli` — `tamaclaude status|pack|dev`.

## Stage 1 — Renderer + dev harness (Wed 19 – Mon 24 Aug)

The whole product, minus hardware.

- [x] Virtual screen: 172×320 RGB565 framebuffer in TS (`packages/renderer/src/framebuffer.ts`)
- [~] ~~`@napi-rs/canvas` sink~~ — **cancelled, not built.** The renderer
  produces a `Framebuffer`; `tools/blit.ts` turns those into packets, tests
  compare buffers, the harness draws to a canvas. A sink interface between
  them would be indirection for its own sake, and the dirty-rect path _is_
  the device sink. Also kept a native dependency out of the renderer, which
  the daemon imports.
- [x] Dev harness: local web page, scrub through frames, switch layout and
      orientation live, panel text in Departure Mono (`pnpm harness`)
- [ ] Dev harness: hot reload, scrub through **states**, and fake event
      injection. Event injection needs the daemon, so it lands with Stage 3.
      State scrubbing does not — it needs only the state→animation mapping,
      which the 25 Aug freeze produces, so it waits on the freeze rather than
      on Stage 3. The earlier split dropped "states" while keeping "frames",
      which are not the same thing: frames are the eight rasters of one loop,
      states are the ten catalogue entries the freeze locks.
- [x] Departure Mono vendored and rendering in the harness
- [x] Departure Mono bitmap rendering in the renderer, nearest-neighbour,
      `imageSmoothingEnabled = false`
- [x] Scene primitives: sprite, text, chips. **Badge, clock and progress are
      not primitives** — a clock is text, a badge is text on a `fillRect`, a
      progress track is a `drawBorder` with a `fillRect` inside. Nothing earned
      its own function, and `knip` would have failed on one that did.
- [ ] Harness draws through `render()` rather than approximating the bands —
      what makes Stage 2's exit true by construction instead of by inspection
- [ ] Pack loader + manifest schema
- [~] `packs/example/` — manifest and palette done; **placeholder art still to
  come**, and Stage 1's exit depends on it
- [x] Dirty-rect differ + RLE encoder, with unit tests and a compression-ratio assertion
- [x] **SPIKE: generate one animation from base SVG to rendered frames.** The
      panel leg of this pipeline is Stage 2 and is not done. Base SVG → LLM → animated SVG →
      frames → panel. This is the single biggest untested assumption in the plan and it sits
      on the critical path. Validate it in week one, not week four.

**Exit:** the full device experience runs in a browser tab with placeholder art, and one
real animation has been generated by the pipeline.

## Stage 2 — Hardware bring-up (Thu 20 Aug onward, parallel)

- [x] Verify actual flash size — **8MB**, upstream was right (`docs/HARDWARE.md`)
- [ ] Flash factory demo, confirm display and WS2812 work
- [ ] Measure board; send chosen STL to the printer
- [x] ESP-IDF blitter firmware: USB-CDC read loop → SPI ST7789 blit — 285 lines
      of code, landscape and portrait builds, running at 8fps with zero resyncs.
      Waveshare's demo turned out not to be needed: `esp_lcd` has an ST7789
      driver, so there was no init sequence to re-derive. What was reused from
      upstream clawd-tank is the pin map and the column-offset quirk.
- [x] Embedded splash: shown when nothing has ever driven the panel — narrower
      than "whenever no host is connected", which is not observable on this
      link and whose obvious proxy would wipe a legitimately still frame
      (`docs/HARDWARE.md`). Placeholder art; the real splash comes later.
- [~] Host-side USB-CDC transport (`packages/device/src/panel.ts`); the sink
  swap is outstanding — nothing yet drives it from a rendered frame
- [x] Measure real throughput — **562.5 KB/s**; the 700 KB/s guess was ~22%
      above it (`docs/ARCHITECTURE.md`)
- [ ] Measure sustained fps — needs the blitter firmware above

**Exit:** browser and panel show the same thing. Firmware is done and never
touched again — with one known exception, the boot splash in Stage 5, which
lives in the firmware and is still placeholder art. That is the last flash.

**Not met yet, and the gap is narrower than it looks.** The panel is composed
by `render()`; the harness is not. `tools/harness.ts` imports only the layout
helpers and approximates the bands itself, so the two agree by inspection —
which is the thing this criterion exists to rule out. A review caught a PR
claiming otherwise. Closing it means bundling the renderer into the harness
page so both ends call one function, and that is the last open Stage 1 item
that is not waiting on the design freeze.

## Stage 3 — Session pipeline (Mon 24 – Mon 31 Aug)

- [x] Hook handler binary; installer patches `~/.claude/settings.json` —
      dry-run by default, preserves foreign hooks and file mode, idempotent
- [x] Daemon: session registry, staleness eviction and multi-session
      resolution are done and pure, and something listens on the socket at last —
      the hook writes and the daemon reads. Newline-delimited JSON over many
      short-lived connections, folded into the registry and persisted beside the
      socket, so a restart mid-session does not show an empty desk. A leftover
      socket file is told from a running daemon by connecting to it rather than by
      unlinking it blind (`packages/daemon/src/socket-path.ts`).
- [ ] Daemon wired to a transport. The listener holds the registry and offers a
      snapshot; nothing yet renders it or pushes a frame down the wire, so this
      stage's exit is still open.
- [x] **Hook names confirmed against live documentation** — all three exist:
      `PermissionRequest`, `StopFailure`, `SubagentStart`. Checked against
      code.claude.com/docs/en/hooks.md rather than upstream's README, because a
      state machine keyed on a hook that does not fire is silent, not loud.
      Four findings from that check shape this stage, recorded in
      `packages/protocol/src/events.ts`: the session key is `session_id`;
      subagents ride the ordinary events carrying `agent_id` and `agent_type`
      rather than forming a separate stream; **Claude Code waits for a hook
      command to exit**, with a 600s default timeout — which confirms the
      existing "latency budget" framing rather than upgrading it. The generous
      timeout means events are not lost to slowness; it means every
      millisecond of `tamaclaude-notify`'s startup is paid by the user,
      synchronously, many times per turn. (Note the docs also use "blocking" in
      a second sense — whether a hook can _veto_ an action via exit code 2 —
      and by that sense `PermissionRequest` and `StopFailure` do not block. The
      two senses are unrelated.) Finally, `Stop` fires on every response rather
      than at task completion and `StopFailure` ignores exit code and output
      entirely, so "the turn finished" is not observable the way Stage 4's
      Model 3 payoff assumes.

- [x] Tool → state mapping (`PreToolUse.tool_name`)
- [x] Multi-session compositing — resolution ranks by state, hero plus chips
- [~] Subagent lifecycle counted in the registry; the badge is drawn from
  placeholder text until the daemon feeds the scene
- [~] `PermissionRequest` → the state and the quip exist; **the animation does
  not** — `permission sign` is unbuilt (Stage 4, item 7)
- [~] `StopFailure` → the state, `error_type` and the quip exist; **the
  animation does not** — `dizzy` is unbuilt (Stage 4, item 9)
- [ ] **Remote transport** — TCP + shared secret, so Jamie's Raspberry Pi agent appears on the
      display. _Last item in the stage and explicitly cuttable_ — design the protocol for it
      from day one (cheap), but ship it only if Stage 4 is on schedule.
- [ ] launchd agent; `brew` tap formula. **The CLI reads `packs/example`
      by a repo-relative path** and that breaks the moment it is installed
      somewhere else — its smoke test cannot catch it, because the test only
      ever runs from the repo. Packaging is where a pack must come from a
      configured location instead.

**Exit:** real Claude Code sessions drive the panel, placeholder art.

## Stage 4 — Art (Mon 24 Aug – Sun 13 Sep, overlapping)

The long pole. Runs in parallel with Stage 3 from week two.

- [ ] **The environment: a rock pool, through the day.** Plan in
      `assets/clawd/animations/PLANS.md`. A renderer layer behind every
      animation (`docs/ANIMATION.md` §Clawd lives somewhere) — one place, with
      the sky carrying dawn/day/dusk/night as a palette swap. He is currently
      animating on black, which reads as an asset preview rather than a
      creature in a place. **Do this early.** It changes how every animation
      reads, and judging animations against a black stage is judging them in
      the wrong context.

**Budget: 8 review days across Stages 4-5, not 2 days per animation.** The
grill killed the per-animation box: generation is embarrassingly parallel — one
`PLANS.md` entry produces one SVG independently, and Alex runs concurrent
sessions — so the serial bottleneck is review at true size, not authoring.
Generate in batches, review in batches against each plan's "Not wanted" line.

**Ordered by measured frequency, not by guess.** Across 1,046 real Claude
Code transcripts and 44,954 tool calls: `Bash` is 63.9%, `Read` 17.6%,
`Edit`/`Write` 7.9%, `WebSearch`/`WebFetch` 5.5%, `Agent` 0.7%, `mcp__*` 0.3%.
So `gym` is the single most-watched working screen on the device by a factor
of three over the next one, and `typing` — the animation built first and
polished most — is seen about an eighth as often. `Grep` and `Glob` do not
appear at all in 44,954 calls, so `bouldering`'s trigger is `Read` alone.

**If Tier A is not complete by Sun 6 Sep, Tier B is abandoned in full** rather
than partially. Eight good screens beat nine plus four rough ones.

- [x] `assets/clawd/base.svg` — canonical geometry, stable element IDs (upstream's file, see `CREDITS.md`)
- [x] `PLANS.md` — prose spec per animation (action / body mechanics / eyes / effects)
- [ ] TS generator: base SVG + example + plan → LLM → animated SVG, under the
      constraint that it may only add transforms and keyframes to existing IDs
- [x] Playwright SVG→PNG frame renderer (`tools/svg2frames.ts`)
- [ ] Palette quantise; RLE pack
- [x] Animations, in priority order — ship each as it lands:
  1. idle ✅ / asleep ✅
  2. thinking
  3. typing ✅ (Edit/Write)
  4. bouldering ✅ (Read)
  5. gym ✅ (Bash)
  6. **Model 3 pulls up (Stop)** — the payoff. Fallback if it is not landing:
     a static red-car frame with Clawd beside it and the quip, which is 90% of
     the joke at 10% of the risk. "Do not cut" previously disarmed the only
     mitigation this plan names for its own top art risk.
  7. Permission sign, and confused — Tier A per the screen spec; both were
     missing from every tier in its first draft despite being the two screens
     the whole design principle exists to serve
  8. sweeping (PreCompact)
  9. dizzy (StopFailure)
  10. wizard (WebSearch/WebFetch) — 5.5% of real tool calls
  11. board game (Agent/subagents) — 0.7%, the least-seen of the screens that
      have a measured trigger. Six catalogue entries fire on hook events or
      timers and have no tool-call frequency at all, so this is not a claim
      about the whole catalogue
  12. road bike (long runs)

**`Stop` does not mean "the turn finished".** Confirmed against live docs in
Stage 3: it fires on every response. So the Model 3 payoff above cannot be
keyed on it as written, and needs a different trigger — most likely a quiet
period after the last event, which the daemon can see and a hook cannot.

## Stage 5 — Personalisation (Sun 6 – Sun 13 Sep)

- [ ] The recipient's pack (gitignored): palette, quips, logo, pet sprite
- [ ] Pet sprite from Alex's photos — background prop on idle/asleep, not the mascot
- [ ] Company logo → pixel: SVG → nearest-neighbour → palette quantise (`sharp`)
- [ ] Quips mapped to states, never randomised
- [ ] Rare easter eggs: a franchise-flavoured idle, plus idle quips from the pack
- [ ] Pixel-Alex-and-Jamie coding scene — rare trigger only (birthday, past midnight).
      Recognition via silhouette, palette and props; facial likeness is not achievable at ~50px per figure.
- [ ] Birthday screen, date-triggered 23 Sep
- [ ] **The boot splash — design it together, then bake it into the firmware.**
      It is the first thing Jamie ever sees: before the daemon starts, before a
      single session runs, at the moment the box is opened. Today it is a
      placeholder whose only job was proving the 34-pixel offset landed on the
      right axis, and it has done that job.
      **It is also the last thing needing a reflash.** Stage 2's exit claims the
      firmware is never touched again, and the splash lives inside it — so it
      must be settled before that line is true, not discovered on the 19th.
      It has to be drawn _by the firmware_, since the whole point is that it
      appears with no host connected. Likely route: compose it in the renderer,
      dump the framebuffer, vendor the bytes — which reuses all of Stage 1.

- [ ] `packs/alex/` — proves the pack swap works

## Stage 6 — Hardening + gift prep (Mon 14 – Sat 19 Sep)

- [ ] Run it on Alex's desk all week. Fix what irritates. No new features.
- [ ] Assemble board in printed case
- [ ] Dry-run the full install on a clean macOS user account
- [ ] Printed card: QR to repo + one-line install
- [ ] Flash the gift board (not the dev board) with the splash

---

## Deliberately not scheduled

| Deferred                                          | Re-entry condition                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| macOS menu bar app                                | Needs a native shim or Electron, which reintroduces Gatekeeper and code signing. Post-birthday. |
| BLE transport                                     | USB-CDC is simpler and truly plug-and-play. Only if untethered operation is ever wanted.        |
| Wi-Fi provisioning                                | Kills plug-and-play. Only if the device needs to live away from the Mac.                        |
| microSD asset storage                             | Host renders, so the device stores nothing but the splash.                                      |
| `docs/INDEX.md`, `docs/decisions/`, `PROGRESS.md` | Adopt if the project outlives 23 Sep.                                                           |
| Notarised `.app` (£79/yr)                         | Only if a menu bar app is ever built.                                                           |

## Risks

| Risk                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The recipient discovers the repo.** `Pushedskydiver/Tamaclaude` is public, and GitHub pushes repository-creation events into the feed of everyone following Alex. He is a tech-savvy AI enthusiast. | **Accepted, not mitigated.** Alex judged the risk low and chose public deliberately. The compensating controls are that `packs/` and `.claude/research/` are both gitignored, and that the tracked docs name no pets, quips or interests. An earlier version of this row credited `packs/` alone, which was wrong — the specs carrying that material were never in `packs/`. **Accepted in full, including history.** The material is still reachable from earlier commits, and from GitHub's `refs/pull/*/head`, which are retained permanently — rewriting `main` would not remove it, since every merged PR ref keeps its own copy. Alex was shown this and chose to leave it. |
| LLM SVG generation loop doesn't produce usable output                                                                                                                                                 | Spike it in Stage 1 (week one), not Stage 4. Fallback: Aseprite by hand, or upstream's MIT-licensed SVGs as a base to modify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| One animation eats a week                                                                                                                                                                             | Batch-generate, batch-review against each plan's "Not wanted" line. Hard gate: if Tier A is not complete by Sun 6 Sep, Tier B is abandoned in full. The per-animation time-box this row used to name was retired by the spec grill — generation is parallel, review is the bottleneck.                                                                                                                                                                                                                                                                                                                                                                                            |
| Only one board ordered — no spare if it's damaged or bricked                                                                                                                                          | Firmware is flashed once and never changes, so the exposure is lower than upstream's design. Still: order a second this week, it's a week's lead time to replace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ESP-IDF toolchain eats a day                                                                                                                                                                          | Start from Waveshare's working demo. Timebox to one day; the panel is the only thing blocked, and the browser sink keeps everything else moving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Case print slips                                                                                                                                                                                      | STLs already identified; brief the printer Thu 20 Aug. Bare board is an acceptable fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Open

- Semantics of the three unmapped idle quips — needed to decide whether any of
  them deserves a state rather than the random pool
- Confirmation that personal packs stay out of the public repo
