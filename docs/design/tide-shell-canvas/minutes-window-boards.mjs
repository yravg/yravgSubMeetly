// A04c (Open the Minutes window) and A04d (Minutes page, same layout, Tide colours). Sample data: the owner's sample-library series W36.
import { ic, MARK, NEW } from './kit.mjs';
import { shell, topbar } from './boards.mjs';
import { TYPES, nav, transcript, head, rows, foot } from './minutes-boards.mjs';

const SAMPLE = '<span class="sample">sample</span>';

export const WIN_CSS = `
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
.tide.fx .sb3{margin:8px 14px 0;height:122px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);display:flex;gap:22px;padding:12px 16px;flex:none}
.tide.fx .c13{display:flex;flex-direction:column;justify-content:center;align-items:center;width:64px}.tide.fx .c13 b{font:600 34px/1 var(--disp)}.tide.fx .c13 span{font-size:10.5px;color:var(--muted);font-weight:600;margin-top:4px}
.tide.fx .lg3{width:150px;display:flex;flex-direction:column;gap:0}.tide.fx .lg3 .sg{display:flex;gap:2px;height:7px;margin-bottom:6px}.tide.fx .lg3 .sg i{display:block;border-radius:99px}
.tide.fx .lg3 .r{display:grid;grid-template-columns:12px 1fr 16px 30px;align-items:center;height:15.5px;font-size:11.5px}.tide.fx .lg3 .r i{width:7px;height:7px;border-radius:50%}.tide.fx .lg3 .r b{text-align:right;font-weight:700}.tide.fx .lg3 .r em{font-style:normal;color:var(--muted);text-align:right;font-size:11px}
.tide.fx .k3{display:flex;flex-direction:column;gap:10px;padding-top:4px}.tide.fx .ks3{display:flex;gap:22px}.tide.fx .ks3 div{display:flex;flex-direction:column;gap:2px}.tide.fx .ks3 small{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}.tide.fx .ks3 b{font-size:15px;font-weight:700}.tide.fx .ks3 b span{font-size:11.5px;color:var(--muted)}
.tide.fx .ks3 .rd{color:var(--danger)}.tide.fx .ks3 .am{color:var(--warn)}.tide.fx .ks3 .gn{color:var(--gi)}
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
.tide.fx .pop{position:absolute;right:14px;top:40px;width:230px;background:var(--surface);border-radius:var(--r);box-shadow:0 20px 50px -16px var(--shadow-dlg),inset 0 0 0 1px var(--line);padding:8px;z-index:5;display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.tide.fx .pop .g{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:4px 8px}
.tide.fx .pop .o{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}.tide.fx .pop .o.on{background:var(--mint);font-weight:700}.tide.fx .pop .o .r{margin-left:auto;color:var(--muted);font-size:11px}.tide.fx .pop .o .rd{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--line)}.tide.fx .pop .o.on .rd{box-shadow:inset 0 0 0 4px var(--gi)}
.tide .ct{width:100%;border-collapse:collapse;font-size:14px}.tide .ct th{text-align:left;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--line)}.tide .ct td{padding:7px 10px;border-bottom:1px solid var(--line)}.tide .ct .mono{font:600 13px var(--mono)}
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

/* ---------- A04d ---------- */
const pct = { a: '31%', m: '23%', r: '15%', n: '15%', d: '8%', q: '8%' };
const band3 = () => `<div class="sb3"><div class="c13"><b>13</b><span>ITEMS</span></div><div class="lg3"><div class="sg">${TYPES.map((t) => `<i style="flex:${t[2]};background:${t[3]}"></i>`).join('')}</div>${TYPES.map((t) => `<div class="r"><i style="background:${t[3]}"></i><span>${t[1]}</span><b>${t[2]}</b><em>${pct[t[0]]}</em></div>`).join('')}</div>
<div class="k3"><div class="ks3"><div><small>Actions open</small><b>4<span>/4</span></b></div><div><small>Overdue</small><b class="rd">7</b></div><div><small>Agenda covered</small><b>71%</b></div><div><small>Unreviewed</small><b class="am">4</b></div><div><small>Progress vs baseline</small><b class="gn">+1.11%</b></div></div><span class="btn sm rv">Review 1 low-confidence item</span></div></div>`;
const bar2 = () => `<div class="mr-bar"><div class="brand"><img src="${MARK}" alt=""><span class="wm">yravg<i>SubMeetly</i></span></div><span class="cr">Minutes${ic('right', 11)}CPOC Phase 7${ic('right', 11)}GZS Weekly Progress Meeting${ic('right', 11)}<b class="mono">W36 · 02 Sep 2026</b></span><span class="grow"></span><span class="chip sm ok">${ic('lock', 12)}On-device</span><span class="btn sm">Draft options</span><span class="btn sm">${ic('book', 14)}Library</span><span class="btn sm">Training<span class="chip sm ok" style="height:18px;padding:0 6px;font-size:11px">Lv 1 · 0 XP</span></span><span class="cb">2026-09-02 — W36${ic('down', 12)}</span><span class="btn sm">${ic('plus', 14)}Add item</span><span class="btn sm">${ic('export', 14)}Export</span><span class="pillb sm">${ic('check', 14)}Issue MoM</span><span class="iconb" title="Settings">${ic('gear', 16)}</span></div>`;
const hd = () => `<div class="hd"><h1>CPOC Phase 7 — GZS Weekly Progress Meeting ${SAMPLE}<span class="grow"></span><span class="iconb" style="display:grid;place-items:center;color:var(--muted)">${ic('up', 16)}</span></h1><div class="mt"><span>Date<b class="mono">2026-09-02</b></span><span>Time<b class="mono">10:00–12:00 GMT+8</b></span><span>Chair<b>Nasmee Samang</b></span><span>Present<b>7</b></span><span>MoM<b class="mono">MOM-CPOC7-W36</b></span><span>Series<b class="mono">meeting 2</b></span><span>Project type<b>Weekly progress</b></span></div></div>
<div class="mr-prov">${ic('lock', 14)}<b>Drafted on this Mac</b><span class="dv">|</span><span>Whisper large-v3-turbo (MLX) → 214 segments → 13 register items</span><span class="dv">|</span><span class="w">4 need review</span><span class="dv">|</span><span>1 low-confidence flag</span><span class="grow"></span><span class="mut">No audio, transcript or text left this device.</span></div>`;
const themePop = () => `<div class="pop"><div class="g">Theme</div><div class="o"><span class="rd"></span>Dark<span class="r">current</span></div><div class="o"><span class="rd"></span>Coretax</div><div class="o"><span class="rd"></span>Tide light</div><div class="o on"><span class="rd"></span>Tide dark</div></div>`;

export const sameLayout = (state) => {
  const dk = state === 'dark' || state === 'theme';
  const inner = `<div class="tide fx mr${dk ? ' dk' : ''}" style="width:1280px;height:700px;display:flex">${bar2()}${hd()}${band3()}<div class="mr-body">${nav(false)}<div class="mr-main"><div class="mr-reg">${head}${rows(5, -1)}</div>${transcript(false)}</div></div>${foot(false)}${state === 'theme' ? themePop() : ''}</div>`;
  return `<div style="width:1440px;height:780px;background:var(${dk ? '--fx-dk' : '--fx-lt'});padding:40px 80px;box-sizing:border-box">${NEW(inner, 'width:1280px;height:700px')}</div>`;
};

/* ---------- contrast table for the Tide dark text pairs (measured at build time) ---------- */
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const DK = { surface: '#0B1310', s2: '#111C18', mint: '#12241B', text: '#E8F2EC', muted: '#A3B5AB', gi: '#4ADE80', danger: '#FF8A80', warn: '#F5C16C', warnbg: '#2B2210', pillbg: '#E8F2EC', pillfg: '#0A0F0C' };
export const darkPairs = [
  ['Body text', 'text', 'surface', 4.5], ['Body text on panels', 'text', 's2', 4.5], ['Labels, meta, column heads', 'muted', 'surface', 4.5], ['Labels on panels', 'muted', 's2', 4.5],
  ['Accepted, sorted column, links', 'gi', 'surface', 4.5], ['Accepted badge', 'gi', 'mint', 4.5], ['Overdue', 'danger', 'surface', 4.5], ['Needs review, Review button', 'warn', 'warnbg', 4.5], ['Issue MoM (light ink pill)', 'pillfg', 'pillbg', 4.5],
];
export const dotPairs = [['Action', '#E8F2EC'], ['Decision', '#34D399'], ['Metric', '#60A5FA'], ['Risk', '#F87171'], ['Open question', '#A78BFA'], ['Note', '#94A3B8']];
export const contrastCard = () => {
  const r1 = darkPairs.map(([n, f, b, need]) => { const v = ratio(DK[f], DK[b]); return `<tr><td>${n}</td><td class="mono">${DK[f]} on ${DK[b]}</td><td class="mono">${v.toFixed(2)}:1</td><td>${v >= need ? 'Pass AA' : 'FAIL'}</td></tr>`; }).join('');
  const r2 = dotPairs.map(([n, c]) => { const v = ratio(c, DK.s2); return `<tr><td>${n} bar and dot (not text)</td><td class="mono">${c} on ${DK.s2}</td><td class="mono">${v.toFixed(2)}:1</td><td>${v >= 3 ? 'Pass 3:1' : 'FAIL'}</td></tr>`; }).join('');
  return `<div class="tide dk" style="width:1440px;height:720px;padding:40px 80px;box-sizing:border-box;display:block"><div class="cd" style="gap:10px"><h3>Tide dark: text and mark pairs measured</h3><table class="ct"><tr><th>Role</th><th>Pair</th><th>Ratio</th><th>Result</th></tr>${r1}${r2}</table></div></div>`;
};
