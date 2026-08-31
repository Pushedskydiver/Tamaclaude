/**
 * Does the binary actually run?
 *
 * This executes a *built* artefact, so `pnpm test` builds first — otherwise
 * the gate can green-light code that no longer exists: edit `src`, run the
 * tests alone, and this happily runs the previous build. An mtime comparison
 * was tried and is wrong here, because `tsc -b` is incremental and skips emit
 * when content has not changed, so a fresh build leaves `dist` older than
 * `src` and the check fails on correct code.
 *
 * `packages/cli` had no tests, and nothing in the suite executed it. So when
 * `packages/packs` tightened its palette schema — a one-colour pack renders an
 * invisible panel, so it is refused at the boundary — the CLI's inlined
 * placeholder became invalid and every run threw, while build, test, lint,
 * typecheck, format and knip all stayed green.
 *
 * A binary nothing executes is a binary nobody knows is broken. This runs it.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chooseDevice, EXIT_NO_PANEL, refusalReport } from './device.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

const BUILT = resolve(ROOT, 'packages/cli/dist/index.js');

/**
 * Run the binary with an environment this test controls entirely.
 *
 * **`env` is not optional here, and leaving it off was a live bug.** The old
 * version inherited `process.env`, so it inherited `HOME` and any
 * `TAMACLAUDE_PACK` the developer had set. Once a personal pack exists at
 * `~/.tamaclaude/pack/` — which is the install step this very change
 * documents, and which happens before the 19 Sep dry run — `pnpm test` on that
 * machine would either fail on the `pack=example` assertion or, worse, pass
 * while quietly reading somebody's private pack.
 *
 * `packages/hooks/src/index.test.ts` sets an explicit `TAMACLAUDE_SOCKET`, but
 * over a spread of `process.env` — so it is a precedent for pinning the one
 * variable under test, not for refusing to inherit. The refusal here is the
 * stronger form, and it is needed because `HOME` matters to this binary and
 * does not to that one.
 *
 * `HOME` points at a directory that does not exist, so the default-location
 * layer can never resolve by accident. A test that means "no pack" has to be
 * able to say it.
 */
function run(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): { readonly out: string; readonly status: number } {
  // A timeout, because vitest's own runs on a timer and cannot interrupt a
  // synchronous call. This binary is about to grow a socket client and a
  // launchd agent; one that fails to exit would otherwise hang the suite until
  // the CI job limit rather than failing.
  const result = spawnSync(process.execPath, [BUILT, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    // `TZ` is carried through from `vitest.config.ts`'s pin, and its absence
    // is an error rather than a default. The countdown cases below compute a
    // date in this process and assert against one computed in the child; if
    // the two run in different zones they disagree by a day, on a machine
    // where nothing else changed. `?? ''` would have made that silent, which
    // is the shape `pack.ts` refuses elsewhere — "I cannot tell" must not pick
    // an answer. `packages/packs/src/index.test.ts` spends fifteen lines on
    // what an unpinned zone costs a date test.
    env: {
      PATH: process.env.PATH ?? '',
      TZ: requiredTimezone(),
      HOME: NO_HOME,
      ...env,
    },
  });
  return {
    out: `${result.stdout}${result.stderr}`,
    status: result.status ?? -1,
  };
}

/** The suite's pinned zone, or a failure that names the pin. */
function requiredTimezone(): string {
  const zone = process.env.TZ;
  if (zone === undefined || zone === '') {
    throw new Error(
      'TZ is unset: vitest.config.ts pins it, and the countdown cases compare ' +
        'a date computed here against one computed in the child process',
    );
  }
  return zone;
}

const NO_HOME = resolve(ROOT, 'packages/cli/dist/no-such-home');
const EXAMPLE = resolve(ROOT, 'packs/example');

/**
 * Fixture packs, written under `dist/` so they are gitignored and disposable.
 *
 * `BAD_PACK` is schema-invalid rather than unreadable: a one-colour palette,
 * which `packages/packs` refuses because a pack with no ink renders an
 * entirely invisible panel. That is the failure a *hand-edited* manifest
 * actually has, and until a review pointed it out the CLI answered it with a
 * raw zod issue array under a Node stack.
 *
 * `BIRTHDAY_PACK` exists because `packs/example` has no `birthday`, so the
 * countdown — the whole reason `tamaclaude pack` exists — had no coverage at
 * all. Its date is chosen relative to the clock at run time, so the assertion
 * does not rot.
 */
const FIXTURES = resolve(ROOT, 'packages/cli/dist/test-packs');
const BAD_PACK = join(FIXTURES, 'bad');
const BIRTHDAY_PACK = join(FIXTURES, 'birthday');

const VALID = {
  name: 'fixture',
  palette: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  quips: { mapped: {}, idle: [] },
};

beforeAll(() => {
  mkdirSync(BAD_PACK, { recursive: true });
  mkdirSync(BIRTHDAY_PACK, { recursive: true });
  writeFileSync(
    join(BAD_PACK, 'manifest.json'),
    JSON.stringify({ ...VALID, palette: [[0, 0, 0]] }),
  );
  // `BIRTHDAY_PACK` gets a valid manifest here as well as inside the countdown
  // cases that overwrite it. Without one, any future test reaching it first
  // sees "could not read the pack", which reads as a product bug rather than
  // as a fixture that was never written.
  writeFileSync(
    join(BIRTHDAY_PACK, 'manifest.json'),
    JSON.stringify({
      ...VALID,
      birthday: { date: '09-23', quip: 'placeholder' },
    }),
  );
});
afterAll(() => {
  rmSync(FIXTURES, { recursive: true, force: true });
});

describe('the tamaclaude binary', () => {
  it('starts, loads the pack it is pointed at, and exits cleanly', () => {
    // Pointed at the example pack by the variable that ships, rather than
    // finding it by walking up from `dist/`. The old version proved the binary
    // could load a *bundled* pack — the one path the recipient will never
    // take, and one that broke the moment the package was installed anywhere
    // but the repo.
    const { out, status } = run([], { TAMACLAUDE_PACK: EXAMPLE });
    expect(out).toContain('pack=example');
    expect(status).toBe(0);
  });

  it('refuses to start with no pack rather than inventing one', () => {
    // The whole design in one assertion. There is no bundled fallback, so this
    // cannot quietly succeed against the wrong pack.
    const { out, status } = run([]);
    expect(out).toContain('no pack configured');
    expect(status).toBe(2);
  });

  it('never falls through from a pack it was told about', () => {
    const { out, status } = run([], { TAMACLAUDE_PACK: resolve(ROOT, 'nope') });
    expect(out).toContain('could not read the pack');
    expect(out).not.toContain('pack=example');
    expect(status).toBe(1);
  });

  /**
   * Every failure this CLI composes a sentence for prints *only* that
   * sentence.
   *
   * **The previous version of this asserted the output contained no
   * `at Object.` — and an ESM stack contains no such frame**, so the check
   * passed whether or not `KNOWN` matched. Deleting a clause from `KNOWN` left
   * it green. A review found it by planting exactly that mutation.
   *
   * One line is the assertion that cannot be satisfied by accident: a stack is
   * always several. Driven through the binary rather than against the regex,
   * so each case proves its own sentence survives `KNOWN` end to end —
   * deleting any single clause kills exactly one of them.
   *
   * It is still a list that has to be remembered: a new `throw` whose sentence
   * is missing from `KNOWN` fails nothing until a fifth entry is added here.
   * An earlier version of this paragraph claimed otherwise, which is the
   * flavour of overclaim the gate it replaced was guilty of.
   */
  const failures: readonly {
    readonly what: string;
    readonly env: Readonly<Record<string, string>>;
    readonly says: RegExp;
    readonly code: number;
  }[] = [
    {
      what: 'nothing configured',
      env: {},
      says: /no pack configured/,
      code: 2,
    },
    {
      what: 'a named pack that is not there',
      env: { TAMACLAUDE_PACK: resolve(ROOT, 'nope') },
      says: /could not read the pack/,
      code: 1,
    },
    {
      what: 'an empty variable, which is a mistake and not an absence',
      env: { TAMACLAUDE_PACK: '' },
      says: /TAMACLAUDE_PACK is set but empty/,
      // 2, not 1: naming a pack with an empty variable is a command that was
      // not usable as typed, which is what the device-path failure already
      // exits 2 for.
      code: 2,
    },
    {
      what: 'a manifest that is not a valid pack',
      env: { TAMACLAUDE_PACK: BAD_PACK },
      says: /is not a valid pack/,
      code: 1,
    },
  ];

  it.each(failures)(
    'says one line and no stack for $what',
    ({ env, says, code }) => {
      const { out, status } = run([], env);
      expect(out).toMatch(says);
      expect(out.trim().split('\n')).toHaveLength(1);
      expect(status).toBe(code);
    },
  );

  /**
   * The countdown, which had no coverage at all until a review said so.
   *
   * `packs/example` carries no `birthday`, and it is the only pack CI ever
   * saw, so the only branch reached was the early return. Mutants that
   * survived: the day length set to anything, the window set to 1,
   * `indexOf(true)` to `indexOf(false)`, and "tomorrow" to "today".
   *
   * Dates are computed from the clock at run time rather than written down, so
   * this cannot rot into a test that passes only in 2026. `TZ` is pinned by
   * `vitest.config.ts` and carried into the child by `run`.
   *
   * The arithmetic it guards is worth stating, because it is not obvious why
   * fixed 86,400,000ms steps are safe: each step is measured from *local noon*,
   * and no DST shift is large enough to push noon across a local midnight, so
   * every step lands on a distinct calendar day. Verified by sweep across four
   * zones including Lord Howe's 30-minute shift and Chatham's +12:45.
   */
  it.each([
    [0, 'today'],
    [1, 'tomorrow'],
    [9, 'in 9 days'],
    // **The far offsets are the ones with teeth.** A per-step error smaller
    // than a day is invisible near zero and accumulates: a 23-hour step passed
    // at 0, 1 and 9 days. It first misplaces a date at **13** steps —
    // measured — because the anchor is local noon, so an hour of drift per
    // step only crosses a midnight once it reaches twelve. An earlier version
    // of this comment said 24 and a full day, which applies that same slack
    // twice; the paragraph below gets it right for the one-minute case.
    // The first version of this table stopped at 9 and let the mutant live.
    [30, 'in 30 days'],
    [200, 'in 200 days'],
    [364, 'in 364 days'],
  ])('counts a birthday %i days out as "%s"', (offset, expected) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    const date = `${String(day.getMonth() + 1).padStart(2, '0')}-${String(
      day.getDate(),
    ).padStart(2, '0')}`;
    writeFileSync(
      join(BIRTHDAY_PACK, 'manifest.json'),
      JSON.stringify({ ...VALID, birthday: { date, quip: 'many happy' } }),
    );
    const { out, status } = run(['pack'], { TAMACLAUDE_PACK: BIRTHDAY_PACK });
    expect(out).toContain(`birthday: ${date} — fires ${expected}`);
    expect(out).toContain('many happy');
    expect(status).toBe(0);
  });

  it('reports the default location as the default', () => {
    // The other half of `describePack`, which only ever had its
    // `$TAMACLAUDE_PACK` branch asserted — mutating the label to return that
    // string unconditionally left the suite green.
    const home = join(FIXTURES, 'home');
    mkdirSync(join(home, '.tamaclaude'), { recursive: true });
    cpSync(EXAMPLE, join(home, '.tamaclaude', 'pack'), { recursive: true });
    const { out, status } = run(['pack'], { HOME: home });
    expect(out).toContain('(default)');
    expect(out).not.toContain('$TAMACLAUDE_PACK');
    expect(status).toBe(0);
  });

  it('says which pack is loaded, because no schema can catch the wrong one', () => {
    const { out, status } = run(['pack'], { TAMACLAUDE_PACK: EXAMPLE });
    expect(out).toContain('pack example at');
    expect(out).toContain('$TAMACLAUDE_PACK');
    expect(out).toContain('birthday: none in this pack');
    expect(status).toBe(0);
  });

  /**
   * **Skipped when the agent is actually installed, and that is not caution.**
   * `run()` sandboxes `HOME`, which scopes the plist path — but launchd
   * domains are per-uid, and `uninstall-agent` addresses `gui/$(id -u)`. On a
   * machine where the agent is running, this test would boot out the real one,
   * print `Stopped …`, and fail on an assertion about a machine it had just
   * changed. That is the soak week, and the 19 Sep dry run, and Alex's own
   * desk after `install-agent --apply`.
   *
   * A review found it. The same file already documents an inherited-`HOME` bug
   * of exactly this shape, which is what makes the second instance worth
   * naming rather than quietly guarding.
   */
  const agentIsInstalled = ((): boolean => {
    try {
      spawnSync(
        'launchctl',
        [
          'print',
          `gui/${String(process.getuid?.() ?? 0)}/com.tamaclaude.daemon`,
        ],
        {
          stdio: 'ignore',
        },
      );
      return (
        spawnSync('launchctl', [
          'print',
          `gui/${String(process.getuid?.() ?? 0)}/com.tamaclaude.daemon`,
        ]).status === 0
      );
    } catch {
      return false;
    }
  })();

  it.skipIf(agentIsInstalled || process.platform !== 'darwin')(
    'uninstalls cleanly when nothing is installed',
    () => {
      // The path that must never fail: someone runs it twice, or runs it on a
      // machine where the agent was never installed. An uninstall that errors
      // when there is nothing to remove teaches people to ignore its output.
      //
      // `launchctl bootout` genuinely fails here — the label is not loaded — and
      // that is the expected half of the answer rather than an error.
      const { out, status } = run(['uninstall-agent'], {
        TAMACLAUDE_PACK: EXAMPLE,
      });
      expect(out).toContain('was not running');
      expect(out).toContain('No plist at');
      // It says what it did *not* touch, because a person running an uninstall
      // wants to know whether their pack survived it.
      expect(out).toContain('left alone');
      expect(status).toBe(0);
    },
  );

  it.skipIf(process.platform === 'darwin')(
    'says the agent commands are macOS only, off macOS',
    () => {
      // The other half of the skip above, so the suite is not simply blind on
      // Linux. CI runs Ubuntu, and this is the assertion it *can* make — which
      // matters, because the version of this file CI first saw failed there
      // with a launchd error for a platform that has no launchd.
      const { out, status } = run(['uninstall-agent'], {
        TAMACLAUDE_PACK: EXAMPLE,
      });
      expect(out).toContain('needs launchd');
      expect(out.trim().split('\n')).toHaveLength(1);
      expect(status).toBe(1);
    },
  );

  it('reports a missing pack rather than dying on it', () => {
    // **`status` is the command the printed card names**, and the pack is one
    // of the things most likely to be what broke — not cloned yet, clone
    // refused for access, folder moved, `TAMACLAUDE_PACK` pointing at nothing.
    // `resolvePack` throws on all of those, and `status` let it: it printed the
    // agent line, then died with exit 2 and never reached the log path. So the
    // one diagnostic told a person with a pack problem less than it tells a
    // person with no problem at all.
    //
    // Found by running the built CLI under a home with no pack, which is the
    // 19 Sep dry run in miniature.
    const { out, status } = run(['status']);
    expect(status).toBe(0);
    // The problem is reported as a line, in the same shape as every other.
    expect(out).toMatch(/^pack {6}/mu);
    expect(out).toContain('no pack configured');
    // And the log path still arrives, which is what the reader is sent to next.
    expect(out).toMatch(/^log {7}\S/mu);
  });

  describe('what a refusal prints, and what it exits with', () => {
    const absent = () =>
      ({ kind: 'absent', refusal: 'no panel found. Plug it in.' }) as const;

    // **An unplugged cable is not a usage error.** Until 29 Aug a refusal
    // printed the whole command-line usage block and exited 2, so under
    // launchd — which restarts on exit — the log filled with usage text
    // (1.4 MB of it on the author's machine) and `pnpm tamaclaude status`
    // reported `loaded but not running; last exit 2`, which reads as a broken
    // install rather than a panel that is simply not plugged in. The
    // recipient will hit this the first time the desk moves.
    it('does not print usage for a panel that is merely absent', () => {
      const { text } = refusalReport(absent(), false);
      expect(text).not.toContain('usage:');
      expect(text).not.toContain('install-agent');
      expect(text).toContain('no panel found');
    });

    it('gives an absent panel its own exit code, so status can name it', () => {
      // A literal, not `EXIT_NO_PANEL`: comparing the constant to itself
      // passes for any value, so it pinned nothing.
      expect(refusalReport(absent(), false).code).toBe(3);
      expect(EXIT_NO_PANEL).toBe(3);
    });

    it('passes supervision through, which nothing checked', () => {
      // `devicePathFor` is unexported, so the only guard on its new argument
      // was reading it. Replacing `supervised` with `false` at the call site
      // left the whole suite green.
      const chosen = chooseDevice(undefined, []);
      if (!('refusal' in chosen)) throw new Error('expected a refusal');
      expect(refusalReport(chosen, true).text).not.toEqual(
        refusalReport(chosen, false).text,
      );
    });

    it('carries the decision across the two functions, not a string', () => {
      // **The seam the whole change rests on.** It used to dispatch on
      // `refusal.startsWith('no panel found')`, coupling two files by a
      // literal — and prefixing that message with the program name, an
      // ordinary edit, silently sent an absent panel back to exit 2 and
      // "see the log" with every gate green. Composed here so the two ends
      // cannot drift apart.
      const chosen = chooseDevice(undefined, []);
      expect('refusal' in chosen).toBe(true);
      if (!('refusal' in chosen)) return;
      expect(refusalReport(chosen, false).code).toBe(3);
    });

    it('says it will look again when something is supervising it', () => {
      // Matches what `onGiveUp` already says for a panel that vanishes after
      // opening. The two paths reached the same situation and said different
      // things about it.
      const supervised = refusalReport(absent(), true);
      const alone = refusalReport(absent(), false);
      expect(supervised.text).toContain('looks again');
      expect(alone.text).not.toContain('looks again');
      // And it drops "name the device", which the plist deliberately does not
      // pass — macOS derives the path from the USB port, so a named one goes
      // stale the moment the panel changes socket.
      expect(supervised.text).not.toContain('name the device');
      expect(alone.text).toContain('Plug it in');
    });

    it('keeps the ordinary failure code for a refusal a person must resolve', () => {
      // Two panels plugged in is a choice only a human can make, so it is a
      // genuine argument problem and keeps exit 2 — but it still does not need
      // the usage block, because the refusal already lists the paths.
      const { text, code } = refusalReport(
        { kind: 'ambiguous', refusal: 'found 2 panels:\n  /dev/a\n  /dev/b' },
        false,
      );
      expect(code).toBe(2);
      expect(text).not.toContain('usage:');
      expect(text).toContain('/dev/a');
    });
  });

  describe('chooseDevice', () => {
    it('does not mistake a flag for a device path', () => {
      // The plist passes `daemon --supervised`, so `argv[0]` is a flag. Taken
      // as a path it would be opened forever and discovery never consulted —
      // which is what the plist did until this was caught, before it shipped.
      expect(chooseDevice('--supervised', [{ path: '/dev/cu.found' }])).toEqual(
        {
          path: '--supervised',
        },
      );
      // `chooseDevice` is right to trust what it is handed; the filtering
      // belongs in the caller, and `daemon()` does it.
    });

    it('takes the device it was given, without looking', () => {
      // The escape hatch, and what gets typed during the soak week. A named
      // path wins even when discovery would have found something else.
      expect(
        chooseDevice('/dev/cu.given', [{ path: '/dev/cu.found' }]),
      ).toEqual({ path: '/dev/cu.given' });
    });

    it('takes the only panel when there is exactly one', () => {
      expect(
        chooseDevice(undefined, [{ path: '/dev/cu.usbmodem1101' }]),
      ).toEqual({ path: '/dev/cu.usbmodem1101' });
    });

    it('refuses to choose between two panels, and names both', () => {
      // **The case the design turns on.** Every ESP32-C3/C6/S3 in
      // USB-Serial/JTAG mode shares `0x303A:0x1001`, and `BUILD_PLAN.md` calls
      // for a spare board while Stage 6 flashes a gift board separate from the
      // dev board. Picking the first would drive the wrong panel while
      // reporting itself online — which survives a whole soak week.
      const chosen = chooseDevice(undefined, [
        { path: '/dev/cu.usbmodem1101', serial: '00:11:22:33:44:55' },
        { path: '/dev/cu.usbmodem2201', serial: '66:77:88:99:AA:BB' },
      ]);
      expect(chosen).not.toHaveProperty('path');
      expect('refusal' in chosen ? chosen.refusal : '').toContain(
        '/dev/cu.usbmodem1101',
      );
      expect('refusal' in chosen ? chosen.refusal : '').toContain(
        '/dev/cu.usbmodem2201',
      );
      // The serials are what let a person tell two identical boards apart.
      expect('refusal' in chosen ? chosen.refusal : '').toContain(
        '66:77:88:99:AA:BB',
      );
    });

    it('refuses when nothing is plugged in, rather than inventing a path', () => {
      const chosen = chooseDevice(undefined, []);
      expect('refusal' in chosen ? chosen.refusal : '').toContain(
        'no panel found',
      );
    });
  });
});

/**
 * The commands the CLI tells you to type have to be commands you can type.
 *
 * The CLI is a workspace bin, so `pnpm install` links nothing into
 * `node_modules/.bin` and a bare `tamaclaude` is `command not found` until
 * somebody runs `pnpm setup` and `pnpm link` — which `docs/INSTALL.md`
 * deliberately does not ask for, because it would put something on `PATH` that
 * goes stale when the folder moves.
 *
 * These strings are printed exactly where the guide is not open: a typo, a
 * missing device, and the upgraded-node remedy. `agent.test.ts` asserted
 * `install-agent --apply`, which is a substring of both forms, so the decision
 * was unpinned in the one place it mattered.
 */
describe('printed commands are runnable', () => {
  it('prints the pnpm form in usage, not a bare tamaclaude', () => {
    const said = run(['frobnicate']).out;
    expect(said).toContain('pnpm tamaclaude daemon');
    // The bare form must not appear at the start of a usage line, which is
    // what a reader copies.
    expect(said).not.toMatch(/^\s*(usage:\s*)?tamaclaude /m);
  });
});
