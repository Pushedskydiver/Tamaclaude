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

## Articulation without rotation

Rotation is banned, and the base geometry has no joints — four 1x2 leg rects and
two 2x2 claws. That rules out a great deal on its face: a gear that cannot turn,
a broom that cannot swing, a reach with no elbow.

The way out is the one pixel art has always used. **Rotation is drawn, not
transformed.** A turning gear is two or three gear shapes swapped in sequence; a
swinging broom is three broom positions; a reaching claw is two claw positions.
Discrete poses, toggled by opacity, at 8fps.

Under the contract that means:

- Every base element stays present at its original coordinates and colours.
- A base element **may be hidden** for part of a loop — `opacity: 0` is a
  keyframe on an existing element, which the contract already permits.
- Alternate poses may be **added as new elements**, provided they are
  axis-aligned rects on the unit grid and inherit their fill from one of the
  colour groups, so a pack recolour still reaches them.

So a claw reaching up is: hide `#left-arm`, show `#left-arm-raised` — a new rect
inside `#body-color-group`. The character stays consistent because the palette,
the grid and the silhouette language are unchanged; only the pose is new.

Prefer translation where translation will do. Reach for pose swapping when the
motion is genuinely rotational, and keep the pose count to two or three — every
pose is drawing, which is the thing this pipeline exists to minimise.

## What pose swapping cannot do

It works for props. It does **not** work for repositioning the character's own
limbs, and that is a property of the base geometry rather than the technique.

The torso is a single solid 11x7 rect with no head, neck or shoulder
separation, and the claws are 2x2 blocks in the same fill. A claw moved
anywhere adjacent to the torso merges into its silhouette and reads as the body
having grown a lump. Three positions were rendered and judged at true size
while building `thinking` — beside the head at (0,6), detached above it at
(0,4), and on the shoulder at (2,4) — and all three failed identically. The
base arms read as arms only because they sit at the canonical mid-height where
the eye already expects a crab's claws.

**So let props carry the motion, not limbs.** A sweep is a broom translating
while the body leans; a lift is a barbell moving while the body squashes; a
reach is a handhold appearing above while Clawd translates up. In each case the
limb stays exactly where the base puts it and something else does the moving.

This is the constraint that shapes `bouldering`, `sweeping` and `gym`. Plan
them around a prop or they will cost a day each and be abandoned.

`gym` was built to that rule and it holds: a barbell travels from head height
to full extension and back, the body dips a whole unit under the load, and not
one limb moves. The lift reads entirely from the prop. Two refinements came out
of it:

- **Interior contrasting elements are exempt.** The silhouette problem applies
  to same-fill blocks on the outline. The eyes are black on a solid body and
  can be moved or pose-swapped freely — they are read against the torso, not as
  part of its edge.
- **Never reach for a scale transform.** Squash-and-stretch is the obvious way
  to show load, and the pixel arithmetic above covers translation only. A
  scaled edge lands between pixels and softens everything it touches. `gym`
  dips a whole unit instead, which costs nothing and stays hard.

## Safe area

The stage is authored 21 x 25 units. **Everything essential must sit inside the
bottom 20 units** — viewBox y from -4 to 16. The top five are prop headroom
that portrait keeps and landscape does not.

The reason is mounting. The panel is 172 x 320, so landscape is 320 x 172 and
the stage at 25 units by 8 device pixels is 200px tall — taller than a
landscape panel. Landscape therefore crops to 21 x 20 rather than rescaling,
because rescaling to 172/25 is 6.88 device pixels per unit and every motion in
every animation would land between pixels.

All four animations built so far clear it: `gym` and `thinking` top out at
y=-1, `typing`'s data bits reach y=-2.5 while still visible. `bouldering`'s
scroll pattern extends past the crop by design and loses nothing, since it
repeats.

Check it by asking what the topmost _visible_ element reaches — an element at
zero opacity does not count, which is what gives `typing` its headroom.

## Scrolling backgrounds

A background that scrolls must **tile**, and tiling is arithmetic rather than
taste: the pattern's period and the scroll distance have to be the same number.
`bouldering` repeats its holds every 8 units and scrolls exactly 8 units per
loop, so the frame at t=1.0s is byte-identical to the frame at t=0 and the loop
cannot seam. Any other pairing jumps visibly once a second — and once a second
is exactly the cadence at which the eye notices.

The per-frame step still has to be whole: 8 units over 8 frames at scale 8 is 8
device pixels a frame. Verify both properties by rendering rather than by
reading the CSS — screenshot at t=0 and t=1000ms and compare hashes.

Scroll the background _away_ from the direction of travel. Holds moving down
read as Clawd going up, the same relationship a camera has to a climber it is
following. `road bike` needs this same technique horizontally.

## Canvas conventions

The character occupies `0..15` horizontally and `0..16` vertically. Animations
that need room for props extend the viewBox around it rather than moving the
character — upstream's typing animation uses `viewBox="-15 -25 45 45"`, giving
the same 15x16 crab a 45x45 stage with headroom for floating data bits.

Keep the character's own coordinates untouched. Grow the stage instead.

**The stage has a ceiling in both axes.** At 8 device pixels per unit the
panel's 172px width allows 21.5 units, and the stage band is 200px tall, which
allows 25. `typing.svg` uses exactly 21 x 25 and that is the fixed stage size —
the panel's other three bands (status, session strip, message) occupy the
remaining 120px and a taller stage silently eats them. Upstream's 45-unit
example would render 360px and be clipped in half, so treat it as an
illustration of the technique, not of the budget. `tools/svg2frames.ts` warns
when a stage exceeds either bound.

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
