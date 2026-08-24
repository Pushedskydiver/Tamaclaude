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
- [x] ESP-IDF blitter firmware: USB-CDC read loop → SPI ST7789 blit — 312 lines
      of code, running at 8fps with zero resyncs. Landscape is what ships; a
      portrait build needs portrait splash artwork and a re-bake first, and a
      `_Static_assert` refuses to compile without them rather than stretching
      the landscape picture.
      Waveshare's demo turned out not to be needed: `esp_lcd` has an ST7789
      driver, so there was no init sequence to re-derive. What was reused from
      upstream clawd-tank is the pin map and the column-offset quirk.
- [x] Embedded splash: shown when nothing has ever driven the panel — narrower
      than "whenever no host is connected", which is not observable on this
      link and whose obvious proxy would wipe a legitimately still frame
      (`docs/HARDWARE.md`). Real art since Stage 5's entry below; the
      placeholder's border and corner marker did their job and are gone.
- [x] Host-side USB-CDC transport (`packages/device/src/panel.ts`), driven from
      a rendered frame by `tamaclaude daemon` (Stage 3). The sink swap was the
      outstanding half and it landed with that command
- [x] Measure real throughput — **562.5 KB/s**; the 700 KB/s guess was ~22%
      above it (`docs/ARCHITECTURE.md`)
- [ ] Measure sustained fps — needs the blitter firmware above

**Exit:** browser and panel show the same thing. Firmware is done and never
touched again — that second clause is now unconditional: the one known
exception, the boot splash, was taken in Stage 5 below on 21 Aug, sixteen days
before the stage it was scheduled in even opens. The exit itself is still not
met, for the reason immediately below; the splash closed the firmware
question, not the parity one.

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
- [x] **Verified on the real panel, 21 Aug 2026.** `tamaclaude daemon
/dev/cu.usbmodem1101` drove the flashed device end to end: the link
      reached `online` with no refusal, so the firmware's geometry agrees with
      the 320x172 landscape the host sends. Alex watched the glass through a
      four-event session and saw the clock, the session chips, and the message
      band going `Bash` -> `may I?` -> `well, that happened`. That is the first
      time anything has driven the hardware, and the first confirmation the
      picture is right rather than merely that bytes moved.
- [x] Daemon wired to a transport — `tamaclaude daemon <device>`
      (`packages/cli/src/daemon.ts`). The listener's snapshot is resolved into a
      scene, rendered to a framebuffer, diffed against the last one and sent as
      a single dirty rect at 8fps. The clock, the session chips, the subagent
      badge, the message band and the stage are all live.
- [x] **The stage.** Clawd is on it. `tools/bake-sprites.ts` reads the frames
      `tools/svg2frames.ts` rasterises into a gitignored `out/` and writes them
      as generated modules inside `packages/renderer/src/sprites/`, which the
      daemon loads on demand and indexes by the clock. All six animations, all
      360 frames, verified decoding back to the source PNGs with zero pixel and
      zero mask mismatches — and seen animating on the real panel.
      The raw art was 24,192,000 bytes of RGB565 plus the same again halved for
      the mask, and encoded it shipped as 1,128,216. **Those are the six-animation
      figures and they are the stale copy** — ten animations and 664 frames now
      measure 44,620,800 raw and 1,918,964 encoded. `tools/bake-sprites.ts` and
      `packages/renderer/src/sprites/index.ts` carry the live numbers with a
      caveat that only a re-bake refreshes them; this line had neither. Size was never going to be what
      limited how many animations this device gets, though it was quoted as
      though it might be.
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
      synchronously, many times per turn. **Measured on 22 Aug, once hooks were
      installed on a real machine: ~42 ms an event, 38 ms of it bare Node
      startup and 3.2 ms the hook's own module graph.** At four to ten events a
      turn that is 0.2-0.4 s per turn, and essentially none of it is reachable
      by the import discipline this line was written to justify. (Note the docs also use "blocking" in
      a second sense — whether a hook can _veto_ an action via exit code 2 —
      and by that sense `PermissionRequest` and `StopFailure` do not block. The
      two senses are unrelated.) Finally, `Stop` fires on every response rather
      than at task completion and `StopFailure` ignores exit code and output
      entirely, so "the turn finished" is not observable the way Stage 4's
      payoff screen assumes. **`Stop` and `StopFailure` are alternatives, not a
      sequence** — at most one fires per turn — so a failed turn leaves `FAILED`
      standing and `dizzy` reaches the panel. Checked 24 Aug against the same
      live documentation; still unobserved, because three hours of hook capture
      caught 156 events and no `StopFailure` at all.

- [x] Tool → state mapping (`PreToolUse.tool_name`)
- [x] Multi-session compositing — resolution ranks by state, hero plus chips
- [x] Subagent lifecycle counted in the registry, and the badge is fed from it
      — `subagentText` in `packages/cli/src/daemon.ts` sums `subagents` across live
      sessions
- [x] `PermissionRequest` → state, quip and animation. `permission-sign` is
      built, baked and wired (`NEEDS_PERMISSION` in `packages/daemon/src/animation.ts`),
      and `WAITING` got `confused` in the same pass — both Tier A, both through
      `animation-critic`
- [x] `StopFailure` → the state, `error_type` and the quip exist, and `dizzy`
      is built, baked and wired (`FAILED` in `packages/daemon/src/animation.ts`).
      `error_type` is stored and still read by nothing: all three of
      `rate_limit`, `overloaded` and `authentication_failed` show one picture.
      That is the state/animation split working as designed, not a gap — the
      field is kept because it arrives once and cannot be recovered
- [ ] **Remote transport** — TCP + shared secret, so the recipient's Raspberry Pi agent appears on the
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

- [x] **The environment: a rock pool, through the day.** Built, and wired into
      `sceneFor` on 22 Aug — it was reachable from nothing before that, which
      is how four animations shipped with holes for eyes that only a
      non-black stage could reveal. The extent is a constant (`panel`); a pack
      field for it is Stage 5 below. Plan in
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
      generation contract in `docs/ANIMATION.md` §The generation contract —
      motion is CSS by ID, props and effects may add elements, and a pose
      variant may be drawn where no transform reaches the pose. This line
      previously said "may only add transforms and keyframes to existing IDs",
      which is the ban that section retired; `CLAUDE.md` carried the same
      wording and was corrected on 22 Aug, and this was the third copy
- [x] Playwright SVG→PNG frame renderer (`tools/svg2frames.ts`)
- [x] Palette quantise (`3be0c30`); RLE pack (the sprite bake)
- [x] Animations, in priority order — ship each as it lands:
  1. idle ✅ / asleep ✅
  2. thinking ✅
  3. typing ✅ (Edit/Write)
  4. bouldering ✅ (Read)
  5. gym ✅ (Bash)
  6. **The payoff screen** — the vehicle from the recipient's pack
     pulls up. Named by role rather than by make and colour: this repo is
     public, the vehicle is on the interests list in the gitignored brief, and
     `CLAUDE.md` says tracked docs name personal content by role, never by
     content. It read as the make and colour in ten places across five
     tracked files until 24 Aug. Fallback if it is not landing: a static frame with the vehicle
     parked and Clawd beside it and the quip, which is 90% of the joke at 10%
     of the risk. "Do not cut" previously disarmed the only
     mitigation this plan names for its own top art risk.
  7. Permission sign, and confused ✅ — Tier A per the screen spec; both were
     missing from every tier in its first draft despite being the two screens
     the whole design principle exists to serve. A `spec-grill` found both
     plans unbuildable before any code moved: the sign wanted a rotated claw to
     reach above the head, which the geometry forbids, and `confused` wanted a
     6deg body tilt against a 2.5deg one already recorded as reading like a
     corrupted sprite
  8. sweeping (PreCompact)
  9. dizzy ✅ (StopFailure) — **taken out of order, ahead of 6 and 8.** It is
     the last state that was on the fallback, so building it is Stage 3
     correctness (the `[x]` in Stage 3) rather than Stage 4 art, and the 6 Sep
     Tier A gate above governs what gets cut, not what gets pulled forward. Recorded here
     because this list is what the 6 Sep decision is read off, and a plan that
     calls a shipped item deferred will mislead exactly that decision
  10. wizard (WebSearch/WebFetch) — 5.5% of real tool calls
  11. board game (Agent/subagents) — 0.7%, the least-seen of the screens that
      have a measured trigger. Six catalogue entries fire on hook events or
      timers and have no tool-call frequency at all, so this is not a claim
      about the whole catalogue
  12. **overheated (`StopFailure` with `error_type` `rate_limit` or `overloaded`)** — proposed
      on 22 Aug, not part of the original catalogue, and therefore a change to
      this plan rather than work under it. It is the cheapest screen left:
      `error_type` has been stored since Stage 3 and read by nothing, so the
      trigger needs no new event, no settings change and no protocol field —
      only for `animationFor` to refine `FAILED` by `errorType` the way it
      already refines `WORKING` by `tool`. Tier B, behind the 6 Sep gate with
      the rest, and the first thing to cut if that gate is at risk: `dizzy`
      already draws every `StopFailure`, so cutting this loses a distinction
      rather than leaving a state blank. **Art first, wiring last** — the
      wiring lands in `packages/daemon`, which Stage 3 marks done, so building
      it first means either reverting shipped code at the gate or leaving a
      dead branch behind. Through `spec-grill` once; the first plan was found
      unbuildable and rewritten around a sploot pose, which is upstream's scene
      and which `docs/ANIMATION.md` §The generation contract names as its own
      example. Plan in `PLANS.md`. Measured after the first
      draft of this entry went in without one: across 1,030 local transcripts
      outside this project a usage limit was hit in **one session**, ~0.1% of
      sessions. That does not divide against item 11's 0.7%, which is of _tool
      calls_ — and item 11 says in as many words that its figure is "not a claim
      about the whole catalogue", so there is no "rarest catalogued" to be
      rarer than. What can be said is that this is the only entry whose trigger
      was counted in sessions at all, and one in a thousand is rare by any
      reading. Salience rather than frequency is its case, as with item 7
  13. road bike (long runs)

**`Stop` does not mean "the turn finished".** Confirmed against live docs in
Stage 3: it fires on every response. So the payoff screen above cannot be
keyed on it as written. **It has a different trigger now, and this is no longer
speculation:** a quiet period after the last event, which the daemon can see and
a hook cannot — `DONE_AFTER_MS` and `DONE_SHOWN_MS` in `effectiveState`, landed
24 Aug with the `DONE` state.

## Stage 5 — Personalisation (Sun 6 – Sun 13 Sep)

- [ ] The recipient's pack (gitignored): palette, quips, logo, pet sprite
- [ ] Pet sprite from Alex's photos — background prop on idle/asleep, not the mascot
- [ ] Company logo → pixel: SVG → nearest-neighbour → palette quantise (`sharp`)
- [ ] Quips mapped to states, never randomised
- [ ] Rare easter eggs: a franchise-flavoured idle, plus idle quips from the pack
- [ ] Pixel scene of the two of them coding — rare trigger only (birthday, past midnight).
      Recognition via silhouette, palette and props; facial likeness is not achievable at ~50px per figure.
- [ ] Birthday screen, date-triggered 23 Sep
- [x] **The boot splash — design it together, then bake it into the firmware.**
      Clawd waving beside the wordmark, landscape, chosen by Alex from four
      rendered candidates on 21 Aug. The far claw is tucked because at its
      base position it sits mid-body on the opposite side and reads as a
      snout — which only became visible once a pose raised the other one.
      **It was also the last firmware change**, and it is flashed — built
      clean and confirmed on the panel. One flash remains scheduled, Stage 6's
      gift board, but it writes this same firmware to different hardware.
      The predicted route was "compose it in the renderer, dump the
      framebuffer, vendor the bytes". What shipped reuses the _asset_ pipeline
      instead of the renderer: `assets/clawd/splash.svg` is posed off
      `base.svg` with transforms like every animation, and
      `tools/bake-splash.ts` rasterises it, snaps it to the declared palette
      and RLE-encodes it with `encodeRect` — the same codec `decode_rle()`
      already consumes, so `draw_splash()` is a loop over the `fill()` that was
      already there and no new wire format exists to be wrong. 2,892 bytes of
      `.rodata`, 38.1:1.
      The wordmark is drawn from the renderer's own glyph table rather than
      set as `<text>`. Chromium antialiases glyph outlines at every size, and
      review found the soft edges snapping to Clawd's body salmon — 120 pixels,
      11% of the wordmark's ink, in a stripe along the top of "tama". Inside
      the palette, so no palette check could see it.
      `tools/bake-splash.test.ts` is the gate, because the firmware is in none
      of the six and almost nothing else can be. It asserts where each colour
      lands, and a hash of the artwork, so neither an upside-down table nor a
      header left stale after an edit can pass — both of which an earlier
      version of it did.

- [ ] Environment as a pack field — extent (`stage` or `panel`) and eventually
      the schemes. `docs/ANIMATION.md` gives "a pack can change it" as one of
      the four reasons scenery is a renderer layer, and today a pack can change
      nothing about it: `ENVIRONMENT_EXTENT` is a constant in
      `packages/cli/src/daemon.ts`. Deferred there deliberately rather than
      taken in the same pass as wiring the scenery on at all
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

| Risk                                                                                                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The recipient discovers the repo.** `Pushedskydiver/Tamaclaude` is public, and GitHub pushes repository-creation events into the feed of everyone following the author, and the recipient follows this kind of work closely. | **Accepted, not mitigated.** Alex judged the risk low and chose public deliberately. The compensating controls are that `packs/` and `.claude/research/` are both gitignored, and that tracked docs add no new personal detail — `CLAUDE.md` carries the rule and enumerates what is already there. This row used to say tracked docs "name no pets, quips or interests", which was false when written: four interests are animation names across 25, 18, 4 and 2 tracked files, and the catalogue is built from them. An earlier version of this row credited `packs/` alone, which was wrong — the specs carrying that material were never in `packs/`. **Accepted in full, including history.** The material is still reachable from earlier commits, and from GitHub's `refs/pull/*/head`, which are retained permanently — rewriting `main` would not remove it, since every merged PR ref keeps its own copy. Alex was shown this and chose to leave it. |
| LLM SVG generation loop doesn't produce usable output                                                                                                                                                                          | Spike it in Stage 1 (week one), not Stage 4. Fallback: Aseprite by hand, or upstream's MIT-licensed SVGs as a base to modify.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| One animation eats a week                                                                                                                                                                                                      | Batch-generate, batch-review against each plan's "Not wanted" line. Hard gate: if Tier A is not complete by Sun 6 Sep, Tier B is abandoned in full. The per-animation time-box this row used to name was retired by the spec grill — generation is parallel, review is the bottleneck.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Only one board ordered — no spare if it's damaged or bricked                                                                                                                                                                   | Firmware is flashed once and never changes, so the exposure is lower than upstream's design. Still: order a second this week, it's a week's lead time to replace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ESP-IDF toolchain eats a day                                                                                                                                                                                                   | Start from Waveshare's working demo. Timebox to one day; the panel is the only thing blocked, and the browser sink keeps everything else moving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Case print slips                                                                                                                                                                                                               | STLs already identified; brief the printer Thu 20 Aug. Bare board is an acceptable fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Open

- Semantics of the three unmapped idle quips — needed to decide whether any of
  them deserves a state rather than the random pool
- Confirmation that personal packs stay out of the public repo
