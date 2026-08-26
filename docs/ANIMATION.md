# Animation

Animations in Tamaclaude are **code, not drawings**. They are CSS-animated SVG,
generated against one fixed base geometry, rasterised to frames by a TypeScript
pipeline.

This is the technique from upstream clawd-tank (see `CREDITS.md`). It is the
reason a non-artist can build this: character consistency is **structural, not
statistical**. Every animation is the same geometry with different keyframes,
so frames cannot drift. That is precisely the failure mode that rules out AI
image generators for this job.

It does not rule out AI. It relocates it. Upstream's animations are
LLM-authored — their sprite redesign commit is co-authored by Claude — and so
are these. The model writes CSS against a fixed geometry, where a wrong answer
is a visibly wrong transform, rather than generating pixels, where a wrong
answer is a subtly different crab. Everything downstream of that choice — the
review loop in §The authoring loop especially — exists because the output is
code and can be checked like code.

## The base geometry

`assets/clawd/base.svg` — upstream's `clawd-static-base.svg`, unmodified.

```
viewBox="0 0 15 16"
```

Fifteen units wide, sixteen tall, every coordinate an integer. The small
coordinate space is load-bearing, not incidental: it is what lets a language
model reason reliably about `translateY(1px)` meaning exactly one art pixel,
without drowning in decimal path data.

| Element ID         | Rect           | Notes                                                            |
| ------------------ | -------------- | ---------------------------------------------------------------- |
| `ground-shadow`    | 3,15 9x1       | **Reference only — do not copy it into an animation.** See below |
| `master-group`     | —              | Wraps everything animatable                                      |
| `body-color-group` | fill `#DE886D` | One attribute colours the crab _in this file_ — see below        |
| `torso`            | 2,6 11x7       |                                                                  |
| `left-arm`         | 0,9 2x2        | Taps by translating; never rotates                               |
| `right-arm`        | 13,9 2x2       | Taps by translating; never rotates                               |
| `outer-left-leg`   | 3,13 1x2       |                                                                  |
| `inner-left-leg`   | 5,13 1x2       |                                                                  |
| `inner-right-leg`  | 9,13 1x2       |                                                                  |
| `outer-right-leg`  | 11,13 1x2      |                                                                  |
| `eyes-color-group` | fill `#000000` |                                                                  |
| `left-eye`         | 4,8 1x2        |                                                                  |
| `right-eye`        | 10,8 1x2       |                                                                  |

The two colour groups are an authoring convenience: one attribute per group
carries the colour, so within a file recolouring the body is one edit rather
than seven, and the eyes one rather than two.

**No pack uses them, and neither does `base.svg` alone.** Sprites are baked to
fixed RGB565 by `tools/bake-sprites.ts` and no pack palette reaches a baked
sprite — `packages/packs/src/index.ts` records that retraction. Each animation
also carries its own copy of the geometry and its own `fill`, so sixteen
tracked files under `assets/` declare `body-color-group`.

**And the groups do not contain every fill.** Ten animations declare the body
colour a second time on `#legs-group`, outside the colour group — not because
legs have to sit outside it to move, since `bouldering` animates each leg from
inside, but because in those files the group that _moves_ and the group that
carries the colour are the same element, and a leg cannot both ride the torso
and step independently. So the real measure of a recolour is
the grep, not a count anyone can quote — `grep -ro 'fill="#DE886D"' assets/`
today returns more attributes than there are files. Run the grep rather than
quoting a figure: this count was stated wrong three times in one day before
anyone checked it against the corpus.

Nor is it one re-bake: most are animations that go through `bake-sprites`,
`splash.svg` bakes to a firmware header and so needs a reflash, and `base.svg`
bakes to nothing, being the reference the others were copied from. A build step
rather than a runtime one, and the reason the character is not per-pack.

**`ground-shadow` is the one base element an animation must not carry.** Seven of the eight carried it at half opacity, which is what
`snapToPalette` drops, and `bouldering` carried it at zero on purpose. Black at
half opacity is dropped — it snaps to the
background and arrives part-transparent, which is the pair of conditions the
transparency rule tests for — so all eight animations declared a shadow and all
eight drew zero pixels of it. Invisible for as long as the stage behind Clawd
was black, and a floating crab the moment the rock pool was wired on.

The renderer draws it now, at these same coordinates, in a tone that knows which
of the four grounds it is falling on: `paintContactShadow` in
`packages/renderer/src/environment.ts`. It is skipped for animations where he is
not on the ground — `castsShadow` names them, and `bouldering` is the one.

The note is here rather than in `base.svg` because that file is a byte-identical
copy of upstream's, `CREDITS.md` asserts its md5 as part of the MIT attribution,
and `.editorconfig` carries a rule whose only job is protecting that identity. A
ten-line comment added there broke the claim in three tracked files at once,
which is a false attribution statement in a public repo.

## The generation contract

An animation SVG works from `assets/clawd/base.svg` and keeps its palette, its
proportions and its silhouette. Within that, motion is CSS: transforms and
keyframes applied to elements by ID.

New elements _may_ be added for props and effects — a barbell, a laptop, a
thought bubble, floating data bits, a tear.

**Pose variants may be drawn** where no transform can reach the pose: a sploot
for sleeping, a squint for reading, legs tucked up. Give the variant its own id
(`torso-sploot`, `left-eye-squint`, upstream's convention) and keep the fill
and the rough scale of what it replaces. This is narrower than it sounds — the
character is eight rectangles, so a variant is a rectangle with different
numbers in it, not a redrawing.

What the contract actually protects is that every animation is recognisably the
same creature. That comes from the shared base, the two-colour palette and the
silhouette, not from a rule against ever typing a coordinate. The earlier
version of this section banned redraws outright; upstream redraws poses freely
across nineteen animations and they are more consistent than ours, not less.

## Articulation

Rotation is available, and limbs should use it. The claws are 2x2 blocks
hanging off the torso at (0,9) and (13,9); given a `transform-origin` at the
shoulder — around (2,10) and (13,10) — they swing like limbs instead of sliding
like tiles.

**Put the pivot where the joint is.** This is most of the difference between a
part that articulates and a part that slides. The pivots that recur:

| Pivot          | Use                                         |
| -------------- | ------------------------------------------- |
| `2px 10px`     | left shoulder                               |
| `13px 10px`    | right shoulder                              |
| `7.5px 13px`   | torso base — breathing, stretching          |
| `7.5px 15px`   | the floor — whole-body squash, sway, lean   |
| `7.5px 9px`    | the eye line — blinks                       |
| `7.5px 15.5px` | the shadow — retired; the renderer draws it |

**Scale is how a body deforms.** Non-uniform `scale()` about a floor or
torso-base pivot gives squash and stretch: `scale(1.02, 1.25)` is a chest
filling with air, `scale(1.05, 0.95)` is weight landing. Keep volume roughly
conserved — widen as you shorten — or it reads as the sprite being stretched
rather than the creature moving.

**Scale by size, not by taste.** Rotation and scale earn their place on small
parts turned far enough for the result to be a _shape_: a 2x2 claw at 45deg
renders as a diamond and reads as an arm thrown out. They fail on large slabs
turned a little. A 2.5deg tilt of the torso — 88x56 device pixels — was tried
in `idle` and looked broken: snapping a shallow diagonal turns a long edge into
a lumpy staircase that reads as a corrupted sprite. Lean the body by
translating it against planted legs instead.

## What a claw cannot do

The torso is a single solid 11x7 rect with no head, neck or shoulder
separation, and the claws are 2x2 blocks in the same fill. **A claw parked
adjacent to the torso merges into its silhouette** and reads as the body having
grown a lump. Three positions were rendered and judged at true size while
building `thinking` — beside the head at (0,6), detached above it at (0,4), and
on the shoulder at (2,4) — and all three failed identically.

Rotation gets it out of the silhouette. It does not, on its own, make it read.
`thinking.svg` §Why neither claw rotates records the swing this section used to
recommend: 45deg, mechanically clean, two poses and no staircasing — and it
still read as "a spike rather than a hand", a fin flicking beside the body
twice a cycle. A 2x2 block turned 45deg is an arrowhead, and an arrowhead hung
off an 11x7 slab is not a limb.

What makes a raised claw read is **length**. `gym` rotates to -73deg _and_
`scaleX(2.85)`, extending the claw along its own axis until it is an arm rather
than a lozenge; that puts the tip at (13.71, 4.26), 1.74 units above the head,
which no rotation alone can reach. A 2x2 claw pivoting at the shoulder cannot
get its top edge above y=7.76 — the pivot is at y=10 and the far corner is
sqrt(5) away — so the torso top at y=6 is beyond it by 1.76 units, always.

So: extend a claw as well as turning it, and give it something to hold. Do not
park it against the edge, and do not expect rotation by itself to buy a pose.

## Safe area

The stage is authored 21 x 25 units. **Everything essential must sit inside the
bottom 20 units** — viewBox y from -4 to 16. The top five are prop headroom
that portrait keeps and landscape does not.

The reason is mounting. The panel is 172 x 320, so landscape is 320 x 172 and
the stage at 25 units by 8 device pixels is 200px tall — taller than a
landscape panel. Landscape therefore crops to 21 x 20 rather than rescaling,
because rescaling to 172/25 is 6.88 device pixels per unit and every motion in
every animation would land between pixels.

Measured topmost drawn pixel, across every frame of every animation then in
the corpus: `idle` +5.375,
`gym` +2, `confused` +2, `typing` -0.5, `permission-sign` -2, `thinking` -3,
`asleep` -3, `dizzy` -3, `overheated` +1, `bouldering` -9. So the closest anything non-exempt
comes to the -4 line is `thinking`, `asleep` and `dizzy` at -3, which is one
unit of margin, not none.

`dizzy` is the one to watch, though not for the reason a first draft of this
paragraph gave. Its body tops out at +5.875, so every bit of that -3 is an
orbiting
star and a one-unit change of orbit radius changes the figure with no drawing
edited. That is not new — `asleep`'s -3 is a rising Z on the same terms. What is
different is how much of the loop is spent there: measured across the bakes,
`thinking` sits at its -3 on all 64 frames but the value is static, `asleep`
reaches -3 on 6 frames of 96, and `dizzy` on **72 of 96**. So it is the one
animation that is both at the line for most of its loop and moved there by a
keyframe.

**`bouldering`'s -9 is its wall, and the wall does not count.** It is inside
`#fx-wall`, which carries `data-safe-area="ignore"` precisely so this rule skips
it, and its scroll pattern extends past the crop by design and loses nothing
because it repeats. `svg2frames`' own safe-area walk honours that attribute and
reports +5.75 for `bouldering`; the figure above is the raw pixel extent. If you
are checking whether an animation violates the crop, the tool's number is the
one to read, and it warns on its own.

An earlier version of this line read "`gym` +2, `typing` -2.5, `thinking` -4"
and added that `thinking` "sits exactly on the line with no margin" — two of the
three numbers were wrong and the warning drawn from them was wrong with them.

Check it by asking what the topmost _visible_ element reaches — an element at
zero opacity does not count, which is what gives `typing` its headroom.

## Props need contact

Seeing the animations side by side made one thing obvious that none of them
showed alone: **the ones that read have a prop touching Clawd, and the ones
that do not have a prop floating near him.**

`typing` was always the strongest, and at the time it was the only one whose
prop overlapped him — the laptop sits in front and the claws tap at it. `gym` racked
its barbell three units clear of the claws and read as a bar hovering above a
crab. Bringing it down to chest height changed the reading completely. The
plates do not literally overlap the claws — they sit in the adjacent pixel
column, sharing the same rows — but the bar crosses the torso and is drawn over
it, which is enough. The motion changed with the position: travel doubled from
four units to eight, so the bar still reaches overhead from its lower start. `bouldering`
scrolled holds past a character standing in empty space; a horizontal panel
seam every 8 units gave him a wall to be on and the holds something to be
fixed to.

**The exception is a symbolic overlay.** A thought bubble is not held, and
attaching it read as a lump growing out of his head — comics float them, with
the descending dots doing the connecting. So the rule is about props a
character physically manipulates, not about everything additive.

Two smaller lessons from the same pass:

- **Contact creates collisions.** Bringing the barbell to chest height put it
  across the eyes on the two frames it passes the face. Fixed by closing them on
  those frames — but a prop moved into the character needs checking against
  every part it now crosses.
- **Do not track a moving prop with a body part.** The eyes originally
  translated up to follow the bar, which walked them into its path on a frame
  the closed frames did not cover. A tracking motion that moves a part into a
  prop is worse than no tracking.

## Closing an eye

**A closed eye is squashed, never deleted.** Hiding the eye rect leaves nothing
on screen saying "closed", and at 8fps that reads as a rendering glitch rather
than a blink.

`transform: scaleY(0.1)` about the eye line at `7.5px 9px` collapses the 1x2
rect to a line, which after the palette snap is a hard 1x1 lid. Upstream does
exactly this in every animation that blinks, and it is one declaration instead
of a second drawn element kept mutually exclusive with the first.

Earlier versions of `idle`, `gym` and `asleep` drew a separate lid rect and
toggled opacity between the two. It worked, but it needed an invariant — that
exactly one of the eye and its lid is visible on every frame — and an invariant
maintained by hand is a defect waiting for a distracted edit. The squash cannot
get out of sync with itself.

**Blink on `linear`, not `ease`.** A lid that accelerates reads as a wince.

## Clawd lives somewhere

**The stage is an environment, not a void.** A character animating on black
reads as an asset preview; the same character standing in a place reads as a
creature. Upstream clawd-tank does this and it is most of why theirs feels
alive — their idle is a night sky with stars, drifting fireflies, and a strip
of grass he stands on.

Ours will not be that scene. The idea is worth taking; the picture is theirs.
What goes behind him is decided and built: a rock pool through the day, in
`packages/renderer/src/environment.ts` — written 21 Aug, wired into `sceneFor`
a day later, `BUILD_PLAN.md` Stage 4. What stayed open was whether a pack may
vary it, and that was cut on 25 Aug.

What _is_ settled is where it lives, because that turns out to matter:

**Ambient scenery is a renderer layer, drawn behind the sprite.** Not baked
into each animation SVG. Four reasons, and the last is the one that decides it:

- One definition, reused by every animation, so they cannot drift apart.
- No pack changes it, and none will before 23 Sep: the field was cut on 25 Aug
  and `ENVIRONMENT_EXTENT` is a constant. The reason stays on the list because
  it is a property of the layer rather than of the field — the renderer is
  where a pack lever would have to live if one is ever wanted, which is not
  true of scenery baked into each SVG.
- Time of day, or any other ambient variation, becomes trivial.
- It keeps the animation contract intact. An SVG carrying a sky would no longer
  be "the base geometry plus transforms", and the whole reason character
  consistency is structural here is that every animation is provably the same
  eight rectangles.

**Scenery that moves with the action stays in the SVG.** `bouldering` scrolls
its wall because the wall _is_ the animation — the holds pass him and that is
what says "climbing". A horizontal equivalent was planned for `road bike`,
which is cut, so `bouldering` is the only animation this applies to. The test is
whether the background would still make sense if the character were removed: a
sky would, a climbing wall would not.

Both can be on screen at once, and the layering is the obvious one: ambient
behind, animation frame over it, sprite within that.

## Scrolling backgrounds

A background that scrolls must **tile**, and tiling is arithmetic rather than
taste: the pattern's period and the scroll distance have to be the same number.
If the pattern repeats every P units, the background must travel exactly P
units — or a whole multiple of it — over the loop. Then the last frame lands
where the first one started and the loop cannot seam. Any other pairing jumps
visibly once per loop, which is exactly the cadence at which the eye notices.

The per-frame step should also be whole: `P x scale / frameCount` device
pixels. `bouldering` is the worked example, and its numbers have changed twice,
so take the rule and not the figures.

**Verify by rendering, not by reading the CSS.** Compare the hash of the last
frame against frame 0 — they should differ by exactly one step, and a
mid-loop frame should differ from frame 0 too. This section previously quoted
`bouldering` as scrolling 8 units over 8 frames when the file had moved to 4
device pixels over 16, and a critic caught it by measuring rather than
believing the prose. The doc is not the source of truth for a number the file
owns.

Scroll the background _away_ from the direction of travel. Holds moving down
read as Clawd going up, the same relationship a camera has to a climber it is
following. A horizontal version of the same technique was `road bike`'s, and
that screen is cut — this section is kept because the rule is about scrolling
scenery generally, and `bouldering` is the animation that has it.

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

## Palette snapping

**The rasteriser quantises every frame to the palette the SVG declares.** This
is the step that makes everything else in this document possible, and it is the
one thing upstream had that we did not.

Chromium antialiases a rotated or sub-pixel edge into a gradient. After
`tools/svg2frames.ts` has captured a frame it composites it over the stage
background, snaps each pixel to the nearest declared colour, and writes that.
An antialiased edge collapses back onto one side or the other, so the edge lands
on a whole device pixel _after the fact_ rather than being forbidden from
leaving it.

Measured on upstream's idle ported into our viewBox: antialiased pixels 1.51%
to 0.00%, compression 44:1 to 122:1, wire cost 0.63% of the USB budget. The
expressive version is both sharper and cheaper than the number the old ban was
protecting.

The palette is derived from the document, not passed in: every literal
`fill="#RRGGBB"`, the background, and — separately — any fill an element
declares at partial opacity, composited over the background. That last part is
why it is derived. Blending _every_ fill with _every_ opacity would manufacture
tones halfway between the real ones, and an antialiased edge pixel would then
find a legitimate-looking neighbour to snap to instead of resolving to one
side. Only pairs the artwork actually declares are admitted.

Two consequences for authors:

- **Declare colours as literal fills.** A colour that only ever arises from
  blending is not in the palette, so it gets snapped away. `#40C4FF` on a tear
  works because the rect says so.
- **Every colour you declare becomes a snap target for every _other_ colour's
  edges.** This is the trap, and it caught `bouldering` twice. Its holds were
  drawn with a shaded underside in `#4C3475`, purely so the holds would read as
  bolted proud of the wall. That violet sits between the body's peach and the
  black stage, so a torso edge pixel at 55–65% coverage landed nearer to it
  than to anything else and painted a **one-pixel violet line across 80 of the
  torso's 88 pixels**, for 250ms, twice a loop. Deleting the group took it to
  zero on all 32 frames — and cost less on the wire, 19,992 B/s against
  21,792. Before adding a colour, ask what edge it now sits between.

- **Two drawn colours must not meet inside a scaling group.** The sharper form
  of the rule above, and the one that costs whole rebuilds. A `scale` puts
  every internal edge off the pixel grid, so Chromium antialiases it, and the
  blend of a pale prop over a dark one lands nearest **the body colour**:
  `#C9D1D9` over `#000000` at half coverage is (100,104,108), which is 15,909
  from `#DE886D` against 32,480 from black and 33,107 from the pale — peach
  wins by more than twice. `wizard`'s first hat sat inside `#breathe` and grew
  a salmon fringe on **81 of 96 frames**, with 87 frames also showing
  transparent rows cutting it into floating bars.

  **The remedy is not to freeze the prop.** A hat that ignores the breath reads
  as pasted on. Move it by whole device pixels instead, with `steps(1)`,
  sampling whatever curve the body uses — `wizard`'s `#fx-bob` is that curve
  rounded per frame, and it tracks the head to within one pixel on every
  frame. A whole pixel is never partially covered, so there is nothing to
  antialias.

  Edges facing the _background_ are not exempt: `BACKGROUND` in
  `tools/frame-palette.ts` is `[0,0,0]` and is a palette entry itself, so they
  are composited toward black and snapped like everything else. Whether that is
  safe is a property of the document's palette, not of the background — count
  the ramp. `payoff` declares `#6F4436`, which takes 50 of the 101 steps
  between peach and black.

- **Semi-transparent effects still work**, because their composited value is a
  palette entry.

  The ground shadow used to be the worked example here, on the reasoning that
  over a black stage it composites to black and vanishes while over a lighter
  stage it stays a real tone. Both halves are true of the mechanism, and the
  conclusion drawn from them was still wrong.

  What makes the shadow a special case is not the snap, it is `BACKGROUND` at
  `tools/frame-palette.ts` — a hard-coded `[0, 0, 0]`. Every bake is taken
  against black, so a half-opacity black always composites to the background
  entry, dedupes into it, and is dropped. Measured: the same rect over a
  `[48, 48, 48]` stage yields a distinct `[24, 24, 24]` entry and survives at
  full alpha. There is no stage but black, so it never did.

  The pattern is still not one to reach for, on a stronger ground than "it
  cannot work": bakes are static. A pack that sets a lighter stage at runtime
  cannot recover a pixel already dropped at bake time, so the effect can never
  arrive for the pack it was kept for. If something must be semi-transparent,
  give it a flat colour that composites to the tone you want, or draw it in the
  renderer, where the background is known at paint time.

  An earlier attempt at this correction said the snap drops such a pixel "on
  any background". That is false, and it contradicted the comment in
  `frame-palette.ts` that it left standing. That comment is right.

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

**Rotation used to be the exception, and it was banned here.** A rotated edge is
diagonal, so unlike a sub-unit translation it cannot land on the pixel grid at
_any_ scale — it always antialiases. That was true, and the conclusion drawn
from it was wrong: the fix is to clean the raster up afterwards rather than to
forbid the motion. See §Palette snapping. Rotation is now allowed, and 8x is
what keeps the smear confined to the moving edge in the first place.

Payload is not a reason to revisit this. We send dirty rectangles, not whole
sprites, and RLE handles the large flat areas that pixel art is made of.

## Loop length

The default loop is 1.0s — eight frames at 8fps. An animation may declare its
own with `data-loop-seconds` on the root `<svg>`, in whole seconds, and
`tools/svg2frames.ts` reads it. Everything downstream derives its frame count
from what it is given, so nothing else needs telling.

The resting states run long. At a one-second loop a blink happens sixty times a
minute and a breath is a pant. `idle` is sixteen seconds — long enough to hold
several distinct beats, so the thing on screen most of the time is also the
thing slowest to feel mechanical. `asleep` is twelve; `bouldering` is the four.

Longer loops are close to free on the wire, because most of the extra frames
differ from their neighbour in a small rectangle or not at all, and the dirty
rect is what gets sent. Length is a cheap way to buy variety; see §Variety
comes from beats, not from files.

## Variety comes from beats, not from files

For a state that is on for hours, one long loop with occasional beats beats a
pool of separate animations. `idle` runs sixteen seconds: it breathes
throughout, blinks twice, looks right, looks left, and yawns once. Upstream
clawd-tank solves the same problem the same way in
`assets/svg-animations/clawd-idle-living.svg`.

The advantage is structural rather than aesthetic. A pool needs the daemon to
own a list, pick from it, and decide when to switch; beats need nothing at all
outside the SVG. The variety lives in the animation.

It is also among the cheapest things in the repo. `idle` measures 3,609 B/s
against the 562.5 KB/s the link was measured at — 0.63%. It was the lowest of
the six until `permission-sign` (2,645) and `confused` (3,323) landed. The ten
that existed when this was last measured ran 2,645 / 3,323 / 3,609 / 3,905 /
5,836 / 6,163 / 6,332 / 9,966 / 14,545 / 22,568; there are more now, so
treat that spread as a shape rather than a census. The
figure here used to read 839 B/s against a 700 KB/s floor; both halves were
stale, the floor because it was never measured and the cost because the palette
snap changed what the frames contain. `pnpm measure` prints the current
numbers, and is the only thing that should be quoted.

**Give the character parts he does not have.** Clawd's base geometry has no
mouth, which is why he cannot yawn. Upstream's answer is a 3x2 rect at (6,10),
hidden except during the yawn, and it transfers directly because we share the
base. An additive element is how you extend the character without touching it.

## Smoothness

Four things separate motion that reads as a creature from motion that reads as
a sprite being nudged. Every one of them was got wrong here first, so they are
written as corrections.

**Ease, don't step.** The first version of this project banned easing and used
`steps()` throughout, to keep every edge on a whole device pixel. That is not a
trade worth making, and since palette snapping landed it is not a trade at all
— see §Palette snapping. Motion needs acceleration to read as weight; a
constant-velocity move reads as a slideshow no matter how many positions it
has. `ease-in-out` is the default; `cubic-bezier` where a beat needs a
particular attack. Zero of upstream's nineteen animations use `steps()` and all
nineteen use easing.

**Animating the whole sprite is not animating.** `idle` originally drove
`#master-group`, which contains the legs, so the entire character slid up and
down as one rigid block. Nothing deformed, so nothing read as breathing. Keep
the legs _outside_ the group that moves: it is the deformation, not the
displacement, that sells it.

**So pivot at the body's own bottom edge, and never translate upward.** This
sentence used to end "the gap that opens between body and legs is what the eye
reads as a breath", which contradicts the clause before it — a gap is
displacement — and `thinking` had already disproved it. `thinking.svg` records
the reviewed version opening "up to eleven device pixels of daylight under the
hips on 50 of 64 frames", the legs left behind as four free-floating stubs, and
the fix being to compress about a base pivot: "the bottom edge is the pivot, so
it does not move at all". Measured across the ten animations in the corpus at
the time, eight have no
transparent row between body and legs at any frame, and the two that do split
cleanly:

|         |                   gap | frames    |
| ------- | --------------------: | --------- |
| `dizzy` |        1 device pixel | 6 of 96   |
| `idle`  | up to 9 device pixels | 14 of 128 |

**One device pixel is rasterisation; a whole art unit is a lift.** At 8 device
pixels to the unit, `dizzy`'s single row is an eighth of an art pixel — an
artefact of an eased track crossing a boundary, not an authored move. `idle`'s
nine is more than a whole art pixel, and it came from an explicit
`translate(0, -1.2px)` in its yawn, which lifts the body off the legs one for
one. The rule is therefore **at most one device pixel**, and `tools/bake-sprites.test.ts`
asserts it against every bake.

**Layer tracks at different periods.** One keyframe timeline doing everything
produces motion that visibly repeats. Nest groups instead, slowest outermost,
so the transforms multiply: a 16s action track wrapping a 2s breathing track
wrapping the parts. Upstream's typing runs six concurrent periods. Each track
is simple; the combination is not.

**One element, one `animation` declaration.** The shorthand _replaces_; it does
not merge. An element named in one rule and given its own rule below silently
loses the first animation. This shipped twice in `idle.svg` — `#fx-mouth` was
in the breathing rule and had its own rule underneath, so it lost the breathing
and hung eight device pixels below the torso through the entire yawn, which is
the defect that prompted this rewrite.

Comma-separating them works. Nesting groups is better, and is what the rebuilt
files do: a `<g>` per track means no declaration can shadow another and the
question stops arising.

## Timing

**Every sub-animation period must divide the loop duration.** Frame `8N` has to
be identical to frame 0 or the loop visibly hitches once per cycle. Upstream
violates this freely — their typing runs 0.08s, 0.12s and 0.15s tracks against
no common loop — and gets away with it because those periods are too fast to
see a seam. We render a fixed frame count and play it round, so we cannot.

**An `alternate` track must divide the loop an _even_ number of times.** An odd
count ends the loop at the far end of the cycle and seams at the wrap. A 2s
`alternate` breath in a 16s loop is eight cycles: fine. A 1.6s sway is ten:
fine. 3.2s would be five, and would jump.

**Nothing may run at the frame interval.** 0.125s _is_ one frame at 8fps, so an
animation with that period is sampled at the same phase every frame and renders
as completely static. The fastest perceivable cycle is 0.25s.

**Put keyframe percentages on frame boundaries.** At a 16s loop one frame is
0.78125%, so every percentage should be a whole multiple of it. Opacity flips
in particular want adjacent frames, or a frame samples a half-faded prop and
the snap resolves it somewhere arbitrary.

**A timing function applies per keyframe interval, never across the whole
animation.** `steps(8)` on a four-keyframe animation subdivides each of the four
segments into eight rather than quantising the loop into eight positions. This
mattered more when we used `steps()`; it still bites anyone reaching for it.

Negative `animation-delay` puts elements out of phase — two claws swaying half
a period apart. Carry the offset _inside_ the `animation` shorthand
(`claw-sway 1.6s -0.8s infinite alternate`) rather than as a separate
`animation-delay` declaration, which the shorthand resets. Give each offset
element its own explicit delay rather than an `nth-child` stride: a stride hands
symmetric groups identical delay sets and they animate as exact mirror images.

`tools/svg2frames.ts` seeks by setting `currentTime` alone and does not
compensate for the delay. A paused CSS animation reports `currentTime: 0`
whatever its delay, which looks like the offset has been lost — it has not. The
delay lives inside the effect, which derives its own active time as
`localTime - delay`. Subtracting it again double-counts, and because delays are
usually a neat fraction of the period the error lands an exact whole period
away and renders as flawless lockstep. Everything still moves; it just all
moves together.

## The authoring loop

Author, render, **critique from a fresh context**, iterate. The critique step is
not optional and it is not the author's own re-read.

This is written down because it demonstrably works and the alternative
demonstrably does not. All six animations were rebuilt in one pass under it —
one agent authoring each, a second re-rendering and looking at the frames
without seeing the author's reasoning — and the second agent caught things the
first was certain about. Before that, every animation in the repo had been
self-checked, declared good, and shipped broken.

1. **Author** against this document and `assets/clawd/base.svg`. Read the
   upstream animation for the same scene first if there is one — nineteen of
   them are the quality bar, and the technique is worth stealing even where the
   scene is not.
2. **Render and self-check:**
   ```bash
   node tools/svg2frames.ts assets/clawd/animations/<name>.svg out/<name>
   node tools/measure-compression.ts out/<name>
   ```
   `svg2frames` must print no warnings. Distinct frames should be a large
   fraction of total frames — all-identical means a keyframe block was lost, and
   nothing else in the six-command suite notices.
3. **Critique.** Dispatch `animation-critic` from a fresh context. It
   re-renders, builds a contact sheet, looks at it, and checks the rules that
   have actually caught things — the `animation`-shorthand cascade first, then
   motion, loop seam, escapes, clipping, and whether the pose reads at all.
4. **Iterate** until the verdict is `ship`.

Mandatory for anything under `assets/clawd/animations/**` — see the review
trigger table in `CLAUDE.md`. Animations are stylesheets, which is to say they
are code, and they spent six PRs exempt from review because the table called
them assets.

## Judging an animation

**Not in a browser at 8x zoom.** A pixel animation looks completely different
at 172x320 on a 1.47" panel than it does scaled up on a monitor. Judge at true
size, and on the panel itself once hardware allows.

**And judge it on the ground it will actually stand on.** `pnpm harness`
composites frames over a flat backdrop, because it draws no bands and is for
scrubbing motion; the device draws the environment edge to edge, so a prop that
reads against near-black may vanish against sand.

`node tools/contact-sheet.ts out/<name>` samples ten frames across the loop,
each composed through `render()` and cropped to the stage — the artefact for
motion, on the real ground. `node tools/panel-mock.ts out/<name>` is the whole
panel in all four skies, frame 0 only — the artefact for whether a prop reads.
Between them they answer "does this move" and "does this read"; the harness
answers neither and says so.

**And not by the author.** Every animation in this repo was written, checked by
the context that wrote it, declared good, and shipped with defects that context
could not see — a mouth outside the body, a `gym` loop of eight identical
frames, a yawn that moved one pixel. Dispatch `animation-critic` from a fresh
context. It is mandatory for anything under `assets/clawd/animations/**`; see
§The authoring loop.
