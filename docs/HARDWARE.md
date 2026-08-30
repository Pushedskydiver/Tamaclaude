# Hardware

## Board

**Waveshare ESP32-C6-LCD-1.47**
([wiki](https://www.waveshare.com/wiki/ESP32-C6-LCD-1.47))

| Spec    | Value                                              |
| ------- | -------------------------------------------------- |
| Display | ST7789, 172×320, 262K colour, SPI                  |
| Flash   | **8MB** (measured — see below)                     |
| RAM     | 512KB HP SRAM + 16KB LP SRAM, no PSRAM             |
| USB     | USB-C, USB 2.0 full-speed (12 Mbps ceiling)        |
| RGB LED | WS2812 on GPIO8 — present, never driven; see below |
| Storage | microSD (TF) slot — unused, we render on the host  |
| Radio   | Wi-Fi 6 + BLE 5 — unused                           |

> ⚠️ **Upstream's README disagreed with Waveshare, and upstream was right.**
> clawd-tank's README claimed ESP32-C6FH8 with 8MB; the Waveshare wiki for this
> SKU says 4MB. Measured on the actual board: 8MB. The wiki is wrong, at least
> for the unit that arrived. It matters little either way — we store only the
> splash on-device — but the doubled headroom removes any question about it.

**Verified flash size: 8MB.** Measured 20 Aug 2026 on the board itself:

```
Chip is ESP32-C6FH8 (QFN32) (revision v0.2)
Features: Wi-Fi 6, BT 5 (LE), IEEE802.15.4, Single Core + LP Core, 160MHz,
          Embedded Flash 8MB
Crystal is 40MHz
USB mode: USB-Serial/JTAG
Manufacturer: 20  Device: 4017  Detected flash size: 8MB
```

Reproduce with the board plugged in and ESP-IDF sourced:

```bash
esptool.py --port /dev/cu.usbmodem1101 flash_id
```

**`USB mode: USB-Serial/JTAG` is the line that matters most.** It confirms the
chip's native USB peripheral is what enumerates, rather than a separate
USB-to-UART bridge. `docs/ARCHITECTURE.md` rests the whole host-renders design
on USB-CDC at full speed; a bridge chip would have capped us at a UART baud
rate instead, and that would have been found out at Stage 2 rather than now.

## Bring-up checklist

1. ~~Flash Waveshare's factory demo.~~ **Do not.** It was written to answer
   the flash question and confirm the board — the first is answered above, and
   flashing the blitter confirms the board through the code that ships. Its
   other half exercised the WS2812, which nothing in either firmware drives:
   `blitter/main/main.c` declares six pins and GPIO8 is not among them. See
   §Firmware below, which has said "we did not need Waveshare's demo after
   all" since 21 Aug while this step went on instructing it.
   **A board that has never been flashed is a different case**, and there the
   demo it arrives with is worth one minute before you overwrite it — that is
   a precondition of Stage 6's gift-board flash, not a step here.
2. ~~Record the measured flash size above.~~ Done: 8MB, 20 Aug.
3. Measure the board's physical dimensions before ordering a print. **Still
   open** — see §Enclosure.

## Firmware

Lives in `packages/device/firmware/`. ESP-IDF, C.

Two of them:

- `throughput/` — 83 lines that read USB-CDC and discard, written to measure
  the link and nothing else (`docs/ARCHITECTURE.md` §Why it fits down the wire).
- `blitter/` — the real one. It does exactly three things:
  1. Read framed commands from USB-CDC
  2. Decode RLE RGB565 and blit the rectangle to SPI
  3. Show an embedded splash when nothing has ever driven the panel

It is flashed once. If a change to it seems necessary, that is a strong signal
the change belongs on the host instead.

**We did not need Waveshare's demo after all.** This section used to insist on
starting from it, so as not to re-derive the ST7789 init sequence by hand — the
classic place to lose a day. ESP-IDF's own `esp_lcd` component has an ST7789
driver, so there is no init sequence to derive. What was actually needed from
upstream clawd-tank was the pin map, which is six numbers, and one insight
about the column offset (below). The factory image is backed up regardless.

### Orientation

`PANEL_LANDSCAPE` in `blitter/main/main.c` is a build-time constant, because
the firmware is flashed once and which way up the device sits is a physical
fact. **The host must agree** — `tools/blit.ts` takes a matching argument, and
there is no handshake, so a mismatch is silent: the sprite lands in the wrong
band and nothing warns you. Both default to landscape.

Landscape is not a rotated portrait layout. The bands are rearranged — Clawd on
the left at 168x160, the text stacked down the right — because 200px of stage
does not fit in 172px of height. The host crops the sprite to the safe area,
which is what the top 5 units of prop headroom in `docs/ANIMATION.md` exist for.

**The 34-pixel offset is the expensive thing to get wrong.** The 172-wide
window sits centred in the controller's 240-pixel RAM, so 34 columns of its
memory are dead. Which axis they land on depends on `swap_xy`: with it on,
CASET addresses rows and the offset belongs on `y_gap`; with it off, on
`x_gap`. Upstream's landscape code says exactly this in a comment, and it is
inverted for portrait. Getting it wrong gives a display that looks almost right
and is shifted.

### Colours

The blitter byte-swaps every pixel on the way to the panel, because the ST7789
latches big-endian under `esp_lcd`'s default RAMCTRL, and `invert_color(true)`
is required or every colour comes out as its complement. **Both are verified**
with `tools/colour-bars.ts`, which paints six known values across the panel.

That tool exists because a wrong byte order and a wrong invert and a wrong
element order all look like "the colours are off", and each maps that set of
six somewhere distinguishable — so one look identifies which is in play. Reach
for it before theorising. Photographs are not evidence here: a warm-lit room
makes a camera white-balance a neutral panel to blue, which cost an evening of
chasing a colour bug that did not exist.

## Enclosure

Community STLs exist for this exact SKU — no modelling required:

- [Printables — ESP32-C6 1.47inch Display Enclosure](https://www.printables.com/model/1365867-esp32-c6-147inch-display-enclosure)
  — snap-on lid, needs supports for the USB-C hole
- [Cults3D — Enclosure (edge) SDLw01 28563](https://cults3d.com/en/3d-model/gadget/enclosure-edge-for-waveshare-esp32-c6-1-47-rectangle-lcd-sdlw01-28563)
  — claims physically-verified 0.3mm tolerance, M2 screws

**Chosen model:** _TBD — record the model and its licence here once picked, for
`CREDITS.md`._

**Overdue while `BUILD_PLAN.md`'s "Measure board; send chosen STL to the
printer" is unchecked** — bound to that box rather than to a date, so this
sentence stops being true when the box is ticked and not before. Its mitigation
in the risk table was "brief the printer Thu 20 Aug", which has passed.

What makes it different from the other open items is narrower than it first
looks, and the plan is worth reading before this is escalated. It is **not** the
project's largest risk: the same risk row accepts a bare board as the fallback,
and the always-giftable rule means a present is handed over either way. Nor is
it the only item with an unbounded tail — the clean-account dry run's bad
branch is "a packaging project rather than a bug fix" in the plan's own words,
and the gift-board flash is a rebuild against a toolchain last exercised in
August.

What is distinctive is one thing: **it is the only outstanding item whose
completion depends on somebody else's calendar.** That cannot be recovered by
working harder, which is why it wants a decision date rather than a nudge.
Assembly is scheduled for Sat 19 Sep, so the go/no-go on the bare-board
fallback belongs meaningfully earlier — decide it deliberately rather than
arrive at it.

## Spares

Buy two boards. One to develop and reflash against, one to give. Replacement
lead time is roughly a week, and September has no week to spare.
