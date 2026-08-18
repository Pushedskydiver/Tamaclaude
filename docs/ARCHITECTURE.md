# Architecture

## The one decision everything follows from

**The Mac renders. The device blits.**

Every frame is composed in TypeScript on the host. The ESP32-C6 receives dirty
rectangles as RLE-compressed RGB565 over USB-CDC and pushes them to the ST7789
over SPI. It contains no scene graph, no sprites, no state machine, and no
knowledge of Claude Code. It is flashed once and never again.

Upstream clawd-tank does the opposite: sprites live in device flash, the host
sends state, and an LVGL UI in C renders on-device. That is the better design
for a standalone product. It is the worse design here, for three reasons:

1. Every screen change would be a C change and a reflash. The whole point is
   that Alex can change screens in TypeScript.
2. It forces a second program — upstream maintains an SDL2 simulator in C that
   duplicates the firmware so it can be developed without hardware. Under
   host-rendering, the "simulator" is the same renderer with a canvas sink.
   There is nothing to keep in sync.
3. Jamie's device would need reflashing to receive a fix.

### Why it fits down the wire

USB 2.0 full-speed gives ~1.5 MB/s theoretical, ~700KB–1MB/s realistic for CDC
bulk transfer.

| Payload                         | Bytes/frame | At 10fps |
| ------------------------------- | ----------: | -------: |
| Full screen 172×320 RGB565      |     110,080 | 1.1 MB/s |
| Dirty-rect, 96×96 sprite region |      18,432 | 184 KB/s |

Full-screen uncompressed does **not** fit.

### What it actually costs — measured

`tools/measure-compression.ts` runs the real codec over the real frames of
every animation in the repo, at 8fps, including the 16-byte rect header defined
in `packages/protocol/src/packet.ts`. Reproduce with `pnpm measure` — the
frames are regenerated each time, since `out/` is gitignored.

**The ratio column is against a 67,200-byte stage frame**, not the
110,080-byte full screen above. Animations are authored and rendered at
168×200, which is the stage band, and that is what a sprite update covers.

| Animation    | Mean on the wire | Worst frame |   At 8fps | Ratio vs 67,200 B |
| ------------ | ---------------: | ----------: | --------: | ----------------: |
| `gym`        |            562 B |     1,508 B |  4.5 KB/s |             120:1 |
| `thinking`   |            691 B |     1,876 B |  5.5 KB/s |              97:1 |
| `typing`     |          1,428 B |     1,516 B | 11.4 KB/s |              47:1 |
| `bouldering` |          1,610 B |     1,680 B | 12.9 KB/s |              42:1 |

The busiest uses **1.8% of a 700 KB/s floor**. `bouldering` scrolls its entire
background every frame, the same shape as the road bike, and costs the most on
average — 13% more than `typing`. By worst single frame it is second, behind
`thinking`'s 1,876 B, and peak is the number a real-time link has to survive.

An earlier version of this section quoted ~14:1, which is upstream's figure for
their whole on-flash sprite corpus and was never a measurement of anything
here. Real pixel art on a dirty rect does far better, because a dirty rect is
mostly flat background.

The codec falls back to raw whenever RLE would be larger, so a future
photographic asset cannot quietly double a frame.

### What that measurement does not cover

**One band of four.** Those frames are the 168×200 stage in isolation. The
panel also carries a status bar, a session strip and a message band, and the
differ returns a single bounding box — so the moment a second region changes
independently, the box spans both and drags every unchanged pixel between them
onto the wire.

A clock ticking in the message band is exactly that case. Measured with the
sprite composited into a full 172×320 panel and one small cell changing in a
detailed lower band, `bouldering`'s worst frame goes from 1,680 B to roughly
24,000 B — about **8% of the floor** rather than 1.8%. Still comfortable, still
two orders of magnitude from trouble, but an order of magnitude worse than the
stage-only figure and worth knowing before the daemon starts compositing.

If it ever bites, the fix is per-band diffing or a list of rects rather than
one box. Not now: one box keeps the firmware blitter trivial and the budget is
nowhere near.

### The cost, and its mitigation

A dumb device with no host software connected shows a black screen. Firmware
therefore embeds one static RLE splash, displayed whenever no host is
connected. This is the only asset stored on the device.

## Package graph

```
protocol <- packs <- renderer <- daemon <- cli
protocol <- device <- daemon
protocol <- hooks
```

| Package    | Owns                                                        | May import                                |
| ---------- | ----------------------------------------------------------- | ----------------------------------------- |
| `protocol` | Wire format, RLE RGB565 codec, dirty-rect diffing           | —                                         |
| `packs`    | Pack manifest schema + loader, palettes, quips              | `protocol`                                |
| `renderer` | Virtual 172×320 screen, scene graph, sprite playback, fonts | `packs`, `protocol`                       |
| `device`   | USB-CDC transport; firmware source lives here               | `protocol`                                |
| `daemon`   | Session state machine, tool→state mapping, transports       | `renderer`, `packs`, `device`, `protocol` |
| `hooks`    | The binary Claude Code executes on hook events              | `protocol`                                |
| `cli`      | `tamaclaude status\|pack\|dev`                              | everything                                |

Enforced by `eslint-plugin-boundaries`. Adding an edge means editing
`eslint.config.ts` deliberately, which is the point.

**`hooks` is deliberately near-leaf.** Claude Code runs it on every single hook
event, many times per turn. Its import graph is a latency budget. It forwards
an event over a Unix socket and exits; it does not render, does not load packs,
and does not reason about sessions.

## Transports

| Transport | Status            | Notes                                                                                                                                                               |
| --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USB-CDC   | Primary           | One cable = power + data. No pairing, no Wi-Fi provisioning. Truly plug-and-play.                                                                                   |
| Canvas    | Development       | Same renderer, browser sink. No hardware required.                                                                                                                  |
| TCP       | Planned, cuttable | Lets a remote host (Jamie's Raspberry Pi Claude Code agent) push session events. Same protocol, different socket — cheap if designed in now, expensive to retrofit. |
| BLE       | Not planned       | Upstream uses it. USB is simpler and we are tethered anyway.                                                                                                        |

The device sleeps when the Mac sleeps. Accepted as correct behaviour, not a
defect.

## Packs

A pack is the customisation surface: a palette, a quip table, props and an
optional logo. Config selects one; nothing else changes.

**The character is not per-pack.** Clawd is shared — one base geometry, one
animation set, recoloured and re-dressed per pack. Making the character
swappable would double the art surface, and the calendar has no room for a
second character. `assets/clawd/base.svg` and `docs/ANIMATION.md` own the
character; packs own everything about how he's dressed.

`packs/example/` is committed and documents the format. Real packs
(`packs/alex/`, `packs/jamie/`) are gitignored — the repo is public and the
personal content is not.

Quips have two tiers: **mapped** (fired on a specific state — a failure, a
permission request) and **random idle** (surfaced rarely when nothing is
happening). Mapped quips land because the timing is the joke; randomising them
would waste them.
