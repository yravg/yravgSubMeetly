// ISLAND tier (I01-I10): the Oyenza-style pill and island painted as SubMeetly paper, pure CSS interaction
// (hidden radios/checkboxes + :has, hover opens by clip-path). Works the same in the static page and the Design canvas.
// Motion numbers come from Oyenza Studio crates/poni/src/pill/motion.rs (springs, mass 1) and are written as CSS linear().
export const STATES = ['normal', 'empty', 'error', 'locked', 'needs'];
export const SL = { normal: 'Normal', empty: 'Empty', error: 'Error', locked: 'Locked', needs: 'Needs input' };

/* damped spring step response -> CSS linear() easing and settle time (ms) */
function spring([k, c], pts = 18) {
  const w = Math.sqrt(k), z = c / (2 * w);
  const x = (t) => (z < 1 ? 1 - Math.exp(-z * w * t) * (Math.cos(w * Math.sqrt(1 - z * z) * t) + (z * w / (w * Math.sqrt(1 - z * z))) * Math.sin(w * Math.sqrt(1 - z * z) * t)) : 1 - Math.exp(-w * t) * (1 + w * t));
  let T = 0; for (let t = 0; t < 3; t += 0.002) if (Math.abs(x(t) - 1) > 0.004) T = t;
  T += 0.002;
  const v = Array.from({ length: pts + 1 }, (_, i) => (i === 0 ? '0' : i === pts ? '1' : `${+x((T * i) / pts).toFixed(3)} ${Math.round((i / pts) * 1000) / 10}%`));
  return `${Math.round(T * 1000)}ms linear(${v.join(',')})`;
}
export const SP = { GW: [500, 32.5], GH: [250, 23], SW: [400, 36], SH: [560, 43], RG: [1200, 69.3], RS: [150, 24.5], TOP: [300, 34.6] };
const sp = Object.fromEntries(Object.entries(SP).map(([n, p]) => [n, spring(p)]));

/* extra line icons (the shared set lives in build.mjs) */
const X = {
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  warn: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.01"/>',
  micoff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 11 4.6M12 18v3M4 4l16 16"/>',
  bell: '<path d="M6 17v-6a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/>',
  move: '<path d="M12 4v16M4 12h16M9 7l3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  key: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  retry: '<path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/>',
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  battery: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3M6 11v3"/>',
  vol: '<path d="M4 10v4h3.5l4.5 3.5v-11L7.5 10zM16 9.5a4 4 0 0 1 0 5"/>',
  fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

export function makeIsland({ ic, typeTag, st }) {
  const ico = (n, s = 16) => (X[n] ? `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${X[n]}</svg>` : ic(n, s));
  /* colourful icon tile: hue token at 100% for the glyph, 12% wash for the tile (glyph/tile contrast checked in the report) */
  const it = (n, hue = 'decision', s = 26) => `<span class="it" style="--c:${hue === 'ok' ? 'var(--ok)' : `var(--t-${hue})`};width:${s}px;height:${s}px">${ico(n, Math.round(s * 0.6))}</span>`;
  const V = (sts, html, tag = 'div') => `<${tag} class="s ${sts.map((s) => 's-' + s).join(' ')}">${html}</${tag}>`;
  const S = (o, tag) => Object.entries(o).map(([k, v]) => V(k.split('+'), v, tag)).join('');
  const lab = (id, html, cls = '') => `<label for="${id}" class="${cls}">${html}</label>`;

  /* remaining-count text from N checkboxes (no JS): one rule per subset of ticked boxes */
  const countCss = (cls, n) => {
    let out = '';
    for (let m = 0; m < 1 << n; m++) {
      const sel = Array.from({ length: n }, (_, i) => (m & (1 << i) ? `:has(.${cls}${i + 1}:checked)` : `:not(:has(.${cls}${i + 1}:checked))`)).join('');
      out += `.isl${sel} .c${cls}${n - [...Array(n).keys()].filter((i) => m & (1 << i)).length}{display:inline}`;
    }
    return out;
  };
  const cnt = (cls, n) => Array.from({ length: n + 1 }, (_, k) => `<span class="cn c${cls}${k}">${k}</span>`).join('');

  /* ---------- pages ---------- */
  const PAGES = [
    { k: 'live', label: 'Live', icon: 'live', ph: 232 },
    { k: 'meet', label: 'Meeting', icon: 'list', ph: 268 },
    { k: 'inbox', label: 'Inbox', icon: 'inbox', ph: 232 },
    { k: 'addins', label: 'Add-ins', icon: 'grid', ph: 338 },
    { k: 'timer', label: 'Timer', icon: 'timer', ph: 232, addin: 'timer' },
    { k: 'talk', label: 'Talk time', icon: 'pie', ph: 232, addin: 'talk' },
    { k: 'engine', label: 'Engine', icon: 'cpu', ph: 232, addin: 'engine' },
    { k: 'settings', label: 'Settings', icon: 'gear', ph: 336, gear: true },
  ];
  const W = (n, o, keep) => keep ? S(o) + n : S({ [o.empty ? 'normal' : 'normal+empty']: n, ...o });
  const callout = (icon, hue, title, text, btns = '') => `<div class="cal">${it(icon, hue, 30)}<div><b>${title}</b><span class="dim">${text}</span></div>${btns}</div>`;
  const sec = '<span class="sec"></span>';

  const rowList = (id, cls, items, btn, btn2) => `<div class="rl">${items.map(([t, label, text], i) => `<div class="row row${i + 1}"><input type="checkbox" class="cb ${cls}${i + 1}" id="${id}-${cls}${i + 1}"><div class="rc">${typeTag(t, label)}<span class="mt ell">${text}</span><span class="grow"></span>${btn ? lab(`${id}-${cls}${i + 1}`, btn, 'btn p') : ''}${btn2 ? `<span class="btn">${btn2}</span>` : ''}</div></div>`).join('')}</div>`;

  function pageHtml(id, k) {
    if (k === 'live') {
      const pz = (on) => `<label for="${id}-pz" class="ib2" aria-label="Pause or resume">${ic('pause', 18)}${ic('play', 18)}</label>`;
      const ctl = (sub) => `<div class="ictl"><div class="tm"><i class="rec big"></i><b class="mono">12:${sec}</b><span class="pzt">Paused</span></div><span class="dim">Rapat Komite K3 · W01</span><div class="ibtns">${pz()}${lab(`${id}-st-empty`, ic('stop', 18), 'ib2 stop')}</div>${sub}</div>`;
      const eng = '<span class="dim small">zh to en · Rust engine · CUDA <span class="tgx" title="Target state: the CUDA build is not done yet">target</span></span>';
      const lines = `<div class="ilines"><p class="dim">Lars: incident investigation report sudah selesai.</p><p class="now">Drill evakuasi dipindah ke Jumat 07:30.</p><p class="tr">Evacuation drill moved to Friday 07:30.</p>${['d', 'a', 'q'].map((c) => `<p class="chipl chipl-${c}">${typeTag(c, { d: 'Decision', a: 'Action', q: 'Question' }[c])}<span>Drill evakuasi dipindah ke Jumat 07:30</span></p>`).join('')}<div class="qcap"><label for="${id}-qd" class="kb">Ctrl Alt D</label><label for="${id}-qa" class="kb">A</label><label for="${id}-qq" class="kb">Q</label><span class="dim small">mark the last line</span></div></div>`;
      return S({
        normal: `<div class="ilive">${ctl(eng)}${lines}</div>`,
        needs: `<div class="ilive">${ctl(eng)}${lines.replace('</div></div>', `</div><div class="ban">${it('flag', 'risk', 22)}<span><span class="cn c3 on">3</span> wait on you</span>${lab(`${id}-pg-meet`, 'Review', 'btn p')}</div></div>`)}</div>`,
        error: `<div class="ilive">${ctl('<span class="dim small">zh to en · browser engine</span>')}<div class="ilines">${callout('warn', 'risk', 'Helper offline', 'Captions continue on the browser engine: slower, no CUDA. Your text is not lost.', `<span class="btn p">Retry</span>`)}<p class="now">Drill evakuasi dipindah ke Jumat 07:30.</p></div></div>`,
        locked: `<div class="ilive"><div class="ictl"><div class="tm"><i class="rec big off"></i><b class="mono">00:00</b></div><span class="dim">Rapat Komite K3 · W01</span><div class="ibtns"><span class="ib2 dis">${ic('play', 18)}</span></div><span class="dim small">Not listening</span></div><div class="ilines">${callout('micoff', 'risk', 'Microphone is blocked', 'Allow it for this browser, then press Ctrl Alt S. Nothing is recorded until then.', `<span class="btn p">How to allow</span>`)}</div></div>`,
        empty: `<div class="ilive"><div class="ictl"><div class="tm"><i class="rec big off"></i><b class="mono">00:00</b></div><span class="dim">Rapat Komite K3 · W01</span><div class="ibtns">${lab(`${id}-st-normal`, ic('play', 18), 'ib2 go')}</div><span class="dim small">zh to en · ready</span></div><div class="ilines empty"><p><b>Not listening.</b></p><p class="dim">Ctrl Alt S to start, or press play.</p><p class="dim small">Last meeting: W52 · 6 decisions, 4 actions</p></div></div>`,
      });
    }
    if (k === 'meet') {
      const items = [['d', 'Decision', 'Drill evakuasi dipindah ke Jumat 07:30'], ['q', 'Question', 'Konfirmasi Client HSE soal near-miss log?'], ['a', 'Action', 'Mei · toolbox topic sheet · Fri']];
      const live = (ro) => `<div class="dic"><div class="dic-h">${ic('flag', 15)}<span>${cnt('m', 3)} wait on you</span></div>${rowList(id, 'm', items, ro ? '' : 'Accept', ro ? '' : 'Edit')}<div class="clear">All clear. Nothing waits on you.</div></div><div class="toast">${ic('check', 14)} Accepted in register</div><div class="qcap"><span class="kbd">Ctrl</span><span class="kbd">Alt</span><span class="kbd">D</span><span class="dim">mark the last line as a decision · A action · Q question</span></div>`;
      return S({
        'normal+needs': live(),
        empty: `<div class="empx">${it('check', 'ok', 34)}<b>Nothing waits on you in this meeting.</b><span class="dim">Decisions, questions and actions that need a person appear here as buttons.</span></div>`,
        error: callout('warn', 'risk', 'Register not reachable', 'Three items wait here. They are kept on this device and sync when the helper is back.', '<span class="btn p">Retry</span>') + `<div class="dic ghost"><div class="dic-h">${ic('flag', 15)}<span>3 wait on you</span></div>${items.map(([t, l, x]) => `<div class="mrow">${typeTag(t, l)}<span class="mt ell">${x}</span></div>`).join('')}</div>`,
        locked: callout('lock', 'info', 'W01 is issued and locked', 'Items are read-only. Amend the minutes in Minutes to change them.', '<span class="btn">Open Minutes</span>') + `<div class="dic ghost"><div class="dic-h">${ic('flag', 15)}<span>3 on record</span></div>${items.map(([t, l, x]) => `<div class="mrow">${typeTag(t, l)}<span class="mt ell">${x}</span></div>`).join('')}</div>`,
      });
    }
    if (k === 'inbox') {
      const items = [['a', 'Action', 'Mei Lin · toolbox topic sheet · due Fri 20 Feb'], ['q', 'Question', 'Client HSE near-miss log confirmation'], ['a', 'Action', 'Lars Nilsen · report to Client HSE · due Wed 18 Feb'], ['r', 'Risk', 'Heat stress control not reviewed since W51']];
      const live = (ro) => `<div class="dic"><div class="dic-h">${ic('inbox', 15)}<span>${cnt('i', 4)} open across meetings</span></div>${rowList(id, 'i', items, ro ? '' : 'Done', ro ? '' : 'Snooze')}<div class="clear">Inbox zero.</div></div>`;
      return S({
        'normal+needs': live(),
        empty: `<div class="empx">${it('check', 'ok', 34)}<b>Inbox zero.</b><span class="dim">Next meeting of the series: W02 · Tue 24 Feb 07:00. Carried items land here.</span></div>`,
        error: callout('warn', 'risk', 'Inbox is out of date', 'The register could not be read. Showing what was loaded at 07:05.', '<span class="btn p">Retry</span>'),
        locked: callout('lock', 'info', 'Series locked', 'W01 is issued. Open items are listed in Minutes, read-only.', '<span class="btn">Open Minutes</span>'),
      });
    }
    if (k === 'addins') {
      const rows = [['timer', 'Agenda timer', 'Time-boxes each agenda point; the pill counts down the current one.', 'Built in', 'timer', 'decision', 1], ['pie', 'Talk time', 'Who spoke how long, from the diarised segments. Stays on this device.', 'Built in', 'talk', 'metric', 0], ['book', 'Glossary', 'Project terms and names fed to ASR and translation, per series.', '12 KB', 'glos', 'question', 0], ['bolt', 'Quick capture', 'Hotkeys that turn the last line into a decision, action or question.', 'Built in', 'qc', 'action', 1], ['cc', 'Caption style', 'Size, position and two-line layout of the on-screen subtitle overlay.', 'Built in', 'cap', 'info', 0], ['drop', 'Drop to transcribe', 'Drop an audio or video file on the island; it lands in History.', 'Built in', 'drop', 'ok', 0], ['cpu', 'Engine monitor', 'CPU / GPU load and real-time factor of the Rust engine, last minute.', 'Built in', 'engine', 'risk', 0]];
      const ban = S({ normal: '<p class="dim small intro">Each add-in stays off until you switch it on. Switching off deletes anything it downloaded.</p>', needs: `<div class="ban">${it('flag', 'action', 22)}<span>Agenda timer needs an agenda: add items in Minutes first.</span><span class="btn p">Add agenda</span></div>`, empty: '<p class="dim small intro">No add-in downloaded yet. Built-in ones need no download.</p>', error: `<div class="ban">${it('warn', 'risk', 22)}<span>Helper offline: Engine monitor and Drop to transcribe wait for it.</span></div>`, locked: `<div class="ban">${it('lock', 'info', 22)}<span>Downloads are blocked on this PC. Built-in add-ins still work.</span></div>` });
      return `${ban}<div class="adl">${rows.map(([i, n, d, sz, key, hue]) => `<div class="adr">${it(i, hue, 28)}<b>${n}</b><span class="dim">${d}</span><span class="dim small">${sz}</span><label class="sw" for="${id}-ad-${key}"><i></i></label></div>`).join('')}</div>`;
    }
    if (k === 'timer') {
      const ag = ['Opening, W52 actions', 'Emergency drill', 'Incident investigation report', 'Toolbox topics', 'Next steps'];
      return W(`<div class="tim"><div class="ringw"><svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--fill)" stroke-width="7"/><circle class="rgc" cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/></svg><div class="rgt"><b class="mono">07:48</b><span class="dim small">left</span></div></div><div class="agl"><div class="lbl">Agenda · item 2 of 5</div>${ag.map((a, i) => `<label class="agr"><input type="checkbox" class="ag" ${i === 0 ? 'checked' : ''}><i class="bx">${ic('check', 12)}</i><span>${a}</span><span class="dim small mono">${['5:00', '10:00', '8:00', '5:00', '2:00'][i]}</span></label>`).join('')}</div></div>`, { empty: `<div class="empx">${it('timer', 'info', 34)}<b>No agenda yet</b><span class="dim">Add items in Minutes and the pill counts down the current one.</span></div>`, error: callout('warn', 'risk', 'Agenda could not be read', 'The timer shows the last times it knew. Elapsed time keeps running.', '<span class="btn p">Retry</span>'), locked: callout('lock', 'info', 'Meeting issued', 'W01 is issued. The timer is stopped and the agenda is read-only.'), needs: callout('flag', 'action', 'Two items have no time', 'Set minutes for Toolbox topics and Next steps.', '<span class="btn p">Open agenda</span>') });
    }
    if (k === 'talk') {
      const sp = [['Lars Nilsen', 38, 'decision'], ['Mei Lin', 27, 'ok'], ['James Miller', 21, 'question'], ['Ayu Pratama', 14, 'action']];
      return W(`<p class="dim small intro">From diarised segments, this device only. Last 12 min.</p><div class="tkl">${sp.map(([n, p, h], i) => `<div class="tkr"><span>${n}</span><span class="tbar"><i style="--c:${h === 'ok' ? 'var(--ok)' : `var(--t-${h})`};--w:${p / 40};animation-delay:calc(var(--dw) + ${0.4 + i * 0.08}s)"></i></span><b class="mono">${p}%</b></div>`).join('')}</div>`, { empty: `<div class="empx">${it('pie', 'metric', 34)}<b>Nobody has spoken yet</b><span class="dim">Bars appear after the first diarised segment.</span></div>`, error: callout('warn', 'risk', 'Speakers are not labelled', 'Diarisation is off, so talk time cannot be split by person.', '<span class="btn p">Turn on</span>'), locked: callout('lock', 'info', 'Talk time is hidden', 'The series owner turned it off for this meeting.'), needs: callout('flag', 'action', 'Name two speakers', 'Speaker 3 and Speaker 4 carry 18% of the time.', '<span class="btn p">Name them</span>') });
    }
    if (k === 'engine') {
      const bars = [5, 6, 8, 7, 9, 12, 14, 11, 9, 8, 10, 9, 7, 6, 8, 9];
      return W(`<div class="engp">${[['CPU', '18%', 'risk'], ['GPU', '64%', 'metric'], ['Real-time', '0.42×', 'ok']].map(([n, v, h]) => `<div class="kpi">${it('cpu', h, 24)}<span class="dim small">${n}</span><b class="mono">${v}</b></div>`).join('')}</div><div class="spk" aria-label="GPU load, last minute">${bars.map((b, i) => `<i style="height:${b * 3.2}px;animation-delay:${i * 60}ms"></i>`).join('')}</div><p class="dim small">Rust engine · CUDA <span class="tgx">target</span> · 16 samples, last minute</p>`, { empty: `<div class="empx">${it('cpu', 'info', 34)}<b>Engine idle</b><span class="dim">The monitor starts with the first caption.</span></div>`, error: callout('warn', 'risk', 'Helper offline', 'No load figures. Captions run on the browser engine.', '<span class="btn p">Retry</span>'), locked: callout('lock', 'info', 'GPU access blocked', 'This PC policy blocks CUDA. The engine runs on CPU.'), needs: callout('flag', 'action', 'Pick a device', 'Auto found CPU and GPU. Choose one for this meeting.', '<span class="btn p">Choose</span>') });
    }
    if (k === 'settings') {
      const TCS = [['indigo', 'Indigo', 1], ['navy', 'Navy'], ['teal', 'Teal'], ['neutral', 'Neutral'], ['bronze', 'Bronze']];
      const seg = (name, opts) => `<span class="sgm">${opts.map(([v, l, on]) => `<label><input type="radio" name="${id}-${name}" class="${name}-${v}" ${on ? 'checked' : ''}><span>${l}</span></label>`).join('')}</span>`;
      return W(`<div class="iset">
    <div class="srow"><span class="lbl">Theme</span>${seg('th', [['p', 'SubMeetly paper', 1], ['d', 'SubMeetly dark'], ['c', 'Classic']])}<span class="dim small th-n">paper only in this drawing</span></div>
    <div class="srow"><span class="lbl">Shape</span>${seg('sh', [['pill', 'Pill', 1], ['notch', 'Notch']])}<span class="dim small">Pill floats 8 px below the top edge</span></div>
    <div class="srow"><span class="lbl">While captioning</span>${seg('cp', [['line', 'Show line', 1], ['dot', 'Dot only'], ['hide', 'Hide']])}</div>
    <div class="srow"><span class="lbl">Open on hover after</span>${seg('hv', [['q', '0.22 s', 1], ['n', '1.5 s'], ['s', '3 s'], ['off', 'Off']])}<span class="dim small">0.22 s = default, as Oyenza</span></div>
    <div class="srow"><span class="lbl">Translation colour</span>${TCS.map(([v, l, on]) => `<label class="tcs" title="${l}"><input type="radio" name="${id}-tc" class="tc-${v}" aria-label="${l}" ${on ? 'checked' : ''}><i></i></label>`).join('')}<span class="tcprev">Evacuation drill moved to Friday 07:30.</span></div>
    <div class="srow"><span class="lbl">Display</span>${seg('dp', [['m', 'Main', 1], ['f', 'Follow mouse']])}</div>
    <div class="srow"><span class="lbl">Full-screen apps</span><label class="sw" for="${id}-hfs"><i></i></label><span class="dim small">hide the island there</span></div>
  </div>`, { error: callout('warn', 'risk', 'Settings were not saved', 'The disk is full. Changes last until you close the island.', '<span class="btn p">Retry</span>'), locked: callout('lock', 'info', 'Managed by your admin', 'Shape and Display are fixed on this PC.'), needs: callout('flag', 'action', 'Choose a display', 'Two screens found. Pick which one shows the island.') }, 1);
    }
  }

  /* ---------- the island ---------- */
  const pw = { normal: 560, empty: 270, error: 400, locked: 330, needs: 300 };
  const pillHtml = (id) => `<div class="pillc">${S({
    normal: `<i class="rec"></i><span class="mono">12:${sec}</span><span class="cap ell">Drill evakuasi dipindah ke Jumat 07:30</span><span class="trs ell">Evacuation drill moved to Friday 07:30</span><span class="dotl dim small">recording · captions hidden</span>`,
    empty: `<span class="wmi">SubMeetly</span><span class="dim small">ready · Ctrl Alt S</span>`,
    error: `${it('warn', 'risk', 24)}<b>Helper offline</b><span class="dim small">browser engine · 12:${sec}</span>`,
    locked: `${it('micoff', 'risk', 24)}<b>Microphone blocked</b><span class="chip">Fix</span>`,
    needs: `${it('flag', 'action', 24)}<b><span class="cn c3 on">3</span> wait on you</b>`,
  })}<span class="slot"><span class="eq"><i></i><i></i><i></i></span><svg class="arm" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/></svg></span></div>`;

  function island(id, { start = 'live', ads = ['timer', 'qc'], w = 680 } = {}) {
    const tab = (p) => `<label class="tab t-${p.k}${p.gear ? ' gear' : ''}" for="${id}-pg-${p.k}">${ic(p.icon, 15)}<span class="tl"><span>${p.label}</span></span></label>`;
    const tabs = `<div class="itabs">${PAGES.filter((p) => !p.gear).map(tab).join('')}<span class="grow"></span>${tab(PAGES.find((p) => p.gear))}<span class="dim sm">Tue 17 Feb</span><b class="mono">07:12</b></div>`;
    const inputs = PAGES.map((p) => `<input type="radio" class="rp rp-${p.k}" name="${id}-pg" id="${id}-pg-${p.k}" ${p.k === start ? 'checked' : ''}>`).join('')
      + ['timer', 'talk', 'glos', 'qc', 'cap', 'drop', 'engine'].map((a) => `<input type="checkbox" class="ad ad-${a}" id="${id}-ad-${a}" ${ads.includes(a) ? 'checked' : ''}>`).join('')
      + `<input type="checkbox" class="pz" id="${id}-pz"><input type="checkbox" class="hfs" id="${id}-hfs" checked>` + ['d', 'a', 'q'].map((c) => `<input type="checkbox" class="qk qk-${c}" id="${id}-q${c}">`).join('');
    return `<div class="ptop" style="top:10px"><span class="newtag" style="left:0;top:-4px">NEW</span><div class="isl" id="${id}-isl" style="--W:${w}px;${STATES.map((s) => `--pw-${s}:${pw[s]}px`).join(';')}">${inputs}${pillHtml(id)}<div class="ibody">${tabs}<div class="ipg">${PAGES.map((p) => `<div class="ipage ip-${p.k}">${pageHtml(id, p.k)}</div>`).join('')}</div></div></div></div>`;
  }

  /* ---------- controls shared by every island board ---------- */
  const ctl = (id, o = {}) => {
    const def = o.def || 'normal';
    const pre = STATES.map((s) => `<input type="radio" class="rs rs-${s}" name="${id}-st" id="${id}-st-${s}" ${s === def ? 'checked' : ''}>`).join('')
      + `<input type="radio" class="rb rb-after" name="${id}-ba" id="${id}-ba-a" checked><input type="radio" class="rb rb-before" name="${id}-ba" id="${id}-ba-b">`
      + `<input type="checkbox" class="pin" id="${id}-pin">` + (o.dwell === false ? '' : `<input type="radio" class="rd rd-n" name="${id}-dw" id="${id}-dw-n"><input type="radio" class="rd rd-q" name="${id}-dw" id="${id}-dw-q" checked>`);
    const bar = `<div class="ctlbar"><div class="grp"><span class="lbl">State</span>${STATES.map((s) => `<label class="vw vs l-${s}" for="${id}-st-${s}">${SL[s]}</label>`).join('')}</div>`
      + `<div class="grp"><span class="lbl">View</span><label class="vw vba l-after" for="${id}-ba-a">After</label><label class="vw vba l-before" for="${id}-ba-b">Before</label></div>`
      + (o.dwell === false ? '' : `<div class="grp"><span class="lbl">Hover delay</span><label class="vw vs l-dq" for="${id}-dw-q">0.22 s (default, as Oyenza)</label><label class="vw vs l-dn" for="${id}-dw-n">1.5 s (film)</label></div>`)
      + `<div class="grp"><label class="vw vs l-pin" for="${id}-pin">${ico('pin', 13)} Keep island open</label></div></div>`;
    return { pre, bar };
  };
  const beforeLayer = (txt) => `<div class="ba-before"><div class="bef"><b>Today</b>${txt}</div></div>`;
  const desk = (after, before, extra = '') => `<div class="desk" style="height:641px"><img src="shots/minutes-coretax.png" alt="Minutes register behind the island (real screenshot)">${beforeLayer(before)}<div class="ba-after">${after}</div>${extra}</div>`;
  const BEF = 'Nothing sits at the top of the screen. Captions live inside the side panel or the Minutes tab, so they vanish when you switch windows.';

  /* ---------- css ---------- */
  const pageCss = PAGES.map((p, i) => {
    const after = PAGES.slice(i + 1).map((q) => `.ip-${q.k}`).join(','), before = PAGES.slice(0, i).map((q) => `.ip-${q.k}`).join(',');
    return `.isl:has(.rp-${p.k}:checked){--ph:${p.ph}px}.isl:has(.rp-${p.k}:checked) .ip-${p.k}{opacity:1;translate:0 0;visibility:visible;transition:opacity .26s ease-out,translate .26s var(--e-out),visibility 0s}.isl:has(.rp-${p.k}:checked) .t-${p.k}{background:var(--gold);color:var(--text)}.isl:has(.rp-${p.k}:checked) .t-${p.k}{grid-template-columns:auto 1fr}.isl:has(.rp-${p.k}:checked) .t-${p.k} .tl{opacity:1}`
      + (before ? `.isl:has(.rp-${p.k}:checked) :is(${before}){translate:-20px 0}` : '') + (after ? `.isl:has(.rp-${p.k}:checked) :is(${after}){translate:20px 0}` : '');
  }).join('');
  const addinCss = PAGES.filter((p) => p.addin).map((p) => `.isl:not(:has(.ad-${p.addin}:checked)) :is(.t-${p.k},.ip-${p.k}){display:none}.isl:has(.rp-${p.k}:checked):not(:has(.ad-${p.addin}:checked)) .ip-addins{opacity:1;translate:0 0;visibility:visible}.isl:has(.ad-${p.addin}:checked) .t-${p.k}{display:inline-grid}`).join('');
  const stateCss = STATES.map((s) => `.board:has(.rs-${s}:checked) .s:not(.s-${s}){display:none}.board:has(.rs-${s}:checked) .isl{--pw:var(--pw-${s})}.board:has(.rs-${s}:checked) .l-${s}{background:var(--navy);color:var(--white)}`).join('');
  const css = `
@property --ix{syntax:'<length>';inherits:false;initial-value:0px}
@property --iy{syntax:'<length>';inherits:false;initial-value:0px}
@property --ig{syntax:'<length>';inherits:false;initial-value:0px}
@property --ir{syntax:'<length>';inherits:false;initial-value:20px}
@property --sc{syntax:'<integer>';inherits:false;initial-value:0}
.desk{position:relative;width:1140px;overflow:hidden;border-radius:12px;--e-out:cubic-bezier(.25,1,.5,1)}.desk>img{width:100%;display:block}
.ba-after,.ba-before{position:absolute;inset:0}.bef{position:absolute;top:14px;left:50%;translate:-50% 0;width:520px;text-align:center;font-size:var(--text-sm);color:var(--text);background:color-mix(in srgb,var(--white) 92%,transparent);border-radius:var(--radius-lg);padding:10px 16px;box-shadow:var(--ring)}.bef b{display:block;font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.board:has(.rb-before:checked) .ba-after{display:none}.board:not(:has(.rb-before:checked)) .ba-before{display:none}.board:has(.rb-before:checked) .l-before,.board:has(.rb-after:checked) .l-after,.board:has(.rd-n:checked) .l-dn,.board:has(.rd-q:checked) .l-dq,.board:has(.pin:checked) .l-pin{background:var(--navy);color:var(--white)}
.board>input,.isl input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.ctlbar{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:6px}.ctlbar .grp{display:flex;gap:6px;align-items:center}.ctlbar .lbl{margin-right:4px}.ctlbar .vw{font:600 11.5px/1 var(--monoc);padding:7px 11px;border-radius:99px;background:var(--side-2);color:var(--ink);cursor:pointer;display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line-2)}.ctlbar .vw:hover{border-color:var(--navy)}.board:has(input:focus-visible) .ctlbar .vw:hover{outline:0}
${stateCss}${pageCss}.board:is(:has(.rs-error:checked),:has(.rs-locked:checked),:has(.rs-needs:checked)) .isl:has(.rp-settings:checked){--ph:406px}
${addinCss}
${countCss('m', 3)}${countCss('i', 4)}
.cn{display:none}.cn.on{display:inline}
.ptop{position:absolute;left:50%;translate:-50% 0;width:680px;height:410px;filter:drop-shadow(0 18px 20px rgba(33,44,95,.16)) drop-shadow(0 0 .5px rgba(33,44,95,.5));pointer-events:none;transition:translate .44s var(--e-out),opacity .2s}
.ptop .newtag{z-index:4}
.isl{--H:410px;--pw:var(--pw-normal);--dw:var(--dwell,.22s);--oh:calc(56px + var(--ph,232px));--ig:calc(var(--H) - var(--oh));--ix:calc((var(--W) - var(--pw)) / 2);--iy:calc(var(--H) - 40px - var(--ig));--ir:20px;position:relative;width:var(--W);height:var(--H);margin:0 auto;background:var(--bg);color:var(--text);font-size:var(--text-md);pointer-events:auto;clip-path:inset(0 var(--ix) calc(var(--iy) + var(--ig)) var(--ix) round var(--ir));transition:--ix ${sp.SW},--iy ${sp.SH},--ir ${sp.RS},--ig ${sp.GH}}
.isl:hover,.board:has(.pin:checked) .isl{--ix:0px;--iy:0px;--ir:28px;transition:--ix ${sp.GW} var(--dw),--iy ${sp.GH} var(--dw),--ir ${sp.RG} var(--dw),--ig ${sp.GH}}
.board:has(.pin:checked) .isl{--dw:0s}
.board:has(.hv-q:checked){--dwell:.22s}.board:has(.hv-s:checked){--dwell:3s}.board:has(.hv-off:checked){--dwell:600s}.board:has(.hv-n:checked){--dwell:1.5s}.board.board:has(.rd-n:checked){--dwell:1.5s}
.board:has(.sh-notch:checked) .isl{clip-path:inset(0 var(--ix) calc(var(--iy) + var(--ig)) var(--ix) round 0 0 var(--ir) var(--ir))}.board:has(.sh-notch:checked) .ptop{top:0!important}
.pillc{position:absolute;top:0;left:50%;translate:-50% 0;width:var(--pw);height:40px;display:flex;align-items:center;justify-content:center;gap:10px;padding:0 16px;white-space:nowrap;opacity:1;transition:opacity .24s ease-out .2s;font-weight:var(--font-medium)}
.isl:hover .pillc,.board:has(.pin:checked) .pillc{opacity:0;transition:opacity .12s ease-in var(--dw)}
.pillc .cap{flex:1 1 auto;min-width:0}.pillc .trs{color:var(--tc,var(--ai));font-size:var(--text-sm);flex:0 1 190px;min-width:0}.pillc .dotl,.pillc .s .dotl{display:none}.pillc .mono{font-weight:var(--font-medium)}
.board:has(.cp-dot:checked) .pillc :is(.cap,.trs){display:none}.board:has(.cp-dot:checked) .pillc .dotl{display:inline}.board:has(.cp-hide:checked) .pillc{opacity:.18}
.wmi{font-weight:var(--font-bold)}.isl .chip{background:var(--gold);color:var(--text);border-radius:99px;padding:3px 10px;font-size:var(--text-xs);font-weight:var(--font-semibold)}
.rec{position:relative;width:9px;height:9px;border-radius:50%;background:var(--danger);display:inline-block;flex:none}.rec.big{width:12px;height:12px}.rec.off{background:var(--muted)}
.rec::after{content:'';position:absolute;inset:-4px;border-radius:50%;background:var(--danger);opacity:0;animation:recp 1.2s ease-out infinite}.rec.off::after{display:none}
@keyframes recp{0%{scale:.55;opacity:.4}100%{scale:1.5;opacity:0}}
.eq{display:inline-flex;gap:2px;align-items:center;height:20px;transition:opacity .2s}.eq i{width:3px;border-radius:2px;background:var(--accent);animation:eqb 1.1s ease-in-out infinite;transform-origin:center}.eq i:nth-child(1){height:8px}.eq i:nth-child(2){height:14px;animation-delay:-.35s}.eq i:nth-child(3){height:10px;animation-delay:-.7s}
@keyframes eqb{0%,100%{scale:1 .55}50%{scale:1 1}}
.slot{position:relative;width:22px;height:22px;flex:none;display:grid;place-items:center}.slot .eq{position:absolute}.arm{position:absolute;inset:0;rotate:-90deg;opacity:0;transition:opacity .2s}.arm circle{stroke-dashoffset:1}
.board:is(:has(.rs-empty:checked),:has(.rs-locked:checked)) .slot .eq{display:none}.isl:hover .slot .eq{opacity:0}.isl:hover .arm{opacity:1}.isl:hover .arm circle{stroke-dashoffset:0;transition:stroke-dashoffset var(--dw) linear}
.isl:has(.pz:checked) .eq i,.isl:has(.pz:checked) .sec::before{animation-play-state:paused}.isl:has(.pz:checked) .rec::after{display:none}
.sec::before{counter-reset:sc var(--sc);content:counter(sc,decimal-leading-zero);animation:sec 60s steps(60,jump-end) infinite;animation-delay:-4s}.sec{display:inline-block}.sec::before{display:inline}
@keyframes sec{from{--sc:0}to{--sc:60}}
.ibody{position:absolute;inset:0 0 auto 0;height:100%;padding:12px 18px 0;opacity:0;scale:.97;transform-origin:50% 0;visibility:hidden;transition:opacity .12s ease-in,scale .14s ease-in,visibility 0s .12s}
.isl:hover .ibody,.board:has(.pin:checked) .ibody{opacity:1;scale:1;visibility:visible;transition:opacity .24s ease-out calc(var(--dw) + .2s),scale .4s var(--e-out) calc(var(--dw) + .2s),visibility 0s calc(var(--dw) + .2s)}
.itabs{display:flex;align-items:center;gap:4px;height:36px;color:var(--muted);position:relative;z-index:2}.itabs .sm{font-size:var(--text-sm);margin-left:8px}.itabs b{margin-left:6px;color:var(--text);font-size:var(--text-sm)}
.tab{display:inline-grid;grid-template-columns:auto 0fr;align-items:center;height:36px;padding:0 10px;border-radius:99px;font-weight:var(--font-medium);cursor:pointer;transition:grid-template-columns .32s var(--e-out),background-color .3s,color .3s}.tab:hover{background:var(--fill)}.tab .tl{overflow:hidden;min-width:0;opacity:0;transition:opacity .2s}.tab .tl span{display:block;padding-left:7px;white-space:nowrap}.tab.t-timer,.tab.t-talk,.tab.t-engine{display:none}
.ipg{position:absolute;left:18px;right:18px;top:56px;bottom:0}.ipage{position:absolute;inset:0 0 auto 0;opacity:0;translate:20px 0;visibility:hidden;transition:opacity .26s ease-out,translate .26s var(--e-out),visibility 0s .26s}
.s{display:contents}
.ilive{display:grid;grid-template-columns:190px 1fr;gap:var(--space-5);height:214px}.ictl{display:flex;flex-direction:column;gap:var(--space-2)}.isl .tm{display:flex;align-items:center;gap:10px}.isl .tm b{font-size:var(--text-2xl);font-weight:var(--font-medium)}.pzt{display:none;font-size:var(--text-xs);background:var(--gold);border-radius:99px;padding:2px 8px;font-weight:var(--font-semibold)}.isl:has(.pz:checked) .pzt{display:inline}
.ibtns{display:flex;gap:10px;margin:4px 0}.ib2{width:40px;height:40px;border-radius:50%;background:var(--card);box-shadow:var(--ring);display:grid;place-items:center;color:var(--text);cursor:pointer;transition:scale .15s}.ib2:hover{scale:1.06}.ib2:active{scale:.94}.ib2.stop{color:var(--danger)}.ib2.go{background:var(--accent);color:var(--white)}.ib2.dis{opacity:.4;cursor:default}.ib2 svg+svg{display:none}.isl:has(.pz:checked) .ib2 svg:first-child{display:none}.isl:has(.pz:checked) .ib2 svg+svg{display:block}
.ilines{position:relative;background:var(--card2);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);overflow:hidden}.ilines p{margin:4px 0}.ilines .now{font-size:var(--text-xl);font-weight:var(--font-semibold);clip-path:inset(0 100% 0 0)}.ilines .tr{color:var(--tc,var(--ai));opacity:0}.ilines.empty p{margin:6px 0}
.isl:hover .ilines .now,.board:has(.pin:checked) .ilines .now{animation:stream 1.1s steps(30,end) calc(var(--dw) + .5s) forwards}.isl:hover .ilines .tr,.board:has(.pin:checked) .ilines .tr{animation:fadein .4s ease-out calc(var(--dw) + 1.5s) forwards}
@keyframes stream{from{clip-path:inset(0 100% 0 0);translate:0 8px}to{clip-path:inset(0 0 0 0);translate:0 0}}@keyframes fadein{to{opacity:1}}
.cal{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--ring);margin-bottom:var(--space-2)}.cal>div{display:flex;flex-direction:column;gap:2px;flex:1;font-size:var(--text-sm)}.cal b{font-size:var(--text-md)}
.chipl{display:none;align-items:center;gap:8px;margin:6px 0}.isl:has(.qk-d:checked) .chipl-d,.isl:has(.qk-a:checked) .chipl-a,.isl:has(.qk-q:checked) .chipl-q{display:flex;animation:fadein .2s ease-out forwards}
.qcap{display:flex;gap:6px;align-items:center;margin-top:var(--space-3);font-size:var(--text-sm)}.ilines .qcap{position:absolute;left:var(--space-4);bottom:10px;margin:0}.kb,.kbd{font-family:var(--mono);font-size:var(--text-xs);box-shadow:var(--ring);border-radius:4px;padding:2px 7px;background:var(--card);cursor:pointer}.kbd{cursor:default}.kb:active{scale:.94}.isl:has(.qk-d:checked) [for$="-qd"],.isl:has(.qk-a:checked) [for$="-qa"],.isl:has(.qk-q:checked) [for$="-qq"]{background:var(--gold)}
.ban{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--radius-lg);background:var(--card);box-shadow:var(--ring);font-size:var(--text-sm);margin-bottom:var(--space-2)}.ban>span:not(.btn):not(.it){flex:1}.ilines .ban{position:absolute;left:var(--space-3);right:var(--space-3);bottom:8px;margin:0}.ilines:has(.ban) .qcap{display:none}
.isl .dic{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);overflow:hidden;position:relative}.isl .dic.ghost{opacity:.7}.isl .dic-h{display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-4);height:42px;font-size:var(--text-sm);font-weight:var(--font-semibold)}
.rl .row{position:relative;height:46px;border-top:.5px solid var(--grid);--n:calc(var(--u0,0) + var(--u1,0) + var(--u2,0) + var(--u3,0));translate:0 calc(var(--n) * -46px);transition:translate .26s var(--e-out)}.rl .rc,.mrow{display:flex;align-items:center;gap:10px;height:46px;padding:0 var(--space-4);transition:translate .18s ease-in,opacity .18s ease-in}.mrow{border-top:.5px solid var(--grid)}.mt{font-size:var(--text-md);min-width:0}.rc .mt{flex:1}.rc .grow{display:none}.rc .btn{flex:none}
.isl .cb:checked~.rc{translate:-28px 0;opacity:0}.rl{position:relative}.rl .row .cb{pointer-events:none}
${[3, 4].map((n, ci) => { const c = ci ? 'i' : 'm'; return Array.from({ length: n }, (_, i) => `.isl:has(.${c}${i + 1}:checked) :is(${Array.from({ length: n - i - 1 }, (_, j) => `.rl .row${i + j + 2}`).join(',') || '.none'}){--u${i}:1}`).join(''); }).join('')}
.clear{position:absolute;left:0;right:0;bottom:0;height:46px;display:flex;align-items:center;justify-content:center;color:var(--muted);opacity:0;translate:0 6px;transition:opacity .2s,translate .26s var(--e-out);pointer-events:none}
.isl:has(.m1:checked):has(.m2:checked):has(.m3:checked) .dic:has(.m1) .clear,.isl:has(.i1:checked):has(.i2:checked):has(.i3:checked):has(.i4:checked) .dic:has(.i1) .clear{opacity:1;translate:0 0;transition-delay:.2s}
.clear{top:42px;bottom:auto;height:auto;padding:16px 0}
.isl .toast{position:absolute;right:18px;top:-30px;display:flex;gap:6px;align-items:center;background:var(--accent);color:var(--white);border-radius:99px;padding:5px 12px;font-size:var(--text-sm);opacity:0;translate:0 6px}.isl:has(:is(.m1,.m2,.m3):checked) .toast{animation:toast 2.2s ease both}
@keyframes toast{0%{opacity:0;translate:0 6px}12%,80%{opacity:1;translate:0 0}100%{opacity:0;translate:0 -4px}}
.empx{display:flex;flex-direction:column;align-items:center;gap:6px;padding:34px 40px;text-align:center;background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring)}
.isl .intro{margin:0 0 var(--space-2);height:18px}.adl{background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring)}.adr{display:grid;grid-template-columns:30px 128px 1fr 56px 38px;line-height:1.3;gap:10px;align-items:center;padding:7px var(--space-3);border-top:.5px solid var(--grid);height:41px;font-size:var(--text-sm)}.adr:first-child{border-top:0}.adr b{font-weight:var(--font-semibold);font-size:var(--text-md)}.adr>.dim:not(.small){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.it{display:inline-grid;place-items:center;flex:none;border-radius:8px;color:var(--c);background:color-mix(in srgb,var(--c) 12%,white)}
.sw{width:36px;height:20px;border-radius:10px;background:var(--fill);position:relative;display:inline-block;box-shadow:inset 0 0 0 .5px var(--border);cursor:pointer;transition:background-color .15s}.sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--white);box-shadow:0 1px 2px var(--navy-30);transition:translate .12s var(--e-out)}
.isl:has(.ad-timer:checked) [for$="-ad-timer"],.isl:has(.ad-talk:checked) [for$="-ad-talk"],.isl:has(.ad-glos:checked) [for$="-ad-glos"],.isl:has(.ad-qc:checked) [for$="-ad-qc"],.isl:has(.ad-cap:checked) [for$="-ad-cap"],.isl:has(.ad-drop:checked) [for$="-ad-drop"],.isl:has(.ad-engine:checked) [for$="-ad-engine"],.isl:has(.hfs:checked) [for$="-hfs"]{background:var(--accent)}
.isl:has(.ad-timer:checked) [for$="-ad-timer"] i,.isl:has(.ad-talk:checked) [for$="-ad-talk"] i,.isl:has(.ad-glos:checked) [for$="-ad-glos"] i,.isl:has(.ad-qc:checked) [for$="-ad-qc"] i,.isl:has(.ad-cap:checked) [for$="-ad-cap"] i,.isl:has(.ad-drop:checked) [for$="-ad-drop"] i,.isl:has(.ad-engine:checked) [for$="-ad-engine"] i,.isl:has(.hfs:checked) [for$="-hfs"] i{translate:16px 0}
.tim{display:flex;gap:24px;align-items:center}.ringw{position:relative;width:96px;height:96px;flex:none}.ringw svg{rotate:-90deg}.rgc{stroke-dashoffset:0;transform-origin:center}.isl:hover .rgc,.board:has(.pin:checked) .rgc{animation:ring 20s linear calc(var(--dw) + .3s) forwards}@keyframes ring{to{stroke-dashoffset:.3}}.rgt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.rgt b{font-size:var(--text-lg)}.agl{flex:1;display:flex;flex-direction:column;gap:2px}.agr{display:flex;align-items:center;gap:10px;height:32px;cursor:pointer}.agr span:nth-of-type(1){flex:1}.agr input{position:absolute;opacity:0}.bx{width:18px;height:18px;border-radius:5px;box-shadow:inset 0 0 0 1.5px var(--navy-30);display:grid;place-items:center;color:transparent;transition:background-color .12s}.ag:checked+.bx{background:var(--accent);color:var(--white);box-shadow:none}.ag:checked~span:nth-of-type(1){text-decoration:line-through;color:var(--muted)}
.tkl{display:flex;flex-direction:column;gap:12px;padding-top:6px}.tkr{display:grid;grid-template-columns:120px 1fr 44px;gap:12px;align-items:center}.tbar{height:12px;border-radius:6px;background:var(--fill);overflow:hidden}.tbar i{display:block;height:100%;background:var(--c);transform-origin:0 50%;scale:var(--w) 1;border-radius:6px}.isl:hover .tbar i,.board:has(.pin:checked) .tbar i{animation:grow .6s var(--e-out) backwards}@keyframes grow{from{scale:0 1}}
.engp{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.kpi{display:flex;align-items:center;gap:8px;background:var(--card);border-radius:var(--radius-lg);box-shadow:var(--ring);padding:10px 12px}.kpi b{margin-left:auto;font-size:var(--text-lg)}.spk{display:flex;gap:6px;align-items:flex-end;height:60px;margin:14px 0 8px}.spk i{flex:1;background:var(--t-metric);border-radius:3px;transform-origin:50% 100%;animation:spk 1.6s ease-in-out infinite}@keyframes spk{0%,100%{scale:1 .7}50%{scale:1 1}}
.iset .srow{display:flex;align-items:center;gap:12px;height:44px;border-top:.5px solid var(--grid)}.iset .srow:first-child{border-top:0}.iset .lbl{width:150px;font-size:var(--text-sm);color:var(--muted);font-weight:var(--font-medium);text-transform:none;letter-spacing:0}
.board:has(.tc-indigo:checked){--tc:#4A3C94}.board:has(.tc-indigo:checked) .tcprev::before{content:'Indigo · ';color:var(--muted)}.tc-indigo+i{--sw:#4A3C94}.board:has(.tc-navy:checked){--tc:#2F3D80}.board:has(.tc-navy:checked) .tcprev::before{content:'Navy · ';color:var(--muted)}.tc-navy+i{--sw:#2F3D80}.board:has(.tc-teal:checked){--tc:#0B6E83}.board:has(.tc-teal:checked) .tcprev::before{content:'Teal · ';color:var(--muted)}.tc-teal+i{--sw:#0B6E83}.board:has(.tc-neutral:checked){--tc:#4F5675}.board:has(.tc-neutral:checked) .tcprev::before{content:'Neutral · ';color:var(--muted)}.tc-neutral+i{--sw:#4F5675}.board:has(.tc-bronze:checked){--tc:#7A5200}.board:has(.tc-bronze:checked) .tcprev::before{content:'Bronze · ';color:var(--muted)}.tc-bronze+i{--sw:#7A5200}.tcs{cursor:pointer;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%}.tcs i{width:18px;height:18px;border-radius:50%;background:var(--sw);box-shadow:0 0 0 1px var(--grid)}.tcs input:checked+i{box-shadow:0 0 0 2px var(--white),0 0 0 4px var(--sw)}.tcs:has(input:focus-visible){outline:2px solid var(--accent)}.tcprev{margin-left:8px;font-size:var(--text-sm);color:var(--tc,var(--ai));white-space:nowrap}
.isl .sgm{display:inline-flex;background:var(--fill);border-radius:var(--radius-md);padding:2px}.isl .sgm label{cursor:pointer}.isl .sgm label span{display:block;padding:4px 10px;border-radius:var(--radius-sm);font-size:var(--text-sm);color:var(--muted);font-weight:var(--font-medium);transition:background-color .15s}.isl .sgm input:checked+span{background:var(--white);color:var(--text);box-shadow:var(--ring)}.isl .sgm label:has(input:focus-visible) span{outline:2px solid var(--accent)}
.tgx{font:600 9.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;border:1px dashed var(--muted);border-radius:99px;padding:1px 6px;margin-left:4px}
.isl .btn{cursor:pointer}.isl label.btn:active{scale:.96}
.isl label:focus-visible,.isl:has(input:focus-visible) .tab{outline:0}
.film{display:grid;grid-template-columns:900px 1fr;gap:28px;margin-top:28px;background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px;align-items:start}.film figure{margin:0;position:relative}.film img{width:900px;height:420px;object-fit:cover;border-radius:10px;display:block}.film .gif{display:none}.film:has(.fp:checked) .gif{display:block}.film:has(.fp:checked) .poster{display:none}.film .fp{position:absolute;opacity:0}.film .play{position:absolute;right:12px;bottom:12px;background:var(--navy);color:var(--white);border-radius:99px;padding:7px 12px;font:600 11.5px var(--monoc);cursor:pointer}.film:has(.fp:checked) .play{background:var(--ink)}.film ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px;font-size:12.5px}.film li{display:flex;gap:10px}.film li b{font:600 11px var(--monoc);color:var(--muted-c);width:34px;flex:none;padding-top:1px}
.hidin{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0}.mon{position:absolute;border:2px solid var(--navy-30);border-radius:8px;background:color-mix(in srgb,var(--white) 70%,transparent);overflow:hidden}
@media (prefers-reduced-motion:reduce){.isl,.isl *{animation:none!important}.isl{transition:none!important}.ibody,.pillc,.ipage,.row,.rc,.tab,.tab .tl,.ptop{transition-duration:.12s!important;transition-delay:0s!important}.ilines .now{clip-path:none!important}.ilines .tr{opacity:1!important}.sec::before{animation:none}.rgc{animation:none!important}}
`;
  /* ---------- boards ---------- */
  const hid = (x) => `<span class="hidin">${x}</span>`;
  const OY = 'Oyenza Studio (MIT code; name, logo and character not licensed). Reference only.';
  const R1 = (img, cap) => [img, cap];
  const film = `<div class="film"><figure><input type="checkbox" class="fp" id="I02-fp"><img class="poster" src="shots/island-demo-poster.png" alt="Island film, still: open island on Live"><img class="gif" src="shots/island-demo.gif" alt="Island film, 16 s loop: idle, captions, hover ring, open, Meeting tab, Accept, fold"><label class="play" for="I02-fp">Play / stop film</label></figure><div><div class="lbl">The film, beat by beat (16 s loop, 900x420)</div><ol><li><b>0.0</b>Idle pill: wordmark, ready, Ctrl Alt S</li><li><b>1.1</b>Captions stream into the pill</li><li><b>3.6</b>Hover: the ring fills for 1.5 s (film setting)</li><li><b>6.0</b>Island opens on Live</li><li><b>8.1</b>Meeting tab</li><li><b>9.8</b>Accept a decision; the list closes up</li><li><b>12.9</b>Fold back into the pill</li><li><b>14.4</b>Idle again</li></ol><p class="dim small">The film uses the slower 1.5 s hover setting so the ring can be seen; the default in the app is 0.22 s. The film shows “Rust engine · CUDA” on Live. That is the target state: the CUDA build is not done yet. The board marks it <span class="tgx">target</span>. Source: docs/design/island-demo/.</p></div></div>`;
  const mk = (id, o) => {
    const c = ctl(id, o.ctl || {});
    return {
      id, tier: 'ISLAND', title: o.title, ext: o.ext, lives: o.lives, afterOnly: true,
      after: { html: desk(island(id, o.island || {}), o.before || BEF), w: 1140, h: 641, scale: 0.96 },
      tools: hid(c.pre) + c.bar, film: o.film || '',
      notes: o.notes, must: o.must, motion: o.motion, stories: o.stories, where: o.where,
      refs: { note: o.refs.every(([img]) => img.includes('/tb-')) ? 'Threadbear (MIT), reference only.' : OY, shots: o.refs },
    };
  };
  const SPR = 'spring, mass 1, as CSS linear()';
  const M_OPEN = [['Open width', `GROW_W 500/32.5: 324 ms ${SPR} (motion.rs:21)`], ['Open height', 'GROW_H 250/23: 458 ms (motion.rs:25)'], ['Open radius', 'RADIUS_GROW 1200/69.3: 222 ms (motion.rs:33)'], ['Fold', 'SHRINK_W 400/36: 280 ms; SHRINK_H 560/43: 244 ms; radius 150/24.5: 628 ms (motion.rs:27-35)'], ['Content', 'out 0.12 s ease-in; in 0.24 s ease-out after 0.2 s, scale .97 to 1 (CONTENT 700/52.9, motion.rs:38; island.rs:28)'], ['Hover dwell', '0.22 s by default, as Oyenza (settings.rs:229); 1.5 s, 3 s or Off in Settings. The ring fills linearly over the chosen time. The I02 film uses 1.5 s'], ['Reduce Motion', 'no springs, 120 ms fades']];
  const M_TAB = [['Page switch', '0.26 s slide 20 px + fade (app.rs:588, pages/mod.rs:356)'], ['Tab label', 'grid columns 0.32 s cubic-bezier(.25,1,.5,1), as in the film']];
  const boards = [
    mk('I01', { title: 'Pill at the top: idle, live, recording', ext: 'New (island/, Oyenza Studio fork)', lives: 'Top centre of the screen, above every window', island: { start: 'live' },
      notes: [[880, 60, '<b>Switch the state</b> above: the pill changes width with the shrink spring. Live, idle, helper offline, mic blocked, “3 wait on you”.', false, 230], [880, 170, '<b>Hover the pill:</b> a ring fills 0.22 s (the default; 1.5 s is a switch above) where the bars were, then the island opens. Leave and it folds at once.', false, 230], [880, 290, '<b>Dot only / Hide</b> are set in Settings (I08); “Keep island open” holds it for a still.', false, 230]],
      must: ['Pill floats 8 px under the top edge, centred, click-through outside its shape', 'Five states drawn: live, idle, helper offline, mic blocked, needs you', 'Hover ring shows the wait (0.22 s by default); the island opens when it is full', 'Line ellipsizes; never wraps to two lines in the pill', 'Pill never covers a full-screen app (setting, I08)'],
      motion: [...M_OPEN, ['Rec dot', 'pulse 1.2 s'], ['Bars', 'bounce 1.1 s, hidden while the ring runs']],
      stories: [st('I01-1', 'S6', 'new', 'Pill shape + SubMeetly look'), st('I01-2', 'S7', 'new', 'Live line in collapsed pill'), st('I01-3', 'S7', 'new', 'Start/stop hotkey'), st('I01-4', 'S6', 'new', 'Hover ring, then open')],
      where: ['<b>App:</b> island/ (crates poni, poni-core), Windows first, Mac next', '<b>Source:</b> crates/poni/src/pill/motion.rs, island.rs', '<b>Decision:</b> Rust UI exception accepted (owner, 2026-11-08)', '<b>Decision:</b> hover default 0.22 s, as Oyenza (owner, 2026-11-08); 1.5 s stays an option'],
      refs: [R1('ref/oy-pill-media-activity.webp', 'Pill theme, live media line (model for the caption line)'), R1('ref/oy-pill-idle-status.webp', 'Pill theme, idle status'), R1('ref/oy-pill-timer-activity.webp', 'Pill theme, timer activity (model for the rec timer)')] }),
    mk('I02', { title: 'Island open: Live', ext: 'New (island page), data from side panel pipeline', lives: 'Island › Live tab', island: { start: 'live' }, film,
      notes: [[880, 60, '<b>Hover the pill 0.22 s</b> (or Keep open; the Hover delay switch above gives 1.5 s): it springs open to this page. Lines stream in, the translation fades in after.', false, 230], [880, 170, '<b>Pause / Stop</b> act on the running session; Stop drafts minutes like “End &amp; draft”.', false, 230], [880, 280, '<b>Ctrl Alt D / A / Q</b> mark the last line; click the keys to try. Mouse wheel and Esc are not wired in this drawing.', false, 230]],
      must: ['Three-line rhythm: previous, current, translation', 'Pause and Stop work on the real session', 'Engine and device named in one small line (CUDA is target)', 'Language pair visible', 'Empty state: “Not listening. Ctrl Alt S to start.”', 'Mic blocked and helper offline are told in words'],
      motion: [...M_OPEN.slice(0, 5), ['Lines', 'current line wipes in 1.1 s, translation fades 0.4 s'], ...M_TAB],
      stories: [st('I02-1', 'S7', 'new', 'Live page with three-line captions'), st('I02-2', 'S7', 'new', 'Pause / Stop from the island'), st('I02-3', 'S7', 'new', 'Tabs Live · Meeting · Inbox · Add-ins'), st('I02-4', 'S7', 'new', 'Island film (16 s loop)')],
      where: ['<b>App:</b> island/crates/poni/src/pages/live.rs (new)', '<b>Feed:</b> engine session events over loopback', '<b>Film:</b> docs/design/island-demo/'],
      refs: [R1('ref/oy-pill-page-media.webp', 'Open pill: lyric lines beside the player (model for caption lines)'), R1('ref/oy-classic-page-notes-listening.webp', 'Oyenza’s own meeting-notes listening page')] }),
    mk('I03', { title: 'Island open: Meeting (decisions as buttons)', ext: 'Minutes register items (src/lib/notes-actions.js acceptItem)', lives: 'Island › Meeting tab', island: { start: 'meet' },
      notes: [[880, 70, '<b>Click Accept</b> on a decision: the row slides out, the rows below close up, the count drops, a toast confirms.', false, 230], [880, 190, '<b>Accept all three</b> to see “All clear”.', false, 230], [880, 280, '<b>Locked:</b> an issued meeting shows the items read-only.', false, 230]],
      must: ['Only items that need a person are listed', 'Accept / Answered / Carry / Assign map to existing register actions', 'Hotkey hint visible', 'Empty: “Nothing waits on you in this meeting.”', 'Issued meeting: read-only with the way to amend'],
      motion: [['Accept', 'row slides out left 180 ms; rows close up 260 ms cubic-bezier(.25,1,.5,1)'], ['Count', 'updates on the click, no delay'], ['Toast', '2.2 s: in, hold, out'], ...M_TAB],
      stories: [st('I03-1', 'S9', 'new', 'Decisions and questions as buttons (Threadbear “Decisions”)'), st('I03-2', 'S8', 'new', 'Quick capture hotkeys')],
      where: ['<b>App:</b> island page meeting.rs (new) → engine /notes', '<b>Register:</b> src/lib/notes-actions.js acceptItem'],
      refs: [R1('ref/tb-decisions-1.webp', 'Decisions clip: a turn ending with asks as buttons'), R1('ref/tb-decisions-2.webp', 'Decisions clip: asks answered with a click'), R1('ref/tb-phone-question.webp', 'Phone: a question answered with buttons')] }),
    mk('I04', { title: 'Island open: Inbox across meetings', ext: 'Minutes register views (T01 Inbox)', lives: 'Island › Inbox tab', island: { start: 'inbox' },
      notes: [[880, 70, '<b>Done</b> removes a row and closes the list; <b>Inbox zero</b> appears after the last one.', false, 230], [880, 170, '<b>Same items as T01:</b> open actions, questions and unowned risks, small version for the island.', false, 230]],
      must: ['Open actions, questions and risks across meetings', 'Done and Snooze per row', 'Inbox-zero state names the next meeting', 'Error shows the age of the list, Locked says why'],
      motion: [['Done', 'row slides out 180 ms; rows close up 260 ms'], ['Inbox zero', 'fades in 200 ms after the last row'], ...M_TAB],
      stories: [st('I04-1', 'S9', 'new', 'Inbox page in the island')],
      where: ['<b>App:</b> island page inbox.rs (new)', '<b>Spec:</b> board T01'],
      refs: [R1('ref/tb-inbox-1.webp', 'Inbox clip: finished threads before archiving'), R1('ref/tb-inbox-2.webp', 'Inbox clip: after archiving, list shorter')] }),
    mk('I05', { title: 'Add-ins for meetings', ext: 'Oyenza add-on system (poni-core/src/addons.rs)', lives: 'Island › Add-ins', island: { start: 'addins' },
      notes: [[880, 70, '<b>Switch one on:</b> its tab appears in the tab row with the label opening; switch it off and the tab leaves.', false, 230], [880, 190, '<b>Agenda timer, Talk time, Engine monitor</b> open their own pages (I06, I07).', false, 230]],
      must: ['Seven meeting add-ins, each with one-line purpose and size', 'Timer and Quick capture on, the rest off (owner to confirm)', 'No account-bound add-in (Oyenza money, health, stocks dropped)', 'Off = nothing of it runs'],
      motion: [['Switch', 'knob 120 ms'], ['New tab', 'label opens 0.32 s'], ...M_TAB],
      stories: [st('I05-1', 'S8', 'new', 'Add-in list with switches'), st('I05-2', 'S8', 'new', 'Glossary per series'), st('I05-3', 'S8', 'new', 'Caption style, Drop to transcribe')],
      where: ['<b>App:</b> island add-on list in poni-core addons.rs', '<b>Open:</b> final add-in list and defaults (owner)'],
      refs: [R1('ref/oy-classic-page-addons.webp', 'Oyenza add-ons page (layout model)')] }),
    mk('I06', { title: 'Add-ins: Agenda timer and Talk time', ext: 'Oyenza Focus timer; diarised segments', lives: 'Island › Timer, Talk time', island: { start: 'timer', ads: ['timer', 'talk', 'qc'] },
      notes: [[880, 70, '<b>Tick an agenda item:</b> it is struck through; the ring counts the current item down.', false, 230], [880, 190, '<b>Open Talk time</b> from its tab: bars grow in 0.6 s.', false, 230]],
      must: ['Ring shows time left on the current agenda item', 'Agenda items tick off', 'Talk time stays on this device', 'No agenda: asks for one (needs-input state)'],
      motion: [['Ring', '20 s linear, starts after the open'], ['Tick', 'check fills 120 ms'], ['Bars', 'grow 0.6 s cubic-bezier(.25,1,.5,1)'], ...M_TAB],
      stories: [st('I06-1', 'S8', 'new', 'Agenda timer (from Oyenza Focus)'), st('I06-2', 'S8', 'new', 'Talk time')],
      where: ['<b>App:</b> island page timer.rs, talk.rs (new)', '<b>Note:</b> the pill timer activity (PEEK_S 5, activities.rs) is not ported yet'],
      refs: [R1('ref/oy-classic-page-focus.webp', 'Focus timer (model for Agenda timer)')] }),
    mk('I07', { title: 'Add-in: Engine monitor', ext: 'Oyenza System page', lives: 'Island › Engine', island: { start: 'engine', ads: ['timer', 'qc', 'engine'] },
      notes: [[880, 70, '<b>CUDA is a target state:</b> the CUDA build is not done. Until then the line reads CPU / browser.', false, 230], [880, 190, '<b>Bars</b> are the last 16 samples of GPU load.', false, 230]],
      must: ['CPU, GPU and real-time factor named', 'Last-minute sample bars', 'Target state marked as target', 'Helper offline: bars stop and say why'],
      motion: [['Bars', 'breathe 1.6 s ease-in-out, 60 ms stagger'], ...M_TAB],
      stories: [st('I07-1', 'S8', 'new', 'Engine monitor (from Oyenza System)')],
      where: ['<b>App:</b> island page engine.rs (new)', '<b>Feed:</b> engine /health'],
      refs: [R1('ref/oy-classic-page-system.webp', 'System page (model for Engine monitor)')] }),
    mk('I08', { title: 'Island settings and our look', ext: 'Oyenza settings page + look.rs', lives: 'Island › Settings', island: { start: 'settings' },
      notes: [[880, 70, '<b>Open on hover after</b> changes the dwell for real: it starts at 0.22 s; pick 3 s and the ring takes 3 s.', false, 230], [880, 190, '<b>Shape Notch</b> flattens the top edge. <b>Dot only / Hide</b> change the pill.', false, 230], [880, 310, '<b>Translation colour:</b> click a swatch; the sample line, the pill and the Live page follow. Each swatch is 4.5:1 or better on the card.', false, 230]],
      must: ['Two SubMeetly looks + Classic kept', 'Pill is the default shape; Notch is the other', 'Hover delay 0.22 s by default, matches the dock', 'Translation colour: indigo by default, four other swatches, each 4.5:1 on the card', 'Hide in full-screen apps on by default'],
      motion: [['Segment', 'background 150 ms'], ['Switch', 'knob 120 ms'], ...M_TAB],
      stories: [st('I08-1', 'S6', 'new', 'SubMeetly Look from tokens'), st('I08-2', 'S6', 'new', 'Pill default shape'), st('I08-3', 'S6', 'new', 'Hover delay setting, 0.22 s default'), st('I08-4', 'S6', 'new', 'Translation colour setting (5 swatches, indigo default)')],
      where: ['<b>App:</b> poni-core/src/look.rs, settings.rs'],
      refs: [R1('ref/oy-classic-page-settings.webp', 'Oyenza in-island settings')] }),
  ];
  return { css, boards, film };
}
