#!/usr/bin/env node
/**
 * Build the dev harness: an interactive panel you can actually look at.
 *
 * `tools/panel-mock.ts` renders a fixed comparison image, which is the right
 * artefact for a pull request and the wrong one for judging motion. The
 * harness animates, and lets the layout questions the screen spec leaves open
 * be answered by switching between candidates while watching the same frames —
 * hero against two-up, portrait against landscape, and whether the message and
 * strip bands earn their height.
 *
 * **What it draws is not what the panel draws, and that is a known gap rather
 * than a design.** See the note below on Stage 2's exit.
 *
 *   pnpm harness && open out/harness.html
 *
 * Output is a single self-contained file: every frame is inlined, so it can be
 * opened from disk with no server and no network. Geometry, slots, scales and
 * the landscape crop come from `@tamaclaude/renderer` rather than constants
 * copied here, so those cannot drift.
 *
 * **Text layout within a band is this page's approximation, and the gap is now
 * the other way round from what this comment used to say.** It claimed "the
 * renderer draws none of it yet". The renderer draws all of it — the status
 * band, the clock, the session chips, the subagent badge and the message band.
 * The 21 Aug hardware record names the clock, the chips and the message band;
 * the badge is wired and was not in that session — while this page still
 * reimplements the
 * layout in browser JavaScript. So the two agree by inspection, which is
 * exactly what Stage 2's exit criterion ("browser and panel show the same
 * thing") is written to rule out, and the gap has widened rather than closed:
 * the panel draws 2x bitmap status text that no browser view renders at all.
 * `tools/blit-scene.ts` says the same thing from the other side.
 *
 * So judge band heights and sprite scale here; do not judge glyph positioning
 * here, because it is not the glyph positioning the device performs.
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
  /* The panel renders in the typeface the panel will actually use. Judging
     whether the message and strip bands earn their height is one of the two
     reasons this tool exists, and that judgement is worthless in a different
     font — the browser default is both narrower and differently proportioned
     than Departure Mono at 13px. */
  .panel { font-family:'Departure Mono', ui-monospace, monospace }
  h1 { color:#c9d1d9; font-size:14px; font-weight:400; margin:0 0 14px }
  .controls { display:flex; gap:18px; flex-wrap:wrap; align-items:center;
              margin-bottom:18px; padding:10px 12px; background:#0d1117;
              border:1px solid #21262d; border-radius:6px }
  label { display:flex; gap:6px; align-items:center; color:#c9d1d9 }
  select,button { background:#161b22; color:#c9d1d9; border:1px solid #30363d;
                  border-radius:4px; padding:3px 7px; font:inherit }
  button { cursor:pointer }
  .stage { display:flex; gap:36px; align-items:flex-start }
  .panel { position:relative; background:#0d1117; overflow:hidden;
           image-rendering:pixelated; outline:1px solid #30363d }
  .band { position:absolute }
  .band.showing { outline:1px dashed #f7836333 }
  .slot { position:absolute; overflow:hidden }
  .slot img { display:block; image-rendering:pixelated }
  .status { display:flex; align-items:center; justify-content:space-between;
            padding:0 6px; box-sizing:border-box; color:#c9d1d9 }
  .strip { display:flex; align-items:center; gap:6px; padding:0 8px;
           box-sizing:border-box }
  .strip img { image-rendering:pixelated }
  /* min-width:0 and overflow-wrap:anywhere are load-bearing. A flex item
     defaults to min-width:auto and an underscore is not a wrap
     opportunity, so a long
     MCP tool name rendered as one 207px line inside a 172px panel and was
     clipped by .panel{overflow:hidden} with no marker — five characters gone,
     while the band looked like one short line in a large box. That is exactly
     the evidence the 24 Aug session needs to judge this band's height, and
     hiding it argued for shrinking the band. */
  .message { display:flex; align-items:flex-start; padding:4px 8px;
             box-sizing:border-box; color:#c9d1d9; min-width:0 }
  .message span { min-width:0; overflow-wrap:anywhere }
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

  // The candidate fix for a long tool name, shown beside the problem.
  function labelFor(raw) {
    if ($('label').value !== 'strip mcp prefix') return raw;
    return raw.startsWith('mcp__') ? raw.split('__').slice(2).join('__') : raw;
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

    const band = (name, cls, inner) => {
      const r = bands[name];
      return '<div class="band ' + cls + (showBands ? ' showing' : '') +
        '" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.width +
        'px;height:' + r.height + 'px">' + inner + '</div>';
    };
    // The spec allows up to 5 minis before an overflow badge, so 3 + "+2"
    // was a state that cannot occur. Session count is a control now, which
    // also makes the strip's worst case — five minis plus a badge — viewable.
    const sessions = Number($('sessions').value);
    const overflow = sessions > 5
      ? '<span style="margin-left:auto">+' + (sessions - 5) + '</span>' : '';
    const mini = '<img src="' + MINI + '">';
    const panel =
      '<div class="panel" style="width:' + size.width + 'px;height:' +
      size.height + 'px">' +
      band('status','status','<span>14:32</span><span>&times;2</span>') +
      band('stage','','') +
      slots.map((s, i) => slotHtml(s, chosen[i] ?? chosen[0], scale, crop)).join('') +
      band('strip','strip', mini.repeat(Math.min(sessions, 5)) + overflow) +
      band('message','message','<span>' + labelFor($('message').value) + '</span>') +
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

  for (const id of ['orientation','layout','zoom','slot0','slot1','message','bands','label','sessions']) {
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
      <label>message <select id="message">${optionList(['Grep', 'Bash', 'mcp__linear__create_issue', ''], 'Grep')}</select></label>
      <label>label <select id="label">${optionList(['full', 'strip mcp prefix'], 'full')}</select></label>
      <label>sessions <select id="sessions">${optionList(['1', '2', '3', '5', '7'], '3')}</select></label>
      <label>zoom <select id="zoom">${optionList(['1', '2', '3', '4'], '2')}</select></label>
      <label><input type="checkbox" id="bands"> show bands</label>
      <button id="play">pause</button>
      <label>frame <input type="range" id="seek" min="0" max="7" value="0"></label>
      <span id="frameNo"></span>
    </div>`;
}

/** Mini-Clawd size, read from the base geometry rather than copied from it. */
function miniSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const parts =
    viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const [, , width, height] = parts;
  if (parts.length !== 4 || !(width > 0) || !(height > 0)) {
    throw new Error(`bad viewBox in assets/clawd/base.svg: "${viewBox}"`);
  }
  return { width, height };
}

async function build(frameDirs: readonly string[], outPath: string) {
  const animations = await Promise.all(
    frameDirs.map((dir) => loadAnimation(resolve(dir))),
  );
  const mini = await readFile('assets/clawd/base.svg');
  const font = await readFile('assets/fonts/DepartureMono-Regular.woff2');
  const size = miniSize(mini.toString('utf8'));
  const page = `<!doctype html>
<meta charset="utf-8">
<title>Tamaclaude harness</title>
<style>
@font-face {
  font-family: 'Departure Mono';
  src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
}
.strip img { width:${size.width}px; height:${size.height}px }
${PAGE_STYLE}</style>
<h1>Tamaclaude &mdash; panel harness</h1>
${controls(animations)}
<div class="stage">
  <div><div>1:1 pixels &mdash; not physical size, see note</div><div id="true"></div></div>
  <div><div>zoomed</div><div id="zoomed"></div></div>
</div>
<p class="note">
  Driven by rendered frames, not by Claude Code &mdash; injecting synthetic
  events is a separate Stage 1 line. Band geometry, sprite slots, scales and
  the landscape crop all come from <code>@tamaclaude/renderer</code>, and the
  panel text renders in Departure Mono, the typeface the panel will use.
  What is <em>not</em> what gets built: <strong>this page draws the bands
  itself</strong>. The renderer draws all of them &mdash; and draws 2&times;
  bitmap status text no browser view renders at all &mdash; so the two agree
  only by inspection, which is what Stage 2's exit criterion exists to rule
  out. Judge band heights and sprite scale here; do not judge glyph
  positioning here, because it is not the positioning the device performs.
  <code>mcp__linear__create_issue</code> is included because a long MCP tool
  name is the case the message band has to survive.
</p>
<script>
  const ANIMATIONS = ${JSON.stringify(animations)};
  const MINI = ${JSON.stringify(`data:image/svg+xml;base64,${mini.toString('base64')}`)};
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
