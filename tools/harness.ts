#!/usr/bin/env node
/**
 * Build the dev harness: an interactive panel you can actually look at.
 *
 * `tools/panel-mock.ts` renders a fixed comparison image, which is the right
 * artefact for a pull request and the wrong one for judging motion. The
 * harness animates, and scrubs sprites against real slot geometry — hero
 * against two-up, portrait against landscape, frame by frame.
 *
 * **It cannot answer whether a band earns its height**, because it no longer
 * draws band contents. `tools/panel-mock.ts` can, for the configuration that
 * ships: landscape, where the message band is derived as 116px. Neither can
 * for portrait, whose `BAND_HEIGHTS.message` = 64 reaches nothing on the
 * device — `BUILD_PLAN.md` carries that split.
 *
 * **What it draws is a subset of what the panel draws, and the subset is the
 * design.** It scrubs sprites; it does not compose a panel. See below.
 *
 *   pnpm harness && open out/harness.html
 *
 * Output is a single self-contained file: every frame is inlined, so it can be
 * opened from disk with no server and no network. Geometry, slots, scales and
 * the landscape crop come from `@tamaclaude/renderer` rather than constants
 * copied here, so those cannot drift.
 *
 * **This page no longer draws band contents, and that is what closed Stage 2's
 * exit.** It used to compose the status band, the clock, the session chips and
 * the message band in browser JavaScript, against the renderer that draws all
 * four for real — so "browser and panel show the same thing" held only by
 * inspection, which is precisely what that criterion is written to rule out.
 * The gap had also been widening rather than closing: the panel draws 2x
 * bitmap status text that no browser view rendered at all.
 *
 * It was closed by deletion rather than by bundling the renderer in here. In a
 * host-renders architecture the two ends agree *by default* — both come from
 * one `Framebuffer` — and the only thing that ever made them disagree was
 * tools choosing to draw a competing panel. `tools/panel-mock.ts` composes
 * through `render()` and is the artefact for judging anything inside a band.
 *
 * What survives here is what a scrubber is actually good at: sprite scale and
 * placement, against real `spriteSlots` geometry, at true size and zoomed,
 * with seek and slot switching. Band rects are still outlined, because that
 * geometry comes from `panelBands()` and so cannot drift — but they are
 * outlines, not contents.
 *
 * **The evidence this page used to carry was never a fair test.** A long MCP
 * tool name was shown here wrapped by CSS `overflow-wrap:anywhere`; the
 * renderer wraps the message band with `drawTextBlock` -> `wrapText`, a
 * different algorithm. (`fitted()` is the status band's and truncates with an
 * ellipsis; it never touches this band.)
 *
 * **The failure this page recorded is kept here on purpose**, because
 * `packages/renderer/src/text.ts` cites this file for it and the CSS that
 * produced it is gone: a long MCP tool name rendered as one 207px line inside
 * a 172px panel and lost five characters to `overflow: hidden` with no marker,
 * while the band still looked like one short line in a large box — which then
 * argued for making the band *smaller*. That is why `wrapText` wraps and marks
 * rather than truncating silently. It is also why the measurement is not
 * evidence about band height: 207px is what CSS did, not what the renderer
 * does.
 *
 * The screen spec still reads "Book the afternoon of Mon 24 Aug in the dev
 * harness" and `BAND_HEIGHTS.message` has not moved since 18 Aug, so as far as
 * the repo records, that session has not happened. The band height is
 * unjudged, and the page that was going to judge it would have judged it with
 * the wrong wrapper.
 *
 * It is driven by rendered frames, not by Claude Code. Injecting synthetic
 * events is a separate unchecked Stage 1 line; Stage 3 has landed for the
 * daemon and the panel, with remote transport still open.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import {
  ORIENTATIONS,
  panelBands,
  panelSize,
  safeAreaCropUnits,
  spriteSlots,
  STAGE_LAYOUTS,
  stageScale,
} from '@tamaclaude/renderer';

type Animation = { readonly name: string; readonly frames: readonly string[] };

async function loadAnimation(frameDir: string): Promise<Animation> {
  const names = (await readdir(frameDir))
    .filter((name) => name.endsWith('.png'))
    .sort();
  if (names.length === 0) throw new Error(`no PNGs in ${frameDir}`);
  const frames = await Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(resolve(frameDir, name));
      return `data:image/png;base64,${bytes.toString('base64')}`;
    }),
  );
  return { name: basename(frameDir), frames };
}

/** Every band rect for every orientation, as data the page can switch between. */
function layoutData() {
  const bands = Object.fromEntries(
    ORIENTATIONS.map((orientation) => [orientation, panelBands(orientation)]),
  );
  const slots = Object.fromEntries(
    ORIENTATIONS.map((orientation) => [
      orientation,
      Object.fromEntries(
        STAGE_LAYOUTS.map((layout) => [
          layout,
          spriteSlots(layout, orientation),
        ]),
      ),
    ]),
  );
  const sizes = Object.fromEntries(
    ORIENTATIONS.map((orientation) => [orientation, panelSize(orientation)]),
  );
  const scales = Object.fromEntries(
    STAGE_LAYOUTS.map((layout) => [layout, stageScale(layout)]),
  );
  return { bands, slots, sizes, scales, cropUnits: safeAreaCropUnits() };
}

const PAGE_STYLE = `
  :root { color-scheme: dark }
  body { margin:0; padding:20px; background:#010409; color:#7d8590;
         font:13px ui-monospace,SFMono-Regular,monospace; }
  h1 { color:#c9d1d9; font-size:14px; font-weight:400; margin:0 0 14px }
  .controls { display:flex; gap:18px; flex-wrap:wrap; align-items:center;
              margin-bottom:18px; padding:10px 12px; background:#0d1117;
              border:1px solid #21262d; border-radius:6px }
  label { display:flex; gap:6px; align-items:center; color:#c9d1d9 }
  select,button { background:#161b22; color:#c9d1d9; border:1px solid #30363d;
                  border-radius:4px; padding:3px 7px; font:inherit }
  button { cursor:pointer }
  .stage { display:flex; gap:36px; align-items:flex-start }
  /* A backdrop, not the panel's ground. The daemon sets extent:'panel', so
     the rock pool covers the whole framebuffer and the device never shows a
     flat background at all — see tools/panel-mock.ts for the real thing. This
     value is packs/example palette[0], and the honest reason it is written
     here rather than read from the pack is that this page composites
     transparent PNGs and needs *something* behind them. */
  .panel { position:relative; background:#0d1117; overflow:hidden;
           image-rendering:pixelated; outline:1px solid #30363d }
  .band { position:absolute }
  .band.showing { outline:1px dashed #f7836333 }
  .slot { position:absolute; overflow:hidden }
  .slot img { display:block; image-rendering:pixelated }
  .note { margin-top:16px; max-width:640px; line-height:1.5 }
`;

const PAGE_SCRIPT = `
  const $ = (id) => document.getElementById(id);
  let frame = 0, playing = true;

  function slotHtml(slot, anim, scale, crop) {
    const uri = anim.frames[frame % anim.frames.length];
    return '<div class="slot" style="left:' + slot.x + 'px;top:' + slot.y +
      'px;width:' + slot.width + 'px;height:' + slot.height + 'px">' +
      '<img src="' + uri + '" style="width:' + slot.width +
      'px;margin-top:-' + crop * scale + 'px"></div>';
  }

  function render() {
    const orientation = $('orientation').value;
    const layout = $('layout').value;
    const zoom = Number($('zoom').value);
    const showBands = $('bands').checked;
    const size = DATA.sizes[orientation];
    const bands = DATA.bands[orientation];
    const slots = DATA.slots[orientation][layout];
    const scale = DATA.scales[layout];
    const crop = orientation === 'landscape' ? DATA.cropUnits : 0;
    const chosen = [$('slot0').value, $('slot1').value]
      .map((name) => ANIMATIONS.find((a) => a.name === name) ?? ANIMATIONS[0]);

    // Bands are drawn as empty outlines and nothing else. They used to carry
    // a clock, session minis and a message, all composed here in browser CSS —
    // a second panel renderer that could and did disagree with the real one.
    // What is left is panelBands() geometry, which comes from the renderer, so
    // it cannot diverge from it. For band *contents* see tools/panel-mock.ts,
    // which composes through the renderer itself.
    const band = (name) => {
      const r = bands[name];
      return '<div class="band' + (showBands ? ' showing' : '') +
        '" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.width +
        'px;height:' + r.height + 'px"></div>';
    };
    const panel =
      '<div class="panel" style="width:' + size.width + 'px;height:' +
      size.height + 'px">' +
      band('status') + band('stage') +
      slots.map((s, i) => slotHtml(s, chosen[i] ?? chosen[0], scale, crop)).join('') +
      band('strip') + band('message') +
      '</div>';

    $('true').innerHTML = panel;
    $('zoomed').innerHTML = panel;
    $('zoomed').firstChild.style.transform = 'scale(' + zoom + ')';
    $('zoomed').firstChild.style.transformOrigin = 'top left';
    $('zoomed').style.width = size.width * zoom + 'px';
    $('zoomed').style.height = size.height * zoom + 'px';
    const shown = frame % (chosen[0]?.frames.length ?? 1);
    $('frameNo').textContent = 'frame ' + shown;
    $('seek').max = String((chosen[0]?.frames.length ?? 1) - 1);
    // A range input keeps focus after a drag, so guarding on focus alone
    // froze the slider at a stale value the moment playback resumed.
    if (playing || document.activeElement !== $('seek')) {
      $('seek').value = String(shown);
    }
  }

  for (const id of ['orientation','layout','zoom','slot0','slot1','bands']) {
    $(id).addEventListener('input', render);
  }
  $('play').addEventListener('click', () => {
    playing = !playing;
    $('play').textContent = playing ? 'pause' : 'play';
  });
  $('seek').addEventListener('input', () => {
    playing = false;
    $('play').textContent = 'play';
    frame = Number($('seek').value);
    render();
  });
  setInterval(() => { if (playing) { frame += 1; render(); } }, 125);
  render();
`;

function optionList(names: readonly string[], selected: string): string {
  return names
    .map(
      (name) =>
        `<option${name === selected ? ' selected' : ''}>${name}</option>`,
    )
    .join('');
}

function controls(animations: readonly Animation[]): string {
  const names = animations.map((a) => a.name);
  return `
    <div class="controls">
      <label>orientation <select id="orientation">${optionList(ORIENTATIONS, 'portrait')}</select></label>
      <label>layout <select id="layout">${optionList(STAGE_LAYOUTS, 'hero')}</select></label>
      <label>slot 1 <select id="slot0">${optionList(names, names[0] ?? '')}</select></label>
      <label>slot 2 <select id="slot1">${optionList(names, names[1] ?? names[0] ?? '')}</select></label>
      <label>zoom <select id="zoom">${optionList(['1', '2', '3', '4'], '2')}</select></label>
      <label><input type="checkbox" id="bands"> show bands</label>
      <button id="play">pause</button>
      <label>frame <input type="range" id="seek" min="0" max="7" value="0"></label>
      <span id="frameNo"></span>
    </div>`;
}

async function build(frameDirs: readonly string[], outPath: string) {
  const animations = await Promise.all(
    frameDirs.map((dir) => loadAnimation(resolve(dir))),
  );
  const page = `<!doctype html>
<meta charset="utf-8">
<title>Tamaclaude harness</title>
<style>${PAGE_STYLE}</style>
<h1>Tamaclaude &mdash; panel harness</h1>
${controls(animations)}
<div class="stage">
  <div><div>1:1 pixels &mdash; not physical size, see note</div><div id="true"></div></div>
  <div><div>zoomed</div><div id="zoomed"></div></div>
</div>
<p class="note">
  A sprite scrubber, driven by rendered frames rather than by Claude Code
  &mdash; injecting synthetic events is a separate Stage 1 line. Band
  geometry, sprite slots, scales and the landscape crop all come from
  <code>@tamaclaude/renderer</code>.
  <strong>The bands are empty outlines on purpose.</strong> This page used to
  compose their contents itself &mdash; a clock, session minis, a message
  &mdash; which made it a second panel renderer that could disagree with the
  real one, and did. For band contents see <code>tools/panel-mock.ts</code>,
  which composes through <code>render()</code>, so what it shows is what the
  device shows. Judge sprite scale and placement here; judge anything drawn
  <em>into</em> a band there.
</p>
<script>
  const ANIMATIONS = ${JSON.stringify(animations)};
  const DATA = ${JSON.stringify(layoutData())};
${PAGE_SCRIPT}
</script>`;
  await mkdir(resolve(outPath, '..'), { recursive: true });
  await writeFile(outPath, page, 'utf8');
  return page.length;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node tools/harness.ts <frameDir>...');
  process.exit(1);
}
const out = resolve('out/harness.html');
const bytes = await build(dirs, out);
console.log(
  `harness -> ${out} (${Math.round(bytes / 1024)} KB, self-contained)`,
);
