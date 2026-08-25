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
- `packs` — manifest schema (zod), palette, quips. Not a loader: reading a
  pack off disk is the CLI's job (`packages/cli/src/pack.ts`).
- `daemon` — session state machine, tool→state mapping, transports.
- `hooks` — the Claude Code hook handler binary.
- `device` — USB-CDC transport + the ESP-IDF firmware source.
- `cli` — `tamaclaude daemon <device>`, `tamaclaude pack`, and a bare smoke
  run. `status` and `dev` were named here from Stage 0 and never built.

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
      orientation live (`pnpm harness`). It drew panel text in Departure Mono
      until 25 Aug; it now draws no panel text at all, because drawing text the
      renderer also draws is what made it a second panel renderer
- [ ] Dev harness: hot reload, scrub through **states**, and fake event
      injection. Event injection needs the daemon, so it lands with Stage 3.
      State scrubbing does not — it needs only the state→animation mapping,
      which the 25 Aug freeze produces, so it waits on the freeze rather than
      on Stage 3. The earlier split dropped "states" while keeping "frames",
      which are not the same thing: frames are the eight rasters of one loop,
      states are the ten catalogue entries the freeze locks.
- [x] Departure Mono vendored — `CREDITS.md`, and `tools/make-font-atlas.ts`
      turns it into the renderer's bitmap glyphs. It no longer renders _in the
      harness_: that page stopped drawing panel text on 25 Aug
- [x] Departure Mono bitmap rendering in the renderer, nearest-neighbour,
      `imageSmoothingEnabled = false`
- [x] Scene primitives: sprite, text, chips. **Badge, clock and progress are
      not primitives** — a clock is text, a badge is text on a `fillRect`, a
      progress track is a `drawBorder` with a `fillRect` inside. Nothing earned
      its own function, and `knip` would have failed on one that did.
- [~] **No tool composes a _scene_ outside `render()`** — which is most of what
  Stage 2's exit ("browser and panel show the same thing") asks for. Landed
  25 Aug by deletion, not by either option this line used to cost. Left at
  `[~]` because two things below are open.
  Both costed options were wrong, and a grill found why. (a) "bundle the
  renderer into the page" rested on a spike I could not reproduce and whose
  figures did not agree with each other; what is verifiable is the
  mechanism, not the number — `packages/renderer/src/framebuffer.ts` and
  `band.ts` value-import `packPalette` from `packages/packs`, whose module
  scope builds zod schemas, so a browser bundle of the renderer drags a
  schema validator behind it. Measured with the repo's own bundler (vite /
  rolldown, `node_modules/.bin/vite`), zod is roughly three-quarters to
  four-fifths of that graph. (b) "pre-render whole panels" undercounted
  badly: the cross-product of the harness's nine draw-affecting controls is
  in the thousands to tens of thousands depending on which are held fixed,
  and the prose that said "roughly ten thousand" was quoting one accounting
  of several without saying which.
  And neither could have worked. `sceneFor` lives in `packages/cli`, and
  `eslint.config.ts` allows `tools` → `tools | renderer | packs | protocol`,
  so a tool must hand-build its `Scene` either way — "true by construction"
  was never reachable by making a second drawer more faithful.
  `tools/panel-mock.ts` was the worst offender, because it is the artefact
  that goes into pull requests and it hardcoded `#0d1117` and `#c9d1d9`
  hand-synced to the example pack's palette. It now composes through
  `composePanels`, and the page only unpacks RGB565 onto a canvas. It draws
  all four skies, the strip's five-plus-overflow worst case, and takes
  `--message` so a long MCP tool name can be put through the real wrapper.
  `tools/harness.ts` keeps sprite scrubbing and draws band _outlines_ from
  `panelBands()`, with no contents. No new dependency; the three tool files
  lose 43 non-comment lines and gain 14 total.
  **Open, and why this is `[~]`:** 1. **Two review artefacts still paint a flat backdrop** — `contact-sheet.ts`
  and the harness — where the device paints the environment edge to edge
  (`ENVIRONMENT_EXTENT = 'panel'`), so it shows a colour the panel never
  displays. Both now say so in place of claiming to be the panel's
  ground, but `docs/ANIMATION.md` still routes the mandatory
  `animation-critic` to them and names neither `panel-mock`. 2. **Band heights are unjudged and two-up has no artefact.** The screen
  spec still reads "**Book** the afternoon of Mon 24 Aug in the dev
  harness"; `BAND_HEIGHTS.message` has not moved since 18 Aug. An earlier
  version of this entry asserted that session had happened and that its
  conclusion was unsound — inventing both. `composePanels` hardcodes
  `layout: 'hero'`, so no tool can now render two-up at true size, which
  the spec calls "a genuine trade rather than a settled rejection".
  `daemon.ts`'s `layout: 'hero'` is a bare literal with no rationale
  anywhere, unlike `landscape` next to it, which carries a dated record.
- [x] Manifest schema (zod) in `packages/packs`; pack resolution in
      `packages/cli/src/pack.ts` — `TAMACLAUDE_PACK`, then
      `~/.tamaclaude/pack/`, then a hard error. **`packages/packs` is still
      not a loader**, deliberately: it validates a manifest someone else read,
      which keeps one trust boundary rather than two. This line went
      `[ ]` → `[~]` → `[x]`. The `[~]` was the 24 Aug birthday commit, after
      reviews found the loader half was a repo-relative `readFileSync` that
      broke on any install. An earlier version of this sentence said the box
      "went back to `[~]`", which no ref supports — it went forward to it.
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

**Most of the way, and the remainder is named rather than hidden.** Every tool
that composes a _scene_ now does it through `render()` — see the Stage 1 entry
above, which landed 25 Aug by deleting the competing draws rather than by
bundling the renderer into a page, the fix this paragraph used to prescribe.
What is left is that two review artefacts still paint a flat backdrop behind
transparent frames where the device paints scenery, and that `docs/ANIMATION.md`
still routes the animation critic to them. That is a smaller and more specific
gap than "the harness approximates the bands", but it is not nothing, and it is
the one an art review actually walks into.

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
      figures and they are the stale copy** — thirteen animations and 840 frames now
      measure 56,448,000 raw and 2,510,452 encoded. `tools/bake-sprites.ts` and
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
      standing and `dizzy` reaches the panel. Checked 24 Aug against the same live
      documentation, which says it in a verb — "Runs _instead of_ Stop when the
      turn ends due to an API error". Still unobserved: a live hook capture on
      22 Aug caught no `StopFailure` at all, which is evidence about how rare
      they are and none about ordering.

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
      The error is stored and, since 24 Aug, read: `rate_limit` and
      `overloaded` draw `overheated`, the other eight documented values keep
      `dizzy`. The field is kept because it arrives once and cannot be
      recovered
- [ ] **Remote transport** — TCP + shared secret, so the recipient's Raspberry Pi agent appears on the
      display. _Last item in the stage and explicitly cuttable_ — design the protocol for it
      from day one (cheap), but ship it only if Stage 4 is on schedule.
- [x] **The pack comes from a configured location.** `TAMACLAUDE_PACK`, else
      `~/.tamaclaude/pack/`, else refuse to start — `packages/cli/src/pack.ts`.
      The repo-relative `readFileSync` is gone, so the binary no longer depends
      on being run from a checkout. **There is no bundled default pack**, and
      that is the load-bearing decision: a fallback would turn "you forgot to
      point at your pack" into a panel that works, looks right, and carries the
      example pack's generic quips and no birthday. A spec review killed the
      fallback this design originally had, on the grounds that it _was_ the
      silent-wrong-pack failure rather than a guard against it.
- [~] **launchd agent built; `brew` tap deliberately not.** `tamaclaude
install-agent` writes `~/Library/LaunchAgents/com.tamaclaude.daemon.plist`
  — dry run by default, `--apply` to install, modelled on
  `tamaclaude-install-hooks`. It resolves the pack _before_ writing, because
  an agent installed where no pack exists would exit 2 on every start and
  `KeepAlive` cannot tell exit 2 from exit 1 (launchd sees zero versus
  non-zero only), so it would restart forever writing into a log nobody
  opens. `bootout` precedes `bootstrap` so a second install cannot leave
  the first agent running with stale arguments.
  **The plist runs `process.execPath`, not the shebang.** `#!/usr/bin/env
node` plus launchd's `PATH=/usr/bin:/bin:/usr/sbin:/sbin` fails to spawn
  on any machine using a version manager, which is this one — silently,
  every ten seconds, forever.
  **No brew tap.** A second repo, a formula, a versioned tarball and
  un-privating the package, for one Mac. `git clone && pnpm install` is not
  a one-line install either: it needs Xcode CLT, node and pnpm first. The
  decision is to install it in person and let the printed card be a
  keepsake carrying something true — the repo QR and "if it ever stops,
  open Terminal and run `tamaclaude pack`".
  `tamaclaude status` asks launchd whether it is actually running, and says so
  when the node it was installed with has been upgraded away — the failure a
  version-pinned `process.execPath` creates, and the one `tamaclaude pack`
  cannot see because it runs under the shell's node. `install-agent --apply`
  runs the same check rather than claiming success: `bootstrap` exiting 0 means
  _loaded_, not running, and the likeliest install-day failure is a daemon
  already running by hand, which makes the agent die on `already listening` and
  restart every thirty seconds while the installer says it worked. Reproduced
  and fixed.
  `tamaclaude uninstall-agent` stops it and deletes the plist, because an agent
  with `RunAtLoad` comes back at every login and the only way off otherwise is
  `launchctl bootout` typed correctly by someone who knows it exists — which is
  not the person this is a gift for.
  **The moved-port case is closed, and not the way this line first proposed.**
  macOS derives `/dev/cu.usbmodem1101` from the USB port, so moving the panel
  one socket along changes its path and the reconnect loop would retry the old
  one forever — glass holding its last frame, `tamaclaude pack` still correct,
  nothing red, on every desk move. The recorded fix was to thread discovery
  into `packages/device/src/panel.ts`. A review argued for a cheaper one that
  reuses what this item already installs: bound the consecutive failures,
  exit non-zero, and let `KeepAlive` restart the process, which runs discovery
  again from scratch. `openPanel` takes `giveUpAfter`; the plist passes
  `daemon --supervised`; a hand-typed daemon still retries forever, because a
  person watching a terminal does not want it exiting under them.
  **If this slips, the agreed fallback is not "add a default pack" but
  "fall back and say so on the glass"** — the message band already exists
  and `describePack` already composes the line. A review made the case:
  after 23 Sep the asymmetry inverts, since a missing birthday costs one
  day a year and a panel that will not start costs every day, and a
  crash-looping launchd agent writing to a log nobody reads is not louder
  than a fallback, only differently silent. Recorded now so the argument
  does not have to happen in the last week.

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
  6. **The payoff screen** ✅ — a vehicle parked at his left, overlapping, and
     a claw laid on it once per loop. Named by role rather than by make and
     colour: this repo is public, the vehicle is on the interests list in the
     gitignored brief, and `CLAUDE.md` says tracked docs name personal content
     by role, never by content. It read as the make and colour in ten places
     across five tracked files until 24 Aug.
     **Parked, not pulling up** — this line said "pulls up" until the art
     landed, and `frameAt` is wall-clock modulo, so a state never starts at
     frame 0 and an arrival would re-arrive every loop at a random phase.
     **And the pack cannot supply it.** Sprites bake fixed pixels;
     `packPalette` recolours bands only. Whatever the SVG draws is what every
     install shows, so "from the recipient's pack" was never achievable as
     written — recognition comes from shape and context, and the tracked art
     carries no mark identifying a specific vehicle.
     The fallback this line used to name is moot: the trigger shipped seven hours
     before the art — same day, `9fd31c3` at 11:22 and `6540a86` at 18:33 — and
     `DONE` borrowed `idle` in between, so the risk it was written against
     never arrived. An earlier version said a fortnight, which `main`'s history
     does not contain: it starts on 18 Aug. Item 12 already made this exact
     correction for `overheated`.
  7. Permission sign, and confused ✅ — Tier A per the screen spec; both were
     missing from every tier in its first draft despite being the two screens
     the whole design principle exists to serve. A `spec-grill` found both
     plans unbuildable before any code moved: the sign wanted a rotated claw to
     reach above the head, which the geometry forbids, and `confused` wanted a
     6deg body tilt against a 2.5deg one already recorded as reading like a
     corrupted sprite
  8. sweeping (PreCompact) — **art landed 25 Aug, wiring deliberately not.**
     No ✅ because the item is not done: `sweeping` is in `SPRITE_NAMES` and
     absent from `ANIMATIONS`, with no `COMPACTING` in `SESSION_STATES` and no
     `PreCompact` registered in `hook-settings.ts`, which is
     the "art first, wiring last" order this list asks for. Recorded because the
     6 Sep gate above is read off this list and the character of it has
     changed — the art is sunk cost now, so cutting saves only the wiring, which
     `assets/clawd/animations/PLANS.md` §Sweeping costs as cross-package and
     atomic. That section also holds the rank decision the wiring depends on:
     `COMPACTING` ranks **below the attention states**, not at the frozen spec's
     tier 1, because a two-minute tier-1 screen would cover a permission prompt
  9. dizzy ✅ (StopFailure) — **taken out of order, ahead of 6 and 8.** It is
     the last state that was on the fallback, so building it is Stage 3
     correctness (the `[x]` in Stage 3) rather than Stage 4 art, and the 6 Sep
     Tier A gate above governs what gets cut, not what gets pulled forward. Recorded here
     because this list is what the 6 Sep decision is read off, and a plan that
     calls a shipped item deferred will mislead exactly that decision
  10. ✅ wizard (WebSearch/WebFetch) — 5.5% of real tool calls. Built 24 Aug;
      the `TOOL_ANIMATIONS` wiring landed with the art rather than after it,
      against the "art first, wiring last" note below
  11. ✅ board game (`Agent`) — 0.7%, the least-seen of the screens that
      have a measured tool-call frequency. Nine of the catalogued screens fire on
      hook events or timers and have no tool-call frequency at all, so this is
      not a claim about the whole catalogue — and not about triggers either:
      `overheated`'s is measured too, at ~0.1% of sessions, which item 12 says
      leaves "no 'rarest catalogued' to be rarer than". An earlier version of
      this line said six, which no enumeration of the catalogue produces. Art landed 25 Aug at 11:07 and the
      `TOOL_ANIMATIONS` entry at 12:23 — one hour sixteen, the tightest of the
      three art-then-wiring gaps against `overheated`'s three hours and the
      payoff's seven. That is this list's own "art first, wiring last" rule
      followed rather than broken. The trigger was
      `Agent`/subagents until 25 Aug, when a live capture settled it as `Agent`
      alone at a two second loop: keyed on `subagents > 0` it would have been on
      for 53% of the panel's waking life
  12. ✅ **overheated (`StopFailure` with `error_type` `rate_limit` or `overloaded`)** — proposed
      on 22 Aug, not part of the original catalogue, and therefore a change to
      this plan rather than work under it. It is the cheapest screen left:
      the error has been stored since Stage 3, so the trigger needed no new
      event, no settings change and no protocol field — only for `animationFor`
      to refine `FAILED` by it the way it already refines `WORKING` by `tool`.
      Wired 24 Aug, and the wire field turned out to be `error` rather than the
      `error_type` assumed since Stage 3, so nothing had ever reached it. Tier B, behind the 6 Sep gate with
      the rest, and the first thing to cut if that gate is at risk: `dizzy`
      drew every `StopFailure` before this, so cutting it loses a distinction
      rather than leaving a state blank. **Art first, wiring last** — the
      wiring lands in `packages/daemon`, which Stage 3 marks done, so building
      it first means either reverting shipped code at the gate or leaving a
      dead branch behind. Art landed at 08:58 and wiring at 12:01, both on 24 Aug — the order held,
      which is the part that matters, but they were hours apart rather than
      days. Through `spec-grill` once; the first plan was found
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
  13. road bike (long runs) — **Tier C, not B.** `spec.md` puts it with
      `beacon` under "stretch — cut without regret". A plan written on 24 Aug
      called it Tier B and was corrected: it is the most expensive item in the
      catalogue (the first prop that carries him, and there is no seated pose
      in the corpus), and it has no trigger — nothing measures duration. If it
      is ever attempted, the cheap wiring is an elapsed field on `Refinement`
      in `animation.ts`, branching inside the `WORKING` arm, rather than a new
      state in `effectiveState`.

**`Stop` does not mean "the turn finished".** Confirmed against live docs in
Stage 3: it fires on every response. So the payoff screen above cannot be
keyed on it as written. **It has a different trigger now, and this is no longer
speculation:** a quiet period after the last event, which the daemon can see and
a hook cannot — `DONE_AFTER_MS` and `DONE_SHOWN_MS` in `effectiveState`, landed
24 Aug with the `DONE` state.

## Stage 5 — Personalisation (Sun 6 – Sun 13 Sep)

- [ ] The recipient's pack (gitignored): palette, quips, `birthday`, logo, pet
      sprite. Goes at `~/.tamaclaude/pack/` or wherever `TAMACLAUDE_PACK`
      points; `tamaclaude pack` confirms which, and prints the countdown.
- [ ] **Set the Mac's clock to 23 Sep during the dry run and watch the panel.**
      The only end-to-end test the birthday can ever have: the recipient's pack
      is gitignored, so CI will never load it, and `isBirthday` reads the host's
      local date. Five minutes, and it exercises resolution, schema, the
      message band and the panel in one action.
- [ ] Pet sprite from Alex's photos — background prop on idle/asleep, not the mascot
- [ ] Company logo → pixel: SVG → nearest-neighbour → palette quantise (`sharp`)
- [ ] Quips mapped to states, never randomised
- [ ] Rare easter eggs: a franchise-flavoured idle, plus idle quips from the pack
- [ ] Pixel scene of the two of them coding — rare trigger only (birthday, past midnight).
      Recognition via silhouette, palette and props; facial likeness is not achievable at ~50px per figure.
- [~] Birthday screen, date-triggered 23 Sep. **The trigger is built; the
  screen is not, and no tracked pack carries a date.** `packs` takes an
  optional `birthday: { date, quip }` keyed `MM-DD` so it recurs, and
  `isBirthday` compares in local time because the day the panel should
  celebrate is the one the person beside it is having. `02-29` falls back
  to the 28th in a common year, and a day that exists in no month is
  refused — both because accepting a date that can never fire is a failure
  nobody can notice until the day has passed.
  The quip beats the resting and working lines and loses to any state
  asking for a human. **That is not the rule `DONE` is ranked by**, and
  two earlier versions of this line said it was: `DONE` ranks below
  `WORKING` because "a payoff belongs on a quiet desk", and this covers
  both. They share only the attention half. The reason to differ is that
  rank decides the stage, where a resting Clawd over a running tool would
  be a lie, while this decides the message band and the animation still
  shows the work. Two reviews caught the claim independently.
  What remains: the art on the line above, and a pack that actually carries a
  date. Selection itself is built — `TAMACLAUDE_PACK`, else
  `~/.tamaclaude/pack/` — so the trigger is reachable as soon as a pack names
  a date. What is not built is anything that _sets_ the variable on boot; that
  is the launchd item in Stage 3. This paragraph said the mechanism was
  missing and cited the Stage 1 line for it, in the same stage whose first item
  already said where the pack goes; the commit that built the resolver left the
  contradiction standing and a review caught it. An earlier version of this
  sentence put the two five lines apart, which is wrong by about thirty.
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
- [ ] Dry-run the full install on a clean macOS user account. **Bring this
      forward — it is the highest-information hour left in the plan.** The
      untested assumption under everything else is that a Mac which is not this
      one can build and run the repo at all: Xcode CLT, node 24.16.0, pnpm, a
      full `tsc -b`. Finding out on 19 Sep leaves four days, and the recovery
      for "no toolchain" is a packaging project rather than a bug fix.
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
