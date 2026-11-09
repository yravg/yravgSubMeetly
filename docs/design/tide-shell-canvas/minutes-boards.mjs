// A04a (minutes.html in Tide) and A04b (compact register summary). Sample data: the owner's sample-library series W36.
import { ic, MARK, NEW, PART } from './kit.mjs';

const SAMPLE = '<span class="sample">sample</span>';
const TIDE = (n) => `tide/tide-${n}.webp`;

/* Type palette: the hue lives in the 8 px dot (non-text, at least 3:1 on the tint); the word is always ink. */
const TYPES = [['a', 'Action', 4, 'var(--ty-a)'], ['m', 'Metric', 3, 'var(--ty-m)'], ['r', 'Risk', 2, 'var(--ty-r)'], ['n', 'Note', 2, 'var(--ty-n)'], ['d', 'Decision', 1, 'var(--ty-d)'], ['q', 'Open question', 1, 'var(--ty-q)']];
const tag = (k) => { const t = TYPES.find((x) => x[0] === k); return `<span class="mr-ty"><i style="background:${t[3]}"></i>${t[1]}</span>`; };

export const MIN_CSS = `
.tide{--note:#6F7F76;--ty-a:#0A0F0C;--ty-d:#0E9F6E;--ty-m:#2563EB;--ty-r:#C0362C;--ty-q:#7C3AED;--ty-n:#64748B}.tide.dk{--note:#8FA196;--ty-a:#E8F2EC;--ty-d:#34D399;--ty-m:#60A5FA;--ty-r:#F87171;--ty-q:#A78BFA;--ty-n:#94A3B8}
.tide.mr{flex-direction:column;width:100%}
.tide .mr-bar{display:flex;align-items:center;gap:8px;height:56px;padding:0 24px;border-bottom:1px solid var(--line);flex:none}
.tide .mr-bar .brand{height:40px;font-size:17px;margin-right:6px}.tide .mr-bar .brand img{width:28px;height:28px}
.tide .mr-bar .btn.sm,.tide .mr-bar .chip.sm{height:34px}
.tide .mr-bar .iconb{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:var(--muted);box-shadow:inset 0 0 0 1px var(--line)}
.tide .mr-head{padding:14px 24px 0;display:flex;flex-direction:column;gap:6px;flex:none}
.tide .mr-crumb{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500}.tide .mr-crumb b{color:var(--text);font-weight:700}.tide .mr-crumb .ic{color:var(--muted)}
.tide .mr-head h1{font:700 28px/1.15 var(--sans);letter-spacing:-.02em;display:flex;align-items:center;gap:12px}
.tide .mr-meta{display:flex;gap:6px 22px;flex-wrap:wrap;font-size:13.5px;color:var(--muted)}.tide .mr-meta b{color:var(--text);font-weight:600;margin-left:4px}.tide .mr-meta .mono{font-size:13px}
.tide .mr-prov{margin:10px 24px 0;display:flex;align-items:center;gap:12px;padding:9px 14px;border-radius:var(--r);background:var(--mint);font-size:13.5px;flex:none}
.tide .mr-prov .ic{color:var(--gi)}.tide .mr-prov b{font-weight:700}.tide .mr-prov .dv{color:var(--line);font-weight:300}
.tide .mr-prov .w{color:var(--warn);font-weight:700}
.tide .mr-body{display:flex;flex:1;min-height:0;margin-top:12px;border-top:1px solid var(--line)}
.tide .mr-nav{width:236px;flex:none;border-right:1px solid var(--line);padding:14px 12px;display:flex;flex-direction:column;gap:2px;background:var(--surface-2)}
.tide .mr-nav .nh{display:flex;align-items:center;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;padding:2px 8px 10px}
.tide .mr-nav .sec{padding:12px 8px 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.tide .mr-nav a{display:flex;align-items:center;height:36px;padding:0 10px;border-radius:10px;font-size:14.5px;font-weight:500;color:var(--ink2)}
.tide .mr-nav a.on{background:var(--mint);color:var(--text);font-weight:700;box-shadow:inset 3px 0 0 var(--green)}
.tide .mr-nav a i{width:8px;height:8px;border-radius:50%;margin-right:10px;flex:none}.tide .mr-nav a .n{margin-left:auto;font-size:12.5px;color:var(--muted);font-weight:600}
.tide .mr-main{flex:1;min-width:0;display:flex;flex-direction:column}
.tide .mr-tb{display:flex;align-items:center;gap:8px;padding:10px 20px;flex:none}
.tide .mr-reg{padding:0 20px;flex:none}
.tide .mr-th,.tide .mr-row{display:grid;grid-template-columns:82px 130px 80px minmax(0,1fr) 150px 96px 84px 150px;gap:0 12px;align-items:start;padding:0 6px}
.tide .mr-th{position:sticky;top:0;height:36px;align-items:center;font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--line);background:var(--surface);box-shadow:0 6px 10px -8px var(--sh-ask)}
.tide .mr-th .srt{color:var(--gi)}
.tide .mr-row{position:relative;padding-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line);font-size:14px;line-height:1.45}
.tide .mr-row.hv{background:var(--surface-2);box-shadow:inset 3px 0 0 var(--green)}
.tide .mr-row .ref{font:500 12.5px var(--mono);color:var(--muted);padding-top:2px;display:flex;gap:4px;align-items:center}
.tide .mr-ty{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;font-weight:600;color:var(--text);white-space:nowrap}.tide .mr-ty i{width:8px;height:8px;border-radius:50%}
.tide .mr-topic{display:inline-block;padding:2px 9px;border-radius:8px;background:var(--mint);font-size:12.5px;font-weight:600;color:var(--ink2)}
.tide .mr-it{display:flex;gap:8px}.tide .mr-it .a{font:600 11.5px var(--mono);color:var(--muted);padding-top:3px;flex:none}
.tide .mr-ow{display:flex;gap:10px;align-items:center}.tide .mr-ow .av{width:28px;height:28px;font-size:10.5px}.tide .mr-ow .av.b{background:var(--lime)}.tide .mr-ow .av.c{background:var(--mint);color:var(--gi);box-shadow:inset 0 0 0 1px var(--line)}
.tide .mr-ow .av.u{background:var(--surface);color:var(--muted);box-shadow:inset 0 0 0 1.5px var(--line);font-size:13px}
.tide .mr-ow b{display:block;font-size:14px;font-weight:600;line-height:1.25}.tide .mr-ow small{font-size:12.5px;color:var(--muted)}
.tide .mr-due b{display:block;font-weight:600}.tide .mr-due small{display:block;font-size:12.5px;font-weight:600;color:var(--danger)}
.tide .mr-st{display:flex;align-items:center;gap:7px;font-weight:600;font-size:14px}.tide .mr-st i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--muted)}.tide .mr-st.ok{color:var(--gi)}.tide .mr-st.ok i{background:var(--green);box-shadow:none}
.tide .mr-src{display:flex;flex-direction:column;gap:6px}.tide .mr-src .tc{display:flex;align-items:center;gap:8px;font:500 13px var(--mono);color:var(--text)}.tide .mr-src .pl{width:26px;height:26px;border-radius:50%;background:var(--mint);color:var(--gi);display:grid;place-items:center}
.tide .mr-src .tcb{display:flex;align-items:center;gap:8px}.tide .mr-src .pos{height:3px;width:44px;border-radius:99px;background:var(--line);overflow:hidden}.tide .mr-src .pos i{display:block;height:100%;background:var(--green)}
.tide .mr-sb{display:inline-block;font-size:12.5px;font-weight:600;padding:1px 9px;border-radius:999px;width:fit-content}.tide .mr-sb.ac{background:var(--mint);color:var(--gi)}.tide .mr-sb.ed{background:var(--surface-2);color:var(--ink2);box-shadow:inset 0 0 0 1px var(--line)}.tide .mr-sb.ai{background:var(--warn-bg);color:var(--warn)}
.tide .mr-act{position:absolute;left:94px;bottom:10px;display:flex;gap:6px;padding:4px;border-radius:999px;background:var(--surface);box-shadow:var(--shadow),inset 0 0 0 1px var(--line)}.tide .mr-act span{height:32px;padding:0 12px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;background:var(--surface-2)}.tide .mr-act span.p{background:var(--green);color:var(--on-brand)}
.tide .mr-tr{margin:12px 20px 0;border-radius:var(--r);box-shadow:inset 0 0 0 1px var(--line);display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}
.tide .mr-trh{display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);background:var(--surface-2)}.tide .mr-trh span.s{text-transform:none;letter-spacing:0;font-weight:500;font-size:13px}
.tide .mr-tl{display:grid;grid-template-columns:78px 130px minmax(0,1fr) 150px;gap:0 12px;align-items:center;padding:8px 16px;font-size:13.5px;border-bottom:1px solid var(--line)}
.tide .mr-tl .t{font:600 13px var(--mono);color:var(--gi)}.tide .mr-tl .r{text-align:right;font:500 12px var(--mono);color:var(--muted)}.tide .mr-tl .sp{font-weight:600}
.tide .mr-ft{display:flex;align-items:center;gap:14px;height:40px;padding:0 24px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);flex:none;background:var(--surface-2)}
.tide .mr-ft kbd{font:600 11.5px var(--mono);padding:1px 6px;border-radius:6px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);color:var(--text)}
/* summary band */
.tide .sb2{display:flex;align-items:center;flex-wrap:nowrap;gap:6px 14px;padding:0 14px;min-height:72px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}
.tide .sb2 .cnt{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.tide .sb2 .cnt b{font:600 40px/1 var(--disp)}.tide .sb2 .cnt span{font-size:14px;color:var(--muted);font-weight:600}
.tide .sb2.wr{flex-wrap:wrap;padding-top:8px;padding-bottom:8px}.tide .sb2 .dist{display:flex;flex-direction:column;gap:7px;width:fit-content;flex:none}.tide .sb2 .sg{display:flex;gap:2px;height:10px}.tide .sb2 .sg i{display:block;border-radius:99px}
.tide .sb2 .lg2{display:flex;gap:9px;font-size:12px;font-weight:600;white-space:nowrap}.tide .sb2 .lg2 span{display:inline-flex;align-items:center;gap:5px}.tide .sb2 .lg2 i{width:8px;height:8px;border-radius:50%}.tide .sb2 .lg2 em{font-style:normal;color:var(--muted);font-weight:600}
.tide .sb2 .ks{display:flex;gap:13px;flex:none}.tide .sb2 .k{display:flex;flex-direction:column;line-height:1.2;white-space:nowrap}.tide .sb2 .k small{font-size:12px;color:var(--muted);font-weight:500}.tide .sb2 .k b{font-size:18px;font-weight:700}.tide .sb2 .k b span{font-size:13px;color:var(--muted);font-weight:600}
.tide .sb2 .k .rd{color:var(--danger)}.tide .sb2 .k .am{color:var(--warn)}.tide .sb2 .k .gn{color:var(--gi)}
.tide .sb2 .btn.sm{height:36px;padding:0 12px;flex:none}.tide .sb2 .push{margin-left:auto}.tide .sb2 .btn.rv{background:var(--warn-bg);color:var(--warn);box-shadow:none;font-weight:700}
.tide .sb2 .xp{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 1px var(--line);background:var(--surface);color:var(--muted)}
.tide .sb2.emp .dist{width:420px}.tide .sb2.emp .sg i{background:var(--line);flex:1}
.tide .sx{margin-top:8px;display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.tide .sx div{padding:10px 14px;border-radius:12px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:13.5px;display:flex;flex-direction:column;gap:2px}.tide .sx div span{display:flex;align-items:center;gap:7px;font-weight:600}.tide .sx div i{width:8px;height:8px;border-radius:50%}.tide .sx div b{font-size:20px;font-weight:700}.tide .sx div b em{font-style:normal;font-size:13px;color:var(--muted);font-weight:600;margin-left:6px}
.tide .ghost{opacity:.55}
.tide .frame{margin:0 auto;border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--shadow),inset 0 0 0 1px var(--line);padding:18px 24px;display:flex;flex-direction:column;gap:12px}
.tide .frlab{font:700 12px var(--mono);color:var(--muted);text-align:center;margin-top:10px}
`;

/* ---------- summary band (shared by A04a and A04b) ---------- */
const bandKpis = `<div class="ks"><div class="k"><small>Actions open</small><b>4<span>/4</span></b></div><div class="k"><small>Overdue</small><b class="rd">7</b></div><div class="k"><small>Agenda covered</small><b>71%</b></div><div class="k"><small>Unreviewed</small><b class="am">4</b></div><div class="k"><small>Progress vs baseline</small><b class="gn">+1.11%</b></div></div>`;
export const band = ({ expanded = false, empty = false, wrap = false } = {}) => {
  if (empty) return `<div class="sb2 emp"><div class="cnt"><b>0</b><span>items</span></div><div class="dist" style="width:420px"><div class="sg">${TYPES.map(() => '<i></i>').join('')}</div><div class="lg2"><span class="mut">No items yet. Draft them from the transcript or add one by hand.</span></div></div><span class="push"></span><span class="btn sm">Draft options</span><span class="btn sm">${ic('plus', 16)}Add item</span></div>`;
  const seg = `<div class="sg">${TYPES.map((t) => `<i style="flex:${t[2]};background:${t[3]}" title="${t[1]} ${t[2]}"></i>`).join('')}</div>`;
  const lg = `<div class="lg2">${TYPES.map((t) => `<span><i style="background:${t[3]}"></i>${t[1]} <em>${t[2]}</em></span>`).join('')}</div>`;
  const pct = { a: '31%', m: '23%', r: '15%', n: '15%', d: '8%', q: '8%' };
  const ex = expanded ? `<div class="sx">${TYPES.map((t) => `<div><span><i style="background:${t[3]}"></i>${t[1]}</span><b>${t[2]}<em>${pct[t[0]]}</em></b></div>`).join('')}</div>` : '';
  return `<div><div class="sb2${wrap ? ' wr' : ''}"><div class="cnt"><b>13</b><span>items</span></div><div class="dist">${seg}${lg}</div>${bandKpis}<span class="push"></span><span class="btn sm rv">Review 1 low-confidence item</span><span class="xp" title="${expanded ? 'Collapse' : 'Expanded'}">${ic(expanded ? 'up' : 'down', 18)}</span></div>${ex}</div>`;
};

/* ---------- register rows (the owner's sample rows W36-001..005) ---------- */
const ROWS = [
  ['W36-001', 'a', 'marine', 'A6', 'Obtain written C900 availability window from the vessel owner.', ['NS', '', 'Nasmee Samang', 'GZS'], '08-29', '72d overdue', ['Open'], '00:44:02', 62, 'ac', 'Accepted', true],
  ['W36-002', 'a', 'docs', 'A3', 'Issue GMDR rev.3 to COMPANY with the revised submission priority list.', ['R', 'b', 'Riza', 'GZS'], '08-26', '75d overdue', ['Open'], '00:29:55', 40, 'ac', 'Accepted', true],
  ['W36-003', 'r', 'mob', 'A6', 'OSP approval slipping into the mobilisation window would delay sail-away; no float remains on the marine spread.', ['NS', '', 'Nasmee Samang', 'GZS'], '09-15', '55d overdue', ['Open'], '00:33:40', 46, 'ed', 'Edited', true],
  ['W36-004', 'n', 'hse', 'A1', 'Grating fell from the HLV main-boom walkway onto the jacket sea deck and struck a portable fire extinguisher; a second object later fell from the main crane into the sea. Personnel on the sea deck were evacuated to the barge, with no injuries.', ['', 'u', 'Unassigned', ''], '', '', ['Closed', 'ok'], '00:04:12', 8, 'ac', 'Accepted', false],
  ['W36-005', 'a', 'controls', 'A2', 'Issue a crane inspection checklist covering greasing, fast-line block inspection and a boom-walkway sweep for loose items.', ['LK', 'c', 'Lai Kong Teng', 'COMPANY'], '09-08', '62d overdue', ['Open'], '00:09:05', 12, 'ai', 'AI draft', true],
];
const row = (r, hv = false) => {
  const [ref, k, tp, a, tx, ow, due, od, st, tc, pos, sbc, sbt, carry] = r;
  const avatar = ow[1] === 'u' ? '<span class="av u">?</span>' : `<span class="av ${ow[1]}">${ow[0]}</span>`;
  const owner = `<div class="mr-ow">${avatar}<span><b>${ow[2]}</b>${ow[3] ? `<small>${ow[3]}</small>` : ''}</span></div>`;
  const dueC = due ? `<div class="mr-due"><b>${due}</b><small>${od}</small></div>` : '<span class="mut">–</span>';
  const act = hv ? `<div class="mr-act"><span class="p">${ic('check', 16)}Accept</span><span>Edit</span><span>${ic('user', 16)}Owner</span></div>` : '';
  return `<div class="mr-row${hv ? ' hv' : ''}"><span class="ref">${ref}${carry ? '<span title="Carried forward" style="color:var(--gi)">↺</span>' : ''}</span><span>${tag(k)}</span><span><span class="mr-topic">${tp}</span></span><span class="mr-it"><span class="a">${a}</span><span>${tx}</span></span>${owner}${dueC}<span class="mr-st ${st[1] || ''}"><i></i>${st[0]}</span><div class="mr-src"><span class="tc"><span class="pl">${ic('play', 12)}</span>${tc}</span><span class="tcb"><span class="mr-sb ${sbc}">${sbt}</span><span class="pos"><i style="width:${pos}%"></i></span></span></div>${act}</div>`;
};
export const rows = (n = 5, hv = 2) => ROWS.slice(0, n).map((r, i) => row(r, i === hv)).join('');
const head = `<div class="mr-th"><span class="srt">Ref ▲</span><span>Type</span><span>Topic</span><span>Item</span><span>Owner</span><span>Due</span><span>Status</span><span>Source</span></div>`;

const nav = (empty) => `<aside class="mr-nav"><div class="nh">Navigator<span class="grow"></span><span style="text-transform:none">⟨</span></div><div class="nh" style="padding-top:0;padding-bottom:4px">Views</div>
${['Register', 'By topic', 'Minutes', 'Carry-forward', 'Series', 'Inbox', 'Projects', 'Highlights'].map((t, i) => `<a class="${i === 0 ? 'on' : ''}">${t}</a>`).join('')}
<div class="nh" style="padding-top:16px;padding-bottom:4px">Item type</div>
${[['d', 'Decision', 1], ['a', 'Action', 4], ['q', 'Open question', 1], ['r', 'Risk', 2], ['m', 'Metric', 3], ['n', 'Note', 2]].map(([k, t, n]) => `<a><i style="background:${TYPES.find((x) => x[0] === k)[3]}"></i>${t}<span class="n">${empty ? 0 : n}</span></a>`).join('')}</aside>`;

const transcript = (empty) => empty ? `<div class="mr-tr" style="flex:none"><div class="mr-trh">Where this came from<span class="s">0 of 0 items have a source</span></div><div style="padding:16px 18px;color:var(--muted);font-size:13.5px">Sources appear here once items are drafted from the transcript.</div></div>` : `<div class="mr-tr"><div class="mr-trh">Where this came from<span class="s">11 of 13 items have a source</span><span class="grow"></span><span class="s">collapse</span></div>
${[['00:04:12', 'Nasmee Samang', 'A grating from the boom walkway fell onto the jacket deck and hit a portable extinguisher. Personnel were moved to the barge; another object then fell into the sea. No injuries.', 'W36-004 · ASR 94%'], ['00:09:05', 'Nasmee Samang', 'The incident review recommended establishing a crane inspection checklist, including greasing, fast-line block inspection, and checking the crane-boom walkway for loose items.', 'W36-005 · ASR 88%'], ['00:25:41', 'Riza', 'The SCI MWS draft had been shared with the company and was awaiting Mr. Huimin’s signature before submission.', 'W36-006 · ASR 85%'], ['00:29:55', 'Riza', 'GMDR rev.3 to be issued to COMPANY together with the revised submission priority list.', 'W36-002 · ASR 88%']].map(([t, s, x, r]) => `<div class="mr-tl"><span class="t">${t}</span><span class="sp">${s}</span><span>${x}</span><span class="r">${r}</span></div>`).join('')}</div>`;

const bar = () => `<div class="mr-bar"><div class="brand"><img src="${MARK}" alt=""><span class="wm">yravg<i>SubMeetly</i></span></div><span class="grow"></span><span class="chip sm ok">${ic('lock', 14)}On-device</span><span class="btn sm">Draft options</span><span class="btn sm">${ic('book', 16)}Library</span><span class="btn sm">Training<span class="chip sm ok" style="height:22px;padding:0 8px;font-size:12px">Lv 1 · 0 XP</span></span><span class="combo" style="height:34px;width:200px;font-size:13.5px;white-space:nowrap">2026-09-02 — W36${ic('down', 14)}</span><span class="btn sm">${ic('plus', 16)}Add item</span><span class="btn sm">${ic('export', 16)}Export</span><span class="pillb sm" style="height:34px">${ic('check', 16)}Issue MoM</span><span class="iconb" title="Settings">${ic('gear', 18)}</span></div>`;
const header = (empty) => `<div class="mr-head"><div class="mr-crumb">Minutes${ic('right', 12)}CPOC Phase 7${ic('right', 12)}GZS Weekly Progress Meeting${ic('right', 12)}<b class="mono">W36 · 02 Sep 2026</b></div>
<h1>CPOC Phase 7 — GZS Weekly Progress Meeting ${SAMPLE}<span class="grow"></span><span class="iconb" style="width:32px;height:32px;display:grid;place-items:center;color:var(--muted)">${ic('up', 18)}</span></h1>
<div class="mr-meta"><span>Date<b class="mono">2026-09-02</b></span><span>Time<b class="mono">10:00–12:00 GMT+8</b></span><span>Chair<b>Nasmee Samang</b></span><span>Present<b>7</b></span><span>MoM<b class="mono">MOM-CPOC7-W36</b></span><span>Series<b class="mono">meeting 2</b></span><span>Project type<b>Weekly progress</b></span></div></div>
<div class="mr-prov">${ic('lock', 16)}<b>Drafted on this Mac</b><span class="dv">|</span>${empty ? '<span>Nothing drafted yet</span>' : '<span>Whisper large-v3-turbo (MLX) → 214 segments → 13 register items</span><span class="dv">|</span><span class="w">4 need review</span><span class="dv">|</span><span>1 low-confidence flag</span>'}<span class="grow"></span><span class="mut">No audio, transcript or text left this device.</span></div>`;
const foot = (empty) => `<div class="mr-ft"><span>Showing ${empty ? '0 of 0' : '13 of 13'}</span><span style="color:var(--line)">|</span><span><kbd>j</kbd><kbd>k</kbd> move · <kbd>a</kbd> accept · <kbd>o</kbd> owner · <kbd>d</kbd> date · <kbd>/</kbd> search · <kbd>Esc</kbd> close</span><span class="grow"></span><span>Layout: default · remembered on this Mac</span><span style="color:var(--line)">|</span><span>Not saved yet · localStorage</span></div>`;

const toolbar = () => `<div class="mr-tb"><span class="chip sm warn">Needs review only</span><span class="sel" style="height:32px;font-size:13px">Group: none${ic('down', 14)}</span><span class="chip sm">${ic('user', 14)}Mine</span><span class="grow"></span>${NEW(`<span class="seg sm"><span>Review</span><span class="on">Reading</span><span>Compact</span></span>`)}</div>`;

export const detail = (state) => {
  const empty = state === 'empty';
  const reg = empty
    ? `<div class="mr-reg">${PART(`${head}<div class="empty" style="padding:36px 20px 28px"><img src="${TIDE('sleep')}" alt=""><h3>No items yet</h3><p>Nothing was drafted from this meeting. Draft from the transcript, or add the first item by hand.</p><div style="display:flex;gap:10px"><span class="btn">Draft options</span><span class="btn">${ic('plus', 16)}Add item</span></div></div>`)}</div>`
    : `<div class="mr-reg">${PART(`${head}${rows(5, 2)}`)}</div>`;
  const main = `<div class="mr-main">${empty ? '' : toolbar()}${empty ? '<div style="height:14px"></div>' : ''}${reg}${transcript(empty)}</div>`;
  return `<div class="tide mr" style="height:1260px">${bar()}${header(empty)}<div style="padding:12px 24px 0;flex:none">${band({ empty })}</div><div class="mr-body">${nav(empty)}${main}</div>${foot(empty)}</div>`;
};

/* ---------- A04b ---------- */
const ctx = (bandHtml, w, ghost = true) => `<div class="frame" style="width:${w}px"><div class="mr-crumb" style="padding:0">Minutes${ic('right', 12)}CPOC Phase 7${ic('right', 12)}<b class="mono">W36 · 02 Sep 2026</b></div><h1 style="font:700 24px/1.2 var(--sans);letter-spacing:-.02em">CPOC Phase 7 — GZS Weekly Progress Meeting</h1>${PART(NEW(bandHtml, 'margin-top:6px'))}<div class="ghost" style="margin-top:4px"><div class="mr-th" style="box-shadow:none;position:static"><span>Ref ▲</span><span>Type</span><span>Topic</span><span>Item</span><span>Owner</span><span>Due</span><span>Status</span><span>Source</span></div>${ghost ? rows(1, -1) : ''}</div></div>`;
export const summary = (state) => {
  const pad = (inner, h) => `<div class="tide" style="width:1440px;height:${h}px;background:var(--mint);padding:40px 0;display:block">${inner}</div>`;
  if (state === 'narrow') return pad(`${ctx(band({ wrap: true }), 1024, false)}<div class="frlab">1024 px wide: the band wraps to two lines (still under 120 px)</div>`, 352);
  if (state === 'empty') return pad(ctx(band({ empty: true }), 1392, false), 374);
  if (state === 'expanded') return pad(ctx(band({ expanded: true }), 1392), 452);
  return pad(ctx(band(), 1392), 374);
};
