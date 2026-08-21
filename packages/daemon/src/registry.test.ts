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
      event('s1', 'SubagentStart'),
    ].reduce((acc, next) => observe(acc, next, T0), createRegistry(T0));

    expect(registry.sessions.get('s1')?.subagents).toBe(1);
    expect(registry.sessions.get('s1')?.state).toBe('WORKING');
    expect(registry.sessions.get('s2')?.subagents).toBe(0);
    expect(registry.sessions.get('s2')?.state).toBe('THINKING');
  });

  it('survives a subagent stop for a session it has already evicted', () => {
    // The subagent outlived the ten minutes of silence that removed its
    // parent. The stop recreates the session — it is proof something is alive
    // — and the count floors at zero instead of going negative.
    const evicted = createRegistry(T0);
    const registry = observe(evicted, event('gone', 'SubagentStop'), T0);
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
