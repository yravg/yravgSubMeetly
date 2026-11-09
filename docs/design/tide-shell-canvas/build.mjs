// Tide shell canvas generator. Run: node build.mjs [--dc <root>]
//
// DESIGN DIRECTION (read before editing any board)
//  - Density and rhythm follow Oyenza's overview: 16 px body, big display numbers, one hero, one rail.
//  - One primary action per screen: the black ink pill. Brand green #22C55E is a FILL only (active nav,
//    bars, Tide, success). Text that must read green is green-ink #0E7A47 (dark #4ADE80).
//  - Surfaces are mint wash, radius 14 (cards) and 22 (hero). Fredoka only for display numbers and greeting.
//  - One mascot per screen; Tide never speaks; error states have no mascot.
//  - Oyenza is reference only: no name, cat, art or copy. Its frames stay in ref/ (gitignored).
//  - Data is synthetic sample data (series "Site B Safety Committee", chair James Miller), labelled sample.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_CSS, TIDE_CSS, NEW, esc, st, bt, paneCss, ixScript, ixDc } from './kit.mjs';
import * as B from './boards.mjs';
import { BOARDS, PRD } from './data.mjs';
import { MIN_CSS } from './minutes-boards.mjs';
import { PLAN_CSS } from './ask-plans-boards.mjs';
import { WIN_CSS } from './minutes-window-boards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = 1140 / 1440;
const GROUP_BOARD = { 'panel:captions': 'A02', 'panel:notes': 'A04', 'panel:history': 'A05', 'panel:helper': 'A07', 'panel:settings': 'A07', 'settings:engine': 'A07', 'settings:models': 'A07', 'settings:output': 'A07', 'settings:about': 'A07', 'settings:addins': 'A06', 'lab:pages': 'A08', 'lab:mock': 'A08', 'lab:guides': 'A08', 'lab:bar+panel': 'A08', minutes: 'A04', 'minutes:sample': 'A04' };
const ctl = JSON.parse(fs.readFileSync(path.join(here, 'shots/controls.json'), 'utf8')).controls;
const kept = {}; const allLabels = new Set();
for (const [g, arr] of Object.entries(ctl)) for (const l of arr) { allLabels.add(l); (kept[GROUP_BOARD[g]] ||= new Set()).add(l); }
const nice = (l) => l.split('|')[1].replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 44);

const keptStrip = (id) => {
  const s = kept[id]; if (!s) return '';
  const arr = [...s].filter((l) => nice(l).trim());
  return `<div class="kept"><div class="lbl">Controls kept from today (${arr.length})</div><div class="chips">${arr.map((l) => `<span>${esc(nice(l))}</span>`).join('')}</div></div>`;
};

const win = (html, h, nw) => (nw ? NEW : (x) => x)(`<div class="win" style="width:1140px;height:${Math.round(h * S)}px"><div class="scaler" style="width:1440px;height:${h}px;transform:scale(${S})">${html}</div></div>`);
const noteHtml = (n) => `<div class="note${n[3] ? ' pn' : ''}" style="left:${n[0]}px;top:${n[1]}px;width:290px">${n[2]}</div>`;

const toggle = (b) => {
  const ba = b.afterOnly ? '' : `<span class="vw">${bt('ba', 'before', 'Before', false)}${bt('ba', 'after', 'After', true)}</span>`;
  const sts = b.states ? `<span class="vw vs">${b.states.map(([k, l], i) => bt('st', k, l, i === 0)).join('')}</span>` : '';
  return `<div class="ixh">${ba}${sts}<span class="vt">sample data</span></div>`;
};

const win_html = (b) => Object.values(b.wins).map((w) => w.html).join('');
const noteH = (n) => Math.ceil(n[2].replace(/<[^>]+>/g, '').length / 40) * 16 + 16;
const boardHtml = (b) => {
  const keys = b.states ? b.states.map((s) => s[0]) : ['a'];
  const tagsIn = (h) => (h.match(/class="parttag"/g) || []).length;
  const pn = b.notes.filter((n) => n[3]).length;
  const gap = (b.stories.find((x) => x.stat === 'partial') || {}).gap || '';
  const gapHtml = gap.replace('Exists:', '<b>Exists:</b>').replace('Missing:', '<b>Missing:</b>');
  const baseBottom = Math.max(...b.notes.map((n) => n[1] + noteH(n)));
  // A note must never cover a card: per-state notes live inside their state pane (only the visible state shows its note);
  // stateless boards keep one always-visible note per PARTIAL tag. The first tagged state is served by the board's own gap note.
  const extraNote = (label, y) => [1160, y, `<b>${label}</b> ${gapHtml}`, true];
  const stateNotes = {}; const flat = []; let used = pn;
  if (b.states) keys.forEach((k) => { if (tagsIn(b.wins[k].html) > 0) { if (used > 0) used--; else stateNotes[k] = extraNote(b.states.find((s) => s[0] === k)[1] + ' view.', baseBottom + 12); } });
  else { const t = tagsIn(win_html(b)); for (let i = pn; i < t; i++) flat.push(extraNote('Same page.', baseBottom + 12 + (i - pn) * 120)); }
  const inner = keys.map((k) => b.states ? `<div data-p="st:${k}">${win(b.wins[k].html, b.wins[k].h, b.afterOnly)}${stateNotes[k] ? noteHtml(stateNotes[k]) : ''}</div>` : win(b.wins[k].html, b.wins[k].h, b.afterOnly)).join('');
  const after = b.afterOnly ? inner : `<div data-p="ba:after">${inner}</div>`;
  const colBottom = Math.max(...[...b.notes, ...flat, ...Object.values(stateNotes)].map((n) => n[1] + noteH(n))) + 8;
  const wh = Math.max(Math.max(...Object.values(b.wins).map((w) => w.h)) * S, colBottom);
  const before = b.afterOnly ? '' : `<div data-p="ba:before"><p class="ixcap"><span class="vt">BEFORE</span>${esc(b.before.cap)}</p><img class="ixi" src="${b.before.img}" alt="Before: ${esc(b.title)}"></div>`;
  const notes = [...b.notes, ...flat].map(noteHtml).join('');
  const stories = b.stories.map((s) => `<div class="st"><div class="sti"><span class="sid">${s.id}</span><span class="src">${s.src}</span><span class="stat ${s.stat}">${s.stat === 'new' ? 'NEW' : 'PARTIAL'}</span></div><div>${esc(s.text)}</div>${s.gap ? `<div class="gap">${esc(s.gap).replace('Exists:', '<b>Exists:</b>').replace('Missing:', '<b>Missing:</b>')}</div>` : ''}</div>`).join('');
  const refs = `<div class="refs"><div class="lbl">Reference: the original UI</div><p>${esc(b.refs.note)}</p>${b.refs.shots.length ? `<div class="rg">${b.refs.shots.map(([p, c]) => `<figure><img src="${p}" alt="Reference crop"><figcaption>${esc(c)}</figcaption></figure>`).join('')}</div>` : ''}</div>`;
  return `<section class="board" id="${b.id}">
<div class="hd"><div class="ey"><span class="tier">${b.id} · ${b.tier}</span><span>PRD ${PRD}</span></div><h2 class="ttl">${esc(b.title)}</h2><div class="ext"><b>Extends:</b> ${esc(b.ext)} &nbsp;·&nbsp; <b>Lives in:</b> ${esc(b.lives)}</div></div>
${toggle(b)}
<div style="position:relative;width:1140px;min-height:${Math.round(wh)}px"><div style="position:relative">${before}${after}</div><div style="position:absolute;left:0;top:0;width:0;height:0">${notes}</div></div>
${keptStrip(b.id)}
<div class="aside4">
<div class="card"><div class="lbl">What it must show</div><ul class="must">${b.must.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
<div class="card"><div class="lbl">Motion</div><div class="motion">${b.motion.map(([a, c]) => `<div class="m"><span>${esc(a)}</span><span>${esc(c)}</span></div>`).join('')}</div></div>
<div class="card"><div class="lbl">Stories</div>${stories}</div>
<div class="card"><div class="lbl">Where it lives</div><div class="where">${b.where.map((w) => `<div>${w}</div>`).join('')}</div></div>
</div>
${refs}
</section>`;
};

const total = BOARDS.length;
const cnt = (s) => BOARDS.flatMap((b) => b.stories).filter((x) => x.stat === s).length;
const idx = BOARDS.map((b) => `<a href="#${b.id}">${b.id} ${esc(b.title)}</a>`).join('');

const cover = `<section class="cover" id="cover"><div class="ey"><span class="tier">COVER</span><span>yravgSubMeetly · Tide app shell</span></div>
<h1>Tide app shell</h1>
<p>One app window in the Oyenza layout: sidebar, greeting hero, ask bar, key number, right rail, one black pill. Painted with yravg brand tokens, with Tide as the mascot. Every control of today's app.html lands on a board; lab tools move to a Developer area. All numbers on the boards are sample data.</p>
<div class="tiles"><div class="tile"><b>${total}</b>boards</div><div class="tile"><b>${B.contrastRows.length}</b>contrast rows measured</div><div class="tile"><b>${cnt('new')}</b>NEW rows</div><div class="tile"><b>${cnt('partial')}</b>PARTIAL rows</div></div>
<div class="tcards"><div class="tcard"><h3>FOUNDATION</h3>K01 tokens: colour, type, radius, motion, light and dark.</div><div class="tcard"><h3>APP SHELL</h3>A01 to A10: shell and Today, pages, Ask Tide, model and credits, Developer, states, Plans.</div><div class="tcard"><h3>BEFORE | AFTER</h3>Before is a real capture of today's UI. After is drawn here on the brand tokens.</div><div class="tcard"><h3>REFERENCE</h3>Oyenza frames are layout reference only; no name, art or copy is used.</div></div>
<div class="legend"><span class="lg lgn">NEW: does not exist yet</span><span class="lg lgp">PARTIAL: exists, needs change</span><span>Navy notes: what happens on click, hover or when something is missing</span></div></section>`;

const statusRows = BOARDS.map((b) => `<tr><td><a href="#${b.id}">${b.id}</a></td><td>${esc(b.title)}</td><td>${b.stories.map((s) => `<span class="spill ${s.stat}">${s.id} ${s.stat === 'new' ? 'NEW' : 'PARTIAL'}</span>`).join(' ')}</td><td>${(kept[b.id] || new Set()).size}</td></tr>`).join('');
const status = `<section class="status" id="status"><div class="ey"><span class="tier">STATUS</span></div><h2 class="ttl">Status and contrast</h2>
<table class="stt"><thead><tr><th>BOARD</th><th>TITLE</th><th>PRD ROWS</th><th>CONTROLS KEPT</th></tr></thead><tbody>${statusRows}</tbody></table>
<h3 style="margin:28px 0 10px">Contrast, measured with tastemaker-tokens contrast.mjs</h3>
<table class="stt"><thead><tr><th>PAIR</th><th>LIGHT</th><th>RATIO</th><th>DARK</th><th>RATIO</th></tr></thead><tbody>${B.contrastRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
const rowsAll = BOARDS.flatMap((b) => b.stories.map((s) => ({ ...s, b: b.id })));
const index = `<section class="index" id="index"><div class="ey"><span class="tier">INDEX</span></div><h2 class="ttl">Story index</h2>
<table class="stt"><thead><tr><th>ROW</th><th>BOARD</th><th>STATUS</th><th>ACCEPTANCE</th></tr></thead><tbody>${rowsAll.map((s) => `<tr><td>${s.id}</td><td><a href="#${s.b}">${s.b}</a></td><td><span class="spill ${s.stat}">${s.stat === 'new' ? 'NEW' : 'PARTIAL'}</span></td><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table></section>`;

const boards = BOARDS.map((b) => {
  // one pane per state around the window: wrap done in boardHtml via dp tokens
  return boardHtml(b);
}).join('\n');

const body = `<div class="page"><nav class="toc"><div class="tt">CANVAS</div><a href="#cover">Cover</a><a href="#status">Status</a><a href="#index">Story index</a><div class="tt">BOARDS</div>${idx}</nav><main class="cv">${cover}${status}${index}${boards}</main></div>`;
const css = BOARD_CSS + '\n' + TIDE_CSS + '\n' + MIN_CSS + '\n' + PLAN_CSS + '\n' + WIN_CSS + '\n' + paneCss(body);
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1640"><title>Tide app shell canvas</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Geist:wght@400;500;600&family=Geist+Mono:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>${css}</style></head><body>${body}${ixScript}</body></html>`;
fs.writeFileSync(path.join(here, 'tide-shell-canvas.html'), page);

// assets list + checks
const imgs = [...new Set([...page.matchAll(/src="((?:shots|tide|ref)\/[^"]+)"/g)].map((m) => m[1]))].sort();
fs.writeFileSync(path.join(here, 'assets.txt'), imgs.join('\n') + '\n');
const missing = imgs.filter((p) => !fs.existsSync(path.join(here, p)));
let bad = 0;
for (const b of BOARDS) {
  const h = boardHtml(b); const probs = [];
  if (!/class="hd"/.test(h)) probs.push('header');
  if ((h.match(/class="note/g) || []).length < 2 || !/class="note[^"]*"[^>]*><b>/.test(h)) probs.push('notes');
  if ((h.match(/class="card"/g) || []).length !== 4) probs.push('aside4');
  if (!/Reference: the original UI/.test(h)) probs.push('refs');
  if (!/class="(new|part)\b/.test(h)) probs.push('marker');
  if (b.stories.some((s) => s.stat === 'partial') && !/note pn/.test(h)) probs.push('partial note');
  if (!b.afterOnly && !/ba:before/.test(h)) probs.push('before pane');
  if (/\{\{/.test(h)) probs.push('{{');
  if (probs.length) { bad++; console.log('ANATOMY', b.id, probs.join(',')); }
}
const placed = [...allLabels].length; const noKept = page.replace(/<div class="kept">[\s\S]*?<\/div><\/div>/g, '');
const drawn = [...allLabels].filter((l) => noKept.includes(esc(nice(l)))).length;
console.log(`boards ${total}; anatomy problems ${bad}; missing images ${missing.length} ${missing.join(' ')}; page ${page.length} bytes`);
console.log(`controls.json unique ${allLabels.size}; chip-strip placed ${placed}; also drawn by name ${drawn}`);

// --dc export
const di = process.argv.indexOf('--dc');
if (di > 0) {
  const root = process.argv[di + 1]; const proj = path.join(root, 'project'); fs.mkdirSync(proj, { recursive: true });
  let blobs = {}; try { blobs = JSON.parse(fs.readFileSync(path.join(here, 'blobs.json'), 'utf8')); } catch {}
  let hts = {}; try { hts = JSON.parse(fs.readFileSync(path.join(here, 'heights.json'), 'utf8')); } catch {}
  const secs = page.split(/(?=<section class="[^"]*" id=")/).slice(1).map((s) => s.slice(0, s.lastIndexOf('</section>') + 10));
  const fix = (h) => h.replace(/src="((?:shots|tide|ref)\/[^"]+)"/g, (m, p) => `src="${blobs[p] || p}"`).replace(/<(img|input)([^>]*?)\s*\/?>/g, '<$1$2 />').replace(/<(br|hr)>/g, '<$1/>').replace(/\{\{/g, '{&#8203;{');
  const boardsOut = [];
  secs.forEach((s, i) => {
    const id = s.match(/id="([^"]+)"/)[1];
    const name = id === 'cover' ? 'Main' : id === 'index' ? 'Index' : id === 'status' ? 'Index-status' : id;
    let h = fix(s); let logic = '';
    if (/data-g=/.test(h)) { const r = ixDc(h); h = r.body; logic = r.logic; }
    const ht = hts[id] || 1200;
    const b = BOARDS.find((x) => x.id === id);
    const title = b ? `${b.id} ${b.title}` : { cover: 'Cover', status: 'Status', index: 'Story index' }[id] || id;
    const fontLink = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&amp;family=Geist:wght@400;500;600&amp;family=Geist+Mono:wght@500;600&amp;family=Plus+Jakarta+Sans:wght@400;500;600;700&amp;display=swap">';
    const dc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${fontLink}
<style>
body{margin:0}
${BOARD_CSS}
${TIDE_CSS}
${MIN_CSS}
${paneCss(s)}
</style>
</helmet>
<div style="width:1640px;height:${ht}px;overflow:hidden">${h}</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1640,"height":${ht}}}'>
${logic || 'class Component extends DCLogic { renderVals() { return {}; } }'}
</script>
</body>
</html>
`;
    fs.writeFileSync(path.join(proj, `${name}.dc.html`), dc);
    boardsOut.push({ id, file: `${name}.dc.html`, h: ht, title, interactive: !!logic });
  });
  // v3 index: rows of 4 (cover/status/index first), tier notes above each later row.
  const byId = Object.fromEntries(boardsOut.map((b) => [b.id, b]));
  const rest = boardsOut.filter((b) => !['cover', 'status', 'index'].includes(b.id)).map((b) => b.id);
  const rows = [['cover', 'status', 'index']]; for (let i = 0; i < rest.length; i += 4) rows.push(rest.slice(i, i + 4));
  const boardsIdx = {}; const order = []; const notes = {}; let y = 0;
  rows.forEach((r, ri) => {
    if (ri > 0) notes[`row${ri}`] = { x: 0, y: y - 280, text: r.map((id) => `${id} ${BOARDS.find((x) => x.id === id)?.title || ''}`.trim()).join(' · '), kind: 'title1', maxW: 1640 * r.length + 80 * (r.length - 1) };
    r.forEach((id, ci) => { const b = byId[id]; boardsIdx[b.file] = { x: ci * 1720, y, w: 1640, h: b.h, title: b.title, ...(b.interactive ? { is_interactive: true } : {}) }; order.push(b.file); });
    y += Math.max(...r.map((id) => byId[id].h)) + 120 + 300;
  });
  let created = { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  try { created = JSON.parse(fs.readFileSync(path.join(here, 'canvas-created.json'), 'utf8')); } catch { fs.writeFileSync(path.join(here, 'canvas-created.json'), JSON.stringify(created)); }
  fs.writeFileSync(path.join(proj, 'canvas.json'), JSON.stringify({ v: 3, createdOnFiles: created, title: 'yravgSubMeetly Tide shell canvas', launch: { view: 'canvas' }, pages: [], boards: boardsIdx, order, notes, designSystems: [] }, null, 1));
  console.log('dc export', order.length, 'boards ->', proj);
}
