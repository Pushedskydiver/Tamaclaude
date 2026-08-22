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
 * them. In practice that is two or three.
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
 * Sixty-four is far past any real use. The strip shows five chips, and one
 * person runs a handful of sessions at once.
 */
const MAX_SESSIONS = 64;

type Entry = readonly [string, Session];

/**
 * Drop the session that has been quiet longest, to make room for a new one.
 *
 * Quietest-first beats first-sight order for the ordinary case: a session that
 * has finished, or that somebody walked away from, is the quietest thing in
 * the map and goes before a session still being used. First-sight order would
 * instead evict whichever session had been open longest, which on a desk is
 * usually the one that matters most.
 *
 * **It does not defend against a flood, and an earlier version of this comment
 * claimed it did.** Measured: one real session, then 64 ids minted thirty
 * seconds later, and the real session is gone — being *between events* is all
 * it takes to be the quietest thing in the map. `MAX_SESSIONS` bounds memory,
 * which is what it was added for; it cannot preserve what the panel shows
 * against a local process that can write to the socket. Nothing here can,
 * without peer identity a unix socket does not give us. The socket is 0600 and
 * that is the layer doing that work.
 */
function withoutQuietest(entries: readonly Entry[]): readonly Entry[] {
  // Seedless, so this throws on an empty array. Safe only because the one
  // caller guards on `length > MAX_SESSIONS`, which nothing in here said.
  // Ties go to the first inserted, which is what keeps eviction deterministic.
  const quietest = entries.reduce((a, b) =>
    b[1].lastEventAt < a[1].lastEventAt ? b : a,
  );
  return entries.filter(([id]) => id !== quietest[0]);
}

/**
 * Fold one hook event in.
 *
 * Any event creates the session it names if the daemon has not seen it — see
 * `newSession` for why the first event of a session is not necessarily a
 * `SessionStart`.
 */
export function observe(
  registry: SessionRegistry,
  event: HookEvent,
  now: number,
): SessionRegistry {
  const previous =
    registry.sessions.get(event.sessionId) ?? newSession(event.sessionId, now);
  const session = applyEvent(previous, event, now);
  // Replace in place when the session is already known, append when it is not,
  // so iteration order stays the order sessions were first seen. Deduplicating
  // has to happen *before* the cap is applied: the previous version appended to
  // the entries and trimmed that array, which spent a slot on the duplicate
  // key. The cap was therefore 63, and an ordinary event about an existing
  // session evicted an unrelated live one.
  //
  // Rebuilt rather than mutated because `functional/immutable-data` is on in
  // this package, and a registry is a value — every fold here returns a new
  // one.
  const entries: readonly Entry[] = registry.sessions.has(session.id)
    ? [...registry.sessions].map(([id, held]) =>
        id === session.id ? ([id, session] as const) : ([id, held] as const),
      )
    : [...registry.sessions, [session.id, session] as const];
  return {
    sessions: new Map(
      entries.length > MAX_SESSIONS ? withoutQuietest(entries) : entries,
    ),
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
