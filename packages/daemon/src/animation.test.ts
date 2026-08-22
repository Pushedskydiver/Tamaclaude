import { describe, expect, it } from 'vitest';

import { animationFor, ANIMATIONS } from './animation.js';
import { SESSION_STATES, stateRank } from './state.js';

describe('animationFor', () => {
  it('maps the three editing tools to typing', () => {
    const tools = ['Edit', 'Write', 'NotebookEdit'];
    expect(tools.map((tool) => animationFor('WORKING', tool))).toEqual([
      'typing',
      'typing',
      'typing',
    ]);
  });

  it('maps Bash to gym and Read to bouldering', () => {
    expect(animationFor('WORKING', 'Bash')).toBe('gym');
    expect(animationFor('WORKING', 'Read')).toBe('bouldering');
  });

  it('falls an unknown tool back to thinking rather than throwing', () => {
    // MCP servers invent tool names and Claude Code releases add them, so an
    // unrecognised tool is the ordinary case. It must not be an error, and it
    // must not read as `idle` — that would claim nothing is happening while a
    // tool runs, which is the one direction the panel must never be wrong in.
    expect(animationFor('WORKING', 'mcp__linear__create_issue')).toBe(
      'thinking',
    );
    expect(animationFor('WORKING', 'Grep')).toBe('thinking');
    expect(animationFor('WORKING', '__proto__')).toBe('thinking');
    expect(animationFor('WORKING', 'constructor')).toBe('thinking');
  });

  it('falls back when WORKING carries no tool at all', () => {
    expect(animationFor('WORKING')).toBe('thinking');
  });

  it('shows idle and asleep for the resting states', () => {
    expect(animationFor('IDLE')).toBe('idle');
    expect(animationFor('ASLEEP')).toBe('asleep');
  });

  it('ignores the tool for any state that is not WORKING', () => {
    expect(animationFor('IDLE', 'Bash')).toBe('idle');
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

  it('leaves FAILED on the fallback, deliberately', () => {
    // `dizzy` is tiered below the other two and is cuttable. Until it exists
    // `thinking` is the honest answer — "busy, unspecified" rather than a
    // claim that nothing is happening, which is the direction the fallback
    // rule exists to avoid being wrong in.
    expect(animationFor('FAILED')).toBe('thinking');
  });

  it('returns a built animation for every state', () => {
    // Asserts that no state returns a name with no SVG behind it. It caught
    // nothing when the attention states shared the fallback; it is load-bearing
    // now that two of them name their own art.
    const unbuilt = SESSION_STATES.map((state) => animationFor(state)).filter(
      (name) => !ANIMATIONS.includes(name),
    );
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
});
