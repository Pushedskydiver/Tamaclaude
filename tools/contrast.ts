#!/usr/bin/env node
/**
 * What a colour looks like against the ground it will sit on.
 *
 * Written because the figures this repo quotes for contrast — `confused`'s
 * 1.31:1, `dizzy`'s 1.80:1, the splash wordmark's — all came from throwaway
 * scripts that no longer exist, and `tools/bake-sprites.test.ts` records what
 * that costs: a check described in a commit message as refusing to write a
 * file, which had never existed. A number worth putting in a plan is worth
 * being able to recompute.
 *
 *   node tools/contrast.ts '#B22222' ...
 *
 * ## Grounds first, skies too
 *
 * A ground-level prop is never seen against sky. `environment.ts` puts the
 * horizon at 62% of the stage with sea 6% below it, so everything standing on
 * the floor is on sand — the payoff plan asked for sky and would have measured
 * a pair that never touch. The skies are here as well, because a raised prop
 * like `permission-sign`'s plate genuinely is against one, and because the
 * figures this tool exists to make recomputable were taken against them.
 *
 * ## What this does not tell you
 *
 * **A luminance ratio is not legibility.** Clawd's own `#DE886D` measures
 * 1.03:1 against day sand and is perfectly readable on the panel — hue
 * separation, the contact shadow and the silhouette all carry weight that
 * WCAG's formula, designed for text, does not model. So this is a screen for
 * the obviously-invisible rather than a gate: a low number means look at it,
 * not that it fails.
 */
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * What the environment paints, as authored in `environment.ts`.
 *
 * Eight grounds, and both ends of each sky.
 *
 * **The first version of this table invented three of its four sky values**,
 * and described band 0 as the palest when `paintSky` draws it at the top of
 * the stage and it is the darkest of the four. A review caught it. These are
 * copied from `environment.ts` and checked against it.
 *
 * Two bands per sky rather than four, because the extremes bracket what a
 * raised prop can meet and the middle two cannot be worse than both. Which
 * band a given pixel actually meets depends on its height, so treat a sky
 * figure as a bound rather than as the answer.
 */
const AGAINST: Readonly<Record<string, readonly [number, number, number]>> = {
  'dawn sand': [126, 108, 96],
  'day sand': [178, 156, 128],
  'dusk sand': [112, 88, 82],
  'night sand': [52, 50, 58],
  'dawn pool': [92, 106, 126],
  'day pool': [96, 154, 168],
  'dusk pool': [84, 78, 104],
  'night pool': [34, 44, 70],
  // Band 0 of each gradient: the topmost strip, and the darkest of the four.
  // `paintSky` draws index 0 at `stage.y`.
  'dawn sky top': [58, 62, 104],
  'day sky top': [74, 140, 200],
  'dusk sky top': [46, 40, 78],
  'night sky top': [8, 12, 30],
  // Band 3: the strip meeting the horizon, and the palest.
  'dawn sky low': [244, 190, 150],
  'day sky low': [184, 214, 236],
  'dusk sky low': [236, 148, 92],
  'night sky low': [32, 46, 84],
};

/**
 * Round a channel the way the panel does.
 *
 * **The basis matters and the first version had it wrong.** `environment.ts`
 * passes every colour through `rgb565`, which keeps 5 bits of red and blue and
 * 6 of green — and that file states its own luminance figures are "as the
 * panel receives it after `rgb565` truncation". A tool measuring the authoring
 * triples is measuring a colour the panel never shows, and was quietly
 * producing figures on a different basis from the ones already written down.
 *
 * No claim is made here about reproducing a specific published number. A
 * review offered 1.31 and 1.80 as this tool's target, attributing them to the
 * sign plate; they are `dizzy`'s worst *pip* pixel over its loop, per that
 * file's own sentence, and against a per-time worst band rather than a fixed
 * one. Two figures agreeing to two decimal places is not evidence they are the
 * same measurement.
 */
export function panelRounded([red, green, blue]: readonly [
  number,
  number,
  number,
]): [number, number, number] {
  const five = (v: number): number => (v & 0xf8) | ((v & 0xf8) >> 5);
  const six = (v: number): number => (v & 0xfc) | ((v & 0xfc) >> 6);
  return [five(red), six(green), five(blue)];
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.040_45 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, Rec.709 coefficients as WCAG defines them. */
export function luminance([red, green, blue]: readonly [
  number,
  number,
  number,
]): number {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

/** The WCAG contrast ratio between two colours, 1:1 to 21:1. */
export function contrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** `#RRGGBB` to a triple, or undefined if it is not one. */
export function parseHex(
  hex: string,
): readonly [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match?.[1]) return undefined;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function main(): void {
  const hexes = process.argv.slice(2);
  if (hexes.length === 0) {
    process.stderr.write('usage: node tools/contrast.ts <#rrggbb> ...\n');
    process.exit(2);
  }
  const names = Object.keys(AGAINST);
  process.stdout.write(
    `${'colour'.padEnd(9)}${names.map((n) => n.padStart(11)).join('')}\n`,
  );
  for (const hex of hexes) {
    const rgb = parseHex(hex);
    if (!rgb) {
      process.stderr.write(`not a hex colour: ${hex}\n`);
      process.exit(2);
    }
    const cells = names.map((name) => {
      const ratio = contrast(
        panelRounded(rgb),
        panelRounded(AGAINST[name] ?? [0, 0, 0]),
      );
      return `${ratio.toFixed(2)}:1`.padStart(11);
    });
    process.stdout.write(`${hex.padEnd(9)}${cells.join('')}\n`);
  }
}

/**
 * Run only when this file *is* the command, not when a test imports it.
 *
 * Without the guard, importing the module executes `main`, which exits 2 on an
 * empty argv and takes the test runner with it. That is the third time this
 * session a file has been both a script and a module and the script half won —
 * `packages/cli/src/index.ts` did it to fifteen unrelated tests.
 *
 * `realpathSync` on both sides, because `process.argv[1]` is whatever path was
 * typed and `import.meta.url` is resolved.
 */
function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return (
      realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
