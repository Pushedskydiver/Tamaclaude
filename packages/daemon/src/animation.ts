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
 */
const FALLBACK: AnimationName = 'thinking';

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
 * `FAILED` is the last state still on the fallback. Its art is the dizzy spin,
 * which the screen spec tiers below the other two and `BUILD_PLAN.md` schedules
 * behind `sweeping` — so it is cuttable, and until it is drawn `thinking` is
 * the honest thing to show: "busy, unspecified" rather than a claim that
 * nothing is happening. What makes the state unmissable meanwhile is the strip
 * tint and the pack's mapped quip, both of which key on the state rather than
 * on the raster.
 *
 * The other two are drawn. They are deliberately different pictures — the
 * permission sign holds up a `?` on a plate, `confused` blinks a prompt caret
 * — because both are attention states, both can be the hero, and a viewer
 * glancing at the panel must not read them as the same screen.
 */
const STATE_ANIMATIONS: Readonly<
  Record<Exclude<SessionState, 'WORKING'>, AnimationName>
> = {
  NEEDS_PERMISSION: 'permission-sign',
  FAILED: FALLBACK,
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
