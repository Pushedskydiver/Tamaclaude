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
 * **Unpaired stops are ordinary.** A second capture on 25 Aug, 13 minutes of
 * one session, logged six `SubagentStop`s against a single `SubagentStart`.
 * The five strays each had a distinct `agent_id` and an empty `agent_type`,
 * and none came from a dispatch — one arrived 3.9s after a `Stop`, one 3.0s
 * after `SessionStart(source=compact)`. Roughly one every two to three
 * minutes.
 *
 * The floor below only stops the badge going negative, which is the harmless
 * direction. The damaging one is a stray landing while a real subagent runs:
 * a true count of 1 goes to 0 and the badge blanks with work still in flight,
 * for every run longer than the gap between strays — which is every
 * `da-review` and `animation-critic`.
 *
 * **Why `agentType` and not `agentId`.** Both are optional on the wire, but
 * `optionalString` in `packages/hooks` maps an empty string to absent, so a
 * stray arrives as `agentType: undefined` for free while a real one never
 * does. `agentId` cannot discriminate: the strays carry one. So this is one
 * mechanism, not the two a set of ids would have needed.
 *
 * **What is verified.** Both spawn paths emit a matched pair carrying
 * `agentId` and `agentType`: the `Agent` tool sends the agent's own type
 * (`Explore`), and `Workflow` sends `workflow-subagent`. That settles the
 * question this comment used to leave open — workflow-spawned subagents are
 * not silent, so the badge does not under-count by half. Still unverified: a
 * subagent spawned by a session tool rather than by either of those.
 *
 * The gate's own failure mode is bounded. If a real event ever arrives without
 * an `agentType`, its pair is ignored at both ends rather than at one, so the
 * badge reads one low and self-heals on the next pair — never drifting, which
 * gating only the stop would have allowed.
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
    // `SUBAGENT_DELTA`. Returning `seen` rather than dropping the event is
    // deliberate: it is still proof of life and must still refresh the clock.
    if (event.agentType === undefined) return seen;
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
