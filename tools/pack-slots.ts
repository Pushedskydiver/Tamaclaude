/**
 * The pack fields this repo's art can land in, for the baker and its gate.
 *
 * Split out of `tools/logo2pixel.ts` for the reason `tools/splash-source.ts`
 * was split out of `tools/bake-splash.ts`: the baker is a script with
 * top-level `await`, so importing it from a test runs it. `logo2pixel.ts`
 * also calls `process.exit` on bad arguments, which `bake-splash.ts` does
 * not — a first version of this line attributed that to both. The constant has to live somewhere a test can reach.
 *
 * A hand-copy of `LID_SLOT`, `PET_SLOT` and `COVER_SLOT` in the renderer,
 * because `tools/` sits outside the dependency graph
 * `eslint-plugin-boundaries` enforces.
 *
 * **`scene` is last, and the reason is smaller than the first version claimed.**
 * The list reads smallest-first by area and by height — not by width, where
 * the pet is narrower than the lid — so the tightest slot a picture could be
 * meant for prints first. That is readability, not correctness: the fit check
 * is a `filter`, so every matching slot is named whatever the order, and the
 * no-fit warning lists them all regardless. This comment said putting `scene`
 * first "would make the warning useless", which a critic disproved by running
 * it — a 40x28 bake would simply read `"scene" or "pet"` instead, both true.
 * `logo2pixel.test.ts` imports both sides and asserts they agree, which is
 * what stops the copy drifting.
 *
 * It has now been incomplete twice, which is the argument for the test rather
 * than for care: the `scene` field reached the schema, the painter and the
 * daemon before anything told the baker it existed, so a valid full-stage
 * cover was reported as fitting no slot at all.
 *
 * The warning it feeds named only the lid and told anyone baking a pet that
 * "the pack schema will refuse it". **That was misleading rather than false**,
 * and the distinction is worth keeping: no `pet` field existed on any shipped
 * commit, so there was nothing for it to be false about. It was wrong about a
 * working tree, which is a thing nobody reading this repo can check — and
 * three other files stated it as history before a review pointed that out.
 */
export const SLOTS = [
  { name: 'lid', width: 84, height: 20 },
  { name: 'pet', width: 60, height: 42 },
  { name: 'scene', width: 168, height: 160 },
] as const;
