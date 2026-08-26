/**
 * Every animation SVG is well-formed XML.
 *
 * **Nothing else checks this.** `svg2frames.ts` renders through a browser,
 * which parses SVG-in-HTML leniently and recovers from errors an XML parser
 * refuses — so a malformed file bakes correctly, every gate passes, and the
 * damage is latent until something reads the file as XML. `typing.svg` sat on
 * `main` in that state, with a `--` inside a comment, which XML forbids
 * outright because it cannot be distinguished from the comment's own
 * terminator.
 *
 * Found by a human reading the file, which is the detection method this test
 * replaces.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';

const DIR = 'assets/clawd/animations';
const svgs = readdirSync(DIR).filter((name) => name.endsWith('.svg'));

describe('the animation sources', () => {
  it('are all well-formed XML', () => {
    expect(svgs.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const name of svgs) {
      const errors: string[] = [];
      const parser = new DOMParser({
        onError: (level, message) => {
          if (level === 'error' || level === 'fatalError') errors.push(message);
        },
      });
      parser.parseFromString(
        readFileSync(`${DIR}/${name}`, 'utf8'),
        'text/xml',
      );
      if (errors.length > 0) broken.push(`${name}: ${errors[0] ?? ''}`);
    }
    expect(broken).toEqual([]);
  });

  it('have no double hyphen inside a comment', () => {
    // The specific rule the parser above enforces, called out separately so a
    // failure names the cause rather than a column number. `--` is the one
    // sequence a comment cannot contain, and it arrives naturally: every CLI
    // flag in prose is one.
    const offenders: string[] = [];
    for (const name of svgs) {
      const source = readFileSync(`${DIR}/${name}`, 'utf8');
      for (const match of source.matchAll(/<!--([\s\S]*?)-->/gu)) {
        const body = match[1] ?? '';
        if (!body.includes('--')) continue;
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${name}:${String(line)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
