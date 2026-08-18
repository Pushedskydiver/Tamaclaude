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
`assets/svg-animations/PLANS.md`, plus **props** where the animation has any —
which, since `gym`, is most of them. Two constraints apply to all of them, from
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

Clawd working a problem out, cogs turning above his head.

- **Action.** Two meshing cogs above his head, turning steadily and in opposite
  directions. Claws stay where the base puts them — see the note below.
- **Body mechanics.** A slow sway, half an art pixel side to side, at a quarter
  the cadence of typing's jitter. Deliberation, not effort. A whole pixel was
  tried during authoring and lurched.
- **Eyes.** Raised and drifting between two positions — looking up and away at
  the problem, never at the viewer.
- **Effects.** The cogs. They turn by **pose swapping**, not rotation: each cog
  is two shapes, one with teeth on the axes and one with teeth on the diagonals,
  alternating. See `docs/ANIMATION.md` §Articulation without rotation.

**Not wanted:** any CSS rotation; cogs fast enough to read as effort rather than
thought; eyes meeting the viewer; a blink (at a 1.0s loop any blink is once per
second, which is four times too fast).

**Cut during review: the raised claw.** The plan called for one claw raised to
the chin. Three positions were rendered and judged at true size and all three
read as a lump on the torso rather than a limb — the finding is in
`docs/ANIMATION.md` §What pose swapping cannot do, and it changes how
`bouldering`, `sweeping` and `gym` must be planned. The cogs carry the read on
their own, which is what "not wanted" lines are for: the plan said what the
screen had to communicate, so dropping a mechanism that was not communicating
it was an easy call rather than an argument.

**Why this one is next.** It is the first test of pose swapping, and most of
the animations still to come depend on that technique working — a gear that cannot
turn, a broom that cannot swing, a reach with no elbow. If it fails here, it
fails everywhere, and it fails now rather than in September.

---

## Gym — `Bash`

Clawd doing the heavy lifting. An overhead press, and the barbell does the
acting.

- **Action.** A barbell travels from just above his head to full extension and
  back, once per loop.
- **Body mechanics.** A one-pixel dip at the bottom of the rep, when the load
  is on him. Nothing else moves — no squash, because a scale transform has no
  pixel arithmetic in `docs/ANIMATION.md` and would soften every edge it
  touches.
- **Eyes.** Tracking the bar: up at full extension, back down at the bottom.
- **Effects.** The barbell itself, plus two exertion marks that pop in beside
  his head during the push.

**Not wanted:** any claw repositioned to hold the bar; any scale transform; a
bar that overlaps the eyes.

**Why this one is next.** It is the first test of the rule that came out of
`thinking`: on this geometry props carry the motion and limbs stay where the
base puts them (`docs/ANIMATION.md` §What pose swapping cannot do). `gym`,
`bouldering` and `sweeping` are all planned that way now. If the rule does not
hold, three Tier A screens need rethinking, and it is better to know in August.

---

## Bouldering — `Read`, `Grep`, `Glob`

Clawd going up a wall, searching for the next hold. Claude reading your
codebase.

- **Action.** The wall scrolls downward past him. He does not move up the
  frame; the holds move down, which is what reads as ascending.
- **Body mechanics.** A one-pixel bob, twice a loop — pulling up.
- **Eyes.** Raised, hunting for the next hold above.
- **Effects.** The holds themselves, a repeating column pattern behind him. The
  ground shadow is hidden: he is on a wall, and a shadow on the floor beneath a
  climber is worse than no shadow.

**Not wanted:** any claw reaching for a hold; holds that pass in front of him;
a scroll that seams at the loop boundary.

**Why this one is next.** `gym` proved a prop can carry the motion in a
straight line. This is the harder case — a _repeating_ prop pattern that must
tile seamlessly, and the technique every scrolling background depends on
(`road bike` in Tier C needs exactly this). The hold pattern has to be periodic
in the scroll distance or the loop visibly jumps once a second.

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
