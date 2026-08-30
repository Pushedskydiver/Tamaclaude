import type { PackManifest } from '@tamaclaude/packs';

import { describe, expect, it } from 'vitest';

import { coverFor, isSmallHours, SCENE_COVERS } from './midnight.js';

describe('the midnight scene', () => {
  /** Local-time helper: the panel's day is the day of whoever is beside it. */
  const at = (hour: number, minute = 0) =>
    new Date(2026, 8, 4, hour, minute).getTime();

  it('shows in the small hours and not in the evening', () => {
    // **The trigger is the frozen spec's, not the plan's.** The spec says
    // "session running past midnight"; `BUILD_PLAN.md` said "birthday, past
    // midnight", which would fire only if somebody happened to have a session
    // alive after midnight on one specific night — a coin flip on whether the
    // rarest art in the project is ever seen, on the day the birthday screen
    // already owns the stage. Settled 30 Aug in favour of the spec.
    // **Not vacuous only because `vitest.config.ts` pins Europe/London.** Under
    // UTC local time *is* UTC and a `getUTCHours` mutant survives every
    // assertion below — the precise trap `packages/packs/src/index.test.ts`
    // documents having fallen into once. This offset assertion fails loudly if
    // the pin is lost or these dates move into a month when London is UTC,
    // rather than letting the file go green against the bug it exists to catch.
    expect(new Date(2026, 8, 4).getTimezoneOffset()).not.toBe(0);
    expect(isSmallHours(at(0, 1))).toBe(true);
    expect(isSmallHours(at(3))).toBe(true);
    expect(isSmallHours(at(4, 59))).toBe(true);
    // Not the evening, however late it feels.
    expect(isSmallHours(at(23, 59))).toBe(false);
    // And not the morning, which is somebody up early rather than up late.
    expect(isSmallHours(at(5))).toBe(false);
    expect(isSmallHours(at(9))).toBe(false);
  });

  it('covers the resting states and leaves work visible', () => {
    // The same division `BIRTHDAY_COVERS` makes, for the same reason: while
    // something is happening the stage has to show it. The scene fills the
    // gaps — which is when somebody working at 3am actually looks up.
    expect(SCENE_COVERS.IDLE).toBe(true);
    expect(SCENE_COVERS.ASLEEP).toBe(true);
    expect(SCENE_COVERS.WORKING).toBe(false);
    expect(SCENE_COVERS.THINKING).toBe(false);
    expect(SCENE_COVERS.NEEDS_PERMISSION).toBe(false);
    expect(SCENE_COVERS.WAITING).toBe(false);
  });
});

describe('coverFor', () => {
  const scene = { width: 8, height: 8, pixels: 'AAA=', mask: 'AAA=' };
  const pack = { scene } as unknown as PackManifest;
  const bare = {} as unknown as PackManifest;
  const threeAm = new Date(2026, 8, 4, 3).getTime();
  const teaTime = new Date(2026, 8, 4, 17).getTime();

  it('needs all three: the hour, a resting state, and a pack that has one', () => {
    // Mutated one at a time rather than as a block. A single mutant on the
    // whole condition dies on whichever term it happens to hit first and
    // proves nothing about the other two — which is exactly how the `dev` half
    // of `isSameFile` went untested until a review found it.
    expect(coverFor(pack, 'IDLE', threeAm)).toEqual(scene);
    expect(coverFor(pack, 'WORKING', threeAm)).toBeUndefined();
    expect(coverFor(pack, 'IDLE', teaTime)).toBeUndefined();
    expect(coverFor(bare, 'IDLE', threeAm)).toBeUndefined();
  });

  it('is opt-in, so a pack with no scene is unchanged at every hour', () => {
    // `packs/example` carries no scene and must not: the picture is of two
    // real people. A pack without one renders exactly as it did before this
    // feature existed.
    expect(coverFor(bare, 'ASLEEP', threeAm)).toBeUndefined();
    expect(coverFor(bare, 'ASLEEP', teaTime)).toBeUndefined();
  });
});
