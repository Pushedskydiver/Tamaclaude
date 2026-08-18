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

## Judging an animation

**Not in a browser at 8x zoom.** A pixel animation looks completely different
at 172x320 on a 1.47" panel than it does scaled up on a monitor. Judge in the
dev harness at true size, and on the panel itself once hardware allows. This is
why BUILD_PLAN builds the renderer before mass-producing animations — getting
this wrong means redoing eleven animations instead of one.
