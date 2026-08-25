import { describe, expect, it } from 'vitest';

import { SPRITE_NAMES } from '@tamaclaude/renderer';

import { animationFor, ANIMATIONS, FALLBACK } from './animation.js';
import { SESSION_STATES, stateRank } from './state.js';

describe('the payoff for a spent session', () => {
  it('shows overheated for a rate limit and dizzy for anything else', () => {
    // The error has been stored since Stage 3 and was read by nothing. This is
    // the first thing to read it: `rate_limit` and `overloaded` both mean "wait
    // and come back", which is what the picture says, and the other eight
    // documented values keep `dizzy`.
    expect(animationFor('FAILED', { errorType: 'rate_limit' })).toBe(
      'overheated',
    );
    expect(animationFor('FAILED', { errorType: 'overloaded' })).toBe(
      'overheated',
    );
    expect(animationFor('FAILED', { errorType: 'authentication_failed' })).toBe(
      'dizzy',
    );
    expect(animationFor('FAILED')).toBe('dizzy');
  });
});

describe('animationFor', () => {
  it('maps the three editing tools to typing', () => {
    const tools = ['Edit', 'Write', 'NotebookEdit'];
    expect(
      tools.map((tool) => animationFor('WORKING', { tool: tool })),
    ).toEqual(['typing', 'typing', 'typing']);
  });

  it('maps Bash to gym and Read to bouldering', () => {
    expect(animationFor('WORKING', { tool: 'Bash' })).toBe('gym');
    expect(animationFor('WORKING', { tool: 'Read' })).toBe('bouldering');
  });

  it('maps Agent to board game, for as long as it lasts', () => {
    // The screen is two seconds because it does not get longer: a subagent's
    // own tool calls arrive on the *parent's* session — sidechains do not get
    // their own id — and measured over 167 runs the first one lands at a
    // median of 3.2s. So this mapping paints `board-game`, and then `Bash` or
    // `Read` from inside the subagent repaints over it almost immediately.
    // That is the design, not a defect: the screen says *handed off* and the
    // tool screens go back to saying what is being done.
    expect(animationFor('WORKING', { tool: 'Agent' })).toBe('board-game');
  });

  it('maps both web tools to wizard', () => {
    // Spelled out rather than trusted, because a `Map` key is a raw string:
    // `'Websearch'`, a trailing space or an `mcp__` prefix all typecheck, and
    // an unmapped tool falls back to `thinking` — so a mistyped key here is a
    // green suite and a panel quietly showing the wrong screen for 5.5% of
    // tool calls. The fallback test below is what makes that silent.
    expect(animationFor('WORKING', { tool: 'WebSearch' })).toBe('wizard');
    expect(animationFor('WORKING', { tool: 'WebFetch' })).toBe('wizard');
  });

  it('falls an unknown tool back to thinking rather than throwing', () => {
    // MCP servers invent tool names and Claude Code releases add them, so an
    // unrecognised tool is the ordinary case. It must not be an error, and it
    // must not read as `idle` — that would claim nothing is happening while a
    // tool runs, which is the one direction the panel must never be wrong in.
    expect(animationFor('WORKING', { tool: 'mcp__linear__create_issue' })).toBe(
      'thinking',
    );
    expect(animationFor('WORKING', { tool: 'Grep' })).toBe('thinking');
    expect(animationFor('WORKING', { tool: '__proto__' })).toBe('thinking');
    expect(animationFor('WORKING', { tool: 'constructor' })).toBe('thinking');
  });

  it('falls back when WORKING carries no tool at all', () => {
    expect(animationFor('WORKING')).toBe('thinking');
  });

  it('shows idle and asleep for the resting states', () => {
    expect(animationFor('IDLE')).toBe('idle');
    expect(animationFor('ASLEEP')).toBe('asleep');
  });

  it('ignores the tool for any state that is not WORKING', () => {
    expect(animationFor('IDLE', { tool: 'Bash' })).toBe('idle');
  });

  it('gives the two answered attention states their own art', () => {
    // Both were on the fallback until the art existed, which meant the panel
    // showed "thinking" while Clawd was actually blocked on a human. They are
    // deliberately different pictures from each other as well: both are
    // attention states, both can be the hero, and a glance must not read them
    // as one screen.
    expect(animationFor('NEEDS_PERMISSION')).toBe('permission-sign');
    expect(animationFor('WAITING')).toBe('confused');
    expect(animationFor('NEEDS_PERMISSION')).not.toBe(animationFor('WAITING'));
  });

  it('gives FAILED its own art, so no state is on the fallback', () => {
    // The last of the three. `FALLBACK` is now reached only from `WORKING` —
    // with an unmapped tool, or with no tool at all. Both paths are covered by
    // "falls an unknown tool back to thinking rather than throwing" and "falls
    // back when WORKING carries no tool at all" above. That is the case it was
    // written for: a panel that says "busy, unspecified" rather than claiming
    // nothing is happening.
    expect(animationFor('FAILED')).toBe('dizzy');
    // Against `FALLBACK` rather than the literal `'thinking'`. The two are the
    // same string today, and hard-coding it would mean retargeting the
    // fallback left this passing while its own name stopped being true.
    const fallenBack = SESSION_STATES.filter(
      (state) => state !== 'WORKING' && animationFor(state) === FALLBACK,
    );
    expect(fallenBack).toEqual(['THINKING']);
  });

  it('names only animations that have been baked', () => {
    // Against `SPRITE_NAMES` — the baked list — and not against `ANIMATIONS`.
    // The previous version filtered `animationFor`'s output by `ANIMATIONS`,
    // which is the tuple `AnimationName` is derived from, so it compared a
    // value against the set that defines its own type and could not fail.
    // Planting `'road-bike'` in `ANIMATIONS` and mapping `Glob` to it — an
    // animation with no SVG and no bake, reachable from a real tool name — is
    // what this line exists to catch, and it does: the filter goes red the
    // moment an unbaked name enters `ANIMATIONS`. Before this assertion
    // existed that same mutant left all 413 tests green and only `tsc` caught
    // it, in `packages/cli`.
    //
    // **Naming the mutant is maintenance, and it has now been renamed twice —
    // both times because the name shipped.** `'wizard'`/`WebSearch` went real
    // on 24 Aug; `'sweeping'`/`Glob` went real on 25 Aug, when the art entered
    // `SPRITE_NAMES` and quietly made the documented mutant buildable. A
    // documented mutant has to stay unbuildable, so `road-bike` holds only
    // until it is built — `assets/clawd/animations/PLANS.md` has it as Tier C,
    // "cut without regret", which is what makes it a safe name to borrow.
    //
    // Re-planted rather than assumed, both ways: `'sweeping'` leaves all 17
    // green, `'road-bike'` gives `expected [ 'road-bike' ] to deeply equal []`.
    //
    // **Plant it with root `npx vitest run`.** Two ways of running it report
    // success while proving nothing. `pnpm --filter @tamaclaude/daemon test`
    // exits 0 having run no tests at all — this package declares no `test`
    // script and pnpm exits 0 on a missing one. And root `pnpm test` is
    // `tsc -b && vitest run`, so an unbaked name fails the build in
    // `packages/cli` before a single test runs; that is the pre-assertion
    // behaviour reproducing, not this gate firing.
    //
    // `ANIMATIONS` is still the daemon's own list and stays the type; this
    // asserts the join to the renderer, which is the edge that can actually
    // drift. `packages/daemon` already depends on `@tamaclaude/renderer`, and
    // `SPRITE_NAMES` is a name list rather than the sprite data, so this costs
    // no bake parsing.
    //
    // Widened to `string` on purpose. Left as its own literal union, an
    // unbaked name makes this line a compile error instead of a red test, and
    // a test that cannot go red is the thing being fixed here.
    const baked: readonly string[] = SPRITE_NAMES;
    expect(ANIMATIONS.filter((name) => !baked.includes(name))).toEqual([]);
    const unbuilt = [
      ...SESSION_STATES.map((state) => animationFor(state)),
      animationFor('WORKING'),
      animationFor('WORKING', { tool: 'Read' }),
    ].filter((name) => !baked.includes(name));
    expect(unbuilt).toEqual([]);
  });
});

describe('stateRank', () => {
  it('ranks every state, attention first and asleep last', () => {
    const ranked = [...SESSION_STATES].sort(
      (a, b) => stateRank(a) - stateRank(b),
    );
    expect(ranked.at(0)).toBe('NEEDS_PERMISSION');
    expect(ranked.at(-1)).toBe('ASLEEP');
  });

  it('gives the three attention states one shared rank', () => {
    expect(stateRank('FAILED')).toBe(stateRank('NEEDS_PERMISSION'));
    expect(stateRank('WAITING')).toBe(stateRank('NEEDS_PERMISSION'));
  });

  it('puts working ahead of thinking, and idle ahead of asleep', () => {
    expect(stateRank('WORKING')).toBeLessThan(stateRank('THINKING'));
    expect(stateRank('IDLE')).toBeLessThan(stateRank('ASLEEP'));
  });

  it('puts the payoff below everything active and above idle', () => {
    // A deliberate departure from the screen spec, which gives `DONE` tier 1
    // and lets it seize the stage from everything — settled for a two-second
    // oneshot, where a fifteen-second window is a different cost.
    //
    // The first version of this test asserted the opposite for `WORKING`, and
    // that ranking was a live defect: with `DONE` borrowing the `idle` art, a
    // finished session took the stage from a working one and showed a Clawd
    // doing nothing while a tool ran. Lower must win against resting states
    // only.
    for (const active of [
      'NEEDS_PERMISSION',
      'FAILED',
      'WAITING',
      'WORKING',
      'THINKING',
    ] as const) {
      expect(stateRank('DONE')).toBeGreaterThan(stateRank(active));
    }
    expect(stateRank('DONE')).toBeLessThan(stateRank('IDLE'));
  });
});

describe('the payoff screen', () => {
  it('draws its own art rather than borrowing idle', () => {
    // **The one behavioural change of the branch that added the art**, and it
    // had no test: `DONE` mapped to `idle` while the art was unbuilt, and the
    // sweep below only checks the name is baked — which passed just as happily
    // when the answer was `idle`. A review found it.
    expect(animationFor('DONE')).toBe('payoff');
    expect(animationFor('IDLE')).toBe('idle');
    // Distinct, because the whole point of the state is that finishing looks
    // different from resting.
    expect(animationFor('DONE')).not.toBe(animationFor('IDLE'));
  });
});
