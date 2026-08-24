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
    // **What the fixtures are, precisely.** One real
    // `ioreg -a -r -c IOUSBHostDevice -l` capture with the panel attached,
    // converted to JSON and trimmed — to the keys this file reads, plus the
    // vendor and product *names*, which nothing reads but which make a fixture
    // legible to a person opening it.
    //
    // The serial numbers are invented. The real ones are board MACs, and a
    // tracked fixture carrying a hardware identifier buys nothing.
    //
    // The other four are derived from that one capture rather than separately
    // captured: ids and names rewritten for the stranger, the CDC subtree
    // removed for the enumerating case, the whole device duplicated for two
    // boards. A review pointed out the first version claimed they were all
    // real output, and that the stranger fixture was therefore an Arduino that
    // had never been plugged into anything.
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

  it('finds a panel nested under a hub', async () => {
    // **The descent had no test at all**: every other fixture puts the panel
    // at the top level, so replacing the recursive branch with `return here;`
    // left the suite green. A review found it.
    //
    // It is not a hypothetical shape. `ioreg -r -c` prints only the outermost
    // matching subtree, so when the panel is behind a hub the *hub* is the
    // `IOUSBHostDevice` at the root and the panel appears beneath it. A desk
    // toy plugged into a dock is the ordinary case, not the exotic one.
    const found = await findPanels(fixture('behind-a-hub'));
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('/dev/cu.usbmodem1101');
  });

  it('ignores a device that is not a panel', async () => {
    // Something that is not a panel on the same bus, wearing Arduino's vendor
    // and product ids. It has a `/dev/cu.*` node of its own, which is the only
    // property that matters here: discovery must not return it. What opening
    // it would do to it is not something this repo establishes, which is
    // exactly why nothing opens it.
    expect(await findPanels(fixture('only-strangers'))).toEqual([]);
  });

  it('says nothing yet while the device is still enumerating', async () => {
    // Between USB enumeration and the CDC driver attaching there is a window
    // where the board is visible and has no `/dev/cu.*` node. A launchd agent
    // starting at login lands in it. Absence of a callout is "not yet", not a
    // panel with an undefined path.
    //
    // The fixture has no `IOSerialBSDClient` at all, which is what that state
    // actually looks like — the first version kept the node and deleted its
    // `IOCalloutDevice` key, a shape that cannot occur, because publishing the
    // callout is what that node attaching *means*.
    expect(await findPanels(fixture('enumerating'))).toEqual([]);
  });

  it('finds nothing when nothing is plugged in', async () => {
    expect(await findPanels(fixture('no-panel'))).toEqual([]);
  });
});
