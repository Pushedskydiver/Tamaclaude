# Credits

## Clawd Tank

Tamaclaude exists because of
**[marciogranzotto/clawd-tank](https://github.com/marciogranzotto/clawd-tank)**
by Marcio Granzotto Rodrigues (MIT).

Two things are owed to it directly:

**The concept.** A tiny desk display driven by Claude Code hooks, with an
animated pixel character whose behaviour reflects which tool Claude is
currently using. The hook-event-to-animation mapping — debugger for
`Read`/`Grep`, typing for `Edit`/`Write`, building for `Bash`, sweeping on
`PreCompact` — originates there.

**The animation technique**, which is the more valuable of the two. Clawd Tank
authors its sprites as CSS-animated SVG generated against one canonical base
geometry, under the constraint that a generated animation may only add
transforms and keyframes to existing elements with existing IDs — never redraw
the character. Character consistency is therefore structural rather than
statistical. That idea is theirs, it is not obvious, and it is the reason a
non-artist can build this at all. See `tools/gemini_animate.py` and
`assets/svg-animations/PLANS.md` in the upstream repo.

Clawd — the crab — is Claude's mascot and is used here in the same spirit.

**What is not shared:** Tamaclaude renders frames on the host in TypeScript and
treats the ESP32 as a dumb blitter, where Clawd Tank renders on-device in C
with LVGL and maintains a separate SDL2 simulator. No upstream code or SVG
assets are copied — the architecture, the implementation and the artwork here
are our own. The debt is to the idea and the method.

## Other

- **[Departure Mono](https://departuremono.com/)** by Helena Zhang — the
  display typeface. SIL Open Font License.
- **Enclosure** — the printed case derives from a community STL for the
  Waveshare ESP32-C6-LCD-1.47; see `docs/HARDWARE.md` for the specific model
  and its licence.
