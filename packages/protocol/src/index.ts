/**
 * Wire format and pixel primitives.
 *
 * This package is the root of the dependency graph and imports nothing. It
 * defines the vocabulary every other package speaks: panel geometry, the
 * native pixel format, dirty rectangles, the RLE codec that gets frames down a
 * 12 Mbps link, and the shape of a Claude Code hook event.
 */

export * from './colour.js';
export * from './dirty-rect.js';
export * from './events.js';
export * from './geometry.js';
export * from './packet.js';
export * from './rle.js';
export * from './screen.js';
