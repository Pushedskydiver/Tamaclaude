/**
 * Which animation a resolved state shows.
 *
 * State and animation are separate on purpose: a state says how much a session
 * needs a human (which is what the strip tints and the hero comparator ranks),
 * an animation is only the raster on the stage. Collapsing them would mean a
 * missing drawing changed a session's priority, which is exactly backwards.
 */

import type { SessionState } from './state.js';

/**
 * The animations that exist. `assets/clawd/animations/PLANS.md` is the
 * authority, and this list is what it has actually built — not the fifteen the
 * screen spec catalogues. A name here that has no SVG renders as nothing.
 */
export const ANIMATIONS = [
  'typing',
  'thinking',
  'gym',
  'bouldering',
  'idle',
  'asleep',
  'confused',
  'permission-sign',
  'dizzy',
] as const;

export type AnimationName = (typeof ANIMATIONS)[number];

/**
 * What an unrecognised situation shows.
 *
 * Chosen against one rule: **the fallback must never claim that less is
 * happening than is happening.** The panel exists to say when to look, so
 * falling back to `idle` — a Clawd doing nothing while a tool runs — is a lie
 * in precisely the direction the whole design is built to avoid. `thinking` is
 * the only built animation that reads as "busy, unspecified" without claiming
 * a particular activity, so it is the safe direction to be wrong in.
 *
 * Exported for the tests. A test that hard-codes `'thinking'` asserts the
 * fallback's current value rather than which states reach it, so retargeting
 * this line would leave "no state is on the fallback" passing while it stopped
 * being true.
 */
export const FALLBACK: AnimationName = 'thinking';

/**
 * `PreToolUse.tool_name` to animation. An unlisted tool takes `FALLBACK`.
 *
 * A `Map` rather than an object literal because the key is untrusted input
 * that has crossed a process boundary: `TOOLS['constructor']` on an object
 * literal finds `Object.prototype.constructor` and hands back something that
 * is not an animation at all, with no type error to show for it.
 *
 * **`Read` alone carries bouldering**, though spec §5 lists `Grep` and `Glob`
 * beside it. Across 1,046 real transcripts and 44,954 tool calls neither
 * appears once (`BUILD_PLAN.md` §Stage 4), so they take the default like any
 * other unlisted tool. That is a recorded decision, not an omission.
 */
const TOOL_ANIMATIONS: ReadonlyMap<string, AnimationName> = new Map<
  string,
  AnimationName
>([
  ['Edit', 'typing'],
  ['Write', 'typing'],
  ['NotebookEdit', 'typing'],
  ['Bash', 'gym'],
  ['Read', 'bouldering'],
]);

/**
 * Every state except `WORKING`, which needs the tool to choose.
 *
 * **No state is on the fallback any more.** All three that were — the two
 * attention states and `FAILED` — now name their own art, so `FALLBACK` is
 * reached only from `WORKING`: with a tool nobody has mapped, or with no tool
 * at all. Both are the case it was written for. `tool` is optional on the wire
 * (`PreToolUse` in `packages/protocol/src/events.ts`) and `session.ts` writes
 * it straight through, so the no-tool path is reachable rather than
 * theoretical — `animation.test.ts` has covered it since before the art
 * landed.
 *
 * They are deliberately different pictures. The permission sign holds up a `?`
 * on a plate, `confused` blinks a prompt caret, and `dizzy` crosses his eyes
 * under orbiting stars — because the first two are attention states that can
 * both be the hero, and a viewer glancing at the panel must not read any pair
 * of them as the same screen.
 */
const STATE_ANIMATIONS: Readonly<
  Record<Exclude<SessionState, 'WORKING'>, AnimationName>
> = {
  NEEDS_PERMISSION: 'permission-sign',
  FAILED: 'dizzy',
  WAITING: 'confused',
  THINKING: 'thinking',
  IDLE: 'idle',
  ASLEEP: 'asleep',
};

/**
 * The animation for a resolved state, with the hero's tool when it has one.
 *
 * Total by construction: there is no input that throws and none that returns
 * nothing. An unknown tool is the ordinary case, not an error — MCP servers
 * invent tool names, and a Claude Code release can add one — and the panel
 * must never be the component that fails a session over a name it has not met.
 */
export function animationFor(
  state: SessionState,
  tool?: string,
): AnimationName {
  if (state !== 'WORKING') return STATE_ANIMATIONS[state];
  if (tool === undefined) return FALLBACK;
  return TOOL_ANIMATIONS.get(tool) ?? FALLBACK;
}
