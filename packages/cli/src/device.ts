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
): { readonly path: string } | { readonly refusal: string } {
  if (given !== undefined) return { path: given };
  if (found.length > 1) {
    return {
      refusal:
        `found ${String(found.length)} panels; name the one you mean:\n` +
        found
          .map((panel) => `  ${panel.path}  ${panel.serial ?? '(no serial)'}`)
          .join('\n'),
    };
  }
  const only = found[0];
  if (only === undefined) {
    return { refusal: 'no panel found. Plug it in, or name the device.' };
  }
  return { path: only.path };
}
