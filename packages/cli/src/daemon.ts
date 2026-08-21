/**
 * The `daemon` command: the one place the four packages become a panel.
 *
 * `BUILD_PLAN.md` §Stage 3 carried this as its open exit for the whole stage —
 * "the listener holds the registry and offers a snapshot; nothing yet renders
 * it or pushes a frame down the wire". Every piece existed and was tested in
 * isolation. This is the composition, and it is deliberately the only place in
 * the repo that knows about all four:
 *
 *   socket  ->  registry  ->  resolution  ->  scene  ->  framebuffer  ->  wire
 *   daemon      daemon        daemon          cli       renderer         device
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

/** Landscape. The device is used on its side; see `CLAUDE.md`. */
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
 * A session as the strip draws it.
 *
 * The tone collapse lives in `packages/renderer/src/strip.ts` and is spec §4's
 * three tiers rather than the ten states — a pack carries a handful of colours,
 * so the states have to collapse somewhere and the renderer is where that was
 * decided. This only has to pick which tier.
 */
function chipFor(session: Session, now: number): SessionChip {
  // Its own effective state, not the hero's. A chip that showed the hero's
  // tone would say every session is doing whatever the loudest one is doing,
  // which is the opposite of what a strip is for.
  const state: SessionState = effectiveState(session, now);
  const tone =
    state === 'NEEDS_PERMISSION' || state === 'FAILED' || state === 'WAITING'
      ? 'attention'
      : state === 'IDLE' || state === 'ASLEEP'
        ? 'resting'
        : 'active';
  // Everything is local. `origin` exists for the remote transport in
  // `BUILD_PLAN.md` §Stage 3, which is the stage's last item and explicitly
  // cuttable; a session record carries no origin until it ships.
  return { tone, origin: 'local' };
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
 * A whole frame is only sent when the device asks for one. `link.ts` sets
 * `needsPrime` after a connect or a resync, and priming with anything less than
 * the whole screen leaves the blitter compositing onto a base it does not have
 * — which `transport.ts` records as 120 of 300 frames wrong, visible as a
 * stripe of one animation hanging over another.
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
  const transport = openPanel({
    path: options.devicePath,
    panel: size,
    serial: options.serial,
  });

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

  const loop = async (previous: Frame | undefined): Promise<void> => {
    if (stopping.signal.aborted) return;
    // A frame that fails is one frame, and the panel is repainted eight times a
    // second. `openPanel` already survives an unplugged device, so there is
    // nothing here worth stopping the daemon over — but the loop must carry on
    // from the frame it last *sent*, which on a failure is the one before.
    const shown = await paint(previous).catch(() => previous);
    await new Promise((done) => {
      setTimeout(done, frameMs).unref();
    });
    return loop(shown);
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
