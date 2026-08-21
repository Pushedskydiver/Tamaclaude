/**
 * The renderer: a virtual 172x320 screen composed entirely on the host.
 *
 * This is where every screen, animation and layout decision lives. It has two
 * sinks — a browser canvas in development and the panel over USB-CDC in
 * production — and does not know which one it is feeding. There is no sink
 * abstraction between them: this package produces a `Framebuffer`, and what a
 * consumer does with it is the consumer's business.
 *
 * This file is a barrel and nothing else. Everything it names lives in a
 * module that can be imported directly, so a module needing a *value* from a
 * sibling never has to come back through here and close a cycle.
 */

// Panel band geometry, re-exported so consumers have one import path and
// `tools/panel-mock.ts` cannot drift from the renderer it is mocking.
export * from './layout.js';
export * from './framebuffer.js';

// The primitives every screen is built from. Consumer-facing: the harness
// draws with these directly, not only through a scene.
export * from './draw.js';
export * from './environment.js';
export * from './text.js';

// The scene, and the session chip its strip is described in terms of.
//
// `band.js` is deliberately absent. Its palette roles and insets are how a
// scene is *painted*, not how one is *described*, and nothing outside this
// package composes a band by hand — `sceneColours` joins the barrel the day
// something does.
export * from './scene.js';
export * from './strip.js';

// Clawd's frames, loaded on demand. See sprites/index.ts.
export { loadSprite, SPRITE_NAMES } from './sprites/index.js';
export type { Sprite, SpriteName } from './sprites/index.js';
