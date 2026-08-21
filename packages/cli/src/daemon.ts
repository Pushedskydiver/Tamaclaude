/**
 * The `daemon` command: the one place the packages become a panel.
 *
 * `BUILD_PLAN.md` §Stage 3 carried this as its open exit for the whole stage —
 * "the listener holds the registry and offers a snapshot; nothing yet renders
 * it or pushes a frame down the wire". Every piece existed and was tested in
 * isolation. This is the composition, and it is deliberately the only file in
 * the repo that imports all five:
 *
 *   socket  ->  registry  ->  resolution  ->  scene  ->  pixels  ->  rect  ->  wire
 *   daemon      daemon        daemon          cli       renderer   protocol   device
 *
 * (`packs` is the sixth import and sits under `scene` — the pack is what the
 * renderer draws with.)
 *
 * Nothing here is clever, and that is the intent — every decision worth making
 * was made in the package that owns it. What lives here is the glue that has no
 * other home: turning a `Resolution` into a `Scene`, and turning consecutive
 * framebuffers into the smallest rectangle that changed.
 */
import type { Session, SessionState } from '@tamaclaude/daemon';
import type { SerialSystem } from '@tamaclaude/device';
import type { PackManifest } from '@tamaclaude/packs';
import type { Frame, Rect } from '@tamaclaude/protocol';
import type { Scene, SessionChip } from '@tamaclaude/renderer';

import process from 'node:process';

import {
  effectiveState,
  resolvePanel,
  startSocketServer,
} from '@tamaclaude/daemon';
import { openPanel } from '@tamaclaude/device';
import { parsePackManifest } from '@tamaclaude/packs';
import {
  dirtyRect,
  encodeRect,
  extractRect,
  frame,
} from '@tamaclaude/protocol';
import { panelSize, render } from '@tamaclaude/renderer';

/**
 * How often the panel is recomposed.
 *
 * Eight, because that is what `tools/svg2frames.ts` rasterises at and what the
 * animation timings in `docs/ANIMATION.md` divide into. Nothing is animated
 * yet — the stage is empty until the sprite data lands — but the cadence is
 * what the sprites will need, and a clock that ticks at some other rate would
 * have to be reconciled with it later.
 */
const FRAME_MS = 125;

/**
 * Which way up the panel is, and **the one line to change when that is
 * decided**.
 *
 * `docs/HARDWARE.md` §Orientation is the authority and says both the mock and
 * the harness "default to landscape", which is what this follows. It is a
 * default rather than a decision: `.claude/research/screens/spec.md` §10a still
 * opens "**Undecided, and it is a freeze item**", and the freeze is 25 Aug.
 * Landscape is not a rotated portrait layout — the stage as authored is 200px
 * tall against a 172px landscape panel — so this is not a runtime toggle and
 * pretending otherwise would be worse than a constant.
 *
 * An earlier version of this comment cited `CLAUDE.md`, which says the panel is
 * 172x320 and nothing at all about how it is mounted.
 */
const ORIENTATION = 'landscape';

export type DaemonOptions = {
  readonly socketPath: string;
  readonly devicePath: string;
  /** Untrusted until `parsePackManifest` has had it. */
  readonly pack: unknown;
  /** Injected by tests. Defaults to the real serial port. */
  readonly serial?: SerialSystem;
  readonly now?: () => number;
  readonly frameMs?: number;
  /** Forwarded to `openPanel`, so a test can reach the refresh prime. */
  readonly refreshMs?: number;
  readonly retryMs?: number;
  /**
   * Told what the link is doing, in words.
   *
   * Defaults to stderr rather than to nothing. `link.ts` composes a specific,
   * actionable sentence for a firmware/panel mismatch — the single most likely
   * bring-up failure — and before this was wired the daemon computed it and
   * dropped it: writes stopped after the first frame, permanently, and nothing
   * anywhere said why. `panel.ts` never retries a refused link, by design, so
   * silence there is forever.
   */
  readonly report?: (line: string) => void;
};

export type RunningDaemon = {
  readonly stop: () => Promise<void>;
};

/** The clock as the status band wants it: 24-hour, no seconds. */
function clockText(now: number): string {
  const at = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * Which of the strip's three tones a state reads as.
 *
 * A total `Record` rather than a chain of ternaries, because the chain ended in
 * a default: any state added to `SESSION_STATES` compiled clean and silently
 * became an ordinary working chip. `state.ts` says `DONE` and `COMPACTING` are
 * expected back, and a future `FAILED`-class state arriving as "nothing to see"
 * would lose exactly the signal the strip exists for. Now it will not build.
 *
 * The *decision* to collapse lives in `packages/renderer/src/strip.ts`: a pack
 * carries a handful of colours, so spec §5's ten states cannot each have a
 * tint, and the renderer collapsed them to three tones — fewer even than §4's
 * five tiers, which the three map onto cleanly: attention is tier 2, active is
 * tiers 3 and 4, resting is tier 5. The collapse itself is this table, and it
 * had to land somewhere the moment something fed the strip — `strip.ts` says as
 * much, that "the day the daemon wants to name one in a state-to-tone table,
 * `export` is the whole change".
 */
const TONE: Readonly<Record<SessionState, SessionChip['tone']>> = {
  NEEDS_PERMISSION: 'attention',
  FAILED: 'attention',
  WAITING: 'attention',
  WORKING: 'active',
  THINKING: 'active',
  IDLE: 'resting',
  ASLEEP: 'resting',
};

/**
 * A session as the strip draws it.
 *
 * Its own effective state, not the hero's. A chip that showed the hero's tone
 * would say every session is doing whatever the loudest one is doing, which is
 * the opposite of what a strip is for.
 */
function chipFor(session: Session, now: number): SessionChip {
  // Everything is local. `origin` exists for the remote transport in
  // `BUILD_PLAN.md` §Stage 3, which calls it "explicitly cuttable"; a session
  // record carries no origin until it ships.
  return { tone: TONE[effectiveState(session, now)], origin: 'local' };
}

/**
 * The status band's right end: how many subagents are running, across all of
 * them.
 *
 * `BUILD_PLAN.md` §Stage 3 carried the badge as "drawn from placeholder text
 * until the daemon feeds the scene". This is the daemon feeding it. Blank
 * rather than a zero, because a zero is a thing to read and the common case is
 * nothing to say.
 */
function subagentText(sessions: readonly Session[]): string {
  const running = sessions.reduce((total, one) => total + one.subagents, 0);
  return running > 0 ? `+${String(running)}` : '';
}

/**
 * What the panel should look like right now.
 *
 * `sprites: []` is not a placeholder for missing wiring — `scene.ts` documents
 * that slots past the end of the array stay empty, so this is a complete scene
 * with an empty stage. The stage fills when the sprite data lands; everything
 * else on the panel is live from this commit.
 */
function sceneFor(
  registry: Parameters<typeof resolvePanel>[0],
  pack: PackManifest,
  now: number,
): Scene {
  const panel = resolvePanel(registry, now);
  return {
    orientation: ORIENTATION,
    layout: 'hero',
    pack,
    sprites: [],
    status: {
      left: clockText(now),
      right: subagentText(panel.sessions),
    },
    sessions: panel.sessions.map((session) => chipFor(session, now)),
    message: panel.tool ?? panel.state,
  };
}

/**
 * The rectangle that changed, or nothing.
 *
 * A whole frame goes whenever the link owes one. `link.ts` sets `needsPrime`
 * from four places, and only two of them are the device saying something:
 * `afterOpen` (connect) and `afterReport` (a resync, an abort, or a counter
 * that went backwards). The other two are the host deciding for itself —
 * `newLink` before the first frame, and `afterRefresh` on a five-second timer,
 * which `panel.ts` runs precisely because the loss it covers is the one the
 * firmware cannot see. So a full 320x172 frame leaves here every five seconds
 * whether or not anything asked, and that is the design rather than a leak.
 *
 * Sending less than the whole screen for a prime does not satisfy it:
 * `afterWrite` refuses to clear `needsPrime` for anything smaller, so the debt
 * stays owed and the next frame primes again. (The 120-of-300-ticks figure
 * recorded in `transport.ts` and `link.ts` is a *different* mistake — priming
 * with frame 0 while the diff sequence had moved on. An earlier version of this
 * comment borrowed that number for this cause, which is not what it measured.)
 *
 * The whole rectangle is passed in rather than taken from
 * `protocol.fullScreenRect()`, which is 172x320 — the portrait panel. This
 * device is used landscape, so its framebuffer is 320x172 and the portrait
 * rectangle does not fit it: `extractRect` throws "rect 0,0 172x320 does not
 * fit a 320x172 frame", which is how this was found. `fullScreenRect` has no
 * way to know the orientation and the renderer's `panelSize` does, so the
 * caller supplies it.
 */
function changed(
  previous: Frame | undefined,
  next: Frame,
  whole: Rect,
): Rect | null {
  if (previous === undefined) return whole;
  return dirtyRect(previous, next);
}

/**
 * The panel, with its link status wired to somewhere a person will see it.
 *
 * Separated from `runDaemon` only because that function hit the 50-line limit;
 * the reason it is worth its own name is the `onChange`. `link.ts` composes a
 * specific, actionable sentence for a firmware/panel mismatch, and before this
 * was passed the daemon computed it and dropped it — writes stopped after the
 * first frame, permanently, and nothing anywhere said why. `panel.ts` never
 * retries a refused link, by design, so that silence is forever.
 */
function openReporting(
  options: DaemonOptions,
  size: { readonly width: number; readonly height: number },
): ReturnType<typeof openPanel> {
  const report =
    options.report ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  return openPanel({
    path: options.devicePath,
    panel: size,
    serial: options.serial,
    refreshMs: options.refreshMs,
    retryMs: options.retryMs,
    onChange: (status) => {
      // The refusal first, because it is the one that needs a person. The
      // phase is worth saying either way: "offline" with no explanation is what
      // an unplugged cable looks like, and so is a wrong firmware build.
      report(status.refusal ?? `panel ${status.phase}`);
    },
  });
}

export async function runDaemon(
  options: DaemonOptions,
): Promise<RunningDaemon> {
  const pack = parsePackManifest(options.pack);
  const now = options.now ?? Date.now;
  const size = panelSize(ORIENTATION);
  const whole: Rect = { x: 0, y: 0, width: size.width, height: size.height };

  const listener = await startSocketServer({
    path: options.socketPath,
    now,
  });
  const transport = openReporting(options, size);

  /**
   * One frame, given what the panel is already showing. Returns what it shows
   * now, which is the only state this loop carries — passed forward rather than
   * held, so nothing here needs a mutable binding and the package keeps its
   * clean sheet against `docs/CONVENTIONS.md` §"Holding mutable state".
   */
  const paint = async (
    previous: Frame | undefined,
  ): Promise<Frame | undefined> => {
    const status = transport.status();
    if (status.phase !== 'online') return previous;
    const next = frame(
      render(sceneFor(listener.snapshot(), pack, now())).pixels,
      size.width,
    );
    const rect = status.needsPrime ? whole : changed(previous, next, whole);
    if (rect !== null) {
      await transport.send(rect, encodeRect(extractRect(next, rect)));
    }
    return next;
  };

  const stopping = new AbortController();
  const frameMs = options.frameMs ?? FRAME_MS;

  /**
   * Paint, then schedule the next one from the timer rather than awaiting it.
   *
   * **The difference is a memory leak.** Written as `return loop(shown)` inside
   * an `async` function, every iteration awaits the next, so the promise chain
   * never unwinds while the daemon runs and each frame permanently adds a
   * suspended context. Measured on the real loop: 8.06 -> 9.45 MB over
   * eighteen seconds, linear, no plateau — about 63 MB a day at 8fps, in a
   * process `BUILD_PLAN.md` intends to run under launchd. Handing the
   * continuation to `setTimeout` lets each iteration settle and start the next
   * from a fresh context.
   *
   * The frame is still passed forward rather than held, which is what keeps
   * this file out of the disable budget — but note that avoiding a `let` was
   * never the point. `docs/CONVENTIONS.md` §"Holding mutable state" specifies a
   * budget of one disable, not a clean sheet, and reading it as a purity score
   * is what produced the leak.
   */
  const loop = async (previous: Frame | undefined): Promise<void> => {
    if (stopping.signal.aborted) return;
    // A frame that fails is one frame, and the panel is repainted eight times a
    // second. `openPanel` already survives an unplugged device, so there is
    // nothing here worth stopping the daemon over — but the loop must carry on
    // from the frame it last *sent*, which on a failure is the one before.
    const shown = await paint(previous).catch(() => previous);
    setTimeout(() => {
      void loop(shown);
    }, frameMs).unref();
  };
  void loop(undefined);

  return {
    stop: async () => {
      stopping.abort();
      await listener.close();
      await transport.close();
    },
  };
}
