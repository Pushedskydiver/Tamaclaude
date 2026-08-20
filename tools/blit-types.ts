/**
 * The shapes `tools/blit.ts` and `tools/blit-report.ts` both need.
 *
 * A types-only module so the two can share them without either importing the
 * other — the sender would otherwise have to import from the reporter, which
 * has the dependency backwards.
 */
import type { Rect } from '@tamaclaude/protocol';
import type { Orientation } from '@tamaclaude/renderer';

/** Frames per second the panel plays sprites at. */
export const FPS = 8;
export const FRAME_MS = 1000 / FPS;

export type Update = { readonly rect: Rect; readonly bytes: Uint8Array };
export type Plan = {
  readonly orientation: Orientation;
  readonly prime: Update;
  /** Every frame in full, for re-priming onto the frame the loop is on. */
  readonly full: readonly Update[];
  readonly loop: readonly (Update | null)[];
};
export type Totals = { frames: number; bytes: number; still: number };
export type Window = {
  frames: number;
  bytes: number;
  since: bigint;
  /** Worst distance behind schedule this window, in ms. */
  lag: number;
};
