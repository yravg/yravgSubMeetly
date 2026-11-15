/* Kasi's animated sticker pack, built from the renderer so the stickers never drift from it.
   Run from the repo root: node site/brand/stickers/build.cjs
   Writes eight kasi-*.svg files and the sticker sheet (index.html) next to this script.

   Every sticker is one self-contained SVG animated with SMIL only (no script, no external
   files), so it plays in a browser tab and inside an <img>. A loop is made of:
   - frames: whole Kasi.svg drawings (lids, yaw, back) switched with discrete visibility;
   - parts: smooth SMIL on the classed groups kasi.js emits (kasi-ear-l/-r rotate about the
     ear base, kasi-look translates the pupils, the pupil ellipse dilates);
   - moves: translate / rotate / scale on a wrapper around the whole figure (hop, sway, breath).
   Motion follows the brand sheet: blink 120 ms, ear twitch up to ±7°, 900 ms head turn. */
const fs = require('fs'), path = require('path');
require(path.join(__dirname, '..', '..', 'kasi.js'));
const K = globalThis.Kasi, C = K.colors;

const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const num = (v) => (Array.isArray(v) ? v.map(r2).join(' ') : String(r2(v)));
// Easing INTO a key. keySplines y values must stay in 0..1, so overshoot is written as extra keys.
const EASE = { io: '.45 0 .55 1', out: '.2 .8 .3 1', in: '.6 0 .8 .4', lin: '0 0 1 1' };
const GAZE = 3.4; // kasi.js: gaze 1 moves the pupils 3.4 units

/* ---------- SMIL ---------- */
// keys: [[seconds, value, ease?], ...]; the loop is closed by holding the first/last value.
function keyed(keys, dur, fmt = num) {
  const k = keys.map((x) => x.slice()).sort((a, b) => a[0] - b[0]);
  if (k[0][0] > 0) k.unshift([0, k[0][1]]);
  if (k[k.length - 1][0] < dur) k.push([dur, k[k.length - 1][1]]);
  return {
    values: k.map((x) => fmt(x[1])).join(';'),
    keyTimes: k.map((x) => r4(x[0] / dur)).join(';'),
    keySplines: k.slice(1).map((x) => EASE[x[2] || 'io']).join(';')
  };
}
const loop = (dur) => `dur="${dur}s" repeatCount="indefinite"`;
function tween(attr, keys, dur, fmt) {
  const t = keyed(keys, dur, fmt);
  return `<animate attributeName="${attr}" values="${t.values}" keyTimes="${t.keyTimes}" calcMode="spline" keySplines="${t.keySplines}" ${loop(dur)}/>`;
}
function turn(type, keys, dur) {
  const t = keyed(keys, dur);
  return `<animateTransform attributeName="transform" type="${type}" values="${t.values}" keyTimes="${t.keyTimes}" calcMode="spline" keySplines="${t.keySplines}" ${loop(dur)}/>`;
}
// Holds each value from its key until the next one.
function steps(attr, keys, dur) {
  return `<animate attributeName="${attr}" values="${keys.map((x) => x[1]).join(';')}" keyTimes="${keys.map((x) => r4(x[0] / dur)).join(';')}" calcMode="discrete" ${loop(dur)}/>`;
}

/* ---------- Kasi parts ---------- */
const strip = (svg) => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');

function parts(s, p, dur) {
  if (p.pupil) {
    s = s.replace(/(<g class="kasi-look"[^>]*>)<ellipse cx="([-\d.]+)" cy="([-\d.]+)" rx="([-\d.]+)" ry="([-\d.]+)" fill="([^"]+)"\/>/g,
      (m, open, cx, cy, rx, ry, fill) => `${open}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}">` +
        tween('rx', p.pupil.map(([t, k, e]) => [t, +rx * k, e]), dur) +
        tween('ry', p.pupil.map(([t, k, e]) => [t, +ry * k, e]), dur) + '</ellipse>');
  }
  // kasi.js moves the pupils with an inline CSS transform, which would override SMIL: replace it.
  s = s.replace(/<g class="kasi-look" style="transform:translate\(([-\d.]+)px,([-\d.]+)px\)">/g, (m, x, y) => p.gaze
    ? `<g class="kasi-look">${turn('translate', p.gaze.map(([t, g, e]) => [t, [g[0] * GAZE, g[1] * GAZE], e]), dur)}`
    : `<g class="kasi-look" transform="translate(${x} ${y})">`);
  // The classed ear group sits inside the ear's placement group, so its origin is the ear base.
  for (const side of ['l', 'r']) {
    if (p.ear && p.ear[side]) s = s.split(`<g class="kasi-ear kasi-ear-${side}">`).join(`<g class="kasi-ear kasi-ear-${side}">${turn('rotate', p.ear[side], dur)}`);
  }
  return s;
}
const mirror = (keys) => keys.map(([t, v, e]) => [t, -v, e]);

// frames: Kasi.svg options; timeline: [[seconds, frameIndex], ...] from 0. One frame shows at a time.
function figure(slug, frames, timeline, p, dur) {
  return frames.map((o, i) => {
    const inner = parts(strip(K.svg(Object.assign({}, o, { uid: `ks-${slug}-${i}`, title: '' }))), p, dur);
    if (frames.length === 1) return inner;
    const vis = [];
    for (const [t, j] of timeline) {
      const v = j === i ? 'visible' : 'hidden';
      if (!vis.length || vis[vis.length - 1][1] !== v) vis.push([t, v]);
    }
    return `<g visibility="${vis[0][1]}">${vis.length > 1 ? steps('visibility', vis, dur) : ''}${inner}</g>`;
  }).join('');
}

// moves, outermost first: {translate: keys of [x,y]} | {rotate: keys of deg, at} | {scale: keys of [sx,sy], at}
function wrap(content, moves, dur) {
  for (const m of moves.slice().reverse()) {
    if (m.translate) content = `<g>${turn('translate', m.translate, dur)}${content}</g>`;
    if (m.rotate) content = `<g>${turn('rotate', m.rotate.map(([t, a, e]) => [t, [a, m.at[0], m.at[1]], e]), dur)}${content}</g>`;
    if (m.scale) content = `<g transform="translate(${m.at[0]} ${m.at[1]})"><g>${turn('scale', m.scale, dur)}` +
      `<g transform="translate(${-m.at[0]} ${-m.at[1]})">${content}</g></g></g>`;
  }
  return content;
}

/* ---------- the canvas ---------- */
const SIZE = 256, MARGIN = 12;
const HEAD_SCALE = 0.93; // same head size on every head-only sticker so the pack reads as one set

// bounds: what the sticker draws in Kasi space, motion included: [x, y, w, h]. It is centred on the canvas.
function sticker(d) {
  const [bx, by, bw, bh] = d.bounds;
  const fit = Math.min((SIZE - 2 * MARGIN) / bw, (SIZE - 2 * MARGIN) / bh);
  const s = Math.min(fit, d.scale || fit);
  const tx = SIZE / 2 - (bx + bw / 2) * s, ty = SIZE / 2 - (by + bh / 2) * s;
  const fig = wrap(figure(d.slug, d.frames, d.timeline || [[0, 0]], d.parts || {}, d.dur), d.moves || [], d.dur);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="512" height="512" role="img" aria-label="${d.alt}">` +
    `<!-- Generated by site/brand/stickers/build.cjs from site/kasi.js. Do not edit by hand. -->` +
    `<title>${d.alt}</title><g transform="translate(${r2(tx)} ${r2(ty)}) scale(${r4(s)})">${d.under || ''}${fig}</g></svg>\n`;
}

// A caption line in subtitle yellow (the product's captions, never Kasi's own words).
const line = (x1, x2, y, anim = '') => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.accent}" stroke-width="7" stroke-linecap="round">${anim}</line>`;

/* ---------- the eight stickers ---------- */
const lids = (o, list) => list.map((l) => Object.assign({}, o, { lids: l }));
// Resting values come from the pose presets, so a change to a pose in kasi.js carries into its sticker.
const rest = (pose, key, fallback) => (K.POSES[pose] && K.POSES[pose][key] !== undefined ? K.POSES[pose][key] : fallback);
const blinkAt = (t, open = 0, half = 1, shut = 2) => [[t, half], [t + 0.03, shut], [t + 0.09, half], [t + 0.12, open]]; // 120 ms

const STICKERS = [];

// 1. Listening: captions start. Pupils widen as sound arrives, each ear twitches toward it.
STICKERS.push({
  slug: 'listening', name: 'Listening', moment: 'Captions start: a call or video begins and Kasi hears it.',
  alt: 'Kasi listening: ears twitch, pupils widen', dur: 3.2, scale: HEAD_SCALE, bounds: [-124, -128, 248, 202],
  frames: [{ pose: 'listen', pupil: 1, gaze: [0, 0] }],
  parts: {
    pupil: [[0, 0.86], [0.25, 0.86], [0.6, 1.08, 'out'], [2.3, 1.05], [3.05, 0.86]],
    gaze: [[0, [0, 0]], [0.8, [0, 0]], [1.0, [0.6, -0.1], 'out'], [2.1, [0.6, -0.1]], [2.45, [0, 0]]],
    ear: {
      l: [[0.25, 0], [0.33, -7, 'out'], [0.45, 2], [0.56, 0], [1.9, 0], [1.98, -5, 'out'], [2.1, 1.5], [2.2, 0]],
      r: [[0.85, 0], [0.93, 7, 'out'], [1.05, -2], [1.16, 0], [2.6, 0], [2.68, 6, 'out'], [2.8, -1.5], [2.9, 0]]
    }
  },
  moves: [{ rotate: [[0, 0], [0.85, 0], [1.1, 4, 'out'], [2.1, 4], [2.45, 0]], at: [0, 40] }]
});

// 2. Idle: the pill is open and waiting. One 120 ms blink per loop, a glance, an ear flick.
STICKERS.push({
  slug: 'idle', name: 'Idle', moment: 'Ready: the pill is open and waiting for sound.',
  alt: 'Kasi waiting and blinking', dur: 4, scale: HEAD_SCALE, bounds: [-124, -130, 248, 202],
  frames: lids({ pose: 'head', gaze: [0, 0] }, [0, 0.55, 1]),
  timeline: [[0, 0], ...blinkAt(3.0)],
  parts: {
    gaze: [[0, [0, 0]], [1.0, [0, 0]], [1.25, [0.75, 0.15], 'out'], [2.3, [0.75, 0.15]], [2.55, [-0.25, 0], 'io'], [3.4, [-0.25, 0]], [3.7, [0, 0]]],
    ear: {
      r: [[1.25, 0], [1.33, 6, 'out'], [1.45, -1.5], [1.55, 0]],
      l: [[3.45, 0], [3.53, -5, 'out'], [3.65, 1], [3.75, 0]]
    }
  },
  moves: [{ translate: [[0, [0, 0]], [2, [0, -2]], [4, [0, 0]]] }]
});

// 3. Translating: the signature move on each translated line, as main.js swivel() plays it:
// 900 ms, front -> 3/4 -> back -> 3/4 -> front. The caption line changes while Kasi's back is turned.
const SRC = [[-69, -29], [-14, 8], [23, 69]], TGT = [[-69, -43], [-28, 22], [37, 69]];
const swap = (i, end) => [[0, SRC[i][end]], [1.3, SRC[i][end]], [1.6, TGT[i][end], 'io'], [2.85, TGT[i][end]], [2.9, SRC[i][end], 'lin']];
STICKERS.push({
  slug: 'translating', name: 'Translating', moment: 'Each translated line: the 180° head turn.',
  alt: 'Kasi turning its head all the way round', dur: 3, scale: HEAD_SCALE, bounds: [-126, -126, 252, 226],
  frames: [{}, { yaw: 0.32 }, { yaw: 0.64 }, { yaw: 0.95 }, { back: true }, { yaw: -0.95 }, { yaw: -0.64 }, { yaw: -0.32 }, { lids: 0.55 }, { lids: 1 }],
  timeline: [[0, 0], ...blinkAt(0.4, 0, 8, 9), [1.0, 1], [1.09, 2], [1.18, 3], [1.27, 4], [1.63, 5], [1.72, 6], [1.81, 7], [1.9, 0]],
  parts: {
    ear: {
      l: [[1.9, 0], [1.98, -6, 'out'], [2.12, 2], [2.24, 0]],
      r: [[1.9, 0], [1.98, 6, 'out'], [2.12, -2], [2.24, 0]]
    }
  },
  under: `<g>${tween('opacity', [[0, 0], [0.15, 1, 'out'], [2.55, 1], [2.8, 0, 'in']], 3)}` +
    `${turn('translate', [[0, [0, 6]], [0.15, [0, 0], 'out'], [2.55, [0, 0]], [2.8, [0, -6], 'in']], 3)}` +
    SRC.map((s, i) => line(s[0], s[1], 90, tween('x1', swap(i, 0), 3) + tween('x2', swap(i, 1), 3))).join('') + '</g>'
});

// 4. Writing: live captions. Pencil behind the ear, eyes follow each line as it is written left to right.
const L1 = [-62, 62], L2 = [-62, 22];
STICKERS.push({
  slug: 'writing', name: 'Writing', moment: 'Live captions: each line written as it is heard.',
  alt: 'Kasi reading a caption line as it is written', dur: 3.2, scale: HEAD_SCALE, bounds: [-124, -128, 248, 240],
  frames: lids({ pose: 'scribe', gaze: [0, 0] }, [0, 0.55, 1]),
  timeline: [[0, 0], ...blinkAt(1.46)],
  parts: {
    gaze: [[0, [-1.15, 0.7]], [0.2, [-1.15, 0.7]], [1.3, [1.15, 0.7], 'lin'], [1.45, [1.15, 0.7]], [1.6, [-1.15, 1.05], 'out'],
      [2.35, [0.3, 1.05], 'lin'], [2.8, [0.3, 1.05]], [3.1, [-1.15, 0.7]]],
    ear: {
      l: [[0.6, 0], [0.68, -4, 'out'], [0.8, 1], [0.9, 0]],
      r: [[2.4, 0], [2.48, 5, 'out'], [2.6, -1.5], [2.7, 0]]
    }
  },
  moves: [{ rotate: [[0, -3], [0.2, -3], [1.3, 3], [1.45, 3], [1.6, -3, 'out'], [2.35, 1], [2.8, 1], [3.1, -3]], at: [0, 40] }],
  under: line(L1[0], L1[0], 86, tween('x2', [[0, L1[0]], [0.2, L1[0]], [1.3, L1[1], 'lin'], [3.0, L1[1]], [3.05, L1[0], 'lin']], 3.2) +
      tween('opacity', [[0, 0], [0.15, 1], [2.8, 1], [3.0, 0]], 3.2)) +
    line(L2[0], L2[0], 102, tween('x2', [[0, L2[0]], [1.6, L2[0]], [2.35, L2[1], 'lin'], [3.0, L2[1]], [3.05, L2[0], 'lin']], 3.2) +
      tween('opacity', [[0, 0], [1.55, 0], [1.65, 1], [2.8, 1], [3.0, 0]], 3.2))
});

// 5. Thinking: drafting the minutes. Looks up and away, one slow blink, then considers the other side.
const TG = rest('think', 'gaze', [-0.85, -1]), TL = rest('think', 'lids', 0);
STICKERS.push({
  slug: 'thinking', name: 'Thinking', moment: 'Drafting minutes after the call.',
  alt: 'Kasi looking up, thinking, with a slow blink', dur: 4, scale: HEAD_SCALE, bounds: [-124, -121, 248, 214],
  frames: lids({ pose: 'think', gaze: [0, 0] }, [TL, Math.max(TL, 0.4), 0.75, 1]),
  timeline: [[0, 0], [1.2, 1], [1.3, 2], [1.4, 3], [1.55, 2], [1.65, 1], [1.75, 0]],
  parts: {
    gaze: [[0, TG], [2.0, TG], [2.3, [0.6, TG[1]]], [3.3, [0.6, TG[1]]], [3.65, TG]],
    ear: {
      l: [[2.0, 0], [2.35, -5], [3.3, -5], [3.7, 0]],
      r: [[0.5, 0], [0.58, 4, 'out'], [0.7, -1], [0.8, 0]]
    }
  },
  moves: [{ rotate: [[0, 0], [2.0, 0], [2.35, 9], [3.3, 9], [3.7, 0]], at: [0, 40] }]
});

// 6. Got it: the minutes are ready. Happy eyes, a hop with squash and stretch, ears follow through.
const EAR_HOP = [[0.14, 0], [0.3, 7], [0.46, -4], [0.62, 7], [0.78, -3], [0.92, 0], [1.24, 4], [1.4, -2], [1.52, 0]];
STICKERS.push({
  slug: 'got-it', name: 'Got it', moment: 'Minutes ready: decisions and actions drafted.',
  alt: 'Kasi happy, with a small hop', dur: 2.4, scale: HEAD_SCALE, bounds: [-124, -148, 248, 214],
  frames: [{ pose: 'happy' }],
  parts: { ear: { r: EAR_HOP, l: mirror(EAR_HOP) } },
  moves: [
    { translate: [[0, [0, 0]], [0.14, [0, 0]], [0.36, [0, -20], 'out'], [0.58, [0, 0], 'in'], [1.1, [0, 0]], [1.24, [0, -8], 'out'], [1.38, [0, 0], 'in']] },
    {
      scale: [[0, [1, 1]], [0.1, [1.06, 0.93]], [0.2, [0.95, 1.06], 'out'], [0.4, [1, 1]], [0.58, [1, 1]], [0.64, [1.07, 0.92], 'out'],
        [0.78, [0.98, 1.02]], [0.9, [1, 1]], [1.1, [1, 1]], [1.16, [1.03, 0.97]], [1.24, [0.99, 1.01]], [1.38, [1, 1]], [1.43, [1.04, 0.96], 'out'], [1.55, [1, 1]]],
      at: [0, 61]
    }
  ]
});

// 7. Dozing: nothing is playing. Slow breaths, the lids droop, the head sinks, then it catches itself.
STICKERS.push({
  slug: 'dozing', name: 'Dozing', moment: 'Resting: nothing is playing.',
  alt: 'Kasi dozing, lids drooping', dur: 4, scale: HEAD_SCALE, bounds: [-124, -115, 248, 202],
  frames: lids({ pose: 'doze' }, ((l) => [0, 1, 2, 3, 4, 5].map((i) => l + (0.96 - l) * i / 5))(rest('doze', 'lids', 0.62))),
  timeline: [[0, 0], [0.9, 1], [1.4, 2], [1.9, 3], [2.4, 4], [2.9, 5], [3.45, 2], [3.5, 0]],
  parts: { ear: { l: [[0, 0], [3.4, -7], [3.6, 0, 'out']], r: [[0, 0], [3.4, 7], [3.6, 0, 'out']] } },
  moves: [
    { translate: [[0, [0, 0]], [3.4, [0, 5]], [3.6, [0, 0], 'out']] },
    { rotate: [[0, 0], [3.4, -4], [3.6, 0, 'out']], at: [0, 50] },
    { scale: [[0, [1, 1]], [1, [1.025, 1.035]], [2, [1, 1]], [3, [1.025, 1.035]], [4, [1, 1]]], at: [0, 61] }
  ]
});

// 8. Hush: paused or private. Hands over the ears, eyes squeezed, a small shiver twice a loop.
const shiver = (t) => [[t, [0, 0]], [t + 0.05, [2.6, 0], 'lin'], [t + 0.1, [-2.6, 0], 'lin'], [t + 0.15, [2.4, 0], 'lin'], [t + 0.2, [-2.2, 0], 'lin'],
  [t + 0.25, [1.8, 0], 'lin'], [t + 0.3, [-1.4, 0], 'lin'], [t + 0.35, [0.8, 0], 'lin'], [t + 0.4, [0, 0], 'lin']];
const hunch = (t) => [[t, [1, 1]], [t + 0.12, [1.012, 0.982], 'out'], [t + 0.45, [1.012, 0.982]], [t + 0.65, [1, 1]]];
STICKERS.push({
  slug: 'hush', name: 'Hush', moment: 'Paused or private: nothing leaves your computer.',
  alt: 'Kasi covering its ears, shivering', dur: 2.4, bounds: [-106, -100, 226, 280],
  frames: [{ pose: 'hush' }],
  moves: [
    { translate: [...shiver(0.2), ...shiver(1.3)] },
    { scale: [[0, [1, 1]], ...hunch(0.15), ...hunch(1.25)], at: [0, 175] }
  ]
});

/* ---------- write ---------- */
const kb = (n) => (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
const made = [];
for (const d of STICKERS) {
  const file = `kasi-${d.slug}.svg`, svg = sticker(d);
  fs.writeFileSync(path.join(__dirname, file), svg);
  const bytes = Buffer.byteLength(svg);
  if (bytes > 60 * 1024) throw new Error(`${file} is ${kb(bytes)}, over the 60 KB budget`);
  made.push(Object.assign({ file, bytes }, d));
  console.log('wrote', file, kb(bytes));
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const card = (d) => `    <article class="sk-card">
      <div class="sk-pair">
        <div class="sk-pad dark"><img src="${d.file}" width="512" height="512" alt="${esc(d.alt)}"></div>
        <div class="sk-pad light"><img src="${d.file}" width="512" height="512" alt=""></div>
      </div>
      <div class="sk-meta"><b>${esc(d.name)}</b><span>${esc(d.moment)}</span></div>
      <a class="sk-file" href="${d.file}" download>${d.file} · ${kb(d.bytes)} · loops every ${d.dur} s</a>
    </article>`;

const html = `<!doctype html>
<!-- Generated by site/brand/stickers/build.cjs. Edit the labels there and rebuild. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kasi stickers</title>
<meta name="theme-color" content="#0C0B09">
<link rel="icon" href="../../assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700;800;900&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../style.css">
<style>
  body { padding: 0 0 80px; }
  .sk { width: min(var(--wrap), 100% - 32px); margin: 0 auto; }
  .sk-head { padding: 64px 0 32px; display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
  .sk-head img { width: 104px; height: 104px; flex: none; }
  .sk-head h1 { font: 900 clamp(2.4rem, 6vw, 4.4rem)/1 var(--display); letter-spacing: -0.04em; }
  .sk-head p { color: var(--text-2); max-width: 62ch; margin-top: 12px; }
  .sk-head a { color: var(--yellow); }
  .sk-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
  .sk-card { background: var(--bg-2); border-radius: var(--r-lg); box-shadow: inset 0 0 0 1px var(--line); padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .sk-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .sk-pad { border-radius: var(--r-md); aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; }
  .sk-pad.dark { background: #0C0B09; box-shadow: inset 0 0 0 1px var(--line); }
  .sk-pad.light { background: #F4EFE6; }
  .sk-pad img { width: 100%; height: auto; display: block; }
  .sk-meta { display: flex; flex-direction: column; gap: 4px; padding: 0 4px; }
  .sk-meta b { color: var(--text); font: 700 1.1rem/1.2 var(--display); letter-spacing: -0.01em; }
  .sk-meta span { color: var(--text-2); font-size: .95rem; line-height: 1.4; }
  .sk-file { color: var(--text-3); font-size: .82rem; padding: 0 4px; text-decoration: none; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .sk-file:hover { color: var(--text); text-decoration: underline; }
  .sk-notes { margin-top: 40px; color: var(--text-3); font-size: .92rem; max-width: 72ch; }
  .sk-notes code { color: var(--text-2); }
</style>
</head>
<body>
<main class="sk">
  <header class="sk-head">
    <img src="kasi-got-it.svg" width="512" height="512" alt="">
    <div>
      <h1>Kasi stickers</h1>
      <p>Eight animated stickers, one for each moment Kasi has in the product. Each one is a single SVG that loops on its own, in a browser or an <code>&lt;img&gt;</code>, with no script. Shown here on the night ground and on paper. Back to the <a href="../">brand sheet</a>.</p>
    </div>
  </header>
  <div class="sk-grid">
${made.map(card).join('\n')}
  </div>
  <p class="sk-notes">Built from <code>site/kasi.js</code> by <code>node site/brand/stickers/build.cjs</code>, so a change to Kasi's drawing reaches every sticker on the next build. Motion follows the brand sheet: a blink takes 120 ms, ears twitch up to 7°, the head turn takes 900 ms. Kasi never talks: the yellow lines are the captions it hears.</p>
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('wrote index.html');
