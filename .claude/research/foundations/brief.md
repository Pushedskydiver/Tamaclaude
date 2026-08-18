# Tamaclaude — Foundations Research Brief

**Date:** 2026-08-18
**Status:** research complete. **Superseded in places — see §Corrections.**
This file records what was believed on 2026-08-18. Where it disagrees with
`docs/`, `docs/` wins.
**Author:** Alex + Claude Code

A desk display for Claude Code sessions, inspired by
[marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank) (MIT,
© 2026 Marcio Granzotto Rodrigues). Built as a birthday gift for Jamie
(**23 September 2026 — 36 days from today**), and customisable per-person via
swappable packs.

---

## 1. Constraints

| Constraint       | Value                                                                                               | Consequence                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Deadline         | 23 Sep 2026 (Wed), 36 days, 5 weekends                                                              | Design freeze needed ~25 Aug                                                    |
| Hardware in hand | Thu 20 Aug                                                                                          | 2 days of pre-hardware work available                                           |
| Alex's stack     | TypeScript, pnpm workspaces, Node 24, vitest, ESLint flat config                                    | Firmware must not be a TS-shaped hole                                           |
| Alex's art skill | None                                                                                                | Art pipeline must not require drawing                                           |
| Jamie's machine  | macOS                                                                                               | Host is a macOS daemon                                                          |
| Jamie's usage    | Heavy Claude Code, multiple concurrent sessions, plus a remote agent on a Raspberry Pi media server | Multi-session is required, not optional; remote sessions are a headline feature |
| Delivery         | Assembled device, plug in and go                                                                    | Must not present a black screen before host software is installed               |
| Customisation    | Swap screens between Alex's pack and Jamie's pack                                                   | Packs are a first-class concept, not an afterthought                            |

**Jamie:** co-founder, AI enthusiast, tech nerd. Video and board games, cycling,
gym, indoor climbing, Marvel, Avatar: The Last Airbender, red Tesla Model 3, cat
called Penny. Values evident thought in a gift. Shared in-jokes with Alex to be
used as a text/quips layer.

---

## 2. Hardware

Board: **Waveshare ESP32-C6-LCD-1.47**.

| Spec    | Value                                          | Source                 |
| ------- | ---------------------------------------------- | ---------------------- |
| Display | ST7789, 172×320, 262K colour, SPI              | Waveshare wiki         |
| Flash   | **4MB**                                        | Waveshare wiki         |
| RAM     | 512KB HP SRAM + 16KB LP SRAM, **no PSRAM**     | Waveshare wiki         |
| USB     | USB-C, **USB 2.0 full-speed, 12 Mbps ceiling** | Espressif ESP-IDF docs |
| RGB LED | WS2812 on GPIO8                                | Waveshare wiki         |
| Storage | microSD (TF) slot                              | Waveshare wiki         |
| Radio   | Wi-Fi 6 + BLE 5                                | Waveshare wiki         |

> ⚠️ **Upstream's README is wrong for the board we're buying.** It claims
> ESP32-C6FH8 with **8MB** flash. The Waveshare wiki for this SKU says **4MB**.
> Verify the actual board on arrival (`idf.py flash-size` or the onboard
> factory demo, which prints flash size to the LCD). Any sprite budget must
> assume 4MB until proven otherwise.

**Buy two.** One to develop and reflash against, one to give. Never gift the
board you've been debugging on.

**Enclosure — already de-risked.** Free STLs exist for this exact SKU:

- [Printables — ESP32-C6 1.47inch Display Enclosure](https://www.printables.com/model/1365867-esp32-c6-147inch-display-enclosure) (snap-on lid, needs supports for the USB-C hole)
- [Cults3D — Enclosure (edge) SDLw01 28563](https://cults3d.com/en/3d-model/gadget/enclosure-edge-for-waveshare-esp32-c6-1-47-rectangle-lcd-sdlw01-28563) (claims physically-verified 0.3mm tolerance, M2 screws)

Send one to the printer on Thursday, after measuring the real board.

---

## 3. Architecture decision — host renders, device blits

**Decided.** The Mac renders every frame in TypeScript. The device is a dumb
blitter that receives `(x, y, w, h, rle_payload)` and pushes it to SPI.

### The bandwidth case

| Payload                         | Bytes/frame | At 10fps |
| ------------------------------- | ----------: | -------: |
| Full screen 172×320 RGB565      |     110,080 | 1.1 MB/s |
| Dirty-rect, 96×96 sprite region |      18,432 | 184 KB/s |
| Same, RLE'd at upstream's ~14:1 |      ~1,300 | ~13 KB/s |

USB full-speed gives ~1.5 MB/s theoretical, ~700KB–1MB/s realistic for CDC bulk.
Dirty-rect streaming clears it by two orders of magnitude. Full-screen
uncompressed does not — so dirty-rect + RLE is required, not optional.

### Why this over the alternatives

| Option                                                               | Verdict                                                                                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mirror upstream** — sprites in flash, state over BLE, LVGL UI in C | Rejected. Puts the entire creative surface in a language Alex doesn't work in, and requires maintaining a second C program (the SDL2 simulator) that duplicates the firmware. |
| **Moddable SDK** — JS on device via XS + Piu                         | Rejected. Genuinely supports ESP32-C6 on ESP-IDF v6.0, but it's a niche embedded JS runtime, not a familiar stack. Worse DX than plain ESP-IDF for no gain.                   |
| **Raspberry Pi Zero 2 W + display** — Node on device                 | Rejected. More cost, SD-card fragility, boot time, and an OS to maintain on a gift.                                                                                           |
| **Host renders, device blits**                                       | **Chosen.**                                                                                                                                                                   |

### What this buys

- 100% of screens, animations, layout, fonts, theming, packs = TypeScript.
- **Flash the device once, ever.** Jamie's device never needs reflashing.
- **The simulator stops existing as a separate program.** Same TS renderer, two
  sinks: a `<canvas>` in dev, the panel over USB-CDC in production. This deletes
  upstream's single largest maintenance cost.
- All of it is buildable **before the hardware arrives on Thursday**.

### The one hole, and its fix

A dumb device plugged in with no host software shows **a black screen** — a bad
first 30 seconds for a birthday present. Fix: embed a single static RLE splash
in flash, shown whenever no host is connected ("Happy Birthday Jamie → plug into
your Mac and run this"). ~20 lines of firmware, one image. Architecture survives.

### Transport

- **USB-CDC is primary.** One cable = power + data. Truly plug-and-play, no
  pairing, no Wi-Fi credential provisioning.
- **Device sleeps when the Mac sleeps.** Accepted as correct behaviour.
- **Design the wire protocol host-agnostic from day one** so a remote host (the
  Raspberry Pi) can push session events over TCP on the LAN/Tailscale. Same
  protocol, different socket. Cheap now, expensive to retrofit. Ship if the
  clock allows — showing "your home server is thinking" on the desk is the most
  personal feature available and it is nearly free if designed in.

---

## 4. Art pipeline decision — SVG as code

**Decided.** Animations are authored as CSS-animated SVG, generated by an LLM
against a fixed character geometry, rendered to frames by a TypeScript pipeline.

### What upstream actually does

Reverse-engineered from `tools/gemini_animate.py` and
`assets/svg-animations/`:

1. **`clawd-static-base.svg`** — one canonical character geometry, elements with
   stable IDs (torso, arms, legs, eyes).
2. **`PLANS.md`** — prose specs per animation: action, body mechanics, eyes,
   effects. Human-readable design intent, e.g. _"body stretches up as the arm
   raises, squashes down hard when the hammer strikes; yellow pixel sparks on
   impact."_
3. **An LLM** receives base SVG + one example animation + the plan, under a hard
   constraint quoted from their prompt builder: use these exact elements, same
   IDs, coordinates and colors — _"Animate by applying CSS transforms and
   keyframes to these elements — do NOT redraw the character."_

`clawd-working-typing.svg` is 153 lines in a `-15 -25 45 45` viewBox, with
classes like `.arm-l-type`, `.eyes-read`, `.data-bit`, and commented keyframes.

### Why this is the right answer here

**Character consistency is structural, not statistical.** Every animation is the
same geometry with different CSS keyframes, so frames cannot drift. That is
precisely the failure mode that sinks image-generation tools, engineered out by
construction.

| Route                                                            | Verdict                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SVG-as-code + LLM**                                            | **Chosen.** No drawing skill required. Diffable, reviewable in a PR, version-controlled. Recolouring is find-and-replace. Swapping a prop is swapping a `<g>`. It is TypeScript-adjacent work.                                          |
| **Aseprite by hand**                                             | Kept in reserve for hand-polish on hero frames only. ~£17 one-off, fully scriptable CLI (`-b --split-tags --sheet --data`) if we ever need it. Not the primary route — Alex is not an artist and ~60 sprites is ~15 hours of hand work. |
| **AI image generators** (PixelLab, Pixel Engine, PixExact, Mage) | Rejected as primary. All market "character consistency" in 2026, but consistency across frames of one animation is still the weak point, and the output is opaque raster — not diffable, not parameterisable, not packable.             |

### Pipeline (all TypeScript)

```
base.svg + plan.md --LLM--> animation.svg --Playwright--> PNG frames
                                                              |
                                        quantise + palette-lock (sharp)
                                                              |
                                             RLE RGB565 --> renderer
```

Rendering: **`@napi-rs/canvas`** (Skia, prebuilt N-API binaries, no system
deps — beats node-canvas on both setup and throughput). `imageSmoothingEnabled
= false` for nearest-neighbour scaling.

Typography: **[Departure Mono](https://departuremono.com/)** — monospaced pixel
font, SIL OFL, lo-fi terminal register. Correct for this device, no licence risk.

Logo pixelation: SVG → render at target size → nearest-neighbour → palette
quantise. ~40 lines with `sharp`, given clean vector art (Alex has it).

### Licence position

Upstream is MIT (© 2026 Marcio Granzotto Rodrigues), which legally covers the
assets too. **This was not what happened.** `assets/clawd/base.svg` is upstream's
`clawd-static-base.svg`, verbatim and byte-identical — reproducing it would
have produced a worse file and a needlessly different character. Animations
built on it are ours. `CREDITS.md` is authoritative on what is borrowed and
what is not.

---

## 5. Mascot and screen design

**Clawd the crab remains the mascot.** Reasons:

1. It is Claude's mascot — the device _reads_ as a Claude Code accessory on a desk.
2. A crab silhouette stays legible at sprite scale where a human or cat does not.
3. It demotes the personal material to **set dressing**, which is more tasteful
   than a device that is a shrine to its recipient.

Jamie's world is the environment Clawd acts in, not a replacement for Clawd.

### State → screen (draft)

Driven by Claude Code hooks. Upstream uses `SessionStart`, `PreToolUse`,
`PreCompact`, `Stop`, `StopFailure`, `Notification`, `UserPromptSubmit`,
`SessionEnd`, `SubagentStart`, `SubagentStop`.

| Trigger                               | Screen                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `SessionStart`                        | Clawd walks in                                                                                               |
| `UserPromptSubmit`                    | Thinking — gears, slow sway                                                                                  |
| `PreToolUse` Read/Grep/Glob           | Bouldering — reaching for the next hold _(climbing)_                                                         |
| `PreToolUse` Edit/Write               | Furious typing                                                                                               |
| `PreToolUse` Bash                     | Gym — heavy lifting                                                                                          |
| `PreToolUse` WebSearch/WebFetch       | Wizard                                                                                                       |
| `PreToolUse` Agent / subagents active | Board game — moving pieces _(board games)_                                                                   |
| Long multi-step run                   | Road bike, scrolling background _(cycling)_ — loops naturally                                                |
| `PermissionRequest`                   | Clawd holds up a "may I?" sign — upstream doesn't use this hook; it's a better fit than generic Notification |
| `PreCompact`                          | Sweeping                                                                                                     |
| `Stop`                                | **Red Model 3 pulls up, Clawd hops in** — the once-per-turn payoff                                           |
| `StopFailure`                         | Dizzy / overheated                                                                                           |
| Idle 60s+                             | Confused, stares at you                                                                                      |
| `SessionEnd` / no sessions            | Clawd asleep, **Penny curled up in the corner**                                                              |

### Easter-egg layer (rare, not systemic)

Avatar meditation pose as a 1-in-50 idle. A Marvel "snap" on destructive
operations. A shared in-joke quips file (`quips.ts`) — the cheapest, highest
personal-value customisation surface available. Pixelated company logo on the
splash/boot screen. Pixel-Alex-and-Jamie coding together as a **rare** scene
(birthday, or a session past midnight) — recognisability via silhouette, palette
and props, since facial likeness is not achievable at ~50px per figure.

Rare is special. Constant is noise.

### Packs

A pack = base SVG + animation set + quips + palette + logo. `config.json` picks
one. `packs/alex/` and `packs/jamie/` — no company logo in Alex's pack, no
Penny, different in-jokes. Satisfies "swap out screens" without a rebuild.

---

## 6. Repo foundations — port lean, defer loudly

chief-clancy has 15 docs, an INDEX router, a decisions lifecycle and a 116KB
PROGRESS.md. Moe has 13 docs and a 244KB BUILD_PLAN. **Tamaclaude is ~2–3k lines
with a 36-day deadline.** Porting that ceremony wholesale eats the schedule.

**Port now (cheap, high leverage):**

- `.claude/agents/` — `spec-grill`, `da-review`, `copilot-surrogate`
- `CLAUDE.md` (lean, trigger-phrase-loaded — same rationale as moe's)
- `docs/CONVENTIONS.md`, `docs/GIT.md`, `docs/SELF-REVIEW.md`, `docs/DA-REVIEW.md`, `docs/ARCHITECTURE.md`
- `CREDITS.md` — upstream attribution
- ESLint flat config, Prettier, husky + lint-staged, vitest, knip
- Gitmoji commit convention, PR title check

**Defer with re-entry conditions:**

- `docs/INDEX.md` — needs real PRs to route against
- `docs/decisions/` — adopt the moment a decision needs preserving beyond this brief
- `docs/TESTING.md`, `docs/GLOSSARY.md`, `docs/RATIONALIZATIONS.md`, `docs/REVIEW-PATTERNS.md` — after the gift ships
- `PROGRESS.md` / `docs/history/SESSIONS.md` — adopt if the project outlives the deadline

---

## 7. Open questions — all resolved

1. **Install story.** Resolved: no notarisation needed. The host is a Node
   process, not a compiled binary, so Gatekeeper does not apply and the £79/yr
   Apple Developer account is unnecessary. Cost of that: no menu bar app in v1,
   since one needs a native shim or Electron. Recorded in `BUILD_PLAN.md`
   §Deliberately not scheduled.
2. **Public or private repo.** Resolved: public, chosen by Alex against the
   recommendation. `packs/` is gitignored except `packs/example/`, so the
   personal content is not exposed. `BUILD_PLAN.md` §Risks records this as
   accepted rather than mitigated.
3. **Does Jamie know.** No. Alex has photos of Penny.
4. **Directory rename.** Done — `tamaclaude/`, remote `Pushedskydiver/Tamaclaude`.
5. **In-jokes.** Provided. Two map to states ("Turrrby, Turrrby, Turrrby" on
   failure, "Wansum?" on a permission request); the rest are a random idle pool.
   The two-tier split is in `docs/ARCHITECTURE.md` §Packs.

## 10. Corrections

Recorded rather than edited away, because the reasoning is still worth reading
and a research brief that quietly rewrites itself cannot be trusted.

- **§4 said we would author our own SVGs.** We use upstream's base geometry
  verbatim. See `CREDITS.md`.
- **§6 proposed deferring `docs/decisions/`.** Still deferred, but the
  correction list here is doing some of that job.
- **The screen catalogue in §5 is a draft**, not a spec. It has never been
  grilled and the design freeze is 25 Aug.

## 8. Risks

| Risk                                               | Mitigation                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Art is on the critical path (Alex's explicit call) | SVG-as-code makes generation a prompt-and-review loop, not hand-drawing. Base geometry first, animations incrementally.                             |
| Board ships with 4MB not 8MB                       | Verify on arrival. Host-renders architecture means sprites live on the Mac, so flash size is nearly irrelevant — this risk is mostly designed away. |
| Case print lead time                               | Free STLs already identified; brief the printer Thursday.                                                                                           |
| Design not frozen in time                          | Freeze target ~25 Aug.                                                                                                                              |
| Gatekeeper blocks the app on the day               | Resolve open question 1 this week.                                                                                                                  |

## 9. Sources

- [marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank) — README, `LICENSE`, `tools/gemini_animate.py`, `assets/svg-animations/PLANS.md`, `assets/svg-animations/clawd-working-typing.svg`
- [Waveshare ESP32-C6-LCD-1.47 wiki](https://www.waveshare.com/wiki/ESP32-C6-LCD-1.47)
- [ESP-IDF — Establish Serial Connection with ESP32-C6](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/get-started/establish-serial-connection.html)
- [ESP-IDF — USB Serial/JTAG Controller Console](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-guides/usb-serial-jtag-console.html)
- [Moddable SDK — ESP32 devices](https://www.moddable.com/documentation/devices/esp32)
- [Aseprite CLI docs](https://www.aseprite.org/docs/cli/)
- [Departure Mono](https://departuremono.com/)
- [Printables — ESP32-C6 1.47" enclosure](https://www.printables.com/model/1365867-esp32-c6-147inch-display-enclosure)
- [Cults3D — ESP32-C6 1.47" enclosure](https://cults3d.com/en/3d-model/gadget/enclosure-edge-for-waveshare-esp32-c6-1-47-rectangle-lcd-sdlw01-28563)
