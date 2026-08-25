/**
 * One session's record, and the transitions that move it.
 *
 * Everything here is pure and takes `now` as an argument. There is no clock in
 * this package at all — not an injectable one, not a default one — because a
 * function that can read the time is a function a test has to control, and the
 * whole point of five- and ten-minute thresholds is that they must be provable
 * in microseconds. The socket slice supplies `Date.now()` at the edge.
 */

import type { SessionState } from './state.js';
import type { HookEvent } from '@tamaclaude/protocol';

import {
  ASLEEP_AFTER_MS,
  DONE_AFTER_MS,
  DONE_SHOWN_MS,
  EVICT_AFTER_MS,
  WAITING_AFTER_MS,
} from './state.js';

/**
 * A session as the daemon tracks it. Spec §3's record, with two of its fields
 * missing and four added.
 *
 * `origin` (local, or the host a remote session came from) is knowledge the
 * transport that accepted the event has and the event itself does not, so it
 * belongs with whatever accepts the connection. A field this module could
 * never fill would be worse than its absence. `oneshotUntil` goes with the
 * tier it exists for — see `STATE_RANK`.
 *
 * `errorType`, `notifiedAt`, `endedAt` and `workedAt` are the additions. The
 * first three carry information that arrives on exactly one event and is
 * unrecoverable afterwards; `workedAt` is a fact about the session that no
 * single event states. This sentence said "two" and named two while the type
 * carried four, which is why it now counts them.
 */
export type Session = {
  readonly id: string;
  /**
   * The stored state — what the last meaningful event said. Not what the panel
   * shows: `effectiveState` adds the promotions that only the clock knows.
   */
  readonly state: SessionState;
  /** The tool behind `WORKING`, which is what picks the animation. */
  readonly tool?: string;
  /**
   * `StopFailure`'s `error_type` — `rate_limit`, `overloaded`,
   * `authentication_failed`. Kept rather than collapsed into `FAILED` because
   * it arrives exactly once and cannot be recovered afterwards.
   *
   * **Read since 24 Aug**, by `animationFor` and by the quip lookup:
   * `rate_limit` and `overloaded` draw `overheated`, the other eight documented
   * values keep `dizzy`, and a pack can key a quip on `FAILED:rate_limit`. So
   * one state now maps to two pictures — the first exception to the split this
   * module and `animation.ts` are otherwise built on. The state still says how
   * much a human is needed; only the picture refines.
   *
   * It arrives on `StopFailure` as `error`, not `error_type`. `packages/hooks`
   * does that translation, and read the wrong name for three weeks.
   */
  readonly errorType?: string;
  /**
   * When this session last started doing work, if it has since the last prompt.
   *
   * The payoff screen needs to tell "a task finished" from "a reply ended", and
   * nothing already on the record does: `state` is `IDLE` either way, `Stop`
   * clears `tool`, and `lastEventAt` is no help — it moves on any reply, and
   * on the mid-session restart below it equals `startedAt` even after work. Set
   * on `PreToolUse` and cleared on `UserPromptSubmit`, so it means "there has
   * been work since you last asked for something" — which is the thing worth
   * congratulating.
   */
  readonly workedAt?: number;
  /** First sight of this session. Spec §4's tie-break within "needs you". */
  readonly startedAt: number;
  /** Last proof of life, of any kind. Drives sleep and eviction. */
  readonly lastEventAt: number;
  /** When Claude Code last asked for input, if it is still unanswered. */
  readonly notifiedAt?: number;
  /**
   * Set by `SessionEnd`, which is the one farewell Claude Code does send.
   *
   * Eviction is otherwise time-based and must stay that way — a crashed or
   * force-quit session says nothing, so anything keyed only on a farewell
   * leaks a chip forever. But when the farewell *does* arrive, waiting ten
   * minutes to act on it leaves a chip on the strip for a session that is
   * demonstrably gone. `SessionEnd` was registered in `packages/hooks` for
   * exactly this and the daemon had no entry for it, so it fell through to the
   * default and *refreshed* `lastEventAt` — the event meaning "this is over"
   * was postponing the sleep it was registered to trigger.
   */
  readonly endedAt?: number;
  /** Live subagents. A count, not a set — see `SUBAGENT_DELTA`. */
  readonly subagents: number;
};

/**
 * A session the daemon has not seen before.
 *
 * It starts `IDLE` rather than waiting for a `SessionStart`, because **the
 * daemon can start in the middle of a session**: restart it while Claude Code
 * is mid-turn and the first event it ever sees for that id is a `PreToolUse`,
 * or a `SubagentStop`, or anything at all. Treating the first event as proof
 * the session exists is the only rule that survives that.
 */
export function newSession(id: string, now: number): Session {
  return { id, state: 'IDLE', startedAt: now, lastEventAt: now, subagents: 0 };
}

/** The fields an event clears: evidence that whatever we were waiting on ended. */
const RESUMED = {
  tool: undefined,
  errorType: undefined,
  notifiedAt: undefined,
  endedAt: undefined,
} as const;

type Transition = (event: HookEvent, now: number) => Partial<Session>;

/**
 * Hook event to state change. An event with no entry here is proof of life and
 * nothing more, which is deliberate: `PostToolUse` fires between every two
 * calls of a chain, and clearing `WORKING` on it would flick the panel back to
 * idle in the gaps.
 *
 * A `Map` rather than an object literal for the same reason as the tool table:
 * the key comes from outside this process, and an object literal answers
 * `toString` with something from `Object.prototype`.
 *
 * **`Stop` means idle, not done.** The spec keyed the payoff screen on it;
 * the live documentation says it fires when Claude finishes responding, which
 * is every response that finishes. What it does prove is that this session is
 * not doing anything at this instant, which is exactly `IDLE`.
 *
 * **It does not follow a `StopFailure`.** The documentation says so in a verb:
 * "Runs *instead of* Stop when the turn ends due to an API error." Both also sit
 * in the same "once per turn" cadence group. Two reviews disagreed about this
 * — one read a truncated fetch and concluded mutual exclusivity was only
 * implied by a diagram — so it is quoted here rather than paraphrased. That matters
 * because this transition sets `IDLE` and clears nothing else: if a `Stop`
 * arrived after a failed turn it would overwrite `FAILED` within a frame, and
 * `dizzy` would never reach the panel at all. It does not, so there is no
 * defensive branch here — a `Stop` while `FAILED` is unreachable, and building
 * for it would be the dead code `state.ts` refuses elsewhere.
 *
 * Documented rather than observed, and worth saying which: a live hook capture
 * on 22 Aug caught **zero** `StopFailure` across a long session, so the
 * ordering has never been seen on this machine. No count is quoted — the
 * capture was scratch work with no artefact in the tree, and a capture with
 * no failures in it is evidence about frequency and none about ordering. If `dizzy` turns out never to
 * appear on the panel, this is the first paragraph to doubt.
 *
 * Note the transition deliberately does not clear `notifiedAt`: Claude Code
 * asks for input and finishes responding at nearly the same moment, and a
 * `Stop` that wiped the notification would lose the wait depending on which
 * of the two arrived first.
 */
const TRANSITIONS: ReadonlyMap<string, Transition> = new Map<
  string,
  Transition
>([
  // Clears `workedAt` with everything else. `SessionStart` fires on startup,
  // resume, clear and compact, and in three of those four the work it would be
  // celebrating belongs to a session the user has just walked away from. A
  // payoff fifty seconds after a `/clear` is for something that no longer
  // exists. `compact` is the arguable case and it is not worth a special case:
  // the next tool call re-arms it within seconds.
  ['SessionStart', () => ({ ...RESUMED, state: 'IDLE', workedAt: undefined })],
  [
    'UserPromptSubmit',
    // Clears `workedAt`: a new prompt means whatever was finished has been
    // acknowledged, so the next payoff has to be earned again.
    () => ({ ...RESUMED, state: 'THINKING', workedAt: undefined }),
  ],
  [
    'PreToolUse',
    (event, now) => ({
      ...RESUMED,
      state: 'WORKING',
      tool: event.tool,
      workedAt: now,
    }),
  ],
  [
    'PermissionRequest',
    // Clears `errorType` but not `notifiedAt`: being asked to approve a tool
    // is forward progress past whatever failed, and is itself a thing waiting
    // on you, so the pending notification is still true.
    (event) => ({
      state: 'NEEDS_PERMISSION',
      tool: event.tool,
      errorType: undefined,
    }),
  ],
  ['StopFailure', (event) => ({ state: 'FAILED', errorType: event.errorType })],
  ['Stop', () => ({ state: 'IDLE', tool: undefined })],
  ['Notification', (_event, now) => ({ notifiedAt: now })],
  ['SessionEnd', (_event, now) => ({ state: 'ASLEEP', endedAt: now })],
]);

/**
 * `SubagentStart` and `SubagentStop`, which move the count and nothing else —
 * a subagent starting does not stop its parent being `WORKING`.
 *
 * A count rather than a set of `agent_id`s, and `applyEvent` ignores either
 * event when it carries no `agentType`. That gate is what makes the count
 * survivable, so it is not an optimisation to tidy away later.
 *
 * **Unpaired stops are ordinary.** A capture on the hook socket on 25 Aug,
 * 38 minutes of one session: ten `SubagentStop`s, of which seven had no
 * matching `SubagentStart`. Each stray had a distinct `agent_id` and none came
 * from a dispatch — one arrived 3.9s after a `Stop`, one 3.0s after
 * `SessionStart(source=compact)`. That is one roughly every five minutes.
 *
 * Four of the seven were observed to carry an *empty* `agent_type`. The other
 * three predate a fix to the capture script's own field whitelist, which was
 * dropping the key, so for those the wire value was not observed at all. What
 * the sample does support is the absence of a counterexample either way: no
 * stray carried a non-empty `agent_type`, and none of the three dispatched
 * pairs lacked one at either end.
 *
 * **The capture was scratch work and left no artefact in the tree**, the same
 * standing as the measurement above. The figures moved twice while this branch
 * was open — once because a rate was read off the first thirteen minutes, once
 * because a review caught them mid-run with a dispatched subagent still live —
 * so treat them as the reason for the gate rather than as numbers anybody can
 * re-derive.
 *
 * The floor below only stops the badge going negative, which is the harmless
 * direction. The damaging one is a stray landing while a real subagent runs:
 * a true count of 1 goes to 0 and the badge blanks with work still in flight.
 * Any run outlasting the gap between strays is exposed, which at five minutes
 * covers a `da-review` or an `animation-critic` but not a quick `Explore`.
 *
 * **Why `agentType` and not a set of `agent_id`s.** Not because ids cannot
 * discriminate — they can, and better: a set discriminates on *membership*,
 * so every stray in the capture, each carrying an id no start had introduced,
 * would have been rejected without resting on the empty-`agent_type` claim at
 * all. The reason is the one the pre-gate version of this comment gave and
 * which still holds: `agentId` is optional on the wire, so a set needs the
 * counter back as a fallback, which is two mechanisms for one badge. The gate
 * keeps it at one. If `agent_id` ever becomes guaranteed, the set is the
 * better design and this paragraph is the argument for switching.
 *
 * **What is verified.** Both spawn paths emit a matched pair carrying
 * `agentId` and `agentType`: the `Agent` tool sends the agent's own type
 * (`Explore`, `da-review`), and `Workflow` sends `workflow-subagent`. That
 * settles the question this comment used to leave open — workflow-spawned
 * subagents are not silent, so the badge does not under-count by half. Still
 * unverified: a subagent spawned by a session tool rather than by either.
 *
 * **Where the gate is still wrong, stated plainly.** A pair typed at both ends
 * balances, and a pair typed at neither is ignored at both ends and costs one
 * badge digit until the next pair. A *mixed* pair does not: a typed start with
 * an untyped stop adds 1 that nothing takes away, because the floor can only
 * absorb an offset once the count reaches zero and the offset is what prevents
 * that. It reads one high until the session is evicted. Unobserved — every
 * start in the capture was typed — but not impossible, and gating only the
 * stop would have left both that case and the untyped pair stuck the same way.
 * An earlier version of this comment claimed the gate never drifts; a review
 * found the mixed case, and it does.
 *
 * `packages/protocol/src/events.ts` warns against keying on the *presence* of
 * `agentId`, which is a different trap — a `--agent` top-level run carries one
 * on ordinary events — but a reader arriving from there will bounce off this,
 * so: that warning is about identifying a subagent from an arbitrary event.
 * This keys on a field of the two events that are already only about
 * subagents.
 */
const SUBAGENT_DELTA: ReadonlyMap<string, number> = new Map([
  ['SubagentStart', 1],
  ['SubagentStop', -1],
]);

/**
 * Every event kind this file does something with.
 *
 * Derived from the two tables rather than written out, so it cannot drift from
 * them, and exported so a test can hold it against `HANDLED_HOOK_EVENTS` in
 * `protocol`. That list is the contract between this package and
 * `packages/hooks`, which cannot import each other.
 *
 * `PostToolUse` is absent on purpose: a tool finishing changes nothing but the
 * freshness that every event refreshes.
 */
export const HANDLED_KINDS: ReadonlySet<string> = new Set([
  ...TRANSITIONS.keys(),
  ...SUBAGENT_DELTA.keys(),
]);

/** Fold one event into a session. */
export function applyEvent(
  session: Session,
  event: HookEvent,
  now: number,
): Session {
  // `Math.max`, not `now`: an event delayed in the socket buffer or arriving
  // from a host whose clock runs slow must never rewind a session's proof of
  // life and age it towards sleep.
  const seen = { ...session, lastEventAt: Math.max(session.lastEventAt, now) };
  const delta = SUBAGENT_DELTA.get(event.kind);
  if (delta !== undefined) {
    // No `agentType` means this is not a dispatched subagent — see
    // `SUBAGENT_DELTA`. Returned unchanged rather than as `seen`, so it does
    // not refresh `lastEventAt` either: `quiet` in `effectiveState` is measured
    // off that field, and a stray is not the session doing anything.
    //
    // Left as a refresh at first, on the reasoning that any event is proof of
    // life. What that missed is *when* strays arrive. They are not spread
    // evenly — across a 38-minute capture six of seven landed 1.5-3.9s after a
    // `Stop`, the seventh closed a compaction window, and two idle stretches of
    // 474s and 246s held none. So a stray never lands inside the fifteen
    // seconds `DONE` is on screen and never costs a payoff; what it does is
    // push **every** payoff back by its own delay after the `Stop`.
    //
    // That same clustering is why dropping the refresh is safe. A session with
    // nothing happening emits no strays, so none of this can age a live session
    // towards `ASLEEP` or eviction — the events being ignored only ever arrive
    // moments after a real one that refreshed the clock properly.
    if (event.agentType === undefined) return session;
    return { ...seen, subagents: Math.max(0, seen.subagents + delta) };
  }
  return { ...seen, ...TRANSITIONS.get(event.kind)?.(event, now) };
}

/**
 * What the panel should think this session is, at `now`.
 *
 * Both promotions apply to `IDLE` only, and that is the load-bearing part. A
 * session that was mid-`WORKING` when the events stopped is either running a
 * long `Bash` or dead, and the daemon cannot tell which — so it keeps showing
 * the work and lets eviction settle it. Falling asleep during a ten-minute
 * test suite would be the more visible wrong answer of the two.
 *
 * `WAITING` is checked before `ASLEEP` because a question asked five minutes
 * ago needs a human more than one asked five seconds ago, not less.
 */
export function effectiveState(session: Session, now: number): SessionState {
  if (session.state !== 'IDLE') return session.state;
  if (
    session.notifiedAt !== undefined &&
    now - session.notifiedAt >= WAITING_AFTER_MS
  ) {
    return 'WAITING';
  }
  // The payoff window: **two bounds, not one.** A single `>=` would hold from
  // 45s all the way to the five-minute sleep, which is a resting screen and not
  // a payoff. Crossing the upper bound is the expiry, so there is no stored
  // timer and nothing to tidy up.
  //
  // **It can re-arm, and that is the behaviour rather than a leak.** Any event
  // refreshes `lastEventAt`, so a session that goes quiet again after a
  // `PostToolUse` or a `SubagentStop` gets another window off the same
  // `workedAt`. An earlier version of this comment claimed a repeat "cannot
  // re-trigger, because there is no trigger" — the arithmetic is on the one
  // field every event resets. Only `UserPromptSubmit` and `SessionStart` spend
  // it, which is right: asking for something new is what acknowledges the last
  // thing, and either way the payoff needs a fresh quiet period to appear.
  if (session.workedAt !== undefined) {
    const quiet = now - session.lastEventAt;
    if (quiet >= DONE_AFTER_MS && quiet < DONE_AFTER_MS + DONE_SHOWN_MS) {
      return 'DONE';
    }
  }
  if (now - session.lastEventAt >= ASLEEP_AFTER_MS) return 'ASLEEP';
  return 'IDLE';
}

/** Whether a session has been heard from recently enough to still exist. */
export function isLive(session: Session, now: number): boolean {
  if (session.endedAt !== undefined) return false;
  return now - session.lastEventAt < EVICT_AFTER_MS;
}
