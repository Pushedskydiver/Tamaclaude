import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decodeRegistry,
  encodeRegistry,
  loadRegistry,
  saveRegistry,
} from './persistence.js';
import { createRegistry, observe } from './registry.js';
import { resolvePanel } from './resolve.js';
import { ASLEEP_AFTER_MS, EVICT_AFTER_MS } from './state.js';

const NOW = 1_700_000_000_000;

function twoSessions(now: number) {
  const one = observe(
    createRegistry(now),
    { sessionId: 'a', kind: 'PreToolUse', tool: 'Bash' },
    now,
  );
  return observe(one, { sessionId: 'b', kind: 'UserPromptSubmit' }, now + 10);
}

describe('encodeRegistry / decodeRegistry', () => {
  it('carries workedAt across a restart, or the payoff is lost on reload', () => {
    // `workedAt` is what tells "a task finished" from "a reply ended". Dropping
    // it on restart would silently cost every live session its payoff, and the
    // round-trip test below only catches that because it compares whole
    // sessions — a schema that quietly omits a field would otherwise pass.
    const registry = observe(
      createRegistry(NOW),
      { sessionId: 'w', kind: 'PreToolUse', tool: 'Bash' },
      NOW,
    );
    const back = decodeRegistry(encodeRegistry(registry), NOW);
    expect(back?.sessions.get('w')?.workedAt).toBe(NOW);
  });

  it('round-trips a registry through the file format', () => {
    const registry = twoSessions(NOW);
    expect(decodeRegistry(encodeRegistry(registry), NOW + 20)).toEqual(
      registry,
    );
  });

  it('round-trips a session carrying the optional fields an event can set', () => {
    const now = NOW;
    // Not literally every optional field: `Session` has five, and these three
    // events reach `notifiedAt` and `errorType` (plus the non-optional
    // `subagents`). In `TRANSITIONS`, `workedAt` is set only by `PreToolUse`
    // and `endedAt` only by `SessionEnd`, while `tool` is set by `PreToolUse`
    // and `PermissionRequest` — none of which appear here, so those three are
    // never set rather than cleared. `workedAt` has the test above to itself
    // for that reason. The title used to claim all of them.
    //
    // An earlier version of this note said `PostToolUse` sets `tool` and
    // `workedAt` and omitted `PermissionRequest`. `PostToolUse` has no entry in
    // `TRANSITIONS` at all, and the omission mattered: `NEEDS_PERMISSION`
    // legitimately carries a tool, which is why it is one of the two `true`
    // rows in `TOOL_STATES`.
    const withEverything = [
      { sessionId: 'a', kind: 'Notification' },
      { sessionId: 'a', kind: 'SubagentStart', agentType: 'Explore' },
      { sessionId: 'a', kind: 'StopFailure', errorType: 'rate_limit' },
    ].reduce(
      (registry, event) => observe(registry, event, now),
      createRegistry(now),
    );
    expect(decodeRegistry(encodeRegistry(withEverything), now)).toEqual(
      withEverything,
    );
  });

  it('refuses a file it cannot read as state', () => {
    const junk = [
      '',
      'not json',
      '{',
      'null',
      '[]',
      '{"sessions":[]}',
      '"a string"',
    ];
    junk.forEach((raw) => {
      expect(decodeRegistry(raw, NOW)).toBeUndefined();
    });
  });

  it('refuses a version it does not know', () => {
    const raw = JSON.stringify({ version: 99, lastEventAt: NOW, sessions: [] });
    expect(decodeRegistry(raw, NOW)).toBeUndefined();
  });

  it('drops a session whose record is malformed, keeping the file', () => {
    // A hand-edited or half-written file should cost the session it corrupted,
    // not every session in it.
    const registry = decodeRegistry(
      JSON.stringify({
        version: 1,
        lastEventAt: NOW,
        sessions: [
          {
            id: 'good',
            state: 'IDLE',
            startedAt: NOW,
            lastEventAt: NOW,
            subagents: 0,
          },
          {
            id: 'bad',
            state: 'NOT_A_STATE',
            startedAt: NOW,
            lastEventAt: NOW,
            subagents: 0,
          },
          { state: 'IDLE', startedAt: NOW, lastEventAt: NOW, subagents: 0 },
        ],
      }),
      NOW,
    );
    expect([...(registry?.sessions.keys() ?? [])]).toEqual(['good']);
  });

  it('forgets a session that has been silent past the eviction window', () => {
    // The answer to "is stale state worse than none": eviction is time-based
    // and applies to a restored session exactly as it applies to a live one,
    // so an hour-old file restores nothing.
    const registry = twoSessions(NOW);
    const restored = decodeRegistry(
      encodeRegistry(registry),
      NOW + EVICT_AFTER_MS + 10,
    );
    expect(restored?.sessions.size).toBe(0);
  });

  it('keeps the last-event time of a registry whose sessions all aged out', () => {
    // Without this the panel would wake up on restart: an empty registry whose
    // `lastEventAt` is boot time reads as IDLE, and the desk has been quiet for
    // an hour.
    const registry = twoSessions(NOW);
    const later = NOW + EVICT_AFTER_MS + 10;
    const restored = decodeRegistry(encodeRegistry(registry), later);
    expect(restored?.lastEventAt).toBe(NOW + 10);
    expect(resolvePanel(restored ?? createRegistry(later), later).state).toBe(
      'ASLEEP',
    );
  });

  it('restores a session recent enough to still be running', () => {
    const registry = twoSessions(NOW);
    const soon = NOW + 1000;
    const restored = decodeRegistry(encodeRegistry(registry), soon);
    expect(resolvePanel(restored ?? createRegistry(soon), soon)).toMatchObject({
      state: 'WORKING',
      tool: 'Bash',
    });
  });

  it('pulls a timestamp from the future back to now', () => {
    // A clock change or a hand-edited file could otherwise mint an immortal
    // session: `isLive` compares against `lastEventAt`, and a timestamp ahead
    // of now can never age past the window.
    const raw = JSON.stringify({
      version: 1,
      lastEventAt: NOW + EVICT_AFTER_MS,
      sessions: [
        {
          id: 'a',
          state: 'WORKING',
          startedAt: NOW + EVICT_AFTER_MS,
          lastEventAt: NOW + EVICT_AFTER_MS,
          notifiedAt: NOW + EVICT_AFTER_MS,
          subagents: 0,
        },
      ],
    });
    const restored = decodeRegistry(raw, NOW);
    const session = restored?.sessions.get('a');
    expect(restored?.lastEventAt).toBe(NOW);
    expect(session?.startedAt).toBe(NOW);
    expect(session?.lastEventAt).toBe(NOW);
    expect(session?.notifiedAt).toBe(NOW);
  });
});

describe('loadRegistry / saveRegistry', () => {
  let directory = '';
  let path = '';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tc-state-'));
    path = join(directory, 'daemon.state.json');
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('starts empty when there is no file, which is every first run', () => {
    expect(loadRegistry(path, NOW)).toEqual(createRegistry(NOW));
  });

  it('starts empty rather than throwing on a corrupt file', () => {
    writeFileSync(path, '{ this is not json');
    expect(loadRegistry(path, NOW)).toEqual(createRegistry(NOW));
  });

  it('starts empty when the path is a directory', () => {
    expect(loadRegistry(directory, NOW)).toEqual(createRegistry(NOW));
  });

  it('reads back what it wrote', () => {
    const registry = twoSessions(NOW);
    saveRegistry(path, registry);
    expect(loadRegistry(path, NOW + 20)).toEqual(registry);
  });

  it('writes a file only its owner can read', () => {
    // Session ids and tool names are not secrets, but they say what the
    // machine's owner is doing and when, which is nobody else's business.
    saveRegistry(path, twoSessions(NOW));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('leaves no temporary behind', () => {
    saveRegistry(path, twoSessions(NOW));
    saveRegistry(path, twoSessions(NOW + 1000));
    expect(readdirSync(directory)).toEqual(['daemon.state.json']);
  });

  it('replaces a corrupt file with a good one on the next save', () => {
    writeFileSync(path, 'garbage');
    saveRegistry(path, twoSessions(NOW));
    expect(loadRegistry(path, NOW + 20).sessions.size).toBe(2);
  });

  it('creates the directory when it is missing', () => {
    const nested = join(directory, 'made', 'up', 'daemon.state.json');
    saveRegistry(nested, twoSessions(NOW));
    expect(loadRegistry(nested, NOW + 20).sessions.size).toBe(2);
  });

  it('restores what the hero was doing rather than an empty desk', () => {
    // The whole point. Restart the daemon mid-turn and the panel keeps showing
    // the session, instead of going blank until that session's next hook.
    saveRegistry(path, twoSessions(NOW));
    const later = NOW + 1000;
    expect(resolvePanel(loadRegistry(path, later), later)).toMatchObject({
      state: 'WORKING',
      tool: 'Bash',
    });
  });

  it('does not sleep a restored session that was mid-tool', () => {
    // Not an oversight in the restore: `effectiveState` promotes `IDLE` only,
    // because a session that was `WORKING` when the events stopped is either
    // running a long `Bash` or dead, and nothing here can tell which. Eviction
    // settles it. Falling asleep during a ten-minute test suite is the more
    // visible of the two wrong answers.
    saveRegistry(path, twoSessions(NOW));
    const later = NOW + ASLEEP_AFTER_MS + 1;
    expect(resolvePanel(loadRegistry(path, later), later).state).toBe(
      'WORKING',
    );
  });

  it('sleeps a restored session that was idle when the daemon stopped', () => {
    const idle = observe(
      createRegistry(NOW),
      { sessionId: 'a', kind: 'Stop' },
      NOW,
    );
    saveRegistry(path, idle);
    const later = NOW + ASLEEP_AFTER_MS + 1;
    expect(resolvePanel(loadRegistry(path, later), later).state).toBe('ASLEEP');
  });
});
