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
import type { Sprite } from './png-rgb565.ts';
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
import { ORIENTATIONS, panelSize } from '@tamaclaude/renderer';

import { describe, reportWindow, summarise } from './blit-report.ts';
import { composePanels, loadPack } from './blit-scene.ts';
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

/** Lateness past which the loop resets its clock instead of catching up. */
const CATCH_UP_LIMIT_MS = 250;

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

/** Decode a directory of PNGs to RGB565 plus alpha, in a throwaway browser. */
async function decode(frameDir: string): Promise<Sprite[]> {
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
function planFrames(panels: readonly Frame[], orientation: Orientation): Plan {
  const { width, height } = panelSize(orientation);
  const whole = { x: 0, y: 0, width, height };
  // A full-frame packet for every frame, not just the first.
  //
  // Re-priming has to restore the frame the loop is actually on. Sending
  // frame 0 instead resets the panel to the start while the diff sequence
  // carries on from where it was, so the next update is `frame[n] - frame[n-1]`
  // applied to a panel showing frame 0 — and every diff after that inherits
  // the mistake. It leaves fragments of whatever was on screen when the
  // re-prime landed, which on `idle` means a stripe of the yawn hanging above
  // a resting Clawd until the next loop happens to paint over it.
  const full = panels.map((p) => packet(whole, extractRect(p, whole)));
  // Rects are already in panel space — `render()` placed the sprite, so there
  // is nothing left to translate.
  const loop = panels.map((next, index) => {
    const previous = panels[(index + panels.length - 1) % panels.length];
    const rect = dirtyRect(previous, next);
    return rect ? packet(rect, extractRect(next, rect)) : null;
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
  const recovering = link.health.lost;
  link.health.lost = false;
  // Clear only when recovering. The sprite covers 168x160 of a 320x172 panel,
  // so priming alone cannot repair anything outside it — and the thing most
  // likely to be wrong out there is the boot splash. But that argument is
  // about recovery, not about the timer: on a routine tick nothing outside the
  // sprite can have changed, because nothing but this tool has written to the
  // panel since the last clear. Clearing anyway costs a full-screen blit —
  // 110KB, 22ms of SPI during which the device is deaf — twelve times a
  // minute, which is a black frame every five seconds on the one instrument
  // whose job is judging whether the panel looks right.
  if (recovering) {
    await writeAll(link.handle, clearPacket(plan.orientation).bytes);
  }
  await writeAll(link.handle, plan.full[at.frame % plan.full.length].bytes);
  return true;
}

/**
 * Has the firmware told us it was built for the other orientation?
 *
 * It puts that on its status line because it is the one thing this end cannot
 * work out — a build-time constant there, an argument here, no handshake
 * between them. On a mismatch every packet fails the device's bounds check,
 * its rect count never leaves zero, and the sender would otherwise re-prime
 * into the void indefinitely with nothing to say why.
 */
function mismatched(link: Link, plan: Plan): boolean {
  const said = link.health.orientation;
  if (!said || said === plan.orientation) return false;
  console.error(
    `\nfirmware is built for ${said}, this is sending ${plan.orientation} — ` +
      'nothing will be drawn.\nRebuild with PANEL_LANDSCAPE in ' +
      'packages/device/firmware/blitter/main/main.c, or pass the other ' +
      'orientation here.',
  );
  return true;
}

async function stream(link: Link, plan: Plan): Promise<void> {
  const clear = clearPacket(plan.orientation);
  await writeAll(link.handle, clear.bytes);
  await writeAll(link.handle, plan.prime.bytes);
  const primed = clear.bytes.byteLength + plan.prime.bytes.byteLength;
  console.log(`  primed with ${primed} B (full-screen clear + frame 0)`);

  let start = process.hrtime.bigint();
  // Counted, because reporting bytes accurately is what this tool is for and
  // the priming pair is the largest single write of the run.
  const totals: Totals = { frames: 0, bytes: primed, still: 0 };
  const window: Window = { frames: 0, bytes: 0, since: start, lag: 0 };
  let lastPrime = start;
  for (let tick = 0; running; tick += 1) {
    if (mismatched(link, plan)) break;

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
    if (late > CATCH_UP_LIMIT_MS) {
      // Do not try to catch up. `sleepUntil` returns immediately on a missed
      // deadline, so after a stall this loop would write flat out until it was
      // level again — a burst into a receive ring sized for a steady 8fps
      // drip, and overflow there is the one loss the device cannot report.
      // Dropping the missed frames is strictly better than risking that.
      start =
        process.hrtime.bigint() -
        BigInt(Math.round((tick + 1) * FRAME_MS * 1e6));
    }
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
  const rasters = await decode(frameDir);
  const name = basename(frameDir);
  const pack = await loadPack(resolve(ROOT, 'packs/example'));
  const panels = composePanels(rasters, { orientation, pack, name });
  const plan = planFrames(panels, orientation);
  const { width, height } = panelSize(orientation);
  describe(name, { x: 0, y: 0, width, height }, plan);

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
