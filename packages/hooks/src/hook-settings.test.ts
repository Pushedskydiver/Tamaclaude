/**
 * The planner, against the awkward `settings.json` files nobody has.
 *
 * These are the cases that decide whether this is safe to point at a real one:
 * a file with somebody else's hooks in it, a file we have already patched, a
 * file we patched from a path that no longer exists, a file with something in
 * it we do not understand.
 */
import { describe, expect, it } from 'vitest';

import { HANDLED_HOOK_EVENTS } from '@tamaclaude/protocol';

import { hookCommand, planHookInstall } from './hook-settings.js';

const COMMAND =
  "'/bin/node' '/repo/packages/hooks/dist/index.js' 2>/dev/null || true";

function hasMatcher(group: unknown): boolean {
  return Object.hasOwn(group as object, 'matcher');
}

/** The matcher groups a plan produces for one event. */
function groupsFor(settings: unknown, event: string): readonly unknown[] {
  const hooks = (settings as { hooks: Record<string, unknown> }).hooks;
  return hooks[event] as readonly unknown[];
}

describe('planHookInstall', () => {
  it('registers exactly the events protocol says are handled', () => {
    // Not a literal list. `HANDLED_HOOK_EVENTS` lives in `protocol` because
    // `hooks` and `daemon` cannot import each other, and the two disagreed
    // twice — a state nothing could reach, and an event registered for a
    // purpose the daemon did the opposite of. A hard-coded list here is
    // exactly what failed to catch either.
    const plan = planHookInstall({}, COMMAND);
    const registered = Object.keys(
      (plan.settings as { hooks: Record<string, unknown> }).hooks,
    );
    expect(new Set(registered)).toEqual(new Set(HANDLED_HOOK_EVENTS));
  });

  it('writes the three levels of nesting the docs describe', () => {
    const plan = planHookInstall({}, COMMAND);

    expect(groupsFor(plan.settings, 'PreToolUse')).toEqual([
      {
        matcher: '*',
        hooks: [{ type: 'command', command: COMMAND, timeout: 5 }],
      },
    ]);
  });

  it('omits the matcher on events that do not take one', () => {
    // `UserPromptSubmit` and `Stop` have no matcher support at all. An omitted
    // matcher means "everything", so there is nothing to express.
    const plan = planHookInstall({}, COMMAND);

    const withoutMatchers = ['UserPromptSubmit', 'Stop'].map(
      (event) => groupsFor(plan.settings, event)[0],
    );

    expect(withoutMatchers.every((group) => !hasMatcher(group))).toBe(true);
  });

  it('leaves every other setting exactly as it found it', () => {
    const plan = planHookInstall(
      { model: 'opus', env: { SECRET: 'hunter2' }, permissions: { allow: [] } },
      COMMAND,
    );

    expect(plan.settings).toMatchObject({
      model: 'opus',
      env: { SECRET: 'hunter2' },
      permissions: { allow: [] },
    });
  });

  it("keeps another tool's hook on an event we also want", () => {
    const theirs = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/audit-bash' }],
    };
    const plan = planHookInstall({ hooks: { PreToolUse: [theirs] } }, COMMAND);

    expect(groupsFor(plan.settings, 'PreToolUse')[0]).toEqual(theirs);
    expect(groupsFor(plan.settings, 'PreToolUse')).toHaveLength(2);
  });

  it('changes nothing the second time', () => {
    const once = planHookInstall({}, COMMAND);
    const twice = planHookInstall(once.settings, COMMAND);

    expect(twice.changes).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
  });

  it('repoints a stale path instead of registering a second handler', () => {
    // The failure this prevents: the repo moves, the installer runs again, and
    // every hook event now starts two processes for ever.
    const stale = "'/bin/node' '/old/packages/hooks/dist/index.js'";
    const before = planHookInstall({}, stale);
    const after = planHookInstall(before.settings, COMMAND);

    expect(groupsFor(after.settings, 'Stop')).toHaveLength(1);
    expect(JSON.stringify(after.settings)).not.toContain('/old/');
    expect(after.changes[0]).toContain('repointed');
  });

  it('leaves an entry it does not understand alone, and says so', () => {
    const plan = planHookInstall({ hooks: { Stop: 'run-something' } }, COMMAND);

    expect(groupsFor(plan.settings, 'Stop')).toBe('run-something' as never);
    expect(plan.changes).toContain(
      '! Stop — left alone, its existing entry is not a list',
    );
  });

  it('survives a settings file that is not an object at all', () => {
    expect(() => planHookInstall('nonsense', COMMAND)).not.toThrow();
    expect(() => planHookInstall(null, COMMAND)).not.toThrow();
  });
});

describe('hookCommand', () => {
  it('quotes both paths, so a home directory may contain spaces', () => {
    expect(hookCommand('/usr/bin/node', '/Users/a b/dist/index.js')).toBe(
      "'/usr/bin/node' '/Users/a b/dist/index.js' 2>/dev/null || true",
    );
  });

  it('refuses a path containing a quote rather than escaping it', () => {
    expect(() =>
      hookCommand('/usr/bin/node', "/Users/o'brien/index.js"),
    ).toThrow(/refusing/);
  });
});
