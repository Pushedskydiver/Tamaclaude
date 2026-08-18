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
model reason reliably about `transform-origin: 2px 10px` without drowning in
decimal path data.

| Element ID         | Rect           | Notes                                                              |
| ------------------ | -------------- | ------------------------------------------------------------------ |
| `ground-shadow`    | 3,15 9x1       | Outside `master-group` — the shadow stays put while the body moves |
| `master-group`     | —              | Wraps everything animatable                                        |
| `body-color-group` | fill `#DE886D` | One attribute recolours the whole crab                             |
| `torso`            | 2,6 11x7       |                                                                    |
| `left-arm`         | 0,9 2x2        | Shoulder joint at `2px 10px`                                       |
| `right-arm`        | 13,9 2x2       | Shoulder joint at `13px 10px`                                      |
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

## Pipeline

```
base.svg + plan prose --LLM--> animation.svg --Playwright--> PNG frames
                                                                 |
                                           quantise + palette-lock (sharp)
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
render scale is what buys the freedom to use rotation and easing at all.** If
we ever want genuinely hard-edged, retro-authentic motion, the fix is not a
lower render scale — it is restricting the animation vocabulary to whole-unit
translations and `steps()` timing, and that is a different aesthetic decision
rather than a pipeline setting.

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

Negative `animation-delay` is how elements are put out of phase with each other
(the two claws tap alternately via `-0.125s`). This survives rasterisation
because `tools/svg2frames.ts` pauses animations before the first capture, so
each one sits at its authored starting phase rather than wherever wall-clock
time left it.

## Judging an animation

**Not in a browser at 8x zoom.** A pixel animation looks completely different
at 172x320 on a 1.47" panel than it does scaled up on a monitor. Judge in the
dev harness at true size, and on the panel itself once hardware allows. This is
why BUILD_PLAN builds the renderer before mass-producing animations — getting
this wrong means redoing eleven animations instead of one.
