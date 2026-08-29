/**
 * Why the device could not be chosen.
 *
 * **A kind rather than a string.** `refusalReport` used to decide by
 * `refusal.startsWith('no panel found')`, which coupled two files through a
 * message. A review planted the ordinary edit — prefixing that message with the
 * program name — and the whole exit-code fix reverted silently with every gate
 * green. The compiler holds this seam instead.
 */
export type Refusal = {
  readonly kind: 'absent' | 'ambiguous';
  readonly refusal: string;
};

/**
 * Which device to drive: the one named, the one found, or a refusal.
 *
 * Its own module rather than a function in `index.ts`, because `index.ts` is a
 * script: importing it runs the argv dispatch and exits the process. A test
 * that imported it took fifteen other tests down with it, which is a
 * reasonable way to find that out.
 *
 * **The old rule was "an argument rather than a discovery, because guessing
 * which `/dev/cu.*` is the panel is a worse failure than being told: the wrong
 * guess writes packets at somebody's modem." That reason is retired; the
 * conclusion is not.**
 *
 * Nothing is guessed now. `findPanels` reads the USB descriptor macOS already
 * has, so a device identifies itself before anything opens it — and the two
 * designs that *were* guessing stay rejected, one of them disproved rather
 * than merely doubted: there is no handshake to listen for, so probing ports
 * would have had to write at strangers to make them speak.
 *
 * The argument stays, as the escape hatch and as what gets typed during the
 * soak week. What is new is that omitting it is no longer a usage error.
 *
 * **Ambiguity refuses rather than picking.** Every ESP32-C3, C6 and S3 in
 * USB-Serial/JTAG mode shares `0x303A:0x1001`, so a dev board and the spare
 * the risk table calls for are indistinguishable. Choosing the first would
 * drive the wrong panel while reporting itself online — a failure that
 * survives a whole soak week.
 *
 * Separated from the `process.exit` in `index.ts`'s caller so the decision can
 * be tested without a board — the refusal branches are the ones worth testing
 * and the ones no CI machine can reach by having hardware plugged in.
 */
export function chooseDevice(
  given: string | undefined,
  found: readonly { readonly path: string; readonly serial?: string }[],
): { readonly path: string } | Refusal {
  if (given !== undefined) return { path: given };
  if (found.length > 1) {
    return {
      kind: 'ambiguous',
      refusal:
        `found ${String(found.length)} panels; name the one you mean:\n` +
        found
          .map((panel) => `  ${panel.path}  ${panel.serial ?? '(no serial)'}`)
          .join('\n'),
    };
  }
  const only = found[0];
  if (only === undefined) {
    return {
      kind: 'absent',
      refusal: 'no panel found. Plug it in, or name the device.',
    };
  }
  return { path: only.path };
}

/**
 * What the daemon exits with when there is simply no panel plugged in.
 *
 * Its own code, so `describeAgentStatus` can say "waiting for a panel" instead
 * of "see the log". Distinct from 2, which stays for the refusals a person has
 * to resolve — naming one of two panels — and from 1, which `onGiveUp` uses
 * when a panel that *was* open goes away.
 */
export const EXIT_NO_PANEL = 3;

/**
 * What to print for a refusal, and what to exit with.
 *
 * **Usage is for argument errors, and an unplugged cable is not one.** Until
 * 29 Aug both refusals printed the whole usage block and exited 2. Under
 * launchd, which restarts on exit, that filled `~/.tamaclaude/daemon.log` with
 * usage text — 1.4 MB on the author's machine — and made
 * `pnpm tamaclaude status` report `loaded but not running; last exit 2`, which
 * reads as a broken install rather than a panel nobody has plugged in. It is
 * the most likely thing to happen to a working install, since the cable comes
 * out whenever the desk moves.
 *
 * Separated from the `process.exit` in `index.ts` for the reason `chooseDevice`
 * was: the branches worth testing are the ones no CI machine can reach by
 * having hardware plugged in.
 */
export function refusalReport(
  refusal: Refusal,
  supervised: boolean,
): { readonly text: string; readonly code: number } {
  // The multi-panel refusal already lists the paths, so it carries its own
  // remedy too. Neither needs the usage block.
  if (refusal.kind === 'ambiguous') {
    // Under supervision "name the one you mean" is not actionable either — the
    // plist passes no device by design. Unplugging one is the only move the
    // supervisor's restart can then succeed on.
    const remedy = supervised
      ? `${refusal.refusal}\nunplug one; the agent retries every 30 seconds\n`
      : `${refusal.refusal}\n`;
    return { text: remedy, code: 2 };
  }
  // Under supervision the refusal's "or name the device" is not actionable —
  // the plist passes no device on purpose, because macOS derives the path from
  // the USB port and it changes when the panel moves socket. So say the thing
  // that is true there instead, in the shape `onGiveUp` already uses for a
  // panel that goes away after opening.
  if (supervised) {
    return {
      text: 'no panel found; exiting so the agent looks again when one appears\n',
      code: EXIT_NO_PANEL,
    };
  }
  return { text: `${refusal.refusal}\n`, code: EXIT_NO_PANEL };
}
