/**
 * The socket the hook writes to, and the only place in this package that
 * touches the outside world.
 *
 * `packages/hooks` connects, writes one line, and exits — on every hook event,
 * of every session, many times a turn. So the shape here is **many very short
 * connections**, not one stream: nothing may be kept per peer that a peer's
 * disappearance would leak, and no single connection may be trusted to finish
 * what it started.
 *
 * ## What it does with a line it does not like
 *
 * Drops it and keeps reading. A Unix socket is a file — anything on the
 * machine that can open it can write to it, and Claude Code itself sends
 * events this daemon has no transition for. Malformed JSON, a valid object of
 * the wrong shape, an unterminated line from a peer that vanished, a flood
 * with no newline in it: none of them is an error condition, and every one of
 * them is answered the same way. `hook-line.ts` is the boundary that decides.
 *
 * The one line that is not merely dropped is the flood: a line reader cannot
 * bound a line that never ends, so a peer that writes more than
 * `MAX_CONNECTION_BYTES` without a newline is disconnected rather than
 * buffered. Everything else costs one line.
 *
 * ## Mutation
 *
 * This is the one file in the package that mutates anything, and it is a class
 * so that it can — `functional/immutable-data` is configured with
 * `ignoreClasses`, which is the sanctioned way to hold state that has to
 * change. Two things mutate and they are both listed here, because
 * `ignoreClasses` gives no warning and no grep for a third: the `#registry`
 * field, which is reassigned to point at each new registry, and
 * `#connections`, which gains and loses a socket as peers come and go. The
 * session logic itself stays pure — `observe` and `evictStale` return values,
 * and this file only holds the newest one.
 *
 * `packages/device` reached the same problem and answered it differently, with
 * a `cell` closure and a single `no-let` disable. That went to review, and the
 * ruling was that the shape is not the rule — the budget is. See
 * `docs/CONVENTIONS.md` §"Holding mutable state": one disable comment naming
 * the single binding that moves, and no third shape. Both of these spend one.
 *
 * ## Failure
 *
 * Two invariants, both from the brief and both tested. Losing the panel must
 * never take the daemon down, so a throw out of `onChange` — where a transport
 * gets wired, and a transport has a cable somebody can pull — is contained.
 * And a state file that cannot be written costs the restart shortcut, not the
 * session state, which is correct in memory either way.
 */

import type { SessionRegistry } from './registry.js';
import type { Server, Socket } from 'node:net';

import { chmodSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';

import { parseHookEventLine } from './hook-line.js';
import { loadRegistry, saveRegistry, statePathFor } from './persistence.js';
import { evictStale, observe } from './registry.js';
import {
  claimSocketPath,
  defaultSocketPath,
  prepareSocketPath,
  probeSocket,
  temporaryBindPath,
} from './socket-path.js';

/**
 * How many peers may be connected at once.
 *
 * `MAX_CONNECTION_BYTES` bounds what one connection can write; nothing bounded
 * how many connections there could be. A peer that opens sockets and never
 * writes costs a `Set` entry and a file descriptor each, indefinitely — the
 * header above promises that nothing is kept per peer that a peer's
 * disappearance would leak, which is true of a peer that *disappears* and not
 * of one that lingers. Same actor as `MAX_SESSIONS` in `registry.ts`, and the
 * socket being 0600 is a layer rather than an answer.
 *
 * At the cap a connection goes, not the newcomer. Refusing new ones would let
 * whoever got there first hold every slot and lock the real hooks out.
 *
 * At the cap the *oldest* connection goes, not the newest. Refusing new ones
 * would let whoever got there first hold every slot and lock the real hooks
 * out; a hook connects, writes about 150 bytes and closes, so anything old
 * enough to be evicted is the suspect and not the customer.
 *
 * **A review argued that last clause is false in a burst** — that connections
 * are then accepted faster than they are read, making the oldest a hook that
 * has written and is waiting, so evicting it would drop a delivered event
 * silently. Measured, and it does not happen: 150 hooks against this cap of 64,
 * paced so the accept backlog never saturates, fold 150 events and lose none.
 * An evicted connection has already had its line handed to `readline` —
 * *because the hook writes in the same tick it connects*, which is the
 * precondition the sentence needs and `packages/hooks/src/index.ts` supplies by
 * ending the socket with the payload. It is load-bearing: a peer that connects
 * and writes 50ms later does lose events here, measured at 80 such peers
 * folding 64. No such peer exists in this system, and one that behaved that way
 * would be the flooder the cap is for. The cap was raised to 256 on the
 * strength of that argument and put back when the measurement came in, because
 * four times the worst-case memory bought nothing.
 *
 * What *is* real, and is the kernel's rather than ours: a burst larger than the
 * listen backlog is refused at `connect`, before this file sees it at all.
 * `kern.ipc.somaxconn` is 128 on darwin, and 200 simultaneous hooks lose
 * exactly 72. Nothing here can help — the events never arrive — and 128
 * concurrent hooks is far past any real session count, but it is the number
 * that bounds a burst, not this one.
 */
export const MAX_CONNECTIONS = 64;

/**
 * How much one connection may write before it is cut off.
 *
 * The hook sends about 150 bytes and closes. This is four hundred times that,
 * which leaves the newline framing its stated room to carry several events per
 * connection later on, and is still nowhere near a number a working peer could
 * reach. It is a cap on the connection rather than on the line because a line
 * with no terminator in it is exactly the case that has to be bounded, and by
 * the time you can measure a line you have already buffered it.
 */
export const MAX_CONNECTION_BYTES = 64 * 1024;

/** Owner only. Anything that can write to this socket can drive the panel. */
const SOCKET_MODE = 0o600;

export type SocketServerOptions = {
  /** Defaults to the path `packages/hooks` writes to. */
  readonly path?: string;
  /** Defaults to a file beside the socket. See `persistence.ts`. */
  readonly statePath?: string;
  /**
   * The clock, injected.
   *
   * Nothing else in this package can read the time — the thresholds are one,
   * five and ten minutes (`WAITING_AFTER_MS`, `ASLEEP_AFTER_MS`,
   * `EVICT_AFTER_MS`), and a test that had to wait any of them out would be no
   * test at all. This is the edge that supplies `Date.now` to all of it.
   */
  readonly now?: () => number;
  /**
   * Called after each accepted event has been folded in.
   *
   * A throw from it is caught and dropped: the daemon has no supervisor, and
   * the invariant that matters more than a consumer's error is that it keeps
   * running with the panel unplugged.
   *
   * Its only caller today is this package's own test suite, which uses it to
   * await a fold instead of polling or sleeping. It is here rather than in the
   * tests because a consumer that wants to push a frame on a change rather
   * than on a timer needs exactly this, and because a socket test that sleeps
   * is slow when it passes and flaky when it fails.
   */
  readonly onChange?: (registry: SessionRegistry) => void;
};

/** A running listener. `startSocketServer` is the only way to get one. */
export type SocketServer = {
  readonly path: string;
  /** The registry as it stands. Cheap, and safe to hold — registries are values. */
  readonly snapshot: () => SessionRegistry;
  /** Stop listening and drop every connection. Safe to call twice. */
  readonly close: () => Promise<void>;
};

class Listener {
  readonly path: string;
  readonly #now: () => number;
  readonly #statePath: string;
  readonly #onChange: ((registry: SessionRegistry) => void) | undefined;
  readonly #connections = new Set<Socket>();
  readonly #server: Server = createServer();
  // The whole reason this file is a class: the registry is a value, and this
  // is the one binding in the package allowed to point at a new one.
  // eslint-disable-next-line functional/prefer-readonly-type -- see above
  #registry: SessionRegistry;

  constructor(path: string, options: SocketServerOptions) {
    this.path = path;
    this.#now = options.now ?? Date.now;
    this.#statePath = options.statePath ?? statePathFor(path);
    this.#onChange = options.onChange;
    this.#registry = loadRegistry(this.#statePath, this.#now());
    this.#server.on('connection', (socket) => {
      this.#accept(socket);
    });
  }

  async listen(): Promise<void> {
    await this.#bind();
    try {
      chmodSync(this.path, SOCKET_MODE);
    } catch (cause) {
      // Refuse to run rather than serve a socket the rest of the machine can
      // write to. Closing first so the failure does not leave a listener the
      // caller has no handle on.
      await this.close();
      throw new Error(`could not restrict ${this.path} to its owner`, {
        cause,
      });
    }
  }

  /**
   * Drop one connection, if one should be dropped, before admitting another.
   *
   * The longest-lived one, unconditionally. See `MAX_CONNECTIONS` for why age
   * rather than delivery, and the note in the body for the signal that looked
   * like it should work and does not.
   */
  #makeRoom(): void {
    if (this.#connections.size < MAX_CONNECTIONS) return;
    // Insertion order, so this is the longest-lived one. Narrowed rather than
    // asserted: `?.` and `as Socket` on consecutive lines disagreed about
    // whether it could be undefined, and only one of them can be right.
    //
    // `bytesRead === 0` was tried here as a way to prefer a peer that has
    // delivered nothing. It is not the signal it looks like: a connection
    // accepted moments ago also reads 0, because its bytes are still in
    // flight, so in a burst the only peer at 0 is the newest arrival — the one
    // worth keeping.
    const victim = this.#connections.values().next().value;
    if (victim === undefined) return;
    victim.destroy();
    this.#connections.delete(victim);
  }

  snapshot(): SessionRegistry {
    return this.#registry;
  }

  async close(): Promise<void> {
    // Copied out first: the `close` handler removes each socket from the set
    // as it goes. Destroyed rather than ended, because `close` waits for every
    // connection to finish and a peer holding one open is not a reason for a
    // restart to hang.
    [...this.#connections].forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => {
      // The callback's error means the server was not running, which is what a
      // second close looks like and is not a failure. The unlink libuv does
      // here targets the private bind name from `#bind`, which the rename
      // already took away, so it is a no-op.
      this.#server.close(() => {
        resolve();
      });
    });
    await this.#unlinkIfOurs();
  }

  /**
   * Remove the public path, but only while it is still this listener's socket.
   *
   * The same question `prepareSocketPath` asks at startup, asked at shutdown,
   * and answered by the same primitive: connect to it. This runs after the
   * server has closed, so our own socket refuses and reads `stale` — that is
   * the one signal that means the file is ours to take away. Anything that
   * *answers* belongs to a daemon that is still running and is left where it
   * is; anything that is not a socket was never ours.
   *
   * Act on one specific signal, never on the absence of one. A probe that
   * cannot make up its mind removes nothing, which is the safe direction, and
   * a leftover file is what the next daemon's `prepareSocketPath` is for.
   */
  async #unlinkIfOurs(): Promise<void> {
    if ((await probeSocket(this.path)) !== 'stale') return;
    try {
      unlinkSync(this.path);
    } catch {
      // Gone between the probe and here, or not ours to remove. Neither is
      // worth failing a shutdown over.
    }
  }

  /**
   * Bind beside the real path, then hard-link onto it.
   *
   * **Two separate things have to be true, and `rename` only gave one of them.**
   *
   * The first is ownership at shutdown. `net.Server.close()` unlinks the path it
   * bound, in libuv, by name, with no way to veto it from JavaScript — measured.
   * A daemon that binds the public path directly will therefore delete whatever
   * socket file is sitting there when it closes, including one a *different*
   * daemon put there after this one's was removed. Binding a private name and
   * putting the public name on it another way fixes that: libuv's close-time
   * unlink targets the private name, which is gone by then, and `#unlinkIfOurs`
   * decides about the public one.
   *
   * The second is exclusivity at startup, and this is where `rename` was wrong.
   * `renameSync` onto a live socket **succeeds silently**, leaving the previous
   * daemon listening on an inode with no name and receiving nothing — the exact
   * "two daemons, one of them permanently deaf, no error anywhere" that
   * `socket-path.ts`'s header says the design exists to prevent, reintroduced by
   * the change that fixed its shutdown half. `listen()` on a taken path used to
   * fail loudly with `EADDRINUSE`; `rename` threw that away.
   *
   * `link` keeps both. It is atomic and it refuses with `EEXIST` if the name is
   * taken, so the race `socket-path.ts` §"What this does not close" describes —
   * probe says free, somebody binds before we do — fails loudly again instead of
   * quietly winning. Dropping the private name afterwards leaves one name on the
   * socket, which is what we want to reason about later.
   *
   * The window this does open, and it is real: between `listen` and `link` the
   * public path does not exist, so a hook connecting in that turn gets `ENOENT`
   * rather than us. It is one event-loop turn during startup, against a peer
   * whose alternative was no daemon at all.
   */
  #bind(): Promise<void> {
    const bindPath = temporaryBindPath(this.path);
    return new Promise((resolve, reject) => {
      const failed = (error: Error): void => {
        reject(error);
      };
      this.#server.once('error', failed);
      this.#server.listen(bindPath, () => {
        this.#server.off('error', failed);
        // Nothing supervises this process, and an `error` with no listener on
        // an EventEmitter throws. A daemon that outlives its display cannot
        // also be one that dies of a failed `accept`.
        this.#server.on('error', () => undefined);
        try {
          claimSocketPath(bindPath, this.path);
        } catch (error) {
          // The private socket is live and unreachable either way; taking the
          // listener down with it is the only tidy end.
          this.#server.close(() => undefined);
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  #accept(socket: Socket): void {
    this.#makeRoom();
    this.#connections.add(socket);
    // Strings, not buffers, from here on. The reader below would decode for
    // us either way; what matters is that nothing in this path cuts bytes by
    // hand, because a UTF-8 sequence split across two reads is the classic way
    // a hand-rolled buffer corrupts a line that was fine on the wire.
    socket.setEncoding('utf8');
    socket.on('data', () => {
      // Registered ahead of the reader so an over-long connection is cut at
      // the first chunk that crosses the line. It does not un-deliver that
      // chunk — the reader is handed it too — so what this bounds is the cap
      // plus one read, which is the point: nothing accumulates.
      if (socket.bytesRead > MAX_CONNECTION_BYTES) socket.destroy();
    });
    // `readline` owns the framing — partial lines across reads, several lines
    // in one read, and the trailing line of a peer that ended without a
    // newline. Its buffer belongs to the socket and goes when the socket does,
    // which is what makes a peer vanishing mid-line cost nothing.
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line) => {
      this.#fold(line);
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      lines.close();
      this.#connections.delete(socket);
    });
  }

  #fold(line: string): void {
    const event = parseHookEventLine(line);
    if (event === undefined) return;
    const now = this.#now();
    this.#registry = evictStale(observe(this.#registry, event, now), now);
    this.#persist();
    this.#notify();
  }

  #persist(): void {
    try {
      saveRegistry(this.#statePath, this.#registry);
    } catch {
      // A full disk, a read-only home, a directory somebody deleted. What is
      // lost is the shortcut across the next restart; what the panel shows is
      // held in memory and is still right.
    }
  }

  #notify(): void {
    try {
      this.#onChange?.(this.#registry);
    } catch {
      // Decision one: losing the panel must never take the daemon down. This
      // is where a transport gets wired, and its cable comes out of the back
      // of a desk.
    }
  }
}

/**
 * Start listening.
 *
 * The path is made bindable first — see `socket-path.ts` for why that is a
 * probe rather than an unlink — so a daemon already running on this socket
 * makes this reject instead of quietly taking its name away.
 */
export async function startSocketServer(
  options: SocketServerOptions = {},
): Promise<SocketServer> {
  const path = options.path ?? defaultSocketPath();
  await prepareSocketPath(path);
  const listener = new Listener(path, options);
  await listener.listen();
  return listener;
}
