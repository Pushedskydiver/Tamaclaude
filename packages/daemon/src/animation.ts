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
 * The animations this daemon can ask for. `assets/clawd/animations/PLANS.md`
 * is the authority for what exists — not the fifteen the screen spec
 * catalogues — and this list is what is both built *and wired*, which is not
 * the same thing — `overheated` was built and baked two PRs before it was wired,
 * which is the order `BUILD_PLAN.md` item 12 asks for: art lands first, so
 * cutting it at the Stage 4 gate never means reverting shipped daemon code. `SPRITE_NAMES` is the built
 * list, this is a subset of it, and `animation.test.ts` enforces that
 * direction. A name here that has no SVG renders as nothing.
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
  'overheated',
  'payoff',
  'wizard',
  'board-game',
  'sweeping',
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
  // Both reach outside the machine for something, which is the reading the
  // screen carries. They were the largest unmapped share of measured tool
  // calls and fell through to `thinking` until now.
  ['WebSearch', 'wizard'],
  ['WebFetch', 'wizard'],
  // Deliberately a short-lived screen. A subagent's own tool calls arrive on
  // the *parent's* session, so `Bash` or `Read` from inside one repaints over
  // this at a measured median of 3.2 seconds. The art is two seconds for that
  // reason, so the loop closes first; keyed instead on `session.subagents > 0`
  // the screen would have held for 53% of the panel's waking life and roughly
  // halved `gym`. `assets/clawd/animations/PLANS.md` §Board game has the
  // measurements.
  //
  // The ground for that is the hook capture below, **not** the transcript
  // layout. Subagent transcripts live under `<parentSessionId>/subagents/`, so
  // reading the parent's id out of them re-observes the directory name; the
  // plan disowns that as evidence in as many words.
  //
  // `'Agent'` is what the hook wire actually carries, captured 25 Aug from a
  // listener on the daemon socket rather than inferred from a transcript:
  // `{"kind":"PreToolUse","tool":"Agent"}`. Worth having done, because this
  // key is a raw string and the test asserting the mapping reads the same
  // literal — so a wrong name here would have shipped green and the screen
  // would simply never have fired.
  //
  // The same capture confirmed the premise: 15 tool calls made inside three
  // different subagents all arrived on the *parent's* `sessionId`, and each
  // carried `agentId` and `agentType`. That is why this screen is two seconds.
  ['Agent', 'board-game'],
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
  // `BUILD_PLAN.md` item 6, and the reason the trigger shipped seven hours
  // before the art: `DONE` borrowed `idle` until now, so the state and the rank
  // were real while the glass showed the picture it would have shown anyway.
  // Nothing had to be reverted when the art arrived, which was the point.
  DONE: 'payoff',
  THINKING: 'thinking',
  COMPACTING: 'sweeping',
  IDLE: 'idle',
  ASLEEP: 'asleep',
};

/**
 * `StopFailure`'s `error_type` to animation, for the values that earn their own
 * picture. Anything unlisted keeps whatever `STATE_ANIMATIONS` gives `FAILED`.
 *
 * `rate_limit` and `overloaded` share one, because they tell the viewer the same
 * thing — wait and come back — and that is what the picture says. Splitting them
 * would show a knock on the head for a condition that is not a knock. The other
 * eight documented values keep `dizzy`.
 *
 * A `Map` rather than an object literal, for the reason `TOOL_ANIMATIONS` gives:
 * this key is untrusted input that has crossed a process boundary, and
 * `TABLE['constructor']` on an object literal hands back something that is not
 * an animation at all, with no type error to show for it.
 */
const ERROR_ANIMATIONS: ReadonlyMap<string, AnimationName> = new Map<
  string,
  AnimationName
>([
  ['rate_limit', 'overheated'],
  ['overloaded', 'overheated'],
]);

/**
 * What narrows a state to a picture, when the state alone is not enough.
 *
 * One object rather than two optional positional strings. `animationFor(state,
 * tool, errorType)` typechecks with the two swapped and returns the wrong
 * picture silently, across two production call sites and a couple of dozen in
 * tests — exactly the shape of mistake nothing would catch. Not a precise
 * count: `cli/daemon.ts` records that spelled-out counts here went stale twice
 * in a week, and an earlier draft of this line said "twenty" and was wrong the
 * day it was written.
 *
 * Each field refines a different state and they never both apply: `tool` is
 * only read for `WORKING`, `errorType` only for `FAILED`.
 */
type Refinement = { readonly tool?: string; readonly errorType?: string };

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
  refine: Refinement = {},
): AnimationName {
  if (state === 'FAILED' && refine.errorType !== undefined) {
    return ERROR_ANIMATIONS.get(refine.errorType) ?? STATE_ANIMATIONS.FAILED;
  }
  if (state !== 'WORKING') return STATE_ANIMATIONS[state];
  if (refine.tool === undefined) return FALLBACK;
  return TOOL_ANIMATIONS.get(refine.tool) ?? FALLBACK;
}
