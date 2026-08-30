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
    // **All nine rows, because three of them were asserted by nothing.** The
    // table has nine states and this test pinned six, so flipping `DONE`,
    // `COMPACTING` or `FAILED` to true was invisible to the whole suite — the
    // picture could have covered a failed session at three in the morning with
    // every gate green. `BIRTHDAY_COVERS` records the repo catching this once
    // already; a total record is only worth having if the test is total too.
    expect(SCENE_COVERS).toEqual({
      IDLE: true,
      ASLEEP: true,
      DONE: false,
      WORKING: false,
      THINKING: false,
      COMPACTING: false,
      NEEDS_PERMISSION: false,
      WAITING: false,
      FAILED: false,
    });
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
    expect(
      coverFor({ pack: pack, state: 'IDLE', now: threeAm, animation: 'idle' }),
    ).toEqual(scene);
    expect(
      coverFor({
        pack: pack,
        state: 'WORKING',
        now: threeAm,
        animation: 'typing',
      }),
    ).toBeUndefined();
    expect(
      coverFor({ pack: pack, state: 'IDLE', now: teaTime, animation: 'idle' }),
    ).toBeUndefined();
    expect(
      coverFor({ pack: bare, state: 'IDLE', now: threeAm, animation: 'idle' }),
    ).toBeUndefined();
  });

  it('is opt-in, so a pack with no scene is unchanged at every hour', () => {
    // `packs/example` carries no scene and must not: the picture is of two
    // real people. A pack without one renders exactly as it did before this
    // feature existed.
    expect(
      coverFor({
        pack: bare,
        state: 'ASLEEP',
        now: threeAm,
        animation: 'asleep',
      }),
    ).toBeUndefined();
    expect(
      coverFor({
        pack: bare,
        state: 'ASLEEP',
        now: teaTime,
        animation: 'asleep',
      }),
    ).toBeUndefined();
  });
});

describe('the birthday outranks the scene', () => {
  const scene = { width: 8, height: 8, pixels: 'AAA=', mask: 'AAA=' };
  const pack = { scene } as unknown as PackManifest;
  const threeAm = new Date(2026, 8, 4, 3).getTime();

  it('yields on the birthday, when both tables fire on the same states', () => {
    // `SCENE_COVERS` and `BIRTHDAY_COVERS` are byte-identical, so between
    // midnight and five on 23 Sep they fire together. The scene used to win by
    // drawing later — and silently, because `daemon.ts` still shows the QR,
    // which is tied to the birthday decision. The panel would have carried a
    // birthday QR beneath a picture that was not the birthday screen.
    expect(
      coverFor({
        pack: pack,
        state: 'IDLE',
        now: threeAm,
        animation: 'birthday',
      }),
    ).toBeUndefined();
    expect(
      coverFor({ pack: pack, state: 'IDLE', now: threeAm, animation: 'idle' }),
    ).toEqual(scene);
    expect(
      coverFor({
        pack: pack,
        state: 'IDLE',
        now: threeAm,
        animation: undefined,
      }),
    ).toEqual(scene);
  });
});
