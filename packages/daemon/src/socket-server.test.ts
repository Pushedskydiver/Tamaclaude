import type { SessionRegistry } from './registry.js';
import type { SocketServer } from './socket-server.js';
import type { Socket } from 'node:net';

import {
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { statePathFor } from './persistence.js';
import { resolvePanel } from './resolve.js';
import { MAX_CONNECTION_BYTES, startSocketServer } from './socket-server.js';
import { EVICT_AFTER_MS } from './state.js';

const NOW = 1_700_000_000_000;

const event = (sessionId: string, kind: string, tool?: string) =>
  `${JSON.stringify({ sessionId, kind, tool })}\n`;

/** One connection, one write, then gone — exactly what the hook does. */
function send(
  path: string,
  ...writes: readonly (string | Buffer)[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => {
      writes.forEach((chunk) => socket.write(chunk));
      socket.end();
    });
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}

/** Write far more than an event could be, and see whether we are cut off. */
function shout(path: string, data: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path, () => socket.end(data));
    socket.on('error', () => resolve(true));
    socket.on('close', (hadError) => resolve(hadError));
  });
}

/** An open connection the test drives write by write. */
function open(path: string): Promise<Socket> {
  return new Promise((resolve) => {
    const socket = connect(path, () => resolve(socket));
    socket.on('error', () => undefined);
  });
}

/** Connect, write, and walk away without a goodbye. */
function abandon(path: string, partial: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = connect(path, () => {
      socket.write(partial);
      socket.destroy();
    });
    socket.on('error', () => resolve());
    socket.on('close', () => resolve());
  });
}

/** A socket file whose listener is gone — see `socket-path.test.ts`. */
async function leaveStaleSocket(path: string): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(`${path}.bound`, resolve));
  renameSync(`${path}.bound`, path);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('startSocketServer', () => {
  let directory = '';
  let path = '';
  let clock = NOW;
  let folds = 0;
  let notify: (() => void) | undefined;
  let server: SocketServer | undefined;

  /** Resolves once the server has folded `count` events. No sleeping. */
  function folded(count: number): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (folds >= count) resolve();
      };
      notify = check;
      check();
    });
  }

  async function start() {
    const started = await startSocketServer({
      path,
      now: () => clock,
      onChange: () => {
        folds += 1;
        notify?.();
      },
    });
    server = started;
    return started;
  }

  function panel(registry: SessionRegistry) {
    return resolvePanel(registry, clock);
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tc-sock-'));
    path = join(directory, 'daemon.sock');
    clock = NOW;
    folds = 0;
    notify = undefined;
    server = undefined;
  });

  afterEach(async () => {
    await server?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('folds one event from one short-lived connection', async () => {
    const started = await start();
    await send(path, event('a', 'PreToolUse', 'Bash'));
    await folded(1);
    expect(panel(started.snapshot())).toMatchObject({
      state: 'WORKING',
      tool: 'Bash',
    });
  });

  it('handles many connections that each write once and exit', async () => {
    // The hook is a process per event, so this is the ordinary case rather
    // than a stress test: nothing here ever sees one long-lived stream.
    const started = await start();
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) =>
        send(path, event(id, 'UserPromptSubmit')),
      ),
    );
    await folded(5);
    expect(started.snapshot().sessions.size).toBe(5);
  });

  it('reads two events arriving in one write', async () => {
    const started = await start();
    await send(
      path,
      `${event('a', 'UserPromptSubmit')}${event('b', 'UserPromptSubmit')}`,
    );
    await folded(2);
    expect([...started.snapshot().sessions.keys()]).toEqual(['a', 'b']);
  });

  it('reads one event split across two reads', async () => {
    // The first write carries a whole event and the head of a second, so
    // awaiting its fold proves the server has already read past the partial —
    // without that, the kernel hands both writes over in one read and the
    // split this test is named for never happens.
    const started = await start();
    const socket = await open(path);
    const line = event('a', 'PreToolUse', 'Read');
    socket.write(`${event('first', 'Stop')}${line.slice(0, 12)}`);
    await folded(1);
    socket.write(line.slice(12));
    await folded(2);
    socket.end();
    expect(panel(started.snapshot())).toMatchObject({
      state: 'WORKING',
      tool: 'Read',
    });
  });

  it('reassembles an event split inside a multi-byte character', async () => {
    // A tool name from an MCP server can be anything. Splitting a UTF-8
    // sequence across two reads is the classic way a hand-rolled buffer
    // corrupts a line that was perfectly valid on the wire.
    const started = await start();
    const socket = await open(path);
    const line = Buffer.from(event('a', 'PreToolUse', 'héllo—wörld'), 'utf8');
    const cut = line.indexOf(Buffer.from('—', 'utf8')) + 1;
    socket.write(
      Buffer.concat([
        Buffer.from(event('first', 'Stop')),
        line.subarray(0, cut),
      ]),
    );
    await folded(1);
    socket.write(line.subarray(cut));
    await folded(2);
    socket.end();
    expect(started.snapshot().sessions.get('a')?.tool).toBe('héllo—wörld');
  });

  it('survives a peer that vanishes mid-line', async () => {
    const started = await start();
    await abandon(path, '{"sessionId":"ghost","kind":"PreTo');
    await send(path, event('a', 'UserPromptSubmit'));
    await folded(1);
    expect([...started.snapshot().sessions.keys()]).toEqual(['a']);
  });

  it('drops garbage and keeps reading the same connection', async () => {
    const started = await start();
    await send(
      path,
      'not json\n',
      '{"nope":1}\n',
      '[]\n',
      '\n',
      event('a', 'UserPromptSubmit'),
    );
    await folded(1);
    expect([...started.snapshot().sessions.keys()]).toEqual(['a']);
  });

  it('cuts off a peer that writes more than an event could ever be', async () => {
    // A line with no newline in it is the one thing a line reader cannot bound
    // by itself: without a cap it buffers whatever it is given, for as long as
    // the peer keeps typing.
    const started = await start();
    const flood = 'x'.repeat(MAX_CONNECTION_BYTES * 4);
    const cutOff = await shout(path, `${flood}\n${event('ghost', 'Stop')}`);
    expect(cutOff).toBe(true);

    await send(path, event('a', 'UserPromptSubmit'));
    await folded(1);
    expect([...started.snapshot().sessions.keys()]).toEqual(['a']);
  });

  it('contains a throw from the consumer', async () => {
    // Decision one: losing the panel must never take the daemon down. This
    // callback is where a transport gets wired, and a transport's cable comes
    // out of the back of a desk.
    //
    // Both events go in one write, so they are two lines of a single read: a
    // throw that escaped would abort the reader part way through the chunk and
    // the second event would never arrive. Counting sessions afterwards is
    // therefore an assertion about containment, not about the callback.
    const started = await startSocketServer({
      path,
      now: () => clock,
      onChange: () => {
        throw new Error('the panel is unplugged');
      },
    });
    server = started;
    await send(
      path,
      `${event('a', 'UserPromptSubmit')}${event('b', 'UserPromptSubmit')}`,
    );
    expect(started.snapshot().sessions.size).toBe(2);
  });

  it('counts an event it has no transition for as proof of life', async () => {
    const started = await start();
    await send(path, event('a', 'PostToolUse'));
    await folded(1);
    expect(started.snapshot().sessions.get('a')?.lastEventAt).toBe(NOW);
  });

  it('listens on a socket only its owner can reach', async () => {
    await start();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('takes over a socket file whose daemon is gone', async () => {
    await leaveStaleSocket(path);
    const started = await start();
    await send(path, event('a', 'UserPromptSubmit'));
    await folded(1);
    expect(started.snapshot().sessions.size).toBe(1);
  });

  it('refuses to start beside a daemon that is already listening', async () => {
    await start();
    await expect(startSocketServer({ path, now: () => clock })).rejects.toThrow(
      /already listening/,
    );
  });

  it('refuses to start on a path that is not a socket', async () => {
    writeFileSync(path, 'someone else lives here');
    await expect(startSocketServer({ path, now: () => clock })).rejects.toThrow(
      /not a socket/,
    );
  });

  it('remembers its sessions across a restart', async () => {
    const first = await start();
    await send(path, event('a', 'PreToolUse', 'Bash'));
    await folded(1);
    await first.close();

    clock = NOW + 1000;
    folds = 0;
    const second = await start();
    expect(panel(second.snapshot())).toMatchObject({
      state: 'WORKING',
      tool: 'Bash',
    });
  });

  it('forgets sessions that died while it was not running', async () => {
    const first = await start();
    await send(path, event('a', 'PreToolUse', 'Bash'));
    await folded(1);
    await first.close();

    clock = NOW + EVICT_AFTER_MS + 1;
    const second = await start();
    expect(second.snapshot().sessions.size).toBe(0);
    expect(panel(second.snapshot()).state).toBe('ASLEEP');
  });

  it('starts empty rather than failing on a corrupt state file', async () => {
    writeFileSync(statePathFor(path), 'not a state file');
    const started = await start();
    expect(started.snapshot().sessions.size).toBe(0);
    await send(path, event('a', 'UserPromptSubmit'));
    await folded(1);
    expect(started.snapshot().sessions.size).toBe(1);
  });

  it('closes cleanly, twice, and leaves no socket behind', async () => {
    const started = await start();
    await started.close();
    await started.close();
    expect(() => statSync(path)).toThrow();
  });

  it('releases the path for the next daemon', async () => {
    const first = await start();
    await first.close();
    const second = await start();
    await send(path, event('a', 'UserPromptSubmit'));
    await folded(1);
    expect(second.snapshot().sessions.size).toBe(1);
  });
});

describe('a state file that cannot be written', () => {
  // The header claims two failure invariants and says both are tested. Only
  // the `onChange` one was: nothing in the suite ever made a write fail, so
  // `#persist`'s catch was unreached by every passing test. A review counted
  // it. Pointing the state path *inside a regular file* makes `saveRegistry`'s
  // own `mkdirSync` throw ENOTDIR, which needs no mocking and no chmod.
  let directory = '';
  let server: SocketServer | undefined;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'tc-nostate-'));
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  it('costs the restart shortcut, not the session state', async () => {
    const blocker = join(directory, 'not-a-directory');
    writeFileSync(blocker, 'a regular file');
    const path = join(directory, 'daemon.sock');

    const folds: number[] = [];
    server = await startSocketServer({
      path,
      now: () => NOW,
      statePath: join(blocker, 'state.json'),
      onChange: () => folds.push(1),
    });

    await send(path, event('a', 'UserPromptSubmit'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Still serving, and the session is right in memory — which is what the
    // panel draws from.
    expect(folds.length).toBe(1);
    expect(server.snapshot().sessions.has('a')).toBe(true);
    expect(() => statSync(path)).not.toThrow();
  });

  it('keeps folding after the write has already failed once', async () => {
    // Distinct from the test above, which pins one failure. This pins that a
    // failure does not poison the next event — and it is written against
    // `onChange` rather than the snapshot on purpose: `#registry` is assigned
    // *before* `#persist` runs, so a snapshot assertion passes whether the
    // catch is there or not. That first draft was a test that could not fail.
    const blocker = join(directory, 'not-a-directory');
    writeFileSync(blocker, 'a regular file');
    const path = join(directory, 'daemon.sock');
    const statePath = join(blocker, 'state.json');

    const folds: string[] = [];
    server = await startSocketServer({
      path,
      now: () => NOW,
      statePath,
      onChange: (registry) => folds.push(String(registry.sessions.size)),
    });

    await send(path, event('a', 'UserPromptSubmit'));
    await send(path, event('b', 'UserPromptSubmit'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(folds).toEqual(['1', '2']);
    // And the shortcut really is what was lost — nothing was written.
    expect(() => statSync(statePath)).toThrow();
  });
});

describe('many peers at once', () => {
  // `MAX_CONNECTION_BYTES` bounds what one connection writes. Nothing bounded
  // how many connections there could be, so a peer that connects and stays
  // silent held a Set entry and a file descriptor for as long as it liked.
  let directory = '';
  let server: SocketServer | undefined;
  let path = '';

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'tc-many-'));
    path = join(directory, 'daemon.sock');
    server = await startSocketServer({ path, now: () => NOW });
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
    rmSync(directory, { recursive: true, force: true });
  });

  /** Sequentially, so the daemon sees them in a known order. */
  const openMany = (count: number): Promise<readonly Socket[]> =>
    Array.from({ length: count }).reduce<Promise<readonly Socket[]>>(
      async (soFar) => [...(await soFar), await open(path)],
      Promise.resolve([]),
    );

  it('drops the longest-lived peer rather than growing without limit', async () => {
    const first = await open(path);
    const closed = new Promise<boolean>((resolve) => {
      first.on('close', () => resolve(true));
    });
    // Fill the rest of the cap, then push one past it.
    const rest = await openMany(64);

    // Raced against a deadline rather than left to the suite's timeout. The
    // first version of this test had no `expect` at all: it passed or failed
    // purely on whether a `close` event arrived, which is the shape that goes
    // intermittent on a loaded machine — and a review saw it fail three times
    // before it settled.
    //
    // What the deadline buys is a *named* failure, not a wider window. It is
    // narrower: vitest's 5 s test timeout still bounds the whole thing, and
    // 2 s is the tighter of the two. An earlier version of this comment
    // claimed the opposite. The narrowing is affordable because eviction is
    // synchronous with the 65th accept, so the wait is not doing work —
    // measured on darwin 25.5.0 / Node 24, the worst of ten runs with 200 busy
    // loops on ten cores was 104 ms.
    const evicted = await Promise.race([
      closed,
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 2_000),
      ),
    ]);
    expect(evicted).toBe(true);
    rest.forEach((socket) => socket.destroy());
  });

  it('still serves a real hook once the cap has bitten', async () => {
    // The point of evicting the oldest rather than refusing the newest: a
    // flooder must not be able to lock the actual hooks out. Asserting that
    // some of the held sockets were dropped is what makes this pin the cap —
    // without it the test passed with the cap removed entirely, since 70 idle
    // connections plus a hook are served fine when nothing is bounded.
    const held = await openMany(70);
    await send(path, event('a', 'UserPromptSubmit'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server?.snapshot().sessions.has('a')).toBe(true);
    expect(held.filter((socket) => socket.destroyed).length).toBeGreaterThan(0);
    held.forEach((socket) => socket.destroy());
  });
});
