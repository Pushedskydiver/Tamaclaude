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

  it('returns a built animation for every state', () => {
    // The attention states have no art yet, so this is really asserting that
    // none of them returns a name with no SVG behind it.
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
