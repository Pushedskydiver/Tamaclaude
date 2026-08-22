# Animation plans

`docs/ANIMATION.md` states that the prose plan is the reviewable artefact and
the SVG is its output. This file is that artefact. Write the plan **before**
generating the SVG, and review the SVG against the plan rather than against its
own rendering — an animation can only be judged wrong if something says what it
was meant to be.

The typing plan below was written after the fact, during review, because the
spike skipped this step. That omission had a cost: the first version rendered a
data bit at opacity 0.125 and nothing recorded whether a fade tail was ever
wanted, so there was no way to tell a bug from a choice.

Each plan states **action**, **body mechanics**, **eyes** and **effects**,
following the structure upstream clawd-tank uses in its own
`assets/svg-animations/PLANS.md`, plus **props** where the animation has any.
Eight of the nine carry one; `gym` alone has none, because its bar is described
under Action rather than filed as a prop, which is a distinction not worth
enforcing. One constraint applies to all of them, from `docs/ANIMATION.md`: no
rotation. The second constraint this paragraph used to name — that every
transform land on a whole device pixel at the render scale — was repealed by
§Ease, don't step once palette snapping landed, and stood here after it.

---

## Typing — `Edit`, `Write`, `NotebookEdit`

Clawd hammering at an invisible keyboard, output streaming off both claws.

- **Action.** Both claws tap, one down while the other lifts, fast enough to
  read as urgency rather than rhythm.
- **Body mechanics.** A shallow jitter, half an art pixel, alternating every
  frame. Enough to feel the effort; not enough to look like bouncing.
- **Eyes.** Track one art pixel right, then snap back — scanning a line of code
  rather than watching the claws. Half the speed of the tapping, so the two
  never lock into a single visual beat.
- **Props.** A laptop in front of him, seen from behind the lid — the machine
  faces him, so what we see is the back of the screen with a logo on it. It
  occludes the lower torso and the tops of the legs, which is what puts it in
  front, and it does not jitter with him because it is sitting on a desk.
- **Effects.** Small squares rising off each claw and popping out near the top
  of the stage. Two streams, never crossing the torso or the eyes. Hard pop in
  and out, no fade: an intermediate alpha becomes an intermediate colour once
  the palette is quantised.

**Not wanted:** a fade tail on the rising bits; any rotation; any motion
crossing Clawd's face; a lid that covers the eyes.

**Added after review: the laptop.** The first version had Clawd typing on
nothing, which upstream's own animation does not — theirs has a laptop with a
glowing logo, and it is the thing that makes "typing" legible rather than just
"waving". The lid is also the right home for a pack's logo: it is on screen
every time Claude writes code, where the firmware splash is seen once before
setup and never again.

---

## Thinking — `UserPromptSubmit`

Clawd working a problem out, a thought bubble above his head.

- **Action.** A thought bubble above his head, three dots filling in one at a
  time then clearing for a beat. Claws stay where the base puts them.
- **Body mechanics.** A slow sway, half an art pixel side to side, at a quarter
  the cadence of typing's jitter. Deliberation, not effort. A whole pixel was
  tried during authoring and lurched.
- **Eyes.** Raised and drifting between two positions — looking up and away at
  the problem, never at the viewer.
- **Props.** The bubble, floating a pixel clear of his head with a two-dot
  tail descending toward it. It is a symbolic overlay rather than a held prop,
  so it does not touch him — see `docs/ANIMATION.md` §Props need contact.

**Not wanted:** any CSS rotation; a bubble attached to his head; dots fast
enough to read as effort rather than thought; a blink (at a 1.0s loop any blink
is once per second, four times too fast).

**Cogs were tried first and replaced.** Pose swapping turned them correctly —
the technique worked — but the shape did not: at 5x5 with a 3x3 hub the
diagonal-teeth pose reads as a blob with corner dots rather than a turned cog,
and the two poses look like different objects instead of one object rotating.
Alex called it, and a bubble is better on every axis this project cares about:
no rotation, instantly legible, and the dot tail does the connecting work that
the cogs never did.

**Cut during review: the raised claw.** The plan called for one claw raised to
the chin. Three positions were rendered and judged at true size and all three
read as a lump on the torso rather than a limb — the finding is in
`docs/ANIMATION.md` §What a claw cannot do, and it changes how
`bouldering`, `sweeping` and `gym` must be planned. The bubble carries the read
on its own, which is what "not wanted" lines are for: the plan said what the
screen had to communicate, so dropping a mechanism that was not communicating
it was an easy call rather than an argument.

**Why this one is next.** It is the first test of pose swapping, and most of
the animations still to come depend on that technique working — a gear that cannot
turn, a broom that cannot swing, a reach with no elbow. If it fails here, it
fails everywhere, and it fails now rather than in September.

---

## Gym — `Bash`

Clawd doing the heavy lifting. A barbell overhead press with the weight in it.

- **Action.** One rep per loop: settle, an anticipation dip, an explosive drive
  off the chest that grinds into lockout, a strain hold overhead, an
  accelerating descent, and a hard squash as the bar racks. The bar racks
  across the mid-torso and is drawn over the body, so it reads as held rather
  than hovering.
- **Body mechanics.** Squash and stretch about the hips (7.5,13) — he widens
  as he shortens, so the volume looks conserved. The legs are a separate group
  folding about the feet (7.5,15) down to 70% at the bottom of the dip; the
  body's vertical offset is derived from that fold so the hips stay welded to
  the knees. The feet never leave y=15.
- **Arms.** Each base 2x2 claw on its own shoulder pivot, rotating up while
  `scaleX` extends it along its own axis: a 2-unit claw at the rack, a 6.8-unit
  limb at lockout. The stretch stands in for the elbow this geometry does not
  have. The angle stops at 72deg, not 90 — the shoulder sits at the torso's own
  edge, so a vertical arm sweeps inward and disappears into the silhouette.
- **Eyes.** Asymmetric in _height_, not just in squint: the left clamps shut at
  its base row, the right rides 1.2 units higher for as long as the bar is in
  front of the face. That is what keeps a face on the face — on one row the
  shaft covers both at once.
- **Effects.** An additive gritted mouth, present only while he is under the
  bar. One drop of sweat per rep, launched on the way down and retired a frame
  before the loop wraps.

**Not wanted:** a bar that never touches the claws; a bar that racks above the
eyes; sweat launched while the shaft is still crossing the brow; any particle
whose only hard cut lands on the loop seam.

**Overridden during the rebuild: rotation, non-uniform scale and easing.** The
"no rotation, whole-device-pixel" constraint in this file's preamble was
written when a soft edge was permanent. `tools/svg2frames.ts` now snaps every
rasterised pixel back onto the declared palette, which is what upstream
clawd-tank does, so a rotated or eased edge hardens after the fact instead of
being forbidden up front. This plan is the first written against the new
contract; the preamble and the other five plans still describe the old one.

**Overridden during review: the bar may cross the eyes.** This line originally
forbade it. Contact at chest height means the bar passes the face on its way
overhead, and on this geometry the two are not separable. The split eye
heights handle it instead. Recorded as an override rather than quietly
deleted, because a "not wanted" line edited to match whatever got built stops
being a check.

**Superseded: "props carry the motion and limbs stay put."** That was the rule
`thinking` produced, and `gym` was its first test. It failed here — a barbell
that travels while the claws stay welded to the ribs reads as a prop sliding
past a crab, not as a lift. What the arms could not do was _rotate_, and now
they can. `bouldering` and `sweeping` were planned on the same rule and need
revisiting.

---

## Bouldering — `Read`

Clawd going up a wall, searching for the next hold. Claude reading your
codebase.

- **Action.** The wall scrolls downward past him. He does not move up the
  frame; the holds move down, which is what reads as ascending.
- **Body mechanics.** A bob, four times a loop — pulling up.
- **Eyes.** Raised, hunting for the next hold above.
- **Props.** Horizontal panel joints every 4 units, staggered on a period of
  8 so they tile with the holds.
  These are what make it read as a wall rather than as confetti — without a
  surface he is a character standing in empty space while blocks fall past.
- **Effects.** The holds themselves, a repeating column pattern behind him. The
  ground shadow is hidden: he is on a wall, and a shadow on the floor beneath a
  climber is worse than no shadow.

**Diverged from this plan, deliberately.** The plan said no claw should reach
for a hold. Both claws now grip one. Without a hand on the rock the wall reads
as blocks falling past a character standing still — the same rule that governs
every other prop here (`docs/ANIMATION.md` §Props need contact) applies to the
wall too. The earlier version broke this line silently and read as a pig; this
one breaks it on purpose, with the claws held at the side in `idle`'s own claw
band so no protrusion appears at the top corner of the torso, where it reads as
an ear.

**Not wanted:** holds that pass in front of him;
a scroll that seams at the loop boundary.

**Why this one is next.** `gym` proved a prop can carry the motion in a
straight line. This is the harder case — a _repeating_ prop pattern that must
tile seamlessly, and the technique every scrolling background depends on
(`road bike` in Tier C needs exactly this). The hold pattern has to be periodic
in the scroll distance or the loop visibly jumps once a second.

**Diverged from this plan: the wall got a face.** The plan described joints and
holds and nothing behind them, which was right while every screen was on black.
Once `packages/renderer/src/environment.ts` put a rock pool behind every
animation, an unfilled wall let the sky through and read as wires strung across
the horizon with purple notes pegged to them, with Clawd on sand below the sea
line — two places at once, which is the thing §Clawd lives somewhere tests for.

The face is the sand's own tonal family rather than a gym's slate, so it reads
as a sea cliff at the edge of the shore he lives on; a crab climbing a rock in
his own rock pool is the better joke, and it is one place. Its right edge steps
on an 8-unit period — the scroll distance — so the silhouette travels with its
own texture rather than sitting still while the courses slide past it. The
joints and holds are clipped to that silhouette, which is what stops a course
running off the rock into the sky.

Suppressing the environment for this one animation was the alternative. It left
half the panel black, and it hid the defect rather than fixing it — against
black an overhanging joint is invisible, which is how this survived six PRs.

---

## Idle — connected, nothing running

Clawd with nothing to do. The screen that is on most of the time.

- **Action.** Sixteen seconds of doing very little: breathing throughout, two
  blinks, a look right, a look left, and one yawn.
- **Body mechanics.** A half-pixel breath, four cycles a loop. The yawn rises a
  whole pixel onto tiptoes and holds.
- **Eyes.** Open and centred by default. One art pixel left or right for the
  looks; shut for a single frame per blink and for the length of the yawn.
- **Props.** A mouth and a tear, both additive, both hidden except during the
  yawn — the base geometry has neither.

**Not wanted:** anything that draws attention. This is wallpaper, and the test
is whether it is still tolerable on the fourth hour, not whether it is
interesting on the first. No incident more often than once every few seconds.

## Asleep — no session for five minutes

- **Action.** Deep slow breathing, three Zs drifting up and away.
- **Body mechanics.** Breathing deeper and slower than idle — three breaths in
  a twelve-second loop, the middle one a sigh. Both squashes compress about the
  floor pivot rather than lifting, so the body never leaves the planted legs.
- **Eyes.** Closed — the open eye squashed to a dash about its outer edge.
- **Props.** Three Zs on one keyframe track with delays two seconds apart, each
  glyph cell a whole art pixel, starting above the head and only ever rising.

**Not wanted:** Zs that overlap, or that touch the body — a grey glyph crossing
his face reads as display corruption, and it shipped that way once. A
silhouette confusable with idle at a glance; the slack claws hanging two art
pixels low are what separate them.

**Diverged from this plan, deliberately.** It called for two Zs and a body
settled a pixel lower than idle. Two Zs at the spacing that avoided overlap
left the loop looking empty, and three on staggered delays solve the overlap
without it; the torso sits at the same y as idle, and the dropped claws carry
the difference instead.

---

## Permission sign — `NEEDS_PERMISSION`

Clawd holds up a sign, and waits for you to answer it.

`data-loop-seconds="8"`. Tier A. **Fallback: a single static frame.** Nothing
here moves except a breath and one blink, so one frame delivers the whole read,
costs nothing on the wire after the first blit, and is an ordinary output of the
existing pipeline. Decide to take it early rather than on 22 September.

- **Action.** The sign is up on frame 0 and stays up for the entire loop. There
  is no raise, because there is nowhere to put one: `frameAt` in
  `packages/cli/src/daemon.ts` is wall-clock modulo the frame count, so a state
  never starts its animation at frame 0 and a "raise" at the top of the loop is
  a pump at loop frequency, forever, on a screen watched for minutes.
- **Body mechanics.** Breathing only. A body that fidgets while asking reads as
  agitation; the strip tint has already said how urgently.
- **Eyes.** On the viewer, both open. One slow blink in the loop.
- **Props.** The sign, and it is the whole screen.
  - **The arm is `gym`'s mechanism, not a rotation.** A 2x2 claw pivoting at
    the shoulder cannot lift its top edge above y=7.76 — the pivot is at y=10,
    the far corner is sqrt(5) away — so the torso top at y=6 is permanently out
    of reach and a sign held there overlaps the body. `gym` rotates to -73deg
    _and_ `scaleX(2.85)`, which puts the claw tip at about (13.7, 4.3), 1.74
    units clear of the head. Use that. `docs/ANIMATION.md` §What a claw cannot
    do carries the arithmetic.
  - **Plate 5 wide by 7 tall**, spanning y -2 to 5: clear of the torso top at
    y=6, and two units inside the -4 safe-area line. Fill `#C9D1D9`, the tone
    `thinking`'s bubble already proves readable against both the day sky and
    the night one. Seven rather than six because a 5-tall glyph needs a whole
    unit of border top _and_ bottom.
  - **Glyph `?`, 3 wide by 5 tall**, fill `#000000`, with a real gap row
    between stem and dot. Five rows is the minimum: at three the dot merges
    into the stem and it degenerates, which is the same finding `asleep`
    records for the Z at three rows.
  - **Black, not a new near-black.** A first version used `#0D1117` and it
    stitched a dark keyline round the arm, torso and legs on every frame — up
    to 418 pixels. §Palette snapping is explicit that every declared colour
    becomes a snap target for every other colour's edges, and `#0D1117` sits
    nearer a faint peach edge than the background black does, so it captured
    the pixels the transparency rule needs to resolve to the background. Use a
    tone the document already declares.
  - **No post.** The extended claw crosses the plate's lower corner directly,
    which is the contact §Props need contact asks for — an unheld prop reads as
    hovering, and `gym`'s bar racked three units clear read as a bar floating
    above a crab. A post was planned and is unnecessary once the arm reaches.
  - **The sign and the arm sit outside the breath.** He holds it steady while
    his body breathes underneath — what a person does with a placard, and the
    only way the plate stays on whole device pixels. Inside the breath group
    its edges land on fractions, and the midpoint of `#C9D1D9` over a dark
    glyph is nearer `#DE886D` than either, so every soft edge snapped to
    Clawd's own body colour and drew an orange keyline through the `?`. It cost
    2.8x on the wire as well. Same defect, same cause, as the boot splash's
    wordmark before that was drawn as rectangles.
- **Effects.** None. No shake, no glow, no colour cycling.

**Not wanted:** a claw rotated but not extended — §What a claw cannot do, an
arrowhead hung off an 11x7 slab reads as a spike, which is why `thinking` cut
its 45deg swing. A plate whose bottom edge touches the torso: that is the lump
the raised claw was rejected for, arriving via the sign instead. Anything above
y = -4, outside the landscape crop. A glyph that cannot be read at true size —
check it at 320x172, not zoomed. A sign that pumps: it turns a question into a
demand, and see Action above for why it is not even expressible.

**Why `?` here and a caret on `confused`.** Both screens are attention states,
both can be the hero, and a viewer glancing at the panel must not see "crab,
question mark" for both. This one is a question — it is literally asking
permission — so it keeps the `?`, and it carries it on a held plate with real
mass. `confused` gets something else entirely; see below.

---

## Confused — `WAITING`

Clawd looks straight at you, waiting for an answer he has not been given.

`data-loop-seconds="12"`. Tier A. **Fallback: two frames, the caret on and off.**

`.claude/research/screens/spec.md` notes this **may** be the most-seen screen,
since Claude Code asks for input constantly. That is worth knowing and it is not
a measurement: the counting that exists covered tool calls, and says nothing
about how often `Notification` fires. Do not spend budget on the strength of it.

- **Action.** A held head-cock, and a blinking prompt caret. Nothing else.
- **Body mechanics.** Breathing only. **No rotation.** A 2.5deg torso tilt was
  tried in `idle` and read as a corrupted sprite; a 6deg one measured nine
  one-pixel steps across the torso's top edge and eight times the antialiased
  pixels. `docs/ANIMATION.md` §Scale by size, not by taste is explicit — lean by
  translating against planted legs, and here do not lean at all.
- **Eyes.** On the viewer for the whole loop, and **asymmetric in height** —
  left one unit down, right one unit up. That is `gym`'s technique and it is
  what carries the head-cock with no rotation anywhere. Two blinks per loop,
  well apart.
- **Props.** A prompt caret above and to the right of his head, blinking on a
  `steps(1)` track at a one-second cycle. It is the universal "type something"
  and this is a device for a person who lives in a terminal. It is also nothing
  like `thinking`'s 9x5 bubble with a tail and three cyan dots, which is the
  real separator: prop _mass_ and silhouette are what a glance reads, not eye
  direction.

  **Two tones, and it has to be.** A bare `#C9D1D9` bar measured 1.31:1 against
  the day sky and 1.80:1 against dawn — invisible, on the path the daemon
  actually takes. `thinking`'s bubble survives the same colour only because it
  is a 9x5 mass spanning three sky bands with a cyan dot inside it. So the
  caret is a `#000000` block with a `#C9D1D9` core: the block carries the pale
  skies, the core the dark one, and it reads 5:1 or better at all four, worst
  at dusk. Black rather than a near-black for the reason the permission sign
  records — a new dark tone captures the antialiased edges the transparency
  rule needs to resolve to the background, and stitches a keyline round the
  whole character.

- **Silhouette.** The asymmetric claws — one riding a unit high, one a unit low
  — are what stop this being `idle` with a glyph. `asleep` needed the same
  thing and solved it the same way, with claws hanging two art pixels low.
  Rendering it with all four offsets zeroed is indistinguishable from `idle`,
  so this is doing real work.

  **They tilt the same way as the eyes, not against them.** The first version
  had the claws counter-tilting, on the reasoning that a level body under a
  cocked eye line would read as a cocked head. It does not — there is no neck
  to absorb an opposing shoulder line, so the two cues cancel into a shear and
  it reads as a lopsided crab. All four tilting together is a rotation
  approximated in whole units, which is what §Scale by size asks for in place
  of an actual rotation.

- **Effects.** None.

**Not wanted:** a thought bubble in any form, or any prop with a tail. Any
rotation of the torso. A shrug, which needs shoulders he does not have. A
caret that blinks faster than a 0.25s cycle — `docs/ANIMATION.md` §Timing gives
0.125s as invisible at 8fps and 0.25s as the fastest perceivable. Eyes that
drift off the viewer: at that point this is `thinking` with a different prop.

---

## Dizzy — `StopFailure`

Clawd has taken a knock and is seeing stars.

`data-loop-seconds="12"`. **Built**, ahead of `sweeping` and the Model 3 —
`BUILD_PLAN.md` items 8 and 6. (An earlier line here said "ahead of the two Tier
B entries above it"; the two plans above this one are both Tier A and both
shipped first.) It was catalogued Tier B and cuttable, on the grounds
that `packages/daemon/src/animation.ts` could fall `FAILED` back to `thinking`
and stay honest about something being wrong. That reasoning was sound and it
was pulled forward anyway: `FAILED` was the last state on the fallback, so a
panel that draws it is Stage 3 correctness rather than Stage 4 art.
`animation.ts` now maps `FAILED: 'dizzy'`, and this paragraph described the
world before that for the whole of the branch that changed it.

Twelve seconds, not four. `FAILED` does not decay: `effectiveState` promotes
only from `IDLE`, so this stays on screen until another event arrives or the
session is evicted at ten minutes. It is a resting screen and has to survive
being stared at.

- **Action.** A loose wobble with three stars orbiting above the head.
- **Body mechanics.** **Translation, not rotation** — the body shifts against
  planted legs, for the reason `confused` above does not tilt either.
- **Eyes.** Crossed: each eye translated two units inward, left 4→6 and right
  10→8. Whole art pixels, existing IDs, translation only. It is the cartoon
  shorthand, it is free, and it cannot be mistaken for `asleep` — which is
  exactly what a held `scaleY` squash would be, since `asleep` holds that same
  squash for its entire loop.
- **Props.** Three stars on one orbit, phased by whole frames. Each is a pale
  pip inside a dark cross of three units, not the single art pixel this plan
  first asked for:
  one flat tone measured 1.31:1 against the day sky and 1.80:1 against dawn,
  which is invisible on the path the daemon takes. The cross carries the pale
  skies and the pip carries night — the same two-tone fix `confused`'s caret
  needed, and the third time this defect has landed after the boot splash's
  wordmark. The orbit widened with them: a 3-unit prop needs more clearance
  than a 1-unit one, and at the first radius two of the three stars read as a
  single zigzag. A 3s orbit period inside the 12s loop with delays 0 / -1s /
  -2s authors them eight frames apart and lands every delay on a whole frame;
  three stars on a 4s loop cannot be evenly phased at all, because 32/3 is not
  an integer. **Eight frames apart is what is authored, not what renders** —
  the orbit's twelve keyframe percentages are written to six decimals, and at
  8fps some of those boundaries land a fraction before a sample time and some a
  fraction after, so the gaps come out 4/4/4 on odd frames and a permutation of
  3/4/5 on even ones. `dizzy.svg` records the measurement; this sentence used
  to claim the even spacing outright and the retraction was written only into
  the SVG. The path is whole-device-pixel steps or discrete `steps(1)` cells,
  never a curve: the cross's arms are one unit wide and so entirely edge, and a
  fractional position fringes them into the body colour on every frame — the
  same fringing `thinking` documents for its bubble.
- **Effects.** None.

**Not wanted:** stars that touch the body — a glyph crossing his face read as
display corruption when it shipped that way in `asleep`. A wobble cycle faster
than 0.25s, or any motion at 0.125s, which is invisible at 8fps. Rotation of
the stars themselves; the cross is symmetric under a quarter turn and its arms
are one unit wide, so a rotation is either invisible or a fringe. Anything that
reads as distress — this is a failed turn, not a catastrophe, and the strip
tint carries severity.

---

## The environment — a rock pool, through the day

Not an animation. The ambient layer every animation is drawn on top of, built
by the renderer rather than baked into any SVG (`docs/ANIMATION.md` §Clawd
lives somewhere). One place, always the same place — a creature with a home,
not a set of illustrations that share a sprite.

**Why a rock pool.** He is a crab. Putting him where a crab lives earns the
mascot instead of ignoring it, and it gives the one thing every animation
already assumes: a ground line to stand on.

- **Ground.** A wet rock shelf across the bottom, with the sprite standing on
  it. Its line must be **derived from the sprite slot**, not chosen by eye:
  `spriteSlots()` places the character, his feet sit at a fixed offset within
  that, and every prop in every animation — the barbell, the laptop base —
  already rests on the same line. If the shelf and the feet disagree by even a
  pixel he floats, and that is the defect the idle rebuild spent an evening on.
- **Pool.** A shallow band of water to one side, a tone off the rock, with a
  single highlight line. Not centred — he stands where the sprite slot puts
  him, and the pool should sit beside him rather than under him.
- **Rock.** One silhouette breaking the horizon, off-centre. Enough to say
  "coast" without competing with the character.
- **Sky.** The majority of the frame. A vertical gradient, and the thing that
  carries the time of day.

**Time of day is the whole trick, and it is nearly free.** The same scene at
dawn, day, dusk and night, as a palette swap on sky, water and rock — no new
geometry. It means the object on the desk quietly knows when it is, and a
late-night session actually looks like one. Night adds stars; that is the only
addition beyond colour.

**Ambient motion should be almost nothing.** A highlight shifting on the water,
a star or two changing. The character is what moves; the place is what stays.
A busy background competes with the animation and costs dirty rects for
nothing.

**It has to read at 168x160.** Upstream's works because it is a gradient, some
dots and a strip of grass — the sprite is only about 88px wide, and anything
with real detail turns to mush beside it. Judge it at true size from the first
sketch, not scaled up.

**Not wanted:** a scene that competes with Clawd; detail that dissolves at true
size; a horizon that disagrees with the sprite's feet; anything that makes the
existing props look wrong. `bouldering` is the one to check — its wall should
read as a sea cliff above the pool, which is coherent, rather than as a gym
wall that has wandered onto a beach.

**Pack-swappable.** The environment is a personalisation lever, so this is the
default rather than the only one.

---

## Template

```
## <name> — <triggering tools or state>

<one line of what the viewer should read>

- **Action.**
- **Body mechanics.**
- **Eyes.**
- **Props.** (where the motion is carried by something other than Clawd)
- **Effects.**

**Not wanted:** <the things that would look plausible and be wrong>
```

The "not wanted" line is the one that earns its keep. It is what turns a review
from taste into a check.
