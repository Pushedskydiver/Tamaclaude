# Hardware

## Board

**Waveshare ESP32-C6-LCD-1.47**
([wiki](https://www.waveshare.com/wiki/ESP32-C6-LCD-1.47))

| Spec    | Value                                             |
| ------- | ------------------------------------------------- |
| Display | ST7789, 172×320, 262K colour, SPI                 |
| Flash   | **8MB** (measured — see below)                    |
| RAM     | 512KB HP SRAM + 16KB LP SRAM, no PSRAM            |
| USB     | USB-C, USB 2.0 full-speed (12 Mbps ceiling)       |
| RGB LED | WS2812 on GPIO8                                   |
| Storage | microSD (TF) slot — unused, we render on the host |
| Radio   | Wi-Fi 6 + BLE 5 — unused                          |

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

1. Flash Waveshare's factory demo. It prints flash size to the LCD and
   exercises the display and WS2812 — one step confirms the board is good and
   answers the flash question.
2. Record the measured flash size above.
3. Measure the board's physical dimensions before ordering a print.

## Firmware

Lives in `packages/device/firmware/`. ESP-IDF, C.

`throughput/` is there now — 83 lines that read USB-CDC and discard, written to
measure the link and nothing else (`docs/ARCHITECTURE.md` §Why it fits down the
wire). The blitter is still to come, targeting ~300 lines.

**Start from Waveshare's demo, not from scratch.** It contains a working
ST7789 init sequence and the correct pin mapping. Re-deriving those by hand is
a day nobody has, and the display init sequence is the classic place to lose it.

The firmware does exactly three things:

1. Read framed commands from USB-CDC
2. Decode RLE RGB565 and blit the rectangle to SPI
3. Show the embedded splash when no host is connected

It is flashed once. If a change to it seems necessary, that is a strong signal
the change belongs on the host instead.

## Enclosure

Community STLs exist for this exact SKU — no modelling required:

- [Printables — ESP32-C6 1.47inch Display Enclosure](https://www.printables.com/model/1365867-esp32-c6-147inch-display-enclosure)
  — snap-on lid, needs supports for the USB-C hole
- [Cults3D — Enclosure (edge) SDLw01 28563](https://cults3d.com/en/3d-model/gadget/enclosure-edge-for-waveshare-esp32-c6-1-47-rectangle-lcd-sdlw01-28563)
  — claims physically-verified 0.3mm tolerance, M2 screws

**Chosen model:** _TBD — record the model and its licence here once picked, for
`CREDITS.md`._

## Spares

Buy two boards. One to develop and reflash against, one to give. Replacement
lead time is roughly a week, and September has no week to spare.
