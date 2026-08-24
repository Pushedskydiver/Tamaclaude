import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findPanels } from './usb.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A `UsbSystem` that answers with a captured registry instead of this Mac's. */
function fixture(name: string) {
  return {
    registry: () =>
      Promise.resolve(
        readFileSync(join(HERE, 'fixtures', `usb-${name}.json`), 'utf8'),
      ),
  };
}

describe('findPanels', () => {
  it('finds the panel and the device node the kernel gave it', async () => {
    // The fixtures are real `ioreg -a -r -c IOUSBHostDevice -l` output,
    // converted to JSON and trimmed to the keys this reads — with the serial
    // numbers replaced, because they are real board MACs and a tracked
    // fixture carrying a hardware identifier buys nothing.
    const found = await findPanels(fixture('one-panel'));
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('/dev/cu.usbmodem1101');
  });

  it('reports both boards rather than choosing one', async () => {
    // **The case that decides the design.** `0x303A:0x1001` is shared by every
    // ESP32-C3/C6/S3 in USB-Serial/JTAG mode, so a dev board and a spare are
    // indistinguishable by descriptor — and `BUILD_PLAN.md`'s risk table calls
    // for ordering a spare, while Stage 6 flashes a gift board separate from
    // the dev board. Picking the first match would drive the wrong panel while
    // reporting itself online, which is the failure that survives a soak week.
    const found = await findPanels(fixture('two-panels'));
    expect(found.map((panel) => panel.path)).toEqual([
      '/dev/cu.usbmodem1101',
      '/dev/cu.usbmodem2201',
    ]);
    // Distinguishable by eye, so a person can be told which is which.
    expect(new Set(found.map((panel) => panel.serial)).size).toBe(2);
  });

  it('ignores a device that is not a panel', async () => {
    // An Arduino on the same bus. It has a `/dev/cu.*` node and it resets into
    // its bootloader if anything toggles DTR on it — which is why this reads
    // descriptors instead of opening ports to find out.
    expect(await findPanels(fixture('only-strangers'))).toEqual([]);
  });

  it('says nothing yet while the device is still enumerating', async () => {
    // Between USB enumeration and the CDC driver attaching there is a window
    // where the board is visible and has no `/dev/cu.*` node. A launchd agent
    // starting at login lands in it. Absence of a callout is "not yet", not a
    // panel with an undefined path.
    expect(await findPanels(fixture('enumerating'))).toEqual([]);
  });

  it('finds nothing when nothing is plugged in', async () => {
    expect(await findPanels(fixture('no-panel'))).toEqual([]);
  });
});
