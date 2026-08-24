/**
 * The launchd agent: what starts the daemon when nobody is watching.
 *
 * Everything the pack resolver assumes rests on this file. `pack.ts` refuses
 * to start without a pack, on the grounds that failing loudly beats rendering
 * the wrong one — and a spec review pointed out that loud is only loud if
 * somebody is listening. Under an agent, nobody is. So this writes the log
 * path into the plist, and refuses to install at all if the pack it would use
 * cannot be loaded.
 *
 * ## Three ways a plist fails silently, and what stops each
 *
 * | Risk | What stops it |
 * | ---- | ------------- |
 * | Fails to spawn: `PATH` has no node | `ProgramArguments[0]` is `process.execPath`, never the shebang |
 * | Crash-loops on a Mac with no pack | `--apply` resolves the pack first and refuses |
 * | Second install leaves the old agent running | `bootout` before `bootstrap`, always |
 *
 * The first is not hypothetical. `index.ts` begins `#!/usr/bin/env node`, and
 * launchd hands an agent `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Node is in none
 * of those on a machine using a version manager, which is this one. A plist
 * naming the script would fail to exec every ten seconds forever, with the
 * panel showing whatever it last showed. `packages/hooks/src/install.ts`
 * already writes `process.execPath` for the same reason.
 *
 * ## What the plist deliberately does not carry
 *
 * **A device path.** The panel is found by its USB descriptor, so hardcoding
 * `/dev/cu.usbmodem1101` would break the first time it moved USB port —
 * macOS derives that number from the port, not the board.
 *
 * ## What it deliberately does carry
 *
 * **Both environment variables, named explicitly.** The obvious choice is to
 * set none, since the pack has a default location and the socket has one too.
 * But a launchd agent does not inherit a login shell's environment while the
 * hook, spawned by Claude Code, generally does. If either variable is set in a
 * profile the two bind to different values, the hook's failure is swallowed by
 * the `2>/dev/null || true` that `hook-settings.ts` appends, and `tamaclaude
 * pack` in a terminal answers for a process that is not the agent — the
 * silent-wrong-pack failure arriving through the tool built to detect it.
 * Naming them also makes `launchctl print` ground truth rather than a guess.
 */
import { join } from 'node:path';

/** The agent's launchd label, and the basename of its plist. */
export const AGENT_LABEL = 'com.tamaclaude.daemon';

export type AgentOptions = {
  /** The real node binary, not a shim and not the shebang. */
  readonly node: string;
  /** Absolute path to the CLI's built entry point. */
  readonly script: string;
  readonly pack: string;
  readonly socket: string;
  readonly log: string;
};

/**
 * Escape a string for XML character data.
 *
 * A plist is XML, which JSON was not, so `install-hooks` never had this
 * problem and its defences do not cover it. A home directory or a checkout
 * containing `&` or `<` is ordinary and would produce a file launchd silently
 * refuses to load.
 */
function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Where the plist belongs. */
export function agentPlistPath(home: string): string {
  return join(home, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
}

/**
 * The plist, as text.
 *
 * A pure function so the shape can be tested without writing to anyone's
 * `LaunchAgents`, and so `plutil -lint` — the same parse launchd performs —
 * can be run over the result in a test rather than discovered on 19 September.
 *
 * `ThrottleInterval` is 30 rather than the default 10. It does not fix a
 * crash-loop, and this file's job is to make loops unreachable rather than
 * survivable — but a loop that got as far as opening the port resets the board
 * on every respawn, so the panel would flash its boot splash every ten
 * seconds. Thirty makes that visibly a fault rather than a flicker.
 */
export function agentPlist(options: AgentOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(options.node)}</string>
    <string>${xml(options.script)}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TAMACLAUDE_PACK</key>
    <string>${xml(options.pack)}</string>
    <key>TAMACLAUDE_SOCKET</key>
    <string>${xml(options.socket)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xml(options.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(options.log)}</string>
</dict>
</plist>
`;
}

/**
 * What `install-agent` would do, as text a person can check before it happens.
 *
 * Everything that matters is a path resolved at install time and invisible
 * afterwards — which node, which script, which pack, where the log goes. A
 * review's standing question is whether this survives being handed on, and the
 * honest answer was no: it all lived in the installer's head. So the dry run
 * prints all of it, and prints it again on `--apply`.
 */
export function describeAgentInstall(
  options: AgentOptions,
  plistPath: string,
  alreadyInstalled: boolean,
): string {
  return (
    `agent      ${AGENT_LABEL}\n` +
    `plist      ${plistPath}${alreadyInstalled ? ' (replacing the one already there)' : ''}\n` +
    `node       ${options.node}\n` +
    `script     ${options.script}\n` +
    `pack       ${options.pack}\n` +
    `socket     ${options.socket}\n` +
    `log        ${options.log}\n`
  );
}
