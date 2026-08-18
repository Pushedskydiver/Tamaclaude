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
| Same, RLE'd at ~14:1            |      ~1,300 | ~13 KB/s |

Full-screen uncompressed does **not** fit. Dirty-rect plus RLE clears it by two
orders of magnitude. Both are therefore load-bearing, not optimisations —
`packages/protocol` owns them and its tests assert the compression ratio.

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

A pack is the entire customisation surface: a base character SVG, an animation
set, a palette, a quip table and an optional logo. Config selects one; nothing
else changes.

`packs/example/` is committed and documents the format. Real packs
(`packs/alex/`, `packs/jamie/`) are gitignored — the repo is public and the
personal content is not.

Quips have two tiers: **mapped** (fired on a specific state — a failure, a
permission request) and **random idle** (surfaced rarely when nothing is
happening). Mapped quips land because the timing is the joke; randomising them
would waste them.
