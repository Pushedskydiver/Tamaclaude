/**
 * One mutable cell, and the only mutation in this package.
 *
 * `functional/no-let` and `immutable-data` are on here. They are switched off
 * in `protocol` and `renderer`, where framebuffer work requires mutation, in
 * `tools/`, which drives a browser sequentially, and in every package's test
 * files. None of those exemptions reach this file.
 * A transport genuinely has to hold "now": which port is open, what the device
 * last said, whether a write is in flight. The alternatives were a class,
 * which the `ignoreClasses` escape hatch would have hidden the mutation
 * behind, or scattering `let` through the supervisor.
 *
 * This is the third option: every decision stays a pure fold in `link.ts`, and
 * the state those folds produce is held in one place, behind a disable that
 * says so. `tools/disable-budget.test.ts` is the audit, and it is a test rather
 * than a grep on purpose: pointed at `packages/device` rather than
 * `packages/device/src` a grep also returns the copies in `dist/`, which is how
 * the one this comment used to recommend reported two disables in a package
 * that has one. Nor can a grep tell a directive from a sentence mentioning one
 * — the test anchors on the comment *beginning* with the word, so it can.
 * Reading the parser's comments rather than the file's text buys a different
 * thing: a directive-shaped string inside a literal is not a comment at all.
 *
 * That first point used to be made by this paragraph containing the word and
 * being matched by it. A rewrite took the word out and left the claim standing;
 * the correction then credited the parser for the anchor's work. Two passes,
 * two wrong sentences, over a conclusion that was right the whole time — which
 * is the thing this file is otherwise careful about.
 */

export type Cell<T> = {
  readonly read: () => T;
  readonly write: (value: T) => void;
};

export function cell<T>(initial: T): Cell<T> {
  // The disable has to be one line, or it lands on the second line of itself
  // and silently does nothing — which is how this was first written.
  // eslint-disable-next-line functional/no-let -- see the module comment. Deliberately the only one in this package.
  let held = initial;
  return {
    read: () => held,
    write: (value: T) => {
      held = value;
    },
  };
}
