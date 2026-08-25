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
 * Nine of the screen spec's ten §5 states. `DISCONNECTED` is absent because it
 * is not a property
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
  'COMPACTING',
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
 * Tier 1 stays empty, and `DONE` needs no oneshot expiry of its own: its
 * window has two bounds, so crossing the upper one *is* the expiry.
 *
 * `COMPACTING` was the spec's other tier 1 occupant and is not any more. It
 * needs no oneshot expiry either, for a different reason: `SessionStart` fires
 * at the far end of the compaction and already clears to `IDLE`, so the window
 * closes on an event rather than on a clock.
 *
 * It sits at 5 — below `WORKING` and `THINKING`, above `DONE`. Tier 1 was
 * rejected because compaction runs about two minutes and covering a permission
 * prompt for two minutes breaks the one promise the panel makes;
 * `assets/clawd/animations/PLANS.md` §Sweeping and the spec's §4 carry that; §9
 * records only the oneshot removal.
 *
 * **The rank that binds is the one against `DONE`, and it binds mechanically.**
 * A compacting session emits no hook events for the whole window — that is the
 * premise of the screen — so its `lastEventAt` ages, while a `DONE` session's
 * is pinned between 45s and 60s stale by the payoff's two bounds. At equal rank
 * `byPriority` falls to `newestFirst`, so from roughly a minute into a
 * 109-second compaction a shared rank would hand the stage to the payoff and
 * take it off live work — the defect this file records for `DONE` at :60,
 * relabelled. A rank distinctly above `DONE` is required, not preferred.
 *
 * Against `WORKING` the rank barely matters: a working session emits events
 * constantly and a compacting one emits none, so `newestFirst` would settle it
 * the same way at equal rank. Keeping compaction below the two states that
 * serve a live request costs nothing and reads right — and where a compacting
 * session *loses* the stage, the stage already holds a truthful answer, so the
 * screen's explain-the-pause value survives in every case where that value
 * exists.
 *
 * Not ranked on "nobody asked for it". 18 of 19 measured compactions were
 * automatic, but this file's axis is which session most needs a human, and
 * `HookEvent` does not carry `trigger`, so the daemon could not act on it per
 * compaction even if it were the axis.
 */
const STATE_RANK: Readonly<Record<SessionState, number>> = {
  NEEDS_PERMISSION: ATTENTION_RANK,
  FAILED: ATTENTION_RANK,
  WAITING: ATTENTION_RANK,
  WORKING: 3,
  THINKING: 4,
  // Below the two states that serve a request the person actually made, above
  // every resting one. Compaction is work, so it beats `DONE` and `IDLE` — but
  // 18 of the 19 measured compactions were automatic, so it is work nobody
  // asked for, and a session mid-`WORKING` on something that *was* asked for is
  // the better answer to "what should I look at".
  COMPACTING: 5,
  DONE: 6,
  IDLE: 7,
  ASLEEP: 8,
};

/** How loudly a state asks for a human. Lower wins the stage. */
export function stateRank(state: SessionState): number {
  return STATE_RANK[state];
}

/**
 * Whether this state is asking for a human.
 *
 * A predicate rather than an exported `ATTENTION_RANK` and `stateRank` pair,
 * which is what the message band first reached across the boundary for. Two
 * exports let the caller open-code the comparison, and a review demonstrated
 * the cost: replacing the caller's guard with `state === 'NEEDS_PERMISSION'`
 * silently dropped `FAILED` and `WAITING` with nothing red anywhere. With the
 * comparison beside the table it reads, that mutant cannot be written.
 *
 * The extension is pinned by a test, because the hazard the old shape carried
 * does not go away by itself: split attention into two ranks and an equality
 * against one of them stops covering the other, with nothing to notice.
 */
export function needsAttention(state: SessionState): boolean {
  return stateRank(state) === ATTENTION_RANK;
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
