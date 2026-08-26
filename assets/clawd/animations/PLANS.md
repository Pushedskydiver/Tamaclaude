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
All but one carry one; `gym` alone has none, because its bar is described
under Action rather than filed as a prop, which is a distinction not worth
enforcing. Both constraints this paragraph used to name have since been repealed by
`docs/ANIMATION.md`, and it took two passes to notice. Palette snapping
retired the whole-device-pixel rule and the rotation ban together — §Render
scale says so in as many words, "Rotation is now allowed" — and a correction
that removed the first promoted the second to sole universal constraint.
`gym`'s raised claw is built on a -73deg rotation. What is left is a
judgement rather than a rule, and §What a claw cannot do is where it lives:
a rotation has to buy a shape, which on a 2x2 block turned a few degrees it
does not.

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
being forbidden up front. This plan was the first written against the new
contract. Four more have been written against it since — permission sign,
confused, dizzy, overheated and the payoff — so some plans here are current and some
describe the old one. The preamble said so too until dizzy's branch corrected it.

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
(`road bike` would have needed it horizontally; it is cut, so `bouldering` is
the only one that does). The hold pattern has to be periodic
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

**Measured, unfixed, and two attempts have failed.** Composed on the real panel
in the production config — landscape, `extent: 'panel'` — the worst Z's
best-reading pixel is 3.94:1 at dawn, **1.83:1 at day**, 5.91 dusk, 12.89 night.
Day is the sky the daemon shows for nine hours, and 1.83 is below the 2:1 the
two-tone rule exists to clear, so for a third of the clock these are close to
invisible. It is a real defect and it is still here.

**Attempt 1 — a black copy of each Z offset one unit below.** Took day to 10.64
and broke the glyph two ways. It filled the counter: a Z is legible because of
the wedges of background above and below its diagonal, and a full-width bar one
unit down lands in the upper one, rendering `PPPP / BBPB / .PB. / PPPP / BBBB`,
a small skull rather than a letter. And its bottom bar landed on the torso — 16,
32 and 24 device columns of contact on frames 0, 32 and 64.

**Attempt 2 — two black cells extending the bars sideways.** Took day to 8.05
with no sky regressing, no torso contact, and no change to the float track, the
safe area or the bbox height. It failed for the reason that matters most: at day
the pale drops to 1.05-2.45, so **all that survives is two cells at diagonally
opposite corners of a twelve-cell glyph.** Two dots five units apart do not
trace a letter, and being a different tone the eye segments them off from the
faint strokes rather than reading one mark. It would not lay out either — three
glyphs with a tick each side either collide (z-2's top tick and z-3's bottom
tick share a column and fuse into a solid block on 34 of 96 frames) or the last
reaches raster column 167.

**Both attempts got the same thing wrong: which tone carries the shape.**
`dizzy`'s star works because the _dark_ draws the cross and the pale is a pip
inside it, so the shape survives on every sky and only the highlight changes.
Here the pale draws the letter and the dark decorates it, so on the pale skies
the letter is what goes. Inverting is not available: a dark Z with a pale pip is
a readable star and an unreadable letter, and a true outline needs a unit right
and a unit down, which are the panel edge and the torso.

**The tractable direction is size, not contrast.** Upstream's
`clawd-sleeping.svg` scales each Z from 0.4 to 1.2 as it rises rather than
fighting the sky with a second tone. That is a redesign of the prop, and it
deserves its own pass — not a patch, and not inside a PR about another
animation.

Whatever is tried next, check the **count** of connected components, not their
sizes. A Z that merges with the body stops being a separate component and is
absorbed into the one a size check excludes, so the sizes stay perfect while the
glyph is welded on; that is how attempt 1 passed its own check. There is no
`asleep` equivalent of the `dizzy` clearance test in `tools/bake-sprites.test.ts`,
which is why nothing caught either failure except a critic looking at frames.

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

`data-loop-seconds="12"`. **Built**, ahead of `sweeping` and the payoff screen —
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
  wordmark. The orbit's lowest cells were raised for them: a 3-unit prop
  needs more clearance than a 1-unit one, and the clearance that was short
  was vertical — the cross's bottom arm against the top of his head. The
  horizontal cells have never moved, so "widened", which this line said
  before, describes an orbit no version of the file ever had. A 3s orbit period inside the 12s loop with delays 0 / -1s /
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

## Overheated — `StopFailure` with `error_type: rate_limit` or `overloaded`

Clawd has worked himself flat and is lying there fanning himself. He is not
hurt and not asleep — he is spent, and he will be fine in a bit.

`data-loop-seconds="6"`. **Proposed, then scheduled.** It was not in Stage 4's original
catalogue, so adding it was a change to the plan rather than work under it;
`BUILD_PLAN.md` carries it as item 12 now. This line read "is not one of the
animations Stage 4 catalogues" in the present tense, which the commit that
wrote it made false.

The scene is upstream's `clawd-working-overheated.svg` — _"sitting down
(splooted), completely exhausted, fanning himself with one hand"_ — and none of
its execution transfers. Its smoke fades from 0.6 opacity to 0 and scales x2,
its tones are two new greys with rounded corners, its eyes are 0.4 units tall
and its breath is 2.5s. Every one of those breaks something here. What we take
is the pose, and the pose is the whole point of taking it.

**Why a pose and not a prop.** A first version of this plan kept the standing
silhouette and separated the screen from `asleep` by eye state and rising heat.
That fails twice over. `asleep`'s eyes are not shut — `@keyframes eyelid` holds
a `scaleY` of 0.5 for its entire loop, which is a half-height eye, so "half-closed
versus shut" is not a distinction at all; and `dizzy.svg` already records
rejecting a held `scaleY` squash on this same state because it "would have made
the two screens one picture". Meanwhile something rising off a still Clawd _is_
`asleep`. `PLANS.md` §Confused states what a glance actually reads: "prop mass
and silhouette", not eye direction. So the silhouette has to change, and once it
does the prop is free to be anything.

`docs/ANIMATION.md` §The generation contract names this exact case — "a sploot
for sleeping… give the variant its own id (`torso-sploot`)".

- **Action.** Splooted flat, fanning himself with the right claw, steam coming
  off him. One pose, three speeds: a slow labouring breath, a fast fan, and
  steam between the two.
- **Body mechanics.** `#torso-sploot` replaces `#torso` at **x=2, y=10, 11x5**,
  against the standing `x=2, y=6, 11x7`. Same x and same width on purpose: the
  contact shadow is a fixed 9-unit band from unit 3 (`environment.ts`
  `paintContactShadow`), so a wider body would overhang its own shadow, and at
  this width the overhang is 1 unit each side exactly as when he stands. Nothing
  in the renderer changes and `castsShadow` needs no new entry — he is on the
  ground, more so than usual. The bottom edge stays on the ground line at y=15;
  what changes is 2 units of height and a 4-unit drop.
- **Legs.** `#legs-sploot`, a group of four **1x1 rects at y=9**, at x=3, 5, 9, 11 — the same
  four columns as the standing legs, so they read as his legs, now splayed out
  above a body that has spread beneath them. Upstream's move exactly.
- **Eyes.** `#left-eye-squint` / `#right-eye-squint`, **1x1 at y=12**, x=4 and
  x=10 — the standing columns, half the standing height. Squares, not slits: an
  earlier version of this line called them slits and the ids were minted to
  match, so the identifier asserted a shape the geometry denies. They sit on a
  flat body, and the body is what separates the screen; the eyes only have to
  not contradict it.
- **The fanning claw.** `#arm-fan` from `#right-arm`, and **it must extend as
  well as rotate**. §What a claw cannot do is explicit: a 2x2 block turned is
  "an arrowhead, and an arrowhead hung off an 11x7 slab is not a limb" — a
  45deg swing was built, judged and rejected. What makes a claw read is length,
  and `gym` is the proof: `rotate(-73deg) scaleX(2.843)` turns the same 2x2 into
  an arm. So the fan sweeps _and_ extends, pivoting at its inner lower corner
  (13, 13). Sweep angles and the `scaleX` factor are the two numbers to derive
  at render time rather than assert here — the constraint they must satisfy is
  that the tip clears the torso silhouette at both ends of the sweep, which is
  the failure §What a claw cannot do describes.
- **Props.** Steam, as 2x2 puffs — a `#000000` block with a `#C9D1D9` core,
  the same two tones `dizzy`'s stars already carry, so the palette gains no
  entry and no new snap target. Three puffs on one 3s track at delays 0, -1s and
  -2s, which is `dizzy`'s phasing and lands each 8 frames apart. Opacity is only
  ever 0 or 1, flipped hard at the top of the rise the way `asleep`'s Zs flip —
  never a fade, because partial opacity composites over the background and snaps
  to transparent in this pipeline.

**Timing, and every period checked against the loop.** 6s is 48 frames at 8fps.
An `alternate` track must run an even number of times (`docs/ANIMATION.md`), so:
the breath is a **6s track**, not `1.5s alternate` — that arrangement made
every period divide 24 and produced 24 duplicate frames, and the SVG records
why in full;
the fan at **0.5s alternate** is 4 frames each way and 12 alternations; the
steam at **3s** runs twice. All three land on whole frames. The breath is
faster than `idle`'s 2s, which is what makes it a labouring one.

**Six seconds, not twelve.** `dizzy` needed twelve because `FAILED` does not
decay and it had to survive being stared at, and it earned them with a blink on
a 12s track. This has three tracks at three speeds and no beat that wants a
twelfth second, and `dizzy.svg` records what happens when a loop is longer than
its content: frames 32-95 were byte-for-byte copies of 0-31.
48 frames baked to 136,683 B against `dizzy`'s 401,428 — about a third, where
this line forecast a half.

**Safe area.** The pose creates headroom rather than spending it. Measured off
the bake: the topmost body pixel is the fanning claw at **y=8.25**, so the steam
has 12.25 units before the -4 line, and the steam itself tops out at **y=+1** —
five units of margin, against `dizzy` sitting at -3 on 72 frames of 96, which is
the one `docs/ANIMATION.md` singles out to watch.

Both figures were guessed from the keyframes first and both were wrong: y=2 and
six units for the steam, and a splayed leg at y=9 for the body. An earlier
correction appended the right numbers and left the wrong ones standing, so the
paragraph asserted both.

**Which errors get it.** `rate_limit` and `overloaded`. An earlier version of
this plan split them — `overloaded` is the server being busy rather than this
session spending itself — and that is true and beside the point: both tell the
viewer the same thing, which is _wait and come back_, and that is what the
picture says. Splitting them would show a knock-on-the-head for a condition
that is not a knock. The other eight keep `dizzy`.

**The quip should move too, and it is not optional.** `messageFor` keys on state
alone, so `overheated` and `dizzy` would share the `FAILED` line, the strip
tint and the priority — leaving the picture as the only difference. Keying
`quips.mapped` on a compound `FAILED:rate_limit` falling back to the bare state
costs one lookup, needs no schema change (`z.record(z.string(), z.string())`
already accepts it) and generalises to all ten error types, which is what
`events.ts` records the field was kept open for. `packs/example` is **tracked**,
so its line stays deliberately flat; the real one belongs in the ignored pack.

**Not wanted:** an opacity fade on the steam. A new colour for it. A claw that
rotates without extending. A silhouette that could be mistaken for `asleep` or
`idle` — if a rendered frame at true size could be, the pose is what changes,
not the prop. Anything that reads as distress or illness: hitting a limit is
ordinary, and the joke is that Clawd is having a lie-down about it.

**Measured, because this list is ordered by measured frequency and an earlier
version of this entry was inserted without one.** Across 1,030 local transcripts
outside this project, a usage limit was actually hit in **one session** —
roughly 0.1% **of sessions**. `board game` fires on `Agent` at 0.7% **of tool
calls**, which `BUILD_PLAN.md` calls "the least-seen of the screens that have a
measured trigger" — a different denominator, so the two do not divide. What can
be said without mixing units is that this is the only entry whose trigger was
counted in sessions at all, and that one session in a thousand is rare by any
reading.

That is not automatically an argument against it. `permission sign` and
`confused` were built because they are the screens the whole design principle
exists to serve — the panel says _when to look_, and a limit is exactly a
stop-waiting moment. But it is the argument that has to be made explicitly,
because "it will be seen often" is not available.

**Sequence: art first, wiring last.** The wiring lands in `packages/daemon`,
which Stage 3 marks done. If the art is cut at the 6 Sep gate, wiring built
first is either reverted in shipped code a fortnight before the date, or left as
a dead branch pointing at `dizzy` with a test asserting it does nothing.

---

## The payoff screen — a task actually finished

A vehicle is parked beside Clawd and he rests a claw on it.

**Not "the vehicle from the recipient's pack", which is how this line read
until 24 Aug and which was wrong twice over.** The pack cannot supply it —
sprites bake fixed pixels — and leaving the sentence standing tied the prop to
the recipient while the tracked art names a colour, which is the link
`CLAUDE.md` forbids. The section below identified the error and this line was
not corrected with it. **Named by role throughout.** The vehicle is on the interests list in the
gitignored brief, this repo is public, and `CLAUDE.md` says tracked docs name
personal content by role and never by content — it read as a make and colour in
ten places across five tracked files — two docs and three source files — until
24 Aug.

`BUILD_PLAN.md` Stage 4 item 6, the entry that plan calls "the payoff" and the
only one carrying its own written fallback.

### Parked, not arriving — and that is not a compromise

`frameAt` in `packages/cli/src/daemon.ts` is `Math.floor(now / FRAME_MS) %
frames`, wall-clock modulo, so **a state never starts its animation at
frame 0** — the loop passes through frame 0 constantly, which is precisely why
an arrival would re-arrive. `permission-sign` found this and wrote it down: "there is no
raise, because there is nowhere to put one … a raise at the top of the loop is a
pump at loop frequency, forever."

An arrival is a raise. A car that pulls up would re-arrive every loop, and the
viewer joins at a uniformly random phase. So the vehicle is parked on frame 0
and never moves, and the loop is Clawd's reaction — the same shape
`permission-sign` arrived at, for the same reason.

### The trigger is the payoff

This is the finding that reorders the whole entry. `Stop` fires once per
response — nine times in one session across three hours, on real events. A quiet
period after work fires once per _task_. Measured over 1,105 local transcripts
with timestamped events:

| quiet threshold | fires per transcript | transcripts with at least one |
| --------------- | -------------------: | ----------------------------: |
| 30 s            |                 4.93 |                         78.7% |
| **45 s**        |             **2.85** |                     **61.8%** |
| 60 s            |                 2.03 |                         50.7% |
| 90 s            |                 1.32 |                         33.9% |

Both columns reproduced independently to three significant figures. A fourth
column, "share of session time on screen", is withdrawn: three plausible
definitions gave 0.7%, 3.1% and 4.0% against a published 4.6%, and nothing
depends on it.

**No ratio against `Stop` is quoted.** An earlier version claimed "10-13x",
dividing a per-session-id figure by a per-transcript one — 36 distinct ids
against 1,187 files, because subagent sidechains get a file and not an id, and
the daemon keys on the id. Even at face value the quotient was 9.1. What the
table does support is that this is a reward you notice rather than wallpaper,
and that **the payoff is the trigger, not the animation**. Whether the crab stands beside
a moving vehicle or a parked one is a second-order improvement on a screen seen
once or twice a session.

### The trigger, concretely

`effectiveState` is the home: it already promotes `IDLE` to `WAITING` after a
notification and to `ASLEEP` after five minutes, both pure functions of the
session and `now`, re-evaluated every frame and monotone in `now`, so there is no
flicker. A **windowed** promotion — two bounds, not one — makes the state brief
without any one-shot machinery:

- `DONE_AFTER_MS` 45s, `DONE_SHOWN_MS` 15s, so the window closes at 60s, which
  is exactly `WAITING_AFTER_MS`. The vehicle is there, then he starts staring at
  you. That sequence is better than either state alone, and it is free.
- Expiry is arithmetic: crossing the upper bound _is_ the expiry. No stored
  timer, no `oneshotUntil`. Repeats collapse because there is nothing to
  re-trigger.
- It needs one `Session` field — set on `PreToolUse`, cleared on
  `UserPromptSubmit` — because nothing existing distinguishes "did some work"
  from "replied": `state` is `IDLE` either way, `Stop` clears `tool`, and
  `lastEventAt > startedAt` is true after any reply.

**Tier 1 stays empty, and that is a departure worth stating.** The screen spec settles the
payoff as a pre-emptive one-shot that takes the stage regardless of what else is
live, and `state.ts` records tier 1 as deliberately empty _because_ `Stop` could
not drive it — "it lands with the quiet-period trigger that has to replace
`Stop`". This is that trigger — but tier 1 pre-empts _everything_, and that
was settled for a two-second oneshot. At fifteen seconds it would cover a
session blocked on a human, which breaks the panel's one promise. It ranks with
the resting states instead: above `IDLE`, below anything active.

An earlier version of this section argued the opposite, that it must outrank
`WORKING` or be lost to concurrent sessions. Two reviews measured that and got
**15% and 66% for the same quantity**, because it turns entirely on what counts
as a session being live. A figure that moves by a factor of four with its
definition cannot carry a design decision, and the ranking it argued for turned
out to be a live defect: with the payoff borrowing `idle` until its art exists,
it put a Clawd doing nothing on the panel for fifteen seconds while another
session ran a tool.

**Do the trigger before 31 Aug.** Stage 3's window closes then; after that,
touching `Session` is a reopening rather than finishing.

### Art

- **Action.** The vehicle is parked. Clawd reacts to it.
- **Body mechanics.** Breathing, plus one reaction beat. Undecided which — but
  not a bare claw rotation: §What a claw cannot do rules that out and `gym`
  shows the fix is rotating _and_ extending.
- **Eyes.** On the vehicle, with one slow blink — `permission-sign`'s pattern.
- **Props.** The vehicle, **5 units long and overlapping him, low and on his
  left.** Three earlier answers to this were wrong and the arithmetic that
  produced them was too.

  `L + 15 + c <= 21` gives L <= 5 only if the character is flush against a
  stage edge. He is not: the stage spans x -3 to 18 and he occupies 0 to 15, so
  the free width is 3 units each side, non-contiguous, and 5 units needs 40px
  against a 24px gap. The same paragraph said "never contiguous" and then used
  the contiguous number.

  **Three units does not read.** Rendered at true size through `svg2frames`, a
  3-unit vehicle in the right gap is a small block with two dark dots — this
  plan's own "reads as a brick", arrived at by drawing it rather than by
  arguing.

  **The right gap is water.** `environment.ts` puts the rock pool at units
  x 11.25 to 17.50, **y 12.50 to 15.63** — a band straddling the ground line
  rather than the flank's full height, so anything parked at ground level on
  that flank is parked in the pool. The rock on the left is at
  y 6.6-8.75 — mid-distance, well above a ground-level prop — so **the left
  flank is the only one clear at ground level.**

  **Moving him is not available.** `docs/ANIMATION.md` says "Keep the
  character's own coordinates untouched. Grow the stage instead", and the stage
  cannot grow: 21.5 units is the panel's ceiling at 8px per unit. Worse,
  `environment.ts` draws the contact shadow at a hard-wired offset from the
  slot, with no knowledge of what the SVG did — shift him and the shadow stays
  put, which is the floating-feet defect the shadow exists to prevent.

  So it overlaps him, which is what the corpus says makes a prop read at all.

- **Effects.** None.

**This is the first prop in the corpus that needs floor space.** `gym`'s barbell
is 17 units wide with a one-thick shaft — its plates are four — and it crosses
the torso, which is what makes it
read; `bouldering`'s wall is a backdrop behind him, exempted from the safe area.
Ink is not the constraint here, plan area is, and the stage has six units of it.
The landscape crop is not the risk — a ground-level prop is nowhere near the -4
line. The risk is entirely horizontal.

**The pack cannot supply the vehicle, and the plan's first line assumes it
can.** Sprites are baked pixel data: `svg2frames` rasterises, `bake-sprites`
writes RGB565 into `packages/renderer/src/sprites/`, and `paintStage` draws the
frame as-is. `packPalette` recolours the _bands_ — background, ink, attention,
active — and nothing else. There is no mechanism by which a pack changes a
sprite's colours, so whatever this file draws is what every install shows.

That collides with the privacy rule rather than merely being inconvenient. If
the vehicle is drawn in the colour that makes it recognisable, that colour is
in a tracked public asset, which is the detail `CLAUDE.md` records being
scrubbed from five files on 24 Aug. Three ways out, and the choice is a real
one rather than a formality:

1. **Draw a deliberately non-matching vehicle.** Recognition comes from shape
   and context — a vehicle parked beside him on the screen that means "you
   finished" — not from paint. Costs the wink, keeps the deadline, adds
   nothing to a tracked file.
2. **Make sprites pack-recolourable.** The honest fix and a real pipeline
   change: a colour-role indirection through the bake, before a 13 Sep freeze,
   for one prop.
3. **Let the pack ship its own sprite.** Bigger than 2 — pack-supplied art has
   no loader, no schema and no bake path.

**The body colour is a legibility choice, and it is named in tracked files —
in the art, and in the contrast tool's examples.** It has to be: whatever the
SVG draws is what every install shows. What is not tracked, and must not be, is
any sentence connecting that colour to the recipient's own vehicle. An earlier
version of this line claimed the colour was "named nowhere in this repo", which
stopped being true the moment the art landed in the same branch.
`CLAUDE.md` records the vehicle leaking into five tracked files by make _and
colour_ until 24 Aug. An earlier version of this section put the colour back
the same day, in words four times over and as a signature paint hex — the same
class of detail as the make, in the same tracked file, hours after it was
removed. The plan below is written against an unnamed candidate; the hex lives
in the pack.

**Declare `#6F4436` in this file.** `paletteOf` derives the palette **per
document**, and that brown is currently declared only in `typing.svg`. Without
it a saturated candidate captures torso edge pixels, because the snap target
for an antialiased peach-on-dark edge is whatever is nearest in the document's
own palette. Measured over peach composited on black at 1% steps, four
candidates stole 10, 13, 30 and 36 of the 101 steps; with `#6F4436` declared,
all four steal nothing.

**Two corrections to how that measurement was first written up.** It was
compared against "the `#4C3475` violet's 10", which is not like for like — the
violet's 10 comes from `bouldering`'s own palette, and in a minimal
`{black, peach, candidate}` palette it steals 36, tying the worst of the four.
So the comparison ran backwards. And `#6F4436` does not stop the snapping: it
takes 50 of the 101 steps itself. It moves the target from the candidate to a
brown, which is acceptable _because_ a brown between peach and black reads as
shading — which is why `typing.svg` declares it — not because the edges go
away.

**One trap in the remedy.** `paletteOf` regexes the raw SVG text, so a hex
inside a comment is admitted. "Declare `#6F4436`" is satisfiable without
drawing a pixel of it, which is not the same thing as the file containing that
brown.

**Shipped 24 Aug, and one thing left on the table.** The critic's second pass
returned ship. It also measured that frames 0-11 and 37-63 — 61% of the loop —
are breath plus one blink, which is a strict subset of what `idle` does in the
same span, so for most of the loop the difference between this screen and the
idle screen is the prop. It stays acceptable on arithmetic rather than on
taste: `DONE_SHOWN_MS` is 15s against an 8s loop, so a viewer joining at a
uniformly random phase always sees at least one whole gesture and usually two,
with a worst case of five seconds' wait. If there is appetite for one more
pass, the cheap win is a second small beat in frames 40-60 — a settle of the
claw, or the blink paired with something — not a longer hold on the one beat
there is.

**Contrast must be measured against sand, not sky.** A parked ground-level
vehicle is never against the sky: `environment.ts` puts the horizon at 62% with
sea 6% below it, so sand runs from roughly unit y 8 to 16 and a vehicle at y
12-15 sits entirely on it. Every candidate measured under 2:1 against at least
two times of day, and the worst was flat invisible on dusk sand. Note that the
1.31:1 and 1.80:1 that got `confused` and `dizzy` rebuilt were measured against
_sky_, so they are not a benchmark for a sand figure — an earlier version of
this paragraph compared the two directly, four lines after insisting on the
distinction.
**That moves the colour decision, so it belongs before the art rather than
before the ship.** Stated as a caveat rather than a conclusion: the same metric
puts the character's own peach at 1.01:1 against day sand, so either a
luminance-only ratio over-reports for hue-separated pairs at ground level, or
the environment has a readability problem at ground level that predates this
screen. Either way the pair the plan named was the wrong one.

**`tools/contrast.ts` is that tool, written rather than deferred.** The figures
quoted in `dizzy.svg` and elsewhere came from throwaway scripts, and
`bake-sprites.test.ts` records what that costs — a check described in a commit
as refusing to write a file, which had never existed. Measured against all four
sands and pools:

| colour, against sand       | dawn |      day |     dusk | night |
| -------------------------- | ---: | -------: | -------: | ----: |
| Clawd's own peach          | 1.89 | **1.03** |     2.43 |  4.93 |
| the vehicle's              | 1.32 |     2.56 | **1.03** |  1.98 |
| the sign plate's `#C9D1D9` | 3.32 |     1.71 |     4.27 |  8.68 |

Reproduce with `node tools/contrast.ts '#RRGGBB'`. These are on the rounded
basis the panel shows; an earlier version of this table was on the authoring
triples, which shifted every cell by a hundredth or two and put it on a
different footing from figures already written down elsewhere.

**No saturated colour clears 2:1 on all four grounds, and neither does the
character.** Clawd measures 1.03:1 against day sand and is perfectly readable
on the panel, so hue separation, the contact shadow and the silhouette are
carrying weight that a luminance ratio does not model. The tool says so in its
own header: this is a screen for the obviously-invisible, not a gate. What it
does settle is that a dark saturated body on dusk sand is the one combination
to avoid, and that the corpus's existing light grey is the safest thing already
in the palette.

**The art overrode that, deliberately, and here is the reasoning.** The vehicle
ships in the mid-saturated candidate — the 1.03:1-on-dusk-sand row above. What
carries the shape is internal contrast rather than contrast with the ground:
the window, the wheels and the shaded sill give it four tones, and the critic
judged it at true size on all four sands and both orientations before passing
it. A light grey vehicle would measure better and read worse, because it would
be the same tone family as the sign plate and the thought bubble, which are
`Clawd`'s own props. Recorded because a plan that concludes one thing while the
art beside it does another is worse than either.

**`hipGap` will pass vacuously, and it was already doing so everywhere.** That
gate walks up from the bottom-most drawn row and returns 0 once the contiguous
bottom band exceeds 24 device pixels. Measured after the art landed: every one
of the twelve bakes exceeds it on a correct pose, so the walk never runs
anywhere — the interesting failure is under a _defect_, where a plain lift
collapses the band to the legs and is caught, and a lift behind a
ground-bridging prop like this vehicle is not. `overheated` is the other miss,
and not for want of legs: it has four, sitting above the torso.
Something else has to assert the body is on its feet here, and
`tools/bake-sprites.test.ts` records what that something should be.

**Not wanted:** a number plate, badge, or any mark identifying a specific
vehicle. A prop drawn so large that Clawd stops being the subject. A vehicle
that touches nothing. Any new colour without re-running the per-document snap
test above.

### The fallback is not 10% of the risk

`BUILD_PLAN.md` prices it as "90% of the joke at 10% of the risk". That is true
of the art and false of the item: **a parked frame with no trigger has nowhere
to be shown**, so the daemon change — eight files, five excluding tests — is paid on both
branches. The
`overheated` precedent of "art first, wiring last" does not transfer here, and
the wiring is not cuttable with the art.

It also cannot be literally static: `svg2frames` warns "all frames are identical
— this animation does not animate", and `docs/ANIMATION.md` requires no
warnings. So the fallback is `permission-sign`-shaped — parked vehicle,
breathing, one slow blink — which is the right answer anyway, because a frozen
crab on a live rock pool reads as a crash.

| date           | decision                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mon 31 Aug** | trigger landed, before Stage 3's window closes                                                                                                                                                                                   |
| **Wed 3 Sep**  | first true-size render at 5 units on dusk sand, judged on the panel at 320x172 and not zoomed. Stop if it does not read as a vehicle, or if it makes him stop being the subject. **Overlap is not a stop condition** — see Props |
| **Sun 6 Sep**  | ship-or-fallback, with the rest of the Tier A gate                                                                                                                                                                               |

A fallback decided on 22 September is not a fallback.

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

**Not pack-swappable.** It was planned as a personalisation lever — one pack
field for how far the scenery reaches, schemes later — and that was cut on
25 Aug; see `BUILD_PLAN.md`'s deferred table. The rock pool is the only one,
and `packages/cli` fixes its extent at `panel`.

---

## Wizard — `WebSearch`, `WebFetch`

Clawd is calling something in from somewhere else, and it is arriving.

`BUILD_PLAN.md` Stage 4 item 10, Tier B per `spec.md`. Until 24 Aug both
tools drew `thinking` via `FALLBACK`; `TOOL_ANIMATIONS` now maps both.

`data-loop-seconds="12"`, **not 8**. Three evenly phased motes need 3 to divide
the frame count, and 3 does not divide 64 — the arithmetic that moved `dizzy`
to 12 seconds. What shipped rides a 3s track of 24 frames, which tiles the
96-frame loop four times, with the three motes 8 and 16 frames apart — exact
thirds of the track, which is what needed 3 to divide it.

- **Action.** A pointed hat, and one claw extended holding a small object with
  motes arriving toward it. The reading is _summoning_, not _searching_: a crab
  at a screen is `typing`, and "thinking about it" is already `thinking`.
- **Body mechanics.** `idle`'s breath, legs outside it. One claw rotated and
  extended at the shoulder and held, as `permission-sign` does. **It must hold
  something** — §5. `permission-sign` holds a plate, `gym` a bar, the payoff a
  vehicle; an empty extended claw is the half of that precedent that does not
  work alone.
- **Eyes.** Open, toward the arriving motes rather than front. One slow blink.
- **Props.** The hat, and the small held object. **Stepped rects, not a
  polygon** — every SVG in the corpus is rects only, and `svg2frames`'s
  safe-area walk is `querySelectorAll('rect')`, so a `<polygon>` hat is
  invisible to the one gate that checks the -4 line. `paintRock` is the worked
  example of a stepped silhouette. A long diagonal also antialiases along its
  whole length, which is how `typing` got "a cold rim across the top of his
  head".
- **Effects.** Three motes, `steps(1)` with **inline** delays — that is
  `dizzy`'s and `overheated`'s idiom, not `asleep`'s, which is `linear`. Each
  mote is a dark mass with a pale core, not a single unit: measured, `#C9D1D9`
  is **1.01:1 against the day sky's low band** and `#000000` is **1.55:1
  against night sky low and 1.08:1 against its top**, so one flat tone is
  invisible at some hour whichever it is.
  This is the fifth time that defect would have landed.

**Not wanted:** a wand — it competes with the hat for the same silhouette, and
the held object solves what the wand was for. (Upstream's wizard _does_ carry
both, and reads; but it has a 45-unit viewBox at 500px against this stage's 21
at 168, so it is not evidence for this panel.) A book or a screen: those read as
`bouldering` and `typing`. Motes scattered around him rather than arriving at
the claw, which is `dizzy`'s screen. Single-tone motes at any size.

**Fallback:** the hat and the held object with breath and a blink, no motes. It
is `permission-sign`'s shape and it reads. **Decide by Wed 3 Sep** — if the
motes are not legible against day and night by then, ship without them.

### Built 24 Aug, and the three things this plan did not say

**The magic goes above him, not beside him.** This plan asked "where does the
prop go?" and answered it for the _sprite_, not for the composite. Measured off
`paintEnvironment`: the rock occupies units x -2.25 to 1.00, **y 6.63 to 8.75**,
and the first draft put a dark orb at x -2 to 1, y 6 to 9 — four black cells on
dark stone. The left flank is 3 units wide and the rock is most of it; the clear
air above him is 10 units, from the -4 crop line to the torso top at y 6 —
10.5 if measured to the horizon at 6.50. So
the claw is raised to 65 degrees and the motes fall steeply into it. A
sprite-only review cannot catch this, because the sprite is composited
afterwards — **render the sprite on the four grounds before believing the
staging.**

**Two drawn colours must not meet inside a scaling group.** The hat began inside
`#breathe`, which is a scale, so every step edge landed off the pixel grid and
`snapToPalette` resolved the blends wrongly: `#C9D1D9` over `#000000` at half
coverage is (100,104,108), whose squared distance to `#DE886D` is 15,909 against
32,480 to black and 33,107 to the pale. **Peach wins by more than 2x.** Measured
on the first bake: 81 of 96 frames carried peach above the torso and 87 had
transparent rows cutting the hat into floating bars. It is now §7 of the
checklist. The fix is not "make it static" — a hat that ignores the breath reads
as pasted on, and the user said so. It is `#fx-bob`: the same ease-in-out curve
sampled per frame and rounded to whole device pixels, which is what a moving
sprite _should_ rasterise to.

**A pale band across a cone reads as a tiered cake.** It lands on the widest
step. The pale belongs on the brim, under the cone, which is also what carries
the hat against a night sky when the black cannot. Upstream clawd-tank reaches
the same construction from the opposite direction — its `hat-mishap` has a
darkest band at the cone's base and a _lighter_ brim below it, and it breaks the
cone's symmetry with a non-monotonic step rather than running clean to a point.

**And three motes on one path is a bead chain.** Evenly spaced collinear dots
are what "three things a third of a cycle apart on a straight line" means. They
need separate paths that fan.

**Fanning was not enough, and the reason is size.** Three five-cell crosses at
whole-unit cells cannot converge on a two-unit orb without meeting: measured
over the loop, two of them were edge-adjacent on **24 of 96 frames**, which
rasterises as one glyph. That is exactly the defect `componentSizes` in
`tools/bake-sprites.test.ts` exists to catch, and it was hard-coded to `dizzy`
— three lines from catching it. The gate is now a table and covers both.

The fix was halving the mote to 0.5-unit cells: 1.5 units across and 80 device
pixels against `dizzy`'s 320. Quartering the area buys the clearance, and it
buys the cadence too — twelve positions of two frames each rather than six of
four, so a mote glides instead of hopping 9 pixels twice a second. **Check
separation analytically before rendering**; the rectangles are known from the
keyframes, and 96 frames of three pairs is a loop, not a render.

**Three things a critic found and passed as benign: two fixed, one accepted.**

- **Two specks welded to the brim** by sharing its top edge, so they rasterised
  as one pale run rather than as specks — the file claimed "no two touching even
  at a corner", which was true speck-to-speck and false speck-to-brim. **One was
  flush with the cone's right edge**, which is not a speck but a notch in the
  silhouette, at its worst by day where `#C9D1D9` is 1.01:1 against the low sky
  band. Both fixed: specks are 0.75 x 0.5 now and each is generated with an
  assertion that it sits a quarter unit clear of its row's edges and of every
  other speck, so the constraint is checked while authoring rather than promised
  in a comment. Measured from the bake, each speck is its own 24-pixel pale
  component on all 96 frames — 576 of them, none touching anything.
- **The brim's pale overhang sits on the horizon**, flush with the sea's first
  row on 21 of 96 frames and covering it on 18 more. **Accepted.** Two things
  came out of trying to fix it. The first is that moving the brim cannot: the
  torso's own top edge travels 6.00 to 6.63, so it crosses 6.50 by itself, and
  anything sitting on the head is at the horizon for part of the loop. The
  second is that darkening the overhang is worse — the cone's base is two units
  inboard and a row up, so a dark end-cap has no dark mass to bind to and reads
  as a speck floating beside his head, and against night sky at 1.55:1 it
  vanishes, so the silhouette it was protecting existed on one ground of four.
  Upstream `hat-mishap` overhangs by three units each side in one flat colour
  and never changes colour at the overhang.

**The general lesson is the one worth keeping:** a defect that is unavoidable
in one dimension is not therefore worth attacking in another. The horizon
overlap follows from where the head is; the only lever was how bright the thing
at the horizon is, and pulling it cost more than it bought.

**A cone needs to taper on both sides.** Three drafts of this hat failed in
three different ways: a pale band across it read as a tiered cake, then every
row left-aligned at one x gave a vertical wall and a single slope which read as
a shark fin, then a hard lateral kink in a five-row cone read as a blotched
lump. What works is a six-row taper with the centres drifting — 7.5, 7.25,
7.25, 7.25, 6.75, 6.75 — and the pale carried by scattered specks plus a brim
proud of the torso, which is upstream's construction and not an accident.

---

## Board game — `Agent`

Clawd is not doing the work; several small things are doing it for him.

`BUILD_PLAN.md` Stage 4 item 11, Tier B per `spec.md`.

**Trigger settled 25 Aug: `PreToolUse` on `Agent`, at a two second loop.** It
stays a row in `spec.md`'s first-match-wins tool table, so nothing about the
resolver changes and the whole wiring is one `TOOL_ANIMATIONS` entry, exactly as
`wizard` shipped.

### Why the loop length is the trigger decision

The risk this section was written around is real: subagents are not a separate
event stream, and sidechains do not get their own session id, so a subagent's
own tool calls arrive on the _parent's_ session and repaint the stage.

**The evidence is a hook capture, not a transcript count.** The daemon reads
hook payloads, not transcripts, and those are different mechanisms — a listener
on the daemon socket during a live subagent produced
`{"sessionId":"<parent>","kind":"PreToolUse","tool":"Bash","agentId":"<agent>","agentType":"spec-grill"}`.
That is the claim at the layer that matters. `state.ts` corroborates it with a
real sample — 36 distinct session ids against 1,187 transcript files. Counting
subagent transcript files does **not**: they live under
`<parentSessionId>/subagents/`, so the session ids are the directory names and
167 files re-observe the same two facts 167 times.

Measured across those runs, time from a subagent starting to its first tool
call is median **3.2s**, p90 4.3s, max **9.6s**. Against that window:

| loop | frames | seen whole     |
| ---- | ------ | -------------- |
| 2s   | 16     | **167 of 167** |
| 3s   | 24     | 110 of 167     |
| 12s  | 96     | **0 of 167**   |

So the original plan's twelve seconds was never going to be seen at all, and the
fix is the loop, not the trigger. At two seconds the screen closes before the
first repaint on every run measured, costs 16 frames rather than 96 — `typing`
is 59KB baked against `wizard`'s 480KB — and leaves `gym`, `bouldering` and
`typing` to say what the subagent is actually doing for the remaining ~900
seconds. The screen is a punctuation mark: _handed off_, then back to work.

**One caveat on that table**, since peak concurrency here was 7: when several
subagents start together the screen is replaced by the _first_ of them to make a
tool call, which is the minimum of a batch rather than one draw, and the
published summary has no lower tail to answer that with. It does not change the
decision — any distribution that closes a 2s loop early closes a longer one
earlier, and a full 2s window shows all sixteen frames from any starting phase,
which matters because `frameAt` is wall-clock modulo and never resets to frame 0
when the animation changes. Recorded because the table reads as if the runs were
independent and they are not.

### Why not `session.subagents > 0`

That was this section's own proposal and it is rejected, for four reasons found
by grilling it rather than by building it.

- **It has no correct place in `animationFor`.** Checked before the state
  switch it beats `NEEDS_PERMISSION`, `WAITING` and `FAILED` — the three
  attention states the resolver exists to distinguish — and it beats `DONE`,
  whose window is 45s, so a quiet model turn inside a subagent would replace the
  payoff screen with the least important screen in the catalogue.
- **The counter can stick.** `persistence.ts` restores `subagents` verbatim,
  nothing resets it on `SessionStart` and `RESUMED` does not clear it, so a
  daemon restart or a crash mid-subagent leaves a count with no `SubagentStop`
  ever arriving — showing the screen for up to the 10 minute eviction window
  while nothing runs. If a session-lifetime gate is ever wanted, `agentId` is
  already on the wire and already parsed before being discarded, and a per-event
  `agentId !== undefined` test has no counter and no stuck state.
- **It is not a long screen, it is the default screen.** Merging every subagent
  interval on this machine: at least one live for **26.0h** against **49.3h**
  awake, peak concurrency **7**. That is **53% duty**, and it would roughly
  halve `gym` — which `BUILD_PLAN.md` calls the most-watched working screen by
  a factor of three — in favour of a Tier B screen. The parameter that figure
  turns on, since it has no meaning without one: "awake" is the union of parent
  and subagent activity with a block broken at 10 minutes idle. A grill
  measuring the same thing with a different idle threshold got 25.9h of 52.3h,
  which is the same answer to the precision that matters.
- **It exits a settled table.** `spec.md` lists this as a `PreToolUse` row under
  "first match wins". A session-lifetime gate does not reorder that table, it
  leaves it, and that is a reopening rather than a settling.

**And the exposure numbers are the author's, not the recipient's.** 167 subagent
runs across two sessions with 7 concurrent at peak is this repo's own review
discipline, not ordinary use. Someone who never spawns a subagent sees this
screen 0% of the time; someone with this workflow would have seen it half the
time under the rejected trigger. Nothing measures the recipient's usage, and
that assumption gets tested on 23 September in front of them. Two seconds and
one map entry is the cheap hedge: guessing wrong costs a screen nobody notices
rather than a screen that eats the panel.

**Known and accepted** (and note the denominator moves: 168 transcripts existed
when the spawn split was counted against 167 when the timings were, because the
session doing the measuring was itself spawning subagents): an `Agent`-keyed
trigger fires on 93 of the 168 subagent
runs measured here. The other 75 were spawned by `Workflow` and by a session
tool, and whether `SubagentStart` fires for those is unverified in either
direction — so the rejected trigger is not known to cover them either.

`data-loop-seconds="2"`, 16 frames.

- **Action.** A board on the ground to his left with pieces that move without
  him touching them. He watches.
- **Body mechanics.** Breath only, legs outside it. **No claw raise** — this is
  the one working screen where he deliberately does not act. One breath cycle is
  exactly 2s, so the loop is one breath.
- **Eyes.** Down and left, on the board. **No blink**, and this reverses the
  earlier note. That note argued from `confused`'s 26 distinct frames of 96 that
  a screen this calm needs one; at 16 frames a blink is 3 or 4 of them and lands
  as a twitch, and `permission-sign` is calmer still at 16 distinct of 64. The
  motion budget belongs to the pieces.
- **Props.** The board, left flank, ground level, overlapping his legs.
  **Measure the width rather than inheriting 5 units** — that figure came from a
  _vehicle_, which needs wheels, a cabin and a window to read; a flat slab with
  pieces may read at 3 or 4. Two or three pieces, at least two tones, measured
  against sand.
- **Effects.** None. The pieces moving is the effect — **one piece, one move,
  once per loop.** At 16 frames that is the whole beat and it has to be legible
  as a single event: a piece in one place at frame 0 and one cell further at
  frame 8, on whole device pixels with `steps(1)`. Anything continuous inside a
  scaling group is the `wizard` hat failure, which cost two rebuilds and 81 of
  96 fringed frames.

**Not wanted:** dice — they read as gambling, and a single unit rasterises to a
dot. A board he reaches toward: his legs already provide the contact. More than
three pieces; at 8px a unit they merge. Any piece leaving the board. A twelve
second loop — see the table above.

**The gap this was predicted to widen, it does not.** This section expected a
ground-level prop beside his legs to blind `hipGap` the way `payoff`'s vehicle
does, making board game the third animation the gate cannot catch. Built and
measured, it is caught: planting the defect the gate exists for — the whole
peach body lifted two units off the legs, rendered and re-baked, not simulated
— `hipGap` returns **8** where a correct pose returns 0. The prediction was
made before the art existed and the art came out the other way, because the
board sits _in_ the legs' own rows rather than bridging a lifted body to the
ground.

**The margin is one row, and that is worth carrying to the next ground prop.**
Under the planted defect the contiguous band from the feet is exactly **24**,
against `LEG_BAND = 24` and a strict `>`; at 25 the bound fires and the walk
never runs. One more unit of prop height, or pieces one unit taller, and the
original prediction becomes true.

The wider point stands: on a correct pose the bound fires on all thirteen
bakes, so the gate catches nothing anywhere until a defect exists, and the
replacement is _sketched_ in `tools/bake-sprites.test.ts` — a discriminator
named and not validated — rather than designed.

**Fallback: cut the art and the row.** Written before the wiring landed, this
said there was "no wiring to strand" and that the screen was cuttable "at no
cost" — true then, false the moment the `TOOL_ANIMATIONS` entry shipped on
25 Aug. Cutting now touches `animation.ts`, its test, `sprites/index.ts`, the
bake and three references in `tools/bake-sprites.test.ts`. Still cheap, and
still far cheaper than the payoff screen's trap — "a parked frame with no
trigger has nowhere to be shown" — because the trigger is one row rather than a
resolver change. But it is not free, and a fallback that understates its own
cost is the kind that does not get taken.

All three dates below were met on 25 Aug, the day the section was written — the
art and the `TOOL_ANIMATIONS` row landed together. Kept as a record of what the
gates were rather than as a schedule, because a table of future decisions for a
finished item reads as work outstanding.

| date           | what had to be true                                                |
| -------------- | ------------------------------------------------------------------ |
| ~~Wed 3 Sep~~  | board and pieces drawn, rendered at true size on all four sands ✅ |
| ~~Sat 6 Sep~~  | `animation-critic` has passed it, or it is cut ✅                  |
| ~~Sat 13 Sep~~ | `TOOL_ANIMATIONS` entry merged, or the art is cut with it ✅       |

The 6 Sep Tier A gate this used to hang off has already fired green — all nine
Tier A screens are baked as of 25 Aug, twelve days early — so "decide by 6 Sep
with the Tier A gate" would now read as a rubber stamp rather than a decision.
A fallback decided on 22 September is not a fallback.

## Sweeping — `PreCompact`

The context is filling up and Clawd is tidying it.

`BUILD_PLAN.md` Stage 4 item 8, and **Tier B per `spec.md` — the third owed
screen, which the first draft of this section replaced with `road bike`.**
`road bike` is Tier C: "cut without regret". Promoting it was reopening a
settled decision on the most expensive of the three, nineteen days before the
13 Sep feature freeze — the original said seventeen, which reproduces against
no date in the plan.

**Nothing can reach this yet — though as of 25 Aug it can be drawn.** The art
is baked and `loadSprite('sweeping')` works; what is missing is every path to
it — as this section stood before the evening of 25 Aug. `COMPACTING` was
absent from `SESSION_STATES` and `hook-settings.ts` did not register the hook,
each absence citing the other, so the two had to move together or the art landed
unreachable. They moved together: `state.ts` defines the state, `PreCompact` is
registered, and `sweeping` is in `ANIMATIONS`. `board-game` showed the way through: the art can
enter `SPRITE_NAMES` without entering `ANIMATIONS`, and the wiring follows.

### Costed 25 Aug, before drawing — and the cost is the rank, not the clock

**The decision this screen forces is where it sits in `STATE_RANK`, and the
first draft of this section never said the word.** `spec.md` §4 puts
`COMPACTING` in tier 1 — "seize the stage until `oneshotUntil`, regardless of
anything else" — sized at a **2 second** oneshot. Measured, compaction runs for
**two minutes**.

`state.ts` already litigated this for the other tier-1 occupant and the verdict
is the one that governs here: `DONE` was moved out of tier 1 because "a
fifteen-second window is a different cost. **Covering a session blocked on a
human breaks the one promise the panel makes** — it exists to say when to
look." Two reviews independently reproduced a live defect from ranking it too
high. A two-minute tier-1 `COMPACTING` is seven to eighteen times that rejected
window, and the thing it would cover is a permission prompt.

So: **`COMPACTING` ranks below the attention states**, exactly as `DONE` does
and for exactly the same reason. That is a departure from the frozen spec and
has to be written into `spec.md` §4 and §9 rather than only here — design
freeze is today, `COMPACTING` is already in the frozen state machine, so
implementing it is not a reopening but changing its oneshot from 2s to a
minutes-long window is.

This also closes a hole in the first draft's own arithmetic: the exposure figure
below is only realised if `COMPACTING` wins `resolvePanel`'s comparator, which
is the decision that draft presupposed without making.

### How long, measured — and stratified, because pooling it hid the trend

19 compactions across 3 projects on this machine, from `compact_boundary`
records carrying `compactMetadata.durationMs`:

| Claude Code | n     | median     | max        |
| ----------- | ----- | ---------- | ---------- |
| 2.1.219     | 3     | 194.0s     | 268.1s     |
| 2.1.229     | 8     | 173.2s     | 204.5s     |
| 2.1.222     | 2     | 129.3s     | 145.8s     |
| 2.1.234     | 1     | 125.9s     | 125.9s     |
| **2.1.237** | **5** | **108.6s** | **123.4s** |

**Almost none of it is asked for.** The same records carry
`compactMetadata.trigger`, a string that is `auto` or `manual`. Across the 19 in
the census above: **18 auto, 1 manual** — the single manual one on 20 Aug. (The
corpus has since reached 20 records, 19 auto and 1 manual; the table above is the
census as taken.) That is the ground for the screen being calm rather than busy:
nobody asked for it, so it should not read as an alarm. Recorded here because a
draft of `sweeping.svg` asserted the split with no source in the tree, and a
review was right to call it unsupported — the fix is the field name, not the
removal.

**The pooled median of 150s describes no version.** Compaction is getting
faster release over release, and the newest — which is what will be running on
23 September — is 109s median with a 123s maximum. The 268s the first draft used
to size a timeout is the single oldest observation, four releases back and 2.2×
the current maximum. Sizing anything off a clock that upstream is visibly
changing is the wrong move.

**Two exposure numbers, and they say opposite things.** Per occurrence this
holds for minutes. In aggregate it is 0.62 compactions a day and 49.5 minutes
total across a 30.9-day corpus — a duty cycle **between 0.33% and 0.58%** depending on how "awake" is counted —
stated as a range because the single figure this line carried, 0.52%, does not
reproduce under the method the same sentence gives. Union of activity with
blocks broken at 10 minutes idle gives 0.58%; summing per-file blocks gives
0.33%. Nothing turns on which, and the 0.62/day and 49.5 min beside it are exact.
The method is "awake" as the
union of activity with blocks broken at 10 minutes idle, which is the same
definition §Board game uses. That very likely makes sweeping the _rarest_
screen on the panel, not the longest-lived; the first draft claimed the latter
and it is false, because `effectiveState` leaves any non-`IDLE` state standing
until the next event or the 10-minute eviction, so `permission-sign`, `dizzy`
and `gym` all reach longer single occupancies.

Both numbers matter and they answer different questions. The per-occurrence
figure sizes the loop. The aggregate says how much it is worth spending.

**The evidence is transcript-layer and the conclusion is hook-layer**, which is
the methodology §Board game explicitly retired. `durationMs` matches the gap
between the record before the boundary and the boundary itself to within ~100ms
where one sits immediately before, and no transcript record falls inside the
window in any of the 19 — but no transcript can show that `PreCompact` fires at
the _start_ of that window, that no hook event fires inside it, or that the
daemon's hero is this session throughout. Plausible, unverified, and the capture
that would settle it is `PreCompact` to `SessionStart(compact)`, not this.

Sample caveats, weaker than §Board game's and stated for the same reason: 19
events against that section's 167, all from one machine, all `claude-desktop`,
all at a 933k–999k context. A smaller context window compacts more often on
less material, so both rate and duration are configuration-dependent rather
than properties of compaction.

### The exit already exists

The first draft said `COMPACTING` "needs an exit and there is no oneshot expiry
to borrow", and proposed a five-minute bound. Both halves were wrong.

`SessionStart` fires after compaction with `source: "compact"`. It is already
registered in `hook-settings.ts`, already in `HANDLED_HOOK_EVENTS`, and already
has a transition setting `IDLE` — whose comment two lines up names this exact
case and calls it "not worth a special case". Across all 19 boundaries the
session id is unchanged either side, so the clearing event lands on the same
record. `PostCompact` exists too. Nothing needs building.

And the "nothing to borrow" quoted half a sentence: `state.ts` says of `DONE`
that it "needs no oneshot expiry of its own: its window has two bounds, so
crossing the upper one _is_ the expiry". (Quoted here as it reads now. The
sentence used to open "This state needs none", and on 25 Aug an edit put eight
lines about `COMPACTING` between it and its antecedent, so it briefly read as a
claim about `COMPACTING` — which has no window in the daemon at all. This
paragraph is the one place in the repo that borrows the idiom _for_
`COMPACTING`, so it is the passage that would have inherited the misreading.) That field-free idiom is the belt-and-braces for a daemon restarting
mid-compaction — sized off the current version's maximum with headroom, not off
a 268s outlier, and with a stated relationship to `ASLEEP_AFTER_MS`, which the
proposed five minutes silently equalled.

**The matcher risk was invented.** The first draft said every registration uses
`'*'` and that `PreCompact`'s `manual`/`auto` values might mean `'*'` never
matches. Three registrations already do not use `'*'` — `UserPromptSubmit`,
`Stop` and `Notification` — and `hook-settings.ts`'s own docblock says an
omitted matcher and `"*"` both mean everything. The hook docs agree generally,
with no per-event carve-out; `manual`/`auto` are matcher _values_, not a
requirement. It gated on nothing.

### What the wiring actually costs

More than the first draft said, and it does not split. Adding `COMPACTING` to
`SESSION_STATES` is compile-enforced across **four** total `Record`s, two of
them in another package — `STATE_RANK`, `STATE_ANIMATIONS`, `TONE` and
`TOOL_STATES` — plus `HANDLED_HOOK_EVENTS`, a `TRANSITIONS` entry, the
`ANIMATIONS` entry, the bake, and the quip-key surface, because state names are
quip keys. Every type error appears the moment the state is added.

So "art first, wiring last" buys less here than it did for `board-game`: that
rule decouples the art, and the art was never the expensive half. The precedent
that helps is `DONE`, which **borrowed `idle` while the state and rank were
real** — "Nothing had to be reverted when the art arrived, which was the point."
That is the route that makes the expensive half cuttable on its own.

### One safety property, in two halves

Stating one half is how a property like this gets broken. `PreCompact` can be
blocked by a hook — by **exit code 2**, _and_ by stdout carrying
`{"decision":"block"}`. `packages/hooks/src/index.ts` closes both: `bail()` is
`process.exit(0)` and terminates every in-program path — socket error, end, the
150ms deadline, `uncaughtException`, `unhandledRejection`, the undefined-event
path and `main().catch` — and the file already treats writing nothing to stdout
as a correctness requirement.

The gap is the path that never reaches the program: a Node that will not start,
or module resolution breaking after the repo moves. `hook-settings.ts` covers
that with `|| true` on the command and says so.

The stake is higher than "a skipped compaction": per the hook docs, blocking a
compaction triggered to recover from a context-limit error surfaces the
underlying error and fails the request. This is the one screen whose wiring can
damage the thing it decorates.

`data-loop-seconds="12"`, **not the 8 this section carried before the
measurement**. `docs/ANIMATION.md` says longer loops are close to free on the
wire and that length is the cheap way to buy variety, and the corpus splits
that way: the long-exposure screens are `idle` at 16s and `asleep`, `confused`,
`dizzy` and `wizard` at 12s, while 8s is where `thinking`, `payoff` and
`permission-sign` sit. This holds for two minutes. Leaving 8s while writing
"it needs a beat that survives repetition" was applying §Board game's lesson
backwards: there the measurement changed the loop, here the first draft
measured the window, stated the implication and changed nothing.

- **Action.** Clawd sweeping. **Amended 25 Aug: not with an extended claw** —
  the claw rotates and the broom supplies the length; §As built item 2. This
  bullet said "with an extended claw" until a review caught it contradicting the
  bullet four lines below. **Amended 25 Aug: nothing
  is swept.** §Props below permits choosing the broom _or_ the material, and the
  broom was chosen, so there is no swept material on any of the 96 frames and
  "should read as _removed_" has nothing to attach to. A broom travelling over
  empty sand is what shipped; whether that reads as tidying is the judgement
  §As built records.
- **Body mechanics.** Breath, legs outside it. One claw rotated at the shoulder — **the shoulder is
  the arm's pivot, not the broom's**, which §As built item 1 records being
  misread the other way and costing a rebuild.
  moving rather than held — this is the one screen of the three where travel
  carries the reading, so it is the `overheated` fan idiom rather than the
  `permission-sign` hold. **Amended 25 Aug: the claw rotates and does not
  extend**, because the broom supplies the length instead; see §As built. Breath
  is `1.5s`, not the corpus `2s` — at `2s alternate` its cycle is the stroke
  exactly and the loop rendered 19 distinct frames of 96.
- **Eyes.** Following the sweep. **Amended 25 Aug: static.** Built both ways and
  the tracking version reads worse; §As built has the measurements and the
  reason.
- **Props.** A broom or the swept material — decide which, because both is two
  props. Whatever it is has to touch the claw on every frame of the stroke.
- **Effects.** None beyond the swept material itself — so, none. A blink was
  added instead, which the brief did not ask for and which is the screen's only
  second beat.

**Not wanted:** dust clouds, which are the small-pale-things failure again.
A stage that visibly empties, since the loop repeats and it would refill.

**Fallback: superseded 25 Aug — built instead of cut.** The dates below stood
until the capture met the stop condition, and the wiring landed the same
evening. Kept rather than deleted because the reasoning is what priced the
option, and because the paragraph at the end of this section records what
spending it cost.

**Fallback (as written):** cut it. It has the largest wiring cost and the least
visible trigger — and it is now measured rather than asserted: 0.62 compactions a day,
0.52% duty, the rarest screen with a measured trigger. **Decide by Sun 6 Sep**,
but not "with the Tier A gate", which has already fired green and which the
section above records as reading like a rubber stamp. And **do not start the
wiring after 13 Sep**: it is atomic and cross-package, so it cannot be
half-landed.

**Corrected 25 Aug — that last clause bound nothing.** 13 Sep _is_ the feature
freeze (`BUILD_PLAN.md`), so nothing may start after it in any case, and as
written the rule permitted beginning an atomic cross-package change on freeze
day. What was missing is a **start-by**, so: **start the wiring by Mon 8 Sep or
cut it.** Two days after the decision, which is what an atomic change needs to
land with room to revert.

**And the 6 Sep decision needs a stop condition, which it did not have.**
§Payoff's gate names one ("stop if it does not read as a vehicle"); this one
named only a date, so on 6 Sep it would be decided by whoever was least tired.
The condition is the assumption three paragraphs up, which is stated candidly
and then left: the evidence that `PreCompact` fires at the _start_ of the window
is transcript-layer and the claim is hook-layer. No transcript can show it, and
it decides whether the screen is ever seen for its two minutes — which is the
entire return on the wiring.

**So: capture it before 6 Sep.** It needs no repo change — a throwaway hook
settings entry pointing at a logging script, one manual compaction, and read
whether `PreCompact` arrives at the start and whether anything else fires inside
the window and takes the hero. **If the capture does not happen, cut the screen**
rather than buying the wiring on a plausible premise.

**Both discharged on 25 Aug, and the free cut is spent.** The capture happened —
`PreCompact` reaches a hook at the start of the window, `SessionStart` closes it
97s later, and nothing inside it can take the hero — so the stop condition was
met in substance and the wiring landed the same evening, twelve days before the
gate above. That is schedule-positive and not a decision to revisit. But the
sentence that stood here said cutting "costs nothing and reverts nothing"
because the art was inert, and that is no longer true: `sweeping` is in
`ANIMATIONS`, `COMPACTING` is in `SESSION_STATES`, `PreCompact` is registered,
and four exhaustive tables carry a row for it. Cutting now is the same
cross-package change in the other direction, plus a persisted `z.enum`. Anyone
arriving at the 6 Sep gate should know the option it was written to preserve is
no longer priced at zero.

### As built, 25 Aug — where the art differs from the brief above

The brief's own bullets are amended in place; this is the reasoning, each item
measured rather than argued. Six things differ, and the count is stated because
an earlier version of this heading said "three" over a list of four.

**1. The broom does not hang off the shoulder.** The first draft read §Body
mechanics' "at the shoulder" as the broom sharing the arm's pivot. A prop at a
fixed radius travels an arc that lifts as it extends: the head was buried four
device pixels in the sand for 57 of 96 frames and up to five above it for 35
more, an unbroken airborne run of 4.38 seconds. A compensating slide along the
handle fixes the tip and leaves the corners, because a tilted bristle block dips.

So the broom is authored **in floor coordinates and pivoted at its own head**:
the head translates along x only, the handle leans about the head's centre, and
the arm rotates to exactly `tilt - 90deg` so it lies along the handle. Contact
became exact on all 96 frames — the head occupies device rows 184 to 191 on
every one, and 191 is the legs' own lowest row. The angle identity means the
claw cannot come off the handle, though the _grip_ still drifts 0.10 to 2.01
device pixels because the arm breathes and the handle does not; that number is
stated in the SVG rather than argued away.

**2. The claw rotates but does not extend — and the first defence of that was
wrong.** Checklist §5 asks for rotation _and_ extension because "a bare rotation
cannot clear the silhouette", so the first draft answered with clearance: the
claw protrudes 11 to 16 device pixels past the torso.

That answer is worthless, for two reasons found in review. The metric does not
discriminate — `thinking`'s left arm has no rotation at all and scores 16 to 17
on the same measure, because the base arm already sits two units left of the
torso; sweeping's rotation _spends_ clearance rather than buying it. And the
premise is a paraphrase that inverts its own authority: `docs/ANIMATION.md`
says "**Rotation gets it out of the silhouette. It does not, on its own, make it
read**", and "what makes a raised claw read is **length**".

The real answer is the one sentence that carried no number: the handle is
collinear with the arm by construction and over four units long, so the composite
_is_ the length. That is `gym`'s rotation-plus-axial-scale achieved with a prop
instead of `scaleX`, and it satisfies the doc's actual closing instruction —
"extend a claw as well as turning it, and give it something to hold". Upstream's
own sweeping animation does the same: a rotated, unscaled claw holding a broom.
`docs/ANIMATION.md`'s `gym` example is about reaching _above the head_, which a
down-and-left claw never needs. **Checklist §5 is amended to match**, because it
is the item that made the wrong answer feel right.

**3. The eyes are static, and this is a judgement, not a constraint.** §Eyes asks
for a gaze that follows. Tracking _further left_ is genuinely blocked — the left
eye sits at unit x 3 to 4 and the arm's near corner reaches 2.976, leaving 0.02
of a unit. But tracking the other way is free, and a review was right to say so:
hold the eye at its base x 4 to 5 at the near end and step left at the far end,
clearing the arm by 1.02 and 0.21 units, whole-unit, on a period that divides the
loop.

So it was built and rendered rather than argued about. It reads worse. At the
near end the eye centres in the head and Clawd looks straight ahead — at the one
moment when the broom is closest and the gaze has least excuse — and a gaze that
tracks for two thirds of a stroke then abandons the prop is worse than one that
never leaves it.

**4. The loop is three strokes, not one.** Twelve seconds on a single
out-and-back put peak head speed at 1.24 device pixels per frame, which does not
read as travel at true size. Three four-second strokes give 1.25 mean, and 3 on
the push against 2 on the recover.

**5. The stroke is asymmetric and the breath is `1.5s`, because the loop was
buying nothing.** This is the finding that would have shipped: at `2s alternate`
the breath's full cycle is four seconds — the stroke exactly, and in phase — so
frames 0-31 were byte-identical to 32-63 and the file rendered **19 distinct
images of 96** — the lowest _ratio_ in the corpus, though not the lowest count,
since `permission-sign` holds 16 of 64 as a deliberately still screen. Against
the screens that also move continuously: `asleep` 96/96, `idle` 123/128. Twelve
seconds of loop bought two frames of content over four.

A `1.5s` breath (three second cycle, eight even iterations) plus a stroke that
pushes in 1.6s and recovers in 2.4s takes it to **88 of 96**. `3s` was tried
first and scores 92, but it made this the slowest-breathing screen in the corpus
— slower than `asleep`, which a crab doing manual work should not be. Measured
across the fourteen animations that existed then, as mean absolute travel of the **torso band's**
top row per second — the metric matters, because "topmost drawn pixel anywhere"
ranks `permission-sign` at zero by catching its held sign arm — 1.5s puts
sweeping **sixth of those fourteen at 3.33 px/s**, between `idle` at 3.75 and
`board-game` at 3.00. At 3s it halves to 1.67 and ranks thirteenth, above only
`permission-sign`. Four frames of distinctness lose to that, and all eight
duplicate frames are a whole stroke period apart, where no viewer can pair
them.

The general rule: **loop length only buys variety if two tracks have different
periods.** Length against a single period is the same picture for longer. It is
checklist item 9 as of this commit, answerable with a frame count rather than an
argument.

**And the judgement the brief forwards here, taken rather than deferred: it
reads as sweeping, not as removing.** §Action wanted what he sweeps to read as
_removed_; §Props allowed choosing the broom instead of the material, and the
broom was chosen, so there is nothing on the sand to remove. Rendered at true
size on all four grounds, what the screen says is "a crab is sweeping" — the
head is flat on the floor, travels a fifth of the panel, and the arm lies along
the handle throughout. What it does not say on its own is _tidying up after
something_. That last step is carried by context rather than by the frame: this
screen only ever appears while the context is being compacted, and the panel is
glanceable rather than read.

The alternative was a second prop, which §Props rules out as two props, and
which §Not wanted rules out again for the specific case of a stage that visibly
empties on a loop that repeats. So this is the intended trade rather than a
shortfall — but it is the screen's weakest link, and if anything about it is
revisited before 13 Sep, this is the thing to revisit, not the stroke.

**6. There is a blink.** `#eyes-blink` carried an id and no rule at all, so
nothing blinked across a screen that holds for minutes. It is the only beat the
stroke does not supply. Its `transform-origin` is `7.5px 10px` rather than the
corpus `7.5px 9px`, because `#fx-eyes-look` nests inside it and moves the eyes a
unit down; at 9 the lid collapsed into the brow with a measured 7 pixel drift.

---

## What every plan has to answer

Nine constraints, each one a place an animation has already gone wrong on this
project. Checking a plan against them costs minutes; discovering them from a
critic's render costs a rebuild.

1. **Where does the prop go?** The stage spans x -3 to 18 and the character
   occupies 0 to 15, so the free width is 3 units per flank and it is not
   contiguous. The right flank is the rock pool, units x 11.25 to 17.50,
   y 12.50 to 15.63 — a band across the ground line, not the flank's full
   height, so it rules out ground-level props there rather than everything. The left flank is clear at ground level
   but the environment's rock sits at x -2.25 to 1.00, y 6.6 to 8.75. The
   character cannot move: `docs/ANIMATION.md` says grow the stage instead, and
   the stage is within half a unit of the panel's ceiling.
2. **Does the prop touch him?** §Props need contact. Sharing an edge is not
   contact — the payoff screen's first draft touched nothing on any frame while
   claiming it did, and `gym`'s bar three units clear read as hovering.
3. **What does a new colour capture?** `paletteOf` is per-document and matches
   `/fill\s*[:=]\s*"?(#RRGGBB)/` **against the raw file text** — so a `fill`
   token inside a comment _is_ a declaration, and so is a `fill:` in a `<style>`
   rule. What is not is a bare hex in prose, which is how the payoff screen's
   remedy went missing. Every declared colour becomes a snap target for every
   other colour's antialiased edges; compute what a new one takes from the
   peach-to-black ramp before drawing, and declare `#6F4436` if it takes the
   middle.
4. **What does it measure against the grounds it will actually sit on?** This
   is the one that has bitten most often — the boot splash wordmark,
   `confused`'s caret, `dizzy`'s stars and `asleep`'s Zs all failed it, and
   `asleep`'s is still unfixed. Run `node tools/contrast.ts` and paste the row.
   Two numbers that decide most of it: the corpus pale `#C9D1D9` is **1.01:1
   against the day sky's lowest band**, so a pale thing at head height is
   invisible by day; `#000000` is **1.55:1 against night sky low and 1.08:1
   against its top**. One flat tone
   does not survive four times of day at head height, which is why `dizzy` ended
   up a dark mass with a pale core.
5. **Does the raised claw read as a limb — and does it hold something?**
   **The property is length, not clearance.** `docs/ANIMATION.md`: "Rotation
   gets it out of the silhouette. It does not, on its own, make it read", and
   "what makes a raised claw read is **length**". So do not answer this item
   with a protrusion measurement — it cannot fail. `thinking`'s left arm has no
   rotation at all and clears the torso by 16 to 17 device pixels, because the
   base arm is already two units left of it.

   Buy the length either way: with `scaleX`, as `gym` does at -73deg and 2.85;
   or with a prop held collinear with the arm, as `sweeping` does with a broom
   on a `tilt - 90deg` identity. **Either way, state the composite length in
   units**, because a mechanism test alone still passes a 1.5-unit collinear
   prop that reads as a stub. The two poles are the bare claw at **2 units**,
   which `docs/ANIMATION.md` records failing at true size in three separate
   positions, and `gym`'s **6.8-unit** limb. `sweeping`'s handle is 6.7. A pivot at the claw's own tip extends it inward
   under the torso instead, which is the failure this item exists to catch.
   `docs/ANIMATION.md` adds the third clause: "give it something to hold".
   Every extended claw in the corpus holds a prop or moves.

   Until 25 Aug this item read "Is the claw rotating _and_ extending ... a bare
   rotation cannot clear the silhouette", which is the inverse of the sentence
   it defers to — and §Sweeping duly answered it with a clearance number that
   proved nothing. A checklist item that misquotes its own authority is worse
   than no item, because it gets answered.

6. **Are the legs outside the breathing group, and is `ground-shadow` absent?**
   Legs inside it make the whole sprite bob and the feet sink into their own
   contact shadow. There is **no seated pose in the corpus** — `typing` looks
   seated and is not, it is standing behind a laptop — so a pose off the ground
   line means `UNGROUNDED`/`castsShadow` in `packages/renderer`, which is a
   change with a mandatory review rather than an SVG edit.
7. **Does any element with two colours inside it sit in a scaling group?** If
   it does, it will fringe. A `scale` puts every internal edge off the pixel
   grid, Chromium antialiases it, and `snapToPalette` sends the blend to
   whichever palette entry is nearest in squared RGB — which, for a pale-on-dark
   prop in a document that also declares the body colour, is **the body
   colour**. `#C9D1D9` over `#000000` at half coverage is 15,909 from `#DE886D`
   and 32,480 from black. The wizard's first hat did this on 81 of 96 frames,
   `bouldering`'s violet line and the payoff's red fringe are the same
   mechanism. Edges facing the _background_ are **not** exempt — `BACKGROUND`
   in `tools/frame-palette.ts` is `[0,0,0]` and is added to the palette itself,
   so they are composited toward black and snapped like everything else.
   Whether that is safe depends on the document: `wizard` declares three
   colours and nothing sits between peach and black, so its background-facing
   edges resolve to one or the other, while `payoff` declares `#6F4436`, which
   does sit in that ramp and takes 50 of its 101 steps. Count the ramp. The remedy is not to freeze the element —
   move it by whole device pixels instead, with `steps(1)`, sampling whatever
   curve the body uses. `wizard`'s `#fx-bob` is the worked example.
8. **Do the keyframes land on whole frames, and does the effect period divide
   the loop?** One frame is `100 / (loop_seconds * 8)` percent. And _n_ evenly
   phased effects need _n_ to divide the frame count: three things at 8 seconds
   is 64/3 frames apart, which is not an integer — the reason `dizzy` is 12
   seconds.

And for _n_ effects phased by delay, **check the frames each one actually
changes on rather than inferring it from the delay.** The obvious rule — keep
the delays off the step grid or they all jump together — is wrong, and
`wizard` is the counter-example in the same commit that first wrote it down:
its delays are 8 and 16 frames against a nominal 2-frame step, squarely on the
grid, and the three motes still never step together. What saves it is that the
dwell is not uniform. Six-decimal keyframe percentages put some boundaries a
fraction before a sample time and some a fraction after, so twelve positions
render as 2, 3, 1 repeating — `dizzy.svg` §Why nothing rotates measures it, and
§Dizzy above records the even-spacing claim being asserted and retracted once
already. The rule is also unsatisfiable as stated alongside thirds-of-track
phasing, which forces the delays to be multiples of the step.

9. **Do two tracks have different periods — and how many distinct frames does
   the bake actually contain?** Loop length buys variety only if something has a
   second period. Length against a single period is the same picture for longer,
   and nothing in the SVG looks wrong when it happens.

   The trap is the corpus breath. `2s alternate` is a **four** second cycle, so
   on any screen whose main track is also four seconds the two are in phase and
   half the loop is a byte-identical repeat of the other half. `sweeping` shipped
   into review that way: three four-second strokes against a `2s` breath rendered
   **19 distinct images of 96**, against `asleep` 96/96, `idle` 123/128, `dizzy`
   89/96 and `wizard` 87/96. Twelve seconds of loop bought two frames of content
   over four.

   **Do not decide it on the ratio.** 19 of 96 is 19.8%, but `confused` is 27.1%
   and `permission-sign` 25%, and both are deliberately still screens — there is
   no threshold that separates the defect from the intended cases, and a ratio
   test hands the reader the number that would not have caught it. The
   discriminating test is structural: **no half or third of the loop may be a
   byte-identical copy of another.** §Overheated records that exact check finding
   that exact defect once already ("frames 32-95 were byte-for-byte copies of
   0-31"), which makes `sweeping` the second time.

   A mirror-symmetric main track costs the other half again — the return stroke
   is the push played backwards — so an asymmetric one (`sweeping` pushes in
   1.6s and recovers in 2.4s) is where the rest comes from. Both fixed took it to
   88 of 96.

   Choosing the second period is not free: pick it against the corpus, not just
   against the arithmetic. `sweeping` first took `3s`, which decouples the
   periods and scores 92 — and made a working crab breathe slower than `asleep`.

   Answer it with a count, not an argument — and render first, because `out/`
   is gitignored, so a fresh clone has none and an existing one may hold
   yesterday's frames:

   ```bash
   node tools/svg2frames.ts assets/clawd/animations/<name>.svg out/<name> &&
     shasum out/<name>/frame_*.png | cut -d' ' -f1 | sort -u | wc -l
   ```

   `shasum` rather than `md5 -q`, which is BSD-only and not on the Linux runner.

Two of these were stated backwards in the first draft of this section: that a
hex in a comment is never a declaration, and that the claw mistakes had
shipped. Neither was true. A checklist that inflates its own evidence gets
discounted exactly when it is most needed.

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
