# Animation

Animations in Tamaclaude are **code, not drawings**. They are CSS-animated SVG,
generated against one fixed base geometry, rasterised to frames by a TypeScript
pipeline.

This is the technique from upstream clawd-tank (see `CREDITS.md`). It is the
reason a non-artist can build this: character consistency is **structural, not
statistical**. Every animation is the same geometry with different keyframes,
so frames cannot drift. That is precisely the failure mode that rules out AI
image generators for this job.

## The base geometry

`assets/clawd/base.svg` — upstream's `clawd-static-base.svg`, unmodified.

```
viewBox="0 0 15 16"
```

Fifteen units wide, sixteen tall, every coordinate an integer. The small
coordinate space is load-bearing, not incidental: it is what lets a language
model reason reliably about `translateY(1px)` meaning exactly one art pixel,
without drowning in decimal path data.

| Element ID         | Rect           | Notes                                                              |
| ------------------ | -------------- | ------------------------------------------------------------------ |
| `ground-shadow`    | 3,15 9x1       | Outside `master-group` — the shadow stays put while the body moves |
| `master-group`     | —              | Wraps everything animatable                                        |
| `body-color-group` | fill `#DE886D` | One attribute recolours the whole crab                             |
| `torso`            | 2,6 11x7       |                                                                    |
| `left-arm`         | 0,9 2x2        | Taps by translating; never rotates                                 |
| `right-arm`        | 13,9 2x2       | Taps by translating; never rotates                                 |
| `outer-left-leg`   | 3,13 1x2       |                                                                    |
| `inner-left-leg`   | 5,13 1x2       |                                                                    |
| `inner-right-leg`  | 9,13 1x2       |                                                                    |
| `outer-right-leg`  | 11,13 1x2      |                                                                    |
| `eyes-color-group` | fill `#000000` |                                                                    |
| `left-eye`         | 4,8 1x2        |                                                                    |
| `right-eye`        | 10,8 1x2       |                                                                    |

The two colour groups are why packs can stay thin — a pack recolours Clawd by
overriding two `fill` attributes, not by shipping its own character.

## The generation contract

An animation SVG may **only add CSS transforms and keyframes to elements that
already exist, by their existing IDs, at their existing coordinates and
colours**. It may never redraw the character.

Break this and animations start drifting from each other, which is the entire
problem the approach exists to solve.

New elements _may_ be added for props and effects — a hammer, sparks, floating
data bits, a wizard hat. Those are additive and don't touch the base geometry.

## Canvas conventions

The character occupies `0..15` horizontally and `0..16` vertically. Animations
that need room for props extend the viewBox around it rather than moving the
character — upstream's typing animation uses `viewBox="-15 -25 45 45"`, giving
the same 15x16 crab a 45x45 stage with headroom for floating data bits.

Keep the character's own coordinates untouched. Grow the stage instead.

**The stage has a ceiling.** At 8 device pixels per unit the panel's 172px width
allows 21.5 units. `typing.svg` uses 21. Upstream's 45-unit example would render
360px and be clipped in half, so treat it as an illustration of the technique,
not of the budget. `tools/svg2frames.ts` warns when a stage exceeds the panel.

## Pipeline

```
base.svg + plan prose --LLM--> animation.svg --Playwright--> PNG frames
                                                                 |
                                     quantise + palette-lock (planned)
                                                                 |
                                                RLE RGB565 --> renderer
```

Written per animation as prose first — action, body mechanics, eyes, effects —
then handed to the model with the base SVG and one existing animation as an
example. The prose plan is the reviewable artefact; the SVG is its output.

## Render scale

**Render at 8 device pixels per SVG unit.** `tools/svg2frames.ts` defaults to
this. It is not an arbitrary choice, and the obvious-looking alternative is
worse.

The intuition is that pixel art should be rendered at one device pixel per art
pixel and then upscaled nearest-neighbour — crisp by construction, and 64x
smaller on the wire (1,050 bytes per frame against 67,200). It was tried during
the typing spike and the result was markedly worse.

The reason is that the rasteriser does not snap sub-pixel geometry to the
grid — it _antialiases_ it into intermediate colours. A rotated claw or a
half-unit body jitter, rendered into a 21x25 buffer, becomes a smear of blended
browns where the sprite should have hard edges. Upscaling then magnifies the
mud. At 8x the same sub-pixel motion lands inside a block that is still
overwhelmingly one colour, so the sprite stays clean and only the moving edge
softens.

So the constraint runs the other way round from what you would guess: **a high
render scale is what makes sub-unit motion safe.** The body jitter translates
half a unit, which at 8x is exactly 4 device pixels — a whole number, so the
edge stays hard.

**Rotation is the exception, and it is banned.** A rotated edge is diagonal, so
unlike a sub-unit translation it cannot land on the pixel grid at _any_ scale.
It always antialiases into a soft smear against an otherwise razor-sharp
sprite. The first version of `typing.svg` rotated the claws and looked visibly
wrong next to the torso; they now tap by translating a whole art pixel. Use
translation, `steps()` timing, and opacity that is only ever 0 or 1.

Payload is not a reason to revisit this. We send dirty rectangles, not whole
sprites, and RLE handles the large flat areas that pixel art is made of.

## Timing

Two rules, both learned the hard way and both easy to violate silently.

**Every sub-animation period must divide the loop duration.** The loop is 1.0s
at 8fps. Periods of 0.25s, 0.5s and 1.0s all divide it, so frame 8 is identical
to frame 0 and the loop is seamless. A period of 0.3s does not, and the seam
appears as a visible hitch once per loop.

**Nothing may run at the frame interval.** 0.125s _is_ one frame at 8fps, so an
animation with that period is sampled at the same phase every single frame and
renders as completely static. The fastest perceivable cycle is 0.25s — two
frames, alternating.

**A timing function applies per keyframe interval, never across the whole
animation.** `steps(8)` on a four-keyframe animation does not quantise the loop
into eight positions — it subdivides each of the four segments into eight. The
first `typing.svg` used it on the rising data bits and sampled one segment at
96% of its way through, rendering a bit at opacity 0.125: precisely the
intermediate colour the code comment claimed it prevented. Put every keyframe
percentage on a frame boundary instead, and let `linear` do the interpolating.

**What actually keeps motion on the grid is arithmetic.** A translation stays
pixel-exact when `distance x scale / frameCount` is a whole number. The data
bits rise 14 units over 8 frames at scale 8: 14 x 8 / 8 = 14 whole pixels per
frame. Check this before trusting a render — it is invisible until quantisation.

Negative `animation-delay` is how elements are put out of phase with each other
— the two claws tap alternately via `-0.125s`. Give each offset element its own
explicit delay rather than reaching for an `nth-child` stride: a stride hands
symmetric groups identical delay sets, and they then animate as exact mirror
images of each other.

`tools/svg2frames.ts` seeks by setting `currentTime` alone and does not
compensate for the delay. A paused CSS animation reports `currentTime: 0`
whatever its delay, which looks like the offset has been lost — it has not. The
delay lives inside the effect, which derives its own active time as
`localTime - delay`. Subtracting the delay a second time double-counts it, and
because delays are usually a neat fraction of the period, the error lands an
exact whole period away and renders as flawless lockstep. Everything still
moves; it just all moves together.

## Judging an animation

**Not in a browser at 8x zoom.** A pixel animation looks completely different
at 172x320 on a 1.47" panel than it does scaled up on a monitor. Judge in the
dev harness at true size, and on the panel itself once hardware allows. This is
why BUILD_PLAN builds the renderer before mass-producing animations — getting
this wrong means redoing eleven animations instead of one.
