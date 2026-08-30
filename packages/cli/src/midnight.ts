/**
 * The rare scene: when it may cover the stage.
 *
 * **Its own module, not a pair of exports in `daemon.ts`.** Two things pushed
 * it here and they agree. `max-lines` put `daemon.ts` twelve lines over 300,
 * and the first attempt at squeezing it in landed the block between
 * `animationForPanel`'s doc comment and `animationForPanel`, orphaning a
 * comment that had a great deal to say — which `tools/detached-docs.test.ts`
 * caught, being a gate that exists for exactly that. A file with no room for a
 * thing is telling you where the thing goes.
 *
 * What is *not* here is the art. The scene depicts two real people, so
 * `CLAUDE.md` puts it in the recipient's private pack as a blob beside `logo`
 * and `pet`; this repo carries the trigger, the slot and the tests, and names
 * the picture by its role.
 */
import type { AnimationName, SessionState } from '@tamaclaude/daemon';
import type { PackManifest } from '@tamaclaude/packs';

import { castsShadow } from '@tamaclaude/renderer';

/**
 * When "past midnight" is, for the rare scene the pack may carry.
 *
 * **Local time, for the reason `isBirthday` is local**: the night somebody is
 * having is the one they are having beside the panel, not the one UTC is
 * having. A test that builds local dates and compares them against a function
 * reading UTC passes by comparing a value with itself — a mistake this repo
 * has made once, and one CI cannot catch, being `ubuntu-latest` with no `TZ`.
 *
 * Midnight to five. The upper bound is a judgement and worth saying so: it
 * separates somebody still up from somebody up early, and five is where that
 * stops being obvious in either direction. The lower bound is not a judgement
 * — "past midnight" starts at midnight.
 */
export function isSmallHours(now: number): boolean {
  return new Date(now).getHours() < SMALL_HOURS_END;
}

/** Five in the morning; see `isSmallHours` for why it is a judgement. */
const SMALL_HOURS_END = 5;

/**
 * Which states the pack's scene may cover.
 *
 * **The same division `BIRTHDAY_COVERS` makes, and for its reason**: while
 * something is happening the stage has to show it, because here the picture
 * *is* the stage. The scene fills the gaps rather than replacing the work,
 * which is also when somebody coding at three in the morning looks up.
 *
 * The frozen spec's trigger is "session running past midnight", and a session
 * that is `IDLE` or `ASLEEP` is still running — those states describe the desk,
 * not the daemon. `BUILD_PLAN.md` said "birthday, past midnight" instead, which
 * would have fired at most once ever, and only if somebody happened to be at
 * the keyboard after midnight on the one night the birthday screen already owns
 * the stage. Settled 30 Aug in favour of the spec.
 */
export const SCENE_COVERS: Readonly<Record<SessionState, boolean>> = {
  IDLE: true,
  ASLEEP: true,
  // A bounded window that falls through to `IDLE`, so the scene follows it
  // seconds later rather than taking a real event's picture away.
  DONE: false,
  WORKING: false,
  THINKING: false,
  COMPACTING: false,
  // Asking for a human. At three in the morning the panel saying when to look
  // matters more, not less.
  NEEDS_PERMISSION: false,
  WAITING: false,
  FAILED: false,
};

/**
 * The pack's scene, if this is a moment to show it.
 *
 * Two conditions decide it, and a third needs no line:
 *
 * - **The state is resting.** `SCENE_COVERS` says which, and the reason is that
 *   this picture *is* the stage rather than a prop on it.
 * - **It is the small hours.** The frozen spec's trigger, local.
 * - **The pack carries one** — which costs nothing to check, because returning
 *   `pack.scene` returns `undefined` when there is none. An explicit
 *   `if (pack.scene === undefined) return undefined` stood here until a mutant
 *   deleting it left every test green: it was not an untested branch, it was a
 *   branch that could not change an answer. The feature is opt-in either way,
 *   and `packs/example` carries no scene.
 *
 * A single function rather than the condition open-coded at the call site, so
 * each term can be mutated on its own. That matters more than it looks: a
 * mutant planted on a whole `&&` chain dies on whichever term it reaches first
 * and proves nothing about the rest, which is how the device half of the log
 * rotation's identity check went untested until a review found it.
 */
export function coverFor(input: {
  readonly pack: PackManifest;
  readonly state: SessionState;
  readonly now: number;
  readonly animation?: AnimationName | undefined;
}): PackManifest['scene'] {
  const { pack, state, now, animation } = input;
  // **The birthday outranks it, and this is where that is settled.**
  // `SCENE_COVERS` and `BIRTHDAY_COVERS` are the same table — `IDLE` and
  // `ASLEEP`, and nothing else — so between midnight and five on 23 Sep they
  // fire together. Not "resting states": `TONE` counts `DONE` as resting and
  // both tables deliberately exclude it, which `BIRTHDAY_COVERS`'s own doc
  // closes by warning about. Without this line the scene wins by drawing later, and
  // it wins silently: `daemon.ts` still shows the QR, which is tied to the
  // birthday decision, so the panel would carry a birthday QR under a picture
  // that is not the birthday screen.
  //
  // Asked of the animation rather than of `isBirthday`, deliberately.
  // `daemon.ts` says of the QR that "a second `isBirthday` call here would be a
  // second rule to keep in step with the first", and that reasoning binds this
  // caller too — `animationForPanel` has already decided the date and the state
  // together, so this reads its answer instead of re-deriving it.
  if (animation === 'birthday') return undefined;
  if (!SCENE_COVERS[state]) return undefined;
  return isSmallHours(now) ? pack.scene : undefined;
}

/**
 * What a cover does to the stage: the picture, and whether a shadow survives.
 *
 * **One call, because the two answers are one decision.** A scene replaces the
 * character, so the contact shadow — the mark of where his feet meet the
 * ground — would be cast by nobody. The schema invites scenes smaller than the
 * stage, so that orphan shadow would sit in plain sight beside one.
 *
 * Returning both from here rather than deciding them separately in
 * `daemon.ts` is also what keeps that file under `max-lines`, which is the
 * second time today a file with no room has been right about where code goes.
 */
export function stageCoverFor(
  input: {
    readonly pack: PackManifest;
    readonly now: number;
    readonly animation?: AnimationName | undefined;
  },
  state: SessionState,
): {
  readonly cover: PackManifest['scene'];
  readonly contact: boolean;
} {
  const { animation } = input;
  const cover = coverFor({ ...input, state });
  const shadow = animation === undefined || castsShadow(animation);
  return { cover, contact: cover === undefined && shadow };
}
