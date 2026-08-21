/**
 * Every session the daemon currently believes in.
 *
 * `functional/immutable-data` is on in this package, so nothing here mutates:
 * `observe` returns a new registry rather than writing into a `Map`. That is a
 * lint rule, but it is also the right shape — the socket slice will hand a
 * registry to a renderer on one tick and fold the next event into it on
 * another, and a value that cannot be edited behind the renderer's back is one
 * fewer thing to reason about.
 *
 * The copying is O(sessions) per event, on a machine running single figures of
 * them. Alex and Jamie run two or three.
 */

import type { Session } from './session.js';
import type { HookEvent } from '@tamaclaude/protocol';

import { applyEvent, isLive, newSession } from './session.js';

export type SessionRegistry = {
  readonly sessions: ReadonlyMap<string, Session>;
  /**
   * The last time *anything* happened, which outlives the sessions it happened
   * to.
   *
   * Without it an empty registry cannot tell "the daemon just started" from
   * "everything was evicted ten minutes ago", and the panel walks
   * idle → asleep → idle as the last session ages out from under it.
   */
  readonly lastEventAt: number;
};

/**
 * An empty registry.
 *
 * Boot counts as the last thing that happened, so a daemon started next to no
 * Claude Code at all ages into `ASLEEP` on the same five-minute clock as one
 * whose sessions went quiet, rather than staying awake forever waiting for a
 * first event that never comes.
 */
export function createRegistry(now: number): SessionRegistry {
  return { sessions: new Map(), lastEventAt: now };
}

/**
 * Fold one hook event in.
 *
 * Any event creates the session it names if the daemon has not seen it — see
 * `newSession` for why the first event of a session is not necessarily a
 * `SessionStart`.
 */
/**
 * The most sessions the registry will hold.
 *
 * `hook-line.ts` bounds each field's *length* because a `sessionId` becomes a
 * key held for ten minutes — and nothing bounded how many keys. Anything that
 * can write to the socket could mint sessions without limit, and since the
 * daemon persists after every accepted event, N distinct ids cost O(N^2)
 * synchronous disk work in the event loop. A daemon slowed that way drops real
 * hook events, because the hook gives up after 150ms — so the panel goes wrong
 * with nothing saying why.
 *
 * Sixty-four is far past any real use. The strip shows five chips; Alex and
 * Jamie run a handful of sessions each. Losing the oldest of sixty-four is a
 * chip that was already invisible.
 */
const MAX_SESSIONS = 64;

export function observe(
  registry: SessionRegistry,
  event: HookEvent,
  now: number,
): SessionRegistry {
  const previous =
    registry.sessions.get(event.sessionId) ?? newSession(event.sessionId, now);
  const session = applyEvent(previous, event, now);
  const entries: readonly (readonly [string, Session])[] = [
    ...registry.sessions,
    [session.id, session],
  ];
  return {
    // Later entries win, so this replaces the session rather than duplicating
    // it — and the order of the rest is preserved, which keeps a registry's
    // iteration order the order sessions were first seen. Trimmed from the
    // front, so the oldest goes when the cap bites.
    sessions: new Map(entries.slice(-MAX_SESSIONS)),
    lastEventAt: Math.max(registry.lastEventAt, now),
  };
}

/**
 * Drop the sessions that have gone silent for too long.
 *
 * Time-based, because **a session cannot be relied on to say goodbye**: a
 * crashed or force-quit Claude Code sends nothing, so anything keyed on a
 * farewell event leaks a chip on the strip forever. `lastEventAt` survives, so
 * the panel still knows the house has been quiet rather than empty.
 */
export function evictStale(
  registry: SessionRegistry,
  now: number,
): SessionRegistry {
  const live = [...registry.sessions].filter(([, session]) =>
    isLive(session, now),
  );
  return { sessions: new Map(live), lastEventAt: registry.lastEventAt };
}

/** The sessions that still exist at `now`, in the order they were first seen. */
export function liveSessions(
  registry: SessionRegistry,
  now: number,
): readonly Session[] {
  return [...registry.sessions.values()].filter((session) =>
    isLive(session, now),
  );
}
