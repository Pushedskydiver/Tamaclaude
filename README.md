<h1 align="center">Tamaclaude</h1>

<p align="center">A tiny desk display for your Claude Code sessions.</p>

Tamaclaude puts an animated pixel crab on a 172×320 panel on your desk. He
reacts to what Claude Code is doing — boulders while it searches your codebase,
types while it writes, hits the gym while it runs your build, and goes to sleep
when you do.

Inspired by [clawd-tank](https://github.com/marciogranzotto/clawd-tank). See
[CREDITS.md](CREDITS.md).

## How it works

```
Claude Code hooks -> tamaclaude-notify -> daemon -> USB-CDC -> ESP32-C6 panel
                                               \-> canvas  -> browser (dev)
```

Unlike upstream, **all rendering happens on your Mac in TypeScript**. The
device receives dirty rectangles of RLE-compressed RGB565 and blits them to the
display. It's flashed once and never again — every screen, animation and theme
change is a host-side code change.

That also means the whole thing runs without hardware: the renderer draws to a
browser canvas in development.

## Status

In development. See [BUILD_PLAN.md](BUILD_PLAN.md).

## Hardware

- [Waveshare ESP32-C6-LCD-1.47](https://www.waveshare.com/wiki/ESP32-C6-LCD-1.47)
  — 172×320 ST7789, 4MB flash, USB-C
- A printed case (see [docs/HARDWARE.md](docs/HARDWARE.md))

## Packs

A _pack_ is a character, a palette, a set of animations and a set of quips.
`packs/example/` is the reference. Personal packs live outside the repo — point
the config at one and every screen changes without a rebuild.

## Development

```bash
pnpm install
pnpm dev          # renderer + browser harness, no hardware needed
```

## Licence

MIT — see [LICENSE](LICENSE).
