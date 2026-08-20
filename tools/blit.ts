#!/usr/bin/env node
/**
 * Stream real rendered frames to the panel over USB-CDC.
 *
 * The firmware is a dumb blitter, and until something upstream of it puts
 * genuine dirty rectangles on the wire the only things that have ever exercised
 * it are a throughput spike that writes 0xa5 forever and a unit test. This is
 * the missing half: it renders an animation, diffs it, encodes it with the
 * shipping codec, and pushes it at the panel's real frame rate.
 *
 *   pnpm build
 *   node tools/blit.ts idle /dev/cu.usbmodem1101
 *   node tools/blit.ts out/typing /dev/cu.usbmodem1101
 *
 * `pnpm build` first because this reads panel geometry from
 * `@tamaclaude/renderer`, which is consumed from `dist/`.
 *
 * Every byte it sends comes from `@tamaclaude/protocol` — `dirtyRect`,
 * `extractRect`, `encodeRect`, `writeRectHeader`. Nothing about the wire format
 * is restated here, because a sender that agrees with a hand-written copy of
 * the spec rather than with the code the daemon will use is a test of the wrong
 * thing.
 *
 * What it does not do is model the daemon. There is no state machine, no pack,
 * no text: one animation, looping. It answers "does a rect get from here to the
 * glass, correctly, at 8fps" and nothing else.
 */
import type { Plan, Totals, Update, Window } from './blit-types.ts';
import type { Link } from './serial.ts';
import type { Frame, Rect } from '@tamaclaude/protocol';
import type { Orientation } from '@tamaclaude/renderer';

import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

import {
  dirtyRect,
  encodeRect,
  extractRect,
  writeRectHeader,
} from '@tamaclaude/protocol';
import {
  ORIENTATIONS,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  stageScale,
} from '@tamaclaude/renderer';

import { describe, reportWindow, summarise } from './blit-report.ts';
import { FPS, FRAME_MS } from './blit-types.ts';
import { frameNames, loadFrames } from './png-rgb565.ts';
import { connect, writeAll } from './serial.ts';

/** Same default as `tools/usb-throughput.ts`, for the same board. */
const DEFAULT_PORT = '/dev/cu.usbmodem1101';

/**
 * Must match how the firmware was built. There is no handshake, so a mismatch
 * is silent: the sprite lands in the wrong band and nothing warns you. Both
 * default to landscape, which is how the device is meant to sit.
 */
const DEFAULT_ORIENTATION = 'landscape';

const ROOT = resolve(import.meta.dirname, '..');

/** Set false by SIGINT so the send loop can report before it exits. */
let running = true;

// ── Frames ────────────────────────────────────────────────────────

/** Newest PNG mtime in a directory, or 0 if it holds none. */
async function newestFrame(dir: string): Promise<number> {
  const names = await frameNames(dir).catch(() => []);
  const times = await Promise.all(
    names.map(async (name) => (await stat(resolve(dir, name))).mtimeMs),
  );
  return times.length > 0 ? Math.max(...times) : 0;
}

/**
 * Frames for an argument that is either an animation name or a directory.
 *
 * A name wins over a directory of the same name, because `blit idle` should
 * mean the animation whatever happens to be sitting in the working directory.
 *
 * Rendered frames are reused only while they are newer than the SVG. Reusing
 * them unconditionally is the quiet failure: the panel shows the last edit but
 * one, and nothing on either side says so — which is exactly the bug you would
 * then go looking for in the firmware.
 */
async function resolveFrameDir(target: string): Promise<string> {
  const svg = resolve(ROOT, 'assets/clawd/animations', `${target}.svg`);
  const source = await stat(svg).catch(() => undefined);
  if (!source) {
    const dir = resolve(target);
    if ((await newestFrame(dir)) === 0) {
      throw new Error(
        `"${target}" is neither an animation in assets/clawd/animations nor ` +
          `a directory of PNG frames`,
      );
    }
    return dir;
  }
  const outDir = resolve(ROOT, 'out', target);
  if (source.mtimeMs > (await newestFrame(outDir))) {
    console.log(`rendering ${target} -> ${outDir}`);
    execFileSync(
      process.execPath,
      [resolve(ROOT, 'tools/svg2frames.ts'), svg, outDir],
      {
        stdio: 'inherit',
      },
    );
  }
  return outDir;
}

/** Decode a directory of PNGs to RGB565, in a throwaway browser. */
async function decode(frameDir: string): Promise<Frame[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    return await loadFrames(page, frameDir);
  } finally {
    await browser.close();
  }
}

// ── Geometry ──────────────────────────────────────────────────────

/**
 * Where a sprite frame sits on the panel, as a whole-frame panel rect.
 *
 * This is the trap in this file. `dirtyRect` and `extractRect` work in the
 * frame's own coordinate space — 168x200 for every animation in the repo —
 * while the packet header carries panel coordinates. Send a frame-space rect
 * unchanged and the sprite lands at 0,0: two pixels left and a whole status
 * band high. That looks like a firmware bug and is arithmetic.
 *
 * The origin comes from the renderer's hero slot rather than a constant here,
 * for the same reason `tools/panel-mock.ts` takes its geometry there — what the
 * panel is driven from must not drift from what the renderer draws.
 */
function spriteOrigin(first: Frame, orientation: Orientation): Rect {
  const height = first.pixels.length / first.width;
  const panel = panelSize(orientation);
  const slot = spriteSlots('hero', orientation)[0];
  const origin = {
    x: slot.x + Math.round((slot.width - first.width) / 2),
    y: slot.y + Math.round((slot.height - height) / 2),
    width: first.width,
    height,
  };
  if (
    origin.x < 0 ||
    origin.y < 0 ||
    origin.x + origin.width > panel.width ||
    origin.y + origin.height > panel.height
  ) {
    throw new Error(
      `a ${first.width}x${height} frame centred on the hero slot does not fit ` +
        `the ${panel.width}x${panel.height} ${orientation} panel`,
    );
  }
  return origin;
}

/**
 * Crop a frame to the landscape safe area.
 *
 * Landscape is not a rotated portrait layout. The stage band is 160px tall
 * against portrait's 200, because a 320px-wide panel only has 172px of height
 * and the text bands need the rest. Animations are authored at 21x25 units and
 * `docs/ANIMATION.md` reserves the top 5 of those as prop headroom — the space
 * a barbell or a thought bubble occupies — precisely so that landscape can drop
 * it and still have the character whole.
 *
 * So this takes the bottom 20 units and discards the top 5. Anything an
 * animation puts up there is gone in landscape, which is what the safe-area
 * warning in `tools/svg2frames.ts` exists to catch at authoring time.
 */
function cropToSafeArea(frame: Frame, orientation: Orientation): Frame {
  if (orientation === 'portrait') return frame;
  const drop = safeAreaCropUnits() * stageScale('hero');
  const height = frame.pixels.length / frame.width;
  if (drop <= 0 || drop >= height) return frame;
  return {
    width: frame.width,
    pixels: frame.pixels.slice(drop * frame.width),
  };
}

/** Translate a frame-space rect into panel space. */
function onPanel(rect: Rect, origin: Rect): Rect {
  return {
    x: origin.x + rect.x,
    y: origin.y + rect.y,
    width: rect.width,
    height: rect.height,
  };
}

// ── Packets ───────────────────────────────────────────────────────

/**
 * Header plus payload in one buffer, so one write carries a whole packet.
 *
 * There is no sync word in this protocol, so a packet split across writes is
 * not wrong — the firmware reads a byte stream — but keeping them together
 * removes one way for a partial write to leave a header stranded.
 */
function packet(rect: Rect, pixels: Uint16Array): Update {
  const { mode, payload } = encodeRect(pixels);
  const header = writeRectHeader(rect, payload.byteLength, mode);
  const bytes = new Uint8Array(header.byteLength + payload.byteLength);
  bytes.set(header);
  bytes.set(payload, header.byteLength);
  return { rect, bytes };
}

/**
 * Paint the whole panel black before anything else.
 *
 * The sprite covers 168x200 of a 172x320 panel. Without this the other 60%
 * keeps whatever the last run, the boot logo or uninitialised SRAM left there,
 * and a stale border reads as a fault in the part that is working. One RLE run:
 * four bytes of payload for 55,040 pixels.
 */
function clearPacket(orientation: Orientation): Update {
  // Not `fullScreenRect()`: that is the portrait panel, and in landscape a
  // 172x320 rect fails the firmware's bounds check and is discarded as noise.
  // The symptom would be the splash surviving everywhere the sprite does not
  // cover, plus a resync count that climbs once at startup.
  const { width, height } = panelSize(orientation);
  return packet({ x: 0, y: 0, width, height }, new Uint16Array(width * height));
}

/**
 * The first frame in full, then every frame as a diff of the one before it.
 *
 * The device's panel contents are unknown at connect, so frame 0 cannot be a
 * diff against anything. The wrap from the last frame back to the first is a
 * diff like any other, which is what makes the loop seamless instead of
 * flashing a full frame once a cycle.
 *
 * All of it is computed before the first byte goes out. Diffing and RLE inside
 * the send loop would be charged to the frame budget and surface as jitter in
 * the achieved-fps figure this tool exists to report.
 */
function planFrames(
  frames: readonly Frame[],
  origin: Rect,
  orientation: Orientation,
): Plan {
  const whole = { x: 0, y: 0, width: origin.width, height: origin.height };
  // A full-frame packet for every frame, not just the first.
  //
  // Re-priming has to restore the frame the loop is actually on. Sending
  // frame 0 instead resets the panel to the start while the diff sequence
  // carries on from where it was, so the next update is `frame[n] - frame[n-1]`
  // applied to a panel showing frame 0 — and every diff after that inherits
  // the mistake. It leaves fragments of whatever was on screen when the
  // re-prime landed, which on `idle` means a stripe of the yawn hanging above
  // a resting Clawd until the next loop happens to paint over it.
  const full = frames.map((f) => packet(origin, extractRect(f, whole)));
  const loop = frames.map((next, index) => {
    const previous = frames[(index + frames.length - 1) % frames.length];
    const rect = dirtyRect(previous, next);
    return rect ? packet(onPanel(rect, origin), extractRect(next, rect)) : null;
  });
  return { orientation, prime: full[0], full, loop };
}

// ── The send loop ─────────────────────────────────────────────────

/**
 * How often to re-send the whole frame even when nothing looks wrong.
 *
 * Counter-driven re-priming covers the losses the firmware notices. It does
 * not cover the one it cannot: if its receive ring overflows, IDF's ISR
 * discards the bytes without reporting anything, so a packet vanishes with no
 * resync and no abort. The ring is sized 2.5x the worst case now, but a
 * periodic full frame costs about 1.5 KB every five seconds — 0.05% of the
 * link — and turns any silent divergence into something that self-heals
 * instead of persisting until someone unplugs the board.
 */
const REPRIME_MS = 5000;

/** Sleep to an absolute deadline, so pacing cannot drift frame by frame. */
function sleepUntil(deadline: bigint): Promise<void> {
  const remaining = Number(deadline - process.hrtime.bigint()) / 1e6;
  if (remaining <= 0) return Promise.resolve();
  return new Promise((done) => {
    setTimeout(done, remaining);
  });
}

/**
 * Re-send the whole frame if the device has lost anything, or if it is simply
 * time to.
 *
 * After any lost packet every subsequent diff is applied to content the device
 * never had, so the panel keeps a stale frame with fragments on it and never
 * converges. Re-priming is the only way back. Returns whether it sent.
 */
async function reprimeIfNeeded(
  link: Link,
  plan: Plan,
  at: { readonly lastPrime: bigint; readonly frame: number },
): Promise<boolean> {
  const since = Number(process.hrtime.bigint() - at.lastPrime) / 1e6;
  if (!link.health.lost && since < REPRIME_MS) return false;
  if (link.health.lost) {
    console.log(
      `  re-priming: device reported ${link.health.resyncs} resync(s), ` +
        `${link.health.aborts} abort(s)`,
    );
  }
  link.health.lost = false;
  // Clear as well as prime. The sprite covers 168x160 of a 320x172 panel, so
  // priming alone cannot repair anything outside it — and the thing most
  // likely to be wrong out there is the boot splash, which is exactly what
  // survived when the first clear was lost to the reset-on-open race.
  await writeAll(link.handle, clearPacket(plan.orientation).bytes);
  await writeAll(link.handle, plan.full[at.frame % plan.full.length].bytes);
  return true;
}

async function stream(link: Link, plan: Plan): Promise<void> {
  const clear = clearPacket(plan.orientation);
  await writeAll(link.handle, clear.bytes);
  await writeAll(link.handle, plan.prime.bytes);
  console.log(
    `  primed with ${clear.bytes.byteLength + plan.prime.bytes.byteLength} B ` +
      `(full-screen clear + frame 0)`,
  );

  const start = process.hrtime.bigint();
  const totals: Totals = { frames: 0, bytes: 0, still: 0 };
  const window: Window = { frames: 0, bytes: 0, since: start, lag: 0 };
  let lastPrime = start;
  for (let tick = 0; running; tick += 1) {
    if (await reprimeIfNeeded(link, plan, { lastPrime, frame: tick })) {
      lastPrime = process.hrtime.bigint();
      const cost = plan.full[tick % plan.full.length].bytes.byteLength;
      totals.bytes += cost;
      window.bytes += cost;
    }

    // The priming frame already showed frame 0, so the loop resumes at 1.
    const update = plan.loop[(tick + 1) % plan.loop.length];
    if (update) {
      await writeAll(link.handle, update.bytes);
      totals.bytes += update.bytes.byteLength;
      window.bytes += update.bytes.byteLength;
    } else {
      totals.still += 1;
    }
    totals.frames += 1;
    window.frames += 1;
    const deadline = start + BigInt(Math.round((tick + 1) * FRAME_MS * 1e6));
    const late = Number(process.hrtime.bigint() - deadline) / 1e6;
    window.lag = Math.max(window.lag, late);
    await sleepUntil(deadline);
    if (process.hrtime.bigint() - window.since >= 1_000_000_000n) {
      reportWindow(window, totals);
      window.frames = 0;
      window.bytes = 0;
      window.lag = 0;
      window.since = process.hrtime.bigint();
    }
  }
  summarise(totals, start);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'usage: node tools/blit.ts <animation|frameDir> [port] [orientation]\n' +
        `       port defaults to ${DEFAULT_PORT}\n` +
        `       orientation is ${ORIENTATIONS.join(' or ')}, default ` +
        `${DEFAULT_ORIENTATION} — it must match how the firmware was built ` +
        '(PANEL_LANDSCAPE in packages/device/firmware/blitter/main/main.c)',
    );
    process.exit(1);
  }
  const orientation = (args[2] ?? DEFAULT_ORIENTATION) as Orientation;
  if (!ORIENTATIONS.includes(orientation)) {
    console.error(`orientation must be one of ${ORIENTATIONS.join(', ')}`);
    process.exit(1);
  }
  const frameDir = await resolveFrameDir(args[0]);
  const decoded = await decode(frameDir);
  const frames = decoded.map((f) => cropToSafeArea(f, orientation));
  const origin = spriteOrigin(frames[0], orientation);
  const plan = planFrames(frames, origin, orientation);
  describe(basename(frameDir), origin, plan);

  const port = args[1] ?? DEFAULT_PORT;
  const link = await connect(port);
  console.log(`\nwriting to ${port} at ${FPS}fps — Ctrl-C to stop\n`);
  try {
    await stream(link, plan);
  } finally {
    await link.close();
  }
}

process.on('SIGINT', () => {
  // Second Ctrl-C means the loop is wedged rather than merely mid-frame.
  if (!running) process.exit(130);
  running = false;
  console.log('\nstopping…');
});

try {
  await main();
} catch (error) {
  // `execFileSync` puts its entire result — status, pid, and stdout and stderr
  // as printed byte arrays — into the stack Node dumps by default. Naming the
  // wrong port is the likeliest way to land here, and it deserves one line
  // rather than thirty lines of Buffer.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
