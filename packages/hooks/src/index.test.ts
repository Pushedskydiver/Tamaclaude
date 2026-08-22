/**
 * `tamaclaude-notify`, exercised as a real process.
 *
 * Everything this binary gets wrong, it gets wrong at the process level: an
 * exit code Claude Code turns into an error in the transcript, a byte on
 * stdout it parses as a decision object, a wait the user pays for. None of
 * that is observable from a unit test of a pure function, so these run the
 * built artefact — which is also why `pnpm test` builds first. The one thing a
 * unit test would cover that these do not is a translation of a payload shape
 * Claude Code never sends.
 *
 * The near-leaf tests at the bottom predate these and guard a different
 * invariant: the dependency list, not the behaviour.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BUILT = resolve(fileURLToPath(import.meta.url), '../../dist/index.js');

type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly ms: number;
};

/**
 * Run the binary against a socket path, feeding it `stdin`.
 *
 * Passing `null` for `stdin` leaves the pipe open and never ends it, which is
 * what an interactive terminal looks like to this program. Without the
 * deadline that case never exits, so the test would hang rather than fail —
 * hence the guard: every call is given twice the deadline plus room for Node
 * to start, and reports what it saw either way.
 */
function runHook(socket: string, stdin: string | null): Promise<Run> {
  const started = Date.now();
  return new Promise<Run>((resolveRun) => {
    const child = spawn(process.execPath, [BUILT], {
      env: { ...process.env, TAMACLAUDE_SOCKET: socket },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    if (stdin !== null) child.stdin.end(stdin);
    const guard = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.on('close', (code) => {
      clearTimeout(guard);
      resolveRun({ code, stdout, ms: Date.now() - started });
    });
  });
}

type Listener = {
  readonly received: Promise<string>;
  readonly connections: () => number;
  readonly close: () => void;
};

/** A stand-in daemon: accepts one connection and reports what arrived. */
function listen(socket: string, drain = true): Listener {
  let connections = 0;
  const server = createServer((connection) => {
    connections += 1;
    if (!drain) return;
    let body = '';
    connection.on('data', (chunk: Buffer) => (body += chunk.toString()));
    connection.on('end', () => resolveReceived(body));
  });
  let resolveReceived: (body: string) => void = () => {};
  const received = new Promise<string>((r) => (resolveReceived = r));
  server.listen(socket);
  return {
    received,
    connections: () => connections,
    close: () => server.close(),
  };
}

describe('tamaclaude-notify', () => {
  let dir = '';
  let socket = '';

  beforeEach(() => {
    // Short by necessity: a Unix socket path is capped at 104 bytes on macOS,
    // and a nested per-test directory under a long TMPDIR reaches that.
    dir = mkdtempSync(join(tmpdir(), 'tamaclaude-'));
    socket = join(dir, 'd.sock');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('translating Claude Code payloads', () => {
    it('renames the fields the daemon needs and drops the rest', async () => {
      const daemon = listen(socket);
      const run = await runHook(
        socket,
        JSON.stringify({
          session_id: 'abc123',
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          // Dropped deliberately. A `Write` carries a whole file in here, and
          // the daemon maps the tool's name, never its argument.
          tool_input: { command: 'ls' },
          cwd: '/somewhere',
          transcript_path: '/somewhere/transcript.jsonl',
        }),
      );
      const body = await daemon.received;
      daemon.close();

      expect(run.code).toBe(0);
      expect(JSON.parse(body)).toEqual({
        sessionId: 'abc123',
        kind: 'PreToolUse',
        tool: 'Bash',
      });
    });

    it('carries the subagent fields through', async () => {
      const daemon = listen(socket);
      await runHook(
        socket,
        JSON.stringify({
          session_id: 'abc123',
          hook_event_name: 'SubagentStart',
          agent_id: 'sub-1',
          agent_type: 'Explore',
        }),
      );
      const body = await daemon.received;
      daemon.close();

      expect(JSON.parse(body)).toEqual({
        sessionId: 'abc123',
        kind: 'SubagentStart',
        agentId: 'sub-1',
        agentType: 'Explore',
      });
    });

    it('carries error_type, which nothing reads yet', async () => {
      const daemon = listen(socket);
      await runHook(
        socket,
        JSON.stringify({
          session_id: 'abc123',
          hook_event_name: 'StopFailure',
          error_type: 'rate_limit',
        }),
      );
      const body = await daemon.received;
      daemon.close();

      expect(JSON.parse(body)).toEqual({
        sessionId: 'abc123',
        kind: 'StopFailure',
        errorType: 'rate_limit',
      });
    });

    it('terminates the event with a newline, so the stream is NDJSON', async () => {
      const daemon = listen(socket);
      await runHook(
        socket,
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      const body = await daemon.received;
      daemon.close();

      expect(body.endsWith('\n')).toBe(true);
    });

    it('prints nothing, because stdout is read as a decision object', async () => {
      // Claude Code parses a hook's stdout when it exits 0 and treats a
      // leading `{` as JSON decision fields. The placeholder this replaced
      // wrote exactly that shape on every event.
      const daemon = listen(socket);
      const run = await runHook(
        socket,
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      await daemon.received;
      daemon.close();

      expect(run.stdout).toBe('');
    });
  });

  describe('failing without the user noticing', () => {
    it('exits 0 when no daemon is listening', async () => {
      const run = await runHook(
        socket,
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      expect(run.code).toBe(0);
    });

    it('exits 0 when the socket file is stale, and leaves it alone', async () => {
      // A file where a socket should be: what a daemon killed with SIGKILL
      // leaves behind. Deleting it is the daemon's job — a hook that unlinks
      // paths is a hook that can unlink the wrong one.
      writeFileSync(socket, 'not a socket');
      const run = await runHook(
        socket,
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      expect(run.code).toBe(0);
    });

    it('exits 0 when the socket path is longer than sun_path allows', async () => {
      const run = await runHook(
        join(dir, `${'a'.repeat(120)}.sock`),
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      expect(run.code).toBe(0);
    });

    it('exits 0 on malformed stdin, without connecting at all', async () => {
      const daemon = listen(socket);
      const run = await runHook(socket, 'not json');
      daemon.close();

      expect(run.code).toBe(0);
      expect(daemon.connections()).toBe(0);
    });

    it('exits 0 on empty stdin', async () => {
      const daemon = listen(socket);
      const run = await runHook(socket, '');
      daemon.close();

      expect(run.code).toBe(0);
      expect(daemon.connections()).toBe(0);
    });

    it('exits 0 when the payload has no session_id to key on', async () => {
      const daemon = listen(socket);
      const run = await runHook(
        socket,
        JSON.stringify({ hook_event_name: 'Stop' }),
      );
      daemon.close();

      expect(run.code).toBe(0);
      expect(daemon.connections()).toBe(0);
    });

    it('exits 0 when the daemon accepts but never reads', async () => {
      const daemon = listen(socket, false);
      const run = await runHook(
        socket,
        JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
      );
      daemon.close();

      expect(run.code).toBe(0);
      expect(run.ms).toBeLessThan(2000);
    });

    it('exits 0 on the deadline when stdin never ends', async () => {
      // What running it in a terminal looks like. Without the deadline this
      // waits for ever, and the user waits with it.
      const run = await runHook(socket, null);

      expect(run.code).toBe(0);
      expect(run.ms).toBeLessThan(2000);
    });
  });
});

/**
 * The near-leaf invariant, enforced.
 *
 * Claude Code executes this package's binary on every hook event, many times
 * per turn, so its dependency list is a latency budget rather than a style
 * preference. That invariant is asserted in `CLAUDE.md`, `docs/ARCHITECTURE.md`
 * and `docs/DA-REVIEW.md`, and until this test existed it was enforced in none
 * of them: `eslint-plugin-boundaries` governs workspace edges only, so an
 * `import { z } from 'zod'` here passed the entire quality suite silently.
 *
 * Asserting against the manifest rather than the import graph is deliberate.
 * pnpm's strict `node_modules` means this package can only import what it
 * declares, so the manifest is the real gate — and unlike a lint rule it does
 * not depend on a plugin's deprecation cycle.
 */
describe('hooks stays near-leaf', () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('declares exactly one runtime dependency', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([
      '@tamaclaude/protocol',
    ]);
  });

  it('has no non-workspace runtime dependency', () => {
    const external = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => !name.startsWith('@tamaclaude/'),
    );
    expect(external).toEqual([]);
  });

  it('imports @tamaclaude/protocol only as a type', () => {
    // A type-only import erases under `verbatimModuleSyntax`, so the built
    // binary loads Node builtins and nothing else. A value import would pull
    // the whole wire protocol — codec, geometry, dirty rects — into a process
    // that starts on every tool call. It costs nothing to check.
    const built = readFileSync(BUILT, 'utf8');
    expect(built).not.toContain('@tamaclaude/protocol');
  });

  it('loads nothing at run time but Node builtins', () => {
    // The exact list, not just "no workspace import". The two assertions above
    // catch a dependency arriving through `package.json` or through
    // `@tamaclaude/protocol`; neither catches `import { z } from 'zod'` typed
    // straight into this file, because `zod` is hoisted to the workspace root
    // and resolves fine at run time without ever appearing in this manifest.
    //
    // Pinned rather than merely filtered, because the number is the finding.
    // Measured 22 Aug: the whole binary costs ~42 ms an event, of which 38 ms
    // is bare `node -e ''` on the same machine and 3.2 ms is this graph. There
    // is no import discipline left to buy — the remaining 90% is the runtime
    // starting, and the only lever on it is not spawning one. A timing
    // assertion here would measure the CI runner instead.
    const built = readFileSync(BUILT, 'utf8');
    const imports = [...built.matchAll(/^import[^;]*?from\s+'([^']+)'/gm)].map(
      (match) => match[1],
    );
    expect(imports.filter((name) => !name.startsWith('node:'))).toEqual([]);
    expect([...imports].sort()).toEqual([
      'node:net',
      'node:os',
      'node:path',
      'node:process',
      'node:stream/consumers',
    ]);
  });
});
