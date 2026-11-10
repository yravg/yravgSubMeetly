// Pill Media / Meeting canvas generator (source of truth). Run: node build.mjs [--dc <root>]
//   node build.mjs            -> pill-media-meeting-canvas.html (static, all boards)
//   node build.mjs --dc <root> -> <root>/project/canvas.json (v3), Main.dc.html, Index.dc.html, <ID>-<slug>.dc.html
// Light theme first (the island default). Settings boards stay dark (that window is dark today).
// Data is sample data (fictional "Weekly site coordination" Teams meeting; people Alya, Budi, Chen; one sample video).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_CSS, PILL_CSS, esc, bt, paneCss, ixScript, ixDc, tokenize } from './kit.mjs';
import { BOARDS, PRD, PRD_FILE } from './boards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LABEL = { new: 'NEW', partial: 'PARTIAL', built: 'BUILT' };
const gapHtml = (g) => esc(g).replace('Exists:', '<b>Exists:</b>').replace('Missing:', '<b>Missing:</b>');

const toggle = (b) => `<div class="ixh"><span class="vw">${bt('ba', 'before', 'Before', false)}${bt('ba', 'after', 'After', true)}</span>${b.states ? `<span class="vw vs">${b.states.map(([k, l], i) => bt('st', k, l, i === 0)).join('')}</span>` : ''}<span class="vt">sample data</span></div>`;

const boardHtml = (b) => {
  const stories = b.stories.map((s) => `<div class="st"><div class="sti"><span class="sid">${s.id}</span><span class="src">${esc(s.src)}</span><span class="stat ${s.stat}">${LABEL[s.stat]}</span></div><div>${esc(s.text)}</div>${s.gap ? `<div class="gap">${gapHtml(s.gap)}</div>` : ''}</div>`).join('');
  return `<section class="board" id="${b.id}">
<div class="hd"><div class="ey"><span class="tier">${b.id} · ${b.tier}</span><span>PRD ${PRD_FILE}</span></div><h2 class="ttl">${esc(b.title)}</h2><div class="ext"><b>Extends:</b> ${esc(b.ext)} &nbsp;·&nbsp; <b>Lives in:</b> ${esc(b.lives)}</div></div>
${toggle(b)}
<div data-p="ba:before"><p class="ixcap"><span class="vt">BEFORE</span>${esc(b.before.cap)}</p>${b.before.html}</div>
<div data-p="ba:after"><div class="stage">${b.after}</div></div>
<div class="aside4">
<div class="card"><div class="lbl">What it must show</div><ul class="must">${b.must.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
<div class="card"><div class="lbl">Motion</div><div class="motion">${b.motion.map(([a, c]) => `<div class="m"><span>${esc(a)}</span><span>${esc(c)}</span></div>`).join('')}</div></div>
<div class="card"><div class="lbl">Stories</div>${stories}</div>
<div class="card"><div class="lbl">Where it lives</div><div class="where">${b.where.map((w) => `<div>${w}</div>`).join('')}</div></div>
</div>
</section>`;
};

const slugOf = (b) => `${b.id}-${b.slug}`;
const boardsOf = (id) => BOARDS.filter((b) => b.stories.some((s) => s.id === id));
const afterOf = (b) => b.after;
const newControls = BOARDS.reduce((n, b) => n + (afterOf(b).match(/class="newtag"/g) || []).length, 0);
const prdRows = Object.keys(PRD).length;
const p0Rows = Object.values(PRD).filter((r) => r[0] === 'P0').length;

const statusRows = Object.entries(PRD).map(([id, [pri, title, status]]) => {
  const bs = boardsOf(id); const primary = id === 'PMM-001' ? 'P01' : id === 'PMM-011' ? 'P05' : bs[0]?.id;
  const link = bs.map((b) => `<a href="#${b.id}">${b.id}</a>`).join(' ');
  const canvas = bs.map((b) => b.stories.find((s) => s.id === id).stat);
  const cs = canvas.includes('partial') ? 'partial' : canvas.includes('new') ? 'new' : 'built';
  return `<tr><td><b>${id}</b></td><td>${pri}</td><td>${esc(title)}</td><td>${status}</td><td>${link || 'none'}${primary ? ` <small>(main: ${primary})</small>` : ''}</td><td><span class="spill ${cs}">${LABEL[cs]}</span></td></tr>`;
}).join('');
const unplaced = Object.keys(PRD).filter((id) => !boardsOf(id).length);

const cover = `<section class="cover" id="cover"><div class="ey"><span class="tier">COVER</span><span>yravgSubMeetly · island 1.2.9 next feature</span></div>
<h1>Media, Meeting and quick caption settings on the pill</h1>
<p>Design canvas before the build: Music becomes Media and shows captions; a new Meeting tab holds live captions with the minutes so far; Live gets a quick caption strip so language and translation changes no longer need Advanced settings. PRD: ${PRD_FILE}. All meeting names, people and the video on the boards are sample data.</p>
<div class="tiles"><div class="tile"><b>${BOARDS.length}</b>boards</div><div class="tile"><b>${prdRows}</b>PRD rows</div><div class="tile"><b>${p0Rows}</b>P0 rows</div><div class="tile"><b>${newControls}</b>new controls drawn</div></div>
<div class="legend"><span class="lg lgn">NEW: does not exist yet</span><span class="lg lgp">PARTIAL: exists, needs change</span><span>Navy notes: what happens on press, hover or when something is missing</span></div>
<h3>Options chosen</h3>
<p>Before and After where a real Before exists: P01 and P02 use the real capture of the Music page; P07 uses the real Settings capture. Other boards: "Before: not capturable (the island window is excluded from screen capture); drawn from today's code", with a drawn Before that says so. No reference strips. Light theme first (the island default); Settings stays dark because that window is dark.</p>
<h3>Status of the ${prdRows} PRD rows (PRD status; canvas status is how the board marks the row)</h3>
<table class="stt"><thead><tr><th>ROW</th><th>P</th><th>REQUIREMENT</th><th>PRD STATUS</th><th>BOARD</th><th>CANVAS</th></tr></thead><tbody>${statusRows}</tbody></table></section>`;

const rowsAll = BOARDS.flatMap((b) => b.stories.map((s) => ({ ...s, b: b.id })));
const index = `<section class="index" id="index"><div class="ey"><span class="tier">INDEX</span></div><h2 class="ttl">Story index</h2>
<table class="stt"><thead><tr><th>ROW</th><th>BOARD</th><th>STATUS</th><th>ACCEPTANCE</th></tr></thead><tbody>${rowsAll.map((s) => `<tr><td>${s.id}</td><td><a href="#${s.b}">${s.b}</a></td><td><span class="spill ${s.stat}">${LABEL[s.stat]}</span></td><td>${esc(s.text)}</td></tr>`).join('')}</tbody></table></section>`;

const toc = `<nav class="toc"><a href="#cover">Cover and status</a><a href="#index">Story index</a>${BOARDS.map((b) => `<a href="#${b.id}">${b.id} ${esc(b.title)}</a>`).join('')}</nav>`;
const body = `<div class="page">${toc}<main class="cv">${cover}${index}${BOARDS.map(boardHtml).join('\n')}</main></div>`;
const FONT = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500;600&display=swap';
const css = [BOARD_CSS, PILL_CSS, paneCss(body)].join('\n');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1640"><title>Pill Media and Meeting canvas</title>
<link rel="stylesheet" href="${FONT}">
<style>${css}</style></head><body>${body}${ixScript}</body></html>`;
fs.writeFileSync(path.join(here, 'pill-media-meeting-canvas.html'), tokenize(page));

// checks (same shape as lint_boards.mjs, cheap early signal)
const imgs = [...new Set([...page.matchAll(/src="(shots\/[^"]+)"/g)].map((m) => m[1]))].sort();
const missing = imgs.filter((p) => !fs.existsSync(path.join(here, p)));
let bad = 0;
for (const b of BOARDS) {
  const h = boardHtml(b); const probs = [];
  const n = (re) => (h.match(re) || []).length;
  if (n(/class="note[ "]/g) < 2) probs.push('notes');
  if (n(/class="card"/g) !== 4) probs.push('aside4');
  if (n(/class="parttag"/g) > n(/class="note pn"/g)) probs.push('partial notes');
  if (n(/class="stat partial"/g) > n(/class="gap"/g)) probs.push('gaps');
  if (!/ba:before/.test(h)) probs.push('before pane');
  if (/\{\{/.test(h)) probs.push('{{');
  if (probs.length) { bad++; console.log('ANATOMY', b.id, probs.join(',')); }
}
console.log(`boards ${BOARDS.length}; anatomy problems ${bad}; new controls ${newControls}; unplaced PRD rows ${unplaced.join(',') || 'none'}; missing images ${missing.join(' ') || 'none'}; page ${page.length} bytes`);

// --dc export
const di = process.argv.indexOf('--dc');
if (di > 0) {
  const root = process.argv[di + 1]; const proj = path.join(root, 'project'); fs.mkdirSync(proj, { recursive: true });
  const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(here, f), 'utf8')); } catch { return d; } };
  const blobs = rd('blobs.json', {}); const hts = rd('heights.json', {});
  const files = Object.fromEntries(BOARDS.map((b) => [b.id, `${slugOf(b)}.dc.html`]));
  const secs = page.split(/(?=<section class="[^"]*" id=")/).slice(1).map((s) => s.slice(0, s.lastIndexOf('</section>') + 10));
  const fix = (h) => h.replace(/src="(shots\/[^"]+)"/g, (m, p) => `src="${blobs[p] || p}"`).replace(/<(img|input)([^>]*?)\s*\/?>/g, '<$1$2 />').replace(/<(br|hr)>/g, '<$1/>').replace(/\{\{/g, '{&#8203;{').replace(/href="#(P\d+)"/g, (m, id) => `href="${files[id]}"`).replace(/href="#(cover|index)"/g, (m, id) => `href="${id === 'cover' ? 'Main' : 'Index'}.dc.html"`);
  const out = [];
  secs.forEach((s) => {
    const id = s.match(/id="([^"]+)"/)[1];
    const b = BOARDS.find((x) => x.id === id);
    const name = id === 'cover' ? 'Main' : id === 'index' ? 'Index' : slugOf(b);
    let h = fix(s); let logic = '';
    if (/data-g=/.test(h)) { const r = ixDc(h); h = r.body; logic = r.logic; }
    const ht = hts[id] || 2000;
    const title = b ? `${b.id} ${b.title}` : id === 'cover' ? 'Cover and status' : 'Story index';
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
<link rel="stylesheet" href="${FONT.replace(/&/g, '&amp;')}">
<style>
body{margin:0}
${BOARD_CSS}
${PILL_CSS}
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
    fs.writeFileSync(path.join(proj, `${name}.dc.html`), tokenize(dc));
    out.push({ id, file: `${name}.dc.html`, h: ht, title, interactive: !!logic });
  });
  // v3 index: cover and story index on the first row, then boards in rows of 4.
  const byId = Object.fromEntries(out.map((o) => [o.id, o]));
  const rows = [['cover', 'index'], BOARDS.slice(0, 4).map((b) => b.id), BOARDS.slice(4).map((b) => b.id)];
  const idx = {}; const order = []; const notes = {}; let y = 0;
  rows.forEach((r, ri) => {
    if (ri > 0) notes[`row${ri}`] = { x: 0, y: y - 280, text: r.map((id) => `${id} ${BOARDS.find((x) => x.id === id)?.title || ''}`.trim()).join(' · '), kind: 'title1', maxW: 1640 * r.length + 80 * (r.length - 1) };
    r.forEach((id, ci) => { const o = byId[id]; idx[o.file] = { x: ci * 1720, y, w: 1640, h: o.h, title: o.title, ...(o.interactive ? { is_interactive: true } : {}) }; order.push(o.file); });
    y += Math.max(...r.map((id) => byId[id].h)) + 120 + 300;
  });
  let created = rd('canvas-created.json', null);
  if (!created) { created = { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }; fs.writeFileSync(path.join(here, 'canvas-created.json'), JSON.stringify(created)); }
  fs.writeFileSync(path.join(proj, 'canvas.json'), JSON.stringify({ v: 3, createdOnFiles: created, title: 'yravgSubMeetly Media, Meeting and quick captions canvas', launch: { view: 'canvas' }, pages: [], boards: idx, order, notes, designSystems: [] }, null, 1));
  console.log('dc export', order.length, 'files ->', proj);
}
