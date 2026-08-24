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
    // person in front of it is still on the 22nd, or vice versa. Built from
    // local components on purpose, so the assertion holds in any timezone the
    // suite runs in — including CI.
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

  it('accepts 02-29 rather than pretending it is not a birthday', () => {
    // It parses, and it simply never matches in a common year. Refusing it at
    // the boundary would be the schema deciding something about the person
    // rather than about the format.
    const leap = parsePackManifest({
      ...valid,
      birthday: { date: '02-29', quip: 'happy birthday' },
    });
    expect(isBirthday(leap, new Date(2028, 1, 29, 12).getTime())).toBe(true);
    expect(isBirthday(leap, new Date(2027, 1, 28, 12).getTime())).toBe(false);
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
