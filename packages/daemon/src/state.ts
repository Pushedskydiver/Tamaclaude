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
 * **One deliberate exception, since 24 Aug:** a quip may be keyed
 * `FAILED:<error>` — `FAILED:rate_limit` — to say something different when a
 * usage limit is the reason rather than an ordinary failure. That embeds an
 * upstream *value* rather than a hook name, which is a smaller version of the
 * same coupling for the same reason, so it is written down rather than assumed.
 * It degrades gracefully: an unknown suffix falls through to the bare state,
 * and the animation falls through to `dizzy`. `packs/example/README.md` carries
 * the same note, because that is the file a pack author copies from.
 *
 * Eight of the screen spec's ten §5 states. `COMPACTING` is absent for the
 * reason in `STATE_RANK`; `DISCONNECTED` is absent because it is not a property
 * of a session at all — it says the panel has no host, which the transport
 * knows and a session record cannot.
 */

/** Every state, so a test can assert the tables below are exhaustive. */
export const SESSION_STATES = [
  'NEEDS_PERMISSION',
  'FAILED',
  'WAITING',
  'DONE',
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
 * **`DONE` wins only against resting states**, and that is a deliberate
 * departure from the spec, which puts it in tier 1 where it seizes the stage
 * from everything. That was settled for a two-second oneshot on `Stop`; a
 * fifteen-second window is a different cost. Covering a session blocked on a
 * human breaks the one promise the panel makes — it exists to say when to look.
 *
 * **A first version put it above `WORKING`, and that was a live defect rather
 * than a judgement call.** With `DONE` borrowing the `idle` art until the
 * payoff exists, a finished session took the stage from a working one and
 * showed a Clawd doing nothing for fifteen seconds while a tool ran — the exact
 * lie `animation.ts` forbids, in the paragraph that had been cited here as the
 * justification for the rank. Two reviews reproduced it independently.
 *
 * The argument for outranking `WORKING` was that the screen would otherwise be
 * lost to concurrent sessions. That figure did not survive: the two reviews
 * measured the same corpus and got 15% and 66% for the same quantity, because
 * it turns entirely on what counts as a session being live. A number that moves
 * by a factor of four with its definition cannot carry a design decision, so it
 * is quoted nowhere now.
 *
 * A payoff belongs on a quiet desk. If anything is still happening, that is the
 * more useful thing to show.
 *
 * Tier 1 stays empty. `COMPACTING` is the spec's other occupant and
 * `PreCompact`'s sweeping animation is Tier B art that does not exist, so
 * building oneshot expiry for it would still be dead code with no way to fail.
 * This state needs none: the window has two bounds, so crossing the upper one
 * *is* the expiry.
 */
const STATE_RANK: Readonly<Record<SessionState, number>> = {
  NEEDS_PERMISSION: ATTENTION_RANK,
  FAILED: ATTENTION_RANK,
  WAITING: ATTENTION_RANK,
  WORKING: 3,
  THINKING: 4,
  DONE: 5,
  IDLE: 6,
  ASLEEP: 7,
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

/**
 * Quiet this long after doing some work and the payoff screen appears.
 *
 * The trigger `Stop` could not be. Measured over the local transcript corpus
 * and reproduced independently to three significant figures: at 45 seconds
 * **61.8% of transcripts see at least one**, at 2.85 fires per transcript
 * averaged over all of them and 4.6 among those that fire at all. 30s roughly
 * doubles the rate and 90s roughly halves it, which is why 45 sits here.
 *
 * **No ratio against `Stop` is quoted, deliberately.** An earlier version
 * claimed a "10-13x reduction on `Stop`'s roughly 26 turn boundaries". Neither
 * half held: 26 is not reproducible under any principled definition of a turn
 * boundary, and it was being divided by a per-transcript figure — 36 distinct
 * session ids against 1,187 transcript files, because subagent sidechains get
 * their own file and not their own id, and the daemon keys on the id. Even at
 * face value the quotient is 9.1. `PLANS.md` had already caught this exact
 * class of error: "a different denominator, so the two do not divide."
 */
export const DONE_AFTER_MS = 45_000;

/**
 * How long the payoff stays up.
 *
 * `DONE_AFTER_MS + DONE_SHOWN_MS` is exactly `WAITING_AFTER_MS`, so the payoff
 * can never outlive the point where Clawd starts staring at you. The two are
 * chosen together and a test pins the equality.
 *
 * **Seamless only when the notification is the session's last event.** The two
 * windows have different anchors — this one runs from `lastEventAt`, `WAITING`
 * from `notifiedAt`, and `WAITING` is checked first — so any event after the
 * notification pushes this window later while `WAITING` stays put, truncating
 * the payoff and eventually removing it. That precedence is right, a session
 * waiting on a human outranks a celebration; but an earlier version of this
 * comment claimed "no gap and no overlap" flatly, and the test pinning it built
 * the one case where the anchors coincide.
 */
export const DONE_SHOWN_MS = 15_000;

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
