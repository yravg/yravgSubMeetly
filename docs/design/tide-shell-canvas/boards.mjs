// Window markup for every board (the "After" side). Sample data is synthetic and labelled sample:
// series "Site B Safety Committee", chair James Miller, owners Mei Lin / Lars Nilsen.
import { ic, tile, img, MARK, NEW, PART, esc } from './kit.mjs';

const TIDE = (n) => `tide/tide-${n}.webp`;
const SAMPLE = '<span class="sample">sample</span>';
const dot = (c = '') => `<i class="dot ${c}"></i>`;

/* ---------- shell pieces ---------- */
const navA = (ic_, label, on, n) => `<a class="${on ? 'on' : ''}">${ic(ic_, 20)}<span>${label}</span>${n ? `<span class="n">${n}</span>` : ''}</a>`;
export const sidebar = (active, { dev = false, syncDot = '' } = {}) => `<aside class="sb">
<div class="brand"><img src="${MARK}" alt=""><span class="wm">yravg<i>SubMeetly</i></span><span class="bell">${ic('bell', 20)}</span></div>
<div class="series hide1"><span class="av">SB</span><span><b>Site B Safety Committee</b><small>Weekly · chair James Miller</small></span>${ic('updown', 18)}</div>
<div class="askf hide1">${ic('sparkle', 18)}<span>Ask Tide…</span><kbd>/</kbd></div>
<div class="sec hide1">Meetings</div>
<nav class="nav">${navA('today', 'Today', active === 'today')}${navA('live', 'Live captions', active === 'live')}${navA('minutes', 'Minutes', active === 'minutes', 13)}${navA('history', 'History', active === 'history')}${navA('files', 'Files', active === 'files')}</nav>
<div class="sec hide1">Features</div>
<nav class="nav">${navA('addins', 'Add-ins', active === 'addins')}${navA('book', 'Glossary', active === 'glossary')}${navA('island', 'Island', active === 'island')}${navA('perf', 'Performance', active === 'perf')}${navA('grid', 'All features', active === 'all', 8)}${navA('gear', 'Settings', active === 'settings')}${dev ? `<a class="dv ${active === 'dev' ? 'on' : ''}">${ic('dev', 20)}<span>Developer</span><span class="n">lab</span></a>` : ''}</nav>
<div class="push"></div>
<div class="pillb full"><span class="hide1" style="display:contents">${ic('play', 18)}Start captions<kbd>⇧S</kbd></span></div>
<div class="sbf"><span class="av sm">EM</span><span class="hide1"><b>Enrico</b><small>${dot()}${syncDot || 'Helper · CUDA · synced 08:52'}</small></span><a class="plk hide1 ${active === 'plans' ? 'on' : ''}">Plans</a></div>
</aside>`;

export const topbar = (title, extra = '') => `<div class="top"><h1>${title}</h1>${SAMPLE}<span class="grow"></span>${extra}<span class="chip">${ic('island', 18)}Island<span class="sw on"></span></span><span class="chip ok">${dot()}Helper · CUDA</span></div>`;

export const shell = (active, main, { h = 900, cls = '', dev = false, w = 1440, over = '' } = {}) => `<div class="tide ${cls}" style="width:${w}px;height:${h}px">${sidebar(active, { dev })}<main class="mn">${main}</main>${over}</div>`;

const harbour = `<svg style="width:100%;height:100%;display:block" viewBox="0 0 1000 470" preserveAspectRatio="xMaxYMax slice" aria-hidden="true"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky-1)"/><stop offset=".62" style="stop-color:var(--sky-2)"/><stop offset="1" style="stop-color:var(--mint)"/></linearGradient><linearGradient id="hf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--surface);stop-opacity:.96"/><stop offset=".42" style="stop-color:var(--surface);stop-opacity:.9"/><stop offset=".62" style="stop-color:var(--surface);stop-opacity:0"/></linearGradient></defs><rect width="1000" height="470" fill="url(#hg)"/><circle cx="800" cy="120" r="46" style="fill:var(--lime);opacity:.7"/><path d="M0 300 H1000 V470 H0Z" style="fill:var(--sea-1);opacity:.55"/><g style="fill:var(--ink2);opacity:.78"><rect x="860" y="198" width="22" height="104"/><path d="M856 198 L871 176 L886 198Z"/><rect x="864" y="168" width="14" height="10"/></g><g style="fill:var(--ink2);opacity:.55"><rect x="640" y="288" width="120" height="8"/><rect x="650" y="288" width="4" height="22"/><rect x="700" y="288" width="4" height="22"/><rect x="745" y="288" width="4" height="22"/></g><path d="M0 330 C120 308 230 346 350 326 S580 304 720 332 S910 350 1000 326 V470 H0Z" style="fill:var(--emerald);opacity:.22"/><path d="M0 372 C150 350 270 392 410 372 S660 350 810 380 S950 384 1000 366 V470 H0Z" style="fill:var(--gi);opacity:.2"/><path d="M0 418 C130 400 260 436 400 418 S680 402 820 428 S950 430 1000 414 V470 H0Z" style="fill:var(--mint);opacity:.9"/><rect width="1000" height="470" fill="url(#hf)"/></svg>`;

/* ---------- Today home ---------- */
export const heroBlock = () => `<div class="hero"><div class="bg">${harbour}</div>
<h2>Good morning, Enrico.</h2>
<div class="dateline">Today · Monday, 9 November <span title="Hide numbers" style="display:inline-flex">${ic('eye', 18)}</span></div>
<div class="bignum"><b>2h 14m</b><span>captured today</span></div>
<div class="sub">3 meetings · last synced 08:52</div>
<div class="askbar"><span class="peek"><img src="${TIDE('shell')}" alt=""></span>${ic('sparkle', 20)}<span>Ask Tide about your meetings…</span><span class="send">${ic('send', 20)}</span></div>
<div class="chips"><span class="chip">${ic('chat', 18)}Recap last meeting</span><span class="chip">${ic('flag', 18)}What did I promise?</span><span class="chip">${ic('list', 18)}Open actions</span><span class="chip">${ic('globe', 18)}Translate a file</span></div></div>`;

const bar = (icn, nm, sm, v, pct, c, cls = '') => `<div class="brow">${tile(icn, cls)}<span class="nm">${nm}<small>${sm}</small></span><span class="v">${v}</span><span class="bar"><i style="width:${pct}%;--c:${c}"></i></span></div>`;
export const weekBlock = () => `<div class="lc">
<div class="wih">Items this week</div>
<div class="kpi"><b>12</b>${ic('down', 22)}</div>
<div class="delta up">${ic('up', 18)}4 more than last week</div>
<div class="wih" style="margin-top:22px"><span>Where it went</span><span class="grow"></span><span class="sel">Owner: Everyone${ic('down', 16)}</span></div>
<div class="bars">${bar('check', 'Decisions', '3 of 12 items', '3', 25, 'var(--ty-d)')}${bar('flag', 'Actions', '5 of 12 items · 2 yours', '5', 42, 'var(--ty-a)', 'dk2')}${bar('chat', 'Open questions', '1 of 12 items', '1', 8, 'var(--ty-q)')}${bar('bolt', 'Risks', '3 of 12 items', '3', 25, 'var(--ty-r)', 'red')}</div>
<div class="over">${ic('cal', 20)}3 overdue<small>ACT-04 was due 6 Nov · 2 more</small></div></div>`;

const mrow = (t, ti, sm, d, c) => `<div class="mrow"><span class="t">${t}</span><span><b>${ti}</b><small>${sm}</small></span><span class="chip sm ${c}">${d}</span></div>`;
const rail1 = () => `<div class="cd rail1"><span class="eyebrow">Sun 8 Nov</span><h3>Yesterday’s minutes are still open</h3><p>Issue them so owners get their actions.</p><div class="pillb full" style="height:48px">Issue minutes</div></div>`;
export const railBlock = () => `<div class="rc">${rail1()}
<div class="cd"><span class="eyebrow">Today · Mon 9 Nov</span><h3>3 meetings · 2h 14m</h3>${mrow('06:15', 'Toolbox talk', 'Site B · 42 min', 'Done', 'ok')}${mrow('07:00', 'K3 Weekly', 'Site B · 30 min', 'Done', 'ok')}${mrow('07:45', 'Design review', 'Site B · 1h 02m', 'Draft', 'warn')}<small class="mut" style="font-size:13px">Check them, then issue the minutes.</small></div>
<div class="cd"><div style="display:flex;align-items:center;gap:10px"><h3>Helper</h3><span class="grow"></span><span class="chip sm ok">${dot()}Live</span></div><div class="kv"><span>Engine</span><b>Native helper</b></div><div class="kv"><span>Device</span><b>CUDA</b></div><div class="kv"><span>Model</span><b>whisper large-v3-turbo</b></div><div class="kv"><span>Speed</span><b>0.21× real time</b></div></div></div>`;

export const homeMain = ({ markers = false } = {}) => {
  const hero = markers ? NEW(heroBlock(), 'border-radius:28px') : heroBlock();
  const week = markers ? PART(weekBlock(), '') : weekBlock();
  const rail = markers ? PART(railBlock(), '') : railBlock();
  return `${topbar('Today')}${hero}<div class="cols">${week}${rail}</div>`;
};
export const home = (o = {}) => shell('today', homeMain(o), { h: o.h || 1240, dev: o.dev, cls: o.cls || '', w: o.w || 1440 });

/* ---------- Live captions ---------- */
const seg = (items, on, cls = '') => `<span class="seg ${cls}">${items.map((t) => `<span class="${t === on ? 'on' : ''}">${t}</span>`).join('')}</span>`;
const fld = (label, v, icn = 'down') => `<div class="fld"><label>${label}</label><div class="combo"><span>${v}</span>${ic(icn, 16)}</div></div>`;
const surface = (on) => `<div class="cd soft"><div style="display:flex;align-items:center;gap:8px"><h3>Captions show on</h3><span title="Where captions appear">${ic('info', 16)}</span></div>${seg(['Page overlay', 'Island', 'Both'], on, 'gr')}<div class="rg3" style="gap:10px"><div class="srow">${tile('tab')}<span><b>Page overlay</b><small>Over the tab you capture</small></span></div><div class="srow">${tile('island')}<span><b>Island</b><small>Pill under the notch</small></span></div><div class="srow">${tile('grid')}<span><b>Both</b><small>Page and island</small></span></div></div></div>`;

export const live = (state) => {
  const run = state === 'listening';
  const ctl = `<div class="cd"><h3>Capture</h3>
<div class="fld"><label>Source</label>${seg(['Tab audio', 'File', 'Microphone'], 'Tab audio')}</div>
<div class="fld"><label>Mode</label><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${seg(['Offline', 'Realtime'], 'Realtime')}${seg(['Transcribe', '+ Translate'], '+ Translate')}${seg(['Simple', 'Detail'], 'Simple', 'sm')}</div></div>
<div style="display:flex;gap:12px;align-items:flex-end">${fld('From (speech)', 'Bahasa Indonesia')}<span class="mut" style="padding-bottom:12px">${ic('right', 18)}</span>${fld('To (translation)', 'English')}</div>
<div class="srow">${tile('cpu')}<span><b>Engine · Native helper · CUDA</b><small>whisper large-v3-turbo</small></span><span class="grow"></span><span class="btn sm">Change</span></div>
<div style="display:flex;gap:10px"><span class="pillb sm" style="flex:1;${run ? 'background:var(--line);color:var(--muted)' : ''}">${ic('play', 16)}Start Task</span><span class="btn" style="flex:1;${run ? 'background:var(--pill-bg);color:var(--pill-fg);box-shadow:none' : 'color:var(--muted)'}">${ic('stop', 16)}End Task</span></div></div>`;
  let pv;
  if (state === 'idle') pv = `<div class="live"><div class="eyebrow">Live preview</div><div class="empty" style="padding:50px 20px"><h3>Nothing yet</h3><p>Start a task and the speech appears here, with its translation under it.</p></div></div>`;
  else if (state === 'listening') pv = `<div class="live"><div style="display:flex;align-items:center;gap:8px"><span class="eyebrow">Live preview</span><span class="grow"></span><span class="chip sm ok">${dot()}Listening · 00:42</span></div><div class="sp">07:04 · interim</div><div class="sp">Jadi kita sepakat latihannya hari Jumat.</div><div class="cur">Drill evakuasi dipindah ke Jumat jam 07:30, semua kontraktor ikut.</div><div class="tr">The evacuation drill moves to Friday at 07:30; all contractors attend.</div></div>`;
  else if (state === 'needs') pv = `<div class="live"><div class="eyebrow">Live preview</div><div class="callout warn" style="margin-top:12px"><span class="tl amb">${ic('info', 18)}</span><div><b>Needs input.</b> Choose which tab to capture. Chrome asks you once per session.<div class="row"><span class="btn dark sm">Choose tab</span><span class="btn sm">Use a file instead</span></div></div></div></div>`;
  else pv = `<div class="live"><div class="eyebrow">Live preview</div><div class="callout err" style="margin-top:12px"><span class="tl red">${ic('x', 18)}</span><div><b>Captions stopped.</b> The helper did not answer within 5 s. Nothing was lost; the last 42 s are saved.<div class="row"><span class="btn dark sm">Retry</span><span class="btn sm">Switch to the browser engine</span></div></div></div></div>`;
  const main = `${topbar('Live captions')}<div style="display:grid;grid-template-columns:480px minmax(0,1fr);gap:24px;align-items:start"><div style="display:flex;flex-direction:column;gap:20px">${PART(ctl)}</div><div style="display:flex;flex-direction:column;gap:20px">${pv}${NEW(surface(state === 'needs' ? 'Island' : 'Both'))}</div></div>`;
  return shell('live', main, { h: 900 });
};

/* ---------- Ask Tide ---------- */
const lrow = (icn, t, m, r, cls = '') => `<div class="lrow">${tile(icn, cls)}<span><b>${t}</b><small>${m}</small></span><span class="r" ${cls === 'red' ? 'style="color:var(--danger)"' : ''}>${r}</span></div>`;
export const ask = (state) => {
  const composer = `<div class="comp"><span>Ask about your meetings…</span><span class="grow"></span><span class="send off">${ic('send', 20)}</span></div>`;
  const head = `<div class="dh">${ic('sparkle', 20)}Ask Tide<span class="grow"></span><span class="ib">${ic('plus', 20)}</span><span class="ib">${ic('x', 20)}</span></div>`;
  const exported = `<div class="ecard">${tile('grid')}<span><b>Export to Markdown</b><small>Open actions · all series</small></span><span class="ok">Done · 12 rows</span><span class="op">Open ${ic('right', 14)}</span></div>`;
  const q = `<div class="ub">What did I promise this week?</div>`;
  const body = state === 'typing'
    ? `<div class="ub">Export open actions to Markdown</div>${exported}${q}<div class="typing"><span class="avm"><img src="${MARK}" alt=""></span><span class="dots"><i></i><i></i><i></i></span></div>`
    : `${q}<div class="step">${ic('eye', 16)}<span>Looked at 3 meetings, 2–9 Nov</span><span class="grow"></span>${ic('down', 16)}</div>
<div class="ans">You own <b>4 open actions</b> this week. <b>1 is overdue</b>.</div><div class="mut" style="font-size:12px;margin-top:-6px">From your register</div>
<div class="lcard"><div class="lh"><b>Your actions</b><span>2–9 Nov</span><strong>4</strong></div>${lrow('flag', 'Send the incident investigation report to Client HSE', 'Action · K3 Weekly · due 6 Nov', 'Overdue', 'red')}${lrow('flag', 'Move the evacuation drill to Friday 07:30', 'Action · K3 Weekly · due 12 Nov', 'Due Wed', 'dk2')}${lrow('flag', 'Send the toolbox topic sheet', 'Action · Toolbox talk · due 13 Nov', 'Due Thu', 'dk2')}<div class="ft">4 actions in 3 meetings · +1 more</div></div>
<div class="ans">The drill action is due before the drill. Want me to move it to 14 Nov?</div><div class="mut" style="font-size:12px;margin-top:-6px">Local model · Qwen</div>
<div class="acard"><div class="h">${tile('cal')}Change a due date</div><div class="mut" style="font-size:14px">ACT-07 · Move the evacuation drill to Friday 07:30 · 12 Nov to 14 Nov</div><div class="row"><span class="btn">Cancel</span><span class="btn dark">Confirm</span></div></div>`;
  const dlg = `<div class="scrim"></div><div class="dlg">${head}<div class="db">${body}</div>${composer}</div>`;
  return shell('today', homeMain(), { h: 1000, over: dlg });
};

/* ---------- Minutes ---------- */
const ty = (k, t) => `<span class="ty" style="--c:${{ d: 'var(--ty-d)', a: 'var(--ty-a)', q: 'var(--ty-q)', r: 'var(--ty-r)', m: 'var(--ty-m)', n: 'var(--ty-n)' }[k]}">${t}</span>`;
const mrw = (ref, k, t, tx, ow, stt, tc, conf, rv) => `<tr><td class="mono mut">${ref}</td><td>${ty(k, t)}</td><td style="max-width:430px">${tx}${rv ? ` <span class="chip sm warn">${ic('info', 14)}Review</span>` : ''}</td><td>${ow}</td><td>${stt}</td><td class="mono mut">${tc}</td><td class="mono">${conf}</td></tr>`;
export const minutes = (state) => {
  const filt = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="chip sm" style="background:var(--pill-bg);color:var(--pill-fg)">All 13</span><span class="chip sm">Decision 1</span><span class="chip sm">Action 4</span><span class="chip sm">Open question 1</span><span class="chip sm">Risk 2</span><span class="chip sm">Metric 3</span><span class="chip sm">Note 2</span><span class="grow"></span><span class="chip sm warn">Needs review only</span><span class="sel">Group: none${ic('down', 14)}</span><span class="chip sm">${ic('user', 14)}Mine</span></div>`;
  const tbl = `<table class="tt"><tr><th>Ref</th><th>Type</th><th>Item</th><th>Owner</th><th>Status</th><th>Time</th><th>Conf.</th></tr>
${mrw('ACT-01', 'a', 'Action', 'Mei Lin sends the toolbox topic sheet before Friday.', 'Mei Lin', 'Open', '00:01:59', '96%')}
${mrw('DEC-02', 'd', 'Decision', 'The evacuation drill moves to Friday 07:30; all contractors attend.', 'James Miller', 'Done', '00:04:12', '92%')}
${mrw('ACT-03', 'a', 'Action', 'Lars Nilsen sends the incident investigation report to Client HSE on Wednesday.', 'Lars Nilsen', 'Open', '00:06:40', '88%')}
${mrw('RSK-04', 'r', 'Risk', 'The crane lift plan for Block C is not approved yet.', 'Unassigned', 'Open', '00:09:05', '61%', true)}
${mrw('QST-05', 'q', 'Open question', 'Has Client HSE confirmed the near-miss log format?', 'Unassigned', 'Open', '00:11:30', '90%')}
${mrw('MET-06', 'm', 'Metric', 'Near-miss reports this week: 7 (last week 4).', 'Unassigned', 'Noted', '00:14:02', '97%')}</table>`;
  const tabs = `<div class="tabsb"><span class="on">Register</span><span>By topic</span><span>Minutes</span><span>Carry-forward</span><span>Series</span><span>Inbox</span><span>Projects</span><span>Highlights</span></div>`;
  const bar_ = `<div style="display:flex;align-items:center;gap:8px"><span class="combo" style="width:196px;font-size:13px;white-space:nowrap;flex:none">K3 Weekly · Mon 9 Nov 07:00<span>${ic('down', 16)}</span></span><span class="btn">Draft options</span><span class="btn">${ic('book', 16)}Library</span><span class="btn">${ic('sparkle', 16)}Training</span><span class="grow"></span><span class="btn">${ic('plus', 16)}Add item</span><span class="btn">${ic('export', 16)}Export</span><span class="btn">Apply correction</span><span class="pillb sm">Issue MoM</span></div>`;
  const crumb = `<div class="mut" style="font-size:14px;display:flex;gap:8px;align-items:center"><a style="color:var(--gi);font-weight:700">Back to the main page</a>${ic('right', 14)}<span>Minutes</span><span class="grow"></span>${NEW('<span class="seg-o"><span class="lb">Open register</span><a href="#A04d">Classic ↗</a><a href="#A04a">Modern ↗</a></span>')}<span class="btn sm" title="Collapse header">${ic('up', 14)}Collapse header</span><span class="btn sm">${ic('sliders', 14)}Layout & appearance</span></div>`;
  const pop = state === 'layout' ? `<div class="cd" style="position:absolute;right:36px;top:128px;width:330px;z-index:30;gap:14px"><b>Layout & appearance</b><div class="fld"><label>Density</label>${seg(['Review', 'Reading', 'Compact'], 'Review', 'sm')}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="btn sm">Float this panel</span><span class="btn sm">Collapse to rail</span><span class="btn sm">Expand view dock</span><span class="btn sm">Hide</span></div><span class="btn sm">Reset layout</span></div>` : '';
  const prov = `<div class="callout" style="align-items:center"><span class="tl">${ic('info', 18)}</span><span><b>Source:</b> transcript of K3 Weekly, 07:00–07:30. 1 low-confidence item needs a look.</span><span class="grow"></span><span class="btn dark sm">Review 1 low-confidence item</span></div>`;
  const main = `${topbar('Minutes')}${crumb}${bar_}${PART(`<div style="display:flex;flex-direction:column;gap:14px"><div class="chip" style="width:fit-content">13 items · 1 decision · 4 actions · 1 question · 2 risks · 3 metrics · 2 notes</div>${filt}${tabs}${tbl}${prov}</div>`)}${pop}`;
  return shell('minutes', main, { h: 960 });
};

/* ---------- History + Files ---------- */
const hrow = (t, m, d) => `<div class="srow" style="background:var(--surface)">${tile('minutes')}<span><b>${t}</b><small>${m}</small></span><span class="grow"></span><span class="btn sm">Open</span><span class="btn sm">TXT</span><span class="btn sm">SRT</span><span class="btn sm">VTT</span><span class="btn sm danger" title="Delete">${ic('trash', 14)}</span></div>`;
export const history = (state) => {
  let body;
  if (state === 'history') body = `<div class="askf" style="max-width:520px;height:48px">${ic('search', 18)}<span>Search transcripts…</span></div>${hrow('K3 Weekly', 'Mon 9 Nov · 07:00 · 30 min · Bahasa Indonesia to English')}${hrow('Toolbox talk', 'Mon 9 Nov · 06:15 · 42 min')}${hrow('Design review', 'Mon 9 Nov · 07:45 · 1h 02m')}${hrow('Client HSE sync', 'Fri 6 Nov · 14:00 · 36 min')}${hrow('K3 Weekly', 'Mon 2 Nov · 07:00 · 31 min')}<div class="cd soft" style="flex-direction:row;align-items:center;gap:12px">${ic('export', 20)}<span><b>Export formats</b><br><small class="mut">SRT · VTT · TXT · MD · CSV · JSON. Defaults for Windows set the line endings.</small></span></div>`;
  else if (state === 'drop') body = `<div class="cd soft" style="align-items:center;gap:10px;padding:46px;border:2px dashed var(--line)">${tile('upload')}<h3>Drop an audio or video file</h3><p class="mut">Transcribed on this machine. Files up to 2 GiB stream in pieces.</p><span class="pillb sm">Choose…</span></div>`;
  else if (state === 'running') body = `<div class="cd"><div style="display:flex;gap:12px;align-items:center">${tile('files')}<span><b>site-b-toolbox-0911.mp4</b><br><small class="mut">1.2 GB · Bahasa Indonesia to English · Native helper</small></span><span class="grow"></span><span class="btn danger">Cancel</span></div><div class="brow" style="grid-template-columns:1fr auto"><span class="nm">Transcribing <small>window 31 of 51 · 4 min left</small></span><span class="v">61%</span><span class="bar" style="grid-column:1/3;height:10px"><i style="width:61%;--c:var(--green)"></i></span></div></div>`;
  else body = `<div class="cd"><div style="display:flex;gap:12px;align-items:center">${tile('check')}<span><b>site-b-toolbox-0911.mp4</b><br><small class="mut">Done · 4 h 12 min of audio · 51 windows</small></span><span class="grow"></span><span class="chip ok">Done</span></div><div style="display:flex;gap:10px;flex-wrap:wrap"><span class="btn dark">${ic('download', 16)}TXT</span><span class="btn">SRT</span><span class="btn">VTT</span><span class="btn">MD</span><span class="btn">CSV</span><span class="btn">JSON</span></div></div>`;
  const main = `${topbar(state === 'history' ? 'History' : 'Files')}<div class="seg" style="width:fit-content"><span class="${state === 'history' ? 'on' : ''}">History</span><span class="${state === 'history' ? '' : 'on'}">Files</span></div>${PART(`<div style="display:flex;flex-direction:column;gap:14px">${body}</div>`)}`;
  return shell(state === 'history' ? 'history' : 'files', main, { h: 900 });
};

/* ---------- All features ---------- */
const ft = (icn, t, d, on, cls = '') => `<div class="tile2">${tile(icn, cls)}<b>${t}</b><p>${d}</p><div class="ft"><span class="sw ${on ? 'on' : ''}"></span><span class="mut" style="font-size:13px">${on ? 'On' : 'Off'}</span><span class="grow"></span><span class="btn sm">Open</span></div></div>`;
export const features = () => {
  const grid = `<div class="rg4">${ft('mail', 'Recap email', 'Draft a recap after each meeting.', true)}${ft('book', 'Glossary', 'Keep names and terms spelled right.', true)}${ft('cal', 'Due dates to calendar', 'Send due dates to your calendar.', false)}${ft('island', 'Island', 'Captions in a pill under the notch.', true)}${ft('perf', 'Performance', 'Speed and quality of each engine.', true)}${ft('book', 'Library', 'Sample transcripts to try things on.', true)}${ft('sparkle', 'Training', 'Short tours of the register.', false)}${ft('export', 'Export', 'SRT, VTT, TXT, MD, CSV, JSON.', true)}</div>`;
  const add = `<div class="cd"><h3>Installed add-ins</h3><div class="srow">${tile('addins')}<span><b>Recap email ${SAMPLE}</b><small>Asks to read: minutes. Asks to send: nothing.</small></span><span class="grow"></span><span class="btn sm">Review manifest</span><span class="btn dark sm">Trust and enable</span><span class="btn sm danger">Remove</span></div></div>`;
  return shell('all', `${topbar('All features')}${PART(grid)}${add}`, { h: 900 });
};

/* ---------- Settings + Helper ---------- */
const row = (t, d, right) => `<div class="srow" style="background:var(--surface)"><span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span><span class="grow"></span>${right}</div>`;
export const settings = (state) => {
  const tabs = ['General', 'Engine', 'Models', 'Output', 'Add-ins', 'Helper', 'About'];
  const on = { general: 'General', engine: 'Engine', helper: 'Helper' }[state];
  let body;
  if (state === 'general') body = `${row('Language', 'Interface language', '<span class="combo" style="width:200px">English<span>' + ic('down', 16) + '</span></span>')}${row('Appearance', '', seg(['Light', 'Dark'], 'Light', 'sm'))}${row('Theme', '', seg(['Yraverage Klasik', 'Coretax', 'Yraverage Modern'], 'Yraverage Modern', 'sm'))}${row('Accent', '', seg(['Indigo', 'Navy', 'Teal', 'Neutral', 'Bronze'], 'Teal', 'sm'))}${row('Tab rows', '', seg(['One', 'Two'], 'One', 'sm'))}${row('Font size', '24 px', '<span class="bar" style="width:200px;height:6px;border-radius:99px;background:var(--line);position:relative"><i style="position:absolute;left:0;width:60%;height:100%;border-radius:99px;background:var(--gi)"></i></span>')}${row('Density and dock motion', 'Review, Reading, Compact', seg(['Review', 'Reading', 'Compact'], 'Review', 'sm'))}${row('Developer', 'Lab tools in the sidebar', '<span class="sw"></span>')}<span class="btn" style="width:fit-content">Reset to default</span>`;
  else if (state === 'engine') body = `${row('Engine', 'Where captions are made', '<span class="combo" style="width:260px">Native helper (fastest)<span>' + ic('down', 16) + '</span></span>')}${row('Device', 'Helper compute', seg(['Auto', 'CPU', 'GPU (CUDA)'], 'GPU (CUDA)', 'sm'))}${row('Browser engine', 'Used when the helper is off', seg(['WebGPU', 'WASM'], 'WebGPU', 'sm'))}${row('Model source', '', seg(['HuggingFace', 'HF-Mirror'], 'HuggingFace', 'sm'))}${row('Quality', '', seg(['Fast', 'Balanced', 'Accurate'], 'Balanced', 'sm'))}${row('whisper large-v3-turbo', '1.6 GB · installed', '<span class="btn sm">Use</span><span class="btn sm">' + ic('download', 14) + 'Download</span>')}${row('Export folder', 'Where files are saved', '<span class="btn sm">Choose…</span>')}${NEW(row('Captions show on', 'Page overlay, Island or Both', seg(['Page overlay', 'Island', 'Both'], 'Both', 'sm')))}`;
  else body = `<div class="callout"><span class="tl">${ic('cpu', 18)}</span><span><b>Native helper is running.</b> CUDA · whisper large-v3-turbo · 0.21× real time<div class="row"><span class="btn sm">Re-check</span></div></div></div>${row('Install', 'Pick your system', seg(['Windows', 'Linux', 'macOS'], 'Windows', 'sm'))}<div class="cd"><div style="display:flex;gap:10px;align-items:center"><h3>Install</h3><span class="grow"></span>${ic('down', 16)}</div><div class="code">1. Run native\\install.bat\n2. Allow the extension when asked\n3. Press Re-check</div></div><div class="cd"><div style="display:flex;gap:10px;align-items:center"><h3>Troubleshooting</h3><span class="grow"></span>${ic('right', 16)}</div></div><span class="btn" style="width:fit-content">Defaults for Windows</span>`;
  const main = `${topbar('Settings')}<div style="display:flex;gap:12px;align-items:center"><span class="btn">${ic('right', 16)}Back</span><span class="askf" style="width:420px">${ic('search', 18)}<span>Search settings… (e.g. font, model, folder)</span></span></div><div class="tabsb">${tabs.map((t) => `<span class="${t === on ? 'on' : ''}">${t}</span>`).join('')}</div>${PART(`<div style="display:flex;flex-direction:column;gap:12px">${body}</div>`)}`;
  return shell('settings', main, { h: 960 });
};

/* ---------- Developer ---------- */
export const dev = (state) => {
  const tabs = ['Panel', 'Test pages', 'Mock helper', 'Guides and docs'];
  const on = { pages: 'Test pages', mock: 'Mock helper', guides: 'Guides and docs' }[state];
  const lnk = (t, d) => `<div class="srow" style="background:var(--surface)">${tile('link')}<span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span><span class="grow"></span><span class="btn sm">Open</span></div>`;
  let body;
  if (state === 'pages') body = `<details style="display:contents"></details><div class="cd"><h3>All test pages</h3>${lnk('Overlay test', 'test/overlay-test.html')}${lnk('Panel test', 'test/panel-test.html')}${lnk('Offscreen test', 'test/offscreen-test.html')}${lnk('Test page index', '/')}${lnk('CC0 sample credits', '/samples/ATTRIBUTION.md')}</div><div class="cd"><h3>CC0 samples</h3><div style="display:flex;gap:10px"><span class="combo" style="flex:1">Pick a language-pair sample (10–30 s)<span>${ic('down', 16)}</span></span><span class="btn dark">Run sample</span></div></div>`;
  else if (state === 'mock') body = `<div class="cd"><h3>Helper mock</h3><div style="display:flex;gap:16px;align-items:center">${seg(['passthrough', 'offline', 'fixture'], 'fixture', 'sm')}<div class="fld" style="flex:none;width:150px"><label>latencyMs</label><div class="combo">250</div></div><span class="ck"><i>${ic('check', 12)}</i>failNext</span><span class="btn sm">Reset</span><span class="btn sm">Clear</span></div><div class="rg3" style="gap:12px"><div class="code">health fixture JSON\n{ "ok": true,\n  "device": "cuda" }</div><div class="code">device fixture JSON\n{ "device": "cuda",\n  "options": ["auto"] }</div><div class="code">request log\n12:01:03 POST /transcribe 200\n12:01:09 GET /engine/device 200</div></div></div><div class="cd"><h3>Lab status and overlay log</h3><div class="kv"><span>Lab status</span><b>Serving :8799</b></div><div class="kv"><span>Overlay log</span><b>3 lines</b></div></div>`;
  else body = `<div class="cd"><h3>Guides and docs</h3>${lnk('Extension (Bahasa Indonesia)', '/guide.html')}${lnk('macOS', '/guide.html?doc=USER-GUIDE-MACOS.md')}${lnk('Windows and Linux', '/guide.html?doc=USER-GUIDE-WINLINUX.md')}${lnk('DEVELOPMENT.md', 'Build, test, run the lab')}${lnk('QA.md', 'Smoke, E2E, release gate')}${lnk('RELEASE-CHECKLIST.md', 'Before a store upload')}</div>`;
  const main = `${topbar('Developer')}<div class="callout warn"><span class="tl amb">${ic('dev', 18)}</span><span><b>Developer area.</b> On in the lab. Off in the extension unless Settings › Developer is on.</span></div><div style="display:flex;gap:12px;align-items:center"><span class="seg sm"><span class="on">Auto</span><span>Compact</span><span>Wide</span><span>Full</span></span><span class="btn sm">How the lab works</span><span class="btn sm">Minutes register</span></div><div class="tabsb">${tabs.map((t) => `<span class="${t === on ? 'on' : ''}">${t}</span>`).join('')}</div>${PART(`<div style="display:flex;flex-direction:column;gap:14px">${body}</div>`)}`;
  return shell('dev', main, { h: 900, dev: true });
};

/* ---------- States with Tide ---------- */
const sc = (tag, mascot, title, p, extra = '') => `<div class="cd" style="gap:6px"><span class="eyebrow">${tag}</span><div class="empty" style="padding:14px 10px">${mascot ? `<img src="${TIDE(mascot)}" alt="" style="height:${mascot === 'sleep' ? 82 : 96}px">` : `<span class="tl red" style="width:48px;height:48px">${ic('x', 24)}</span>`}<h3>${title}</h3><p>${p}</p>${extra}</div></div>`;
export const states = () => {
  const miniHome = (cls, w, h, z) => `<div style="zoom:${z};width:${w}px;height:${h}px;flex:none;border-radius:20px;overflow:hidden;box-shadow:0 0 0 1px var(--line)">${shell('today', homeMain(), { h, cls, w })}</div>`;
  const m390 = `<div style="zoom:.62;width:390px;height:760px;flex:none;border-radius:28px;overflow:hidden;box-shadow:0 0 0 1px var(--line)"><div class="tide t390" style="width:390px;height:760px"><div class="mbar">${ic('menu', 20)}<img src="${MARK}" alt="" style="width:26px"><span class="wm">yravg<i style="font-style:normal;color:var(--gi)">SubMeetly</i></span></div><main class="mn"><div class="top"><h1>Today</h1></div>${heroBlock()}${rail1()}</main></div></div>`;
  const html = `<div class="tide" style="display:block;width:1440px;padding:30px 36px;background:var(--surface-2)">
<div class="rg3" style="margin-bottom:18px">${sc('Empty', 'sleep', 'No meetings yet', 'Start captions or drop a file. Your first minutes will show up here.', '<span class="pillb sm">Start captions</span>')}${sc('Thinking', 'compass', 'Looking through your meetings…', 'Reading 3 meetings from 2–9 Nov. This stays on your machine.')}${sc('Welcome', 'wave', 'Welcome to yravgSubMeetly', 'Captions, minutes and actions, all on this machine.', '<span class="pillb sm">Install the helper</span>')}</div>
<div class="rg3" style="margin-bottom:22px">${sc('Done', 'celebrate', 'Minutes issued', '5 owners have their actions. Nothing else is open.', '<span class="btn sm">Open minutes</span>')}<div class="cd" style="gap:6px"><span class="eyebrow">Error · no mascot</span><div class="callout err" style="margin-top:10px"><span class="tl red">${ic('x', 18)}</span><div><b>The helper did not answer.</b> Captions stopped after 5 s. Nothing was lost.<div class="row"><span class="btn dark sm">Retry</span><span class="btn sm">Switch to the browser engine</span></div></div></div></div><div class="cd" style="gap:6px"><span class="eyebrow">Locked</span><div class="lockc">${tile('lock')}<span><b>Needs the extension</b><br><small class="mut">Open this page from the side panel to capture a tab.</small></span></div><div class="lockc">${tile('cpu')}<span><b>Needs the helper</b><br><small class="mut">Large files run on the native helper. Install it in Settings › Helper.</small></span></div></div></div>
<div style="display:flex;gap:24px;align-items:flex-start">${miniHome('dk', 1440, 900, 0.44)}${miniHome('t1024', 1024, 700, 0.44)}${m390}</div></div>`;
  return html;
};

/* ---------- K01 tokens ---------- */
const swatch = (n, v, fg = '#0A0F0C', extra = '') => `<div style="border-radius:var(--r);--sw:${v};background:var(--sw);color:${fg === '#0A0F0C' ? 'var(--ink-fg)' : fg === '#E8F2EC' ? 'var(--ink-dk)' : fg === '#fff' ? 'var(--white)' : fg};padding:12px 14px;box-shadow:inset 0 0 0 1px var(--line);display:flex;flex-direction:column;gap:2px"><b style="font-size:14px">${n}</b><span class="mono" style="font-size:12.5px">${v}${extra}</span></div>`;
const panelTokens = (dk) => `<div class="tide ${dk ? 'dk' : ''}" style="display:block;width:714px;padding:26px;background:var(--surface)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><h3 style="font-size:20px">${dk ? 'Dark' : 'Light'}</h3><span class="chip sm">${dk ? '#0B1310 ground' : '#FFFFFF ground'}</span></div>
<div class="rg3" style="gap:10px">${dk
    ? swatch('surface', '#0B1310', '#E8F2EC') + swatch('surface-2', '#111C18', '#E8F2EC') + swatch('mint wash', '#12241B', '#E8F2EC') + swatch('line', '#24372F', '#E8F2EC') + swatch('text', '#E8F2EC') + swatch('muted', '#A3B5AB', '#0A0F0C') + swatch('green-ink', '#4ADE80', '#0A0F0C') + swatch('brand green', '#22C55E', '#0A0F0C') + swatch('danger', '#FF8A80', '#0A0F0C')
    : swatch('surface', '#FFFFFF') + swatch('surface-2', '#F3FBF6') + swatch('mint wash', '#E9F7EE') + swatch('line', '#DCE8E1') + swatch('text', '#0A0F0C', '#fff') + swatch('muted', '#4B5A52', '#fff') + swatch('green-ink', '#0E7A47', '#fff') + swatch('brand green', '#22C55E', '#0A0F0C') + swatch('danger', '#B42318', '#fff')}</div>
<div style="margin:18px 0 8px" class="eyebrow">Type</div><div style="display:flex;align-items:baseline;gap:16px"><span style="font:600 64px/1 var(--disp)">2h 14m</span><span style="font:600 28px var(--disp)">Good morning, Enrico.</span></div><div style="font:800 30px/1.2 var(--sans);margin-top:10px">Items this week</div><div style="font:600 16px/1.45 var(--sans);margin-top:4px">Body is 16 px Plus Jakarta Sans.</div><div style="font:500 13px/1.45 var(--sans);color:var(--muted)">Small text is 13 px and never below 12.</div>
<div style="margin:18px 0 8px" class="eyebrow">Radius and motion</div><div style="display:flex;gap:12px;align-items:center"><span style="width:56px;height:56px;border-radius:8px;background:var(--mint);box-shadow:inset 0 0 0 1px var(--line)"></span><span style="width:56px;height:56px;border-radius:14px;background:var(--mint);box-shadow:inset 0 0 0 1px var(--line)"></span><span style="width:56px;height:56px;border-radius:22px;background:var(--mint);box-shadow:inset 0 0 0 1px var(--line)"></span><span style="width:56px;height:56px;border-radius:999px;background:var(--mint);box-shadow:inset 0 0 0 1px var(--line)"></span><span class="mono mut" style="font-size:12.5px;margin-left:8px">8 · 14 · 22 · pill<br>ease-out .16,1,.3,1 · spring .2,.9,.25,1.12</span></div></div>`;
export const tokens = () => `<div style="display:flex;gap:12px;width:1440px;background:var(--white)">${panelTokens(false)}${panelTokens(true)}</div>`;
export const contrastRows = [
  ['text on surface', '#0A0F0C on #FFFFFF', '19.33', '#E8F2EC on #0B1310', '16.45'],
  ['muted on surface / mint', '#4B5A52 on #FFFFFF / #E9F7EE', '7.28 / 6.59', '#A3B5AB on #0B1310 / #12241B', '8.75 / 7.54'],
  ['green-ink as text', '#0E7A47 on #FFFFFF / #E9F7EE', '5.39 / 4.88', '#4ADE80 on #0B1310 / #12241B', '10.81 / 9.31'],
  ['brand green as text', '#22C55E on #FFFFFF', '2.28 (not text)', 'ink on #4ADE80 fill', '11.09'],
  ['pill label', '#FFFFFF on #0A0F0C', '19.33', '#0A0F0C on #E8F2EC', 'see pill-bg'],
  ['danger text', '#B42318 on #FFFFFF / #FDECEA', '6.57 / 5.75', '#FF8A80 on #0B1310', '8.25'],
  ['warning text', '#8A5A00 on #FFF4D6', '5.41', 'n/a', ''],
];
