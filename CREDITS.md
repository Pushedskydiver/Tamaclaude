# Credits

## Clawd Tank

Tamaclaude exists because of
**[marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank)**
by Marcio Granzotto Rodrigues, MIT licensed. Three things are owed to it
directly.

**The concept.** A tiny desk display driven by Claude Code hooks, with an
animated pixel character whose behaviour reflects which tool Claude is
currently using. The hook-event-to-animation mapping — debugger for
`Read`/`Grep`, typing for `Edit`/`Write`, building for `Bash`, sweeping on
`PreCompact` — originates there.

**The animation technique**, which is the more valuable of the two ideas. Clawd
Tank authors its sprites as CSS-animated SVG generated against one canonical
base geometry, under the constraint that a generated animation may only add
transforms and keyframes to existing elements with existing IDs — never redraw
the character. Character consistency is therefore structural rather than
statistical. That idea is theirs, it is not obvious, and it is the reason a
non-artist can build this at all. See `tools/gemini_animate.py` and
`assets/svg-animations/PLANS.md` in the upstream repo.

**The base geometry itself.** `assets/clawd/base.svg` is upstream's
`assets/svg-animations/clawd-static-base.svg`, unmodified and byte-identical
(md5 `c52ddbc84dd9d96a13d67d13eadeb5d2`, 920 bytes). Reproducing it
independently would produce a worse file and a needlessly different character.

Clawd — the crab — is Claude's mascot and is used here in the same spirit.

### On the tooling

`tools/svg2frames.ts` was written from scratch in TypeScript, but it is a port
in every sense that matters: upstream ships `tools/svg2frames.py`, which
rasterises CSS-animated SVG to frames through headless Chromium via Playwright,
defaults to 8fps, and screenshots with the background omitted. Ours does the
same job by the same method under a near-identical name. No line was copied,
and saying "no upstream tooling code is used" would still be a poor
characterisation, so this section exists instead.

Where it diverges is documented in `tools/svg2frames.ts`: seeking sets
`currentTime` alone and does not compensate for `animation-delay`, because the
effect applies its own delay and subtracting it again silently collapses every
animation onto one phase.

### What is ours

Every animation built on the base geometry, the host-side renderer, daemon,
protocol and CLI, and all pack content. Tamaclaude renders frames on the host
in TypeScript and treats the ESP32 as a dumb blitter, where Clawd Tank renders
on-device in C with LVGL and maintains a separate SDL2 simulator.

The debt is to the idea, the method, and one very well-made SVG.

### Upstream licence

MIT requires that this notice travel with the work, and
`assets/clawd/base.svg` is a verbatim copy:

```
MIT License

Copyright (c) 2026 Marcio Granzotto Rodrigues

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Waveshare

The only firmware written so far is the throughput spike in
`packages/device/firmware/throughput`, which is ours: ESP-IDF headers and
FreeRTOS, no Waveshare material. Nothing is owed for it.

The debt is still ahead. The blitter starts from Waveshare's demo code for the
ESP32-C6-LCD-1.47 rather than from scratch — that demo carries a working ST7789
initialisation sequence and the correct pin mapping, and re-deriving those by
hand is a day this project does not have. See `docs/HARDWARE.md`. Record the
terms here when the blitter lands.

## Other

- **[Departure Mono](https://departuremono.com/)** by Helena Zhang — the
  display typeface, vendored at `assets/fonts/DepartureMono-Regular.woff2`
  with its licence alongside. SIL Open Font License 1.1, © 2022–2024 Helena
  Zhang.
- **Enclosure** — no STL has been chosen yet. `docs/HARDWARE.md` lists the
  candidates; record the model and its licence here once one is picked and
  printed.
