// A04c (Open the Minutes window) and A04d (Minutes page, same layout, Tide colours). Sample data: the owner's sample-library series W36.
import { ic, MARK, NEW } from './kit.mjs';
import { shell, topbar } from './boards.mjs';
import { TYPES, nav, transcript, head, rows, foot } from './minutes-boards.mjs';

const SAMPLE = '<span class="sample">sample</span>';

export const WIN_CSS = `
.tide .seg-o{display:inline-flex;align-items:center;gap:2px;height:32px;padding:3px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-size:13px;font-weight:600}.tide .seg-o .lb{padding:0 8px 0 10px;color:var(--muted);font-weight:500}.tide .seg-o a{display:inline-flex;align-items:center;height:26px;padding:0 12px;border-radius:999px;color:var(--text);text-decoration:none}.tide .seg-o a:first-of-type{background:var(--pill-bg);color:var(--pill-fg)}
.tide .wf{margin:0 auto;border-radius:14px;overflow:hidden;background:var(--surface);box-shadow:0 24px 60px -24px var(--shadow-dlg),inset 0 0 0 1px var(--line)}
.tide .wf .wt{display:flex;align-items:center;gap:10px;height:36px;padding:0 14px;background:var(--surface-2);border-bottom:1px solid var(--line);font-size:13px;font-weight:700}
.tide .wf .wt .dots{display:flex;gap:6px}.tide .wf .wt .dots i{width:11px;height:11px;border-radius:50%;background:var(--line)}
.tide .wf .wt .u{font:500 12px var(--mono);color:var(--muted)}
.tide .wf.gh{box-shadow:none;border:2px dashed var(--line);background:transparent;display:grid;place-items:center;color:var(--muted);font-size:15px}
.tide .wlab{font:700 12px var(--mono);color:var(--muted);text-align:center;margin:10px 0 0}
/* A04d: the minutes.html layout at its own sizes (1280 x 700), colours from Tide tokens only */
.tide.fx{flex-direction:column;font-size:12px}
.tide.fx .mr-bar{height:36px;padding:0 12px;gap:4px;font-size:12px}.tide.fx .mr-bar .brand{height:28px;font-size:15px}.tide.fx .mr-bar .brand img{width:22px;height:22px}
.tide.fx .cr{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:11.5px;margin-left:4px;white-space:nowrap}.tide.fx .cr b{color:var(--text)}.tide.fx .cr .ic{color:var(--muted)}
.tide.fx .btn.sm,.tide.fx .pillb.sm{height:24px;padding:0 8px;font-size:11.5px;gap:4px}.tide.fx .chip.sm{height:22px;padding:0 8px;font-size:12px}.tide.fx .iconb{width:24px;height:24px}
.tide.fx .cb{height:24px;width:118px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 10px;font-size:12px;white-space:nowrap}
.tide.fx .hd{padding:8px 14px 0;flex:none}.tide.fx .hd h1{font:700 22px/1.15 var(--sans);letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.tide.fx .mt{display:flex;gap:4px 18px;font-size:11.5px;color:var(--muted);margin-top:5px}.tide.fx .mt b{color:var(--text);font-weight:600;margin-left:4px}.tide.fx .mt .mono{font-size:11.5px}
.tide.fx .mr-prov{margin:8px 14px 0;padding:4px 10px;font-size:11.5px;gap:10px}
.tide.fx .rv{align-self:center;background:var(--warn-bg);color:var(--warn);box-shadow:none;font-weight:700;height:26px}
.tide.fx .mr-body{margin-top:8px}.tide.fx .mr-nav{width:163px;padding:8px;gap:1px}.tide.fx .mr-nav .nh{font-size:10.5px;padding:2px 6px 6px}.tide.fx .mr-nav a{height:25px;font-size:12px;padding:0 8px;border-radius:8px}.tide.fx .mr-nav a i{margin-right:8px}.tide.fx .mr-nav a .n{font-size:11px}
.tide.fx .mr-reg{padding:0;height:264px;overflow:hidden}
.tide.fx .mr-th,.tide.fx .mr-row{grid-template-columns:52px 62px 52px minmax(0,1fr) 124px 80px 62px 92px;gap:0 10px;padding:0 10px}
.tide.fx .mr-th{height:22px;font-size:10.5px}.tide.fx .mr-row{padding-top:7px;padding-bottom:7px;font-size:12px;line-height:1.4}.tide.fx .mr-row .ref{font-size:11px}
.tide.fx .mr-ty{background:none;box-shadow:none;padding:0;height:auto;font-size:12px;gap:6px}.tide.fx .mr-ty i{width:3px;height:13px;border-radius:2px}
.tide.fx .mr-topic{font-size:11px;padding:1px 7px}.tide.fx .mr-it .a{font-size:10px}.tide.fx .mr-ow{gap:7px}.tide.fx .mr-ow .av{width:20px;height:20px;font-size:8.5px}.tide.fx .mr-ow b{font-size:12px}.tide.fx .mr-ow small,.tide.fx .mr-due small{font-size:11px}.tide.fx .mr-st{font-size:12px;gap:5px}.tide.fx .mr-st i{width:10px;height:10px}
.tide.fx .mr-src{gap:3px}.tide.fx .mr-src .tc{font-size:11px;gap:5px}.tide.fx .mr-src .pl{width:auto;height:auto;background:none;color:var(--muted)}.tide.fx .mr-src .pos{width:40px}
.tide.fx .mr-sb{background:none;box-shadow:none;padding:0;font-size:10px;letter-spacing:.04em;text-transform:uppercase}.tide.fx .mr-sb.ed{color:var(--muted)}
.tide.fx .mr-tr{margin:0;border-radius:0;box-shadow:none;border-top:1px solid var(--line)}.tide.fx .mr-trh{padding:5px 14px;font-size:10.5px}.tide.fx .mr-trh span.s{font-size:11px}
.tide.fx .mr-tl{grid-template-columns:62px 100px minmax(0,1fr) 96px;font-size:11.5px;padding:4px 14px;gap:0 10px}.tide.fx .mr-tl .t,.tide.fx .mr-tl .r{font-size:11px}
.tide.fx .mr-ft{height:25px;padding:0 14px;font-size:11px;gap:10px}.tide.fx .mr-ft kbd{font-size:10.5px;padding:0 4px}
`;

/* ---------- A04c ---------- */
const dotG = '<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green)"></i>';
export const openWindow = (state) => {
  const open = state === 'open';
  const btn = open ? `<span class="btn">${dotG}Minutes window is open · Focus</span>` : NEW('<span class="btn">Open Minutes window ↗</span>');
  const bar_ = `<div style="display:flex;align-items:center;gap:8px"><span class="combo" style="width:196px;font-size:13px;white-space:nowrap;flex:none">K3 Weekly · Mon 9 Nov 07:00<span>${ic('down', 16)}</span></span><span class="btn">Draft options</span><span class="btn">${ic('book', 16)}Library</span><span class="btn">${ic('sparkle', 16)}Training</span><span class="grow"></span><span class="btn">${ic('plus', 16)}Add item</span><span class="btn">${ic('export', 16)}Export</span><span class="btn">Apply correction</span><span class="pillb sm">Issue MoM</span></div><div style="display:flex;justify-content:flex-end">${btn}</div>`;
  const top = shell('minutes', `${topbar('Minutes')}${bar_}`, { h: 270 });
  const win = open
    ? `<div class="wf" style="width:1100px"><div class="wt"><span class="dots"><i></i><i></i><i></i></span>yravgSubMeetly — Minutes<span class="grow"></span><span class="u">127.0.0.1:8799/src/minutes.html</span></div><img src="shots/b-minutes-owner.png" alt="Owner capture of minutes.html, unchanged" style="width:100%;display:block"></div><div class="wlab">Its own window. The page is minutes.html exactly as it is today.</div>`
    : `<div class="wf gh" style="width:1100px;height:300px">Nothing is open yet. The button opens minutes.html in its own window.</div>`;
  return `<div class="tide" style="width:1440px;height:${open ? 990 : 590}px;background:var(--ground-2);padding:0 0 30px;display:block;position:relative">${top}<div style="height:28px"></div>${win}</div>`;
};


const MO_CSS = `
.tide.fx.mo{--mo-ln:#1a624d;--surface:#181818;--surface-2:#1f1f1f;--mint:#1e352e;--line:#3a3a3a;--text:#ececec;--muted:#9b9b9b;--gi:#14b789;--pill-bg:#14b789;--pill-fg:#fff;--danger:#e06c75;--warn:#e0b05c;--warn-bg:#292929;--ty-a:#e0b05c;--ty-m:#4fb8c9;--ty-r:#e06c75;--ty-n:#9a9a9a;--ty-d:#7fb3d5;--ty-q:#b79ce0}
.tide.fx.mo .brand img{display:none}.tide.fx.mo .brand .wm{color:var(--text)}.tide.fx.mo .brand .wm i{background:var(--gi);color:var(--white);border-radius:5px;padding:0 5px;font-style:normal}
.tide.fx.mo .mr-bar{gap:3px;padding:0 10px}.tide.fx.mo .mr-bar .cr{font-size:10.5px;margin-left:2px;gap:3px}.tide.fx.mo .mr-bar .btn.sm,.tide.fx.mo .mr-bar .pillb.sm{padding:0 6px;font-size:11px;gap:3px}.tide.fx.mo .mr-bar .cb{width:104px;padding:0 6px;font-size:11px}.tide.fx.mo .mr-bar .chip.sm{padding:0 6px;font-size:11px}
.tide.fx.mo .mr-th,.tide.fx.mo .mr-row{grid-template-columns:62px 62px 52px minmax(0,1fr) 124px 80px 62px 92px}
.tide.fx.mo .mr-nav a.on{box-shadow:inset 0 0 0 1px var(--mo-ln)}
.tide.fx .bw{margin:8px 14px 0;flex:none}.tide.fx .bw .sb2{min-height:0;height:72px;padding:0 12px;gap:6px 12px}
.tide.fx .sb2 .cnt b{font-size:34px}.tide.fx .sb2 .cnt span{font-size:11.5px}.tide.fx .sb2 .sg{height:8px}.tide.fx .sb2 .lg2{font-size:11px;gap:7px}.tide.fx .sb2 .lg2 em{font-size:11px}
.tide.fx .sb2 .ks{gap:10px}.tide.fx .sb2 .k small{font-size:10.5px}.tide.fx .sb2 .k b{font-size:15px}.tide.fx .sb2 .k b span{font-size:11.5px}
.tide.fx .sb2 .btn.sm{height:26px;font-size:11.5px;padding:0 10px}.tide.fx .sb2 .xp{width:26px;height:26px}
.tide.fx .sx{margin-top:6px;gap:6px}.tide.fx .sx div{padding:5px 10px;font-size:11.5px}.tide.fx .sx div b{font-size:15px}.tide.fx .sx div b em{font-size:11.5px}
.tide.fx .emp0{padding:30px 18px;color:var(--muted);font-size:13px}`;
export { MO_CSS };

/* ---------- A04d: minutes.html as it is today (dark, owner capture), only the summary block is compact ---------- */
const pct = { a: '31%', m: '23%', r: '15%', n: '15%', d: '8%', q: '8%' };
const ks = '<div class="ks"><div class="k"><small>Actions open</small><b>4<span>/4</span></b></div><div class="k"><small>Overdue</small><b class="rd">7</b></div><div class="k"><small>Agenda covered</small><b>71%</b></div><div class="k"><small>Unreviewed</small><b class="am">4</b></div><div class="k"><small>Progress vs baseline</small><b class="gn">+1.11%</b></div></div>';
const compact = (st) => {
  if (st === 'empty') return `<div class="sb2 emp"><div class="cnt"><b>0</b><span>items</span></div><div class="dist" style="width:380px"><div class="sg">${TYPES.map(() => '<i></i>').join('')}</div><div class="lg2"><span class="mut">No items yet</span></div></div></div>`;
  const seg = `<div class="sg">${TYPES.map((t) => `<i style="flex:${t[2]};background:${t[3]}"></i>`).join('')}</div>`;
  const lg = `<div class="lg2">${TYPES.map((t) => `<span><i style="background:${t[3]}"></i>${t[1]} <em>${t[2]}</em></span>`).join('')}</div>`;
  const open = st === 'expanded';
  const sx = open ? `<div class="sx">${TYPES.map((t) => `<div><span><i style="background:${t[3]}"></i>${t[1]}</span><b>${t[2]}<em>${pct[t[0]]}</em></b></div>`).join('')}</div>` : '';
  return `<div class="sb2"><div class="cnt"><b>13</b><span>items</span></div><div class="dist">${seg}${lg}</div>${ks}<span class="push"></span><span class="btn sm rv">Review 1 low-confidence item</span><span class="xp">${ic(open ? 'up' : 'down', 16)}</span></div>${sx}`;
};
const bar2 = () => `<div class="mr-bar"><div class="brand"><img src="${MARK}" alt=""><span class="wm">yravg<i>SubMeetly</i></span></div><span class="cr">Minutes${ic('right', 11)}CPOC Phase 7${ic('right', 11)}GZS Weekly Progress Meeting${ic('right', 11)}<b class="mono">W36 · 02 Sep 2026</b></span><span class="grow"></span><span class="chip sm ok">${ic('lock', 12)}On-device</span><span class="btn sm">Draft options</span><span class="btn sm">${ic('book', 14)}Library</span><span class="btn sm">Training<span class="chip sm ok" style="height:18px;padding:0 6px;font-size:11px">Lv 1 · 0 XP</span></span><span class="cb">2026-09-02 — W36${ic('down', 12)}</span><span class="btn sm">${ic('plus', 14)}Add item</span><span class="btn sm">${ic('export', 14)}Export</span><span class="pillb sm">${ic('check', 14)}Issue MoM</span><span class="iconb" title="Settings">${ic('gear', 16)}</span></div>`;
const hd = (e) => `<div class="hd"><h1>CPOC Phase 7 — GZS Weekly Progress Meeting ${SAMPLE}<span class="grow"></span><span class="iconb" style="display:grid;place-items:center;color:var(--muted)">${ic('up', 16)}</span></h1><div class="mt"><span>Date<b class="mono">2026-09-02</b></span><span>Time<b class="mono">10:00–12:00 GMT+8</b></span><span>Chair<b>Nasmee Samang</b></span><span>Present<b>7</b></span><span>MoM<b class="mono">MOM-CPOC7-W36</b></span><span>Series<b class="mono">meeting 2</b></span><span>Project type<b>Weekly progress</b></span></div></div>
<div class="mr-prov">${ic('lock', 14)}<b>Drafted on this Mac</b><span class="dv">|</span>${e ? '<span>Nothing drafted yet</span>' : '<span>Whisper large-v3-turbo (MLX) → 214 segments → 13 register items</span><span class="dv">|</span><span class="w">4 need review</span><span class="dv">|</span><span>1 low-confidence flag</span>'}<span class="grow"></span><span class="mut">No audio, transcript or text left this device.</span></div>`;
export const compactSummary = (st) => {
  const empty = st === 'empty';
  const regH = st === 'expanded' ? 238 : 312;
  const reg = empty ? `<div class="mr-reg" style="height:${regH}px">${head}<div class="emp0">No items yet. Nothing was drafted from this meeting. Draft from the transcript, or add one by hand.</div></div>` : `<div class="mr-reg" style="height:${regH}px">${head}${rows(5, -1)}</div>`;
  const inner = `<div class="tide fx mr dk mo" style="width:1280px;height:700px;display:flex">${bar2()}${hd(empty)}<div class="bw">${NEW(compact(st))}</div><div class="mr-body">${nav(empty)}<div class="mr-main">${reg}${transcript(empty)}</div></div>${foot(empty)}</div>`;
  return `<div style="width:1440px;height:780px;background:var(--fx-mo);padding:40px 80px;box-sizing:border-box">${inner}</div>`;
};
