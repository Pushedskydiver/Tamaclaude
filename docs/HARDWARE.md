# Hardware

## Board

**Waveshare ESP32-C6-LCD-1.47**
([wiki](https://www.waveshare.com/wiki/ESP32-C6-LCD-1.47))

| Spec    | Value                                             |
| ------- | ------------------------------------------------- |
| Display | ST7789, 172×320, 262K colour, SPI                 |
| Flash   | **4MB** (see warning)                             |
| RAM     | 512KB HP SRAM + 16KB LP SRAM, no PSRAM            |
| USB     | USB-C, USB 2.0 full-speed (12 Mbps ceiling)       |
| RGB LED | WS2812 on GPIO8                                   |
| Storage | microSD (TF) slot — unused, we render on the host |
| Radio   | Wi-Fi 6 + BLE 5 — unused                          |

> ⚠️ **Upstream's README disagrees with Waveshare.** clawd-tank's README claims
> ESP32-C6FH8 with 8MB flash; the Waveshare wiki for this SKU says 4MB. Verify
> on arrival and record the result here. It matters very little for us — we
> store only the splash image on-device — but assume 4MB until measured.

**Verified flash size:** _not yet measured — Stage 2, `BUILD_PLAN.md`_

## Bring-up checklist

1. Flash Waveshare's factory demo. It prints flash size to the LCD and
   exercises the display and WS2812 — one step confirms the board is good and
   answers the flash question.
2. Record the measured flash size above.
3. Measure the board's physical dimensions before ordering a print.

## Firmware

Lives in `packages/device/firmware/`. ESP-IDF, C, ~300 lines.

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
