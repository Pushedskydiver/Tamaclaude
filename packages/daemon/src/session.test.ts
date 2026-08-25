import type { HookEvent } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import { HANDLED_HOOK_EVENTS } from '@tamaclaude/protocol';

import {
  applyEvent,
  effectiveState,
  HANDLED_KINDS,
  isLive,
  newSession,
} from './session.js';
import {
  ASLEEP_AFTER_MS,
  DONE_AFTER_MS,
  DONE_SHOWN_MS,
  EVICT_AFTER_MS,
  WAITING_AFTER_MS,
} from './state.js';

/** t=0 is the session's first sight; every test counts from there. */
const T0 = 1_000_000;

const start = newSession('s1', T0);

function event(kind: string, extra: Partial<HookEvent> = {}): HookEvent {
  return { sessionId: 's1', kind, ...extra };
}

/** Fold a list of events in at one instant, which is the same-tick case. */
function foldAt(
  kinds: readonly string[],
  now: number,
  extra: Partial<HookEvent> = {},
) {
  return kinds.reduce(
    (session, kind) => applyEvent(session, event(kind, extra), now),
    start,
  );
}

/**
 * What a real dispatched subagent carries. Both spawn paths send a non-empty
 * `agent_type` — see `SUBAGENT_DELTA` — and without it the count deliberately
 * does not move, so a subagent test that omits it is testing the stray path.
 */
const DISPATCHED = { agentType: 'Explore' } as const;

describe('the payoff window', () => {
  it('shows DONE once a session that did work has been quiet long enough', () => {
    // The screen `BUILD_PLAN.md` item 6 calls the payoff. Its trigger cannot be
    // `Stop` — that fires on every response, confirmed against live
    // documentation in Stage 3 and then on real events, nine times in one
    // session across three hours. So it is a quiet period the daemon times
    // rather than an event it receives, which is what `state.ts` has been
    // holding tier 1 open for.
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const idle = applyEvent(worked, event('Stop'), T0);
    expect(effectiveState(idle, T0 + DONE_AFTER_MS)).toBe('DONE');
  });

  it('closes the window again, so the payoff is a beat and not a screen', () => {
    // Two bounds, not one. A single `>=` would hold from 45s to the
    // five-minute sleep, which is a resting screen — and `idle` is already
    // that. Crossing the upper bound *is* the expiry, which is why no timer is
    // stored anywhere and nothing has to be tidied up.
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const idle = applyEvent(worked, event('Stop'), T0);
    const at = (ms: number) => effectiveState(idle, T0 + ms);
    expect(at(DONE_AFTER_MS - 1)).toBe('IDLE');
    expect(at(DONE_AFTER_MS + DONE_SHOWN_MS - 1)).toBe('DONE');
    expect(at(DONE_AFTER_MS + DONE_SHOWN_MS)).toBe('IDLE');
  });

  it('hands straight over to WAITING, with no gap and no overlap', () => {
    // `DONE_AFTER_MS + DONE_SHOWN_MS === WAITING_AFTER_MS` is chosen, not
    // coincidence: the payoff ends exactly as Clawd starts staring at you. If
    // someone moves one threshold without the other this test says so, because
    // a gap here is a second where the panel goes quiet mid-sequence.
    expect(DONE_AFTER_MS + DONE_SHOWN_MS).toBe(WAITING_AFTER_MS);
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const notified = applyEvent(worked, event('Notification'), T0);
    const idle = applyEvent(notified, event('Stop'), T0);
    expect(effectiveState(idle, T0 + WAITING_AFTER_MS - 1)).toBe('DONE');
    expect(effectiveState(idle, T0 + WAITING_AFTER_MS)).toBe('WAITING');
  });

  it('is truncated by a notification that is not the last event', () => {
    // The two windows have different anchors: this one runs from
    // `lastEventAt`, `WAITING` from `notifiedAt`, and `WAITING` is checked
    // first. So "no gap and no overlap" holds only when they coincide — which
    // is the one case the test above builds. Here the notification lands five
    // seconds before the work ends, and the payoff loses those five seconds.
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const notified = applyEvent(worked, event('Notification'), T0);
    const idle = applyEvent(notified, event('Stop'), T0 + 5_000);
    const at = (ms: number) => effectiveState(idle, T0 + ms);
    expect(at(5_000 + DONE_AFTER_MS)).toBe('DONE');
    expect(at(WAITING_AFTER_MS)).toBe('WAITING');
  });

  it('re-arms after another event, because the clock is lastEventAt', () => {
    // Not a leak, and worth pinning because a comment once claimed the
    // opposite. Any event refreshes `lastEventAt`, so a session that goes
    // quiet again gets another window off the same `workedAt` — only
    // `UserPromptSubmit` and `SessionStart` spend it.
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const idle = applyEvent(worked, event('Stop'), T0);
    expect(effectiveState(idle, T0 + DONE_AFTER_MS)).toBe('DONE');
    const alive = applyEvent(idle, event('PostToolUse'), T0 + 90_000);
    expect(effectiveState(alive, T0 + 90_000 + DONE_AFTER_MS)).toBe('DONE');
  });

  it('spends the payoff on SessionStart, so a clear does not celebrate', () => {
    // `SessionStart` fires on startup, resume, clear and compact. In three of
    // those four the work it would celebrate belongs to a session the user has
    // walked away from.
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const cleared = applyEvent(worked, event('SessionStart'), T0 + 10_000);
    expect(effectiveState(cleared, T0 + 10_000 + DONE_AFTER_MS)).toBe('IDLE');
  });

  it('needs work done since the last prompt, not merely a reply', () => {
    // The distinction the whole field exists for. `Stop` fires on every
    // response, so a session that only answered a question must not get the
    // payoff — that is the defect the trigger replaces, not a variant of it.
    const replied = applyEvent(
      applyEvent(start, event('UserPromptSubmit'), T0),
      event('Stop'),
      T0,
    );
    expect(effectiveState(replied, T0 + DONE_AFTER_MS)).toBe('IDLE');
  });

  it('spends the payoff, so a new prompt has to earn the next one', () => {
    const worked = applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0);
    const asked = applyEvent(worked, event('UserPromptSubmit'), T0);
    const idle = applyEvent(asked, event('Stop'), T0);
    expect(effectiveState(idle, T0 + DONE_AFTER_MS)).toBe('IDLE');
  });
});

describe('applyEvent', () => {
  it('takes the state from the last meaningful event', () => {
    expect(applyEvent(start, event('UserPromptSubmit'), T0).state).toBe(
      'THINKING',
    );
    expect(
      applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0).state,
    ).toBe('WORKING');
    expect(applyEvent(start, event('PermissionRequest'), T0).state).toBe(
      'NEEDS_PERMISSION',
    );
    expect(applyEvent(start, event('StopFailure'), T0).state).toBe('FAILED');
  });

  it('reads Stop as idle, because it fires on every response', () => {
    // The spec keyed the payoff screen on `Stop`. The live documentation
    // says it fires on every response, so all it actually proves is that this
    // session is doing nothing at this instant.
    const working = applyEvent(
      start,
      event('PreToolUse', { tool: 'Bash' }),
      T0,
    );
    const stopped = applyEvent(working, event('Stop'), T0 + 1);
    expect(stopped.state).toBe('IDLE');
    expect(stopped.tool).toBeUndefined();
  });

  it('keeps the error type, which arrives once and picks the quip', () => {
    const failed = applyEvent(
      start,
      event('StopFailure', { errorType: 'rate_limit' }),
      T0,
    );
    expect(failed.errorType).toBe('rate_limit');
    // Cleared by the next thing that proves the session moved on.
    expect(
      applyEvent(failed, event('UserPromptSubmit'), T0 + 1).errorType,
    ).toBeUndefined();
  });

  it('treats an unknown event as proof of life and nothing more', () => {
    // `PostToolUse` fires between every two calls of a chain. Clearing
    // `WORKING` on it would flick the panel back to idle in the gaps, and a
    // hook Claude Code adds next month must not change any state at all.
    const working = applyEvent(
      start,
      event('PreToolUse', { tool: 'Read' }),
      T0,
    );
    const later = applyEvent(working, event('PostToolUse'), T0 + 5000);
    expect(later.state).toBe('WORKING');
    expect(later.tool).toBe('Read');
    expect(later.lastEventAt).toBe(T0 + 5000);

    expect(
      applyEvent(later, event('SomethingInventedIn2027'), T0 + 6000).state,
    ).toBe('WORKING');
  });

  it('never rewinds proof of life when an event arrives late', () => {
    // A delayed socket write, or a remote host whose clock runs slow. Taking
    // `now` unconditionally would age a live session towards sleep.
    const fresh = applyEvent(start, event('PostToolUse'), T0 + 10_000);
    const stale = applyEvent(fresh, event('PostToolUse'), T0 + 2000);
    expect(stale.lastEventAt).toBe(T0 + 10_000);
  });
});

describe('subagents', () => {
  it('counts nested starts and unwinds them', () => {
    const two = foldAt(['SubagentStart', 'SubagentStart'], T0, DISPATCHED);
    expect(two.subagents).toBe(2);
    expect(
      applyEvent(two, event('SubagentStop', DISPATCHED), T0).subagents,
    ).toBe(1);
    expect(
      foldAt(
        ['SubagentStart', 'SubagentStart', 'SubagentStop', 'SubagentStop'],
        T0,
        DISPATCHED,
      ).subagents,
    ).toBe(0);
  });

  it('floors a stop with no start at zero rather than going negative', () => {
    // The eviction case: a subagent outlives the ten minutes of silence that
    // removed its session, and its stop lands on a session created fresh by
    // that very event. A negative badge would be the visible symptom.
    expect(
      applyEvent(start, event('SubagentStop', DISPATCHED), T0).subagents,
    ).toBe(0);
  });

  it('ignores a subagent event that carries no agent type', () => {
    // **Unpaired stops are ordinary, not an edge case.** Captured from a
    // listener on the hook socket on 25 Aug, over 38 minutes of one session:
    // ten `SubagentStop`s arrived and seven had no matching `SubagentStart`.
    // Each stray carried a distinct `agent_id` and came from machinery nobody
    // dispatched — one 3.9s after a `Stop`, one 3.0s after
    // `SessionStart(source=compact)`. About one every five minutes.
    //
    // The floor below is not enough on its own. It stops the badge going
    // negative, which is the harmless direction; the damaging one is a stray
    // landing while a real subagent runs, taking a true count of 1 down to 0
    // and blanking the badge with work still in flight. Any run outlasting the
    // gap between strays is exposed — a `da-review` or an `animation-critic`,
    // though not a quick `Explore`.
    //
    // `agent_type` is the discriminator and it costs nothing: `optionalString`
    // in `packages/hooks` maps an empty string to absent, so a stray reaches us
    // as `agentType: undefined` while all three dispatched pairs in the capture
    // carried a non-empty one at both ends — `Agent` sends the agent's own
    // type, `Workflow` sends `workflow-subagent`. Four of the seven strays were
    // observed empty; the other three predate a fix to the capture script's own
    // whitelist and were never observed either way. `SUBAGENT_DELTA` in
    // `session.ts` carries the full account, including what the gate still gets
    // wrong.
    const running = applyEvent(
      start,
      event('SubagentStart', { agentType: 'Explore' }),
      T0,
    );
    expect(running.subagents).toBe(1);
    const stray = applyEvent(running, event('SubagentStop'), T0 + 1000);
    expect(stray.subagents).toBe(1);
    // And ignored for freshness too — it does not claim the session did
    // anything. See the payoff test below for why that second half matters.
    expect(stray.lastEventAt).toBe(T0);
  });

  it('gates starts by the same rule, so pairs stay balanced', () => {
    // Symmetric on purpose. Gating only the stop would let an untyped start
    // inflate the count with nothing able to bring it down, and gating both
    // means a pair untyped at *both* ends is ignored at both — one badge digit,
    // recovered on the next pair.
    //
    // It is not a cure. A pair typed at the start and untyped at the stop still
    // sticks one high until eviction, and symmetry does not reach that; it
    // reaches the all-untyped pair, which stop-only gating would also have left
    // stuck. Neither case was observed. See `SUBAGENT_DELTA` — an earlier
    // version of this comment claimed the gate never drifts, which a review
    // showed to be false.
    expect(foldAt(['SubagentStart', 'SubagentStart'], T0).subagents).toBe(0);
  });

  it('does not let a stray push the payoff window back', () => {
    // Strays are not spread evenly — they follow the end of a turn. Across a
    // 38-minute capture, six of seven landed 1.5-3.9s after a `Stop` and the
    // seventh closed a compaction window; two idle stretches of 474s and 246s
    // contained none at all. So the damage is not a lost payoff, which would
    // need a stray to land in the fifteen seconds `DONE` is on screen and
    // cannot happen at that timing. It is that **every** payoff is late, by
    // however long after the `Stop` the stray arrives.
    //
    // Small — a few seconds on a 45s timer — and the reason to fix it anyway
    // is that `DONE_AFTER_MS` is meant to measure quiet since the session
    // stopped working, and a stray is not the session working.
    //
    // The same shape is why ignoring these for freshness is safe: a session
    // with nothing happening emits no strays, so nothing here can hold one
    // awake or, now, fail to.
    const stopped = applyEvent(start, event('Stop'), T0);
    const worked = applyEvent(
      applyEvent(start, event('PreToolUse', { tool: 'Bash' }), T0 - 1000),
      event('Stop'),
      T0,
    );
    expect(effectiveState(worked, T0 + DONE_AFTER_MS)).toBe('DONE');
    const strayed = applyEvent(worked, event('SubagentStop'), T0 + 2500);
    // Was 'IDLE' before this change: the stray moved the window 2.5s later.
    expect(effectiveState(strayed, T0 + DONE_AFTER_MS)).toBe('DONE');
    expect(stopped.lastEventAt).toBe(T0);
  });

  it('does not disturb the state its parent is in', () => {
    const working = applyEvent(
      start,
      event('PreToolUse', { tool: 'Bash' }),
      T0,
    );
    const spawned = applyEvent(
      working,
      event('SubagentStart', DISPATCHED),
      T0 + 1,
    );
    expect(spawned.state).toBe('WORKING');
    expect(spawned.tool).toBe('Bash');
    expect(spawned.subagents).toBe(1);
  });
});

describe('effectiveState', () => {
  const idle = applyEvent(start, event('Stop'), T0);

  it('sleeps an idle session at exactly five minutes, not before', () => {
    expect(effectiveState(idle, T0 + ASLEEP_AFTER_MS - 1)).toBe('IDLE');
    expect(effectiveState(idle, T0 + ASLEEP_AFTER_MS)).toBe('ASLEEP');
  });

  it('keeps showing the work when a session goes quiet mid-tool', () => {
    // A ten-minute test suite sends one `PreToolUse` and then nothing. The
    // daemon cannot tell that from a crash, so it holds the animation and
    // lets eviction settle it — falling asleep during a long build is the
    // more visible of the two wrong answers.
    const working = applyEvent(
      start,
      event('PreToolUse', { tool: 'Bash' }),
      T0,
    );
    expect(effectiveState(working, T0 + ASLEEP_AFTER_MS * 1.5)).toBe('WORKING');
  });

  it('starts staring sixty seconds after a notification', () => {
    const notified = applyEvent(idle, event('Notification'), T0 + 1000);
    const at = (ms: number) => effectiveState(notified, T0 + 1000 + ms);
    expect(at(WAITING_AFTER_MS - 1)).toBe('IDLE');
    expect(at(WAITING_AFTER_MS)).toBe('WAITING');
  });

  it('keeps waiting rather than falling asleep', () => {
    // A question asked five minutes ago needs a human more than one asked five
    // seconds ago, not less. Eviction is what eventually ends it.
    const notified = applyEvent(idle, event('Notification'), T0);
    expect(effectiveState(notified, T0 + ASLEEP_AFTER_MS)).toBe('WAITING');
  });

  it('cancels the wait when the human answers', () => {
    const notified = applyEvent(idle, event('Notification'), T0);
    const answered = applyEvent(notified, event('UserPromptSubmit'), T0 + 1000);
    expect(effectiveState(answered, T0 + ASLEEP_AFTER_MS)).toBe('THINKING');
  });

  it('leaves a tier-2 state alone however long it sits', () => {
    const asking = applyEvent(start, event('PermissionRequest'), T0);
    expect(effectiveState(asking, T0 + ASLEEP_AFTER_MS)).toBe(
      'NEEDS_PERMISSION',
    );
  });
});

describe('isLive', () => {
  it('evicts at exactly ten minutes of silence, not before', () => {
    expect(isLive(start, T0 + EVICT_AFTER_MS - 1)).toBe(true);
    expect(isLive(start, T0 + EVICT_AFTER_MS)).toBe(false);
  });
});

describe('coverage of the handled events', () => {
  it('handles every event protocol says is handled', () => {
    // The other half of the contract in `HANDLED_HOOK_EVENTS`. The installer
    // test asserts `hooks` registers exactly that list; this asserts the
    // daemon does not silently ignore any of it.
    //
    // Silence is the failure mode that bit: `SessionEnd` had no entry, so it
    // fell through to the default and refreshed the session's proof of life —
    // the event meaning "this is over" postponed the sleep it was registered
    // to trigger, and nothing failed.
    //
    // `PostToolUse` is the one deliberate absence, named rather than excluded
    // quietly: a tool finishing changes nothing but freshness.
    const unhandled = HANDLED_HOOK_EVENTS.filter(
      (kind) => !HANDLED_KINDS.has(kind) && kind !== 'PostToolUse',
    );
    expect(unhandled).toEqual([]);
  });
});
