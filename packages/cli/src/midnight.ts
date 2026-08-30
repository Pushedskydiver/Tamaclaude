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
import type { SessionState } from '@tamaclaude/daemon';
import type { PackManifest } from '@tamaclaude/packs';

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
export function coverFor(
  pack: PackManifest,
  state: SessionState,
  now: number,
): PackManifest['scene'] {
  if (!SCENE_COVERS[state]) return undefined;
  return isSmallHours(now) ? pack.scene : undefined;
}
