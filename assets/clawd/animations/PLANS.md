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

Each plan states four things — **action**, **body mechanics**, **eyes**,
**effects** — following the structure upstream clawd-tank uses in its own
`assets/svg-animations/PLANS.md`. Two constraints apply to all of them, from
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
- **Effects.** Small squares rising off each claw and popping out near the top
  of the stage. Two streams, never crossing the torso or the eyes. Hard pop in
  and out, no fade: an intermediate alpha becomes an intermediate colour once
  the palette is quantised.

**Not wanted:** a fade tail on the rising bits; any rotation; any motion
crossing Clawd's face.

---

## Thinking — `UserPromptSubmit`

Clawd working a problem out, cogs turning above his head.

- **Action.** Two meshing cogs above his head, turning steadily and in opposite
  directions. Claws stay where the base puts them — see the note below.
- **Body mechanics.** A slow sway, one art pixel side to side, at a quarter the
  cadence of typing's jitter. Deliberation, not effort.
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

**Why this one is next.** It is the first test of pose swapping, and six of the
ten remaining animations depend on that technique working — a gear that cannot
turn, a broom that cannot swing, a reach with no elbow. If it fails here, it
fails everywhere, and it fails now rather than in September.

---

## Template

```
## <name> — <triggering tools or state>

<one line of what the viewer should read>

- **Action.**
- **Body mechanics.**
- **Eyes.**
- **Effects.**

**Not wanted:** <the things that would look plausible and be wrong>
```

The "not wanted" line is the one that earns its keep. It is what turns a review
from taste into a check.
