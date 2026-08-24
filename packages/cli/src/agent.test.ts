import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_LABEL, agentPlist } from './agent.js';

describe('agentPlist', () => {
  const made: string[] = [];
  afterEach(() => {
    made.splice(0).forEach((dir) => {
      rmSync(dir, { recursive: true, force: true });
    });
  });

  const options = {
    node: '/opt/node/bin/node',
    script: '/opt/tamaclaude/dist/index.js',
    pack: '/Users/someone/.tamaclaude/pack',
    socket: '/Users/someone/.tamaclaude/daemon.sock',
    log: '/Users/someone/.tamaclaude/daemon.log',
  };

  it('runs node directly rather than trusting the shebang', () => {
    // **The bug this exists to prevent.** `index.ts` starts
    // `#!/usr/bin/env node`, and launchd gives an agent
    // `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Node is not there — on this
    // machine it is under a version manager in the user's home — so a plist
    // naming the script would fail to spawn, every ten seconds, forever, with
    // nothing on the glass to say why. `install-hooks` already solved this by
    // writing `process.execPath` into the command it registers.
    const xml = agentPlist(options);
    expect(xml).toContain('<string>/opt/node/bin/node</string>');
    expect(xml).toContain('<string>/opt/tamaclaude/dist/index.js</string>');
    // And `daemon` with no device: the panel is found by descriptor, so a
    // hardcoded path would break the moment it moved USB port.
    expect(xml).toContain('<string>daemon</string>');
    expect(xml).not.toContain('/dev/cu.');
  });

  it('escapes a path that would otherwise corrupt the XML', () => {
    // A home directory or a repo checkout containing `&` or `<` is ordinary,
    // and JSON did not have this problem so `install-hooks` never met it.
    const dir = mkdtempSync(join(tmpdir(), 'tamaclaude-agent-'));
    made.push(dir);
    const xml = agentPlist({
      ...options,
      pack: "/Users/a & b/<pack>/it's here",
    });
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('& b');
    // Proven by the parser rather than by inspection: `plutil -lint` is the
    // same check launchd applies, and it is free.
    const file = join(dir, 'test.plist');
    writeFileSync(file, xml);
    expect(() => execFileSync('plutil', ['-lint', file])).not.toThrow();
    // And it round-trips: the value comes back exactly as it went in.
    const back = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], {
      encoding: 'utf8',
    });
    expect(
      (
        JSON.parse(back) as {
          EnvironmentVariables: { TAMACLAUDE_PACK: string };
        }
      ).EnvironmentVariables.TAMACLAUDE_PACK,
    ).toBe("/Users/a & b/<pack>/it's here");
  });

  it('names the pack and the socket, so the agent and a terminal agree', () => {
    // A launchd agent does not inherit a login shell's environment. If either
    // variable is set in a profile, `tamaclaude pack` in a terminal answers
    // for a different process than the one driving the panel — which is the
    // silent-wrong-pack failure arriving through the tool built to detect it.
    // Naming them here also makes `launchctl print` ground truth.
    const xml = agentPlist(options);
    expect(xml).toContain('TAMACLAUDE_PACK');
    expect(xml).toContain('TAMACLAUDE_SOCKET');
    expect(xml).toContain(AGENT_LABEL);
  });
});
