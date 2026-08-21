import { describe, expect, it } from 'vitest';

import { lostGround, NO_COUNTERS, parseReport, splitLines } from './report.js';

/** A real line, copied from a run against the board. */
const LINE = '# rects 812 resync 0/0 abort 0 panel 320x172 landscape';

describe('parseReport', () => {
  it('reads every field of a real status line', () => {
    expect(parseReport(LINE)).toEqual({
      rects: 812,
      resyncs: 0,
      dropped: 0,
      aborts: 0,
      width: 320,
      height: 172,
      orientation: 'landscape',
    });
  });

  it('reads a portrait build, which is the mismatch we have to catch', () => {
    expect(
      parseReport('# rects 0 resync 0/3 abort 0 panel 172x320 portrait'),
    ).toMatchObject({ width: 172, height: 320, orientation: 'portrait' });
  });

  it('tolerates the trailing newline the line arrives with', () => {
    expect(parseReport(`${LINE}\r\n`)?.rects).toBe(812);
  });

  it('rejects anything that is not a status line', () => {
    // Boot chatter shares the link. IDF logs, the splash message and any
    // half-line left by a reset all come down the same endpoint.
    expect(parseReport('I (312) blitter: panel ready')).toBeUndefined();
    expect(parseReport('')).toBeUndefined();
    expect(parseReport('# rects 812 resync 0/0 abort 0')).toBeUndefined();
  });
});

describe('lostGround', () => {
  const healthy = { rects: 100, resyncs: 0, dropped: 0, aborts: 0 };

  it('says nothing was lost when only the rect count climbs', () => {
    expect(lostGround(healthy, { ...healthy, rects: 200 })).toBe(false);
  });

  it('notices a resync, a discard and an abort', () => {
    expect(lostGround(healthy, { ...healthy, resyncs: 1 })).toBe(true);
    expect(lostGround(healthy, { ...healthy, dropped: 16 })).toBe(true);
    expect(lostGround(healthy, { ...healthy, aborts: 1 })).toBe(true);
  });

  it('notices a reset on a device that had never lost a packet', () => {
    // The case `tools/blit.ts` cannot see. Its test was `resyncs !== last ||
    // aborts !== last`, and on a board sitting at 0/0/0 — the healthy state —
    // a reset leaves both at 0. Only `rects` falling gives it away.
    expect(lostGround(healthy, NO_COUNTERS)).toBe(true);
  });
});

describe('splitLines', () => {
  it('holds a line that straddles two reads', () => {
    const first = splitLines('', '# rects 1 resync 0/0 abo');
    expect(first.lines).toEqual([]);
    const second = splitLines(first.pending, 'rt 0 panel 320x172 landscape\n');
    expect(second.lines).toEqual([
      '# rects 1 resync 0/0 abort 0 panel 320x172 landscape',
    ]);
    expect(second.pending).toBe('');
  });

  it('yields several lines from one chunk', () => {
    expect(splitLines('', 'a\nb\nc').lines).toEqual(['a', 'b']);
    expect(splitLines('', 'a\nb\nc').pending).toBe('c');
  });
});
