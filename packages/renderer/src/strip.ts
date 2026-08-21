import type { ColourRole, Painter } from './band.js';

import { centredTextY, rightAlignedX, TEXT_INSET } from './band.js';
import { drawBorder, fillRect } from './draw.js';
import { drawText, measureText } from './text.js';

/**
 * The session strip: one mini-Clawd per live session, then a count of the ones
 * that did not fit.
 */

/**
 * How loudly a session's chip should read.
 *
 * A tone rather than a state, for two reasons. The palette is the hard one: a
 * pack carries a handful of colours, so the ten states of spec §5 cannot have
 * ten tints however much §2 would like them to — they have to collapse, and
 * collapsing them where they are drawn is the honest place to do it. The other
 * is ownership: the state machine lives in `packages/daemon` (spec §9), and
 * restating its enum here would make two places to change when a state is
 * added. These three are §4's tiers, which is what §1 says the strip is for —
 * `attention` is tier 2, the sessions costing you time by going unseen.
 *
 * Not exported: `SessionChip` is the shape consumers build, and a tone is
 * assignable from its literal. The day the daemon wants to name one in a
 * state-to-tone table, `export` is the whole change.
 */
type SessionTone = 'attention' | 'active' | 'resting';

/**
 * Where a session is running. Spec §3 makes this a host name, but a 15px chip
 * has nowhere to put one — local-versus-remote is all that survives at this
 * size, and all the strip needs to say. Not exported, for the reason above.
 */
type SessionOrigin = 'local' | 'remote';

/**
 * A session as the strip draws it, which is not the session record of spec §3.
 * That record is the daemon's; this is the handful of it that becomes pixels.
 *
 * Spec §2 gives the chip's tint to state and §3 gives it to origin, which
 * cannot both be true of one 15x16 sprite. They are separated here: tone takes
 * the colour, origin takes fill-versus-outline. Two independent channels,
 * one palette entry between them.
 */
export type SessionChip = {
  readonly tone: SessionTone;
  readonly origin: SessionOrigin;
};

/**
 * Mini-Clawd geometry: the base character at 1px per unit, per spec §2.
 *
 * The gap follows from the same paragraph — five chips plus their gaps is
 * 99px, which is 5x15 + 4x6. Stage 1 draws these as flat blocks: its exit
 * criterion is the whole experience running with placeholder art, and the
 * mini-Clawd raster is art. Keeping the placeholder the size the real sprite
 * will be means the strip does not relayout when it lands.
 */
const CHIP_WIDTH = 15;
const CHIP_HEIGHT = 16;
const CHIP_GAP = 6;

/**
 * Chips the strip will show before it starts counting instead.
 *
 * Spec §2 fixes five. Geometry alone would allow eight across a portrait
 * strip, but five is a legibility judgement rather than an arithmetic one, and
 * the band was judged at three. Both bounds are applied, because in a narrower
 * band — landscape's strip is 152px, not 172px — geometry binds first.
 */
const MAX_CHIPS = 5;

/** Which palette role carries each tone. */
const TONE_ROLE: Readonly<Record<SessionTone, ColourRole>> = {
  attention: 'attention',
  active: 'active',
  resting: 'ink',
};

/** Width of `count` chips laid side by side with their gaps. */
function chipsWidth(count: number): number {
  return count * CHIP_WIDTH + (count - 1) * CHIP_GAP;
}

/** The `+N` the strip shows in place of the sessions it had no room for. */
function overflowBadge(hidden: number): string {
  return `+${String(hidden)}`;
}

/**
 * Split `count` sessions into the ones the strip draws and the ones it counts.
 *
 * The badge is only budgeted for when there is something to hide — reserving
 * its width unconditionally would cost a chip on every strip that fits without
 * one. Its width is measured from the text it will actually carry, so `+12`
 * reserves more than `+2`, and the search settles because that width grows
 * with the logarithm of a count the chips give up linearly.
 */
export function stripFit(
  count: number,
  available: number,
): { readonly shown: number; readonly hidden: number } {
  const pitch = CHIP_WIDTH + CHIP_GAP;
  const geometric = Math.floor((available + CHIP_GAP) / pitch);
  const cap = Math.min(count, MAX_CHIPS, Math.max(geometric, 0));
  if (cap === count) return { shown: count, hidden: 0 };
  for (let shown = cap; shown > 0; shown -= 1) {
    const badge = measureText(overflowBadge(count - shown));
    if (chipsWidth(shown) + CHIP_GAP + badge <= available) {
      return { shown, hidden: count - shown };
    }
  }
  return { shown: 0, hidden: count };
}

/**
 * Paint the strip.
 *
 * A remote session is drawn hollow rather than in a second colour, so origin
 * and tone stay legible independently on a sprite too small to carry a label.
 */
export function paintStrip(
  painter: Painter,
  sessions: readonly SessionChip[],
): void {
  const band = painter.bands.strip;
  const available = band.width - TEXT_INSET * 2;
  const { shown, hidden } = stripFit(sessions.length, available);
  const y = band.y + Math.floor((band.height - CHIP_HEIGHT) / 2);
  for (const [index, session] of sessions.slice(0, shown).entries()) {
    const rect = {
      x: band.x + TEXT_INSET + index * (CHIP_WIDTH + CHIP_GAP),
      y,
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
    };
    const colour = painter.colours[TONE_ROLE[session.tone]];
    if (session.origin === 'remote') drawBorder(painter.target, rect, colour);
    else fillRect(painter.target, rect, colour);
  }
  if (hidden === 0) return;
  const badge = overflowBadge(hidden);
  drawText(painter.target, badge, {
    x: rightAlignedX(band, badge),
    y: centredTextY(band),
    colour: painter.colours.ink,
  });
}
