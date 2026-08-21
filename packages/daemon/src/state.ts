/**
 * The states a session can be in, how loudly each one asks for a human, and
 * the thresholds that move between them.
 *
 * State names are SCREAMING_SNAKE because **a state name is also a quip key**:
 * a pack writes `quips.mapped.NEEDS_PERMISSION` and never names a hook event
 * (`packs/example/manifest.json`). That indirection is the whole reason the
 * two vocabularies are separate — a pack should not have to track Claude
 * Code's hook names, which change on Anthropic's schedule rather than ours.
 *
 * Seven of the screen spec's ten §5 states. `DONE` and `COMPACTING` are absent
 * for the reason in `STATE_RANK`; `DISCONNECTED` is absent because it is not a
 * property of a session at all — it says the panel has no host, which the
 * transport knows and a session record cannot.
 */

/** Every state, so a test can assert the tables below are exhaustive. */
export const SESSION_STATES = [
  'NEEDS_PERMISSION',
  'FAILED',
  'WAITING',
  'WORKING',
  'THINKING',
  'IDLE',
  'ASLEEP',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

/**
 * The rank shared by every "needs you" state.
 *
 * Named rather than inlined because the hero comparator has to recognise it:
 * this is the one rank whose tie-break runs backwards (oldest first), and a
 * bare `2` in two files is a bug waiting for someone to renumber a tier.
 */
export const ATTENTION_RANK = 2;

/**
 * Hero priority: lower wins. Spec §4's tiers, with tier 5 split so `IDLE`
 * outranks `ASLEEP` — §4 lists them in that order, which a single shared rank
 * would have thrown away.
 *
 * **Tier 1 is deliberately empty.** The spec gives it to `DONE` and
 * `COMPACTING` as two-second oneshots that seize the stage. Neither trigger
 * survives contact with the confirmed hook documentation: `Stop` fires on
 * every response rather than at the end of a task, so a `DONE` keyed on it
 * would seize the stage several times a turn, and `PreCompact`'s sweeping
 * animation is Tier B art that does not exist yet. Building oneshot expiry for
 * a tier nothing can enter would be dead code with no way to fail. It lands
 * with the quiet-period trigger that has to replace `Stop`, which is a timer
 * the daemon owns rather than an event it receives.
 */
const STATE_RANK: Readonly<Record<SessionState, number>> = {
  NEEDS_PERMISSION: ATTENTION_RANK,
  FAILED: ATTENTION_RANK,
  WAITING: ATTENTION_RANK,
  WORKING: 3,
  THINKING: 4,
  IDLE: 5,
  ASLEEP: 6,
};

/** How loudly a state asks for a human. Lower wins the stage. */
export function stateRank(state: SessionState): number {
  return STATE_RANK[state];
}

/**
 * Spec §9's timings. **None of these are pack-configurable**, deliberately —
 * nobody retunes a sixty-second threshold via JSON on a birthday present, and
 * the knobs would cost schema, validation and tests each.
 */

/** Idle this long after a `Notification` and Clawd starts staring at you. */
export const WAITING_AFTER_MS = 60_000;

/** Idle this long with nothing running and he curls up. */
export const ASLEEP_AFTER_MS = 5 * 60_000;

/**
 * Silent this long and the session is gone from the strip.
 *
 * Twice the sleep threshold, and time-based rather than event-based because
 * **a session never says goodbye that the daemon can rely on**: a crashed or
 * force-quit Claude Code sends nothing at all, so a farewell event is at best
 * an optimisation and at worst a reason to leak a chip forever.
 */
export const EVICT_AFTER_MS = 10 * 60_000;
