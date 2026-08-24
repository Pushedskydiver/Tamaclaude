/**
 * Which `/dev/cu.*` is the panel, asked of the kernel rather than guessed.
 *
 * ## Why this is not the guessing the CLI forbids
 *
 * `packages/cli/src/device.ts` carries the objection, added on 21 Aug when the
 * daemon first drove real hardware: "guessing which `/dev/cu.*` is the panel is
 * a worse failure than being told: the wrong guess writes packets at somebody's
 * modem." It is right, and it retires two of the three obvious designs rather
 * than this one. (It lived in `index.ts` until the commit that added this file
 * moved it.)
 *
 * **Probing by opening ports is disproved, not merely risky.** There is no
 * handshake to listen for: `report.ts` says "a device that has received
 * nothing says nothing", and the firmware's reporter returns early while every
 * counter is still zero. So a probe would sit silent on every port forever,
 * and the only way to make a device speak is to write at it — which is the
 * forbidden thing, exactly. Opening is destructive before any byte is written
 * besides: `serial.ts` runs `stty` on the path, rewriting the line discipline
 * of whatever is on the other end, and then opens it — and `link.ts` records
 * that "opening the port toggles DTR/RTS and the USB-Serial/JTAG peripheral
 * reboots the chip", which is the mechanism esptool uses. Nothing in this repo
 * establishes what that does to somebody else's board; the point is only that
 * it is not nothing, and that this reads descriptors instead of finding out.
 *
 * This asks the IORegistry what is plugged in. Nothing is opened, nothing is
 * written, nothing is reset, and no port belonging to anyone else is touched.
 * The device says what it is in its USB descriptor before any of that.
 *
 * ## It refuses rather than choosing
 *
 * `0x303A:0x1001` is Espressif's USB-Serial/JTAG identity and it is shared by
 * every ESP32-C3, C6 and S3 in that mode — so two boards on one Mac are
 * indistinguishable by it. That is not hypothetical: `BUILD_PLAN.md`'s risk
 * table calls for ordering a spare, and Stage 6 flashes a gift board separate
 * from the dev board. Picking the first match would drive the wrong board
 * while reporting itself online.
 *
 * So this returns everything it found and lets the caller refuse. Being told
 * is still the answer when there is any doubt; the explicit device argument
 * stays exactly where it is.
 *
 * **Nothing is pinned by serial number.** It would earn nothing — the
 * recipient has one panel — and it costs a reinstall if a board is ever
 * replaced, which the same risk table contemplates. The serial is reported so
 * a person can tell two boards apart by eye.
 */
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';
import { promisify } from 'node:util';

/** Espressif's vendor id, and the product id of its USB-Serial/JTAG unit. */
const ESPRESSIF = 0x303a;
const USB_SERIAL_JTAG = 0x1001;

/**
 * The IORegistry, behind a seam narrow enough to fake.
 *
 * The same shape as `SerialSystem` and for the same reason: everything here
 * needs a Mac with a board plugged into it, so the part worth testing — which
 * matches count, which node the callout comes from, what an enumerating device
 * looks like — gets captured registries instead.
 */
export type UsbSystem = {
  /** The USB subtree of the IORegistry, as JSON text. */
  registry(): Promise<string>;
};

/** A panel the kernel can see. */
export type PanelDevice = {
  /** The callout node, e.g. `/dev/cu.usbmodem1101`. */
  readonly path: string;
  /** The board's USB serial — its MAC. Reported, never matched on. */
  readonly serial?: string;
};

type Node = {
  readonly IOObjectClass?: unknown;
  readonly idVendor?: unknown;
  readonly idProduct?: unknown;
  readonly IOCalloutDevice?: unknown;
  readonly kUSBSerialNumberString?: unknown;
  readonly IORegistryEntryChildren?: readonly Node[];
};

function children(node: Node): readonly Node[] {
  return node.IORegistryEntryChildren ?? [];
}

/**
 * The callout node, which hangs below the device rather than on it.
 *
 * `IOCalloutDevice` is published by `IOSerialBSDClient` when the CDC driver
 * attaches, several levels beneath `IOUSBHostDevice`. Its absence is not an
 * error: between USB enumeration and that attach there is a window where the
 * device is visible and has no node yet, which is what a launchd agent
 * starting at login can meet.
 */
function calloutOf(node: Node): string | undefined {
  if (typeof node.IOCalloutDevice === 'string') return node.IOCalloutDevice;
  for (const child of children(node)) {
    const found = calloutOf(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Whether this node is the device itself rather than one of its interfaces.
 *
 * The interfaces beneath a USB device repeat its `idVendor` and `idProduct`,
 * so matching on those alone counts one board five times — measured on the
 * real registry. `IOObjectClass` is what separates the device from its
 * children.
 */
function isPanel(node: Node): boolean {
  return (
    node.IOObjectClass === 'IOUSBHostDevice' &&
    node.idVendor === ESPRESSIF &&
    node.idProduct === USB_SERIAL_JTAG
  );
}

/** Every panel at or beneath this node, in registry order. */
function collect(node: Node): readonly PanelDevice[] {
  const path = isPanel(node) ? calloutOf(node) : undefined;
  const here: readonly PanelDevice[] =
    path === undefined
      ? []
      : [
          {
            path,
            serial:
              typeof node.kUSBSerialNumberString === 'string'
                ? node.kUSBSerialNumberString
                : undefined,
          },
        ];
  return [...here, ...children(node).flatMap((child) => collect(child))];
}

/** Every panel the kernel can currently see, in registry order. */
export async function findPanels(
  usb: UsbSystem,
): Promise<readonly PanelDevice[]> {
  const roots: unknown = JSON.parse(await usb.registry());
  if (!Array.isArray(roots)) return [];
  return (roots as readonly Node[]).flatMap((child) => collect(child));
}

const run = promisify(execFile);

/**
 * The USB tree on a Mac with a dock is far larger than a bare one.
 *
 * Measured at 15KB with one board and nothing else; a hub, a keyboard and a
 * display push it well past that. This is a backstop against a hang, not a
 * budget — `execFile` kills the child and rejects if the output exceeds it.
 */
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;

/**
 * `<data>` values, which are the one thing `plutil` will not convert to JSON.
 *
 * `UsbDeviceSignature` is base64 in the XML and makes the whole conversion
 * fail with "Invalid object in plist for JSON format" — measured. Nothing here
 * reads it, so it is replaced rather than decoded.
 */
const DATA_BLOCK = /<data>[\s\S]*?<\/data>/gu;

/**
 * Convert an XML plist to JSON, without a shell and without a temp file.
 *
 * `spawn` rather than `execFile` because the conversion needs the XML on
 * stdin, and `execFile`'s `input` option does not exist — passing it makes the
 * call hang forever waiting on a stdin nobody writes to. That cost half an
 * hour to find, so it is written down.
 */
async function toJson(xml: string): Promise<string> {
  const child = spawn('plutil', ['-convert', 'json', '-o', '-', '-']);
  child.stdin.end(xml);
  const [out, err, closed] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, 'close'),
  ]);
  // Named distinctly, because this failing means the shape of `ioreg`'s output
  // changed rather than that no panel is plugged in.
  if (closed[0] !== 0) {
    throw new Error(`plutil could not read the USB registry: ${err.trim()}`);
  }
  return out;
}

/**
 * This Mac's IORegistry, via two binaries that ship with macOS.
 *
 * `/usr/sbin/ioreg` and `/usr/bin/plutil` are both base-install and both on
 * launchd's default `PATH`, which matters because this runs from an agent.
 * `plutil` is listed in `knip.json`'s `ignoreBinaries` because knip does not
 * recognise it as a system binary the way it does `stty`, which `serial.ts`
 * has shelled to since Stage 2.
 * Neither needs a permission the recipient would have to grant: the registry
 * is world-readable and triggers no TCC prompt.
 *
 * `-a` for XML rather than the indented text tree, deliberately. In the text
 * form the hierarchy is carried by indentation and the callout sits three
 * nodes below the device — interface, `AppleUSBACMData`, `IOSerialBSDClient` —
 * so a line-oriented read pairs the wrong `idVendor` with the wrong callout as
 * soon as a second USB device appears, which is precisely the case this exists
 * to get right.
 */
export function nodeUsb(): UsbSystem {
  return {
    async registry(): Promise<string> {
      const { stdout } = await run(
        'ioreg',
        ['-a', '-r', '-c', 'IOUSBHostDevice', '-l'],
        { maxBuffer: MAX_REGISTRY_BYTES },
      );
      // An empty tree is what `ioreg` prints when no USB device matches, and
      // `plutil` rejects an empty document. Answer for it here.
      if (stdout.trim() === '') return '[]';
      return await toJson(
        stdout.replace(DATA_BLOCK, '<string>elided</string>'),
      );
    },
  };
}
