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
  `[~]` because the second of the two things below is still open.
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
  `panelBands()`, with no contents. No new dependency, and no bundler.
  A line count was quoted here across three revisions and was wrong in two of
  them, because the set of files it covered kept changing under it; what is
  true and stable is that the panel-drawing code shrank and the comment around
  it grew.
  **Open, and why this is `[~]`:**

  1. **Closed 25 Aug.** `contact-sheet.ts` composed its frames over a flat
     `#0d1117` — a `packs/example` palette entry copied by hand — where the
     device paints the environment edge to edge (`ENVIRONMENT_EXTENT = 'panel'`).
     It is the artefact the mandatory `animation-critic` reads, so every
     animation review since the environment landed judged art against a
     background the panel cannot display, which is the failure this plan
     already records four animations shipping through.
     It now composes each frame through `render()` and crops to the stage slot,
     so a reviewer sees the sprite on its real ground and still sees the frames
     side by side. `--sky` picks the scheme; `day` is the hard case for a
     _pale_ prop, its sand measuring 19.1 against dusk's 6.5. The harness keeps a backdrop and says so — it draws no bands
     and is for motion, and `docs/ANIMATION.md` plus the critic's own step 4
     send a reviewer to `panel-mock` for context.
     `tools/one-panel-renderer.test.ts` is the gate that was missing, and
     `contact-sheet.ts` has come off its allowlist rather than staying on it
     harmlessly.
  2. **Hero versus two-up is open, and is now answerable by looking.**
     `composePanels` hardcoded `layout: 'hero'` until 25 Aug, so nothing could
     compose a two-up _panel_ through `render()`. The comparison was not
     impossible — `tools/harness.ts` has always scrubbed two-up sprites at true
     size against real slots, with two _different_ animations, which is the one
     thing the new picture cannot do. And `panel-mock` drew two-up until PR #52
     removed it earlier the same day, so this restores a capability rather than
     adding one. `panel-mock --layout twoUp` is that picture — real
     environment, real bands, all four skies, true size and enlarged. Two-up
     draws at scale 4, so it needs frames baked there
     (`node tools/svg2frames.ts <svg> <outDir> 4`), which `composePanels` now
     says in its error rather than failing obscurely.
     The decision itself is still open. `daemon.ts`'s `layout: 'hero'` is a
     bare literal with no rationale anywhere, unlike the `landscape` beside it,
     which carries a dated record; the spec calls two-up "a genuine trade
     rather than a settled rejection". Either that literal gets a reason or
     two-up gets cut, and there is now something to decide from.
     The band heights are in better shape than an earlier version of this entry
     claimed. Landscape derives its message band as `height - (status + strip)`
     = 116px and consumes only `BAND_HEIGHTS.status` and `.strip`;
     `BAND_HEIGHTS.message` = 64 reaches `portraitBands()` alone and so ships
     nowhere. `panel-mock` shows both shipping bands, at the strip's
     five-plus-overflow worst case, and `--message` puts a long MCP name
     through the real wrapper. So the freeze's landscape inputs are judgeable
     today; what is unjudged is a portrait constant that does not ship.

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
What is left is the harness, which paints a flat backdrop behind transparent
frames where the device paints scenery — deliberately, since it draws no bands
and exists to scrub motion, and both `docs/ANIMATION.md` and the critic's own
step 4 now send a reviewer elsewhere for context. A much smaller gap than "the
harness approximates the bands", and a chosen one.

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
      figures and they are the stale copy.** So was the thirteen-animation copy
      that replaced them: measured 25 Aug, there are fourteen animations and 936
      frames, 62,899,200 raw and 2,744,512 encoded — the thirteen-animation
      total plus `sweeping` exactly. `tools/bake-sprites.ts` and
      `packages/renderer/src/sprites/index.ts` were said to "carry the live
      numbers"; they carry the caveat and their own stale copies, at ten and
      thirteen animations. A figure that has now gone stale three times in one
      file is a figure to stop quoting: re-derive it from the `.data.ts` files
      when it is wanted. Size was never going to be what
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
- [~] ~~**Remote transport**~~ — **cut, 25 Aug.** TCP + shared secret, so a
  remote Claude Code agent would appear on the display.
  **This reverses a decision, and says so rather than dressing it as the
  plan's own escape clause firing.** The line carried a condition from the
  first commit that ever contained this file — "_Last item in the stage and
  explicitly cuttable_ — design the protocol for it from day one (cheap),
  but ship it only if Stage 4 is on schedule" — and a first version of this
  entry claimed that condition had fired. It has not. Stage 4 had one
  unchecked box at the time and it was a _tool_, cut on 25 Aug, so the count is
  now zero; every Tier A animation exists, twelve days before the 6 Sep gate. That version also said the catalogue was
  "hand-drawn", which contradicts `docs/ANIMATION.md` — the animations are
  LLM-authored CSS against a fixed geometry, and hand-drawing is the risk
  register's untaken fallback. Both claims were wrong and both made the cut
  look automatic when it is a judgement.
  `.claude/research/foundations/brief.md` calls remote sessions a headline
  feature and the screen spec puts `origin` in the frozen session model, so
  this overrides the brief. The reasons it is still right: - **The install is on hardware nobody here owns.** `tamaclaude-notify`
  would have to run on the other machine — second OS and arch, Node
  there, reachability — untestable before the gift. - **The shared secret is a trust-boundary redesign, not a transport.**
  `socket-server.ts` states the invariant that nothing may be kept per
  peer; per-connection auth state contradicts it directly. The socket's
  whole access model is the file mode, which no TCP port inherits. - **It would force a retune of `DEADLINE_MS`.** The hook's 150ms budget
  is justified against a local socket write, and it sits on the user's
  synchronous path — on a link nobody could test. - Being wrong costs nothing before 23 Sep, and the fallback is that the
  panel shows local sessions, which is the whole product.
  **What the cut does not undo.** The wire framing is transport-agnostic
  and stays paid: newline-delimited JSON over many short-lived connections
  (`socket-server.ts` is explicit that it is not one stream). The _secret_
  half has no design anywhere — the phrase occurs only in this line — so
  "the design half is done" is true of framing and false of authentication.
  There is also a version needing no code at all: an SSH `RemoteForward` of
  the Unix socket would deliver real remote events, since `TAMACLAUDE_SOCKET`
  is already the only agreement between hooks and daemon. Untested, and it
  would not light the hollow chip, because the daemon cannot tell where a
  line came from.
  `SessionOrigin` and the strip's hollow chip are kept: the field costs one
  word at each construction site, and the strip has few spare visual axes.
  `packages/renderer/src/strip.test.ts` pins the branch — a first version
  of this entry called it "built and tested" when nothing asserted it.
  Nothing on the _host_ produces a remote session; the panel could never
  produce any session at all. The re-entry condition is in the deferred
  table.
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

**Every top-level box is settled as of 25 Aug** — six `[x]` and the cut
generator at `[~]`, nineteen days before the stage ends. **That is not the same
as closed**, and a first version of this paragraph said closed while two
sub-items were open. Both are settled now: item 8's wiring landed the same
evening its art did, and item 13 is cut under the Tier C licence `spec.md`
already gave it. **So the stage is closed — 25 Aug, nineteen days early.** It
has no `**Exit:**` line to close against, so what that means precisely is that
every top-level box is settled and no numbered sub-item is open.

Recorded because the opposite was asserted the same day: the remote-transport
cut was justified on "Stage 4 is not on schedule", which was false when written.
The animations are LLM-authored CSS against a fixed geometry, but "authored
through §The authoring loop" would be its own retrofit — four predate the loop
by two days, and `CLAUDE.md` records six shipping with no critic at all.

- [x] **The environment: a rock pool, through the day.** Built, and wired into
      `sceneFor` on 22 Aug — it was reachable from nothing before that, which
      is how four animations shipped with holes for eyes that only a
      non-black stage could reveal. The extent is a constant (`panel`), chosen
      in that same 22 Aug commit; the pack field that would have exposed the
      other was cut on 25 Aug — see the deferred table. Plan in
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
- [~] ~~TS generator: base SVG + example + plan → LLM → animated SVG~~ —
  **cut, 25 Aug.** It would have automated `docs/ANIMATION.md` §The
  authoring loop, which is a documented agent procedure. That loop has
  already produced the entire catalogue — fourteen animations, all of them
  CSS against `base.svg` under §The generation contract — so the tool would
  wrap a process that demonstrably works when invoked by hand.
  **This is not the plan's condition firing; nothing conditioned it.** It is
  a judgement that a tool automating a working loop is worth less than the
  days it costs, with 29 left. Nothing depends on it: the only reference in
  the tree was this line. Most of Stage 5's remaining art does not want it — a
  pixel scene is a drawing and the logo is a quantiser pass — but the pet
  sprite is a background prop _on idle and asleep_, so it lands inside two
  existing animated SVGs, and the spec calls it Tier A art rather than set
  dressing. That and the easter-egg idle are animation work.
  What it would have bought is repeatability across a _series_, which matters
  when many are left. **Two are**, item 13's road bike having been cut since:
  the franchise-flavoured easter-egg idle (Stage 5, unchecked) and the spec's
  meditation idle variant. Two is not a series and each is one pass of the loop
  — but a first version of this line said "there are none" and called the
  easter-egg idle hypothetical when it is a scheduled box.
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
  8. sweeping ✅ (PreCompact) — **art 25 Aug, wiring the same day.** The
     wiring was held back so the art could land on its own — five merges and
     5h40m apart, not the one commit a first version of this line claimed.
     `COMPACTING` is in `SESSION_STATES` at rank 5, `PreCompact` is registered
     in `hook-settings.ts`, and `sweeping` is in `ANIMATIONS`.
     It cost what `assets/clawd/animations/PLANS.md` §Sweeping said it would —
     cross-package and atomic. Adding the state made `tsc` fail in **four**
     exhaustive tables across two packages: `STATE_RANK`, `STATE_ANIMATIONS`,
     `TONE` and `TOOL_STATES`, which is the number §Sweeping predicted and
     named. A first version of this line said three and dropped
     `STATE_ANIMATIONS` — the table holding `COMPACTING: 'sweeping'`, and so
     the point of the change.
     The window needed no timer: a capture measured `PreCompact` to
     `SessionStart(source=compact)` at 97s with nothing inside it that can take
     the hero, and `SessionStart` already cleared to `IDLE`, so the exit was
     wired before the entry was. `source` never reaches the daemon —
     `HookEvent` does not carry it — so the window closes on _any_
     `SessionStart`. Broader than the compact case, and the safe direction.
     **The screen never covers a question, and did not achieve that by
     ranking.** The demotion out of tier 1 was argued on exactly this, but a
     rank only decides between sessions and the transition overwrote the state
     of the one it landed on: `NEEDS_PERMISSION`, `FAILED` and a promotable
     `WAITING` all became `COMPACTING`, measured. `applyEvent` now drops the
     event when the effective state is asking for a human.
     **Two limits accepted rather than fixed.** A compaction whose
     `SessionStart` never arrives sweeps until eviction at ten minutes, because
     `effectiveState` freezes every non-`IDLE` state — §Sweeping proposed a
     two-bound window sized off the current maximum, and that is deferred. And
     a question asked within the last `WAITING_AFTER_MS` has not promoted yet,
     so a compaction starting in that minute does take the stage.
     The rank is the departure from the frozen spec, and `spec.md` §4 carries
     it along with the one thing the amendment left open — where it sits
     relative to `WORKING`, `THINKING` and `DONE`.
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
  13. ~~road bike (long runs)~~ — **cut, 25 Aug.** `spec.md` §5 files it under
      "Tier C — stretch (2): road bike, beacon. Cut without regret", and this
      is that cut being taken rather than a new judgement.
      It is the most expensive item in the catalogue: the first prop that would
      carry Clawd, and no animation in the corpus has a seated pose — all
      fourteen stand, climb or lie. And it has no trigger. `spec.md` specifies
      one ("any tool, same session >90s") but nothing implements it:
      `Refinement` in `animation.ts` is `{ tool?, errorType? }`, so no elapsed
      time reaches the mapping. So the work is a pose the corpus does not have,
      a prop nothing else needs, and a measurement that does not exist.
      Nothing in the tree references it — no SVG, no `SPRITE_NAMES` entry, no
      `ANIMATIONS` entry — so unlike `sweeping`'s wiring this cut reverts
      nothing and costs nothing. If it is ever wanted, the cheap wiring is an
      elapsed field on `Refinement`, branching inside the `WORKING` arm, rather
      than a new state in `effectiveState`.
      `beacon`, the other Tier C item, was never a plan item of its own and
      needs no separate cut.

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
      **What the palette reaches today, measured 25 Aug.** `packages/cli`
      composes with `extent: 'panel'`, so `withEnvironment` paints the
      environment across the whole framebuffer and replaces the painter's ink
      with `environmentInk(time)`. Swapping a pack for one that agrees on
      nothing — magenta background, yellow ink — changes: - **zero** pixels with an empty strip, which is the modal case: `isLive`
      keeps a session ten minutes, and overnight or any longer gap renders
      the empty desk; - **zero** for a `resting` chip, because `TONE_ROLE` maps it to `ink`,
      which has already been substituted — and `DONE`, `IDLE` and `ASLEEP`
      are all resting; - 240 for an `active` or `attention` chip, capped at five by `MAX_CHIPS`.
      So `palette[0]` never reaches a shipping pixel, and `palette[1]` only via
      `sceneColours`' fallback on a pack carrying fewer than four entries.
      **That is a consequence of a decision already taken, not a defect.**
      `environment.ts` argues the ink substitution: a pack's ink is chosen
      against its own background, and white on a midday sky is nearly
      invisible, so whatever the text sits on should decide its colour. `panel`
      extent was picked on 22 Aug, in the commit that wired the scenery on,
      with the trade priced in both directions.
      **The palette is still load-bearing** — the logo item below quantises to
      it and the pet sprite is drawn in it — so what needs correcting is this
      line's implied promise that a recipient will _see_ their palette in the
      chrome. They will see it in quips, the birthday quip, their logo, their
      pet, and a 240px chip while a session is working.
      `packages/renderer/src/pack-swap.test.ts` holds the measurement;
      `panel-mock --pack <dir>` renders any pack, which no tool could do
      before — though `blit.ts` still cannot, so nothing yet puts a pack on
      glass.
- [ ] **Set the Mac's clock to 23 Sep during the dry run and watch the panel.**
      The only end-to-end test the birthday can ever have: the recipient's pack
      is gitignored, so CI will never load it, and `isBirthday` reads the host's
      local date. Five minutes, and it exercises resolution, schema, the
      message band and the panel in one action.
- [ ] Pet sprite from Alex's photos — background prop on idle/asleep, not the mascot
- [~] **Company logo → pixel** — the tool is built; nothing draws its output.
  `tools/logo2pixel.ts` rasterises, snaps to a pack's palette, and emits a
  PNG to look at or SVG rects to paste.
  **No `sharp`, and none was needed** — the plan named a dependency the
  repo already had both halves of. Playwright rasterises the SVG the way
  `tools/svg2frames.ts` does, and `snapToPalette` was already
  nearest-neighbour against a palette it is handed; it was written to snap
  frames to an SVG's own colours, and the palette is a parameter.
  **It warns when a palette merges two of a logo's colours**, which is the
  failure that is otherwise silent: a small palette cannot represent an
  arbitrary logo, and the mark that loses is simply absent from the output.
  The warning reads hex `fill` attributes only, so `#fff` shorthand and
  stroke-only artwork pass it silently.
  **What is left is the whole of the delivery.** A logo reaches the panel
  only through a pack `logo` field the schema does not have and a renderer
  path that does not exist, or through a private re-bake of the animation
  frames. The item below carries the first; the second needs no plan
  because it is a build step run once.
  The logo itself is pack content and is not in this repo.
- [ ] **A pack `logo` field, and something that draws it.** The half above
      that is not built, and the larger half.
      **Where it goes: the laptop lid, not the splash — and this overrules the
      freeze rather than filling a gap.** The screen spec's easter-egg table
      routes the logo to the boot splash, and that spec is the _later_
      document: `PLANS.md` §Typing argued for the lid on 18 Aug, the splash
      shipped without a logo on 21 Aug, and the 25 Aug freeze still said
      splash. The lid wins for a reason the freeze did not have in view — the
      splash is drawn by the firmware (`draw_splash()` runs unconditionally in
      `app_main`, so it is on at every power-on until the daemon paints over
      it), and firmware is flashed rather than configured, so a splash logo
      cannot be a pack field at all. The manifest freeze at the same spec names
      `logo`, so the field itself is in scope.
      **Size it against the codec that exists, not against a decoder.** The
      renderer's runtime dependencies are `@tamaclaude/packs` and
      `@tamaclaude/protocol` and nothing else — there is no image decoder in
      the shipping graph, and Playwright is a build-time dependency that never
      reaches the recipient. So the pack cannot ship a PNG or an SVG. What it
      can ship is what the sprites already are: an RGB565 payload through
      `encodeRect`/`decodeRect` in `@tamaclaude/protocol`, which
      `packages/renderer/src/sprites/index.ts` already turns back into pixels.
      That makes this a schema entry, a loader, a blit at a known slot, and a
      third output format on `tools/logo2pixel.ts` — which today emits a PNG to
      look at and SVG rects to paste, **neither of which the renderer can
      consume**. Smaller than it first looked, and the tool is the part that
      needs the change.
      **Decide it on an artefact, not on a start date.** If
      `panel-mock` cannot draw a pack-supplied mark by **10 Sep**, stop: a
      trigger that fires when someone opens a file is a rubber stamp, which is
      the objection `PLANS.md` already makes to a gate of that shape. Note the
      input is also unscheduled — both routes need the recipient's `logo.svg`,
      and the pack that holds it is itself an open item above.
      **The fallback does not deliver, and that is why it is not one.** A
      private re-bake writes the mark into `packages/renderer/src/sprites/`,
      which is tracked; the recipient installs from a clone of a public repo
      (`Printed card: QR to repo + one-line install`), so an uncommitted change
      on one Mac reaches nobody, and committing it puts a company mark in
      public history permanently. If the field does not land, **no logo ships**
      — the placeholder stays and the panel is still a gift. Two paragraphs
      above promise the recipient will see "their logo"; if this is cut, that
      promise goes with it, and the deferred table takes a row.
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

- [~] ~~**Environment extent as a pack field**~~ — **cut, 25 Aug.** One
  optional field defaulting to `panel`, about an hour's work.
  **What it would buy is the recipient re-opening a decision taken on
  22 Aug.** `panel` was picked in the commit that wired the scenery on, not
  at the 25 Aug freeze — the freeze record covers the screen list, the
  state machine and the pack format, and says nothing about extent. Both
  extents are built and `scene.ts` prices the trade both ways: `stage`
  keeps the pack's ink legible but "makes the panel look like a picture
  bolted to a terminal".
  **The rejected side is renderable**, which is what makes this a cut rather
  than a deferral — the judgement can be re-checked by looking instead of by
  reading this. `tools/panel-mock.ts --extent stage` draws it: the scenery stops where the landscape stage ends and the
  rest of the panel is flat pack background, against `panel`'s sky running
  edge to edge with the resting chip taking environment ink. A pack field's
  only effect is selecting that rejected side — 28,160 px against 0 with an
  empty strip, measured in `pack-swap.test.ts`.
  **This declines a request rather than tidying an oversight**, and
  `daemon.ts` records the request: a switch was asked for so the owner or
  the recipient could change it later. The reason to decline is precedent
  as much as the date: the screen spec's timings table already refused this
  shape of field — schema, validation and tests for knobs nobody will ever
  turn — and this is an hour of code and a schema entry for a lever with
  one useful setting. If it is wanted after 23 Sep the deferred table
  carries it.
  Schemes were the other half and stay deferred separately. A pack-supplied
  scheme would not restore the pack's own `palette[0]` and `palette[1]` to
  the panel — the environment still covers the background and still
  substitutes the ink — but it would hand the pack the scheme's colours
  instead, which is more of the panel than extent buys rather than less.
  It would also invalidate the sixteen colours in `tools/contrast.ts`'s
  `AGAINST` table, transcribed there from `environment.ts`, and every
  animation carrying a contrast figure would need it re-run. No count is given
  because the obvious grep undercounts: `overheated.svg` writes its figures as
  `7.76 dawn` rather than `7.76:1`, so a search for the ratio form misses it,
  and `PLANS.md` carries figures for animations whose SVGs do not.
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

| Deferred                                           | Re-entry condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS menu bar app                                 | Needs a native shim or Electron, which reintroduces Gatekeeper and code signing. Post-birthday.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Environment as a pack field (extent, then schemes) | Cut 25 Aug. The screen spec already refused this shape of field for the timings table — "new schema, validation and tests for knobs nobody will ever turn" — and froze the manifest as `name`, `palette`, `quips` plus props and logo, which extent would breach. Render both sides with `panel-mock --extent stage` before re-opening: `stage` is the side the 22 Aug wiring rejected, so the field's non-default position is a worse picture rather than a taste. Schemes would invalidate the `AGAINST` table in `tools/contrast.ts`. Only after 23 Sep, and schemes only with a re-run of every animation carrying a contrast figure. |
| BLE transport                                      | USB-CDC is simpler and truly plug-and-play. Only if untethered operation is ever wanted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Wi-Fi provisioning                                 | Kills plug-and-play. Only if the device needs to live away from the Mac.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| microSD asset storage                              | Host renders, so the device stores nothing but the splash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/INDEX.md`, `docs/decisions/`, `PROGRESS.md`  | Adopt if the project outlives 23 Sep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Notarised `.app` (£79/yr)                          | Only if a menu bar app is ever built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
