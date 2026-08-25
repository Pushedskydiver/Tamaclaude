import type { HookEvent } from '@tamaclaude/protocol';

import { describe, expect, it } from 'vitest';

import {
  createRegistry,
  evictStale,
  liveSessions,
  observe,
} from './registry.js';
import { ASLEEP_AFTER_MS, EVICT_AFTER_MS } from './state.js';

const T0 = 1_000_000;
const MINUTE = 60_000;

function event(
  sessionId: string,
  kind: string,
  extra: Partial<HookEvent> = {},
): HookEvent {
  return { sessionId, kind, ...extra };
}

describe('observe', () => {
  it('creates a session from whatever event it hears first', () => {
    // The daemon can be restarted while Claude Code is mid-turn, so the first
    // event for an id is routinely not a `SessionStart`.
    const registry = observe(
      createRegistry(T0),
      event('s1', 'PreToolUse', { tool: 'Bash' }),
      T0 + 1000,
    );
    const session = registry.sessions.get('s1');
    expect(session?.state).toBe('WORKING');
    expect(session?.startedAt).toBe(T0 + 1000);
  });

  it('returns a new registry rather than editing the old one', () => {
    const before = createRegistry(T0);
    const after = observe(before, event('s1', 'Stop'), T0 + 1000);
    expect(before.sessions.size).toBe(0);
    expect(after.sessions.size).toBe(1);
    expect(after.lastEventAt).toBe(T0 + 1000);
  });

  it('tracks sessions independently', () => {
    const registry = [
      event('s1', 'PreToolUse', { tool: 'Bash' }),
      event('s2', 'UserPromptSubmit'),
      // A real dispatch carries `agentType`; without it the count deliberately
      // does not move. See `SUBAGENT_DELTA` in `session.ts`.
      event('s1', 'SubagentStart', { agentType: 'Explore' }),
    ].reduce((acc, next) => observe(acc, next, T0), createRegistry(T0));

    expect(registry.sessions.get('s1')?.subagents).toBe(1);
    expect(registry.sessions.get('s1')?.state).toBe('WORKING');
    expect(registry.sessions.get('s2')?.subagents).toBe(0);
    expect(registry.sessions.get('s2')?.state).toBe('THINKING');
  });

  it('lets a stray stop create a session without putting a count on it', () => {
    // Giving the test above an `agentType` moved what it covers, and this is
    // the case it left behind: an untyped `SubagentStop` is machinery rather
    // than a dispatch — `SUBAGENT_DELTA` in `session.ts` has the capture — so
    // it must not move the badge. It does still create the session, because
    // `observe` creates one for any event and the daemon can start mid-session.
    //
    // That is the honest reading rather than a happy one: a stray puts a chip
    // on the strip for a session nobody is using, and it stays for the ten
    // minutes of `EVICT_AFTER_MS`. Asserted here so the behaviour is chosen
    // rather than merely current.
    //
    // It sits at an angle to `applyEvent`, which no longer lets a stray refresh
    // `lastEventAt` on a session that already exists. Not a contradiction: a
    // stray is proof a session *id* exists, which is why `observe` mints one,
    // and not proof that session is doing anything, which is why the clock does
    // not move afterwards. Worth stating because the two files read as if they
    // disagree, and because `registry.ts` also folds a stray into the
    // registry-level `lastEventAt` that `resolve.ts` reads for the empty desk.
    const registry = observe(
      createRegistry(T0),
      event('stray', 'SubagentStop'),
      T0,
    );
    expect(registry.sessions.get('stray')?.subagents).toBe(0);
    expect(registry.sessions.has('stray')).toBe(true);

    // The two assertions above are characterisation and cannot fail — the
    // floor reaches zero from an empty registry with or without the gate. This
    // one is the guard: a stray arriving at a session that really is running a
    // subagent must leave the count alone, which is the whole defect, observed
    // here through `observe` rather than `applyEvent`.
    const running = observe(
      createRegistry(T0),
      event('a', 'SubagentStart', { agentType: 'Explore' }),
      T0,
    );
    const strayed = observe(running, event('a', 'SubagentStop'), T0 + 1000);
    expect(strayed.sessions.get('a')?.subagents).toBe(1);
  });

  it('survives a subagent stop for a session it has already evicted', () => {
    // The subagent outlived the ten minutes of silence that removed its
    // parent. The stop recreates the session — it is proof something is alive
    // — and the count floors at zero instead of going negative.
    const evicted = createRegistry(T0);
    const registry = observe(
      evicted,
      event('gone', 'SubagentStop', { agentType: 'Explore' }),
      T0,
    );
    expect(registry.sessions.get('gone')?.subagents).toBe(0);
  });
});

describe('evictStale', () => {
  const registry = observe(createRegistry(T0), event('s1', 'Stop'), T0);

  it('keeps a session until exactly ten minutes of silence', () => {
    expect(evictStale(registry, T0 + EVICT_AFTER_MS - 1).sessions.size).toBe(1);
    expect(evictStale(registry, T0 + EVICT_AFTER_MS).sessions.size).toBe(0);
  });

  it('remembers when the house last made a noise', () => {
    // Otherwise an empty registry cannot tell a fresh daemon from a deserted
    // one, and the panel walks idle -> asleep -> idle as the last session ages
    // out from under it.
    const emptied = evictStale(registry, T0 + EVICT_AFTER_MS);
    expect(emptied.lastEventAt).toBe(T0);
  });

  it('drops only the silent ones', () => {
    const busy = observe(registry, event('s2', 'PostToolUse'), T0 + 9 * MINUTE);
    const evicted = evictStale(busy, T0 + 10 * MINUTE);
    expect([...evicted.sessions.keys()]).toEqual(['s2']);
  });
});

describe('liveSessions', () => {
  it('hides an evicted session before the caller ever evicts it', () => {
    // `resolve` reads through this, so a daemon that forgets to prune on a
    // tick still cannot put a dead session on the stage.
    const registry = observe(createRegistry(T0), event('s1', 'Stop'), T0);
    expect(liveSessions(registry, T0 + ASLEEP_AFTER_MS)).toHaveLength(1);
    expect(liveSessions(registry, T0 + EVICT_AFTER_MS)).toHaveLength(0);
  });
});

describe('cardinality', () => {
  const fill = (count: number, at = 1_000) =>
    Array.from({ length: count }, (_, index) => `s${String(index)}`).reduce(
      (registry, id) =>
        observe(registry, { sessionId: id, kind: 'SessionStart' }, at),
      createRegistry(0),
    );

  it('holds exactly the cap, not merely at most it', () => {
    // `toBeLessThanOrEqual(64)` was the original assertion and it passed for a
    // cap of one — which would have destroyed multi-session compositing while
    // staying green. The number is the point, so the number is asserted.
    expect(fill(500).sessions.size).toBe(64);
  });

  it('keeps every session when there is room', () => {
    // The other half of pinning the cap: it must not bite early.
    expect(fill(64).sessions.size).toBe(64);
    expect(fill(63).sessions.size).toBe(63);
  });

  it('keeps the newest sessions when the cap bites', () => {
    const filled = fill(100);
    expect(filled.sessions.has('s99')).toBe(true);
    expect(filled.sessions.has('s0')).toBe(false);
  });

  it('does not evict anyone when an existing session is updated at the cap', () => {
    // The bug this catches: entries were appended to an array and *then*
    // trimmed, so an update spent a slot on its own duplicate key. The cap was
    // really 63, and an ordinary PostToolUse about one session silently
    // dropped an unrelated live one.
    const filled = fill(64);
    const updated = observe(
      filled,
      { sessionId: 's63', kind: 'PostToolUse', tool: 'Read' },
      2_000,
    );
    expect(updated.sessions.size).toBe(64);
    expect(updated.sessions.has('s0')).toBe(true);
  });

  it('evicts the quietest session, not the first one seen', () => {
    // Eviction by first sight would hand a flooder the strip: every minted
    // session is new, so the real long-running one is first in line to die.
    const filled = fill(64);
    const busy = observe(
      filled,
      { sessionId: 's0', kind: 'PostToolUse', tool: 'Read' },
      9_000,
    );
    const overflowed = observe(
      busy,
      { sessionId: 'new', kind: 'SessionStart' },
      9_100,
    );
    expect(overflowed.sessions.size).toBe(64);
    expect(overflowed.sessions.has('s0')).toBe(true);
    expect(overflowed.sessions.has('s1')).toBe(false);
  });
});

describe('what the cap does not protect', () => {
  it('lets a flood evict a real session that is merely between events', () => {
    // Pinned deliberately, because the comment on `withoutQuietest` used to
    // claim the opposite. Eviction reads `lastEventAt` and nothing else, so a
    // real session that has merely gone quiet for thirty seconds is older than
    // every freshly minted id and goes first — its state does not come into it.
    // (An earlier version of this comment said the session was in `WAITING`. It
    // is in `THINKING`: `UserPromptSubmit` maps there, and `WAITING` needs a
    // `Notification` plus `WAITING_AFTER_MS`, which is 60 s against this 30 s
    // gap. The ordering the test pins was right; the example was not.)
    // The cap bounds memory; it does not defend the display, and the 0600
    // socket is what does.
    const real = observe(
      createRegistry(0),
      { sessionId: 'real', kind: 'UserPromptSubmit' },
      1_000_000,
    );
    const flooded = Array.from({ length: 64 }, (_, index) => index).reduce(
      (registry, index) =>
        observe(
          registry,
          { sessionId: `mint${String(index)}`, kind: 'SessionStart' },
          1_030_000,
        ),
      real,
    );
    expect(flooded.sessions.size).toBe(64);
    expect(flooded.sessions.has('real')).toBe(false);
  });
});
