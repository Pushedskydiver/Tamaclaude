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
Half the plans carry one; `gym` and `bouldering` file theirs under Effects,
which is a distinction not worth enforcing. Two constraints apply to all of them, from
`docs/ANIMATION.md`: no rotation, and every transform must land on a whole
device pixel at the render scale.

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
`docs/ANIMATION.md` §What pose swapping cannot do, and it changes how
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
