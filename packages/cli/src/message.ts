/**
 * What the message band says, and which states may put a tool name in it.
 *
 * Split out of `daemon.ts` on 25 Aug, when adding `COMPACTING` to two exhaustive
 * `Record<SessionState, …>` tables there took the file one line past its
 * 300-line cap. The cap did the right thing: this is one concern — the words a
 * person reads — and it had grown four lookups deep inside a file whose other
 * job is a render loop.
 *
 * The order those lookups run in is the whole design and is documented on
 * `messageFor` itself.
 */
import type { resolvePanel, SessionState } from '@tamaclaude/daemon';
import type { PackManifest } from '@tamaclaude/packs';

import { needsAttention } from '@tamaclaude/daemon';
import { isBirthday } from '@tamaclaude/packs';

/**
 * The birthday line, when today is the day and nothing is asking for a human.
 *
 * Its own function because `messageFor` hit a complexity of 14 against a limit
 * of 10 the moment this landed, and because the rule it encodes deserves a
 * name: **a celebration never covers a state that is asking for a human.** The
 * one day of the year it matters most that the panel still says when to look is
 * the day nobody is watching it for status.
 *
 * **This is not the rule `DONE` is ranked by**, and the first version of this
 * comment claimed it was — twice, here and in `BUILD_PLAN.md`. `DONE` sits
 * below `WORKING` and `THINKING`, and `state.ts` gives the reason as
 * "A payoff belongs on a quiet desk". The birthday line covers both. Two
 * independent reviews caught the same sentence, one of them noting that the
 * paragraph cited as support argues the opposite — and a third caught the
 * correction claiming that sentence was bold, which it is not.
 *
 * They share one half — neither covers an attention state — and differ on the
 * other for two reasons. `STATE_RANK` decides which session owns the *stage*,
 * where a resting Clawd over a running tool is a lie about what is happening;
 * this decides the *message band* alone, and the animation still shows the
 * work, so nothing on the glass is false. And `DONE` is triggered by quiet,
 * which makes "belongs on a quiet desk" nearly tautological for it, while a
 * birthday is a property of the day and holds whatever the desk is doing. A
 * line that waited for a quiet desk could be missed for an entire working
 * Wednesday, which is the one outcome this exists to prevent.
 */
function birthdayLine(
  panel: ReturnType<typeof resolvePanel>,
  pack: PackManifest,
  now: number,
): string | undefined {
  if (needsAttention(panel.state)) return undefined;
  if (!isBirthday(pack, now)) return undefined;
  // `?.` only because TypeScript cannot narrow `birthday` across `isBirthday`;
  // if it were somehow absent this returns undefined and `messageFor` falls
  // through to the ordinary line, which is the right way to fail.
  return pack.birthday?.quip;
}

/**
 * A `FAILED` line refined by which error it was, when the pack carries one.
 *
 * `FAILED:rate_limit` lets a pack say something different when a usage limit is
 * the reason. It matters now that two `FAILED` values draw different pictures:
 * without it `overheated` and `dizzy` share a message band and the picture is
 * the only difference between them. No schema change — `quips.mapped` is
 * `z.record(z.string(), z.string())`, so any key validates, and an unknown
 * suffix simply misses and falls through to the bare state.
 *
 * The error is read off the hero rather than through `resolvePanel`, which
 * returns state and tool but not `errorType`. `sessions[0]` is the hero and is
 * a whole `Session`, so the value is already here.
 */
function refinedFailureLine(
  panel: ReturnType<typeof resolvePanel>,
  pack: PackManifest,
): string | undefined {
  if (panel.state !== 'FAILED') return undefined;
  const errorType = panel.sessions.at(0)?.errorType;
  if (errorType === undefined) return undefined;
  return pack.quips.mapped[`${panel.state}:${errorType}`];
}

/**
 * The states where the tool is the interesting fact, rather than a leftover.
 *
 * **Two handlers strand a tool, not one.** Plenty of events leave `tool`
 * alone — every unmapped one does — but two leave it set while moving the
 * session out of the state it belonged to: `StopFailure` at `FAILED`, and
 * `SessionEnd` at `ASLEEP`, which `session.ts` stores with the tool the
 * session died holding.
 *
 * Neither reaches the glass, and the reasons are different, which is the whole
 * argument for this table. `resolve` copies `hero.tool` onto the panel
 * unfiltered, so `panel.tool` really is `Bash` for a session that died running
 * it. What stops it there depends on the pack: `refinedFailureLine` and the
 * `mapped` lookup both run ahead of the line below, and the example pack
 * defines `FAILED` and `FAILED:rate_limit`, so for that pack the tool never
 * gets this far. **The `false` below is the only guard that does not depend on
 * the pack** — which is why the test for it has to empty `mapped` to reach the
 * defect at all. `ASLEEP` *carrying a tool* never gets here either, because
 * `isLive` drops a session with `endedAt` before the panel is built; plain
 * `ASLEEP` by promotion reaches the panel constantly and has no tool to
 * strand.
 *
 * Said in the present tense here until 25 Aug, as though `StopFailure` still
 * reached the glass — a description of the world immediately above the table
 * that ended it. Before that, an earlier version said `Stop` clearing `tool`
 * was the reason `ASLEEP` was safe, which is true of `ASLEEP` by promotion and
 * false of `ASLEEP` by `SessionEnd`; it was badged "measured, not assumed" and
 * was neither.
 *
 * That is also the argument for a whitelist over a blacklist on `FAILED`, and
 * it is stronger than the one first written here: a `FAILED`-only blacklist is
 * not merely risky for some future state, it already has a live state on the
 * wrong side of it. If eviction ever held an ended session on the strip for a
 * beat, `ASLEEP` would surface carrying `Bash`. That is a claim about the
 * blacklist, not about the table as it stands: with `ASLEEP: false` below, such
 * a session would set `panel.tool` and still put nothing on the message band.
 *
 * A total `Record` rather than a `Set`, for the reason `TONE` gives in
 * `daemon.ts` — it was directly above this until the two were split: a
 * `Set` compiles clean when a state is added to `SESSION_STATES` and silently
 * puts it outside. Here that defaults safe, so the stake is lower than
 * `TONE`'s in `daemon.ts` — but "safe by absence" and "decided" are different things, and
 * only one of them survives someone reading the table later.
 */
const TOOL_STATES: Readonly<Record<SessionState, boolean>> = {
  WORKING: true,
  NEEDS_PERMISSION: true,
  // Everything below carries no tool, or carries a stale one.
  // `COMPACTING` is the second kind: `PreCompact` fires mid-turn, so whatever
  // tool was running is still on the record and is not what is happening.
  COMPACTING: false,
  FAILED: false,
  THINKING: false,
  DONE: false,
  IDLE: false,
  ASLEEP: false,
  WAITING: false,
};

/**
 * What the message band says, in words a person can act on.
 *
 * **The state comes first, and that is the whole point.** This used to be
 * `panel.tool ?? panel.state`, which cannot express the two things the panel
 * exists to tell you. `StopFailure` never clears `tool`, so a session that died
 * on a rate limit rendered the word `Bash` — pixel-for-pixel identical to one
 * happily running Bash. And `NEEDS_PERMISSION` has no tool, so it put the raw
 * enum `NEEDS_PERMISSION` on the glass. Measured, all three.
 *
 * A pack's `quips.mapped` is keyed on exactly these state names — which
 * `state.ts` says is *why* they are SCREAMING_SNAKE — and until now nothing in
 * the repo read it: the example pack has "may I?" and "well, that happened"
 * sitting unused while the panel showed enum names. So a mapped quip beats the
 * tool, then an idle quip, and a lower-cased state name only as a last resort.
 * It no longer wins outright — see the two lookups below — and the tool line
 * *is* filtered by state now. It was not until `TOOL_STATES` landed, though
 * this paragraph claimed a filter from the day it was written until two
 * commits ago, when a review made it say the opposite and say it accurately.
 * `panel.tool` was returned whenever it was set, and `FAILED` carries the tool
 * the session died running — so a hand-written pack could get `Bash` for a
 * dead session, which is what the paragraph above says this function exists to
 * stop. What shielded the example pack was two keys, not one: `FAILED` for the
 * general case and `FAILED:rate_limit`, which `refinedFailureLine` reaches
 * first, for the rate-limit case specifically.
 *
 * The idle quip is chosen by the clock rather than at random, because a desk
 * toy that reshuffles its own text every 125ms is a fidget, not a pet — and
 * because a random one would make the dirty-rect diff send a frame per tick.
 *
 * **Two lookups now run before the mapped quip**, which retires the sentence
 * above: `birthdayLine` and `refinedFailureLine`, each with its own doc. They
 * are ahead of it for different reasons, and an earlier version of this
 * paragraph gave one reason for both. `refinedFailureLine` genuinely would be
 * pre-empted by the bare `FAILED` key. `birthdayLine` would not — it fires
 * only on states that have no mapped entry in the one pack written so far, so
 * what it actually steps in front of is everything below: `panel.tool` for
 * `WORKING`, the idle rotation for `IDLE`, and the last-resort lowercased
 * state name for `THINKING`, `ASLEEP` and `DONE`, which reach neither. `DONE`
 * belongs in the second group because `Stop` clears `tool` in `TRANSITIONS`, so
 * a payoff never has one to show.
 *
 * That distinction is not academic: `BUILD_PLAN.md` schedules mapped quips for
 * more states in Stage 5, and on the day the birthday will take precedence
 * over every one of them that is not asking for a human.
 */
export function messageFor(
  panel: ReturnType<typeof resolvePanel>,
  pack: PackManifest,
  now: number,
): string {
  // The birthday first — see `birthdayLine` for what it does and does not cover.
  const birthday = birthdayLine(panel, pack, now);
  if (birthday !== undefined) return birthday;
  const refined = refinedFailureLine(panel, pack);
  if (refined !== undefined) return refined;
  const mapped = pack.quips.mapped[panel.state];
  if (mapped !== undefined) return mapped;
  if (TOOL_STATES[panel.state] && panel.tool !== undefined) {
    return panel.tool;
  }
  if (panel.state === 'IDLE' && pack.quips.idle.length > 0) {
    // One quip a minute, so it changes at a human pace and the diff stays quiet.
    const minute = Math.floor(now / 60_000);
    return pack.quips.idle[minute % pack.quips.idle.length] ?? panel.state;
  }
  return panel.state.toLowerCase().replaceAll('_', ' ');
}
