#!/usr/bin/env node
// Builds submeetly-canvas.html: one static design canvas (canvas-to-app-nohtml standard).
//   node docs/design/submeetly-canvas/build.mjs
// Before = real screenshots in shots/ (scripts: scratch cap.mjs). Reference strips read ref/
// (gitignored third-party frames: Oyenza Studio, Threadbear; reference only, never shipped).
// After windows are redrawn with the app's own tokens (src/tokens.css + src/minutes.css themes).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeThreads, tbStaticScript, tbDc } from './threads.mjs';
import { TILE_CSS } from './icons/colour-icons.mjs';
import { makeIsland } from './island.mjs';
import { makeIx, paneCss, ixScript, ixDc } from './ix-boards.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(here, '../../../src/tokens.css'), 'utf8');
const IXCSS = readFileSync(join(here, 'ix.css'), 'utf8');

/* ---------- sample data (sample library series LIB-HSE2, labelled sample) ---------- */
const M = { title: 'Rapat Komite K3 Mingguan Site B', week: 'Week 1', date: '2026-02-17', time: '07:00–07:30', chair: 'James Miller', present: 5, mom: 'LIB-HSE2-W01', ptype: 'HSE / safety' };
const ROWS = [
  ['AI-001', 'q', 'Open question', 'Apakah sudah ada konfirmasi dari Client HSE soal near-miss log untuk emergency drill?', 'Unassigned', '00:01:03', 60],
  ['AI-002', 'r', 'Risk', 'Update singkat emergency drill: tim sudah menyelesaikan incident investigation report dan mulai batch berikutnya.', 'Unassigned', '00:01:23', 60],
  ['AI-003', 'q', 'Open question', 'Apakah sudah ada konfirmasi dari Client HSE soal toolbox topic sheet untuk emergency drill?', 'Unassigned', '00:01:34', 60],
  ['AI-005', 'a', 'Action', 'Mei akan mengirim toolbox topic sheet sebelum akhir minggu ini.', 'Mei Lin', '00:01:59', 60],
  ['AI-007', 'd', 'Decision', 'Drill evakuasi dipindah ke Jumat 07:30; semua kontraktor ikut.', 'James Miller', '00:04:12', 92],
  ['AI-009', 'a', 'Action', 'Lars mengirim incident investigation report ke Client HSE hari Rabu.', 'Lars Nilsen', '00:06:40', 88],
];

/* ---------- small helpers ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NEW = (inner, style = '', cls = '') => `<div class="new ${cls}" style="${style}"><span class="newtag">NEW</span>${inner}</div>`;
const PART = (inner, style = '', cls = '') => `<div class="part ${cls}" style="${style}"><span class="parttag">PARTIAL</span>${inner}</div>`;
const note = (x, y, html, pn = false, w) => `<div class="note${pn ? ' pn' : ''}" style="left:${x}px;top:${y}px${w ? `;width:${w}px;max-width:${w}px` : ''}">${html}</div>`;
const st = (id, src, stat, text, gap) => ({ id, src, stat, text, gap });

/* ---------- app pieces, drawn in the app's tokens ---------- */
const typeVar = { q: 'question', r: 'risk', a: 'action', d: 'decision', m: 'metric' };
/* ---------- icons: one inline line-icon set (24 grid, 1.6 stroke), no glyphs or emoji ---------- */
const P = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 6 6 6-6 6"/>', up: '<path d="m6 15 6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  wave: '<path d="M4 12h1.5M8.5 8v8M12.5 5v14M16.5 9v6M20 12h-.5"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M6.5 6.5a8 8 0 0 0 0 11M17.5 6.5a8 8 0 0 1 0 11"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  timer: '<circle cx="12" cy="13.5" r="6.5"/><path d="M12 10v4l2 1.5M9.5 3h5"/>', pie: '<path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5H12z"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', bolt: '<path d="M13 3 5.5 14H11l-1 7 7.5-11H12z"/>',
  cc: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7.5 11h3M13.5 11h3M7.5 14.5h5"/>', drop: '<path d="M12 4v10M8 10.5l4 4 4-4M5 20h14"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 3.5 2 3.5h-11"/>',
  arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>', play: '<path d="M8 5.5v13l10-6.5z"/>', notes: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9.5 12.5h6M9.5 16h6"/>',
  inbox: '<path d="M4 13.5 6.5 5h11L20 13.5V19H4z"/><path d="M4 13.5h4.5a3.5 3.5 0 0 0 7 0H20"/>', export: '<path d="M12 15V4M8 8l4-4 4 4M5 14v5.5h14V14"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
};
const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const wmark = '<span class="wm"><b>yravg</b><i>SubMeetly</i></span>';
const segc = (opts, cls = '') => `<span class="seg ${cls}">${opts.map(([l, on]) => (on ? `<b>${l}</b>` : `<span>${l}</span>`)).join('')}</span>`;
const typeTag = (t, label) => `<span class="ty" style="--c:var(--t-${typeVar[t]})">${label}</span>`;

/* ---------- app pieces, drawn in the app's tokens (Coretax paper) with yravg catalogue B1 Clean parts ---------- */
const TYPES = [['question', 'Open questions', 10], ['risk', 'Risks', 5], ['action', 'Actions', 3], ['decision', 'Decisions', 2]];
function regRow([ref, t, label, text, owner, tc, conf]) {
  const low = conf < 70;
  return `<div class="rr${low ? ' rv' : ''}">
    <span class="mono dim">${ref}</span>
    ${typeTag(t, label)}
    <span class="tx">${esc(text)}</span>
    <span class="ow">${owner === 'Unassigned' ? '<span class="dim">Unassigned</span>' : `<i class="av">${owner[0]}</i>${esc(owner)}`}</span>
    <span class="dim">–</span>
    <span class="sts"><i class="dot"></i>Open</span>
    <span class="srcc"><span class="mono">${ic('play', 10)} ${tc}</span>${low ? `<span class="flag">${ic('flag', 11)} ASR ${conf}%</span>` : `<span class="dim mono">ASR ${conf}%</span>`}</span>
  </div>`;
}

/* D01 summary: yravg compact-breakdown (B1 Clean): big total, 6 px stacked bar, ranked parts with swatch, value, share */
const summary = () => `<div class="cbs">
  <div class="cbs-fig"><p class="num">20</p><p class="cap">items in this meeting</p></div>
  <div class="cbs-mid">
    <div class="cbs-bar" aria-hidden="true">${TYPES.map(([v, , n]) => `<i style="flex:${n};background:var(--t-${v})"></i>`).join('')}</div>
    <ul class="cbs-list">${TYPES.map(([v, l, n]) => `<li><i class="sw8" style="background:var(--t-${v})"></i><span>${l}</span><b class="mono">${n}</b><span class="sh mono">${Math.round((n / 20) * 100)}%</span></li>`).join('')}</ul>
  </div>
  <dl class="cbs-st"><div><dt>Actions open</dt><dd class="mono">3/3</dd></div><div><dt>Overdue</dt><dd class="mono">0</dd></div><div><dt>Agenda covered</dt><dd class="mono">100%</dd><span class="meter"><i style="width:100%"></i></span></div></dl>
  <button class="rvb">${ic('flag', 14)} Review 20 low-confidence items</button>
</div>`;

function minutesAfter() {
  return `<div class="app mn" style="width:1600px;height:900px">
  <header class="abar">
    ${wmark}
    <nav class="crumb"><a>Minutes</a>${ic('right', 12)}<span>${M.title}</span>${ic('right', 12)}<span>${M.week}</span></nav>
    <span class="grow"></span>
    <span class="pill ok"><i class="dot"></i>On-device</span>
    <button class="gb">${ic('book', 14)} Library</button><button class="gb">${ic('bolt', 14)} Training <small>Lv 1</small></button>
    <button class="gb sel">2026-02-17 – W01 ${ic('down', 14)}</button>
    <button class="gb">${ic('plus', 14)} Add item</button><button class="gb">${ic('export', 14)} Export</button>
    <button class="pb">Issue MoM</button><button class="ib" aria-label="Settings">${ic('gear', 15)}</button>
  </header>
  <div class="mh">
    <h1>${M.title} – ${M.week}</h1>
    <p class="meta">${M.date} · ${M.time} Asia/Jakarta · Chair ${M.chair} · ${M.present} present · MoM <span class="mono">${M.mom}</span> · Series 1 · ${M.ptype} <span class="sample">sample</span></p>
    ${NEW(summary(), 'margin-top:20px')}
  </div>
  <div class="body">
    <aside class="nav">
      <div class="nh">Views</div>
      <a class="on">Register</a><a>By topic</a><a>Minutes</a><a>Carry-forward</a><a>Series</a>
      <div class="nh">Item type</div>
      ${[['decision', 'Decision', 2], ['action', 'Action', 3], ['question', 'Open question', 10], ['risk', 'Risk', 5], ['metric', 'Metric', 0], ['info', 'Note', 0]].map(([v, l, n]) => `<a class="ti"><i style="background:var(--t-${v})"></i>${l}<span class="mono dim">${n}</span></a>`).join('')}
      <a class="ti warnf">${ic('flag', 13)} Needs review only</a>
      <div class="nh">Filters</div><a class="ti">Group <span class="dim">none ${ic('down', 12)}</span></a><a class="ti">Project type <span class="dim">all ${ic('down', 12)}</span></a>
    </aside>
    <main class="reg">
      <div class="rh"><span>Ref ${ic('up', 11)}</span><span>Type</span><span>Item</span><span>Owner</span><span>Due</span><span>Status</span><span>Source</span></div>
      ${ROWS.map((r) => regRow(r)).join('')}
      <div class="prov">${ic('info', 14)}<span><b>Where this came from</b> 20 of 20 items have a source · drafted on this device from sample-library, 53 segments, 20 items · nothing left this device</span></div>
    </main>
  </div>
  <footer class="sbar"><span>Showing 20 of 20</span><span class="dim">j/k move · a accept · o owner · d date · / search · Esc close</span><span class="grow"></span><span class="dim">Layout: default · saved on this device</span></footer>
  ${PART(`<div class="dockmini">${ic('grid', 18)}</div>`, 'position:absolute;right:20px;bottom:44px')}
</div>`;
}

/* D02: yravg segmented-control (tray), combobox fields, a source row, a live caption block */
const combo = (v) => `<span class="combo">${v}${ic('down', 14)}</span>`;
/* D02, D03, T03: interactive boards, see ix-boards.mjs */
const IX = makeIx({ ic, wmark, esc, NEW, PART, typeTag, segc, combo, M });
const { sidepanelAfter, labAfter, optionsAfter } = IX;

/* island tier: see island.mjs */
const ISL = makeIsland({ ic, typeTag, st });
const { desk } = ISL;

function engineAfter() {
  return `<div class="app sp" style="width:420px;height:760px">
  <header class="sph">${wmark}<span class="grow"></span><span class="ib" aria-label="Settings">${ic('gear', 15)}</span></header>
  <div class="spb">
  ${PART(`<div class="hcard">
    <div class="lh"><span class="lt">Native helper</span><span class="pill ok"><i class="dot"></i>running</span></div>
    ${NEW(`<div class="kv"><span>Engine</span><b>Rust · candle 0.x</b></div>`, 'margin:0')}
    <div class="kv"><span>Device</span>${segc([['Auto'], ['CUDA', 1], ['CPU']], 'sm')}</div>
    <div class="kv"><span>Speech model</span><b>whisper large-v3-turbo · loaded</b></div>
    <div class="kv"><span>Translation</span><b>Qwen2.5 1.5B · loaded</b></div>
    <div class="kv"><span>Real-time factor</span><b class="mono">0.21×</b></div>
    <div class="kv"><span>If the helper stops</span><b>browser Whisper (WASM) takes over</b></div>
    <div class="row2"><span class="btn">Re-check</span><span class="btn">Open logs</span><span class="btn">Troubleshooting</span></div>
  </div>`)}
  <div class="hcard err"><div class="lh"><span class="lt">Error state</span></div><p>Helper not installed. Captions use the browser engine (slower). <a>Install helper</a></p></div>
  </div>
</div>`;
}


/* THREADS tier (T01, T02, T04, T05): three-pane interactive shell in threads.mjs */
const TH = makeThreads({ ic, wmark, esc, NEW, PART, st });

/* ---------- boards ---------- */
const BOARDS = [
  { id: 'D01', tier: 'DE-SLOP', title: 'Minutes register, quieter', ext: 'Minutes register (dist/minutes.html)', lives: 'Extension tab · Minutes · Register view',
    before: { img: 'shots/minutes-coretax.png', cap: 'Real capture, 1600×900, light (Coretax paper), sample series LIB-HSE2 imported' },
    after: { html: minutesAfter(), w: 1600, h: 900, scale: 0.5875 },
    notes: [
      [-588, 335, '<b>Seven KPI tiles become one summary line.</b> Every number stays (items, actions, overdue, questions, decisions, agenda); the review count turns into the one button that matters.', false, 270],
      [-300, 335, '<b>Exists:</b> per-row “Low ASR confidence” chip + “AI DRAFT · 60%” (src/minutes.js row render). <b>Missing:</b> one flag in Source only; amber left hairline marks rows to review.', true, 270],
      [620, 375, '<b>Exists:</b> floating view dock (src/minutes-dock.js) duplicates the navigator Views. <b>Missing:</b> starts minimised when the navigator is open; hover 1.5 s still opens it.', true, 250],
    ],
    must: ['All 7 summary numbers still visible, as one line under the title', 'One confidence flag per row, in Source; no duplicate chip in the item text', 'Topic “general” shown as plain text, not a pill', 'Rows needing review have a 2 px amber left edge', 'View dock starts minimised when navigator is open; no view removed', 'Coretax paper theme gets the same layout'],
    motion: [['Summary', 'numbers count up once on load, 250 ms, --ease-standard'], ['Review button', 'filters to needs-review, list cross-fades 180 ms'], ['Dock', 'existing wipe animation kept (dockAnim)'], ['Reduce Motion', 'no count-up; instant filter']],
    stories: [st('D01-1', 'S11', 'new', 'Summary line replaces KPI tile grid'), st('D01-2', 'S11', 'partial', 'Single confidence flag per row', 'Exists: chip + AI DRAFT label in row render. Missing: merge into Source column.'), st('D01-3', 'S11', 'partial', 'Dock minimised next to navigator', 'Exists: minimise + hover-open in minutes-dock.js. Missing: default when navigator open.'), st('D01-4', 'S1', 'new', 'Wordmark yravg + SubMeetly')],
    where: ['<b>Page:</b> src/minutes.html, src/minutes.css, src/minutes.js', '<b>Tests to keep:</b> test/dock-motion.test.mjs, test/register-extras.test.mjs', '<b>Open:</b> none'],
    refs: null },
  { id: 'D02', tier: 'DE-SLOP', ix: true, title: 'Side panel: every control, one place each', ext: 'Side panel (dist/sidepanel.html)', lives: 'Chrome side panel · Captions, Notes, History, Helper, Settings',
    before: { img: 'shots/sidepanel-before.png', cap: 'Real capture inside app.html at 1600×900 (side panel column)' },
    after: { html: sidepanelAfter(), w: 1140, h: 1080, scale: 0.96 },
    notes: [
      [1110, 10, '<b>Five places, one control each.</b> Captions, Notes, History, Helper, Settings. Click a tab, or a group in the feature map; every control of today’s panel sits on one of them (83 in the inventory).', false, 300],
      [1110, 250, '<b>Colour marks the group.</b> Green capture, blue language and export, red live, teal timing, yellow notes, orange engine. Labels stay ink, so text keeps 4.5:1.', false, 300],
      [1110, 440, '<b>Exists:</b> bottom tabs and the top Captions/Notes switch (src/sidepanel.js) do the same job. <b>Missing:</b> one row by default. Settings › General › <b>Tab rows: One | Two</b> brings the top row back (owner, 2026-11-08).', true, 300],
      [1110, 620, '<b>Exists:</b> Native Helper card inside the History scroll (helper-status.js, helper-guide.js). <b>Missing:</b> own tab, engine line, RTF.', true, 300],
      [1110, 800, '<b>Try the state switch.</b> Empty, Error, Locked and Needs input redraw the Captions, Notes, History and Helper tabs.', false, 300],
    ],
    must: ['Every control from Before is present with the same label, on one of five tabs', 'Feature map lists all 10 groups and jumps to the tab', 'Live transcript on the Captions tab without opening Actions & Preview', 'Engine and device named; device switch on the Helper tab', 'Colour icons on tinted tiles; no emoji, no sparkle', 'Empty, Error, Locked and Needs input drawn', 'One tab row by default; Tab rows: One | Two (Settings › General) brings back the second row', 'Translation colour setting: indigo default, four other swatches, each 4.5:1 on the card; the live translation line follows'],
    motion: [['Live line', 'new line slides up 8 px + fades in, 180 ms'], ['Tab change', 'content cross-fades 120 ms'], ['Start', 'button turns into elapsed timer, 120 ms'], ['Reduce Motion', 'lines and tabs swap without motion']],
    stories: [st('D02-1', 'S11', 'new', 'Listen-to block merges source, mode and languages'), st('D02-2', 'S11', 'new', 'Live three-line preview on the Captions tab'), st('D02-3', 'S3', 'new', 'Engine and device line, device switch'), st('D02-4', 'S11', 'partial', 'One tab row by default, toggle to show two', 'Exists: both rows in sidepanel.js. Missing: one row by default and the Tab rows: One | Two setting.'), st('D02-5', 'S3', 'partial', 'Native Helper gets its own tab', 'Exists: helper card inside the History scroll. Missing: own tab, engine line, RTF.'), st('D02-6', 'S11', 'new', 'Translation colour setting (5 swatches, indigo default)')],
    where: ['<b>Page:</b> src/sidepanel.html, src/sidepanel.css, src/sidepanel.js, src/lib/helper-guide.js', '<b>Catalogue (yravg, B1 Clean):</b> segmented-control, combobox, integration-picker (tile settings list), settings-billing (tabs), fallback-chain (native to browser), toaster, setup-guide, usage-meter', '<b>Icons:</b> own two-tone set on hue tiles (icons/colour-icons.mjs), approach from Solvarium p6Icons.js', '<b>Tests to keep:</b> test/app-surfaces.test.mjs', '<b>Decision:</b> one tab row by default, toggle for two (owner, 2026-11-08)'],
    refs: null },
  { id: 'D03', tier: 'DE-SLOP', ix: true, title: 'Lab shell: four tabs, nothing deleted', ext: 'Lab shell (test/app.html)', lives: 'http://127.0.0.1:8799/app.html',
    before: { img: 'shots/app.png', cap: 'Real capture, 1600×900' },
    after: { html: labAfter(), w: 1140, h: 1010, scale: 0.96 },
    notes: [
      [1110, 10, '<b>Nothing deleted.</b> The developer paragraph sits under “How the lab works” (bar button and a card on Guides and docs). All 21 test pages stay: grouped on Test pages and listed in the menu.', false, 300],
      [1110, 280, '<b>Width presets work.</b> Auto, Compact, Wide and Full resize the panel frame on the Panel tab.', false, 300],
      [1110, 450, '<b>New: Mock helper tab</b> puts window.__labMock (mode, latencyMs, failNext, reset) and both fixtures in the page, so the offline and error states can be tried without a console.', false, 300],
      [1110, 650, '<b>Try the state switch.</b> Empty, Error, Locked and Needs input redraw the Panel and Mock helper tabs.', false, 300],
    ],
    must: ['Developer paragraph reachable in one click, wording unchanged', 'Width presets Auto/Compact/Wide/Full unchanged and working', 'All 21 test pages reachable: grouped page and the dropdown menu', 'Panel frame centred; one wordmark', 'Mock helper controls cover mode, latencyMs, failNext and reset', 'Empty, Error, Locked and Needs input drawn'],
    motion: [['Width preset', 'frame width animates 250 ms (existing --shell-w)'], ['Tab change', 'content cross-fades 120 ms'], ['Reduce Motion', 'instant width and tabs']],
    stories: [st('D03-1', 'S11', 'new', 'Lab bar with “How the lab works” replaces the paragraph'), st('D03-2', 'S11', 'built', 'Width presets and test-page menu'), st('D03-3', 'S11', 'new', 'Test pages grouped by purpose'), st('D03-4', 'S11', 'new', 'Mock helper tab over window.__labMock')],
    where: ['<b>Page:</b> test/app.html, test/chrome-mock.js', '<b>Catalogue (yravg, B1 Clean):</b> segmented-control (tabs, width, mock mode), data-table (request log, page lists)', '<b>Hooks:</b> window.__labMock, --shell-w', '<b>Tests to keep:</b> test/app-surfaces.test.mjs', '<b>Open:</b> none'],
    refs: null },
  ...ISL.boards,
  { id: 'T01', tier: 'THREADS', title: 'Inbox zero for actions and questions', ext: 'Minutes register views (src/minutes.js)', lives: 'Minutes › Inbox (new view)',
    afterOnly: true, after: { html: TH.boards.T01.html, w: 1600, h: 900, scale: 0.69 }, tools: TH.switcher('T01'),
    notes: [
      [296, 262, '<b>Three panes, all live.</b> Left: open threads across meetings with filters and counts. Middle: the open thread and its replies. Right: owner, due, status, source line and related items.', false, 268],
      [576, 262, '<b>Done</b> moves a thread to <b>Finished</b>; <b>Archive all</b> files them away with Undo. The last one shows the <b>inbox-zero</b> state with the next meeting.', false, 268],
      [296, 372, '<b>Exists:</b> open actions and questions in the register, carry-forward. <b>Missing:</b> one cross-meeting list, the Finished step and Undo.', true, 548],
    ],
    must: ['Only open actions, open questions and unowned risks across all meetings', 'Left list, thread and detail pane are all visible together', 'Open a thread, reply, mark done, archive, restore and undo all work', 'Finished threads wait before archive; Archive all has Undo', 'Inbox zero names the next meeting', 'Normal / Empty / Error / Locked / Needs input all reachable from the switcher'],
    motion: [['Done', 'row moves to Finished 180 ms'], ['Archive', 'row collapses 180 ms, toast with Undo'], ['Reduce Motion', 'rows fade']],
    stories: [st('T01-1', 'S9', 'new', 'Inbox view across meetings'), st('T01-2', 'S9', 'new', 'Finished threads before archive, with Undo'), st('T01-3', 'S9', 'new', 'Snooze to next meeting')],
    where: ['<b>Page:</b> src/minutes.js views, src/lib/notes-actions.js', '<b>Spec:</b> docs/roadmap/threadbear-mapping.md (worker S9)', '<b>Inventory:</b> docs/design/submeetly-canvas/inventory-threadbear-boards.md'],
    refs: { note: 'Threadbear (MIT), reference only.', shots: [['ref/tb-inbox-1.webp', 'Inbox clip: finished threads before archiving'], ['ref/tb-inbox-2.webp', 'Inbox clip: after archiving, list shorter'], ['ref/tb-phone-inbox.webp', 'Phone inbox']] } },
  { id: 'T02', tier: 'THREADS', title: 'Librarian files meetings into projects', ext: 'Series + projectType (src/lib/notes-schema.js PROJECT_TYPES)', lives: 'Minutes › Projects',
    afterOnly: true, after: { html: TH.boards.T02.html, w: 1600, h: 900, scale: 0.69 }, tools: TH.switcher('T02'),
    notes: [
      [296, 262, '<b>After End &amp; draft</b> the librarian files the meeting by chair, attendees and title, says why, and offers Undo. Pause stops it.', false, 268],
      [576, 262, '<b>Project notes</b> are rewritten from accepted decisions only; every line links back to its item.', false, 268],
      [296, 372, '<b>Exists:</b> series and projectType on every meeting. <b>Missing:</b> automatic filing, the reason line and the Unfiled bucket.', true, 548],
    ],
    must: ['Filing reason shown in words', 'Undo and Move always available', 'Notes cite item refs', 'Unfiled bucket for low-confidence matches', 'Runs on this device; nothing sent out', 'Pause and resume the librarian; all five states reachable'],
    motion: [['Filed row', 'slides in 180 ms, stays until dismissed'], ['Reduce Motion', 'appears without slide']],
    stories: [st('T02-1', 'S9', 'new', 'Auto-file into project + series'), st('T02-2', 'S9', 'new', 'Project notes from accepted decisions')],
    where: ['<b>Page:</b> src/minutes.js, src/lib/notes-schema.js', '<b>Engine:</b> /notes (Rust, S3)'],
    refs: { note: 'Threadbear (MIT), reference only.', shots: [['ref/tb-librarian-1.webp', 'Librarian clip, frame 1 of 2'], ['ref/tb-librarian-2.webp', 'Librarian clip, frame 2 of 2: a thread started with no project picked']] } },
  { id: 'T03', tier: 'THREADS', ix: true, title: 'Draft options side by side', ext: '“End & draft” (src/notes-panel.js draftFromSession)', lives: 'Minutes › End & draft',
    before: { img: 'shots/minutes-coretax.png', cap: 'Real capture, 1600×900: the register where the single draft lands today' },
    after: { html: optionsAfter(), w: 1140, h: 800, scale: 0.96 },
    notes: [
      [1110, 10, '<b>End &amp; draft</b> makes up to three drafts from the same lines. Pick one, add a note, then “Use picked draft”. Nothing reaches the register until you use one.', false, 300],
      [1110, 230, '<b>Exists:</b> one draft via generateNotesFromTranscript (draftFromSession, src/notes-panel.js:541). <b>Missing:</b> variants, compare, pick.', true, 300],
      [1110, 420, '<b>Diff tab:</b> accept or reject each change before it joins the register; duplicates of existing items are skipped and counted.', false, 300],
      [1110, 600, '<b>Try the state switch.</b> Empty, Error (Draft B failed), Locked (issued meeting) and Needs input (Draft C needs a language pair).', false, 300],
    ],
    must: ['Three drafts from the same transcript, labelled by style, one marked Suggested with its reason', 'Pick + note per draft, or “None of these” with a free reply', 'Bilingual draft uses the session language pair', 'Per-item include and edit on each draft', 'Use picked draft writes to the register through addItem', 'Empty, Error, Locked and Needs input drawn'],
    motion: [['Pick', 'lane outline to accent 120 ms'], ['Tab change', 'content cross-fades 120 ms'], ['Reduce Motion', 'instant']],
    stories: [st('T03-1', 'S9', 'partial', 'Draft variants compared side by side', 'Exists: single draft in draftFromSession (src/notes-panel.js). Missing: variants, compare, pick.'), st('T03-2', 'S9', 'new', 'Include, edit and note per draft'), st('T03-3', 'S9', 'new', 'Diff with accept or reject before the register')],
    where: ['<b>Page:</b> src/notes-panel.js, src/minutes.js', '<b>Catalogue (yravg, B1 Clean):</b> parallel-attempts (lanes, Best mark, “Use this one”), inline-diff (accept/reject), review-center (Approve/Edit/Reject), email-draft, writing-assistant', '<b>Reference:</b> Threadbear options clip (ref/tb-options-*.webp)', '<b>Writes:</b> addItem (src/notes-actions.js:192)'],
    refs: { note: 'Threadbear (MIT), reference only.', shots: [['ref/tb-options-1.webp', 'Options clip: three directions side by side'], ['ref/tb-options-2.webp', 'Options clip: one picked, with a note']] } },
  { id: 'T04', tier: 'THREADS', title: 'Meeting highlights: needs you, files, links, changes', ext: 'Meeting page (src/minutes.js meeting view)', lives: 'Minutes › Meeting › Highlights (new tab)',
    afterOnly: true, after: { html: TH.boards.T04.html, w: 1600, h: 900, scale: 0.69 }, tools: TH.switcher('T04'),
    notes: [
      [296, 262, '<b>Needs you</b> lists what this meeting waits on you for. Tick it off and the count and the left badge follow.', false, 268],
      [576, 262, '<b>Files, Links, Changes</b> sit in the right pane for the open meeting; Issue MoM there marks it done and moves it to Finished.', false, 268],
      [296, 372, '<b>Exists:</b> decisions, actions, attendees, attachments per meeting. <b>Missing:</b> the Highlights roll-up and change list.', true, 548],
    ],
    must: ['Needs-you items tick off and update counts', 'Files, links and changes listed for the open meeting', 'Finished meetings can be archived; Undo restores', 'Same three panes as the inbox', 'All five states reachable'],
    motion: [['Tick', 'check fills 120 ms'], ['Reduce Motion', 'instant']],
    stories: [st('T04-1', 'S9', 'new', 'Highlights tab on a meeting'), st('T04-2', 'S9', 'new', 'Finished meetings archived with Undo')],
    where: ['<b>Page:</b> src/minutes.js meeting view', '<b>Spec:</b> docs/roadmap/threadbear-mapping.md'],
    refs: { note: 'Threadbear (MIT), reference only.', shots: [['ref/tb-inbox-1.webp', 'Inbox clip: finished threads before archiving (the same Finished step)'], ['ref/tb-decisions-1.webp', 'Decisions clip, frame 1'], ['ref/tb-decisions-2.webp', 'Decisions clip, frame 2']] } },
  { id: 'T05', tier: 'THREADS', title: 'Add-ins: what each may read and do', ext: 'Native Helper card (src/lib/helper-guide.js)', lives: 'Side panel › Settings › Add-ins (new)',
    afterOnly: true, after: { html: TH.boards.T05.html, w: 1600, h: 900, scale: 0.69 }, tools: TH.switcher('T05'),
    notes: [
      [296, 262, '<b>Each add-in</b> shows what it may read and do. <b>Trust and enable</b> turns it on, <b>Remove</b> takes it away; nothing runs without a yes.', false, 268],
      [576, 262, '<b>Add-in API v0</b> is local only: no cloud call, no account. Locked state shows it read-only.', false, 268],
      [296, 372, '<b>Exists:</b> Native Helper card, permission rows. <b>Missing:</b> per-add-in grants and the Allow card.', true, 548],
    ],
    must: ['Each add-in lists what it reads and what it may do', 'Trust and enable, Review manifest and Remove work per add-in', 'Nothing enabled by default except those already on', 'Local only, stated in words', 'All five states reachable'],
    motion: [['Trust', 'row moves to Enabled 180 ms'], ['Reduce Motion', 'instant']],
    stories: [st('T05-1', 'S9', 'new', 'Add-in list with per-add-in permissions'), st('T05-2', 'S9', 'new', 'Trust gate before first run')],
    where: ['<b>Page:</b> src/lib/helper-guide.js', '<b>Spec:</b> docs/roadmap/threadbear-mapping.md (add-in API v0)'],
    refs: { note: 'Threadbear (MIT), reference only.', shots: [['ref/tb-options-1.webp', 'Options clip: choose before it runs'], ['ref/tb-options-2.webp', 'Options clip: one picked, with a note']] } },
  { id: 'E01', tier: 'ENGINE', title: 'Helper card names the Rust engine', ext: 'Native Helper card (src/lib/helper-guide.js)', lives: 'Side panel › History › Native helper',
    afterOnly: true, after: { html: engineAfter(), w: 420, h: 760, scale: 1 },
    notes: [[20, 540, '<b>Exists:</b> helper card with status, device pick and troubleshooting (helper-guide.js). <b>Missing:</b> engine line, model rows, real-time factor.', true, 380], [20, 640, '<b>Helper missing or crashed:</b> the error card says the browser engine took over and links Install.', false, 380]],
    must: ['Engine named: Rust · candle', 'Device switch Auto / CUDA / CPU (Metal on Mac)', 'Model rows show loaded or downloading', 'Fallback to browser engine stated', 'Error state drawn'],
    motion: [['Status dot', 'colour change 120 ms'], ['Reduce Motion', 'instant']],
    stories: [st('E01-1', 'S3', 'partial', 'Helper status card shows engine', 'Exists: status + device in helper-guide.js. Missing: engine/model/RTF rows.'), st('E01-2', 'S4', 'new', 'candle ASR + translation models')],
    where: ['<b>Page:</b> src/lib/helper-guide.js', '<b>Engine:</b> engine-rs/ (S2–S4)'],
    refs: null },
];

/* ---------- per-board anatomy check (the lint reads the whole file) ---------- */
for (const b of BOARDS) {
  const h = b.after.html + b.notes.map((n) => (n[3] ? 'class="note pn"' : '')).join('');
  const has = (k) => b.stories.some((s) => s.stat === k);
  const e = [];
  if (has('new') && !h.includes('newtag')) e.push('new story, no NEW tag in window');
  if (has('partial') && !h.includes('parttag')) e.push('partial story, no PARTIAL tag');
  if ((h.match(/parttag/g) || []).length > b.notes.filter((n) => n[3]).length) e.push('PARTIAL tag without Exists note');
  if (b.notes.length < 2) e.push('fewer than 2 notes');
  if (e.length) { console.error(`FAIL ${b.id}: ${e.join('; ')}`); process.exitCode = 1; }
}

/* ---------- page ---------- */
function boardHtml(b) {
  const win = (a) => `<div class="win" style="width:${Math.round(a.w * a.scale)}px;height:${Math.round(a.h * a.scale)}px"><div class="scaler" style="width:${a.w}px;height:${a.h}px;transform:scale(${a.scale})">${a.html}</div>${b.notes.map(([x, y, h, pn, w]) => note(x, y, h, pn, w)).join('')}</div>`;
  const aside = `
    <div class="card"><div class="lbl">What it must show</div><ul class="must">${b.must.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="card"><div class="lbl">Motion</div><div class="motion">${b.motion.map(([n, x]) => `<div class="m"><span>${n}</span><span>${x}</span></div>`).join('')}</div></div>
    <div class="card"><div class="lbl">Stories</div>${b.stories.map((s) => `<div class="st"><div class="sti"><span class="sid">${s.id}</span><span class="src">${s.src}</span><span class="stat ${s.stat}">${s.stat[0].toUpperCase() + s.stat.slice(1)}</span></div><div class="stt">${s.text}</div>${s.gap ? `<div class="gap"><b>${s.gap.split('. Missing:')[0]}.</b> Missing:${s.gap.split('. Missing:')[1] || ''}</div>` : ''}</div>`).join('')}</div>
    <div class="card"><div class="lbl">Where it lives</div><div class="where">${b.where.map((x) => `<span>${x}</span>`).join('')}</div></div>`;
  const body = b.ix
    ? `${IX.toggle()}<div class="ixb"><div data-p="ba:before" style="--pd:block"><p class="ixcap"><span class="vt">Before</span> ${b.before.cap}</p><img class="ixi" src="${b.before.img}" alt="Before: ${esc(b.title)}"></div><div data-p="ba:after" style="--pd:block">${win(b.after)}</div></div><div class="aside4">${aside}</div>`
    : b.afterOnly
    ? `<div class="rw">${win(b.after)}<div class="aside">${aside}</div></div>`
    : `<div class="cmp"><figure class="before"><figcaption><span class="vt">Before</span>${b.before.cap}</figcaption><img src="${b.before.img}" alt="Before: ${esc(b.title)}"></figure><figure class="after"><figcaption><span class="vt on">After</span>redrawn in the app’s tokens</figcaption>${win(b.after)}</figure></div><div class="aside4">${aside}</div>`;
  const refs = b.refs ? `<div class="refs"><div class="lbl">Reference: the original UI</div><p class="dim">${b.refs.note}</p><div class="rg">${b.refs.shots.map(([img, cap]) => `<figure><img src="${img}" alt="${esc(cap)}"><figcaption>${cap}</figcaption></figure>`).join('')}</div></div>` : '';
  const film = b.film || "";
  return `<section class="board${b.ix ? ' ix' : ''}" id="${b.id}">
  <div class="hd"><div class="ey"><span class="tier">${b.tier}</span><span>${b.id} · ${b.tier} · ${b.afterOnly ? 'NEW SCREEN' : b.ix ? 'BEFORE | AFTER' : 'BEFORE + AFTER'}</span></div>
  <h2 class="ttl">${b.title}</h2>
  <div class="ext"><b>Extends:</b> ${b.ext} &#160;·&#160; <b>Lives in:</b> ${b.lives}</div>${b.tools ? `<div class="tbtools">${b.tools}</div>` : ''}</div>
  ${body}${film}${refs}</section>`;
}

const allStories = BOARDS.flatMap((b) => b.stories.map((s) => ({ ...s, board: b.id })));
const count = (k) => allStories.filter((s) => s.stat === k).length;
const tiers = [...new Set(BOARDS.map((b) => b.tier))];
const tierText = { 'DE-SLOP': 'Minutes register, side panel and lab shell, quieter. Same controls, fewer boxes.', ISLAND: 'Oyenza Studio’s island and pill, painted in our tokens, with meeting pages and add-ins.', THREADS: 'Threadbear ideas for meetings: inbox zero, librarian, options.', ENGINE: 'The Rust engine (candle) made visible where people check the helper.' };

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=1640">
<title>yravgSubMeetly canvas</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${tokens}
:root{--white:#fff;--ground-2:#F3F4F8;--black:#000;--warn-ink:#5E3F00;--sh-a:rgba(23,27,38,.5);--sh-b:rgba(23,27,38,.45);--ground:#E7E9EF;--win:#FFFFFF;--side-2:#ECEEF4;--line:#E2E5EC;--line-2:#D3D7E1;--ink:#171B26;--muted-c:#545B6E;--navy:#212C5F;--navy-2:#2F3D80;--yellow:#FFC91B;--ok-c:#1E7B4E;--ok-soft:#E5F3EB;--warn-c:#8A5D00;--warn-soft:#FFF1D1;--amber:#C27A00;--sans:'Geist',system-ui,sans-serif;--monoc:'Geist Mono',ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);font-family:var(--sans);color:var(--ink);font-size:13px;line-height:1.4}
.page{display:flex}.toc{position:sticky;top:0;align-self:flex-start;width:200px;height:100vh;overflow:auto;padding:24px 14px;border-right:1px solid var(--line-2);background:var(--ground-2);font-size:12.5px}
.toc a{display:block;color:var(--ink);text-decoration:none;padding:4px 6px;border-radius:6px}.toc a:hover{background:var(--side-2)}.toc .tt{font:600 10.5px var(--monoc);letter-spacing:.1em;color:var(--muted-c);margin:14px 0 4px}
main.cv{width:1640px;flex:none}
.cover,.board,.status,.index{width:1640px;padding:52px 56px;border-bottom:1px solid var(--line-2)}
.cover h1{font-size:44px;margin:0 0 8px;letter-spacing:-1px}.cover p{color:var(--muted-c);max-width:900px;font-size:15px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}.tile{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:18px}.tile b{font-size:34px;display:block}
.tcards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.tcard{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px}.tcard h3{margin:0 0 6px;font:600 12px var(--monoc);letter-spacing:.08em}
.legend{display:flex;gap:28px;align-items:center;margin-top:28px;flex-wrap:wrap}
table.stt{width:100%;border-collapse:collapse;background:var(--win);border-radius:12px;overflow:hidden}table.stt td,table.stt th{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left}table.stt th{font:600 10.5px var(--monoc);letter-spacing:.1em;color:var(--muted-c)}
.hd{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}.ey{display:flex;gap:10px;align-items:center;font:500 11.5px/1 var(--monoc);letter-spacing:.08em;color:var(--muted-c)}
.tier{font:600 11px/1 var(--monoc);letter-spacing:.08em;padding:5px 9px;border-radius:99px;background:var(--navy);color:var(--white)}
.ttl{margin:0;font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.8px}.ext{font-size:14px;color:var(--muted-c)}.ext b{color:var(--ink)}
.rw{display:flex;gap:36px;align-items:flex-start}
.cmp{display:flex;gap:28px;align-items:flex-start}.cmp figure{margin:0;display:flex;flex-direction:column;gap:8px}.cmp figcaption{font-size:12px;color:var(--muted-c);display:flex;gap:8px;align-items:center}
.before img{width:560px;border:1px solid var(--line-2);border-radius:12px;display:block}
.vt{font:600 10.5px/1 var(--monoc);padding:4px 8px;border-radius:99px;background:var(--side-2);color:var(--muted-c)}.vt.on{background:var(--navy);color:var(--white)}
.win{flex:none;background:var(--black);border:1px solid var(--line-2);border-radius:12px;box-shadow:0 30px 70px -30px var(--sh-b);overflow:visible;position:relative}
.scaler{transform-origin:0 0;overflow:hidden;border-radius:12px}
.aside{width:388px;flex:none;display:flex;flex-direction:column;gap:18px}.aside4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:28px}
.card{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.lbl{font:600 10.5px/1.2 var(--monoc);letter-spacing:.12em;text-transform:uppercase;color:var(--muted-c)}
.must{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}.motion{display:flex;flex-direction:column;gap:7px;font-size:12.5px}.motion .m{display:flex;gap:8px}.motion .m span:first-child{font:600 11px var(--monoc);color:var(--navy-2);white-space:nowrap}
.st{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:8px}.sti{display:flex;align-items:center;gap:8px}.sid{font:600 11.5px var(--monoc)}
.src{font:600 10px/1 var(--monoc);padding:3px 6px;border-radius:5px;background:var(--side-2);color:var(--muted-c)}
.stat{margin-left:auto;font:600 10.5px/1 var(--monoc);padding:3px 7px;border-radius:99px}.stat.built{background:var(--ok-soft);color:var(--ok-c)}.stat.partial{background:var(--warn-soft);color:var(--warn-c)}.stat.new{background:var(--navy);color:var(--white)}
.stt{font-size:12.5px}
.spill{font:600 10.5px/1 var(--monoc);padding:3px 7px;border-radius:99px}.spill.built{background:var(--ok-soft);color:var(--ok-c)}.spill.partial{background:var(--warn-soft);color:var(--warn-c)}.spill.new{background:var(--navy);color:var(--white)}
.lg{padding:6px 10px;border-radius:8px}.lgn{outline:2px solid var(--yellow)}.lgp{outline:2px dashed var(--amber)}.gap{font-size:12px;color:var(--warn-c)}.gap b{color:var(--warn-ink)}.where{display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.new:not(.stat):not(.spill){outline:2px solid var(--yellow);outline-offset:2px;border-radius:8px;position:relative}
.newtag{position:absolute;top:-10px;left:8px;background:var(--yellow);color:var(--navy);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:3px 6px;border-radius:99px;z-index:2}
.part{outline:2px dashed var(--amber);outline-offset:2px;border-radius:8px;position:relative}
.parttag{position:absolute;top:-10px;left:8px;background:var(--warn-soft);color:var(--warn-c);border:1px solid var(--amber);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:2px 6px;border-radius:99px;z-index:2}
.note{position:absolute;max-width:290px;background:var(--navy);color:var(--white);font-size:11.5px;line-height:16px;padding:7px 10px;border-radius:8px;box-shadow:0 8px 20px -8px var(--sh-a);z-index:3}.note b{color:var(--yellow);font-weight:600}.note.pn{border-left:4px solid var(--amber)}
.refs{margin-top:28px;background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px}.refs .rg{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.refs figure{margin:0}.refs img{width:100%;height:270px;object-fit:contain;background:var(--ground-2);border-radius:8px}.refs figcaption{font-size:12px;color:var(--muted-c);margin-top:6px}
.dim{opacity:.72}

/* ===== After windows: light only. App tokens = Coretax paper (src/minutes.css html[data-theme=coretax]);
   parts = yravg catalogue B1 Clean (compact-breakdown, data-table, segmented-control, decision-inbox) mapped onto these tokens ===== */
.app,.desk{--white:#fff;--gold-70:var(--gold-70);--gold-60:var(--gold-60);--gold-25:rgba(255,201,27,.25);--amber-45:rgba(217,154,0,.45);--danger-35:rgba(176,42,30,.35);--danger-20:rgba(176,42,30,.2);--navy-30:rgba(33,44,95,.3);--info-ic:#1C7ED6;--danger-wash:#FDF3F1;--bg:#FFFFFF;--bg-deep:#F5F4EF;--card:#FFFFFF;--card2:#F7F6F2;--card3:#EEF3F8;--border:rgba(33,44,95,.14);--grid:rgba(33,44,95,.08);--wash:rgba(33,44,95,.045);--fill:rgba(33,44,95,.07);--text:#131B44;--text2:#2B3358;--muted:#5C6385;--muted2:#5C6385;--accent:#212C5F;--gold:#FFC91B;--accent-dim:rgba(255,201,27,.22);--ok:#17744A;--ok-bg:#E4F5EC;--warn-text:#7A5200;--warn-bg:#FFF4D6;--warn-edge:#D99A00;--danger:#B02A1E;--ai:#4A3C94;--info-bg:#EAF4FE;
--t-decision:#1F5F9E;--t-action:#7A5200;--t-question:#4A3C94;--t-risk:#B02A1E;--t-metric:#0B6E83;--t-info:#4F5675;
--ring:0 0 0 .5px rgba(33,44,95,.16),0 1px 1px -1px rgba(33,44,95,.12),0 1px 2px rgba(33,44,95,.06);--float:0 18px 48px rgba(33,44,95,.18),0 0 0 1px rgba(33,44,95,.08);
--mono:ui-monospace,"JetBrains Mono",Consolas,monospace;font-family:"Plus Jakarta Sans",Inter,"Segoe UI",sans-serif}
.app{position:relative;background:var(--bg);color:var(--text);font-size:var(--text-base);display:flex;flex-direction:column;overflow:hidden}
:is(.app,.desk) .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}:is(.app,.desk) .dim{color:var(--muted);opacity:1}:is(.app,.desk) .small{font-size:var(--text-xs)}:is(.app,.desk) .grow{flex:1}
:is(.app,.desk) button{font:inherit;color:inherit}:is(.app,.desk) .ic{flex:none}:is(.app,.desk) a{color:var(--accent);font-weight:var(--font-medium);text-decoration:underline;text-underline-offset:2px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block;flex:none}.dot.off{background:var(--muted)}
.wm{display:inline-flex;align-items:center;gap:2px;font-weight:var(--font-bold);font-size:var(--text-lg);letter-spacing:-.01em}.wm i{font-style:normal;background:var(--gold);color:var(--text);padding:1px 7px;border-radius:var(--radius-sm);font-size:var(--text-base)}
.abar,.labbar{display:flex;align-items:center;gap:var(--space-2);height:48px;padding:0 var(--space-4);border-bottom:1px solid var(--grid);background:var(--bg-deep)}
.crumb{display:flex;align-items:center;gap:var(--space-2);color:var(--muted);margin-left:var(--space-4)}.crumb a{color:var(--text);text-decoration:none;font-weight:var(--font-medium)}
.gb,.pb,.ib{height:30px;padding:0 var(--space-3);border-radius:var(--radius-md);border:0;background:var(--card);box-shadow:var(--ring);font-size:var(--text-sm);font-weight:var(--font-medium);display:inline-flex;align-items:center;gap:6px;text-decoration:none!important;color:var(--text)!important}
.gb small{color:var(--muted)}.gb.sel{background:var(--accent-dim)}.pb{background:var(--accent);box-shadow:none;color:var(--white)!important;font-weight:var(--font-semibold)}.ib{width:30px;justify-content:center;padding:0}
.pill{font-size:var(--text-xs);padding:3px 10px;border-radius:var(--radius-full);box-shadow:var(--ring);color:var(--muted);display:inline-flex;align-items:center;gap:6px;background:var(--card)}.pill.ok{background:var(--ok-bg);color:var(--ok);box-shadow:none}
.mh{padding:var(--space-6) var(--space-6) var(--space-4)}.mh h1{font-size:var(--text-2xl);margin:0;letter-spacing:-.015em}.meta{margin:6px 0 0;color:var(--muted);font-size:var(--text-sm)}
.sample{font-size:var(--text-xs);border:1px dashed var(--muted);border-radius:var(--radius-full);padding:1px 6px;margin-left:6px;color:var(--muted)}
/* D01 summary = catalogue compact-breakdown */
.cbs{display:grid;grid-template-columns:150px minmax(0,1fr) 270px auto;gap:var(--space-8);align-items:center;background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);padding:var(--space-4) var(--space-5)}
.cbs p{margin:0}.cbs .num{font-size:32px;line-height:36px;font-weight:var(--font-medium);letter-spacing:-.02em}.cbs .cap{font-size:var(--text-sm);color:var(--muted)}
.cbs-bar{display:flex;gap:2px;height:6px}.cbs-bar i{display:block;border-radius:1.5px;min-width:2px}.cbs-bar i:first-child{border-radius:3px 1.5px 1.5px 3px}.cbs-bar i:last-child{border-radius:1.5px 3px 3px 1.5px}
.cbs-list{list-style:none;margin:10px 0 0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3)}.cbs-list li{display:flex;align-items:center;gap:8px;font-size:var(--text-sm);color:var(--text2);white-space:nowrap}
.sw8{width:8px;height:8px;border-radius:2px;flex:none}.cbs-list b{color:var(--text);font-weight:var(--font-medium)}.cbs-list .sh{color:var(--muted);font-size:var(--text-xs)}
.cbs-st{margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4)}.cbs-st dt{font-size:var(--text-xs);color:var(--muted)}.cbs-st dd{margin:2px 0 0;font-size:var(--text-xl);font-weight:var(--font-medium)}
.meter{display:block;height:4px;border-radius:2px;background:var(--fill);margin-top:6px;overflow:hidden}.meter i{display:block;height:100%;background:var(--gold)}
.rvb{height:34px;border-radius:var(--radius-md);border:0;background:var(--warn-bg);color:var(--warn-text)!important;padding:0 var(--space-4);display:inline-flex;align-items:center;gap:8px;font-weight:var(--font-semibold);box-shadow:inset 0 0 0 1px var(--amber-45)}
.body{display:flex;flex:1;min-height:0;border-top:1px solid var(--grid)}
.nav{width:236px;flex:none;border-right:1px solid var(--grid);padding:var(--space-3);display:flex;flex-direction:column;gap:2px;font-size:var(--text-md);background:var(--bg)}
.nav .nh{font-size:var(--text-sm);color:var(--muted);font-weight:var(--font-medium);margin:var(--space-4) var(--space-2) var(--space-1)}
.nav a{padding:7px 10px;border-radius:var(--radius-md);color:var(--text2);display:flex;align-items:center;gap:8px;text-decoration:none;font-weight:var(--font-normal)}.nav a.on{background:var(--gold-25);color:var(--text);font-weight:var(--font-semibold);box-shadow:inset 0 0 0 1px var(--gold-70)}
.nav .ti i{width:8px;height:8px;border-radius:2px}.nav .ti>span:last-child{margin-left:auto}.nav .warnf{color:var(--warn-text);font-weight:var(--font-medium)}
.reg{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg)}
.rh,.rr{display:grid;grid-template-columns:76px 130px 1fr 150px 50px 80px 130px;gap:var(--space-3);padding:0 var(--space-5);align-items:center}
.rh{height:36px;font-size:var(--text-sm);color:var(--muted);font-weight:var(--font-medium);background:var(--card3);border-bottom:.5px solid var(--grid)}.rh span{display:flex;align-items:center;gap:4px}
.rr{min-height:62px;border-bottom:.5px solid var(--grid);box-shadow:inset 2px 0 0 transparent}.rr.rv{box-shadow:inset 2px 0 0 var(--warn-edge)}
.ty{font-size:var(--text-sm);font-weight:var(--font-medium);color:var(--c);background:color-mix(in srgb,var(--c) 11%,var(--white));border-radius:6px;padding:2px 8px;justify-self:start;white-space:nowrap}
.tx{font-size:var(--text-md);line-height:1.45;color:var(--text)}.ow{display:flex;align-items:center;gap:8px;font-size:var(--text-sm)}.av{width:22px;height:22px;border-radius:50%;background:var(--card3);color:var(--text);font-style:normal;font-size:var(--text-xs);font-weight:var(--font-semibold);display:grid;place-items:center}
.sts{font-size:var(--text-sm);color:var(--text2);display:inline-flex;align-items:center;gap:6px}.sts .dot{background:var(--warn-edge)}.srcc{display:flex;flex-direction:column;gap:2px;font-size:var(--text-xs)}.srcc .mono{display:inline-flex;align-items:center;gap:4px}.flag{color:var(--warn-text);font-weight:var(--font-medium);display:inline-flex;align-items:center;gap:4px}
.prov{display:flex;gap:var(--space-2);align-items:center;margin:auto var(--space-5) var(--space-4);padding:var(--space-3) var(--space-4);font-size:var(--text-sm);background:var(--info-bg);border-radius:var(--radius-md);color:var(--text2)}.prov .ic{color:var(--info-ic)}.prov b{color:var(--text)}
.sbar{height:32px;display:flex;gap:var(--space-4);align-items:center;padding:0 var(--space-4);border-top:1px solid var(--grid);font-size:var(--text-xs);color:var(--muted);background:var(--bg-deep)}
.dockmini{width:42px;height:42px;border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--float);display:grid;place-items:center;color:var(--accent)}
/* side panel */
.sph{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--grid);background:var(--bg-deep)}
.seg{display:inline-flex;gap:2px;background:var(--wash);border-radius:var(--radius-md);padding:2px;font-size:var(--text-sm)}.seg>*{padding:4px 11px;border-radius:6px;color:var(--text2);font-weight:var(--font-medium);text-align:center;white-space:nowrap}.seg b{background:var(--card);color:var(--text);box-shadow:var(--ring);font-weight:var(--font-semibold)}.seg.sm{font-size:var(--text-xs)}.seg.full{display:flex;width:100%}.seg.full>*{flex:1}
.spb{flex:1;display:flex;flex-direction:column;gap:var(--space-3);padding:var(--space-4);background:var(--bg);overflow:hidden}
.lis{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-4)}
.fld{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}.fld label{font-size:var(--text-sm);color:var(--muted);font-weight:var(--font-medium)}
.srcrow{display:flex;align-items:center;gap:var(--space-3);width:100%;height:52px;padding:0 var(--space-3);border:0;border-radius:var(--radius-md);background:var(--card);box-shadow:var(--ring);text-align:left;color:var(--muted)!important}
.srcic{width:32px;height:32px;border-radius:var(--radius-md);background:var(--card3);color:var(--accent);display:grid;place-items:center}.srct{flex:1;display:flex;flex-direction:column;line-height:1.3}.srct b{font-size:var(--text-md);font-weight:var(--font-semibold);color:var(--text)}.srct small{font-size:var(--text-xs);color:var(--muted)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)}.langs{display:flex;align-items:flex-end;gap:var(--space-2)}.langs .to{height:36px;display:grid;place-items:center;color:var(--muted)}
.combo{height:36px;padding:0 var(--space-3);border-radius:var(--radius-md);box-shadow:var(--ring);background:var(--card);display:flex;align-items:center;justify-content:space-between;font-size:var(--text-md);font-weight:var(--font-medium)}.combo .ic{color:var(--muted)}
.eng{margin:0;display:flex;align-items:center;gap:8px;font-size:var(--text-sm);font-weight:var(--font-medium);color:var(--ok);padding-top:var(--space-3);border-top:.5px solid var(--grid)}.eng .dim{margin-left:auto;font-weight:var(--font-normal)}
.cta{display:flex;gap:var(--space-2)}.bigb{height:42px;flex:1;justify-content:center;font-size:var(--text-md)}.gb[disabled]{opacity:1;background:var(--fill);box-shadow:none;color:var(--muted)!important;cursor:not-allowed}
.live{border-radius:var(--radius-lg);background:var(--card2);padding:var(--space-4);box-shadow:inset 0 0 0 .5px var(--grid)}
.lh{display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-3)}.lt{font-size:var(--text-md);font-weight:var(--font-semibold);color:var(--text)}.idle{display:inline-flex;align-items:center;gap:6px;font-size:var(--text-xs);color:var(--muted)}
.live p{margin:0}.live .prev{font-size:var(--text-sm);color:var(--muted);padding-bottom:var(--space-2)}.live .cur{font-size:var(--text-xl);line-height:1.4;font-weight:var(--font-semibold);padding:var(--space-2) 0 var(--space-2) var(--space-3);border-left:3px solid var(--gold)}.live .tr,.ilines .tr{color:var(--tc,var(--ai));font-size:var(--text-md);padding:var(--space-2) 0 0 calc(var(--space-3) + 3px)}
.hist{display:flex;flex-direction:column}.search{display:flex;align-items:center;gap:8px;background:var(--card);box-shadow:var(--ring);border-radius:var(--radius-md);height:36px;padding:0 var(--space-3);color:var(--muted);margin-bottom:var(--space-2);font-size:var(--text-sm)}
.hr{display:flex;justify-content:space-between;align-items:center;padding:9px 4px;border-top:.5px solid var(--grid);font-size:var(--text-md)}.hr .dim{font-size:var(--text-xs)}.hist .all{display:inline-flex;align-items:center;gap:4px;font-size:var(--text-sm);padding-top:var(--space-2)}
.tabs{display:flex;border-top:1px solid var(--grid);background:var(--bg-deep)}.tabs a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 0 10px;color:var(--muted);font-size:var(--text-xs);text-decoration:none;font-weight:var(--font-medium);box-shadow:inset 0 2px 0 transparent}.tabs a.on{color:var(--text);box-shadow:inset 0 2px 0 var(--gold)}
.kv{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:.5px solid var(--grid);font-size:var(--text-sm)}.kv span:first-child{color:var(--muted)}
.row2{display:flex;gap:6px;margin-top:var(--space-3)}.hcard{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);padding:var(--space-4)}.hcard.err{box-shadow:inset 0 0 0 1px var(--danger-35);background:var(--danger-wash)}.hcard.err p{margin:0;font-size:var(--text-sm)}
.btn{height:28px;padding:0 var(--space-3);border-radius:var(--radius-md);box-shadow:var(--ring);background:var(--card);color:var(--text);font-size:var(--text-sm);font-weight:var(--font-medium);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.btn.p{background:var(--accent);color:var(--white);box-shadow:none}
/* lab */
.app.lab{background:var(--bg-deep)}.stage{flex:1;display:grid;place-items:start center;padding-top:var(--space-6)}.frame{border-radius:var(--radius-xl);overflow:hidden;box-shadow:var(--float)}.frame .app{height:780px!important}
/* inbox (catalogue decision-inbox) / librarian / options */
.inbox,.lib{flex:1;padding:var(--space-6);background:var(--bg)}.lib h2{margin:0 0 var(--space-3);font-size:var(--text-xl)}
.dic{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);overflow:hidden}.dic-h{display:flex;align-items:center;gap:var(--space-2);padding:12px var(--space-4);font-size:var(--text-md);font-weight:var(--font-semibold);border-bottom:.5px solid var(--grid)}.dic-h .ic{color:var(--warn-edge)}.dic-h .dim{font-weight:var(--font-normal);font-size:var(--text-sm);margin-left:var(--space-2)}
.ibr{display:grid;grid-template-columns:100px 1fr 160px 190px auto auto auto;gap:var(--space-3);align-items:center;padding:14px var(--space-4);border-top:.5px solid var(--grid);font-size:var(--text-md)}.dic-h+.ibr{border-top:0}
.zero{margin-top:var(--space-5);font-size:var(--text-sm);color:var(--muted);display:flex;gap:8px;align-items:center}.zero .ic{color:var(--ok)}
.filed{display:flex;gap:var(--space-3);align-items:center;background:var(--accent-dim);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);font-size:var(--text-md);box-shadow:inset 0 0 0 1px var(--gold-60)}
.pnotes{background:var(--card);box-shadow:var(--ring);border-radius:var(--radius-lg);padding:var(--space-4) var(--space-5);margin:var(--space-3) 0}.pnotes ul{margin:8px 0 0;padding-left:18px;line-height:1.7;font-size:var(--text-md)}
.mlist{max-width:900px}
.opts{flex:1;padding:var(--space-6);background:var(--bg)}.optsrow{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4);height:420px}
.opt{background:var(--card);box-shadow:var(--ring);border-radius:var(--radius-lg);display:flex;flex-direction:column}.opt.on{box-shadow:0 0 0 1.5px var(--accent)}
.oh{display:flex;flex-direction:column;gap:2px;padding:var(--space-3) var(--space-4);border-bottom:.5px solid var(--grid)}.ob{padding:var(--space-4);font-size:var(--text-md);line-height:1.6;flex:1}.of{display:flex;gap:var(--space-2);align-items:center;padding:var(--space-3) var(--space-4);border-top:.5px solid var(--grid)}
.ell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${ISL.css}

${TILE_CSS}
${IXCSS}
${paneCss('data-p="ba:before"' + BOARDS.filter((x) => x.ix).map((x) => IX.toggle() + x.after.html).join(''))}
${TH.css}
</style></head><body><div class="page">
<nav class="toc"><b>yravgSubMeetly</b><div class="tt">START</div><a href="#cover">Cover</a><a href="#status">Status</a>
${tiers.map((t) => `<div class="tt">${t}</div>${BOARDS.filter((b) => b.tier === t).map((b) => `<a href="#${b.id}">${b.id} ${b.title}</a>`).join('')}`).join('')}
<div class="tt">END</div><a href="#index">Story index</a></nav>
<main class="cv">
<section class="cover" id="cover"><div class="ey"><span class="tier">CANVAS</span><span>yravgSubMeetly · 2026-11-08 · branch main @ 31624c1 (local)</span></div>
<h1>yravgSubMeetly: island, add-ins, threads, quieter pages</h1>
<p>Design before code for docs/roadmap/submeetly-next.md. De-slop boards show the real app (Before) and the redraw (After) in the app’s own tokens. Island boards fork Oyenza Studio’s pill and add-on system; thread boards bring Threadbear’s ideas to meetings. Sample data comes from the sample library (series LIB-HSE2) and is labelled sample.</p>
<div class="tiles"><div class="tile"><b>${BOARDS.length}</b>boards</div><div class="tile"><b>${allStories.length}</b>stories</div><div class="tile"><b>${count('built')}</b>built</div><div class="tile"><b>${count('new') + count('partial')}</b>new + partial</div></div>
<div class="tcards">${tiers.map((t) => `<div class="tcard"><h3>${t}</h3><p>${tierText[t]}</p><p class="dim">${BOARDS.filter((b) => b.tier === t).map((b) => b.id).join(' · ')}</p></div>`).join('')}</div>
<div class="legend"><b>How to read a board</b><span class="lg lgn">yellow outline = NEW</span><span class="lg lgp">amber dashed = PARTIAL</span><span style="position:relative;display:inline-block;width:240px;height:34px"><span class="lgnote" style="position:absolute;left:0;top:0;background:var(--navy);color:var(--white);padding:7px 10px;border-radius:8px;font-size:11.5px"><b style="color:var(--yellow)">Navy note</b> = behaviour a still cannot show</span></span><span class="spill built">Built</span><span class="spill partial">Partial</span><span class="spill new">New</span></div>
<p class="dim" style="margin-top:20px">Story sources: S1–S11 = steps in docs/roadmap/submeetly-next.md. References: Oyenza Studio (github.com/lucacadalora/oyenza-studio, MIT code only) and Threadbear (github.com/mikecann/threadbear, MIT). Reference frames are kept out of git.</p></section>
<section class="status" id="status"><h2 class="ttl" style="margin-bottom:20px">Status</h2><table class="stt"><tr><th>BOARD</th><th>TITLE</th><th>STATUS</th><th>LIVES IN</th><th>STORIES</th></tr>
${BOARDS.map((b) => `<tr><td><a href="#${b.id}">${b.id}</a></td><td>${b.title}</td><td>open (drawn, not built)</td><td>${b.lives}</td><td>${b.stories.map((s) => s.id).join(', ')}</td></tr>`).join('')}</table></section>
${BOARDS.map(boardHtml).join('\n')}
<section class="index" id="index"><h2 class="ttl" style="margin-bottom:20px">Story index</h2><table class="stt"><tr><th>STORY</th><th>SOURCE</th><th>STATUS</th><th>STORY</th><th>BOARD</th></tr>
${allStories.map((s) => `<tr><td>${s.id}</td><td>${s.src}</td><td><span class="spill ${s.stat}">${s.stat}</span></td><td>${s.text}</td><td><a href="#${s.board}">${s.board}</a></td></tr>`).join('')}</table></section>
</main></div>${tbStaticScript(TH.cfgs)}${ixScript}</body></html>`;

writeFileSync(join(here, 'submeetly-canvas.html'), html);
console.log(`submeetly-canvas.html: ${BOARDS.length} boards, ${allStories.length} stories`);

/* ---------- Claude Design canvas export: node build.mjs --dc <root> ----------
 * One .dc.html per section (cover = Main), images as the canvas's uploaded /_blob/ urls (blobs.json),
 * heights from heights.json (written by the render check). Writes <root>/project/canvas.json too. */
const dcAt = process.argv.indexOf('--dc');
if (dcAt > 0) {
  const { mkdirSync } = await import('node:fs');
  const root = process.argv[dcAt + 1];
  const blobs = JSON.parse(readFileSync(join(here, 'blobs.json'), 'utf8'));
  const heights = JSON.parse(readFileSync(join(here, 'heights.json'), 'utf8'));
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const fontLink = html.match(/<link href="https:\/\/fonts[^>]+>/)[0].replace(/&(?!amp;)/g, '&amp;');
  const file = (id) => (id === 'cover' ? 'Main.dc.html' : `${id}.dc.html`);
  mkdirSync(join(root, 'project'), { recursive: true });
  // Split on top-level sections (they carry an id); board bodies may hold inner <section> tags.
  const starts = [...html.matchAll(/<section class="([^"]*)" id="([^"]+)">/g)];
  const secs = starts.map((m, i) => { const end = i + 1 < starts.length ? starts[i + 1].index : html.lastIndexOf('</main>'); return [null, m[1], m[2], html.slice(m.index + m[0].length, end).replace(/<\/section>\s*$/, '')]; });
  const boards = {}; const order = []; const notes = {};
  const rows = [['cover', 'status', 'index'], ...tiers.flatMap((t) => { const ids = BOARDS.filter((b) => b.tier === t).map((b) => b.id); const out = []; for (let i = 0; i < ids.length; i += 5) out.push(ids.slice(i, i + 5)); return out.map((r, j) => Object.assign(r, { tier: t, first: j === 0 })); })];
  let y = 0;
  rows.forEach((row, ri) => {
    if (ri > 0 && row.first) { notes[`tier${ri}`] = { x: 0, y: y - 260, text: row.tier, kind: 'title1', maxW: 1640 * row.length + 80 * (row.length - 1) }; }
    row.forEach((id, ci) => {
      const h = heights[id]; const f = file(id);
      const b = BOARDS.find((x) => x.id === id);
      boards[f] = { x: ci * 1720, y, w: 1640, h, ...(TH.cfgs[id] || b?.ix || b?.tier === 'ISLAND' ? { is_interactive: true } : {}), title: b ? `${b.id} ${b.title}` : id === 'cover' ? 'Cover' : id === 'status' ? 'Status' : 'Story index' };
      order.push(f);
    });
    y += Math.max(...row.map((id) => heights[id])) + 120 + 300;
  });
  for (const [, cls, id, inner] of secs) {
    let body = inner.replace(/src="((?:shots|ref)\/[^"]+)"/g, (m, p) => { if (!blobs[p]) throw new Error('no blob for ' + p); return `src="${blobs[p]}"`; })
      .replace(/href="#([A-Za-z0-9]+)"/g, (m, t) => `href="${file(t)}"`)
      .replace(/<br>/g, '<br/>');
    const h = heights[id];
    const tb = tbDc(body, id, TH.cfgs) || (BOARDS.find((x) => x.id === id)?.ix ? ixDc(body) : null); if (tb) body = tb.body;
    const dc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${boards[file(id)].title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${fontLink}
<style>
body{margin:0}
${css}
</style>
</helmet>
<section class="${cls}" style="width:1640px;height:${h}px;box-sizing:border-box;overflow:hidden">${body}</section>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1640,"height":${h}}}'>
${tb ? tb.logic : 'class Component extends DCLogic { renderVals() { return {}; } }'}
</script>
</body>
</html>
`;
    writeFileSync(join(root, 'project', file(id)), dc);
  }
  const index = { v: 3, createdOnFiles: { v: 1, at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }, title: 'yravgSubMeetly canvas', launch: { view: 'canvas' }, pages: [], boards, order, notes, designSystems: [] };
  writeFileSync(join(root, 'project', 'canvas.json'), JSON.stringify(index, null, 1));
  console.log(`dc export: ${secs.length} artboards -> ${root}/project`);
}
