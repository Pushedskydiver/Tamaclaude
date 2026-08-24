# Credits

## Clawd Tank

Tamaclaude exists because of
**[marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank)**
by Marcio Granzotto Rodrigues, MIT licensed. Four things are owed to it
directly.

**The board's pin map and its two panel quirks.** The SPI pin numbers, the
requirement to run the ST7789 inverted, and — worth more than either — the
observation that the controller's 34-pixel column offset lands on a different
axis depending on `swap_xy`. All from `firmware/main/display.c`, all reused in
`packages/device/firmware/blitter`. That last one is a comment in their source
and it saved a day of chasing a display that looks almost right.

**The concept.** A tiny desk display driven by Claude Code hooks, with an
animated pixel character whose behaviour reflects which tool Claude is
currently using. The hook-event-to-animation mapping — debugger for
`Read`/`Grep`, typing for `Edit`/`Write`, building for `Bash`, sweeping on
`PreCompact` — originates there.

**The animation technique**, which is the more valuable of the two ideas. Clawd
Tank authors its sprites as CSS-animated SVG generated against one canonical
base geometry with stable element IDs, so character consistency is structural
rather than statistical.

This paragraph used to add "under the constraint that a generated animation may
only add transforms and keyframes to existing elements with existing IDs — never
redraw the character". That is not what upstream does, and saying it here was
worse than saying it elsewhere: this is the file carrying their MIT notice, so
it was a false claim _about them_. `docs/ANIMATION.md` §The generation contract
records the correction — upstream redraws poses freely across its catalogue and
is more consistent for it, not less, and `docs/ANIMATION.md` cites "upstream's
convention" for naming a pose variant. `BUILD_PLAN.md` tracked three copies of
the retired wording being cleaned up on 22 Aug; this was the fourth and nobody
found it until an animation was built _by_ redrawing a pose, taking upstream's
splooted overheated crab as its reference. That idea is theirs, it is not obvious, and it is the reason a
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

**Nothing, in the end.** This section long said the blitter would start from
Waveshare's demo code so as not to re-derive the ST7789 initialisation sequence
by hand. It did not need to: ESP-IDF's own `esp_lcd` component has an ST7789
driver, so there was no sequence to derive. Neither firmware in
`packages/device/firmware/` contains any Waveshare material.

The board itself is theirs, and the factory image that shipped on it is backed
up outside this repo rather than vendored into it.

## Other

- **[Departure Mono](https://departuremono.com/)** by Helena Zhang — the
  display typeface, vendored at `assets/fonts/DepartureMono-Regular.woff2`
  with its licence alongside. SIL Open Font License 1.1, © 2022–2024 Helena
  Zhang.
- **Enclosure** — no STL has been chosen yet. `docs/HARDWARE.md` lists the
  candidates; record the model and its licence here once one is picked and
  printed.
