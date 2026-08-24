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
import { ASLEEP_AFTER_MS, EVICT_AFTER_MS, WAITING_AFTER_MS } from './state.js';

/** t=0 is the session's first sight; every test counts from there. */
const T0 = 1_000_000;

const start = newSession('s1', T0);

function event(kind: string, extra: Partial<HookEvent> = {}): HookEvent {
  return { sessionId: 's1', kind, ...extra };
}

/** Fold a list of events in at one instant, which is the same-tick case. */
function foldAt(kinds: readonly string[], now: number) {
  return kinds.reduce(
    (session, kind) => applyEvent(session, event(kind), now),
    start,
  );
}

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
    const two = foldAt(['SubagentStart', 'SubagentStart'], T0);
    expect(two.subagents).toBe(2);
    expect(applyEvent(two, event('SubagentStop'), T0).subagents).toBe(1);
    expect(
      foldAt(
        ['SubagentStart', 'SubagentStart', 'SubagentStop', 'SubagentStop'],
        T0,
      ).subagents,
    ).toBe(0);
  });

  it('floors a stop with no start at zero rather than going negative', () => {
    // The eviction case: a subagent outlives the ten minutes of silence that
    // removed its session, and its stop lands on a session created fresh by
    // that very event. A negative badge would be the visible symptom.
    expect(applyEvent(start, event('SubagentStop'), T0).subagents).toBe(0);
  });

  it('does not disturb the state its parent is in', () => {
    const working = applyEvent(
      start,
      event('PreToolUse', { tool: 'Bash' }),
      T0,
    );
    const spawned = applyEvent(working, event('SubagentStart'), T0 + 1);
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
