/**
 * The physical panel: USB-CDC transport, and the firmware source.
 *
 * The firmware (`firmware/`, added in BUILD_PLAN Stage 2) is a dumb blitter.
 * It is flashed once and never changes. If a change to it seems necessary,
 * that is a strong signal the change belongs on the host instead — and it is
 * also why this package refuses to run against a firmware built for another
 * panel rather than trying to adapt to one.
 *
 * `openPanel` is the surface for driving a panel, and `findPanels` the one for
 * discovering which port it is on. Everything else here is the vocabulary they
 * answer in.
 */

export type { LinkStatus, PanelSize } from './link.js';
export { openPanel } from './panel.js';
export type { Transport } from './transport.js';
// Exported for the `daemon` command, which injects a fake port in its tests
// the same way this package's own tests do.
export type { SerialSystem, SerialWatch } from './serial.js';
// Which `/dev/cu.*` is the panel, read from the USB descriptor rather than
// guessed. Here rather than in `cli` because it is a fact about the host's
// device stack, which is what this package is for.
export { findPanels, nodeUsb } from './usb.js';
