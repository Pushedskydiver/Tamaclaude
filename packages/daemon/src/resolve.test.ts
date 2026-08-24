import type { SessionRegistry } from './registry.js';
import type { HookEvent } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import { animationFor } from './animation.js';
import { createRegistry, observe } from './registry.js';
import { resolvePanel } from './resolve.js';
import {
  ASLEEP_AFTER_MS,
  DONE_AFTER_MS,
  EVICT_AFTER_MS,
  needsAttention,
  SESSION_STATES,
  WAITING_AFTER_MS,
} from './state.js';

const T0 = 1_000_000;
const MINUTE = 60_000;

type Beat = {
  readonly at: number;
  readonly sessionId: string;
  readonly kind: string;
  readonly tool?: string;
};

/** Play a script of events, each at its own instant. */
function play(beats: readonly Beat[]): SessionRegistry {
  return beats.reduce<SessionRegistry>((registry, beat) => {
    const event: HookEvent = {
      sessionId: beat.sessionId,
      kind: beat.kind,
      ...(beat.tool === undefined ? {} : { tool: beat.tool }),
    };
    return observe(registry, event, beat.at);
  }, createRegistry(T0));
}

const ids = (registry: SessionRegistry, now: number) =>
  resolvePanel(registry, now).sessions.map((session) => session.id);

describe('an empty desk', () => {
  it('is idle when the daemon has only just started', () => {
    expect(resolvePanel(createRegistry(T0), T0).state).toBe('IDLE');
    expect(resolvePanel(createRegistry(T0), T0).sessions).toEqual([]);
  });

  it('falls asleep five minutes after the last thing that happened', () => {
    const registry = createRegistry(T0);
    expect(resolvePanel(registry, T0 + ASLEEP_AFTER_MS - 1).state).toBe('IDLE');
    expect(resolvePanel(registry, T0 + ASLEEP_AFTER_MS).state).toBe('ASLEEP');
  });

  it('stays asleep once the last session is evicted, rather than waking', () => {
    // The bug this pins: eviction at ten minutes empties the registry, and an
    // empty registry that forgot its history would report `IDLE` — so the
    // panel would go idle, asleep, then idle again with nobody at the desk.
    const registry = play([{ at: T0, sessionId: 's1', kind: 'Stop' }]);
    expect(resolvePanel(registry, T0 + EVICT_AFTER_MS).sessions).toEqual([]);
    expect(resolvePanel(registry, T0 + EVICT_AFTER_MS).state).toBe('ASLEEP');
  });
});

describe('three sessions working at once', () => {
  const registry = play([
    { at: T0, sessionId: 's1', kind: 'PreToolUse', tool: 'Bash' },
    { at: T0 + 1000, sessionId: 's2', kind: 'PreToolUse', tool: 'Read' },
    { at: T0 + 2000, sessionId: 's3', kind: 'PreToolUse', tool: 'Edit' },
  ]);
  const now = T0 + 3000;

  it('gives the stage to the most recently active', () => {
    expect(resolvePanel(registry, now).state).toBe('WORKING');
    expect(ids(registry, now)).toEqual(['s3', 's2', 's1']);
    expect(
      animationFor(resolvePanel(registry, now).state, {
        tool: resolvePanel(registry, now).tool,
      }),
    ).toBe('typing');
  });

  it('hands it over when a quieter session is the one that needs you', () => {
    // The governing principle, in one assertion: `s1` is the least active
    // thing on the machine and takes the stage anyway, because it is the only
    // one costing a human time by going unseen.
    const asking = observe(
      registry,
      { sessionId: 's1', kind: 'PermissionRequest' },
      now,
    );
    expect(resolvePanel(asking, now).state).toBe('NEEDS_PERMISSION');
    expect(ids(asking, now)).toEqual(['s1', 's3', 's2']);
  });

  it('moves on when the hero vanishes mid-work', () => {
    // No goodbye event: `s3` simply stops existing. Ten minutes of silence is
    // what removes it, and the stage falls to whoever is still there.
    const kept = observe(
      registry,
      { sessionId: 's2', kind: 'PostToolUse' },
      T0 + 9 * MINUTE,
    );
    const later = T0 + 11 * MINUTE;
    expect(ids(kept, later)).toEqual(['s2']);
    expect(resolvePanel(kept, later).state).toBe('WORKING');
  });
});

describe('two sessions both needing you', () => {
  it('gives the stage to the one that has been waiting longest', () => {
    // Oldest wins inside "needs you", and only inside it: an eight-minute-old
    // prompt is costing more than one raised ten seconds ago.
    const registry = play([
      { at: T0, sessionId: 'old', kind: 'SessionStart' },
      { at: T0 + 5 * MINUTE, sessionId: 'new', kind: 'SessionStart' },
      { at: T0 + 6 * MINUTE, sessionId: 'old', kind: 'PermissionRequest' },
      { at: T0 + 7 * MINUTE, sessionId: 'new', kind: 'StopFailure' },
    ]);
    // `new` is the more recent event by a minute, and still loses.
    expect(ids(registry, T0 + 7 * MINUTE)).toEqual(['old', 'new']);
  });

  it('outranks a session that is merely working', () => {
    const registry = play([
      { at: T0, sessionId: 'busy', kind: 'PreToolUse', tool: 'Bash' },
      { at: T0 + 1000, sessionId: 'stuck', kind: 'Stop' },
      { at: T0 + 2000, sessionId: 'stuck', kind: 'Notification' },
    ]);
    const asked = T0 + 2000 + WAITING_AFTER_MS;
    // Before the sixty seconds are up, `stuck` is just an idle session.
    expect(ids(registry, asked - 1)).toEqual(['busy', 'stuck']);
    expect(ids(registry, asked)).toEqual(['stuck', 'busy']);
    expect(resolvePanel(registry, asked).state).toBe('WAITING');
  });
});

describe('order under disorder', () => {
  it('is the same whichever order the daemon heard about them', () => {
    // Three sessions changing state in the same tick share a timestamp to the
    // millisecond. Without the final tie-break the winner would be whichever
    // one the socket happened to deliver first.
    const forwards = play([
      { at: T0, sessionId: 'a', kind: 'PreToolUse', tool: 'Bash' },
      { at: T0, sessionId: 'b', kind: 'PreToolUse', tool: 'Read' },
      { at: T0, sessionId: 'c', kind: 'PreToolUse', tool: 'Edit' },
    ]);
    const backwards = play([
      { at: T0, sessionId: 'c', kind: 'PreToolUse', tool: 'Edit' },
      { at: T0, sessionId: 'b', kind: 'PreToolUse', tool: 'Read' },
      { at: T0, sessionId: 'a', kind: 'PreToolUse', tool: 'Bash' },
    ]);
    expect(ids(forwards, T0)).toEqual(ids(backwards, T0));
  });

  it('is not disturbed by an event that arrives late', () => {
    const registry = play([
      { at: T0, sessionId: 'a', kind: 'PreToolUse', tool: 'Bash' },
      { at: T0 + 5000, sessionId: 'b', kind: 'PreToolUse', tool: 'Read' },
      // `a`'s hook was slow to reach the socket and lands out of order.
      { at: T0 + 1000, sessionId: 'a', kind: 'PostToolUse' },
    ]);
    expect(ids(registry, T0 + 6000)).toEqual(['b', 'a']);
  });

  it('sorts a mixed desk by need, not by noise', () => {
    const registry = play([
      { at: T0, sessionId: 'asking', kind: 'PermissionRequest' },
      { at: T0 + 1000, sessionId: 'thinking', kind: 'UserPromptSubmit' },
      { at: T0 + 2000, sessionId: 'working', kind: 'PreToolUse', tool: 'Bash' },
      { at: T0 + 3000, sessionId: 'resting', kind: 'Stop' },
    ]);
    expect(ids(registry, T0 + 4000)).toEqual([
      'asking',
      'working',
      'thinking',
      'resting',
    ]);
  });

  it('sinks a sleeping session below a merely idle one', () => {
    const registry = play([
      { at: T0, sessionId: 'sleeper', kind: 'Stop' },
      { at: T0 + ASLEEP_AFTER_MS, sessionId: 'awake', kind: 'Stop' },
    ]);
    expect(ids(registry, T0 + ASLEEP_AFTER_MS)).toEqual(['awake', 'sleeper']);
    expect(resolvePanel(registry, T0 + ASLEEP_AFTER_MS).state).toBe('IDLE');
  });
});

describe('the payoff against other sessions', () => {
  it('never takes the stage from a session that is still working', () => {
    // The defect this pins was live: `DONE` ranked above `WORKING` while
    // borrowing the `idle` art, so a finished session put a Clawd doing
    // nothing on the panel for fifteen seconds while another ran a tool —
    // which is exactly what `animation.ts` forbids, and what the rank's own
    // comment had cited as its justification. Ranks alone would not have
    // caught it; this asserts the thing the viewer sees.
    let registry = createRegistry(T0);
    for (const event of [
      { sessionId: 'busy', kind: 'PreToolUse', tool: 'Bash' },
      { sessionId: 'finished', kind: 'PreToolUse', tool: 'Bash' },
    ] satisfies HookEvent[]) {
      registry = observe(registry, event, T0);
    }
    registry = observe(registry, { sessionId: 'finished', kind: 'Stop' }, T0);
    const panel = resolvePanel(registry, T0 + DONE_AFTER_MS);
    expect(panel.state).toBe('WORKING');
    expect(animationFor(panel.state, { tool: panel.tool })).toBe('gym');
  });

  it('does take the stage from a resting one', () => {
    let registry = createRegistry(T0);
    registry = observe(
      registry,
      { sessionId: 'finished', kind: 'PreToolUse', tool: 'Bash' },
      T0,
    );
    registry = observe(registry, { sessionId: 'finished', kind: 'Stop' }, T0);
    registry = observe(registry, { sessionId: 'resting', kind: 'Stop' }, T0);
    expect(resolvePanel(registry, T0 + DONE_AFTER_MS).state).toBe('DONE');
  });
});

describe('needsAttention', () => {
  it('is exactly the three states that ask for a human', () => {
    // Pinned by extension rather than by rank, because the whole point of the
    // predicate is that callers stop knowing the rank.
    //
    // What forces a *new* state to be considered is not this test — a new
    // non-attention state leaves `asking` unchanged and this stays green. It
    // is `STATE_RANK` being a total `Record<SessionState, number>`, which
    // fails `tsc` until the state is ranked. This pins the extension so that
    // ranking it into the attention tier is a visible change rather than a
    // silent one; an earlier version of this comment credited the test with
    // the type system's work.
    const asking = SESSION_STATES.filter((state) => needsAttention(state));
    expect([...asking]).toEqual(['NEEDS_PERMISSION', 'FAILED', 'WAITING']);
  });

  it('does not include DONE, which loses to work rather than winning over it', () => {
    // `DONE` is the state most easily mistaken for an attention state: it is a
    // payoff, so it feels like it should seize the screen. It does not — it
    // ranks below `WORKING` and `THINKING` deliberately. A birthday quip may
    // cover it; a blocked session it may not.
    expect(needsAttention('DONE')).toBe(false);
    expect(needsAttention('WORKING')).toBe(false);
    expect(needsAttention('IDLE')).toBe(false);
  });
});
