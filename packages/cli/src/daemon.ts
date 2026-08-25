/**
 * The `daemon` command: the one place the packages become a panel.
 *
 * `BUILD_PLAN.md` §Stage 3 carried this as its open exit for the whole stage —
 * "the listener holds the registry and offers a snapshot; nothing yet renders
 * it or pushes a frame down the wire". Every piece existed and was tested in
 * isolation. This is the composition, and it is deliberately the only file in
 * the repo that imports every other workspace package:
 *
 *   socket  ->  registry  ->  resolution  ->  scene  ->  pixels  ->  rect  ->  wire
 *   daemon      daemon        daemon          cli       renderer   protocol   device
 *
 * (`packs` is not on that row but is imported too, sitting under `scene` — the
 * pack is what the renderer draws with. `cli` is on the row and is not an
 * import, because this file *is* `cli`.)
 *
 * Nothing here is clever, and that is the intent — every decision worth making
 * was made in the package that owns it. What lives here is the glue that has no
 * other home: turning a `Resolution` into a `Scene`, and turning consecutive
 * framebuffers into the smallest rectangle that changed.
 */
import type { AnimationName, Session, SessionState } from '@tamaclaude/daemon';
import type { LinkStatus, SerialSystem } from '@tamaclaude/device';
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame, Rect } from '@tamaclaude/protocol';
import type {
  Scene,
  SessionChip,
  Sprite,
  TimeOfDay,
} from '@tamaclaude/renderer';

import process from 'node:process';

import {
  animationFor,
  effectiveState,
  needsAttention,
  resolvePanel,
  startSocketServer,
} from '@tamaclaude/daemon';
import { openPanel } from '@tamaclaude/device';
import { isBirthday, parsePackManifest } from '@tamaclaude/packs';
import {
  dirtyRect,
  encodeRect,
  extractRect,
  frame,
} from '@tamaclaude/protocol';
import {
  castsShadow,
  loadSprite,
  panelSize,
  render,
  SPRITE_NAMES,
} from '@tamaclaude/renderer';

/**
 * How often the panel is recomposed.
 *
 * Eight, because that is what `tools/svg2frames.ts` rasterises at and what the
 * animation timings in `docs/ANIMATION.md` divide into. It is also now the rate
 * Clawd is actually played at — `paintOnce` indexes the current animation by
 * this same constant, so a clock that ticked at some other rate would show a
 * loop at the wrong speed rather than merely disagree with the art.
 */
const FRAME_MS = 125;

/**
 * Which way up the panel is, and **the one line to change when that is
 * decided**.
 *
 * **Decided, not defaulted.** `.claude/research/screens/spec.md` §10a carried
 * this as an open freeze item until Alex closed it on 21 Aug: the device is
 * mounted on its side. `docs/HARDWARE.md` §Orientation already had both the
 * mock and the harness defaulting to landscape, so nothing had to move.
 *
 * A constant rather than an option because landscape is not a rotated portrait
 * layout — the stage as authored is 200px tall against a 172px landscape panel,
 * and 172/25 is 6.88 device pixels per unit, so every motion in every animation
 * would land between pixels. Changing it is an art decision, not a flag.
 *
 * An earlier version of this comment cited `CLAUDE.md`, which says the panel is
 * 172x320 and nothing at all about how it is mounted.
 */
const ORIENTATION = 'landscape';

/**
 * How far the rock pool reaches.
 *
 * `panel`, so the scenery fills the glass rather than sitting in a band behind
 * Clawd with the pack's flat background above and below it. Both extents are
 * built (`ENVIRONMENT_EXTENTS` in the renderer); this picks one, the way
 * `ORIENTATION` above picks one.
 *
 * A constant rather than a pack field for now. A switch was asked for so the
 * owner or the recipient could change it later, and a pack manifest entry is
 * where that belongs — the pack is the personalisation layer. That is deferred, not
 * forgotten: it is a schema change to `@tamaclaude/packs` plus a migration for
 * a manifest that already exists, and it was explicitly not taken in the same
 * pass as wiring the scenery on at all.
 */
const ENVIRONMENT_EXTENT = 'panel';

export type DaemonOptions = {
  readonly socketPath: string;
  readonly devicePath: string;
  /** Untrusted until `parsePackManifest` has had it. */
  readonly pack: unknown;
  /** Injected by tests. Defaults to the real serial port. */
  readonly serial?: SerialSystem;
  readonly now?: () => number;
  readonly frameMs?: number;
  /** Forwarded to `openPanel`, so a test can reach the refresh prime. */
  readonly refreshMs?: number;
  readonly retryMs?: number;
  /**
   * Consecutive failed opens before the panel stops trying. See `panel.ts`.
   *
   * Set only when something will restart this process, because giving up is
   * only useful if somebody picks it back up. `tamaclaude daemon` typed by
   * hand leaves it unset and retries forever.
   */
  readonly giveUpAfter?: number;
  readonly onGiveUp?: () => void;
  /**
   * Told what the link is doing, in words.
   *
   * Defaults to stderr rather than to nothing. `link.ts` composes a specific,
   * actionable sentence for a firmware/panel mismatch — the single most likely
   * bring-up failure — and before this was wired the daemon computed it and
   * dropped it: writes stopped after the first frame, permanently, and nothing
   * anywhere said why. `panel.ts` never retries a refused link, by design, so
   * silence there is forever.
   */
  readonly report?: (line: string) => void;
};

export type RunningDaemon = {
  readonly stop: () => Promise<void>;
};

/**
 * Which sky the panel is wearing.
 *
 * Here rather than in the renderer for the same reason `clockText` is here:
 * the renderer takes the answer, not the clock. `packages/renderer/src` reads
 * a `Date` nowhere at all, and keeping it that way is what makes a frame a
 * function of its inputs.
 *
 * An earlier version of this argued runtime-neutrality — that a timezone lookup
 * would block `BUILD_PLAN.md` Stage 1's browser-bundle exit. That reasoning was
 * borrowed from `sprites/index.ts`, where it is about `node:buffer` and is
 * true; `Date#getHours` is standard ECMAScript and runs in a browser fine.
 *
 * The boundaries are the ones a person would name looking out of a window,
 * not civil twilight: this is a desk toy, and a rock pool that turns golden at
 * six in the evening is the point. `dawn` and `dusk` get three hours each and
 * `day` gets nine, because the two transitions are what make the panel look
 * like a place rather than a picture, and a nine-hour midday is one flat sky
 * nobody watches change.
 */
function timeOfDay(now: number): TimeOfDay {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night';
}

/** The clock as the status band wants it: 24-hour, no seconds. */
function clockText(now: number): string {
  const at = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Which of the strip's three tones a state reads as.
 *
 * A total `Record` rather than a chain of ternaries, because the chain ended in
 * a default: any state added to `SESSION_STATES` compiled clean and silently
 * became an ordinary working chip. `state.ts` says `COMPACTING` is
 * expected back, and a future `FAILED`-class state arriving as "nothing to see"
 * would lose exactly the signal the strip exists for. Now it will not build.
 *
 * The *decision* to collapse lives in `packages/renderer/src/strip.ts`: a pack
 * carries a handful of colours, so spec §5's ten states cannot each have a
 * tint, and the renderer collapsed them to three tones — fewer even than §4's
 * five tiers, which the three mapped onto cleanly while every state was one of
 * §4's tiers: attention is tier 2, active tiers 3 and 4, resting tier 5.
 * `DONE` broke that — the spec puts it in tier 1 and this daemon ranks it with
 * the resting states, so it is the first row whose tone is chosen rather than
 * derived. The collapse itself is this table, and it
 * had to land somewhere the moment something fed the strip — `strip.ts` says as
 * much, that "the day the daemon wants to name one in a state-to-tone table,
 * `export` is the whole change".
 */
const TONE: Readonly<Record<SessionState, SessionChip['tone']>> = {
  NEEDS_PERMISSION: 'attention',
  FAILED: 'attention',
  WAITING: 'attention',
  // Resting, because that is the tier this daemon ranks it in. `strip.ts` is
  // clear the tint carries §4's tier rather than anything else, and "needs a
  // human" would not separate `DONE` from `WORKING` or `THINKING`, which need
  // one just as little and are `active`. An earlier version of this comment
  // gave that reason, and it would have justified making `WORKING` resting.
  DONE: 'resting',
  WORKING: 'active',
  THINKING: 'active',
  IDLE: 'resting',
  ASLEEP: 'resting',
};

/**
 * A session as the strip draws it.
 *
 * Its own effective state, not the hero's. A chip that showed the hero's tone
 * would say every session is doing whatever the loudest one is doing, which is
 * the opposite of what a strip is for.
 */
function chipFor(session: Session, now: number): SessionChip {
  // Everything is local. `origin` exists for the remote transport in
  // `BUILD_PLAN.md` §Stage 3, which calls it "explicitly cuttable"; a session
  // record carries no origin until it ships.
  return { tone: TONE[effectiveState(session, now)], origin: 'local' };
}

/**
 * The status band's right end: how many subagents are running, across all of
 * them.
 *
 * `BUILD_PLAN.md` §Stage 3 carried the badge as "drawn from placeholder text
 * until the daemon feeds the scene". This is the daemon feeding it. Blank
 * rather than a zero, because a zero is a thing to read and the common case is
 * nothing to say.
 */
function subagentText(sessions: readonly Session[]): string {
  const running = sessions.reduce((total, one) => total + one.subagents, 0);
  return running > 0 ? `+${String(running)}` : '';
}

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
 * comment claimed it was — twice, here and in `BUILD_PLAN.md`. `DONE` sits at
 * rank 5, below `WORKING` and `THINKING`, and `state.ts` gives the reason as
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
 * A total `Record` rather than a `Set`, for the reason `TONE` above gives: a
 * `Set` compiles clean when a state is added to `SESSION_STATES` and silently
 * puts it outside. Here that defaults safe, so the stake is lower than
 * `TONE`'s — but "safe by absence" and "decided" are different things, and
 * only one of them survives someone reading the table later.
 */
const TOOL_STATES: Readonly<Record<SessionState, boolean>> = {
  WORKING: true,
  NEEDS_PERMISSION: true,
  // Everything below carries no tool, or carries a stale one.
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
function messageFor(
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

/**
 * Which animation a resolved panel shows.
 *
 * Extracted and exported for one reason: as three lines inlined in `paintOnce`
 * it had **no test at all**. `paintOnce` is not exported and `sceneFor` takes
 * the animation as an input, so deleting the `errorType` argument left all 430
 * tests green with the feature gone — which is the same shape of silent gap as
 * `packages/hooks` reading a field name that does not exist. One export and one
 * test is the whole cost of noticing.
 *
 * `sessions[0]` is the hero by construction: `resolve.ts` sorts once and
 * returns `state` from `ranked.at(0)` and `sessions` from the same array, so
 * they cannot disagree.
 */
export function animationForPanel(
  panel: ReturnType<typeof resolvePanel>,
): AnimationName {
  return animationFor(panel.state, {
    tool: panel.tool,
    errorType: panel.sessions.at(0)?.errorType,
  });
}

/**
 * The frames for an animation, or none if it has not been baked.
 *
 * `animationFor` maps every session state and every `PreToolUse.tool_name` onto
 * a name in `ANIMATIONS`, and every one of those is baked — so this guard
 * cannot fire today, and saying otherwise would be inventing a hazard. It
 * exists for the next animation rather than the current ones — and the example
 * it names is maintenance. `sweeping` stood here until 25 Aug, when its art
 * landed; `payoff` until 24 Aug. Both are baked now, so neither illustrates the
 * hazard any more, and naming the next one would only queue up the same edit —
 * `assets/clawd/animations/PLANS.md` still lists unbuilt screens, and the moment
 * any of them is added to `ANIMATIONS` it is reachable here before its art is
 * baked. An empty stage is
 * the right answer to that; taking the panel down is not.
 *
 * Typed `AnimationName` rather than `string` on purpose. A `string` here is how
 * "nothing in 360 tests notices a referenced animation going missing" happens
 * one layer up.
 *
 * **The `return []` is unreachable by construction, not merely unreachable
 * today.** Planting an unbaked name in `ANIMATIONS` errors `tsc` twice in this
 * function — at `SPRITE_NAMES.includes` and again at `loadSprite`, which
 * rejects the widened union on its own — so no build that typechecks can enter
 * the branch. Deleting the guard would not remove the compile error; the one
 * path that reaches it is a `dist/` mismatch between packages built separately,
 * which is why it stays. An earlier version of this comment justified it by a
 * mid-frame throw that the type system already prevents.
 */
export async function framesFor(
  name: AnimationName,
): Promise<readonly Sprite[]> {
  if (!SPRITE_NAMES.includes(name)) return [];
  return loadSprite(name);
}

/**
 * Which frame of the current animation is showing.
 *
 * Driven by the clock rather than by a counter, so it does not need to be
 * carried through the paint loop and so two panels started a minute apart are
 * on the same beat — the index is a pure function of absolute epoch time.
 *
 * Every loop is a whole number of seconds at 8fps (16, 12, 8, 6, 4, 3 and 2), so a
 * loop restarts on a wall-clock second. That is a nicety and not what makes
 * this safe: the modulo lands in range for any frame count, and an earlier
 * version of this comment offered the one as the reason for the other.
 */
export function frameAt(frames: number, now: number): number {
  return Math.floor(now / FRAME_MS) % frames;
}

export type SceneInput = {
  readonly registry: Parameters<typeof resolvePanel>[0];
  readonly pack: PackManifest;
  readonly now: number;
  /** Empty is a complete scene: `scene.ts` leaves unfilled slots empty. */
  readonly sprites?: readonly Sprite[];
  /**
   * Which animation the sprites are frames of.
   *
   * Only the ground shadow needs it: the environment is painted before any
   * sprite exists, so the layer that draws the shadow cannot tell whether the
   * character about to go in front of it is standing on the ground or half way
   * up a wall. The name is the only thing that knows.
   */
  readonly animation?: AnimationName;
};

/**
 * What the panel should look like right now.
 *
 * Exported for its tests. Everything a person reads on the glass is decided
 * here, and until it was exported the only assertions available were on the
 * *byte count* that reached the wire — under which five of the six things this
 * puts on the panel could be destroyed outright with the whole suite green.
 *
 * The stage takes whatever frame the caller has to hand. An empty array is
 * still a complete scene — `scene.ts` documents that slots past the end stay
 * empty — which is what the tests want and what the panel shows for a state
 * whose animation has not been drawn yet.
 */
export function sceneFor(input: SceneInput): Scene {
  const { registry, pack, now } = input;
  const sprites = input.sprites ?? [];
  const panel = resolvePanel(registry, now);
  return {
    orientation: ORIENTATION,
    layout: 'hero',
    pack,
    sprites,
    status: {
      left: clockText(now),
      right: subagentText(panel.sessions),
    },
    sessions: panel.sessions.map((session) => chipFor(session, now)),
    message: messageFor(panel, pack, now),
    environment: {
      time: timeOfDay(now),
      extent: ENVIRONMENT_EXTENT,
      contact: input.animation === undefined || castsShadow(input.animation),
    },
  };
}

/**
 * The rectangle that changed, or nothing.
 *
 * A whole frame goes whenever the link owes one. `link.ts` sets `needsPrime`
 * from five places, three of them the device saying something: `afterOpen`
 * (connect), `afterClose` (the port went away) and `afterReport` (a resync, an
 * abort, or a counter that went backwards). The other two are the host deciding
 * for itself — `newLink` before the first frame, and `afterRefresh` on a
 * five-second timer,
 * which `panel.ts` runs precisely because the loss it covers is the one the
 * firmware cannot see. So a full 320x172 frame leaves here every five seconds
 * whether or not anything asked, and that is the design rather than a leak.
 *
 * Sending less than the whole screen for a prime does not satisfy it:
 * `afterWrite` refuses to clear `needsPrime` for anything smaller, so the debt
 * stays owed and the next frame primes again. (The 120-of-300-ticks figure
 * recorded in `transport.ts` and `link.ts` is a *different* mistake — priming
 * with frame 0 while the diff sequence had moved on. An earlier version of this
 * comment borrowed that number for this cause, which is not what it measured.)
 *
 * The whole rectangle is passed in rather than taken from
 * `protocol.fullScreenRect()`, which is 172x320 — the portrait panel. This
 * device is used landscape, so its framebuffer is 320x172 and the portrait
 * rectangle does not fit it: `extractRect` throws "rect 0,0 172x320 does not
 * fit a 320x172 frame", which is how this was found. `fullScreenRect` has no
 * way to know the orientation and the renderer's `panelSize` does, so the
 * caller supplies it.
 */
function changed(
  previous: Frame | undefined,
  next: Frame,
  whole: Rect,
): Rect | null {
  if (previous === undefined) return whole;
  return dirtyRect(previous, next);
}

/**
 * The panel, with its link status wired to somewhere a person will see it.
 *
 * `link.ts` composes a specific, actionable sentence for a firmware/panel
 * mismatch, and before this was passed the daemon computed it and dropped it —
 * writes stopped after the first frame, permanently, in silence, because
 * `panel.ts` never retries a refused link.
 *
 * Two things the first version of this got wrong, both measured:
 *
 * **It said nothing when the panel was not there at all** — the likeliest
 * failure of the lot, a wrong `/dev/cu.*` or a cable not seated. `onChange`
 * only fires on a *change* and `newLink` already starts at `offline`, so a
 * device that never opens never changes anything and the daemon retried once a
 * second in the dark. Hence the opening line, said before anything has
 * happened.
 *
 * **And it said far too much when the panel was there** — `needsPrime` is part
 * of the status, `panel.ts` sets it every five seconds and clears it on the
 * next write, so `onChange` fired twice a refresh: about 43,200 identical
 * `panel online` lines a day, which buries the one line worth reading.
 *
 * So `onChange` is not used at all. The paint loop already reads
 * `transport.status()` every tick and already carries state forward without a
 * mutable binding, so it carries the last line said too and reports only when
 * that changes. Polling also sees the case a change-callback cannot: a panel
 * that never arrives, and so never changes anything.
 */
function openReporting(
  options: DaemonOptions,
  size: { readonly width: number; readonly height: number },
  report: (line: string) => void,
): ReturnType<typeof openPanel> {
  report(`waiting for a panel on ${options.devicePath}`);
  return openPanel({
    path: options.devicePath,
    panel: size,
    serial: options.serial,
    refreshMs: options.refreshMs,
    retryMs: options.retryMs,
    giveUpAfter: options.giveUpAfter,
    onGiveUp: options.onGiveUp,
  });
}

/** What a person would want said about the link, right now. */
function linkLine(status: LinkStatus): string {
  // The refusal first, because it is the one that needs a person. The phase is
  // worth saying either way: "offline" with no explanation is what an unplugged
  // cable looks like, and so is a wrong firmware build.
  return status.refusal ?? `panel ${status.phase}`;
}

type Painter = {
  readonly transport: ReturnType<typeof openPanel>;
  readonly listener: Awaited<ReturnType<typeof startSocketServer>>;
  readonly pack: PackManifest;
  readonly now: () => number;
  readonly size: { readonly width: number; readonly height: number };
  readonly whole: Rect;
};

/**
 * One frame: resolve, pick Clawd's pose, render, diff, send.
 *
 * Lifted out of `runDaemon` because that function has a fifty-line budget and
 * this is the part of it worth reading on its own.
 */
async function paintOnce(
  ctx: Painter,
  previous: Frame | undefined,
): Promise<Frame | undefined> {
  const { transport, listener, pack, now, size, whole } = ctx;

  const status = transport.status();
  if (status.phase !== 'online') return previous;
  const at = now();
  const registry = listener.snapshot();
  const panel = resolvePanel(registry, at);
  // The animation for the state, and the frame of it the clock is on.
  //
  // `framesFor` resolves an unbaked name to nothing rather than throwing, and
  // the empty check below is what that buys. Both are currently unreachable:
  // `ANIMATIONS` is a subset of `SPRITE_NAMES`, so every name this can produce
  // has data behind it. Subset and not equality: an animation can be baked
  // before it is wired, which `overheated` did on 24 Aug (art 08:58, wiring
  // 12:01) and `board-game` did again on 25 Aug (art 11:07, wiring 12:23). Each
  // gap was hours. **The lists are not equal at HEAD** — `sweeping` baked on 25
  // Aug at 16:15 and is not in `ANIMATIONS`, because its state does not exist
  // yet. A moment when they *are* equal is exactly when this guard looks
  // deletable and is worst to be without. They are kept because the two lists are
  // maintained in different packages by different tools — `animation.ts` by
  // hand, `sprites/index.ts` by `bake-sprites.ts` — and
  // `animation.test.ts`'s "names only animations that have been baked" is what
  // turns a drift into a red test rather than an empty stage. The counts used
  // to be spelled out here and in two other files; they were "six" and then
  // "eight" within a week, so they are not spelled out any more.
  //
  // Earlier versions of this comment said three states fall back to
  // `thinking`, then one. None do: `dizzy` was the last, and `FALLBACK` is now
  // reached only from `WORKING`, with an unmapped tool or with no tool.
  const wanted = animationForPanel(panel);
  const frames = await framesFor(wanted);
  const showing =
    frames.length > 0
      ? frames.slice(frameAt(frames.length, at)).slice(0, 1)
      : [];
  const next = frame(
    render(
      sceneFor({
        registry,
        pack,
        now: at,
        sprites: showing,
        animation: wanted,
      }),
    ).pixels,
    size.width,
  );
  const rect = status.needsPrime ? whole : changed(previous, next, whole);
  if (rect !== null) {
    await transport.send(rect, encodeRect(extractRect(next, rect)));
  }
  return next;
}

type Painting = {
  readonly transport: ReturnType<typeof openPanel>;
  readonly report: (line: string) => void;
  readonly frameMs: number;
  readonly aborted: () => boolean;
  readonly paint: (previous: Frame | undefined) => Promise<Frame | undefined>;
};

/**
 * Paint, say anything worth saying, then schedule the next one from the timer.
 *
 * **Scheduling from the timer rather than awaiting is the difference between
 * this and a memory leak.** Written as `return loop(...)` inside an `async`
 * function, every iteration awaits the next, so the promise chain never unwinds
 * and each frame permanently adds a suspended context.
 *
 * **State the tick rate with any figure here.** The retention is per *frame*,
 * about 83 bytes of it, so a measurement is meaningless without one — and the
 * first version of this comment gave "8.06 -> 9.41 MB over eighteen seconds"
 * (taken at `frameMs: 0`, the fastest tick the loop allows) next to "63 MB a
 * day at 8fps", which are the same defect described at rates two orders apart.
 * A reviewer who tried to reproduce the eighteen-second figure at 8fps saw
 * nothing, which is the worst outcome a measured claim can have.
 *
 * So: 83 bytes a frame, which is ~57 MB a day at the shipping 8fps, in a
 * process `BUILD_PLAN.md` intends to run under launchd. Handing the
 * continuation to `setTimeout` lets each iteration settle and start the next
 * from a fresh context — 0.035 MB over sixty seconds at `frameMs: 0`, flat.
 *
 * Both pieces of state — the frame on the glass and the last thing said about
 * the link — are passed forward rather than held. Note that avoiding a `let`
 * was never the point: `docs/CONVENTIONS.md` §"Holding mutable state" specifies
 * a budget of one disable, not a clean sheet, and reading it as a purity score
 * is what produced the leak in the first place. This shape happens to need
 * neither.
 */
async function painting(
  ctx: Painting,
  previous?: Frame,
  said?: string,
): Promise<void> {
  if (ctx.aborted()) return;
  const line = linkLine(ctx.transport.status());
  if (line !== said) ctx.report(line);
  // A frame that fails is one frame, and the panel is repainted eight times a
  // second. `openPanel` already survives an unplugged device, so there is
  // nothing here worth stopping the daemon over — but it must carry on from the
  // frame it last *sent*, which on a failure is the one before.
  const shown = await ctx.paint(previous).catch(() => previous);
  setTimeout(() => {
    void painting(ctx, shown, line);
  }, ctx.frameMs).unref();
}

export async function runDaemon(
  options: DaemonOptions,
): Promise<RunningDaemon> {
  const pack = parsePackManifest(options.pack);
  const now = options.now ?? Date.now;
  const size = panelSize(ORIENTATION);
  const whole: Rect = { x: 0, y: 0, width: size.width, height: size.height };

  const listener = await startSocketServer({
    path: options.socketPath,
    now,
  });
  const report =
    options.report ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  const transport = openReporting(options, size, report);

  /**
   * One frame, given what the panel is already showing. Returns what it shows
   * now, which is the only state this loop carries — passed forward rather than
   * held, so nothing here needs a mutable binding and the package keeps its
   * clean sheet against `docs/CONVENTIONS.md` §"Holding mutable state".
   */
  const paint = (previous: Frame | undefined): Promise<Frame | undefined> =>
    paintOnce({ transport, listener, pack, now, size, whole }, previous);

  const stopping = new AbortController();
  void painting({
    transport,
    report,
    frameMs: options.frameMs ?? FRAME_MS,
    aborted: () => stopping.signal.aborted,
    paint,
  });

  return {
    stop: async () => {
      stopping.abort();
      await listener.close();
      await transport.close();
    },
  };
}
