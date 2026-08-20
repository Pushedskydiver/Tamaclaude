/**
 * Paint known colours on the panel, to settle how bytes become light.
 *
 * The blitter byte-swaps every pixel on its way to the ST7789, because the
 * controller latches big-endian under `esp_lcd`'s default RAMCTRL. That was a
 * reasoned guess made without a board, and a wrong guess there looks exactly
 * like a colour-order bug rather than an endianness one — which is why it
 * needs measuring rather than arguing about.
 *
 *   node tools/colour-bars.ts [port] [orientation]
 *
 * Six vertical bands, left to right, in the order printed. Read the panel and
 * compare. Every candidate transform maps this set somewhere different, so one
 * look identifies which one is in play:
 *
 * - correct: black white red green blue peach
 * - byte-swapped: black grey-blue dark-grey light-cyan yellow-green cyan
 * - inverted: white black cyan magenta yellow blue-grey
 */
import type { Orientation } from '@tamaclaude/renderer';

import process from 'node:process';

import { encodeRect, writeRectHeader } from '@tamaclaude/protocol';
import { ORIENTATIONS, panelSize } from '@tamaclaude/renderer';

import { connect, writeAll } from './serial.ts';

/** Name, and the RGB565 word the host believes it is sending. */
const BARS: readonly (readonly [string, number])[] = [
  ['black', 0x0000],
  ['white', 0xffff],
  ['red', 0xf800],
  ['green', 0x07e0],
  ['blue', 0x001f],
  ['peach #DE886D', 0xdc4d],
];

async function main(): Promise<void> {
  const port = process.argv[2] ?? '/dev/cu.usbmodem1101';
  const orientation = (process.argv[3] ?? 'landscape') as Orientation;
  if (!ORIENTATIONS.includes(orientation)) {
    console.error(`orientation must be one of ${ORIENTATIONS.join(', ')}`);
    process.exit(1);
  }
  const { width, height } = panelSize(orientation);
  const barWidth = Math.floor(width / BARS.length);

  const link = await connect(port);
  try {
    for (const [index, [name, value]] of BARS.entries()) {
      const last = index === BARS.length - 1;
      const rect = {
        x: index * barWidth,
        y: 0,
        width: last ? width - index * barWidth : barWidth,
        height,
      };
      const pixels = new Uint16Array(rect.width * rect.height).fill(value);
      const { mode, payload } = encodeRect(pixels);
      const header = writeRectHeader(rect, payload.byteLength, mode);
      const bytes = new Uint8Array(header.byteLength + payload.byteLength);
      bytes.set(header);
      bytes.set(payload, header.byteLength);
      await writeAll(link.handle, bytes);
      console.log(
        `  bar ${index + 1}: ${name.padEnd(14)} 0x${value.toString(16).padStart(4, '0')} ` +
          `at x=${rect.x}..${rect.x + rect.width - 1}`,
      );
    }
    console.log(
      '\nleft to right, that should read: ' +
        BARS.map(([n]) => n.split(' ')[0]).join(' '),
    );
    // Hold the port open briefly so the last bar is not cut off by teardown.
    await new Promise((done) => setTimeout(done, 1500));
  } finally {
    await link.close();
  }
}

await main();
