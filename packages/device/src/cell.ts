/**
 * One mutable cell, and the only mutation in this package.
 *
 * `functional/no-let` and `immutable-data` are on here — they are switched off
 * only in `protocol` and `renderer`, where framebuffer work requires mutation.
 * A transport genuinely has to hold "now": which port is open, what the device
 * last said, whether a write is in flight. The alternatives were a class,
 * which the `ignoreClasses` escape hatch would have hidden the mutation
 * behind, or scattering `let` through the supervisor.
 *
 * This is the third option: every decision stays a pure fold in `link.ts`, and
 * the state those folds produce is held in one place, in six lines, behind a
 * disable that says so. `grep -rn 'eslint-disable' packages/device` is the
 * audit.
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
