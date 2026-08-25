import type { SerialSystem, SerialWatch } from '@tamaclaude/device';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createRegistry, observe, resolvePanel } from '@tamaclaude/daemon';
import { parsePackManifest } from '@tamaclaude/packs';
import { loadSprite, render } from '@tamaclaude/renderer';

import {
  animationForPanel,
  frameAt,
  framesFor,
  runDaemon,
  sceneFor,
} from './daemon.js';

const NOW = 1_700_000_000_000;

function examplePack(): unknown {
  const root = resolve(fileURLToPath(import.meta.url), '../../../..');
  return JSON.parse(
    readFileSync(join(root, 'packs/example/manifest.json'), 'utf8'),
  ) as unknown;
}

/** A panel that records what reached the wire, and never wedges. */
function fakeSerial() {
  const state = {
    written: [] as number[],
    watch: undefined as SerialWatch | undefined,
  };
  const system: SerialSystem = {
    open: async (_path, watch) => {
      await new Promise((done) => setTimeout(done, 0));
      state.watch = watch;
      return {
        write: async (bytes) => {
          state.written.push(...bytes);
          return bytes.byteLength;
        },
        close: async () => undefined,
      };
    },
  };
  return {
    state,
    system,
    /** The status line the firmware sends, which is what brings the link up. */
    announce: () =>
      state.watch?.onData(
        Buffer.from('# rects 0 resync 0/0 abort 0 panel 320x172 landscape\n'),
      ),
    /** The firmware reporting it lost ground, which owes a whole frame again. */
    resync: () =>
      state.watch?.onData(
        Buffer.from('# rects 9 resync 1/0 abort 0 panel 320x172 landscape\n'),
      ),
  };
}

/** One connection, one write, then gone — exactly what the hook does. */
function send(path: string, line: string): Promise<void> {
  return new Promise((done, fail) => {
    const socket = connect(path, () => socket.end(line));
    socket.on('error', fail);
    socket.on('close', () => done());
  });
}

const delay = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/**
 * Poll until `ready` holds, or give up after `within` ms.
 *
 * A fixed `delay` before an assertion is a bet that the machine is not busy,
 * and `pnpm test` runs the suite in parallel, so the bet is worst exactly when
 * the suite is largest. This one was lost: "paints the panel from a hook
 * event" asserted a frame had reached the wire 60ms after the hook, and adding
 * two unrelated tests elsewhere in the repo was enough to make it fail two runs
 * in three — while passing four of four when run alone.
 *
 * Waiting for the condition instead is both faster on an idle machine and
 * robust on a busy one. The timeout is only there so a genuine regression
 * fails rather than hangs; it is not the expected wait.
 */
const until = async (ready: () => boolean, within = 2000): Promise<void> => {
  const deadline = Date.now() + within;
  while (!ready() && Date.now() < deadline) await delay(5);
};

describe('the daemon command', () => {
  const running: (() => Promise<void>)[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(running.splice(0).map((stop) => stop()));
    directories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true });
    });
  });

  async function start(
    serial: SerialSystem,
    extra: { readonly refreshMs?: number } = {},
  ) {
    const directory = mkdtempSync(join(tmpdir(), 'tc-daemon-'));
    directories.push(directory);
    const socketPath = join(directory, 'daemon.sock');
    const daemon = await runDaemon({
      socketPath,
      devicePath: '/dev/fake',
      pack: examplePack(),
      serial,
      now: () => NOW,
      frameMs: 5,
      // Quiet, so a test run does not print a link line per phase change.
      report: () => undefined,
      ...extra,
    });
    running.push(() => daemon.stop());
    return { socketPath, daemon };
  }

  it('paints the panel from a hook event, end to end', async () => {
    // The whole point of the command, and the thing `BUILD_PLAN.md` calls
    // Stage 3's open exit: the pieces all existed and nothing composed them.
    // A hook writes to the socket; a frame reaches the wire.
    const serial = fakeSerial();
    const { socketPath } = await start(serial.system);
    // The panel opens in the background, so the firmware cannot have spoken
    // yet — `openPanel` returns before `state.watch` exists.
    await delay(20);
    serial.announce();
    await delay(30);

    const before = serial.state.written.length;
    await send(
      socketPath,
      `${JSON.stringify({ sessionId: 's1', kind: 'PreToolUse', tool: 'Bash' })}\n`,
    );
    await until(() => serial.state.written.length > before);

    expect(serial.state.written.length).toBeGreaterThan(before);
  });

  it('sends nothing while the panel would not change', async () => {
    // At 8fps a daemon that resent an identical panel would spend the link on
    // nothing. The dirty-rect diff is what stops it, and this is the test that
    // it is actually wired in rather than merely available.
    const serial = fakeSerial();
    await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(60);

    const settled = serial.state.written.length;
    await delay(60);
    expect(serial.state.written.length).toBe(settled);
  });

  it('re-primes with the current frame when the device resyncs', async () => {
    // `transport.ts` puts this obligation on the caller in terms: "When
    // `status().needsPrime` is set, send the frame you are currently on, not
    // the first one." This composition is its only caller, and a review showed
    // that deleting the re-prime entirely left every test green — the first
    // frame primes anyway through the `previous === undefined` branch, so the
    // reconnect and resync paths were invisible.
    const serial = fakeSerial();
    const { socketPath } = await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(30);

    // Move the panel, so the current frame is no longer the primed one.
    await send(
      socketPath,
      `${JSON.stringify({ sessionId: 's1', kind: 'PreToolUse', tool: 'Bash' })}\n`,
    );
    await delay(40);

    const before = serial.state.written.length;
    // A resync: the firmware lost ground and owes a whole frame again.
    serial.resync();
    await delay(60);
    const primed = serial.state.written.length - before;

    // A whole 320x172 frame is far larger than any dirty rect this panel
    // produces from a message change, so size alone tells them apart.
    expect(primed).toBeGreaterThan(1000);
  });

  it('re-primes on the refresh timer, with nothing else happening', async () => {
    // `refreshMs` and `retryMs` were added to `DaemonOptions` so that a test
    // could reach this path, and then no test did — public API on a promise it
    // did not keep. `link.ts`'s `afterRefresh` owes a whole frame every five
    // seconds precisely because the loss it covers is the one the firmware
    // cannot see, so the daemon repaints the panel unprompted. This is that,
    // with the timer wound right down.
    const serial = fakeSerial();
    await start(serial.system, { refreshMs: 30 });
    await delay(20);
    serial.announce();
    await delay(40);

    const settled = serial.state.written.length;
    // Nothing arrives on the socket; only the refresh can move this.
    await delay(150);
    expect(serial.state.written.length).toBeGreaterThan(settled);
  });

  it('stops cleanly, leaving no socket behind', async () => {
    const serial = fakeSerial();
    const { socketPath, daemon } = await start(serial.system);
    await delay(20);
    serial.announce();
    await delay(20);
    await daemon.stop();
    running.splice(0);
    await expect(send(socketPath, '{}\n')).rejects.toThrow();
  });
});

describe('what the panel says', () => {
  const pack = parsePackManifest(examplePack());

  type HookEvent = Parameters<typeof observe>[1];
  type Registry = ReturnType<typeof createRegistry>;

  /** A registry with these events folded in, at a fixed clock. */
  function after(...events: readonly HookEvent[]): Registry {
    return events.reduce<Registry>(
      (registry, event) => observe(registry, event, NOW),
      createRegistry(NOW),
    );
  }

  it('tells a blocked session apart from a working one', () => {
    // The defect this exists for. `message` was `panel.tool ?? panel.state`,
    // and `StopFailure` never clears `tool` — so a session that died on a rate
    // limit rendered the word `Bash`, pixel-for-pixel identical to one happily
    // running Bash. `NEEDS_PERMISSION` has no tool, so it put the raw enum on
    // the glass. All three measured; all three now say something different.
    const working = sceneFor({
      registry: after({ sessionId: 's', kind: 'PreToolUse', tool: 'Bash' }),
      pack,
      now: NOW,
    });
    const blocked = sceneFor({
      registry: after({ sessionId: 's', kind: 'PermissionRequest' }),
      pack,
      now: NOW,
    });
    const failed = sceneFor({
      registry: after(
        { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
        { sessionId: 's', kind: 'StopFailure' },
      ),
      pack,
      now: NOW,
    });

    expect(working.message).toBe('Bash');
    expect(blocked.message).toBe(pack.quips.mapped.NEEDS_PERMISSION);
    expect(failed.message).toBe(pack.quips.mapped.FAILED);
    expect(
      new Set([working.message, blocked.message, failed.message]).size,
    ).toBe(3);
  });

  it('never shows the tool of a session that died running it', () => {
    // The defect `messageFor` was written to prevent, reachable again through
    // the pack. `StopFailure` does not clear `tool`, so a session that died on
    // a rate limit still carries `Bash` — and the tool line had no state
    // filter, so the only thing keeping it off the glass was the example pack
    // happening to define `quips.mapped.FAILED`.
    //
    // Packs are hand-edited and Zod-validated, i.e. a trust boundary. A pack
    // that omits the key renders the word `Bash` for a dead session —
    // pixel-for-pixel identical to one happily running Bash, which is exactly
    // what this function's own doc says it exists to stop.
    //
    // **Two keys shielded the example pack, not one.** `quips.mapped.FAILED`
    // covers the general case, and `FAILED:rate_limit` covers this one, because
    // `refinedFailureLine` runs ahead of both the mapped lookup and the tool
    // line. The session below fails with `rate_limit` on purpose — it is the
    // path with two shields, so emptying `mapped` is what reaches the defect.
    //
    // `FAILED` is the only live state that reaches the *panel* with a stale
    // tool. The assertions below pin that it does, not that it is the only one
    // — the uniqueness is an argument from `TRANSITIONS`, where every other
    // route into a toolless state clears `tool` on the way, and nothing here
    // holds it.
    //
    // It does not reach the message band. In this test that is down to the
    // whitelist alone, because `bare` empties `mapped` — which is the point of
    // emptying it. With the shipping pack, `refinedFailureLine` and the
    // `mapped` lookup both answer first, as the paragraph above says.
    //
    // This comment said "reaches the tool line" until 25 Aug, flatly, which
    // read as the opposite of what the assertions at the end of this test pin.
    // Counting lines here would be a third stale claim in the same block, so
    // this one points at the code by name instead.
    //
    // `SessionEnd` also leaves `tool` set, at `ASLEEP` — the panel never sees
    // it because `isLive` drops a session with `endedAt`, which is a different
    // reason from the one an earlier version of this comment gave, and the
    // reason a whitelist beats a `FAILED`-only blacklist.
    const bare = parsePackManifest({
      ...pack,
      quips: { ...pack.quips, mapped: {} },
    });
    const died = observe(
      observe(
        createRegistry(NOW),
        { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
        NOW,
      ),
      { sessionId: 's', kind: 'StopFailure', errorType: 'rate_limit' },
      NOW,
    );
    // The state is asserted, not just the tool — the row discipline this
    // branch established two commits ago, applied to its own new test.
    expect(resolvePanel(died, NOW).state).toBe('FAILED');
    expect(resolvePanel(died, NOW).tool).toBe('Bash');
    // `.toBe`, not `.not.toBe('Bash')`, which passes for any string at all.
    // This pins the last-resort branch as well as the absence of the tool.
    expect(sceneFor({ registry: died, pack: bare, now: NOW }).message).toBe(
      'failed',
    );

    // And the two states where the tool *is* the interesting fact still show
    // it — so this is a filter, not a removal.
    const working = observe(
      createRegistry(NOW),
      { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
      NOW,
    );
    expect(sceneFor({ registry: working, pack: bare, now: NOW }).message).toBe(
      'Bash',
    );
    const asking = observe(
      working,
      { sessionId: 's', kind: 'PermissionRequest', tool: 'Write' },
      NOW,
    );
    expect(sceneFor({ registry: asking, pack: bare, now: NOW }).message).toBe(
      'Write',
    );

    // **And a mapped quip still beats the tool**, which nothing pinned until a
    // review swapped the two lookups and watched the whole suite stay green.
    // `NEEDS_PERMISSION` is the only state in the shipping pack that has both
    // a tool and a mapped quip, and the assertions above hand it `bare` — the
    // one pack shape where the precedence cannot be observed. With the real
    // pack the reorder renders `Write` where it should say "may I?", and
    // `hooks` sets `tool` on every tool-scoped event, so real permission
    // requests do arrive carrying one.
    expect(sceneFor({ registry: asking, pack, now: NOW }).message).toBe(
      pack.quips.mapped.NEEDS_PERMISSION,
    );
  });

  it('says happy birthday all day, without hiding anything that needs a human', () => {
    // **This is not the rule `DONE` is ranked by, and an earlier version of
    // this comment said it was.** `DONE` loses to `WORKING` and `THINKING`
    // (`state.ts` ranks it 5 against their 3 and 4) on the grounds that "a
    // payoff belongs on a quiet desk". The birthday quip covers them. The two
    // rules share exactly one half — neither covers a state asking for a human
    // — and it was the appeal to precedent that was false, not the behaviour.
    //
    // The reason they differ: `STATE_RANK` decides which session owns the
    // *stage*, and showing a resting Clawd over a running tool is a lie about
    // what is happening. This decides the *message band* only; the animation
    // still shows the work, so nothing on the glass is false. And `DONE` is
    // triggered by quiet, which makes "belongs on a quiet desk" nearly
    // tautological for it, while a birthday is a property of the day and holds
    // whatever the desk is doing. A line that waited for a quiet desk could be
    // missed for a whole working Wednesday, which is the one outcome the
    // feature exists to prevent.
    const birthdayPack = parsePackManifest({
      ...pack,
      // A mapped quip on a *non-attention* state, which the example pack has
      // none of — its three keys are all attention states. Without one, moving
      // the birthday lookup to sit after the mapped lookup left the whole
      // suite green, so the precedence this function exists to establish was
      // asserted nowhere.
      quips: {
        ...pack.quips,
        mapped: { ...pack.quips.mapped, IDLE: 'nothing doing' },
      },
      birthday: { date: '09-23', quip: 'happy birthday' },
    });
    const onTheDay = new Date(2026, 8, 23, 10, 0, 0).getTime();
    const dayBefore = new Date(2026, 8, 22, 10, 0, 0).getTime();

    // Built at the instant it is resolved at, not at the file's `NOW` — which
    // is 14 Nov 2023, two years and ten months before the birthday under test.
    // The first version of this test used the `after(...)` helper above, so
    // every session was long past `EVICT_AFTER_MS` by the time the scene
    // rendered and the "blocked" panel it asserted against was an empty desk.
    const at = (events: readonly HookEvent[], when: number): Registry =>
      events.reduce<Registry>(
        (registry, event) => observe(registry, event, when),
        createRegistry(when),
      );

    /**
     * One row: assert the events really produce `state`, then assert whether
     * the birthday covers it.
     *
     * **The state assertion is the point.** The previous version of this table
     * asserted only the message, and two of its rows silently did not produce
     * the state they named: `SessionEnd` sets `endedAt`, so the session is not
     * live and the panel is an empty desk resolving to `IDLE` with no sessions
     * — the exact failure the comment above says the version before it fell
     * into, four lines further down — and `PreToolUse` alone never promotes to
     * `DONE`, because `effectiveState` returns early for any stored state that
     * is not `IDLE`. The table claimed eight states and covered six, and a
     * mutant that made the birthday step aside for `DONE` and `ASLEEP` survived
     * the entire suite. A message-only assertion cannot see a mislabelled row.
     */
    const check = (row: {
      readonly state: string;
      readonly events: readonly HookEvent[];
      readonly celebrates: boolean;
      readonly builtAt?: number;
    }): void => {
      const { state, events, celebrates, builtAt = onTheDay } = row;
      const registry = at(events, builtAt);
      expect(resolvePanel(registry, onTheDay).state, `${state} setup`).toBe(
        state,
      );
      const { message } = sceneFor({
        registry,
        pack: birthdayPack,
        now: onTheDay,
      });
      if (celebrates) expect(message, state).toBe('happy birthday');
      else expect(message, state).not.toBe('happy birthday');
    };

    // Covered: the birthday replaces the line. `IDLE` also carries a mapped
    // quip, so this is what pins the lookup order.
    const P = { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' } as const;
    check({
      state: 'THINKING',
      events: [{ sessionId: 's', kind: 'UserPromptSubmit' }],
      celebrates: true,
    });
    check({ state: 'WORKING', events: [P], celebrates: true });
    check({
      state: 'IDLE',
      events: [{ sessionId: 's', kind: 'Stop' }],
      celebrates: true,
    });
    check({
      state: 'ASLEEP',
      events: [{ sessionId: 's', kind: 'Stop' }],
      celebrates: true,
      builtAt: onTheDay - 300_000,
    });
    check({
      state: 'DONE',
      events: [P, { sessionId: 's', kind: 'Stop' }],
      celebrates: true,
      builtAt: onTheDay - 45_000,
    });

    // Guarded: something is asking for a human, so it still says so.
    check({
      state: 'NEEDS_PERMISSION',
      events: [{ sessionId: 's', kind: 'PermissionRequest' }],
      celebrates: false,
    });
    check({
      state: 'FAILED',
      events: [{ sessionId: 's', kind: 'StopFailure' }],
      celebrates: false,
    });
    check({
      state: 'FAILED',
      events: [
        { sessionId: 's', kind: 'StopFailure', errorType: 'rate_limit' },
      ],
      celebrates: false,
    });
    check({
      state: 'WAITING',
      events: [{ sessionId: 's', kind: 'Notification' }],
      celebrates: false,
      builtAt: onTheDay - 60_000,
    });

    // And on any other day the mapped quip wins, which is the same assertion
    // read backwards: the birthday is the only reason it ever loses.
    expect(
      sceneFor({
        registry: at([{ sessionId: 's', kind: 'Stop' }], dayBefore),
        pack: birthdayPack,
        now: dayBefore,
      }).message,
    ).toBe('nothing doing');
  });

  it('picks overheated for a rate limit on the path the panel actually uses', () => {
    // The production path, not the table. `animationFor` is unit-tested, but
    // `paintOnce` composed the arguments inline and nothing exercised that
    // composition — deleting the `errorType` argument left every test green
    // with the feature gone. This is the test that notices.
    const limited = after(
      { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
      { sessionId: 's', kind: 'StopFailure', errorType: 'rate_limit' },
    );
    const other = after(
      { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
      { sessionId: 's', kind: 'StopFailure', errorType: 'server_error' },
    );
    expect(animationForPanel(resolvePanel(limited, NOW))).toBe('overheated');
    expect(animationForPanel(resolvePanel(other, NOW))).toBe('dizzy');
  });

  it('gives a rate limit its own quip, so it is not just a different picture', () => {
    // `overheated` and `dizzy` are both `FAILED`, so without a compound key
    // they would share the message band and the picture would be the only
    // difference between them. The key falls back to the bare state, which is
    // what every other `error_type` gets.
    const limited = sceneFor({
      registry: after(
        { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
        { sessionId: 's', kind: 'StopFailure', errorType: 'rate_limit' },
      ),
      pack,
      now: NOW,
    });
    const other = sceneFor({
      registry: after(
        { sessionId: 's', kind: 'PreToolUse', tool: 'Bash' },
        { sessionId: 's', kind: 'StopFailure', errorType: 'server_error' },
      ),
      pack,
      now: NOW,
    });
    expect(limited.message).toBe(pack.quips.mapped['FAILED:rate_limit']);
    expect(other.message).toBe(pack.quips.mapped.FAILED);
    expect(limited.message).not.toBe(other.message);
  });

  it('never puts a raw state name on the glass', () => {
    // `state.ts` says these are SCREAMING_SNAKE *because a state name is also a
    // quip key*. One reaching the panel means the pack was not consulted.
    const states = ['SessionStart', 'Stop', 'PermissionRequest', 'StopFailure'];
    states.forEach((kind) => {
      const scene = sceneFor({
        registry: after({ sessionId: 's', kind }),
        pack,
        now: NOW,
      });
      expect(scene.message).not.toMatch(/^[A-Z_]+$/);
    });
  });

  it('puts Clawd somewhere, rather than on a flat background', () => {
    // `environment` is optional on `Scene` and the daemon simply did not pass
    // it, so the rock pool in `packages/renderer/src/environment.ts` was built
    // and reachable by nothing. `BUILD_PLAN.md` calls judging animations
    // against a black stage "judging them in the wrong context", which is why
    // this is wired before the next three animations rather than after.
    const scene = sceneFor({
      registry: after({ sessionId: 's', kind: 'SessionStart' }),
      pack,
      now: NOW,
    });
    expect(scene.environment?.extent).toBe('panel');
  });

  it('wears the sky the local hour calls for', () => {
    // Local hours, because `timeOfDay` reads `getHours()` the way `clockText`
    // does. Built from parts rather than an ISO string for that reason: an
    // ISO instant would land in a different bucket in a different timezone and
    // the test would pass or fail by where it was run.
    // On the hour, so the assertions below sit exactly on the boundaries
    // rather than half an hour inside them.
    const at = (hour: number): number =>
      new Date(2026, 8, 23, hour, 0).getTime();
    const skyAt = (hour: number): string | undefined =>
      sceneFor({
        registry: after({ sessionId: 's', kind: 'SessionStart' }),
        pack,
        now: at(hour),
      }).environment?.time;

    expect(skyAt(6)).toBe('dawn');
    expect(skyAt(12)).toBe('day');
    expect(skyAt(18)).toBe('dusk');
    expect(skyAt(23)).toBe('night');
    expect(skyAt(3)).toBe('night');
    // Both edges of every band, which is where an off-by-one lives. Opening
    // edges alone are not enough: a review changed `hour < 8` to `hour < 7`
    // and every assertion here still passed, with 07:00 falling through to a
    // star field in broad daylight.
    expect(skyAt(5)).toBe('dawn');
    expect(skyAt(7)).toBe('dawn');
    expect(skyAt(8)).toBe('day');
    expect(skyAt(16)).toBe('day');
    expect(skyAt(17)).toBe('dusk');
    expect(skyAt(19)).toBe('dusk');
    expect(skyAt(20)).toBe('night');
    expect(skyAt(4)).toBe('night');
  });

  it('gives a session that needs a human the attention tone', () => {
    const scene = sceneFor({
      registry: after({ sessionId: 's', kind: 'PermissionRequest' }),
      pack,
      now: NOW,
    });
    expect(scene.sessions).toEqual([{ tone: 'attention', origin: 'local' }]);
  });

  it('shows one chip per live session, hero first', () => {
    const scene = sceneFor({
      registry: after(
        { sessionId: 'quiet', kind: 'Stop' },
        { sessionId: 'loud', kind: 'PermissionRequest' },
      ),
      pack,
      now: NOW,
    });
    expect(scene.sessions).toHaveLength(2);
    expect(scene.sessions[0]?.tone).toBe('attention');
  });

  it('puts a padded 24-hour clock on the status band', () => {
    const scene = sceneFor({ registry: createRegistry(NOW), pack, now: NOW });
    expect(scene.status.left).toMatch(/^\d{2}:\d{2}$/);
  });

  it('counts subagents, and says nothing when there are none', () => {
    expect(
      sceneFor({ registry: createRegistry(NOW), pack, now: NOW }).status.right,
    ).toBe('');
    const busy = sceneFor({
      // `agentType` is load-bearing, not decoration: an event without one is
      // machinery rather than a dispatch and does not move the count, so
      // omitting it here asserted `+1` against a band that would render ''.
      registry: after({
        sessionId: 's',
        kind: 'SubagentStart',
        agentType: 'Explore',
      }),
      pack,
      now: NOW,
    });
    expect(busy.status.right).toBe('+1');
  });
});

describe('Clawd on the stage', () => {
  const pack = parsePackManifest(examplePack());

  it('paints a sprite into the stage band', async () => {
    // Until the sprite pipeline landed the stage was empty on purpose, and the
    // panel showed a clock and some chips against 52% blank glass. This is the
    // test that Clawd actually arrives.
    const frames = await loadSprite('typing');
    const first = frames[0];
    expect(first).toBeDefined();

    const base = { registry: createRegistry(NOW), pack, now: NOW };
    const empty = render(sceneFor(base));
    const withClawd = render(
      sceneFor({ ...base, sprites: first ? [first] : [] }),
    );

    const changed = empty.pixels.reduce<number>(
      (total, pixel, at) => total + (pixel === withClawd.pixels[at] ? 0 : 1),
      0,
    );
    // A real character, not a stray pixel and not the whole panel.
    expect(changed).toBeGreaterThan(1_000);
    expect(changed).toBeLessThan(empty.pixels.length);
  });

  it('advances through the loop as the clock moves', async () => {
    const frames = await loadSprite('typing');
    const scene = (at: number) =>
      render(
        sceneFor({
          registry: createRegistry(NOW),
          pack,
          now: NOW,
          sprites: frames
            .slice(Math.floor(at / 125) % frames.length)
            .slice(0, 1),
        }),
      ).pixels;
    // 125ms is one frame at the 8fps `svg2frames.ts` rasterises at.
    expect(scene(0)).not.toEqual(scene(125));
  });

  it('actually supplies frames to the paint loop', async () => {
    // A review deleted `framesFor`'s body so it always returned `[]` — no Clawd
    // on the panel at all — and the whole 389-test suite stayed green. The two
    // tests above load a sprite themselves and hand it to `sceneFor`, which
    // proves the renderer can draw one, not that the daemon ever supplies one.
    const frames = await framesFor('gym');
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]?.frame.width).toBe(168);
  });

  it('moves the frame index on as the clock advances', async () => {
    // The other half. A review made `frameAt` return a constant — Clawd frozen
    // on frame 0 for ever — and the suite stayed green, because the test that
    // looked like it covered this re-implemented the formula instead of calling
    // it. This calls it.
    const frames = await framesFor('gym');
    const at = (ms: number) => frameAt(frames.length, ms);
    expect(at(0)).toBe(0);
    expect(at(125)).toBe(1);
    // And it wraps rather than running off the end.
    expect(at(125 * frames.length)).toBe(0);
    expect(new Set([at(0), at(125), at(250), at(375)]).size).toBe(4);
  });
});
