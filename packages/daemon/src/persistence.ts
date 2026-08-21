/**
 * The registry, across a restart.
 *
 * ## Why any of this exists
 *
 * The daemon is restarted for ordinary reasons — a rebuild, a `launchctl
 * kickstart`, a crash — and Claude Code does not replay. A daemon that forgets
 * on restart shows an empty desk while three sessions are mid-turn, and stays
 * wrong until each of them happens to fire its next hook, which for a long
 * `Bash` is minutes away.
 *
 * ## Is stale state on disk worse than none?
 *
 * The obvious objection is that a session recorded an hour ago is not running
 * now. It is the right objection and it is already answered by the design of
 * the registry: **liveness is time-based, not event-based**, precisely because
 * a crashed session never says goodbye. `EVICT_AFTER_MS` applies to a restored
 * session exactly as it applies to one this process saw itself, so a file
 * older than the window restores nothing at all, and a file inside it restores
 * sessions the daemon would have believed in anyway had it not been restarted.
 *
 * So persistence adds no failure the daemon does not already tolerate. It
 * removes one: the empty desk after a restart.
 *
 * Two things the file is not allowed to do, both enforced on load:
 *
 * - **Mint an immortal session.** `isLive` asks whether `now - lastEventAt` is
 *   under the window, so a timestamp in the future — a clock change, a
 *   hand-edited file, a state file copied from another machine — never ages
 *   out. Every timestamp is pulled back to `now` on the way in.
 * - **Cost more than the session it corrupted.** A half-written or edited file
 *   drops the records that do not parse and keeps the ones that do.
 *
 * A file that cannot be read at all — absent, truncated, not JSON, written by
 * a future version — is silently treated as an empty registry. Silently
 * because the daemon is correct without it: the first hook event of each live
 * session repopulates the strip, and the alternative is a package that owns a
 * logging surface for one line of diagnostics.
 */

import type { SessionRegistry } from './registry.js';
import type { Session } from './session.js';

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import { MAX_FIELD_LENGTH } from './hook-line.js';
import { createRegistry, evictStale } from './registry.js';
import { SESSION_STATES } from './state.js';

/**
 * Bumped when the shape below changes incompatibly.
 *
 * An unrecognised version loads as empty rather than being coerced, so an
 * older daemon reading a newer file forgets one restart's worth of sessions
 * instead of restoring a record it has misunderstood.
 */
const STATE_VERSION = 1;

/** Owner-only. The file says what the machine's owner was doing, and when. */
const STATE_FILE_MODE = 0o600;

const identifier = z.string().min(1).max(MAX_FIELD_LENGTH);
const timestamp = z.number().finite();

const sessionSchema = z.object({
  id: identifier,
  state: z.enum(SESSION_STATES),
  tool: identifier.optional(),
  errorType: identifier.optional(),
  startedAt: timestamp,
  lastEventAt: timestamp,
  notifiedAt: timestamp.optional(),
  endedAt: timestamp.optional(),
  subagents: z.number().int().min(0),
});

/**
 * `sessions` is `unknown[]` on purpose: each record is validated separately
 * below so that one bad entry costs one session rather than the whole file.
 */
const stateFileSchema = z.object({
  version: z.literal(STATE_VERSION),
  lastEventAt: timestamp,
  sessions: z.array(z.unknown()),
});

/** Where the state file sits, given where the socket sits. */
export function statePathFor(socketPath: string): string {
  return join(
    dirname(socketPath),
    `${basename(socketPath, extname(socketPath))}.state.json`,
  );
}

/** The registry as it goes to disk. `JSON.stringify` drops absent optionals. */
export function encodeRegistry(registry: SessionRegistry): string {
  return `${JSON.stringify({
    version: STATE_VERSION,
    lastEventAt: registry.lastEventAt,
    sessions: [...registry.sessions.values()],
  })}\n`;
}

/** Nothing may claim to have happened after now. See the header. */
function clamp(value: number, now: number): number {
  return Math.min(value, now);
}

function restore(record: z.infer<typeof sessionSchema>, now: number): Session {
  return {
    ...record,
    startedAt: clamp(record.startedAt, now),
    lastEventAt: clamp(record.lastEventAt, now),
    notifiedAt:
      record.notifiedAt === undefined
        ? undefined
        : clamp(record.notifiedAt, now),
    endedAt:
      record.endedAt === undefined ? undefined : clamp(record.endedAt, now),
  };
}

/**
 * Parse a state file. `undefined` means "this is not a state file", which the
 * caller turns into an empty registry.
 *
 * Eviction runs here rather than being left to the first tick, so the answer
 * this function returns is already true of `now` — a caller that renders
 * before the daemon's first event cannot show a session that expired while the
 * daemon was not running.
 */
export function decodeRegistry(
  raw: string,
  now: number,
): SessionRegistry | undefined {
  const file = stateFileSchema.safeParse(safeJson(raw));
  if (!file.success) return undefined;
  const sessions = file.data.sessions
    .map((record) => sessionSchema.safeParse(record))
    .filter((parsed) => parsed.success)
    .map((parsed) => restore(parsed.data, now));
  return evictStale(
    {
      sessions: new Map(sessions.map((session) => [session.id, session])),
      lastEventAt: clamp(file.data.lastEventAt, now),
    },
    now,
  );
}

/** Whatever is on disk, or an empty registry. Never throws. */
export function loadRegistry(path: string, now: number): SessionRegistry {
  return decodeRegistry(readIfPossible(path), now) ?? createRegistry(now);
}

/**
 * Replace the state file atomically.
 *
 * Written to a temporary in the same directory and renamed, which is atomic
 * only because the two are on one filesystem — across filesystems `rename` is
 * a copy, and a copy can be interrupted half way, which is the failure this is
 * here to prevent. The temporary is created with the final mode, so a save
 * interrupted between write and rename leaves a file that is still owner-only
 * and that the next save reuses.
 *
 * Synchronous, and called once per accepted event. The file is a few hundred
 * bytes for the two or three sessions a desk actually runs, and the peer is
 * not waiting on us — the hook exits as soon as its bytes reach the kernel. A
 * debounce would buy a write or two per turn at the cost of a timer, which is
 * state to own and a clock for the tests to control.
 */
export function saveRegistry(path: string, registry: SessionRegistry): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tamaclaude-${String(process.pid)}`;
  writeFileSync(temporary, encodeRegistry(registry), {
    encoding: 'utf8',
    mode: STATE_FILE_MODE,
  });
  renameSync(temporary, path);
}

function readIfPossible(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // Absent is the ordinary case — every first run. A directory, a permission
    // problem or a read error all land here too, and the answer to each is the
    // same as the answer to a corrupt file.
    return '';
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
