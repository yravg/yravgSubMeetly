// THREADS tier boards (T01 Inbox, T02 Librarian, T04 Highlights, T05 Add-ins): one three-pane shell, four data sets.
// Layout after Threadbear (left list, main thread, right panel); interaction state lives in data-* attributes on the
// window root and is changed by one small reducer (TB_CORE) that runs both in the static page and in the Design canvas
// Component class. All strings are sample data (series LIB-HSE2, labelled sample).
export const TB_CORE = `
function tbSplit(x){return x?x.split(' ').filter(Boolean):[]}
function tbAct(s,a,C){var i=a.indexOf(':'),k=a.slice(0,i),v=a.slice(i+1),n=Object.assign({},s);
var L=function(f){return tbSplit(n[f])},set=function(f,l){n[f]=l.join(' ')};
var bad=function(){return L('done').concat(L('arc'))};
var next=function(from){var o=C.order,at=o.indexOf(from),rest=o.slice(at+1).concat(o.slice(0,Math.max(at,0)));return rest.find(function(x){return x!==from&&bad().indexOf(x)<0})||''};
n.last=s.last;
if(k==='open'){n.sel=v;n.last=''}
else if(k==='st'){n.st=v;n.last=''}
else if(k==='flt')n.flt=v;
else if(k==='tgl')n[v]=n[v]==='1'?'0':'1';
else if(k==='done'){set('done',L('done').concat(v));n.sel=next(v);n.last=v;n.lk=C.doneWord}
else if(k==='arc'){set('arc',L('arc').concat(v));if(n.sel===v)n.sel=next(v);n.last=v;n.lk=C.arcWord}
else if(k==='arcall'){var f=L('done').filter(function(x){return L('arc').indexOf(x)<0});set('arc',L('arc').concat(f));n.last=''}
else if(k==='undo'){var u=v==='last'?s.last:v;if(u){if(!(v==='last'&&s.lk===C.arcWord))set('done',L('done').filter(function(x){return x!==u}));set('arc',L('arc').filter(function(x){return x!==u}));n.sel=u;n.last=''}}
else if(k==='tick'){var d=L('done');set('done',d.indexOf(v)<0?d.concat(v):d.filter(function(x){return x!==v}))}
else if(k==='rep'){var r=L('rep');if(r.indexOf(v)<0)set('rep',r.concat(v))}
return n}
function tbVals(s,C){var d=tbSplit(s.done),r=tbSplit(s.arc),I=C.order.filter(function(x){return d.indexOf(x)<0&&r.indexOf(x)<0}),F=C.order.filter(function(x){return d.indexOf(x)>=0&&r.indexOf(x)<0}),A=C.order.filter(function(x){return r.indexOf(x)>=0});
var o={sel:s.sel,st:s.st,done:s.done,arc:s.arc,rep:s.rep,flt:s.flt,fa:s.fa,pz:s.pz,n_in:''+I.length,n_fin:''+F.length,n_arc:''+A.length,nf:F.length?'1':'0',na:A.length?'1':'0',zero:I.length?'0':'1',toast:s.last?'1':'0',last_t:C.titles[s.last]||'',last_k:s.lk||''};
C.states.forEach(function(m){o['pr_'+m]=s.st===m});C.flts.forEach(function(m){o['pf_'+m]=s.flt===m});return o}
`;
export const TB_ROOT_KEYS = ['sel', 'st', 'done', 'arc', 'rep', 'flt', 'fa', 'pz', 'nf', 'na', 'zero', 'toast'];

const safe = (s) => s.replace(/[^A-Za-z0-9]/g, '');
const STATES = ['normal', 'empty', 'error', 'locked', 'needs'];
const STATE_LABEL = { normal: 'Normal', empty: 'Empty', error: 'Error', locked: 'Locked', needs: 'Needs input' };

export function makeThreads({ ic, wmark, esc, NEW, PART, st }) {
  const typeVar = { d: 'decision', a: 'action', q: 'question', r: 'risk', m: 'metric', p: 'decision', x: 'info' };
  const tile = (icon, k, s = 15) => `<i class="tl" style="--c:var(--t-${typeVar[k]})">${ic(icon, s)}</i>`;
  const bind = (n, v) => `<b class="mono" data-bind="${n}">${v}</b>`;
  const av = (n) => `<i class="av">${esc(n[0])}</i>`;

  /* ---------- one board = config + items ---------- */
  function shell(cfg) {
    const items = cfg.items.map((x) => ({ ...x, id: safe(x.id) }));
    const C = { order: items.map((x) => x.id), titles: Object.fromEntries(items.map((x) => [x.id, x.title])), states: STATES, flts: cfg.flt ? cfg.flt.map((f) => f[0]) : ['all'], doneWord: cfg.doneWord, arcWord: cfg.arcWord };
    const init = { sel: cfg.sel ? safe(cfg.sel) : '', st: 'normal', done: items.filter((x) => x.pre).map((x) => x.id).join(' '), arc: '', rep: '', flt: 'all', fa: '0', pz: '0', last: '', lk: '' };
    const act = (a, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="${a}">${label}</button>`;

    const row = (x, sec) => `<div class="tr ${sec} i-${x.id} k-${x.k}" data-act="open:${x.id}" role="button" tabindex="0">${sec === 'in' && x.un ? '<i class="un"></i>' : '<i class="un off"></i>'}${sec === 'fin' ? `<i class="tl ok">${ic('check', 15)}</i>` : tile(x.icon, x.k)}<span class="tt"><b class="ell">${esc(x.title)}</b><span class="dim ell">${esc(x.sub)}</span></span><span class="dim small">${x.when}</span></div>`;
    const list = `<aside class="tbl">
      <div class="srch">${ic('search', 14)}<span>Search threads</span><i class="ic-r">${ic('plus', 14)}</i></div>
      ${cfg.flt ? `<div class="flt">${cfg.flt.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${k === 'all'}" data-pf="${k}" data-act="flt:${k}">${l}</button>`).join('')}</div>` : ''}
      ${cfg.librarian ? `<div class="lbr"><i class="dot"></i><span><b>Librarian</b> rules only, on this device</span><button type="button" class="btn" data-act="tgl:pz"><span class="pz0">Pause</span><span class="pz1">Resume</span></button></div>` : ''}
      <div class="sbn er">${ic('flag', 14)}<span>${cfg.states.error}</span><button type="button" class="btn" data-act="st:normal">Retry</button></div>
      <div class="sbn lk">${ic('info', 14)}<span>${cfg.states.locked}</span></div>
      <div class="sbn nd">${ic('flag', 14)}<span>${cfg.states.needs}</span></div>
      <div class="sh">${ic('inbox', 14)}<span>${cfg.secs[0]}</span>${bind('n_in', C.order.length - items.filter((x) => x.pre).length)}</div>
      ${items.map((x) => row(x, 'in')).join('')}
      <div class="zl">${ic('check', 16)}<b>${cfg.zero[0]}</b><span class="dim">${cfg.zero[1]}</span></div>
      <div class="sh fin">${ic('check', 14)}<span>${cfg.secs[1]}</span>${bind('n_fin', items.filter((x) => x.pre).length)}<span class="grow"></span><button type="button" class="lnk" data-act="arcall:x">Archive all</button></div>
      ${items.map((x) => row(x, 'fin')).join('')}
      <div class="sh ar" data-act="tgl:fa" role="button" tabindex="0">${ic('down', 14)}<span>${cfg.secs[2]}</span>${bind('n_arc', 0)}</div>
      ${items.map((x) => row(x, 'ar')).join('')}
    </aside>`;

    const head = (x) => `<div class="mh2">${tile(x.icon, x.k, 17)}<h3 class="ell">${esc(x.title)}</h3><span class="ty" style="--c:var(--t-${typeVar[x.k]})">${x.label}</span><span class="grow"></span><span class="stv"><span class="o">${cfg.openWord}</span><span class="c">${cfg.doneWord}</span><span class="a">${cfg.arcWord}</span></span></div>`;
    const bubble = (who, text, me) => `<div class="bb${me ? ' me' : ''}"><span class="who">${me ? '' : av(who)}<b>${esc(who)}</b></span><p>${text}</p></div>`;
    const main = (x) => `<section class="th i-${x.id}">
      ${head(x)}
      <div class="msgs">
        ${x.quote}
        ${(x.replies || []).map(([w, t]) => bubble(w, t)).join('')}
        ${(x.reps || []).map((r) => `<div class="rp r-${r.tok}">${bubble('You', r.text, true)}</div>`).join('')}
      </div>
      <div class="ny i-${x.id}"><div class="nyh">${ic('flag', 15)}<b>${cfg.askLabel}</b></div><p>${x.ask}</p><div class="nyb">${x.btns.map(([l, a, cls]) => act(`${a === 'done' || a === 'arc' ? a : 'rep'}:${a === 'done' || a === 'arc' ? x.id : a}`, l, cls === 'p' ? 'p' : '')).join('')}</div></div>
      <div class="fn i-${x.id}">${ic('check', 15)}<span><b>${cfg.doneWord}.</b> ${cfg.finNote}</span><span class="grow"></span>${act(`arc:${x.id}`, cfg.archiveLabel, 'p')}${act(`undo:${x.id}`, 'Reopen')}</div>
      <div class="an i-${x.id}">${ic('inbox', 15)}<span><b>${cfg.arcWord}.</b> ${cfg.arcNote}</span><span class="grow"></span>${act(`undo:${x.id}`, 'Restore')}</div>
      <div class="cmp"><span class="dim">${esc(x.reps[0].draft)}</span><span class="grow"></span>${act(`rep:${x.reps[0].tok}`, 'Send', 'p')}</div>
    </section>`;
    const zeroMain = `<section class="th0"><i class="zi">${ic('check', 26)}</i><h3>${cfg.zero[0]}</h3><p class="dim">${cfg.zero[1]}</p></section>`;

    const toast = `<div class="toast"><span><b data-bind="last_k"></b> <span data-bind="last_t"></span></span><button type="button" class="lnk" data-act="undo:last">Undo</button></div>`;
    const stBar = `<div class="sbm er">${cfg.states.error}</div><div class="sbm lk">${cfg.states.locked}</div><div class="sbm nd">${cfg.states.needs}</div>`;
    const right = `<aside class="tbr"><div class="rh2">${ic(cfg.rightIcon, 15)}<b>${cfg.rightTitle}</b><span class="grow"></span><span class="dim small">${cfg.rightNote}</span></div>
      <div class="dt0 dim">${cfg.rightEmpty}</div>${items.map((x) => `<div class="dt i-${x.id}">${x.side}</div>`).join('')}</aside>`;
    const rail = `<nav class="rail">${cfg.rail.map(([i, l, on, b]) => `<a class="${on ? 'on' : ''}" aria-label="${l}">${ic(i, 18)}${b ? `<span class="bdg" data-bind="n_in">${b}</span>` : ''}</a>`).join('')}</nav>`;

    const root = `<div class="app mn tb" data-tb="${cfg.key}" ${Object.entries({ ...init, nf: '1', na: '0', zero: '0', toast: '0' }).filter(([k]) => TB_ROOT_KEYS.includes(k)).map(([k, v]) => `data-${k}="${v}"`).join(' ')} style="width:1600px;height:900px">
  <header class="abar">${wmark}<nav class="crumb"><a>Minutes</a>${ic('right', 12)}<span>${cfg.crumb}</span></nav><span class="grow"></span><span class="pill ok"><i class="dot"></i>On-device</span><button class="gb">${ic('book', 14)} Library</button><button class="pb">Issue MoM</button></header>
  <div class="tbbody">${rail}${NEW(list, 'display:flex;flex:none', 'tbwrap')}<main class="tbm">${stBar}${zeroMain}${items.map(main).join('')}${toast}</main>${right}</div>
</div>`;

    /* per-id CSS: the only thing that differs between rows is which attribute word it matches */
    const css = items.map((x) => {
      const i = x.id, r = `.tb[data-sel="${i}"]`, d = `.tb[data-done~="${i}"]`, a = `.tb[data-arc~="${i}"]`;
      return `${r} .th.i-${i},${r} .dt.i-${i}{display:flex}${r} .tr.i-${i}{background:var(--accent-dim);box-shadow:inset 3px 0 0 var(--gold)}
${d} .tr.fin.i-${i}{display:flex}${d} .tr.in.i-${i},${a} .tr.in.i-${i},${a} .tr.fin.i-${i}{display:none}.tb[data-fa="1"][data-arc~="${i}"] .tr.ar.i-${i}{display:flex}
${d} .ny.i-${i},${a} .ny.i-${i}{display:none}${d} .fn.i-${i}{display:flex}${a} .fn.i-${i}{display:none}${a} .an.i-${i}{display:flex}
${d} .i-${i} :is(.stv,.stv2) .o,${a} .i-${i} :is(.stv,.stv2) .o{display:none}${d} .i-${i} :is(.stv,.stv2) .c{display:inline-flex}${a} .i-${i} :is(.stv,.stv2) .c{display:none}${a} .i-${i} :is(.stv,.stv2) .a{display:inline-flex}`
        + (x.reps || []).map((q) => `.tb[data-rep~="${q.tok}"] .rp.r-${q.tok}{display:block}`).join('')
        + (x.ticks || []).map((t) => `.tb[data-done~="${t}"] .tk.k-${t}{background:var(--ok);color:var(--white);box-shadow:none}.tb[data-done~="${t}"] .tkr.k-${t} .tkt{text-decoration:line-through;color:var(--muted)}`).join('');
    }).join('\n') + ['d', 'a', 'q', 'r'].filter(() => cfg.flt).map((k) => `.tb[data-flt="${k}"] .tr.in:not(.k-${k}){display:none}`).join('');
    return { html: root, C, init, css, items };
  }

  /* ---------- shared item pieces ---------- */
  const quote = (text, who, tc, conf) => `<div class="qt"><span class="qh">${ic('play', 11)}<span class="mono">${tc}</span><span class="dim">· ${esc(who)}</span><span class="grow"></span><span class="mono ${conf < 70 ? 'lowc' : 'dim'}">ASR ${conf}%</span></span><p>${esc(text)}</p></div><div class="aiN">${ic('info', 13)}<span>Drafted on this device from the transcript. Nothing left this device.</span></div>`;
  const kv = (k, v) => `<div class="kv2"><span class="dim">${k}</span><span>${v}</span></div>`;
  const own = (n) => (n ? `${av(n)}${esc(n)}` : '<span class="dim">Unassigned</span>');
  const chips = (a) => a.map((x) => `<span class="rc mono">${x}</span>`).join('');
  const hist = (a) => `<ul class="hs">${a.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const sideItem = (x) => `<div class="blk"><div class="sl">Status</div><div class="stv2"><span class="o"><i class="dot"></i>${x.status}</span><span class="c"><i class="dot"></i>Finished</span><span class="a"><i class="dot off"></i>Archived</span></div></div>
    <div class="blk">${kv('Owner', own(x.owner))}${kv('Due', x.due)}${kv('Meeting', x.meet)}${kv('Item', `<span class="mono">${x.ref}</span>`)}</div>
    <div class="blk"><div class="sl">Source</div>${kv('Timecode', `<span class="mono">${x.tc}</span>`)}${kv('Confidence', `<span class="mono">${x.conf}%</span>`)}</div>
    <div class="blk"><div class="sl">Linked items</div><div class="rcs">${chips(x.rel)}</div></div>
    <div class="blk"><div class="sl">History</div>${hist(x.hist)}</div>`;

  /* ================= T01 ================= */
  const t1items = [
    { id: 'AI-007', k: 'd', icon: 'flag', label: 'Decision', title: 'Drill evakuasi dipindah ke Jumat 07:30', sub: 'AI-007 · Komite K3 W01', when: '07:12', un: 1, owner: 'James Miller', due: '—', meet: 'Komite K3 · W01', ref: 'AI-007', tc: '00:04:12', conf: 92, status: 'Open, AI draft', rel: ['AI-005', 'AI-009'], hist: ['07:12 drafted from line 53', 'Needs your accept'],
      quote: quote('Drill evakuasi dipindah ke Jumat 07:30; semua kontraktor ikut.', 'James Miller', '00:04:12', 92), replies: [['Mei Lin', 'Sudah saya sampaikan ke kontraktor lantai 2.']], ask: 'Accept this decision into the register?',
      btns: [['Accept', 'done', 'p'], ['Edit', 'AI007e'], ['Dismiss', 'arc']], reps: [{ tok: 'AI007e', draft: 'Edit: keep Friday 07:30, add “all contractors attend”.', text: 'Edit saved: “Drill evakuasi Jumat 07:30; semua kontraktor ikut.” Kept as decision.' }] },
    { id: 'AI-005', k: 'a', icon: 'list', label: 'Action', title: 'Mei Lin · toolbox topic sheet', sub: 'AI-005 · due Fri 20 Feb', when: '07:10', un: 1, owner: 'Mei Lin', due: 'Fri 20 Feb', meet: 'Komite K3 · W01', ref: 'AI-005', tc: '00:01:59', conf: 60, status: 'Open', rel: ['AI-003', 'AI-007'], hist: ['07:10 drafted, 60% ASR', 'Owner set to Mei Lin by speaker'],
      quote: quote('Mei akan mengirim toolbox topic sheet sebelum akhir minggu ini.', 'Mei Lin', '00:01:59', 60), replies: [], ask: 'Is the toolbox topic sheet sent?',
      btns: [['Done', 'done', 'p'], ['Snooze', 'arc'], ['Carry', 'AI005c']], reps: [{ tok: 'AI005c', draft: 'Carry to W02, keep the opened date (17 Feb).', text: 'Carried to W02. Opened 17 Feb is kept, age shows 1 meeting.' }] },
    { id: 'AI-009', k: 'a', icon: 'list', label: 'Action', title: 'Lars Nilsen · investigation report', sub: 'AI-009 · due Wed 18 Feb', when: '07:06', un: 1, owner: 'Lars Nilsen', due: 'Wed 18 Feb', meet: 'Komite K3 · W01', ref: 'AI-009', tc: '00:06:40', conf: 88, status: 'Open', rel: ['AI-007'], hist: ['07:06 drafted, 88% ASR'],
      quote: quote('Lars mengirim incident investigation report ke Client HSE hari Rabu.', 'James Miller', '00:06:40', 88), replies: [['Lars Nilsen', 'Draft sudah selesai, tinggal review internal.']], ask: 'Did the report reach Client HSE?',
      btns: [['Done', 'done', 'p'], ['Snooze', 'arc'], ['Carry', 'AI009c']], reps: [{ tok: 'AI009c', draft: 'Carry to W02, due moves to Fri 20 Feb.', text: 'Carried to W02, due Fri 20 Feb.' }] },
    { id: 'AI-001', k: 'q', icon: 'info', label: 'Open question', title: 'Client HSE near-miss log confirmation', sub: 'AI-001 · asked 2 meetings ago', when: '07:02', un: 1, owner: '', due: '—', meet: 'Komite K3 · W01', ref: 'AI-001', tc: '00:01:03', conf: 60, status: 'Open, no owner', rel: ['AI-003'], hist: ['W51 first asked', 'W01 asked again (carried)'],
      quote: quote('Apakah sudah ada konfirmasi dari Client HSE soal near-miss log untuk emergency drill?', 'Mei Lin', '00:01:03', 60), replies: [], ask: 'Has Client HSE confirmed the near-miss log?',
      btns: [['Answered', 'done', 'p'], ['Carry', 'AI001c'], ['Snooze', 'arc']], reps: [{ tok: 'AI001c', draft: 'Carry to W02 and assign to James Miller.', text: 'Carried to W02, owner James Miller.' }] },
    { id: 'R-W51', k: 'r', icon: 'flag', label: 'Risk', title: 'Heat stress control not reviewed since W51', sub: 'AI-002 · no owner', when: 'Mon', un: 1, owner: '', due: '—', meet: 'Komite K3 · W51', ref: 'AI-002', tc: '00:01:23', conf: 60, status: 'Open, no owner', rel: ['AI-007'], hist: ['W51 raised', 'W01 not discussed'],
      quote: quote('Update singkat emergency drill: tim sudah menyelesaikan incident investigation report dan mulai batch berikutnya.', 'Lars Nilsen', '00:01:23', 60), replies: [], ask: 'Who owns the heat stress review?',
      btns: [['Mitigated', 'done', 'p'], ['Assign owner', 'R51a'], ['Snooze', 'arc']], reps: [{ tok: 'R51a', draft: 'Assign to Lars Nilsen, review in W02.', text: 'Owner set: Lars Nilsen. Review in W02.' }] },
    { id: 'AI-003', k: 'q', icon: 'info', label: 'Open question', title: 'Toolbox topic sheet confirmation', sub: 'AI-003 · answered', when: '07:01', pre: 1, owner: 'Mei Lin', due: '—', meet: 'Komite K3 · W01', ref: 'AI-003', tc: '00:01:34', conf: 60, status: 'Open', rel: ['AI-005'], hist: ['07:01 drafted', 'Answered by Mei Lin'],
      quote: quote('Apakah sudah ada konfirmasi dari Client HSE soal toolbox topic sheet untuk emergency drill?', 'Mei Lin', '00:01:34', 60), replies: [['Mei Lin', 'Client HSE setuju, sheet dikirim Jumat.']], ask: 'Answered?', btns: [['Answered', 'done', 'p']], reps: [{ tok: 'AI003c', draft: 'Reply to this thread', text: 'Noted.' }] },
  ];
  const T01 = shell({ key: 'T01', crumb: 'Inbox', sel: 'AI-007', openWord: 'Open', doneWord: 'Finished', arcWord: 'Archived', askLabel: 'Needs you', finNote: 'It stays in Finished until you archive it.', archiveLabel: 'Archive', arcNote: 'Closed items stay in the register; only the inbox forgets them.',
    flt: [['all', 'All'], ['d', 'Decisions'], ['a', 'Actions'], ['q', 'Questions'], ['r', 'Risks']], secs: ['Inbox', 'Finished', 'Archived'], zero: ['Inbox zero', 'Next meeting: Rapat Komite K3 · W02, Tue 24 Feb 07:00.'],
    states: { error: 'Could not read the register on this device. Your meetings are not lost.', locked: 'Locked: MoM LIB-HSE2-W01 was issued. Amend it to change items.', needs: '5 items wait on your answer.' },
    rail: [['inbox', 'Inbox', 1, 5], ['list', 'Meetings'], ['book', 'Projects'], ['grid', 'Series'], ['bolt', 'Add-ins']], rightIcon: 'info', rightTitle: 'Details', rightNote: 'source and links', rightEmpty: 'Pick a thread to see its owner, due date, source and linked items.', items: t1items.map((x) => ({ ...x, side: sideItem(x) })) });

  /* ================= T02 ================= */
  const lib = (series, proj, ptype, title, why) => `<div class="sug"><div class="sugh">${ic('book', 14)}<b>Librarian suggests</b><span class="grow"></span><span class="dim small">rules, no model</span></div>${kv('Title', esc(title))}${kv('Series', series)}${kv('Project', proj)}${kv('Project type', ptype)}<div class="why"><b>Why:</b> ${why}</div></div><div class="aiN">${ic('info', 13)}<span>A value you set yourself is never overwritten without Accept.</span></div>`;
  const pnotes = (proj, lines, h) => `<div class="blk"><div class="sl">Project notes · ${proj}</div><ul class="pn2">${lines.map((l) => `<li>${l}</li>`).join('')}</ul></div><div class="blk"><div class="sl">Look history</div>${hist(h)}</div>`;
  const t2items = [
    { id: 'W02', k: 'p', icon: 'book', label: 'Suggestion', title: 'Komite K3 Mingguan Site B – W02', sub: '→ Site B · HSE · 0.94', when: 'now', un: 1,
      quote: lib('Komite K3 (week 2 of 26)', 'Site B · HSE', 'HSE / safety', 'Rapat Komite K3 Mingguan Site B – Week 2', 'same chair, 4 of 5 attendees, title match 0.94'), replies: [], ask: 'File this meeting as suggested?',
      btns: [['Accept', 'done', 'p'], ['Change', 'W02c'], ['Dismiss', 'arc']], reps: [{ tok: 'W02c', draft: 'Change project type to HSE / general.', text: 'Changed project type to HSE / general. Filing waits for Accept.' }],
      side: pnotes('Site B · HSE', ['Evacuation drill moved to Fridays 07:30 (W01, AI-007).', 'Client HSE still owes the near-miss log confirmation (AI-001).', 'Toolbox topic sheets: Mei Lin sends weekly (AI-005).'], ['W01 filed to Site B · HSE (accepted)', 'W02 suggested, 0.94']) },
    { id: 'WALK', k: 'p', icon: 'book', label: 'Low match', title: 'Weekly HSE walk Site B', sub: '→ Unfiled · 0.58', when: '1h',  un: 1,
      quote: lib('none matched', 'Unfiled', 'HSE / safety', 'Weekly HSE walk Site B', 'title shares 2 words with Komite K3, no common chair; below 0.7, so it stays unfiled'), replies: [], ask: 'Which project does this meeting belong to?',
      btns: [['File to Site B · HSE', 'done', 'p'], ['Keep unfiled', 'arc'], ['Pick…', 'WALKc']], reps: [{ tok: 'WALKc', draft: 'Pick Platform tie-in · EPCI instead.', text: 'Project changed to Platform tie-in · EPCI. Filing waits for Accept.' }],
      side: pnotes('Unfiled', ['Meetings below 0.7 stay here until you pick a project.', '1 meeting unfiled.'], ['Walk suggested Unfiled, 0.58']) },
    { id: 'TIE', k: 'p', icon: 'book', label: 'Suggestion', title: 'Platform tie-in kickoff', sub: '→ Platform tie-in · EPCI · 0.88', when: 'Mon', un: 1,
      quote: lib('Tie-in coordination (week 1)', 'Platform tie-in · EPCI', 'EPCI / construction', 'Platform tie-in kickoff', 'agenda words match series, 3 of 4 attendees, title match 0.81'), replies: [], ask: 'File this meeting as suggested?',
      btns: [['Accept', 'done', 'p'], ['Change', 'TIEc'], ['Dismiss', 'arc']], reps: [{ tok: 'TIEc', draft: 'Rename to Platform tie-in coordination.', text: 'Title changed to “Platform tie-in coordination”.' }],
      side: pnotes('Platform tie-in · EPCI', ['Tie-in window agreed for week 12 (decision AI-004).', 'Weld procedure approval pending (AI-006).'], ['Kickoff suggested, 0.88']) },
    { id: 'W01', k: 'p', icon: 'book', label: 'Filed', title: 'Komite K3 Mingguan Site B – W01', sub: '→ Site B · HSE · filed', when: '07:35', pre: 1,
      quote: lib('Komite K3 (week 1 of 26)', 'Site B · HSE', 'HSE / safety', 'Rapat Komite K3 Mingguan Site B – Week 1', 'same chair, 5 of 5 attendees, title match 0.97'), replies: [], ask: 'Filed.', btns: [['Accept', 'done', 'p']], reps: [{ tok: 'W01c', draft: 'Reply to this thread', text: 'Noted.' }],
      side: pnotes('Site B · HSE', ['Evacuation drill moved to Fridays 07:30 (W01, AI-007).', 'Toolbox topic sheets: Mei Lin sends weekly (AI-005).'], ['W01 suggested, 0.97', 'W01 accepted, filed']) },
  ];
  const T02 = shell({ key: 'T02', crumb: 'Projects · Librarian', sel: 'W02', librarian: 1, openWord: 'To confirm', doneWord: 'Filed', arcWord: 'Dismissed', askLabel: 'Needs you', finNote: 'Undo and Move stay available.', archiveLabel: 'Done', arcNote: 'The librarian will not suggest it again for this meeting.',
    secs: ['To confirm', 'Filed', 'Dismissed'], zero: ['Nothing to confirm', 'Every meeting is filed. New suggestions appear after End & draft.'],
    states: { error: 'The librarian could not read the register. Meetings stay unfiled; nothing is lost.', locked: 'Locked: this series was issued. Filing changes wait for an amendment.', needs: '3 meetings wait for a project.' },
    rail: [['inbox', 'Inbox'], ['list', 'Meetings'], ['book', 'Projects', 1, 3], ['grid', 'Series'], ['bolt', 'Add-ins']], rightIcon: 'book', rightTitle: 'Project notes', rightNote: 'kept by the librarian', rightEmpty: 'Pick a meeting to see its project notes and the librarian’s look history.', items: t2items });

  /* ================= T04 ================= */
  const flc = (ic0, t, rows) => `<div class="blk"><div class="sl">${ic(ic0, 13)} ${t}</div>${rows.map((r) => `<div class="li"><span class="ell">${esc(r[0])}</span><span class="dim small">${esc(r[1])}</span></div>`).join('')}</div>`;
  const hl = (counts, need, last, ids, fl = true) => `<div class="blk"><div class="sl">Counts</div><div class="cnt">${counts.map(([k, l, n]) => `<div><i style="background:var(--t-${typeVar[k]})"></i><b class="mono">${n}</b><span class="dim small">${l}</span></div>`).join('')}</div></div>
    <div class="blk"><div class="sl">${ic('flag', 13)} Needs you</div>${need.map(([id, t]) => `<div class="tkr k-${id}"><button type="button" class="tk k-${id}" data-act="tick:${id}" aria-label="Resolve ${esc(t)}">${ic('check', 12)}</button><span class="tkt">${esc(t)}</span></div>`).join('')}</div>
    <div class="blk"><div class="sl">Last items</div>${last.map(([k, r, t]) => `<div class="li">${tile('flag', k, 12)}<span class="mono dim">${r}</span><span class="ell">${esc(t)}</span></div>`).join('')}</div>
    <div class="blk"><div class="sl">Where this came from</div><p class="dim small prv">${ids}</p></div>${fl ? flc('notes', 'Files', [['site-b-hse-plan.pdf', 'Mei, 07:02'], ['nearmiss-log.xlsx', 'James, 06:44']]) + flc('export', 'Links', [['client-hse portal / drill notice', '03:20']]) + flc('list', 'Changes', [['AI-007 due moved to Fri', '04:12'], ['AI-002 risk raised to 60%', '08:30']]) : ''}`;
  const tl = (rows) => `<div class="qt tr2">${rows.map(([t, w, x, tag]) => `<p><span class="mono dim">${t}</span> <b>${w}</b> ${esc(x)}${tag ? ` <span class="ty" style="--c:var(--t-${typeVar[tag[0]]})">${tag[1]}</span>` : ''}</p>`).join('')}</div>`;
  const t4items = [
    { id: 'M-K3', k: 'd', icon: 'live', label: 'Live', title: 'Rapat Komite K3 · W01', sub: 'Live 12:04 · 20 items', when: 'now', un: 1,
      quote: tl([['04:12', 'James', 'Drill evakuasi dipindah ke Jumat 07:30; semua kontraktor ikut.', ['d', 'Decision']], ['06:40', 'James', 'Lars mengirim incident investigation report ke Client HSE hari Rabu.', ['a', 'Action']], ['01:03', 'Mei', 'Apakah sudah ada konfirmasi dari Client HSE soal near-miss log?', ['q', 'Question']]]), replies: [], ask: '3 items wait on you in this meeting.',
      btns: [['Issue MoM', 'done', 'p'], ['Review 3', 'MK3r'], ['Close without MoM', 'arc']], reps: [{ tok: 'MK3r', draft: 'Flag the last line as an action for Mei Lin.', text: 'Flagged 07:12 “Mei: toolbox topic sheet” as action AI-005 (draft, 60%).' }],
      ticks: ['tkA', 'tkB', 'tkC'], side: hl([['d', 'Decisions', 2], ['a', 'Actions', 3], ['q', 'Questions', 10], ['r', 'Risks', 5]], [['tkA', 'Accept AI-007 drill moved to Friday'], ['tkB', 'Assign owner to AI-001 near-miss log'], ['tkC', 'Check AI-002 heat stress risk (60%)']], [['d', 'AI-007', 'Drill evakuasi dipindah ke Jumat 07:30'], ['a', 'AI-009', 'Lars: report to Client HSE (Wed)'], ['a', 'AI-005', 'Mei: toolbox topic sheet (Fri)'], ['q', 'AI-003', 'Toolbox sheet confirmation'], ['q', 'AI-001', 'Near-miss log confirmation']], '20 of 20 items have a source · 53 segments · drafted on this device') },
    { id: 'M-TIE', k: 'a', icon: 'notes', label: 'Yesterday', title: 'Platform tie-in · P03', sub: 'Mon · 14 items', when: 'Mon', un: 1,
      quote: tl([['02:10', 'Aji', 'Tie-in window agreed for week 12.', ['d', 'Decision']], ['09:40', 'Dewi', 'Weld procedure approval is still pending.', ['r', 'Risk']]]), replies: [], ask: '2 items wait on you in this meeting.',
      btns: [['Issue MoM', 'done', 'p'], ['Review 2', 'MTr'], ['Close without MoM', 'arc']], reps: [{ tok: 'MTr', draft: 'Assign weld approval to Dewi.', text: 'Owner set: Dewi, due Fri 27 Feb.' }],
      ticks: ['tkD', 'tkE'], side: hl([['d', 'Decisions', 4], ['a', 'Actions', 5], ['q', 'Questions', 3], ['r', 'Risks', 2]], [['tkD', 'Accept the tie-in window decision'], ['tkE', 'Assign owner to weld approval risk']], [['d', 'AI-004', 'Tie-in window week 12'], ['r', 'AI-006', 'Weld procedure approval pending']], '14 of 14 items have a source · 41 segments') },
    { id: 'M-TBX', k: 'm', icon: 'notes', label: 'Issued', title: 'Toolbox briefing · Site B', sub: 'Issued · 9 items', when: 'Mon', pre: 1,
      quote: tl([['00:50', 'Mei', 'Heat stress briefing given to 18 workers.', ['m', 'Metric']]]), replies: [], ask: 'Issued.', btns: [['Issue MoM', 'done', 'p']], reps: [{ tok: 'MTBc', draft: 'Reply to this thread', text: 'Noted.' }],
      ticks: [], side: hl([['d', 'Decisions', 1], ['a', 'Actions', 2], ['q', 'Questions', 0], ['r', 'Risks', 1]], [], [['m', 'AI-011', 'Heat stress briefing, 18 workers']], '9 of 9 items have a source · MoM issued 07:35') },
  ];
  const T04 = shell({ key: 'T04', crumb: 'Highlights', sel: 'M-K3', openWord: 'Open', doneWord: 'Issued', arcWord: 'Closed', askLabel: 'Needs you', finNote: 'The MoM is frozen. Amend reopens it.', archiveLabel: 'Archive', arcNote: 'Closed without a MoM; the register keeps every item.',
    secs: ['Meetings', 'Issued', 'Closed'], zero: ['Nothing open', 'No open meeting. Start captions to open the next one.'],
    states: { error: 'Could not read the register. Highlights show nothing until it loads.', locked: 'Locked: the MoM is issued. Counts and items are frozen.', needs: '5 items wait on you across 2 meetings.' },
    rail: [['inbox', 'Inbox'], ['list', 'Meetings', 1, 2], ['book', 'Projects'], ['grid', 'Series'], ['bolt', 'Add-ins']], rightIcon: 'flag', rightTitle: 'Highlights', rightNote: 'this meeting', rightEmpty: 'Nothing here yet. Counts, items and sources from the open meeting show up here as it runs.', items: t4items });

  /* ================= T05 ================= */
  const manifest = (name, lines, chipsList) => `<div class="qt mf"><span class="qh">${ic('bolt', 12)}<b>${name}</b><span class="grow"></span><span class="mono dim">manifest v0</span></span>${lines.map(([k, v]) => `<p><span class="mono dim">${k}</span> ${v}</p>`).join('')}</div><div class="chp">${chipsList.map(([i, l, b]) => `<span class="chb">${ic(i, 14)}${l}${b ? `<i class="mono">${b}</i>` : ''}</span>`).join('')}</div>`;
  const scope = (rows, log) => `<div class="blk"><div class="sl">May call</div>${rows.map(([ok, t]) => `<div class="li">${ic(ok ? 'check' : 'stop', 13)}<span>${t}</span></div>`).join('')}</div><div class="blk"><div class="sl">Last runs</div>${hist(log)}</div>`;
  const t5items = [
    { id: 'flag', k: 'a', icon: 'bolt', label: 'Action chip', title: 'Flag decision', sub: 'action · appliesTo HSE / safety', when: 'v1', pre: 1,
      quote: manifest('Flag decision', [['appliesTo', 'projectType HSE / safety'], ['actions', 'Flag decision → engine /notes (addItem)'], ['badge', 'count of unflagged lines']], [['flag', 'Flag decision', 3]]), replies: [], ask: 'Trusted.', btns: [['Trust', 'done', 'p']], reps: [{ tok: 'FLc', draft: 'Reply to this thread', text: 'Noted.' }],
      side: scope([[1, 'Engine route /notes (add item)'], [0, 'Shell commands'], [0, 'Network, except open https://']], ['07:12 flagged AI-007', '07:03 flagged AI-005']) },
    { id: 'panel', k: 'd', icon: 'grid', label: 'Panel', title: 'Actions panel', sub: 'panel · renders the inbox', when: 'v1', un: 1,
      quote: manifest('Actions panel', [['appliesTo', 'always'], ['panels', 'page “actions”, items from seriesSummary'], ['when', 'open actions &gt; 0']], [['grid', 'Actions', 4]]), replies: [], ask: 'Trust this add-in to read open actions from the register?',
      btns: [['Trust and enable', 'done', 'p'], ['Review manifest', 'PNr'], ['Remove', 'arc']], reps: [{ tok: 'PNr', draft: 'Show the full manifest before trusting.', text: 'Manifest shown: 1 panel, 0 hooks, 1 engine route (seriesSummary). Nothing has run.' }],
      side: scope([[1, 'Engine route seriesSummary (read)'], [0, 'Shell commands'], [0, 'Network, except open https://']], ['Never run: not trusted yet']) },
    { id: 'export', k: 'r', icon: 'export', label: 'Changed', title: 'Risk register export', sub: 'changed since you trusted it', when: 'v2', un: 1,
      quote: manifest('Risk register export', [['appliesTo', 'seriesId komite-k3'], ['hooks', 'on meeting.end → engine /notes/export'], ['open', 'https://client-hse.example/upload']], [['export', 'Export risks', '']]), replies: [], ask: 'The file changed after you trusted it. It is disabled until you review it.',
      btns: [['Trust the change', 'done', 'p'], ['Review diff', 'EXr'], ['Remove', 'arc']], reps: [{ tok: 'EXr', draft: 'Show what changed since v1.', text: 'Diff: + hook meeting.end, + open https://client-hse.example/upload. Nothing has run since the change.' }],
      side: scope([[1, 'Engine route /notes/export'], [0, 'Shell commands'], [1, 'open https:// only (1 address)']], ['Disabled at 07:05: file hash changed']) },
    { id: 'gloss', k: 'x', icon: 'info', label: 'Broken', title: 'Glossary sync', sub: 'manifest error · never run', when: 'v1', un: 1,
      quote: manifest('Glossary sync', [['appliesTo', '<span class="lowc">missing field “always | projectType | series”</span>'], ['hooks', 'on line → run “sync.sh”']], [['book', 'Sync', '']]), replies: [], ask: 'This manifest asks for a shell command, which add-ins cannot run. It is listed but never executed.',
      btns: [['Open error', 'GLr', 'p'], ['Remove', 'arc']], reps: [{ tok: 'GLr', draft: 'Show the validation error.', text: 'Error: hooks.run must name an engine route, not a file. Fix the manifest and reload.' }],
      side: scope([[0, 'Shell commands (asked, refused)'], [0, 'Network']], ['Never run: manifest invalid']) },
  ];
  const T05 = shell({ key: 'T05', crumb: 'Add-ins', sel: 'panel', openWord: 'Needs trust', doneWord: 'Enabled', arcWord: 'Removed', askLabel: 'Trust gate', finNote: 'Disable or remove it any time.', archiveLabel: 'Done', arcNote: 'It never runs; removing deletes its files.',
    secs: ['Needs trust', 'Enabled', 'Removed'], zero: ['All add-ins reviewed', 'Nothing waits on trust. Add a folder to install another.'],
    states: { error: 'Could not list add-in folders. Nothing was run.', locked: 'Locked: add-ins are off while a meeting is being issued.', needs: '3 add-ins wait for trust and have not run.' },
    rail: [['inbox', 'Inbox'], ['list', 'Meetings'], ['book', 'Projects'], ['grid', 'Series'], ['bolt', 'Add-ins', 1, 3]], rightIcon: 'cpu', rightTitle: 'Scope', rightNote: 'what it may do', rightEmpty: 'Pick an add-in to see exactly what it may call, and its last runs.', items: t5items });

  /* ---------- window CSS (paper tokens, yravg parts) ---------- */
  const css = `
.tb .tbbody{display:flex;flex:1;min-height:0}.tb .rail{width:56px;flex:none;border-right:1px solid var(--grid);background:var(--bg-deep);display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0}
.tb .rail a{position:relative;width:38px;height:38px;border-radius:var(--radius-md);display:grid;place-items:center;color:var(--text2);text-decoration:none}.tb .rail a.on{background:var(--accent-dim);color:var(--text)}
.tb .bdg{position:absolute;top:2px;right:0;min-width:17px;height:17px;border-radius:9px;background:var(--accent);color:var(--white);font:600 10px/17px var(--mono);text-align:center;padding:0 4px}
.tb .tbwrap{width:340px;flex:none;border-radius:0;outline-offset:-2px;display:flex}
.tb .tbl{width:100%;overflow:hidden;border-right:1px solid var(--grid);background:var(--bg);display:flex;flex-direction:column;padding:10px 8px;gap:2px;font-size:var(--text-md)}
.tb .srch{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border-radius:var(--radius-md);background:var(--wash);color:var(--muted);margin-bottom:6px}.tb .srch .ic-r{margin-left:auto;display:flex}
.tb .flt{display:flex;gap:4px;padding:0 2px 6px;flex-wrap:wrap}.tb .chip{border:0;border-radius:var(--radius-full);padding:3px 10px;background:var(--wash);color:var(--text2);font-size:var(--text-xs);font-weight:var(--font-medium)}.tb .chip[aria-pressed="true"]{background:var(--accent);color:var(--white)}
.tb .lbr{display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;border-radius:var(--radius-md);background:var(--card2);font-size:var(--text-xs)}.tb .lbr .btn{margin-left:auto;height:24px}.tb .lbr .pz1,.tb[data-pz="1"] .lbr .pz0{display:none}.tb[data-pz="1"] .lbr .pz1{display:inline}
.tb .sh{display:flex;align-items:center;gap:7px;padding:10px 8px 4px;font-size:var(--text-sm);font-weight:var(--font-semibold);color:var(--muted)}.tb .sh .mono{font-weight:var(--font-medium)}
.tb .sh.ar{cursor:pointer}.tb .lnk{border:0;background:none;color:var(--accent);font-size:var(--text-xs);font-weight:var(--font-semibold);text-decoration:underline;padding:0}
.tb .tr{display:flex;align-items:center;gap:9px;padding:8px 8px 8px 4px;border-radius:var(--radius-md);cursor:pointer}.tb .tr:hover{background:var(--wash)}
.tb .tr.fin,.tb .tr.ar{display:none}.tb .tr.fin .tt b,.tb .tr.ar .tt b{font-weight:var(--font-normal);color:var(--text2)}.tb .tr.ar{opacity:.7}
.tb .tr .tt{display:flex;flex-direction:column;min-width:0;flex:1}.tb .tr .tt b{font-weight:var(--font-semibold)}.tb .tr .tt .dim{font-size:var(--text-xs)}
.tb .un{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}.tb .un.off{background:transparent}
.tb .tl{width:30px;height:30px;border-radius:var(--radius-md);display:grid;place-items:center;flex:none;font-style:normal;color:var(--c);background:color-mix(in srgb,var(--c) 12%,var(--white))}.tb .tl.ok{--c:var(--ok)}
.tb .sh.fin,.tb .sh.ar{display:flex}.tb[data-nf="0"] .sh.fin,.tb[data-na="0"] .sh.ar{display:none}
.tb .zl{display:none;flex-direction:column;align-items:center;gap:4px;padding:22px 12px;text-align:center}.tb .zl .ic{color:var(--ok)}.tb[data-zero="1"] .zl,.tb[data-st="empty"] .zl{display:flex}
.tb .sbn{display:none;align-items:center;gap:8px;padding:8px 10px;margin:4px 0;border-radius:var(--radius-md);font-size:var(--text-xs);line-height:1.35}
.tb .sbn.er{background:var(--danger-wash);color:var(--danger)}.tb .sbn.lk{background:var(--card3);color:var(--text2)}.tb .sbn.nd{background:var(--warn-bg);color:var(--warn-text)}
.tb[data-st="error"] .sbn.er,.tb[data-st="locked"] .sbn.lk,.tb[data-st="needs"] .sbn.nd{display:flex}.tb .sbn .btn{height:24px;margin-left:auto}
.tb[data-st="error"] .tr{opacity:.45;pointer-events:none}.tb[data-st="empty"] .tr,.tb[data-st="empty"] .sh.fin,.tb[data-st="empty"] .sh.ar,.tb[data-st="empty"] .th,.tb[data-st="empty"] .dt{display:none!important}
.tb .tbm{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg);position:relative;overflow:hidden}
.tb .sbm{display:none;padding:9px var(--space-5);font-size:var(--text-sm);font-weight:var(--font-medium)}.tb .sbm.er{background:var(--danger-wash);color:var(--danger)}.tb .sbm.lk{background:var(--card3);color:var(--text2)}.tb .sbm.nd{background:var(--warn-bg);color:var(--warn-text)}
.tb[data-st="error"] .sbm.er,.tb[data-st="locked"] .sbm.lk,.tb[data-st="needs"] .sbm.nd{display:block}
.tb .th,.tb .dt{display:none;flex-direction:column}.tb .th{flex:1;min-height:0;padding:0 var(--space-5) var(--space-4)}.tb .th0{display:none;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center}
.tb[data-sel=""] .th0,.tb[data-st="empty"] .th0{display:flex}.tb .zi{width:54px;height:54px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center}.tb .th0 h3{margin:0;font-size:var(--text-xl)}.tb .th0 p{margin:0}
.tb .mh2{display:flex;align-items:center;gap:10px;height:56px;border-bottom:.5px solid var(--grid);margin:0 calc(var(--space-5) * -1);padding:0 var(--space-5);flex:none}.tb .mh2 h3{margin:0;font-size:var(--text-lg);max-width:560px}
.tb .stv{font-size:var(--text-sm);color:var(--muted)}.tb :is(.stv,.stv2)>*{display:none;align-items:center;gap:6px;font-weight:var(--font-medium)}.tb :is(.stv,.stv2) .o{display:inline-flex}
.tb .msgs{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:12px;padding:var(--space-4) 0}
.tb .qt{border-radius:var(--radius-lg);box-shadow:var(--ring);background:var(--card);padding:var(--space-3) var(--space-4);max-width:700px}.tb .qt p{margin:6px 0 0;font-size:var(--text-lg);line-height:1.45}
.tb .qh{display:flex;align-items:center;gap:8px;font-size:var(--text-xs);color:var(--muted)}.tb .lowc{color:var(--warn-text);font-weight:var(--font-semibold)}
.tb .aiN{display:flex;align-items:center;gap:7px;font-size:var(--text-xs);color:var(--ai);max-width:700px}
.tb .bb{max-width:560px;padding:8px 12px;border-radius:var(--radius-lg);background:var(--card2)}.tb .bb.me{align-self:flex-end;background:var(--accent);color:var(--white)}.tb .bb .who{display:flex;align-items:center;gap:6px;font-size:var(--text-xs)}.tb .bb p{margin:3px 0 0}
.tb .rp{display:none;align-self:flex-end}.tb .av{width:20px;height:20px;border-radius:50%;background:var(--accent);color:var(--white);font-style:normal;font-size:var(--text-xs);display:inline-grid;place-items:center;margin-right:6px}
.tb .ny,.tb .fn,.tb .an{flex:none;max-width:700px;border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4)}
.tb .ny{display:flex;flex-direction:column;gap:6px;background:var(--card);box-shadow:var(--ring),inset 3px 0 0 var(--warn-edge)}.tb .ny p{margin:0;font-size:var(--text-md)}.tb .nyh{display:flex;gap:7px;align-items:center;color:var(--warn-text)}.tb .nyb{display:flex;gap:8px;margin-top:4px}
.tb .fn,.tb .an{display:none;align-items:center;gap:8px;background:var(--ok-bg);color:var(--text)}.tb .an{background:var(--card3)}.tb .fn .ic{color:var(--ok)}
.tb .cmp{flex:none;display:flex;align-items:center;gap:10px;margin-top:10px;max-width:700px;padding:8px 8px 8px 14px;border-radius:var(--radius-lg);box-shadow:var(--ring);background:var(--card);font-size:var(--text-md)}
.tb[data-st="needs"] .ny{box-shadow:0 0 0 2px var(--warn-edge)}.tb[data-st="locked"] :is(.ny,.fn,.an,.cmp,.tkr,.tr) .btn,.tb[data-st="locked"] .tk{pointer-events:none;opacity:.45}.tb[data-st="locked"] .cmp{opacity:.55}
.tb .toast{display:none;position:absolute;left:50%;top:160px;transform:translateX(-50%);align-items:center;gap:14px;padding:8px 14px;border-radius:var(--radius-full);background:var(--accent);color:var(--white);font-size:var(--text-sm);box-shadow:var(--float);z-index:4}.tb[data-toast="1"] .toast{display:flex}.tb .toast .lnk{color:var(--gold)}
.tb .tbr{width:360px;flex:none;border-left:1px solid var(--grid);background:var(--bg);display:flex;flex-direction:column;overflow:hidden}.tb .rh2{display:flex;align-items:center;gap:8px;height:56px;padding:0 var(--space-4);border-bottom:.5px solid var(--grid);flex:none}
.tb .dt0{padding:var(--space-5);line-height:1.5}.tb[data-sel=""] .dt0,.tb[data-st="empty"] .dt0{display:block}.tb:not([data-sel=""]) .dt0{display:none}.tb[data-st="empty"] .dt0{display:block!important}
.tb .dt{padding:var(--space-3) var(--space-4);gap:2px;overflow:hidden}.tb .blk{padding:10px 0;border-bottom:.5px solid var(--grid)}.tb .sl{display:flex;align-items:center;gap:6px;font-size:var(--text-xs);font-weight:var(--font-semibold);color:var(--muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px}
.tb .kv2{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;font-size:var(--text-md)}.tb .kv2 .dim{font-size:var(--text-sm)}
.tb .rcs{display:flex;gap:6px;flex-wrap:wrap}.tb .rc{padding:2px 8px;border-radius:6px;background:var(--wash);font-size:var(--text-xs)}.tb .hs{margin:0;padding-left:16px;font-size:var(--text-sm);line-height:1.6;color:var(--text2)}
.tb .sug{border-radius:var(--radius-lg);box-shadow:var(--ring);background:var(--card);padding:var(--space-3) var(--space-4);max-width:700px}.tb .sugh{display:flex;align-items:center;gap:8px;margin-bottom:4px}.tb .why{margin-top:6px;padding:7px 10px;border-radius:var(--radius-md);background:var(--accent-dim);font-size:var(--text-sm)}
.tb .pn2{margin:0;padding-left:16px;line-height:1.55;font-size:var(--text-sm)}.tb .cnt{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.tb .cnt div{display:flex;flex-direction:column;gap:2px;padding:7px 8px;border-radius:var(--radius-md);background:var(--card2)}.tb .cnt i{width:16px;height:4px;border-radius:2px}.tb .cnt b{font-size:var(--text-xl)}
.tb .tkr{display:flex;align-items:center;gap:9px;padding:4px 0;font-size:var(--text-sm)}.tb .tk{width:20px;height:20px;border-radius:6px;border:0;box-shadow:inset 0 0 0 1.5px var(--border);background:var(--card);color:transparent;display:grid;place-items:center;flex:none;padding:0}
.tb .li{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:var(--text-sm)}.tb .li .tl{width:20px;height:20px;border-radius:6px}.tb .prv{margin:0;line-height:1.5}
.tb .tr2 p{font-size:var(--text-md);margin:5px 0}.tb .tr2 .ty{margin-left:6px}.tb .mf p{font-family:var(--mono);font-size:var(--text-sm);margin:4px 0}.tb .chp{display:flex;gap:8px;max-width:700px}
.tb .chb{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:var(--radius-md);box-shadow:var(--ring);background:var(--card);font-size:var(--text-sm);font-weight:var(--font-medium)}.tb .chb i{font-style:normal;background:var(--accent);color:var(--white);border-radius:9px;padding:0 6px;font-size:var(--text-xs)}
.vw.vs{display:inline-flex;padding:2px;border-radius:8px;background:var(--side-2);gap:2px;margin-left:16px}.vw.vs button{height:28px;padding:0 14px;border:0;border-radius:6px;background:transparent;font:500 12.5px var(--sans);color:var(--muted-c)}.vw.vs button[aria-pressed="true"]{background:var(--win);color:var(--ink);box-shadow:0 1px 2px var(--sh-a)}`;
  const allCss = css + [T01, T02, T04, T05].map((b) => b.css).join('\n');

  const switcher = (k) => `<div class="vw vs" role="group" aria-label="State">${STATES.map((m) => `<button type="button" aria-pressed="${m === 'normal'}" data-tb-for="${k}" data-act="st:${m}" data-pr="${m}">${STATE_LABEL[m]}</button>`).join('')}</div>`;
  const boards = { T01, T02, T04, T05 };
  return { boards, css: allCss, switcher, cfgs: Object.fromEntries(Object.entries(boards).map(([k, b]) => [k, { C: b.C, init: b.init }])) };
}

/* Static page: same reducer, event delegation. */
export const tbStaticScript = (cfgs) => `<script>${TB_CORE}
(function(){var CF=${JSON.stringify(cfgs)};var ST={};
function paint(root,k){var v=tbVals(ST[k],CF[k].C);['sel','st','done','arc','rep','flt','fa','pz','nf','na','zero','toast'].forEach(function(a){root.setAttribute('data-'+a,v[a])});
root.querySelectorAll('[data-bind]').forEach(function(e){e.textContent=v[e.getAttribute('data-bind')]});
document.querySelectorAll('[data-tb-for="'+k+'"]').forEach(function(b){b.setAttribute('aria-pressed',String(v['pr_'+b.getAttribute('data-pr')]))});
root.querySelectorAll('[data-pf]').forEach(function(b){b.setAttribute('aria-pressed',String(v['pf_'+b.getAttribute('data-pf')]))})}
document.querySelectorAll('.tb').forEach(function(r){var k=r.getAttribute('data-tb');ST[k]=Object.assign({},CF[k].init);paint(r,k)});
document.addEventListener('click',function(e){var t=e.target.closest('[data-act]');if(!t)return;var r=t.closest('.tb')||document.querySelector('#'+(t.getAttribute('data-tb-for')||'')+' .tb');if(!r)return;var k=r.getAttribute('data-tb');
if(ST[k].st==='locked'&&t.closest('.ny,.fn,.an,.cmp,.tkr'))return;
ST[k]=tbAct(ST[k],t.getAttribute('data-act'),CF[k].C);paint(r,k)})})();
</script>`;

/* Design canvas export: markup -> bound attributes, plus the Component class. */
export function tbDc(body, id, cfgs) {
  const c = cfgs[id];
  if (!c) return null;
  const acts = [...new Set([...body.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]))];
  const fn = (a) => 'a_' + a.replace(/[^A-Za-z0-9]/g, '_');
  const out = body.replace(/(<div class="app mn tb"[^>]*>)/, (tag) => TB_ROOT_KEYS.reduce((t, k) => t.replace(new RegExp(`data-${k}="[^"]*"`), `data-${k}="{{${k}}}"`), tag))
    .replace(/<b class="mono" data-bind="(\w+)">[^<]*<\/b>/g, '<b class="mono">{{$1}}</b>')
    .replace(/<b data-bind="(\w+)"><\/b>/g, '<b>{{$1}}</b>').replace(/<span data-bind="(\w+)"><\/span>/g, '<span>{{$1}}</span>')
    .replace(/<span class="bdg" data-bind="(\w+)">[^<]*<\/span>/g, '<span class="bdg">{{$1}}</span>')
    .replace(/aria-pressed="(?:true|false)" data-tb-for="(\w+)" data-act="st:(\w+)"/g, 'aria-pressed="{{pr_$2}}" data-tb-for="$1" data-act="st:$2"')
    .replace(/aria-pressed="(?:true|false)" data-pf="(\w+)"/g, 'aria-pressed="{{pf_$1}}" data-pf="$1"')
    .replace(/data-act="([^"]+)"/g, (m, a) => `data-act="${a}" onClick="{{${fn(a)}}}"`);
  const logic = `${TB_CORE}
const CFG = ${JSON.stringify(c.C)};
class Component extends DCLogic {
state = ${JSON.stringify(c.init)};
renderVals() {
const o = tbVals(this.state, CFG);
${acts.map((a) => `o.${fn(a)} = () => this.setState(tbAct(this.state, ${JSON.stringify(a)}, CFG));`).join('\n')}
return o;
}
}`;
  return { body: out, logic };
}
