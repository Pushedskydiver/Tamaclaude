/**
 * The pack fields this repo's art can land in, for the baker and its gate.
 *
 * Split out of `tools/logo2pixel.ts` for the reason `tools/splash-source.ts`
 * was split out of `tools/bake-splash.ts`: the baker is a script with
 * top-level `await` and a `process.exit` on bad arguments, so importing it
 * from a test runs it. The constant has to live somewhere a test can reach.
 *
 * A hand-copy of `LID_SLOT` and `PET_SLOT` in the renderer, because `tools/`
 * sits outside the dependency graph `eslint-plugin-boundaries` enforces.
 * `logo2pixel.test.ts` imports both sides and asserts they agree, which is
 * what stops the copy drifting — it was wrong once already, naming only the
 * lid and telling anyone baking a pet that "the pack schema will refuse it",
 * which was false of the field the pet actually goes in.
 */
export const SLOTS = [
  { name: 'lid', width: 84, height: 20 },
  { name: 'pet', width: 36, height: 22 },
] as const;
