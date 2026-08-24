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

import { ASLEEP_AFTER_MS, EVICT_AFTER_MS, WAITING_AFTER_MS } from './state.js';

/**
 * A session as the daemon tracks it. Spec §3's record, with two of its fields
 * missing and two added.
 *
 * `origin` (local, or the host a remote session came from) is knowledge the
 * transport that accepted the event has and the event itself does not, so it
 * belongs with whatever accepts the connection. A field this module could
 * never fill would be worse than its absence. `oneshotUntil` goes with the
 * tier it exists for — see `STATE_RANK`.
 *
 * `errorType` and `notifiedAt` are the additions: both carry information that
 * arrives on exactly one event and is unrecoverable afterwards.
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
   * Nothing reads it yet. `resolve.ts` returns whole `Session` objects, so it
   * does cross that boundary — but the quip is keyed on the state alone and
   * `FAILED` shows `dizzy` for all three of them. One state,
   * one picture, which is the split this module and `animation.ts` are built
   * on. Storing it keeps the option of a rate-limit screen open; it does not
   * mean one exists.
   */
  readonly errorType?: string;
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
 * the live documentation says it fires on *every* response. What it does prove
 * is that this session is not doing anything at this instant, which is exactly
 * `IDLE`. Note it deliberately does not clear `notifiedAt`: Claude Code asks
 * for input and finishes responding at nearly the same moment, and a `Stop`
 * that wiped the notification would lose the wait depending on which of the
 * two arrived first.
 */
const TRANSITIONS: ReadonlyMap<string, Transition> = new Map<
  string,
  Transition
>([
  ['SessionStart', () => ({ ...RESUMED, state: 'IDLE' })],
  ['UserPromptSubmit', () => ({ ...RESUMED, state: 'THINKING' })],
  [
    'PreToolUse',
    (event) => ({ ...RESUMED, state: 'WORKING', tool: event.tool }),
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
 * A count rather than a set of `agent_id`s. A set would make an unmatched stop
 * exactly free instead of merely cheap, but `agent_id` is optional on the wire
 * and would need the counter back as a fallback, which is two mechanisms for
 * one badge. The cost of getting it wrong is one digit in the status bar until
 * the next start, and the floor below is what stops it going negative.
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
  if (now - session.lastEventAt >= ASLEEP_AFTER_MS) return 'ASLEEP';
  return 'IDLE';
}

/** Whether a session has been heard from recently enough to still exist. */
export function isLive(session: Session, now: number): boolean {
  if (session.endedAt !== undefined) return false;
  return now - session.lastEventAt < EVICT_AFTER_MS;
}
