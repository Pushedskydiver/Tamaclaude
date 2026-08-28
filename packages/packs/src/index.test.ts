/**
 * The pack manifest is untrusted input.
 *
 * `docs/DA-REVIEW.md` calls it out by name: a pack is a file a user writes,
 * and this is the boundary where it stops being arbitrary JSON. These tests
 * exist because the package had none, and a validation boundary with no tests
 * is a validation boundary nobody has checked can fail.
 */
import { describe, expect, it } from 'vitest';

import { isBirthday, packPalette, parsePackManifest } from './index.js';

const valid = {
  name: 'example',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
};

describe('parsePackManifest', () => {
  it('accepts a manifest with a background and an ink', () => {
    expect(parsePackManifest(valid).palette).toHaveLength(2);
  });

  it('refuses a palette of one, which renders an invisible panel', () => {
    // Entry 0 is the background and entry 1 is the ink. A pack carrying only a
    // background is schema-valid nonsense: every glyph and chip is drawn in
    // the background colour and the panel comes up blank with no error. The
    // renderer deliberately will not invent a colour the pack does not
    // contain, so refusing it has to happen here.
    expect(() =>
      parsePackManifest({ ...valid, palette: [[0, 0, 0]] }),
    ).toThrow(/background and an ink/);
  });

  it('refuses a channel outside 0..255', () => {
    expect(() =>
      parsePackManifest({
        ...valid,
        palette: [
          [0, 0, 0],
          [256, 0, 0],
        ],
      }),
    ).toThrow();
  });

  it('refuses a nameless pack', () => {
    expect(() => parsePackManifest({ ...valid, name: '' })).toThrow();
  });
});

describe('packPalette', () => {
  it('converts each triple to RGB565, background first', () => {
    const palette = packPalette(parsePackManifest(valid));
    expect(palette[0]).toBe(0x0000);
    expect(palette[1]).toBe(0xffff);
  });
});

describe('the birthday', () => {
  it('is the one day the pack can name', () => {
    // A birthday is a property of *today*, not of a session, so it is not a
    // `SessionState` — it would force an entry in every table keyed on one and
    // make `effectiveState` know about dates. It lives in the pack because that
    // is where personal content lives, and because a pack that can say when the
    // day is is what makes the swap mechanism real.
    const pack = parsePackManifest({
      ...valid,
      birthday: { date: '09-23', quip: 'happy birthday' },
    });
    const on = new Date(2026, 8, 23, 9, 0, 0).getTime();
    const before = new Date(2026, 8, 22, 23, 59, 59).getTime();
    const after = new Date(2026, 8, 24, 0, 0, 1).getTime();
    expect(isBirthday(pack, on)).toBe(true);
    expect(isBirthday(pack, before)).toBe(false);
    expect(isBirthday(pack, after)).toBe(false);
  });

  it('turns over at local midnight, not UTC', () => {
    // The bug this is here to catch: comparing in UTC puts the day an hour or
    // thirteen out depending on the offset, so the panel celebrates while the
    // person in front of it is still on the 22nd, or vice versa.
    //
    // **This test is vacuous under UTC**, where local time *is* UTC and every
    // assertion below compares a value with itself. An earlier version of this
    // comment claimed the opposite — that building from local components made
    // it hold "in any timezone the suite runs in, including CI" — which was
    // true and worthless: CI is `ubuntu-latest` with no `TZ`. A review planted
    // `getUTCMonth`/`getUTCDate` and every test in this file stayed green.
    //
    // `vitest.config.ts` now pins Europe/London. The offset assertion is the
    // point: it fails loudly if that pin is lost, or if these dates ever move
    // into a month when London *is* UTC, instead of letting this go quietly
    // green against the one bug it exists to catch.
    expect(new Date(2026, 8, 23).getTimezoneOffset()).not.toBe(0);
    const pack = parsePackManifest({
      ...valid,
      birthday: { date: '09-23', quip: 'happy birthday' },
    });
    const lastMoment = new Date(2026, 8, 22, 23, 59, 59, 999).getTime();
    const firstMoment = new Date(2026, 8, 23, 0, 0, 0, 0).getTime();
    const lastOfTheDay = new Date(2026, 8, 23, 23, 59, 59, 999).getTime();
    expect(isBirthday(pack, lastMoment)).toBe(false);
    expect(isBirthday(pack, firstMoment)).toBe(true);
    expect(isBirthday(pack, lastOfTheDay)).toBe(true);
    expect(isBirthday(pack, lastOfTheDay + 1)).toBe(false);
  });

  it('recurs, because a birthday has no year', () => {
    const pack = parsePackManifest({
      ...valid,
      birthday: { date: '09-23', quip: 'happy birthday' },
    });
    for (const year of [2026, 2027, 2031]) {
      expect(isBirthday(pack, new Date(year, 8, 23, 12).getTime())).toBe(true);
    }
  });

  it('celebrates a 29 February birthday on the 28th in a common year', () => {
    // The schema comment argues that "a pack that silently never fires is the
    // failure that cannot be noticed until the day has passed", and this test
    // used to assert exactly that failure — accepting `02-29` and then doing
    // nothing in three years out of four. A review caught the contradiction.
    //
    // 28 February rather than 1 March: it keeps a February birthday in
    // February, and the asymmetry decides it — silence is invisible and
    // unrecoverable on the day, while a fallback is at worst one day's
    // disagreement with a preference, and it is visible.
    const leap = parsePackManifest({
      ...valid,
      birthday: { date: '02-29', quip: 'happy birthday' },
    });
    // 2028 has the day, so the 28th is not it — the real one is tomorrow.
    expect(isBirthday(leap, new Date(2028, 1, 29, 12).getTime())).toBe(true);
    expect(isBirthday(leap, new Date(2028, 1, 28, 12).getTime())).toBe(false);
    // 2027 does not, so the 28th stands in.
    expect(isBirthday(leap, new Date(2027, 1, 28, 12).getTime())).toBe(true);
    // 2100 is divisible by 4 and is not a leap year.
    expect(isBirthday(leap, new Date(2100, 1, 28, 12).getTime())).toBe(true);
    // 2000 is divisible by 100 and is one.
    expect(isBirthday(leap, new Date(2000, 1, 28, 12).getTime())).toBe(false);
    expect(isBirthday(leap, new Date(2000, 1, 29, 12).getTime())).toBe(true);
    // And it does not leak into a neighbouring day in either kind of year.
    expect(isBirthday(leap, new Date(2027, 2, 1, 12).getTime())).toBe(false);
    expect(isBirthday(leap, new Date(2027, 1, 27, 12).getTime())).toBe(false);
  });

  it('refuses a day that exists in no year', () => {
    // The regex alone accepts all six of these. Each would validate, ship, and
    // then never fire — the exact failure the schema comment above refuses,
    // and unlike `02-29` there is no year in which they are real.
    for (const date of ['02-30', '02-31', '04-31', '06-31', '09-31', '11-31']) {
      expect(() =>
        parsePackManifest({ ...valid, birthday: { date, quip: 'x' } }),
      ).toThrow();
    }
    // All twelve legal end-of-month days still pass, so this is not merely
    // stricter. The first version of this loop tested four of the twelve and
    // called them "the legal end-of-month days" — the sample was the thing
    // that was wrong, not the behaviour, which is the harder kind to notice.
    for (const date of [
      '01-31',
      '02-29',
      '03-31',
      '04-30',
      '05-31',
      '06-30',
      '07-31',
      '08-31',
      '09-30',
      '10-31',
      '11-30',
      '12-31',
    ]) {
      expect(() =>
        parsePackManifest({ ...valid, birthday: { date, quip: 'x' } }),
      ).not.toThrow();
    }
  });

  it('refuses a date that is not MM-DD, at the boundary', () => {
    for (const date of ['9-23', '2026-09-23', '13-01', '09-32', '', 'birthday']) {
      expect(() =>
        parsePackManifest({ ...valid, birthday: { date, quip: 'x' } }),
      ).toThrow();
    }
  });

  it('is optional, and a pack without one never celebrates', () => {
    expect(isBirthday(parsePackManifest(valid), Date.now())).toBe(false);
  });
});

describe('a pack pet', () => {
  const base = {
    name: 'p',
    palette: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    quips: { mapped: {}, idle: [] },
  };
  const pet = { width: 32, height: 22, pixels: 'AAA=', mask: 'AAA=' };

  it('is optional, and a pack without one is unchanged', () => {
    expect(parsePackManifest(base).pet).toBeUndefined();
  });

  it('is accepted when it carries dimensions and both payloads', () => {
    expect(parsePackManifest({ ...base, pet }).pet).toEqual(pet);
  });

  it('refuses one larger than the ground it stands on', () => {
    // 60x42 is `PET_SLOT`. Wider and the prop competes with the character
    // rather than sitting in front of him; taller and its top row crosses his
    // face rather than his legs.
    expect(() =>
      parsePackManifest({ ...base, pet: { ...pet, width: 61 } }),
    ).toThrow();
    expect(() =>
      parsePackManifest({ ...base, pet: { ...pet, height: 43 } }),
    ).toThrow();
  });

  it('accepts one exactly the size of the slot', () => {
    // The logo's own bound is 20 high and the pet is 22, so a schema copied
    // from it refuses the art it was added for.
    const full = { ...pet, width: 60, height: 42 };
    expect(parsePackManifest({ ...base, pet: full }).pet).toEqual(full);
  });

  it('refuses an empty payload, which would show nothing and say nothing', () => {
    expect(() =>
      parsePackManifest({ ...base, pet: { ...pet, pixels: '' } }),
    ).toThrow();
    expect(() =>
      parsePackManifest({ ...base, pet: { ...pet, mask: 'not base64!' } }),
    ).toThrow();
  });
});

describe('a pack logo', () => {
  const base = {
    name: 'p',
    palette: [
      [0, 0, 0],
      [255, 255, 255],
    ],
    quips: { mapped: {}, idle: [] },
  };
  const logo = { width: 12, height: 14, pixels: 'AAA=', mask: 'AAA=' };

  it('is optional, and a pack without one is unchanged', () => {
    expect(parsePackManifest(base).logo).toBeUndefined();
  });

  it('is accepted when it carries dimensions and both payloads', () => {
    expect(parsePackManifest({ ...base, logo }).logo).toEqual(logo);
  });

  it('refuses a mark too large for the lid it is drawn on', () => {
    // The lid face is 84x20 device pixels and the mark is blitted at a fixed
    // slot inside it, so anything larger is drawn over the laptop and the
    // crab. Clipping would hide it silently; refusing says which field is
    // wrong, at the boundary where the pack is parsed.
    expect(() => parsePackManifest({ ...base, logo: { ...logo, width: 85 } })).toThrow();
    expect(() => parsePackManifest({ ...base, logo: { ...logo, height: 21 } })).toThrow();
  });

  it('refuses a zero dimension, which encodes to nothing at all', () => {
    expect(() => parsePackManifest({ ...base, logo: { ...logo, width: 0 } })).toThrow();
  });

  it('refuses a payload that is not base64', () => {
    expect(() => parsePackManifest({ ...base, logo: { ...logo, pixels: 'not base64!' } })).toThrow();
  });
});
