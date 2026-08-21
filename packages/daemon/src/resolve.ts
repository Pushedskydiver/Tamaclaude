/**
 * Which session gets the stage.
 *
 * ## The rule, and why it is this one
 *
 * **The hero slot belongs to whichever session most needs a human, not to the
 * most recent one.** A desk display's job is not to report what the computer
 * is doing — it is to tell you *when to look*. Of three sessions working
 * happily and one blocked on a permission prompt, only the blocked one is
 * costing you time by going unseen, so it takes the stage even though it is
 * the least active thing on the machine.
 *
 * That gives the ordering below (screen spec §4). Within "needs you",
 * **oldest wins**: an eight-minute-old permission prompt is costing more than
 * one raised ten seconds ago, so the comparator runs backwards inside that one
 * rank. Everywhere else the most recently active session wins, which is what
 * makes three concurrent `Bash` runs settle on whichever is actually moving
 * rather than flickering between them.
 *
 * The alternative — most-recent-wins throughout — was rejected because it
 * makes the panel a tail light. Whichever session is chattiest owns the screen,
 * and the one that stopped to ask you something is precisely the one that has
 * stopped generating events.
 */

import type { SessionRegistry } from './registry.js';
import type { Session } from './session.js';
import type { SessionState } from './state.js';

import { liveSessions } from './registry.js';
import { effectiveState } from './session.js';
import { ASLEEP_AFTER_MS, ATTENTION_RANK, stateRank } from './state.js';

export type Resolution = {
  /** What the panel shows. The hero's effective state, or the empty-desk one. */
  readonly state: SessionState;
  /** The hero's tool, when it has one. Together with `state` this picks the animation. */
  readonly tool?: string;
  /**
   * Every live session, **hero first** — `sessions[0]` is the one on the stage.
   *
   * Ordered rather than merely listed so that a consumer with room for fewer
   * than all of them (the strip shows five, then a count) drops the ones that
   * matter least instead of whichever arrived last.
   */
  readonly sessions: readonly Session[];
};

type Ranked = { readonly session: Session; readonly rank: number };

/** Oldest first — the tie-break inside "needs you". */
function oldestFirst(a: Session, b: Session): number {
  return a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

/**
 * Most recently active first, everywhere else.
 *
 * The final comparison on `id` is not cosmetic: three sessions changing state
 * in the same tick share a timestamp to the millisecond, and without it the
 * winner would depend on the order the daemon happened to hear about them.
 */
function newestFirst(a: Session, b: Session): number {
  return (
    b.lastEventAt - a.lastEventAt ||
    a.startedAt - b.startedAt ||
    a.id.localeCompare(b.id)
  );
}

function byPriority(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank === ATTENTION_RANK) return oldestFirst(a.session, b.session);
  return newestFirst(a.session, b.session);
}

/** What the panel shows with no sessions at all: an empty desk, or a quiet one. */
function emptyDesk(registry: SessionRegistry, now: number): SessionState {
  return now - registry.lastEventAt >= ASLEEP_AFTER_MS ? 'ASLEEP' : 'IDLE';
}

/**
 * Resolve the whole registry into the one answer the panel needs.
 *
 * Reads through `liveSessions`, so a daemon that has not pruned on this tick
 * still cannot put an evicted session on the stage — `evictStale` keeps the
 * map from growing, but it is not what keeps the answer correct.
 */
export function resolvePanel(
  registry: SessionRegistry,
  now: number,
): Resolution {
  const ranked = liveSessions(registry, now)
    .map((session) => ({
      session,
      rank: stateRank(effectiveState(session, now)),
    }))
    .toSorted(byPriority)
    .map((entry) => entry.session);
  const hero = ranked.at(0);
  if (hero === undefined) {
    return { state: emptyDesk(registry, now), sessions: [] };
  }
  return {
    state: effectiveState(hero, now),
    tool: hero.tool,
    sessions: ranked,
  };
}
