// D02, D03 and T03 as interactive boards. Buttons carry data-g (group) + data-k (key) + aria-pressed;
// panes carry data-p="group:key ..." and show by CSS :has() (see paneCss). One markup serves the static page
// (tiny click script) and the Claude Design export (ixDc binds aria-pressed/onClick to DCLogic state).
import { tile, icon as ci } from './icons/colour-icons.mjs';

export const STATE_KEYS = [['normal', 'Normal'], ['empty', 'Empty'], ['error', 'Error'], ['locked', 'Locked'], ['need', 'Needs input']];

export function makeIx({ ic, wmark, esc, NEW, PART, typeTag, segc, combo, M }) {
/* ===== D02 / D03 / T03: interactive boards. Buttons carry data-g (group) + data-k (key) + aria-pressed;
   panes carry data-p="group:key ..." and show by CSS :has(). The same markup runs offline (tiny inline script)
   and in the Claude Design export (aria-pressed / onClick bound to DCLogic state, see --dc below). ===== */
const bt = (g, k, label, on, cls = '', extra = '') => `<button type="button" class="${cls}" data-g="${g}" data-k="${k}" aria-pressed="${on ? 'true' : 'false'}"${extra}>${label}</button>`;
const sgc = (g, opts, def, cls = '') => `<span class="sgc ${cls}" role="group">${opts.map(([k, l]) => bt(g, k, l, k === def)).join('')}</span>`;
const dp = (t, inner, o = {}) => `<${o.tag || 'div'} data-p="${t}"${o.cls ? ` class="${o.cls}"` : ''}${o.style ? ` style="${o.style}"` : ''}>${inner}</${o.tag || 'div'}>`;
const chp = (t, h = 'n') => `<span class="chp h-${h}">${t}</span>`;
const kv2 = (l, v) => `<div class="kv2"><span>${l}</span><span class="v">${v}</span></div>`;
const swt = (on) => `<span class="sw${on ? ' on' : ''}"><i></i></span>`;
const cx = (icon, title, inner, right = '', cls = '') => `<div class="cx ${cls}"><div class="cxh">${tile(icon, 24)}<b>${title}</b><span class="grow"></span>${right}</div>${inner}</div>`;
const recdot = '<i class="rec"></i>';
const btn = (label, cls = '', extra = '') => `<button type="button" class="gb ${cls}"${extra}>${label}</button>`;
const IDLE = (txt) => `<span class="idle"><i class="dot off"></i>${txt}</span>`;

/* ---------- D02: the side panel, every control kept, grouped under 5 tabs ---------- */
const MAP = [
  ['source', 'Source', 'g', 'captions', ['Offline / Realtime', 'Current page tag', 'Go to tab', 'Offline dropzone', 'CC0 samples (lab)', 'Pick tab or window']],
  ['languages', 'Task and languages', 'b', 'captions', ['Transcribe / + Translate', 'Refine', 'Dual line', 'From / To', 'Model download', 'Start steps']],
  ['live', 'Live and results', 'r', 'captions', ['Original / Translation', 'Start / End', 'Error box', 'SRT / VTT / TXT', 'Export folder hint', 'Result lines']],
  ['interp', 'Interpreter', 't', 'ov-interp', ['Consecutive A to B', 'Simultaneous', 'Languages', 'Turn on / Cancel']],
  ['perf', 'Performance', 't', 'perf', ['Charts / Table', 'Stage, pair, source filters', 'ASR p50, MT p50, RTF, N', 'Export, import, bench, clear']],
  ['notes', 'Notes capture', 'y', 'notes', ['Meeting switch + new', 'Project type', 'End and draft', 'Flag this moment', 'Summary', 'Decisions', 'Actions']],
  ['register', 'Register and paste', 'y', 'notes', ['Open register', 'TXT / Markdown / Sync', 'Start next', 'Saved meetings', 'Paste a Teams transcript']],
  ['history', 'History and export', 't', 'history', ['Search', 'Open / TXT / SRT / VTT / Delete', 'CRLF, BOM, language suffix', 'Save to OS default']],
  ['helper', 'Native helper', 'o', 'helper', ['Status and engine', 'Large-file job', 'Disconnect banner', 'Install guide per OS', 'Diagnostics', 'Troubleshooting']],
  ['settings', 'Settings', 'n', 'settings', ['Theme, language, reskin', 'Engine and device', 'Mirror, speed, models', 'Folder, refine, font size', 'About, licences']],
];
const mapCard = ([ic, name, hue, tab, chips]) => {
  const g = tab === 'ov-interp' ? 'ov' : 'tab'; const k = tab === 'ov-interp' ? 'interp' : tab;
  return `<button type="button" class="mc" data-g="${g}" data-k="${k}" aria-pressed="false"><span class="mch">${tile(ic, 30, hue)}<b>${name}</b><span class="mcn mono">${chips.length}</span></span><span class="mcc">${chips.map((c) => `<i>${c}</i>`).join('')}</span></button>`;
};

const lisCard = () => cx('source', 'Listen to', `
  ${sgc('mode', [['off', 'Offline'], ['rt', 'Realtime']], 'rt', 'full')}
  ${dp('mode:rt', `<div class="tgt">${tile('tab', 34)}<span class="srct"><b>Lab demo: speech.wav</b><small>127.0.0.1:8799/app.html</small></span>${chp('Current page', 'g')}<a>Go to tab</a></div>
    ${dp('st:locked', `<div class="lockbar">${ci('lock', 18)}<span>A session is already running in another tab. <a>Go to tab</a> to stop it, then start here.</span></div>`)}`)}
  ${dp('mode:off', `<div class="dz">${tile('dropzone', 34)}<span class="srct"><b>Drop audio or video, or choose a file</b><small>mp3 · wav · m4a · mp4 · webm · ogg</small></span></div>
    ${dp('st:normal st:locked st:need st:error', '<div class="fn"><span class="mono">meeting-2026-02-17.mp4</span><span class="dim">2.5 GiB</span></div>')}
    ${dp('den:detail', `<div class="smp"><span class="combo">CC0 sample: speech.wav ${ic('down', 14)}</span>${btn('Run sample')}${chp('lab only', 'n')}</div>`)}`)}
  <div class="rowc">${sgc('task', [['tr', '+ Translate'], ['ts', 'Transcribe']], 'tr', 'full')}</div>
  ${dp('den:detail', `<div class="two2"><label class="swl">${swt(true)}Refine</label><label class="swl">${swt(false)}Dual line</label></div>`)}
  <div class="langs"><div class="fld"><label>From</label><span class="combo">Chinese ${ic('down', 14)}</span></div>${dp('task:tr', `<span class="to">${ic('arrow', 16)}</span>`, { tag: 'span', style: '--pd:grid' })}${dp('task:tr', '<div class="fld"><label>To</label><span class="combo">English ' + ic('down', 14) + '</span></div>', { style: '--pd:flex;flex:1;flex-direction:column' })}</div>
  ${dp('den:detail', `<div class="irow"><span class="dim">Interpreter</span><b>Consecutive · zh ⇄ en</b><span class="grow"></span>${bt('ov', 'interp', 'Change', false, 'gb')}</div>`)}
  <p class="eng"><i class="dot"></i>Rust engine · CUDA<span class="dim">runs on this device</span></p>`, '', 'lis');

const captionsLive = () => `
  ${NEW(lisCard(), 'margin-top:2px')}
  ${dp('st:need', `<div class="mwarn">${tile('warn', 26)}<div><b>2 models are not on this device yet</b><div class="mrows"><span>Speech: whisper large-v3-turbo</span>${btn('Download')}<span>Translation: zh to en</span>${btn('Download')}</div><a>Manage models</a></div></div>`)}
  ${dp('st:normal', `<div class="steps"><span class="ok">${ci('check', 14)}Capture</span><span class="ok">${ci('check', 14)}Models</span><span class="ok">${ci('check', 14)}Warm-up</span><span class="now">${recdot}Listening</span></div>`)}
  ${dp('st:error', `<div class="ebox">${tile('warn', 26)}<div><b>Could not start captions</b><p>The helper stopped answering. Captions use the browser engine (slower).</p><div class="mono tech">Technical detail: POST /transcribe, connection refused 127.0.0.1:17865</div><div class="rowb">${btn('Try again')}${btn('Install helper')}${btn('Dismiss', 'quiet')}</div></div></div>`)}
  <div class="cta">
    ${dp('st:empty st:error st:need', `<button class="pb bigb">Start captions</button><button class="gb bigb" disabled>End</button>`, { style: '--pd:flex;gap:8px;flex:1' })}
    ${dp('st:normal', `<button class="pb bigb dis" disabled>Listening 00:42</button><button class="gb bigb">${dp('mode:rt', 'End', { tag: 'span', style: '--pd:inline' })}${dp('mode:off', 'Cancel', { tag: 'span', style: '--pd:inline' })}</button>`, { style: '--pd:flex;gap:8px;flex:1' })}
    ${dp('st:locked', `<button class="pb bigb dis" disabled>${ci('lock', 15)} Start captions</button><button class="gb bigb" disabled>End</button>`, { style: '--pd:flex;gap:8px;flex:1' })}
  </div>
  ${dp('den:detail', `<div class="pickr">${ci('tab', 16)}<a>Pick tab / window manually</a><span class="dim small">Choose what to share instead of the current page</span></div>`)}
  ${dp('mode:rt', `<div class="live">
    <div class="lh"><span class="lt">Live</span>${dp('st:normal', `<span class="idle">${recdot}Listening</span>`, { tag: 'span', style: '--pd:inline-flex' })}${dp('st:empty st:error st:need st:locked', IDLE('Idle, press Start'), { tag: 'span', style: '--pd:inline-flex' })}</div>
    ${dp('st:normal', `<p class="lb">Original · zh</p><p class="prev">Lars: incident investigation report sudah selesai.</p><p class="cur">Drill evakuasi dipindah ke Jumat 07:30.</p><p class="lb">Translation · en</p><p class="tr">Evacuation drill moved to Friday 07:30.</p>`)}
    ${dp('st:empty st:error st:need st:locked', `<p class="lb">Original</p><p class="prev">The previous line shows here, dimmed.</p><p class="lb">Translation</p><p class="tr">Its translation sits right under it.</p>`)}</div>`)}
  ${dp('mode:off', `<div class="live"><div class="lh"><span class="lt">Results</span>${chp('Transcribing 62%', 'b')}</div>
    <div class="bar"><i style="width:62%"></i></div>
    <div class="rowb">${btn('SRT')}${btn('VTT')}${btn('TXT')}</div>
    <p class="dim small">Saved to Downloads · <a>Change…</a></p>
    <p class="prev">00:01:03  Apakah sudah ada konfirmasi dari Client HSE?</p><p class="prev">00:01:23  Update singkat emergency drill.</p></div>`)}`;

const captionsPerf = () => `
  <div class="perf">
    <div class="lh"><span class="lt">Performance</span><span class="grow"></span>${sgc('pv', [['ch', 'Charts'], ['tb', 'Table']], 'ch', 'sm')}${btn('Dock', 'sm')}</div>
    <div class="rowb"><span class="combo sm">Stage: all ${ic('down', 12)}</span><span class="combo sm">Pair: zh to en ${ic('down', 12)}</span><span class="combo sm">Source: bench ${ic('down', 12)}</span></div>
    <div class="kpis"><div><b class="mono">485 ms</b><span>ASR p50</span></div><div><b class="mono">–</b><span>MT p50</span></div><div><b class="mono">0.21×</b><span>RTF</span></div><div><b class="mono">200</b><span>N</span></div></div>
    ${dp('st:empty', '<div class="emp">No timing samples yet. Run a task, or load the bench file.</div>')}
    ${dp('st:normal st:error st:need st:locked', `<div class="pc">${dp('pv:ch', `<div class="chart"><span class="lbl">p50 by pair, 500 ms target</span><svg viewBox="0 0 360 96" width="100%" height="96" aria-label="p50 by pair"><line x1="0" y1="24" x2="360" y2="24" stroke="#5C6385" stroke-dasharray="4 4" stroke-width="1"/><text x="352" y="19" text-anchor="end" font-size="10" fill="#2B3358">500 ms target</text><rect x="18" y="26" width="52" height="64" rx="5" fill="#1B8EA0"/><text x="44" y="94" text-anchor="middle" font-size="10" fill="#2B3358">zh to en</text></svg></div>`)}${dp('pv:tb', `<table class="tbl"><tr><th>Stage</th><th>Pair</th><th>p50</th><th>p95</th></tr><tr><td>draft</td><td>zh to en</td><td class="mono">485</td><td class="mono">1100</td></tr></table>`)}</div>`)}
    <div class="rowb">${btn('Export JSON')}${btn('Export MD')}${btn('Import JSON')}${btn('Load bench')}${btn('Clear', 'quiet')}</div>
  </div>`;

const notesPane = () => `
  ${cx('notes', 'Capture', `<div class="rail">${dp('st:normal', recdot + '<span class="mono">12:04</span>', { tag: 'span', style: '--pd:inline-flex;gap:6px;align-items:center' })}${dp('st:empty st:error st:need st:locked', '<i class="dot off"></i><span class="mono dim">00:00</span>', { tag: 'span', style: '--pd:inline-flex;gap:6px;align-items:center' })}${chp('Rust · CUDA', 'o')}<span class="wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="grow"></span><span class="combo sm">HSE / safety ${ic('down', 12)}</span></div>
    <div class="rowb">${dp('st:locked st:empty', '<button class="pb" disabled>End &amp; draft</button>', { tag: 'span', style: '--pd:inline' })}${dp('st:normal st:error st:need', '<button class="pb">End &amp; draft</button>', { tag: 'span', style: '--pd:inline' })}
      ${dp('den:detail', `${dp('st:locked st:empty', `<button class="gb" disabled>${ci('flag', 14)} Flag this moment</button>`, { tag: 'span', style: '--pd:inline' })}${dp('st:normal st:error st:need', `<button class="gb">${ci('flag', 14)} Flag this moment</button><span class="kbd">Ctrl+Shift+F</span>`, { tag: 'span', style: '--pd:inline' })}`, { tag: 'span', style: '--pd:inline' })}</div>
    ${dp('st:locked', `<div class="lockbar">${ci('lock', 18)}<span>This meeting is issued and frozen. Flag and End &amp; draft are off. Start the next meeting to continue.</span></div>`)}`, '')}
  <div class="mbar"><span class="combo grow">Rapat Komite K3 · W01 ${ic('down', 14)}</span>${btn(ic('plus', 14) + ' New')}${chp('On-device', 'g')}</div>
  ${dp('st:empty', `<div class="emp">${tile('notes', 34)}<b>No meeting yet</b><span>Name a meeting with New, then start captions. Decisions and actions collect here.</span></div>`)}
  ${dp('st:normal st:locked st:error st:need', cx('register', 'Captured so far', `
    <div class="cnt"><span><b class="mono">2</b> decisions</span><span><b class="mono">3</b> actions</span><span><b class="mono">4</b> latest</span></div>
    <p class="prev">Summary: Drill moved to Fri 07:30; Mei and Lars hold two actions. ${btn('Auto summary', 'sm')}${btn('Save', 'sm')}${btn('Cancel', 'sm quiet')}</p>
    <div class="ni"><span class="ty" style="--c:var(--t-decision)">Decision</span><span class="tx">Drill evakuasi dipindah ke Jumat 07:30.</span>${ci('trash', 14)}</div>
    <div class="ni"><span class="ty" style="--c:var(--t-action)">Action</span><span class="tx">Mei · toolbox topic sheet · Fri</span>${ci('trash', 14)}</div>
    <div class="ni low"><span class="ty" style="--c:var(--t-question)">Question</span><span class="tx">Konfirmasi Client HSE soal near-miss log?</span>${chp('ASR 58% · check', 'y')}</div>
    <div class="rowb">${btn('+ Decision', 'sm')}${btn('+ Action', 'sm')}</div>`, ''))}
  <div class="rowb">${btn('Open register')}${btn('TXT', 'sm')}${btn('Markdown', 'sm')}${btn('Sync', 'sm')}${btn('Start next', 'sm')}</div>
  ${dp('st:need', cx('draft', 'Paste a Teams transcript', `<div class="ta">Paste the transcript here…</div><div class="rowb"><span class="combo grow">Title: Rapat Komite K3 · W02</span><button class="pb">Make minutes</button></div><p class="dim small">Needs a transcript and a title. Minutes appear below as items you can accept.</p>`))}
  <div class="svd"><b>Saved meetings</b><span class="dim">3</span><span class="grow"></span>${ci('trash', 14)}</div>`;

const histRow = (t, m) => `<div class="hrx"><div class="hrt"><b>${t}</b><span class="dim mono small">${m}</span></div><div class="rowb">${btn('Open', 'sm')}${btn('TXT', 'sm')}${btn('SRT', 'sm')}${btn('VTT', 'sm')}${btn(ci('trash', 13), 'sm quiet', ' aria-label="Delete"')}</div></div>`;
const historyPane = () => `
  <div class="search">${ic('search', 15)}<span>Search transcripts</span></div>
  ${dp('st:empty', `<div class="emp">${tile('history', 34)}<b>No history yet</b><span>Finished sessions land here with Open, TXT, SRT, VTT and Delete.</span></div>`)}
  ${dp('st:normal st:locked st:error st:need', histRow('Rapat Komite K3 · W01', '30 min · zh to en') + histRow('Lab demo clip', '2 min · zh to en') + histRow('CC0 sample: speech.wav', '41 s · en to id'))}
  ${cx('export', 'Export subtitles', `
    <div class="exr"><b>SRT</b><span class="dim">Universal subtitles</span>${btn('Export', 'sm')}</div>
    <div class="exr"><b>VTT</b><span class="dim">Web video, with cue header</span>${btn('Export', 'sm')}</div>
    <div class="exr"><b>TXT</b><span class="dim">Plain text transcript</span>${btn('Export', 'sm')}</div>
    <div class="two2"><label class="swl">${swt(true)}CRLF</label><label class="swl">${swt(false)}BOM</label><label class="swl">${swt(true)}Language suffix</label></div>
    <div class="rowb">${btn('Save to OS default')}<span class="dim small">Target: Downloads / yraverage-submin</span></div>`)}`;

const helperPane = () => `
  ${dp('st:error', `<div class="ebox">${tile('warn', 26)}<div><b>Helper disconnected</b><p>Captions use the browser engine (slower). The helper is not installed or has stopped.</p><div class="rowb">${btn('Re-check')}${btn('Install helper')}</div></div></div>`)}
  ${PART(cx('helper', 'Native helper', `
    <div class="rowb">${dp('st:error', chp('not connected', 'r'), { tag: 'span', style: '--pd:inline' })}${dp('st:normal st:empty st:locked st:need', chp('running', 'g'), { tag: 'span', style: '--pd:inline' })}${chp('Mode Realtime', 'n')}${chp('Task + Translate', 'n')}${chp('Rust · candle', 'o')}${chp('large-v3-turbo', 'n')}${chp('CUDA', 'g')}</div>
    ${NEW(kv2('Device', sgc('dev', [['auto', 'Auto'], ['cuda', 'CUDA'], ['cpu', 'CPU']], 'cuda', 'sm')))}${kv2('If the helper stops', 'browser Whisper (WASM) takes over')}
    ${dp('st:empty', '<div class="emp sm">No large-file job running.</div>')}
    ${dp('st:normal st:locked st:error st:need', `<div class="job"><div class="lh"><b>meeting-2026-02-17.mp4</b>${chp('Transcribing', 'b')}</div><div class="bar"><i style="width:62%"></i></div><div class="rowb"><span class="dim small">62% · 2.5 GiB</span><span class="grow"></span>${btn('Cancel job', 'sm')}</div></div>`)}`, btn('Collapse', 'sm quiet')), 'margin-top:2px')}
  ${cx('docs', 'Install guide', `
    <div class="rowb">${sgc('os', [['mac', 'macOS'], ['win', 'Windows'], ['lin', 'Linux']], 'win', 'sm')}<span class="grow"></span>${btn('Re-check', 'sm')}</div>
    <div class="stp"><b>1</b><span>Run <span class="mono">native\\run.bat</span></span>${btn('Copy', 'sm')}</div>
    <div class="stp"><b>2</b><span>Reload the extension, then press Re-check</span></div>
    ${dp('os:mac', `<div class="stp"><b>P</b><span class="mono sm">~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.yraveragesubmin.helper.json</span>${btn('Copy', 'sm')}</div>`)}
    ${dp('os:win', `<div class="stp"><b>P</b><span class="mono sm">HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.yraveragesubmin.helper</span>${btn('Copy', 'sm')}</div>`)}
    ${dp('os:lin', `<div class="stp"><b>P</b><span class="mono sm">~/.config/google-chrome/NativeMessagingHosts/com.yraveragesubmin.helper.json</span>${btn('Copy', 'sm')}</div>`)}
    <div class="dtl"><span>Prerequisites</span>${ic('down', 14)}</div><div class="dtl"><span>Troubleshooting</span>${ic('down', 14)}</div>`)}`;

const setCard = (icn, title, inner) => cx(icn, title, inner);
const settingsPane = () => `
  <div class="search">${ic('search', 15)}<span>Search settings</span></div>
  ${dp('st:empty', '<div class="emp sm">No setting matches your search.</div>')}
  ${sgc('ss', [['gen', 'General'], ['eng', 'Engine'], ['mod', 'Models'], ['out', 'Output'], ['abt', 'About']], 'gen', 'sm full')}
  ${dp('ss:gen', setCard('settings', 'General', `${kv2('UI language', '<span class="combo sm">English ' + ic('down', 12) + '</span>')}${kv2('Theme', sgc('th', [['a', 'Auto'], ['l', 'Light'], ['d', 'Dark']], 'l', 'sm'))}${kv2('Reskin pattern', sgc('rs', [['y', 'Yraverage'], ['c', 'Coretax'], ['m', 'Modern']], 'c', 'sm'))}${NEW(kv2('Tab rows', sgc('rows', [['one', 'One'], ['two', 'Two']], 'one', 'sm')))}${NEW(kv2('Translation colour', `<span class="tcg" role="group">${[['indigo', 'Indigo', 1], ['navy', 'Navy'], ['teal', 'Teal'], ['neutral', 'Neutral'], ['bronze', 'Bronze']].map(([k, l, on]) => bt('tc', k, '<i></i>', !!on, 'tcb', ` aria-label="${l}" title="${l}"`)).join('')}</span>`))}<div class="rowb">${btn('Reset reskin', 'sm')}</div>`))}
  ${dp('ss:eng', setCard('engine', 'Engine', `${kv2('Engine', sgc('en', [['n', 'Native helper'], ['b', 'Browser']], 'n', 'sm'))}${kv2('Helper URL', '<span class="mono">127.0.0.1:17865</span>')}${kv2('Status', chp('running', 'g'))}<div class="rowb">${btn('Start', 'sm')}${btn('Stop', 'sm')}${btn('Restart', 'sm')}${btn('Refresh', 'sm')}</div>${kv2('Helper compute', sgc('hc', [['a', 'Auto'], ['c', 'CPU'], ['g', 'GPU CUDA']], 'g', 'sm'))}${kv2('Inference device', sgc('id', [['a', 'Auto'], ['g', 'WebGPU'], ['w', 'WASM']], 'a', 'sm'))}<p class="dim small">Changing compute restarts the helper. Native models list below.</p>`))}
  ${dp('ss:mod', setCard('model', 'Models', `${kv2('Download source', sgc('mi', [['h', 'HuggingFace'], ['m', 'HF-Mirror']], 'h', 'sm'))}${kv2('Speed vs accuracy', sgc('sp', [['f', 'Fast'], ['b', 'Balanced'], ['a', 'Accurate']], 'b', 'sm'))}<div class="mrow2"><b>whisper large-v3-turbo</b>${chp('on device', 'g')}</div><div class="mrow2"><b>whisper base</b>${btn('Download', 'sm')}</div><div class="mrow2"><b>zh to en translation</b>${chp('on device', 'g')}</div><div class="mrow2"><b>ja to en translation</b>${btn('Download', 'sm')}</div>`))}
  ${dp('ss:out', setCard('export', 'Output', `${kv2('Save exports to', '<span class="mono">Downloads</span>')}<div class="rowb">${btn('Choose…', 'sm')}${btn('Clear', 'sm quiet')}</div>${kv2('Live refine', swt(true))}${kv2('Dual line', swt(false))}${kv2('Subtitle font size', '<span class="rng"><i style="width:55%"></i></span>')}`))}
  ${dp('ss:abt', setCard('docs', 'About', `${kv2('Version', 'v1.1.1')}${kv2('Open-source licences', '9 items')}<p class="dim small">Whisper, ONNX Runtime, candle, Opus-MT and the other parts listed in the licences card.</p>`))}`;

const intModal = () => `<div class="scrim"></div><div class="modal">
  <div class="lh"><b class="lt">Interpreter mode</b>${bt('ov', 'none', ic('plus', 14), false, 'ib x', ' aria-label="Close"')}</div>
  <div class="two">${bt('im', 'con', '<b>Consecutive</b><small>Language A ⇄ B, you take turns</small><span class="combo sm">zh ⇄ en</span>', true, 'icard')}${bt('im', 'sim', '<b>Simultaneous</b><small>One language, translated as it is spoken</small><span class="combo sm">zh</span>', false, 'icard')}</div>
  ${dp('st:error', '<div class="ebox sm">Pick two different languages for Consecutive.</div>')}
  ${dp('st:locked', '<p class="dim small">A task is running. Changes apply to the next task.</p>')}
  <div class="rowb end">${bt('ov', 'none', 'Cancel', false, 'gb')}${bt('ov', 'none', 'Turn on', false, 'pb')}</div></div>`;

function sidepanelPanel(h = 960) {
  return `<div class="app sp" style="width:440px;height:${h}px">
  <header class="sph">${dp('st:normal', recdot, { tag: 'span', style: '--pd:inline-block' })}${wmark}<span class="grow"></span>${sgc('den', [['simple', 'Simple'], ['detail', 'Detail']], 'detail', 'sm')}${bt('tab', 'settings', ic('gear', 15), false, 'ib', ' aria-label="Settings"')}</header>
  <div class="vtabs">${bt('tab', 'captions', 'Captions', true, '', ' data-top="1"')}${bt('tab', 'notes', 'Notes', false)}</div>
  <div class="spb">
    ${dp('tab:captions tab:perf', `<div class="subrow">${bt('tab', 'captions', 'Live', true, 'sub')}${bt('tab', 'perf', 'Performance', false, 'sub')}</div>`)}
    ${dp('tab:captions', captionsLive())}
    ${dp('tab:perf', captionsPerf())}
    ${dp('tab:notes', notesPane())}
    ${dp('tab:history', historyPane())}
    ${dp('tab:helper', helperPane())}
    ${dp('tab:settings', settingsPane())}
  </div>
  ${dp('st:error', `<div class="toastx">${ci('warn', 16)}<span>Helper not reachable. Browser engine in use.</span></div>`)}
  <div class="foot"><span class="dim small">v1.1.1</span>${ci('check', 12)}<a class="small">About</a></div>
  ${PART(`<nav class="bnav">${[['captions', 'Captions', 'captions'], ['notes', 'Notes', 'notes'], ['history', 'History', 'history'], ['helper', 'Helper', 'helper'], ['settings', 'Settings', 'settings']].map(([k, l, i]) => bt('tab', k, `${tile(i, 24)}<span>${l}</span>`, k === 'captions')).join('')}</nav>`, 'margin:0 8px 8px')}
  ${dp('ov:interp', intModal(), { cls: 'ovl', style: '--pd:flex' })}
</div>`;
}

function sidepanelAfter() {
  return `<div class="app d2" style="width:1140px;height:1080px">
  <div class="d2p">${sidepanelPanel(1030)}</div>
  <div class="d2m">
    <div class="d2h"><b>Every control, by group</b><span class="dim">83 features from today’s panel, all kept. Pick a group to jump to its tab.</span></div>
    <div class="mg">${MAP.map(mapCard).join('')}</div>
  </div>
</div>`;
}

/* ---------- D03: the lab shell, four tabs, nothing deleted ---------- */
const DEV_PARA = '<b>Browser tab · on-device Whisper</b> — Same pipeline as the extension (<span class="mono">offscreen.js</span> → <span class="mono">ai-worker.js</span> → ASR/MT). <b>Realtime:</b> Start loops a CC0/demo clip via <span class="mono">captureStream</span>; Pick uses <span class="mono">getDisplayMedia</span> (share a tab + audio). Overlay injection and <span class="mono">tabCapture</span> still need the Chrome extension. Offline → CC0 test samples for 10–30s public-domain clips per language.';
const PAGES = [
  ['Guides and register', 'docs', 'g', [
    ['Panduan pengguna — ekstensi', '/guide.html', 'Pasang, subtitel langsung, berkas, ekspor, notulen, helper.', 1],
    ['Panduan pengguna — macOS', '/guide.html?doc=USER-GUIDE-MACOS.md', 'Audio sistem, overlay layar penuh, dikte global, izin macOS.', 1],
    ['Panduan pengguna — Windows & Linux', '/guide.html?doc=USER-GUIDE-WINLINUX.md', 'Native Helper faster-whisper, installer host per OS, GPU CUDA, ekspor CRLF/BOM.', 1],
    ['Minutes Register (full tab)', '/src/minutes.html', 'Typed register, provenance drawer, series view and the issued-MoM document.', 1]]],
  ['Tools', 'pages', 'b', [
    ['Translation Lab', '/lab.html', 'Media player + automated zh↔en / ja↔en benchmark against the native helper.'],
    ['Offline Studio (transcription / export)', '/studio.html', 'File transcription, dual-line translation and the SRT/VTT/TXT export panel.'],
    ['Model manager (mock)', '/models.html', 'ASR + translation model sizes, download states and actions — preview only.'],
    ['Session history (samples)', '/history.html', 'Saved sessions list, transcript preview and per-session export — sample data.'],
    ['Helper status (mock)', '/helper-status.html', 'Native Helper cards for macOS / Windows / Linux with sample states.'],
    ['Helper install guide & troubleshooting (harness)', '/helper-guide.html', 'Per-OS install steps, live diagnostics and ranked troubleshooting.'],
    ['Meeting notes ticker (harness)', '/notes-panel.html', 'Side-panel notes ticker on the v2 register.']]],
  ['Release QA', 'perf', 't', [
    ['Phase 1 release verification', '/verify.html', 'Status dashboard for the 26 baseline sub-features.'],
    ['Smoke & E2E test report', '/qa-report.html', 'Summary of scripts/smoke.mjs and scripts/e2e.mjs (tabCapture, --pick, --native).'],
    ['Model performance benchmark lab', '/bench.html', 'Whisper / Voxtral / Opus-MT / native MLX comparison (last-bench.json).'],
    ['Release defect list', '/defects.html', 'Phase 1 release gate: must-fix defects vs accepted limitations.']]],
  ['Extension harnesses', 'helper', 'o', [
    ['Audio test page', '/audio-page.html', 'Looping tab audio for extension e2e / dev-browser.'],
    ['Overlay test', '/overlay-test.html', ''], ['Panel test', '/panel-test.html', ''], ['Offscreen test', '/offscreen-test.html', '']]],
  ['More', 'register', 'y', [['Test page index', '/', ''], ['CC0 sample credits', '/samples/ATTRIBUTION.md', '']]],
];
const pageRow = ([n, href, d, pri]) => `<div class="pgr${pri ? ' pri' : ''}"><b>${esc(n)}</b><span class="mono dim small">${href}</span>${d ? `<span class="pd">${esc(d)}</span>` : ''}</div>`;
const pagesGrid = () => `<div class="pg">${PAGES.map(([t, i, h, rows]) => `<div class="pgc">${cx(i, t, rows.map(pageRow).join(''), `<span class="mono dim small">${rows.length}</span>`)}</div>`).join('')}</div>`;
const pagesMenu = () => `<div class="menu">${PAGES.map(([t, , , rows]) => `<div class="sec">${t}</div>${rows.map(([n, , d]) => `<div class="mi"><b>${esc(n)}</b>${d ? `<span>${esc(d)}</span>` : ''}</div>`).join('')}`).join('')}</div>`;

const miniPanel = () => `<div class="app sp mini">
  <header class="sph">${wmark}<span class="grow"></span><span class="seg sm"><b>Simple</b><span>Detail</span></span></header>
  <div class="spb"><div class="lis"><div class="two">${segc([['Offline'], ['Realtime', 1]], 'full')}${segc([['Transcribe'], ['+ Translate', 1]], 'full')}</div>
    <div class="langs"><div class="fld"><label>From</label>${combo('Chinese')}</div><span class="to">${ic('arrow', 16)}</span><div class="fld"><label>To</label>${combo('English')}</div></div></div>
    <div class="cta"><button class="pb bigb">Start captions</button><button class="gb bigb" disabled>End</button></div>
    <div class="live"><div class="lh"><span class="lt">Live</span><span class="idle"><i class="dot off"></i>Idle, press Start</span></div><p class="cur">The current line appears here as it is spoken.</p><p class="tr">Its translation sits right under it.</p></div></div>
</div>`;

const logRows = [['12:04:01', 'GET', '/health', '200', '0 ms'], ['12:04:01', 'GET', '/engine/device', '200', '0 ms'], ['12:04:09', 'POST', '/engine/device', '200', '0 ms']];
const logErr = ['12:05:12', 'GET', '/health', 'Failed to fetch', '0 ms'];
const logTbl = (extra) => `<table class="tbl"><tr><th>Time</th><th>Method</th><th>Path</th><th>Result</th><th>Delay</th></tr>${[...logRows, ...(extra ? [logErr] : [])].map((r) => `<tr class="${r[3] === '200' ? '' : 'bad'}">${r.map((c, i) => `<td class="${i ? 'mono' : 'mono dim'}">${c}</td>`).join('')}</tr>`).join('')}</table>`;

const panelTab = () => `<div class="lcols">
  <div class="lrail">
    ${cx('check', 'Lab status', `${kv2('chrome-mock.js', chp('loaded', 'g'))}${kv2('dist/content.js', chp('overlay host', 'g'))}${kv2('dist/offscreen.js', chp('loaded', 'g'))}${kv2('Panel', dp('st:error', chp('missing', 'r'), { tag: 'span', style: '--pd:inline' }) + dp('st:empty', chp('loading', 'y'), { tag: 'span', style: '--pd:inline' }) + dp('st:normal st:locked st:need', chp('mounted', 'g'), { tag: 'span', style: '--pd:inline' }))}`)}
    ${cx('captions', 'Overlay log', `<div class="olog mono"><span>content: injected into tab 12</span><span>subtitle: 疏散演习改到周五</span><span>subtitle: moved to Friday 07:30</span></div>`)}
  </div>
  <div class="lcentre">
    <div class="frm">
      ${dp('st:normal st:locked st:need', miniPanel())}
      ${dp('st:empty', `<div class="app sp mini"><div class="ldg"><div class="skl"></div><div class="skl s"></div><div class="skl"></div><p class="dim small">Loading /dist/sidepanel.html …</p></div></div>`)}
      ${dp('st:error', `<div class="app sp mini"><div class="ebox pad">${tile('warn', 26)}<div><b>dist/sidepanel.html missing — run npm run build</b><p>Failed to load /dist/sidepanel.js</p><div class="rowb">${btn('Reload')}</div></div></div></div>`)}
    </div>
    ${dp('st:locked', `<div class="lockbar wide">${ci('lock', 18)}<span><b>Needs the Chrome extension.</b> Tab capture and overlay injection do not run in a plain tab. Realtime loops a CC0 clip instead.</span></div>`)}
    ${dp('st:need', `<div class="needbar">${tile('sample', 26)}<span><b>Choose an input.</b> Pick a CC0 sample on the right, or press Pick and share a tab with audio (getDisplayMedia).</span></div>`)}
  </div>
  <div class="lrail">
    ${cx('sample', 'CC0 samples', `<span class="combo">speech.wav · en ${ic('down', 14)}</span><div class="rowb">${btn('Run sample', 'p')}${chp('lab only', 'n')}</div><p class="dim small">10–30 s public-domain clips per language.</p>`)}
    ${cx('mock', 'Helper mock', `${kv2('helper.mode', '<b>passthrough</b>')}${kv2('latencyMs', '<span class="mono">0</span>')}${kv2('failNext', '<span class="mono">0</span>')}<a>Open mock controls</a>`)}
  </div>
</div>`;

const mockTab = () => `<div class="mkc">
  ${NEW(cx('mock', 'Helper mock (window.__labMock)', `
    <div class="mkr"><span class="lbl">helper.mode</span>${sgc('mm', [['pass', 'passthrough'], ['off', 'offline'], ['fix', 'fixture']], 'pass', '')}</div>
    ${dp('mm:pass', '<p class="dim">Requests to 127.0.0.1:17865 go to the real helper if one is running.</p>')}
    ${dp('mm:off', '<p class="dim">Every request fails like a helper that is not running. Use it to see the fallback to the browser engine.</p>')}
    ${dp('mm:fix', '<p class="dim">Answers /health and /engine/device from the fixtures below, no network.</p>')}
    <div class="mkr"><span class="lbl">latencyMs</span>${sgc('lt', [['0', '0'], ['250', '250'], ['1000', '1000']], '0', 'sm')}<span class="dim">delay on every answer</span></div>
    <div class="mkr"><span class="lbl">failNext</span>${sgc('fn', [['0', 'off'], ['1', 'fail next request']], '0', 'sm')}${dp('fn:1', '<span class="dim">then back to normal</span>', { tag: 'span', style: '--pd:inline' })}</div>
    <div class="rowb">${btn('Reset')}${chp('reset() restores passthrough, 0, 0 and clears both logs', 'n')}</div>`), 'margin-bottom:0')}
  <div class="mkx">
    ${cx('check', 'health fixture', `<pre class="code">{ "ok": true, "engine": "faster-whisper",\n  "model": "large-v3-turbo", "device": "cuda",\n  "platform": "Linux", "ffmpeg": true,\n  "translate": false }</pre>`)}
    ${cx('engine', 'device fixture', `<pre class="code">{ "device": "auto", "active": "cuda",\n  "compute": "float16",\n  "cuda_available": true,\n  "supported": true, "applied": true }</pre>`)}
    ${cx('history', 'Request log', dp('st:empty', '<div class="emp sm">No requests yet.</div>') + dp('st:normal st:locked st:need', logTbl(false)) + dp('st:error', logTbl(true)), btn('Clear', 'sm quiet'))}
  </div>
</div>`;

const guidesTab = () => `<div class="gcols">
  <div class="gl">${cx('docs', 'User guides', ['Extension (Bahasa Indonesia)', 'macOS', 'Windows and Linux'].map((x) => `<div class="pgr pri"><b>${x}</b><span class="mono dim small">/guide.html</span></div>`).join(''))}
    ${cx('register', 'Project docs', [['DEVELOPMENT.md', 'Build, test, run the lab'], ['QA.md', 'Smoke, E2E, release gate'], ['RELEASE-CHECKLIST.md', 'Before a store upload'], ['PROJECT-CONTEXT.md', 'What the project is']].map(([n, d]) => `<div class="pgr"><b>${n}</b><span class="pd">${d}</span></div>`).join(''))}</div>
  <div class="gr">${cx('notes', 'How the lab works', `<p class="dev">${DEV_PARA}</p>`)}</div>
</div>`;

function labAfter() {
  return `<div class="app lab" style="width:1140px;height:1010px">
  <header class="labbar">
    ${wmark}<span class="pill">Lab</span>
    ${NEW(bt('ov', 'how', 'How the lab works', false, 'gb'), 'margin-left:8px')}
    <span class="grow"></span>
    ${sgc('w', [['auto', 'Auto'], ['compact', 'Compact'], ['wide', 'Wide'], ['full', 'Full']], 'auto', '')}
    <a class="gb" href="#">Minutes register</a>${bt('ov', 'menu', 'All test pages ' + ic('down', 14), false, 'gb')}
  </header>
  <div class="ltabs">${[['panel', 'captions', 'Panel'], ['pages', 'pages', 'Test pages'], ['mock', 'mock', 'Mock helper'], ['guides', 'docs', 'Guides and docs']].map(([k, i, l]) => bt('tab', k, `${tile(i, 22)}<span>${l}</span>`, k === 'panel')).join('')}</div>
  <div class="lbody">
    ${dp('tab:panel', panelTab())}
    ${dp('tab:pages', NEW(pagesGrid()))}
    ${dp('tab:mock', mockTab())}
    ${dp('tab:guides', guidesTab())}
  </div>
  ${dp('ov:how', `<div class="scrim"></div><div class="pop how"><div class="lh"><b class="lt">How the lab works</b>${bt('ov', 'none', ic('plus', 14), false, 'ib x', ' aria-label="Close"')}</div><p class="dev">${DEV_PARA}</p></div>`, { cls: 'ovl', style: '--pd:block' })}
  ${dp('ov:menu', `<div class="scrim"></div><div class="pop mn2"><div class="lh"><b class="lt">All test pages</b>${bt('ov', 'none', ic('plus', 14), false, 'ib x', ' aria-label="Close"')}</div>${pagesMenu()}</div>`, { cls: 'ovl', style: '--pd:block' })}
</div>`;
}

/* ---------- T03: End & draft, three drafts side by side (yravg parallel-attempts + inline-diff + review-center) ---------- */
const DRAFTS = {
  a: { name: 'Short', sub: 'decisions first', items: [['d', 'Decision', 'Drill evakuasi dipindah ke Jumat 07:30; semua kontraktor ikut.', 'James Miller'], ['a', 'Action', 'Mei mengirim toolbox topic sheet sebelum akhir minggu ini.', 'Mei Lin'], ['a', 'Action', 'Lars mengirim incident investigation report ke Client HSE hari Rabu.', 'Lars Nilsen'], ['q', 'Question', 'Konfirmasi Client HSE soal near-miss log?', 'Unassigned']], meta: '4 items · 1 decision, 2 actions, 1 question' },
  b: { name: 'Full', sub: 'by agenda point', items: [['d', 'Decision', '1. Emergency drill: report done, next batch started; drill moved to Fri 07:30.', 'James Miller'], ['a', 'Action', '2. Toolbox topics: Mei sends the sheet before Friday.', 'Mei Lin'], ['r', 'Risk', '3. Heat stress: not discussed; carried to W02.', 'Unassigned']], meta: '3 agenda points · 3 items' },
  c: { name: 'Bilingual', sub: 'zh + en', items: [['d', 'Decision', '决定：疏散演习改到周五 07:30。 / Evacuation drill moved to Friday 07:30.', 'James Miller'], ['a', 'Action', '行动：Mei 周五前发送工具箱讲话表。 / Mei sends the toolbox sheet before Friday.', 'Mei Lin']], meta: '2 items · zh + en lines' },
};
const lane = (k) => {
  const d = DRAFTS[k]; const K = k.toUpperCase();
  const body = d.items.map(([t, l, x]) => `<div class="lni">${typeTag(t, l)}<span class="tx">${esc(x)}</span></div>`).join('');
  const fail = k === 'b' ? dp('st:error', `<div class="ebox">${tile('warn', 26)}<div><b>Draft B did not finish</b><p>The generator stopped after 2 of 3 agenda points. A and C are fine.</p><div class="rowb">${btn('Retry B')}</div></div></div>`) : '';
  const need = k === 'c' ? dp('st:need', `<div class="needbar">${tile('languages', 26)}<span><b>Pick a language pair.</b> Bilingual needs the session’s two languages.</span><div class="rowb"><span class="combo sm">Chinese ${ic('down', 12)}</span><span class="combo sm">English ${ic('down', 12)}</span></div></div>`) : '';
  const shown = k === 'b' ? dp('st:normal st:locked st:need', body) : k === 'c' ? dp('st:normal st:locked st:error', body) : body;
  return `<div class="lane" data-lane="${k}"><div class="lnh">${tile('draft', 28)}<div class="lnt"><b>Draft ${K}: ${d.name}</b><span class="dim small">${d.sub}</span></div>${k === 'a' ? `<span class="best">Suggested</span>` : ''}</div>
    ${k === 'a' ? '<p class="why small">Covers every decision and action in the fewest lines.</p>' : ''}
    ${fail}${need}
    <div class="lnb">${shown}</div>
    <div class="lnm small dim">${d.meta}</div>
    <div class="lnf">${bt('pk', k, 'Use this one', k === 'a', 'pickb')}<span class="note-in">Add a note…</span>${btn(ci('compare', 14), 'sm quiet', ' aria-label="Regenerate"')}</div></div>`;
};
const chk = (on = true) => `<span class="cbx${on ? ' on' : ''}">${on ? ic('check', 12) : ''}</span>`;
const draftFull = (k) => {
  const d = DRAFTS[k];
  return `<div class="dtab">
    <div class="rowb"><b>Draft ${k.toUpperCase()}: ${d.name}, ${d.sub}</b><span class="grow"></span>${sgc('ed', [['view', 'Read'], ['edit', 'Edit']], 'view', 'sm')}</div>
    ${d.items.map(([t, l, x, o], i) => `<div class="dti">${chk(!(k === 'a' && i === 3))}${typeTag(t, l)}<span class="tx"><span data-p="ed:view">${esc(x)}</span><span data-p="ed:edit" class="edt" style="--pd:inline">${esc(x)}</span></span><span class="ow">${o === 'Unassigned' ? '<span class="dim">Unassigned</span>' : `<i class="av">${o[0]}</i>${o}`}</span></div>`).join('')}
    ${dp('ed:edit', `<div class="rowb">${btn('Save edits', 'p')}${btn('Cancel')}<span class="dim small">Edits stay on this draft until you use it.</span></div>`)}
    <p class="dim small">Untick an item to leave it out when this draft is used.</p></div>`;
};
const diffTab = () => `<div class="dtab">
  <div class="rowb"><b>What changes in the register</b><span class="dim small">Draft A against meeting items today. Sample text.</span><span class="grow"></span><span class="kbd">Y</span><span class="dim small">accept</span><span class="kbd">N</span><span class="dim small">reject</span></div>
  <div class="dfr"><span class="tx">Drill evakuasi dipindah ke <del>Kamis</del> <ins>Jumat</ins> 07:30; semua kontraktor ikut.</span>${btn(ci('check', 14) + ' Accept', 'sm')}${btn('Reject', 'sm quiet')}</div>
  <div class="dfr"><span class="tx"><ins>Mei mengirim toolbox topic sheet sebelum akhir minggu ini.</ins></span>${btn(ci('check', 14) + ' Accept', 'sm')}${btn('Reject', 'sm quiet')}</div>
  <div class="dfr"><span class="tx"><del>Lars: incident report ke Client HSE.</del> <span class="dim">same as AI-009, skipped as a duplicate</span></span>${chp('dedupe', 'n')}</div>
</div>`;

function optionsAfter() {
  const tabs = [['cmp', 'compare', 'Compare'], ['a', 'draft', 'Draft A'], ['b', 'draft', 'Draft B'], ['c', 'draft', 'Draft C'], ['diff', 'diff', 'Diff']];
  return `<div class="app mn opt3" style="width:1140px;height:800px">
  <header class="abar">${wmark}<nav class="crumb"><a>Minutes</a>${ic('right', 12)}<span>${M.title} – ${M.week}</span>${ic('right', 12)}<span>End &amp; draft</span></nav><span class="grow"></span>${chp('On-device', 'g')}
    <span class="uses"><button class="pb" disabled data-p="st:locked st:empty st:need" style="--pd:inline-flex">Use picked draft</button>
    <span data-p="st:normal st:error" style="--pd:inline-flex;gap:8px;align-items:center">${dp('pk:a', '<button class="pb">Use draft A</button>', { tag: 'span', style: '--pd:inline' })}${dp('pk:b', '<button class="pb">Use draft B</button>', { tag: 'span', style: '--pd:inline' })}${dp('pk:c', '<button class="pb">Use draft C</button>', { tag: 'span', style: '--pd:inline' })}${dp('pk:none', '<button class="pb">Regenerate with my note</button>', { tag: 'span', style: '--pd:inline' })}</span></span></header>
  <div class="srcs">${dp('st:empty', `<span>${tile('warn', 22)}<b>No transcript yet.</b> Start captions or paste a Teams transcript, then End &amp; draft.</span>`, { tag: 'span', style: '--pd:inline-flex;gap:8px;align-items:center' })}
    ${dp('st:normal st:error st:need st:locked', `<span>${tile('captions', 22)}<b class="mono">53</b> segments · <span class="mono">07:00–07:30</span> · zh to en · sample-library</span><span class="dim">All three drafts read the same lines.</span>`, { tag: 'span', style: '--pd:inline-flex;gap:14px;align-items:center' })}</div>
  <div class="ltabs">${tabs.map(([k, i, l]) => bt('tab', k, `${tile(i, 22)}<span>${l}</span>`, k === 'cmp')).join('')}</div>
  <div class="obody">
    ${dp('st:locked', `<div class="lockbar wide">${ci('lock', 18)}<span><b>This meeting is issued and frozen.</b> Drafts stay readable; picking and “Use” are off. Start the next meeting to draft again.</span></div>`)}
    ${dp('st:need', `<div class="needbar"><span>${ci('pick', 20)}</span><span><b>Draft C needs a language pair.</b> “Use picked draft” stays off until you set it or pick another draft.</span></div>`)}
    ${dp('tab:cmp', `${dp('st:empty', `<div class="emp big">${tile('draft', 40)}<b>Nothing to draft from</b><span>The three drafts need a transcript. They keep to the same lines, so they can be compared.</span></div>`)}
      ${dp('st:normal st:error st:need st:locked', `${PART(`<div class="lanes">${lane('a')}${lane('b')}${lane('c')}</div>`, 'margin-top:4px')}
      ${NEW(`<div class="nonex">${bt('pk', 'none', 'None of these', false, 'pickb')}<span class="note-in wide">Tell the drafter what to change, e.g. “shorter, owners first”…</span>${btn('Regenerate all', 'sm')}</div>`)}`)}`)}
    ${dp('tab:a', draftFull('a'))}${dp('tab:b', draftFull('b'))}${dp('tab:c', draftFull('c'))}${dp('tab:diff', NEW(diffTab()))}
  </div>
  <footer class="ofoot"><span class="dim">3 of 4 items in Draft A are new; 1 already sits in the register (AI-009) and is skipped.</span><span class="grow"></span>${btn('Discard drafts', 'quiet')}</footer>
</div>`;
}

  const toggle = () => `<div class="ixh"><div class="vw" role="group" aria-label="View">${bt('ba', 'before', 'Before', false)}${bt('ba', 'after', 'After', true)}</div><span data-p="ba:after" style="--pd:inline-flex"><div class="vw vs" role="group" aria-label="State">${STATE_KEYS.map(([k, l]) => bt('st', k, l, k === 'normal')).join('')}</div></span></div>`;
  return { sidepanelAfter, labAfter, optionsAfter, toggle };
}

/** Pane rules: one per data-p token found in the given html. */
export function paneCss(html) {
  const toks = new Set([...html.matchAll(/data-p="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  return '[data-p]{display:none!important;--pd:block}\n' + [...toks].map((t) => { const [g, k] = t.split(':'); return `.board:has([data-g="${g}"][data-k="${k}"][aria-pressed="true"]) [data-p~="${t}"]{display:var(--pd,block)!important}`; }).join('\n');
}

/** Static page: radio-style press inside the board that was clicked. */
export const ixScript = `<script>document.addEventListener('click',function(e){var t=e.target.closest('[data-g][data-k]');if(!t)return;var b=t.closest('.board');if(!b)return;var g=t.getAttribute('data-g'),k=t.getAttribute('data-k');b.querySelectorAll('[data-g="'+g+'"]').forEach(function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-k')===k))})});</script>`;

/** Design canvas export: bind each button to DCLogic state. */
export function ixDc(body) {
  const re = /data-g="(\w+)" data-k="(\w+)" aria-pressed="(true|false)"/g;
  const all = [...body.matchAll(re)];
  const def = {}; const pairs = new Set();
  for (const [, g, k, on] of all) { if (!(g in def)) def[g] = ''; if (on === 'true') def[g] = k; pairs.add(g + '|' + k); }
  const out = body.replace(re, (m, g, k) => `data-g="${g}" data-k="${k}" aria-pressed="{{p_${g}_${k}}}" onClick="{{go_${g}_${k}}}"`);
  const lines = [...pairs].map((p) => { const [g, k] = p.split('|'); return `o.p_${g}_${k} = s.${g} === '${k}'; o.go_${g}_${k} = () => this.setState({ ...this.state, ${g}: '${k}' });`; });
  const logic = `class Component extends DCLogic {
state = ${JSON.stringify(def)};
renderVals() {
const s = this.state; const o = {};
${lines.join('\n')}
return o;
}
}`;
  return { body: out, logic };
}
