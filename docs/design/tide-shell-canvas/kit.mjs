// Shared pieces for the Tide shell canvas: markers, icons, board chrome CSS, app (After) CSS.
// Colours come from yravgBuds brand/tokens.css (owner decision 2026-11-09); space/radius/type names from src/tokens.css.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const NEW = (inner, style = '', cls = '') => `<div class="new ${cls}" style="${style}"><span class="newtag">NEW</span>${inner}</div>`;
export const PART = (inner, style = '', cls = '') => `<div class="part ${cls}" style="${style}"><span class="parttag">PARTIAL</span>${inner}</div>`;
export const st = (id, src, stat, text, gap) => ({ id, src, stat, text, gap });
/** Button that the board script / Design runtime reads: group, key, pressed. */
export const bt = (g, k, label, on, cls = '', extra = '') => `<button type="button" class="${cls}" data-g="${g}" data-k="${k}" aria-pressed="${on ? 'true' : 'false'}"${extra}>${label}</button>`;
/** Pane shown only while the named buttons are pressed (see paneCss). */
export const dp = (tokens, inner, { tag = 'div', style = '' } = {}) => `<${tag} data-p="${tokens}"${style ? ` style="${style}"` : ''}>${inner}</${tag}>`;

/* one inline line-icon set, 24 grid, 1.7 stroke, no emoji */
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  live: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7.5 11h3M13.5 11h3M7.5 14.5h5"/>',
  minutes: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9.5 12.5h6M9.5 16h6"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  addins: '<path d="M10 4.5a2 2 0 1 1 4 0V7h3.5v3.5H20a2 2 0 1 1 0 4h-2.5V18H14v-2.5a2 2 0 1 0-4 0V18H6.5v-3.5H4a2 2 0 1 1 0-4h2.5V7H10z"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  island: '<rect x="3" y="8.5" width="18" height="7" rx="3.5"/><circle cx="8" cy="12" r="1.2"/>',
  perf: '<path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5h4"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m6 15 6-6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', updown: '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  dev: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 3.5 2 3.5h-11"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4M5 14v5.5h14V14"/>', download: '<path d="M12 4v11M8 11l4 4 4-4M5 19.5h14"/>', trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>', globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4M5 15v4.5h14V15"/>', wave: '<path d="M4 12h1.5M8.5 8v8M12.5 5v14M16.5 9v6M20 12h-.5"/>', sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5"/>',
  pie: '<path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5H12z"/>', tab: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9h17"/>', refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>', bolt: '<path d="M13 3 5.5 14H11l-1 7 7.5-11H12z"/>', user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z"/>', pause: '<path d="M9 5.5v13M15 5.5v13"/>', pin: '<path d="M12 21s6-5.2 6-10.5A6 6 0 0 0 6 10.5C6 15.8 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
  box: '<path d="M4 8 12 4l8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export const ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
export const tile = (n, cls = '') => `<span class="tl ${cls}">${ic(n, 18)}</span>`;
export const img = (p, cls = '', alt = '') => `<img class="${cls}" src="${p}" alt="${alt}">`;
export const MARK = 'tide/icons/01-tide-mark-green.svg';

/** One pane rule per data-p token found in the html. */
export function paneCss(html) {
  const toks = new Set([...html.matchAll(/data-p="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  return '[data-p]{display:none!important;--pd:block}\n' + [...toks].map((t) => { const [g, k] = t.split(':'); return `.board:has([data-g="${g}"][data-k="${k}"][aria-pressed="true"]) [data-p~="${t}"]{display:var(--pd,block)!important}`; }).join('\n');
}
export const ixScript = `<script>document.addEventListener('click',function(e){var t=e.target.closest('[data-g][data-k]');if(!t)return;var b=t.closest('.board');if(!b)return;var g=t.getAttribute('data-g'),k=t.getAttribute('data-k');b.querySelectorAll('[data-g="'+g+'"]').forEach(function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-k')===k))})});</script>`;
export function ixDc(body) {
  const re = /data-g="(\w+)" data-k="(\w+)" aria-pressed="(true|false)"/g;
  const def = {}; const pairs = new Set();
  for (const [, g, k, on] of body.matchAll(re)) { if (!(g in def)) def[g] = ''; if (on === 'true') def[g] = k; pairs.add(g + '|' + k); }
  const out = body.replace(re, (m, g, k) => `data-g="${g}" data-k="${k}" aria-pressed="{{p_${g}_${k}}}" onClick="{{go_${g}_${k}}}"`);
  const lines = [...pairs].map((p) => { const [g, k] = p.split('|'); return `o.p_${g}_${k} = s.${g} === '${k}'; o.go_${g}_${k} = () => this.setState({ ...this.state, ${g}: '${k}' });`; });
  return { body: out, logic: `class Component extends DCLogic {\nstate = ${JSON.stringify(def)};\nrenderVals() {\nconst s = this.state; const o = {};\n${lines.join('\n')}\nreturn o;\n}\n}` };
}

/* ===== board chrome (the canvas itself, not the app): Geist, navy notes, yellow NEW, amber PARTIAL ===== */
export const BOARD_CSS = `
:root{--fx-mo:#0E0E0E;--white:#fff;--black:#000;--sh-sw:rgba(0,0,0,.25);--sh-ask:rgba(11,59,36,.4);--glass-dk:rgba(11,19,16,.82);--ink-fg:#0A0F0C;--ink-dk:#E8F2EC;--glass:rgba(255,255,255,.92);--glass-2:rgba(255,255,255,.88);--shadow-dlg:rgba(0,0,0,.45);--composer:#F5F5F7;--ground:#E7E9EF;--ground-2:#F3F4F8;--win:#fff;--side-2:#ECEEF4;--line:#E2E5EC;--line-2:#D3D7E1;--ink:#171B26;--muted-c:#545B6E;--navy:#212C5F;--navy-2:#2F3D80;--yellow:#FFC91B;--ok-c:#1E7B4E;--ok-soft:#E5F3EB;--warn-c:#8A5D00;--warn-ink:#5E3F00;--warn-soft:#FFF1D1;--amber:#C27A00;--sh-a:rgba(23,27,38,.5);--sh-b:rgba(23,27,38,.45);--vw-shadow:rgba(23,27,38,.12);--sans:'Geist',system-ui,sans-serif;--monoc:'Geist Mono',ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);font-family:var(--sans);color:var(--ink);font-size:13px;line-height:1.4}
.page{display:flex}.toc{position:sticky;top:0;align-self:flex-start;width:210px;height:100vh;overflow:auto;padding:24px 14px;border-right:1px solid var(--line-2);background:var(--ground-2);font-size:12.5px}
.toc a{display:block;color:var(--ink);text-decoration:none;padding:4px 6px;border-radius:6px}.toc a:hover{background:var(--side-2)}.toc .tt{font:600 10.5px var(--monoc);letter-spacing:.1em;color:var(--muted-c);margin:14px 0 4px}
main.cv{width:1640px;flex:none}
.cover,.board,.status,.index{width:1640px;padding:52px 56px;border-bottom:1px solid var(--line-2)}
.cover h1{font-size:44px;margin:0 0 8px;letter-spacing:-1px}.cover p{color:var(--muted-c);max-width:960px;font-size:15px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}.tile{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:18px}.tile b{font-size:34px;display:block}
.tcards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.tcard{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px}.tcard h3{margin:0 0 6px;font:600 12px var(--monoc);letter-spacing:.08em}
.legend{display:flex;gap:28px;align-items:center;margin-top:28px;flex-wrap:wrap}
table.stt{width:100%;border-collapse:collapse;background:var(--win);border-radius:12px;overflow:hidden}table.stt td,table.stt th{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}table.stt th{font:600 10.5px var(--monoc);letter-spacing:.1em;color:var(--muted-c)}
table.stt a{color:var(--navy-2)}
.hd{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}.ey{display:flex;gap:10px;align-items:center;font:500 11.5px/1 var(--monoc);letter-spacing:.08em;color:var(--muted-c)}
.tier{font:600 11px/1 var(--monoc);letter-spacing:.08em;padding:5px 9px;border-radius:99px;background:var(--navy);color:var(--white)}
.ttl{margin:0;font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.8px}.ext{font-size:14px;color:var(--muted-c)}.ext b{color:var(--ink)}
.ixh{display:flex;gap:16px;align-items:center;margin-bottom:18px}
.vw{display:inline-flex;padding:2px;border-radius:8px;background:var(--side-2);gap:2px}
.vw button{height:28px;padding:0 14px;border:0;border-radius:6px;background:transparent;font:500 12.5px var(--sans);color:var(--muted-c);cursor:pointer}
.vw button[aria-pressed="true"]{background:var(--win);color:var(--ink);box-shadow:0 1px 2px var(--vw-shadow)}
.ixcap{font-size:12px;color:var(--muted-c);display:flex;gap:8px;align-items:center;margin:0 0 8px}
.vt{font:600 10.5px/1 var(--monoc);padding:4px 8px;border-radius:99px;background:var(--side-2);color:var(--muted-c)}
.ixi{width:1140px;border:1px solid var(--line-2);border-radius:12px;display:block}
.win{flex:none;background:var(--black);border:1px solid var(--line-2);border-radius:12px;box-shadow:0 30px 70px -30px var(--sh-b);position:relative}
.scaler{transform-origin:0 0;overflow:hidden;border-radius:12px}
.aside4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:28px}
.card{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.lbl{font:600 10.5px/1.2 var(--monoc);letter-spacing:.12em;text-transform:uppercase;color:var(--muted-c)}
.must{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}.motion{display:flex;flex-direction:column;gap:7px;font-size:12.5px}.motion .m{display:flex;gap:8px}.motion .m span:first-child{font:600 11px var(--monoc);color:var(--navy-2);white-space:nowrap}
.st{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:8px}.sti{display:flex;align-items:center;gap:8px}.sid{font:600 11.5px var(--monoc)}
.src{font:600 10px/1 var(--monoc);padding:3px 6px;border-radius:5px;background:var(--side-2);color:var(--muted-c)}
.stat,.spill{margin-left:auto;font:600 10.5px/1 var(--monoc);padding:3px 7px;border-radius:99px}.stat.built,.spill.built{background:var(--ok-soft);color:var(--ok-c)}.stat.partial,.spill.partial{background:var(--warn-soft);color:var(--warn-c)}.stat.new,.spill.new{background:var(--navy);color:var(--white)}
.stt{font-size:12.5px}.spill{margin-left:0}
.lg{padding:6px 10px;border-radius:8px}.lgn{outline:2px solid var(--yellow)}.lgp{outline:2px dashed var(--amber)}.gap{font-size:12px;color:var(--warn-c)}.gap b{color:var(--warn-ink)}.where{display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.new:not(.stat):not(.spill){outline:2px solid var(--yellow);outline-offset:2px;border-radius:8px;position:relative}
.newtag{position:absolute;top:-10px;left:8px;background:var(--yellow);color:var(--navy);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:3px 6px;border-radius:99px;z-index:20}
.part>.parttag+.new>.newtag,.new>.newtag+.part>.parttag{left:84px}.part{outline:2px dashed var(--amber);outline-offset:2px;border-radius:8px;position:relative}
.parttag{position:absolute;top:-10px;left:8px;background:var(--warn-soft);color:var(--warn-c);border:1px solid var(--amber);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:2px 6px;border-radius:99px;z-index:20}
.note{position:absolute;max-width:290px;background:var(--navy);color:var(--white);font-size:11.5px;line-height:16px;padding:7px 10px;border-radius:8px;box-shadow:0 8px 20px -8px var(--sh-a);z-index:30}.note b{color:var(--yellow);font-weight:600}.note.pn{border-left:4px solid var(--amber)}
.kept{margin-top:18px;background:var(--win);border:1px solid var(--line);border-radius:14px;padding:14px 18px}.kept .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.kept .chips span{font-size:11.5px;padding:3px 9px;border-radius:99px;background:var(--side-2);color:var(--ink)}
.refs{margin-top:22px;background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px}.refs .rg{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.refs figure{margin:0}.refs img{width:100%;height:270px;object-fit:contain;background:var(--ground-2);border-radius:8px}.refs figcaption{font-size:12px;color:var(--muted-c);margin-top:6px}.refs p{margin:4px 0 12px;font-size:12.5px}
.dim{opacity:.72}
`;

/* ===== After: the Tide shell, painted with yravg brand tokens. Scope .tide (light) / .tide.dk (dark). ===== */
export const TIDE_CSS = `
.tide{--sky-1:#DDF1F0;--sky-2:#EAF7F0;--sea-1:#BFE8D2;--surface:#fff;--surface-2:#F3FBF6;--mint:#E9F7EE;--line:#DCE8E1;--text:#0A0F0C;--muted:#4B5A52;--gi:#0E7A47;--green:#22C55E;--lime:#B6F35C;--emerald:#0E9F6E;--on-brand:#0A0F0C;--pill-bg:#0A0F0C;--pill-fg:#fff;--danger:#B42318;--danger-bg:#FDECEA;--warn:#8A5A00;--warn-bg:#FFF4D6;--shadow:0 1px 2px rgba(10,15,12,.05),0 10px 28px -14px rgba(11,59,36,.28);--ink2:#33443A;--scrim:rgba(10,15,12,.38);
  --disp:'Fredoka','Plus Jakarta Sans',system-ui,sans-serif;--sans:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;--mono:ui-monospace,Menlo,Consolas,monospace;
  --r:14px;--r-lg:22px;--ease-out:cubic-bezier(.16,1,.3,1);--ease-spring:cubic-bezier(.2,.9,.25,1.12);
  font:16px/1.45 var(--sans);color:var(--text);background:var(--surface);color-scheme:light;position:relative;overflow:hidden}
.tide.dk{--sky-1:#0F2220;--sky-2:#12241B;--sea-1:#1A3B2E;--surface:#0B1310;--surface-2:#111C18;--mint:#12241B;--line:#24372F;--text:#E8F2EC;--muted:#A3B5AB;--gi:#4ADE80;--pill-bg:#E8F2EC;--pill-fg:#0A0F0C;--danger:#FF8A80;--danger-bg:#2A1512;--warn:#F5C16C;--warn-bg:#2B2210;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px -14px rgba(0,0,0,.6);--ink2:#C9D8CF;--scrim:rgba(0,0,0,.55);color-scheme:dark}
.tide *{box-sizing:border-box}.tide .ic{flex:none}.tide button{font:inherit;color:inherit;border:0;background:none;cursor:default}.tide h1,.tide h2,.tide h3,.tide p{margin:0}
.tide .grow{flex:1}.tide .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}.tide .mut{color:var(--muted)}.tide .gi{color:var(--gi)}
.tide{display:flex}
/* sidebar */
.tide .sb{width:292px;flex:none;display:flex;flex-direction:column;gap:var(--space-2,8px);padding:20px 16px 16px;background:var(--surface);border-right:1px solid var(--line)}
.tide .brand{display:flex;align-items:center;gap:10px;height:40px;padding:0 4px;font-weight:800;font-size:18px;letter-spacing:-.02em}.tide .brand img{width:32px;height:32px}.tide .brand .bell{margin-left:auto;color:var(--muted)}.tide .brand i{font-style:normal;color:var(--gi)}
.tide .series{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--r);background:var(--mint);margin-top:6px}
.tide .av{width:36px;height:36px;border-radius:50%;background:var(--green);color:var(--on-brand);display:grid;place-items:center;font-weight:800;font-size:13px;flex:none}.tide .av.sm{width:28px;height:28px;font-size:11px}
.tide .series b{display:block;font-size:14px;line-height:1.25}.tide .series small{display:block;font-size:12px;color:var(--muted)}.tide .series .ic{margin-left:auto;color:var(--muted)}
.tide .askf{flex:none;display:flex;align-items:center;gap:10px;height:44px;padding:0 16px;border-radius:var(--r-lg);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);color:var(--muted);font-size:15px}.tide .askf kbd{margin-left:auto;font:600 11px var(--mono);padding:2px 6px;border-radius:6px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line)}
.tide .sec{font-size:13px;font-weight:600;color:var(--muted);padding:14px 12px 4px}
.tide .nav{display:flex;flex-direction:column;gap:2px}.tide .nav a{display:flex;align-items:center;gap:12px;height:42px;padding:0 12px;border-radius:12px;color:var(--ink2);font-size:15.5px;font-weight:500}
.tide .nav a.on{background:var(--mint);color:var(--text);font-weight:700}.tide .nav a.on .ic{color:var(--gi)}.tide .nav a .n{margin-left:auto;font-size:13px;color:var(--muted);font-weight:600}.tide .nav a.dv{color:var(--muted)}
.tide .sb .push{flex:1}
.tide .pillb{flex:none;white-space:nowrap;display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border-radius:999px;background:var(--pill-bg);color:var(--pill-fg);font-weight:700;font-size:16px}.tide .pillb kbd{font:600 12px var(--mono);opacity:.7}
.tide .pillb.sm{height:40px;padding:0 20px;font-size:14px}.tide .pillb.full{width:100%}
.tide .sbf{display:flex;align-items:center;gap:10px;padding:10px 6px 0}.tide .sbf b{display:block;font-size:14px;line-height:1.2}.tide .sbf small{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.tide .dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;flex:none}.tide .dot.off{background:var(--muted)}.tide .dot.bad{background:var(--danger)}
/* main */
.tide .mn{flex:1;min-width:0;padding:28px 36px 36px;display:flex;flex-direction:column;gap:20px;background:var(--surface)}
.tide .top{display:flex;align-items:center;gap:12px;min-height:56px}.tide .top h1{font-size:40px;line-height:1.1;font-weight:800;letter-spacing:-.03em}
.tide .chip{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-size:15px;font-weight:600;white-space:nowrap}
.tide .chip.sm{height:32px;padding:0 12px;font-size:13px}.tide .chip.ok{background:var(--mint);color:var(--gi);box-shadow:none}.tide .chip.bad{background:var(--danger-bg);color:var(--danger);box-shadow:none}.tide .chip.warn{background:var(--warn-bg);color:var(--warn);box-shadow:none}
.tide .sample{font-size:12px;font-weight:600;color:var(--muted);border:1px dashed var(--muted);border-radius:999px;padding:2px 9px}
.tide .sw{width:34px;height:20px;border-radius:999px;background:var(--line);position:relative;flex:none}.tide .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--white);box-shadow:0 1px 2px var(--sh-sw)}.tide .sw.on{background:var(--gi)}.tide .sw.on::after{left:16px}
.tide .tl{width:34px;height:34px;border-radius:10px;background:var(--mint);color:var(--gi);display:grid;place-items:center;flex:none}.tide .tl.dk2{background:var(--pill-bg);color:var(--pill-fg)}.tide .tl.red{background:var(--danger-bg);color:var(--danger)}.tide .tl.amb{background:var(--warn-bg);color:var(--warn)}
.tide .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;font-weight:600;white-space:nowrap}
.tide .btn.dark{background:var(--pill-bg);color:var(--pill-fg);box-shadow:none}.tide .btn.green{background:var(--green);color:var(--on-brand);box-shadow:none}.tide .btn.sm{height:32px;padding:0 12px;font-size:13px}.tide .btn.off{opacity:1;background:var(--line);color:var(--muted);box-shadow:none}.tide .btn.danger{background:var(--danger-bg);color:var(--danger);box-shadow:none}
.tide .cd{background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow),inset 0 0 0 1px var(--line);padding:20px 22px;display:flex;flex-direction:column;gap:12px}.tide .cd.soft{background:var(--surface-2)}
.tide .cd h3{font-size:18px;font-weight:800;letter-spacing:-.01em}.tide .cd .eyebrow,.tide .eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
/* hero */
.tide .hero{position:relative;border-radius:28px;overflow:hidden;min-height:470px;padding:34px 38px;display:flex;flex-direction:column;gap:10px;box-shadow:inset 0 0 0 1px var(--line)}
.tide .hero .bg{position:absolute;inset:0;z-index:0}.tide .hero>*:not(.bg){position:relative;z-index:1}
.tide .hero h2{font:600 46px/1.1 var(--disp);letter-spacing:-.01em;max-width:620px}
.tide .hero .dateline{display:flex;align-items:center;gap:8px;font-size:15px;color:var(--ink2);font-weight:500;margin-top:6px}
.tide .bignum{display:flex;align-items:baseline;gap:10px;font-family:var(--disp);font-weight:600;color:var(--text)}.tide .bignum b{font-size:72px;line-height:1;letter-spacing:-.02em;font-weight:600}.tide .bignum span{font-size:20px;color:var(--ink2)}
.tide .hero .sub{font-size:15px;color:var(--ink2);font-weight:500}
.tide .askbar{position:relative;display:flex;align-items:center;gap:12px;height:62px;padding:0 10px 0 22px;border-radius:999px;background:var(--glass);box-shadow:0 10px 30px -14px var(--sh-ask),inset 0 0 0 1px var(--line);max-width:720px;margin-top:84px;font-size:18px;color:var(--muted)}
.tide .askbar .send,.tide .send{width:44px;height:44px;border-radius:50%;background:var(--pill-bg);color:var(--pill-fg);display:grid;place-items:center;margin-left:auto;flex:none}.tide .send.off{background:var(--line);color:var(--muted)}
.tide .peek{position:absolute;right:96px;top:-98px;width:96px;pointer-events:none}.tide .peek img{width:96px;display:block}
.tide .chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}.tide .chips .chip{height:46px;background:var(--glass-2);font-weight:600}
.tide.dk .askbar,.tide.dk .chips .chip{background:var(--glass-dk)}
/* week + bars */
.tide .cols{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:32px;align-items:start}
.tide .lc{display:flex;flex-direction:column;gap:6px;min-width:0}.tide .rc{display:flex;flex-direction:column;gap:18px}
.tide .kpi{display:flex;align-items:center;gap:10px}.tide .kpi b{font:600 40px/1.1 var(--disp)}.tide .delta{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:600}.tide .delta.up{color:var(--danger)}.tide .delta.good{color:var(--gi)}
.tide .wih{display:flex;align-items:center;margin-top:18px;font-size:15px;color:var(--muted);font-weight:600}
.tide .sel{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;font-weight:600;color:var(--text)}
.tide .bars{display:flex;flex-direction:column;gap:14px;margin-top:12px;padding-right:16px}.tide .brow{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:2px 14px;align-items:center}
.tide .brow .tl{width:44px;height:44px;border-radius:14px;grid-row:1/3}.tide .brow .nm{font-size:16px;font-weight:600}.tide .brow .v{font-weight:700;font-size:16px}.tide .brow .bar{grid-column:2/4;height:8px;border-radius:999px;background:var(--line);overflow:hidden}.tide .brow .bar i{display:block;height:100%;border-radius:999px;background:var(--c)}
.tide .brow .nm small{display:block;font-size:12.5px;color:var(--muted);font-weight:500}
.tide .over{display:flex;align-items:center;gap:10px;margin-top:10px;padding:12px 16px;border-radius:var(--r);background:var(--danger-bg);color:var(--danger);font-weight:700;font-size:15px}.tide .over small{font-weight:500;margin-left:auto}
.tide .rail1 h3{font-size:22px;line-height:1.2}.tide .rail1 p{color:var(--muted);font-size:15px}
.tide .mrow{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.tide .mrow .t{font:600 13px var(--mono);color:var(--muted)}.tide .mrow b{display:block;font-size:15px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tide .mrow small{font-size:12.5px;color:var(--muted)}
.tide .kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}.tide .kv span:first-child{color:var(--muted)}.tide .kv b{font-weight:600;text-align:right}
/* generic page parts */
.tide .seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}.tide .seg>*{padding:6px 16px;border-radius:999px;font-size:14px;font-weight:600;color:var(--muted);white-space:nowrap}.tide .seg>.on{background:var(--pill-bg);color:var(--pill-fg)}.tide .seg.sm>*{padding:4px 12px;font-size:12.5px}.tide .seg.gr>.on{background:var(--green);color:var(--on-brand)}
.tide .fld{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}.tide .fld label{font-size:13px;font-weight:600;color:var(--muted)}
.tide .combo{display:flex;align-items:center;justify-content:space-between;gap:8px;height:44px;padding:0 14px;border-radius:var(--r);background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);font-size:15px;font-weight:600}.tide .combo .ic{color:var(--muted)}
.tide .srow{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}.tide .srow b{display:block;font-size:15px}.tide .srow small{font-size:12.5px;color:var(--muted)}
.tide .callout{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:var(--r);background:var(--mint);font-size:14.5px}.tide .callout.err{background:var(--danger-bg);color:var(--text)}.tide .callout.err .tl{background:var(--danger);color:var(--white)}.tide .callout.warn{background:var(--warn-bg)}.tide .callout .row{display:flex;gap:8px;margin-top:10px}
.tide .tabsb{display:flex;gap:6px;border-bottom:1px solid var(--line)}.tide .tabsb span{padding:10px 14px;font-size:15px;font-weight:600;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-1px;white-space:nowrap}.tide .tabsb .on{color:var(--text);border-bottom-color:var(--green)}
.tide .tt{width:100%;border-collapse:collapse;font-size:14.5px}.tide .tt th{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}.tide .tt td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.tide .ty{display:inline-block;font-size:12.5px;font-weight:700;border-radius:8px;padding:2px 9px;background:color-mix(in srgb,var(--c) 13%,var(--surface));color:var(--text)}.ty::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);margin-right:6px}
.tide .ck{display:flex;align-items:center;gap:8px;font-size:14px}.tide .ck i{width:18px;height:18px;border-radius:5px;background:var(--gi);color:var(--white);display:grid;place-items:center}.tide .ck i.no{background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--line)}
.tide .live{border-radius:var(--r-lg);background:var(--surface-2);padding:20px 22px;box-shadow:inset 0 0 0 1px var(--line)}.tide .live .sp{font-size:13px;color:var(--muted);padding:6px 0}.tide .live .cur{font-size:22px;font-weight:700;line-height:1.35;padding-left:14px;border-left:4px solid var(--green);margin:6px 0}.tide .live .tr{font-size:17px;color:var(--gi);font-weight:600;padding-left:18px}
.tide .tile2{display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--shadow),inset 0 0 0 1px var(--line)}.tide .tile2 .tl{width:44px;height:44px;border-radius:14px}.tide .tile2 b{font-size:16px}.tide .tile2 p{font-size:13.5px;color:var(--muted);flex:1}.tide .tile2 .ft{display:flex;align-items:center;gap:10px}
.tide .scrim{position:absolute;inset:0;background:var(--scrim);z-index:40}
.tide .dlg{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:640px;max-height:880px;background:var(--surface);border-radius:var(--r-lg);box-shadow:0 30px 80px -20px var(--shadow-dlg),inset 0 0 0 1px var(--line);z-index:41;display:flex;flex-direction:column;overflow:hidden}
.tide .dlg .dh{display:flex;align-items:center;gap:8px;padding:16px 18px 12px;font-size:18px;font-weight:800}.tide .dlg .ib{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:var(--muted)}.tide .dlg .db{padding:6px 22px 14px;display:flex;flex-direction:column;gap:14px;overflow:hidden}
.tide .ub{align-self:flex-end;max-width:450px;background:var(--pill-bg);color:var(--pill-fg);padding:12px 18px;border-radius:22px 22px 6px 22px;font-size:16px;font-weight:500}
.tide .step{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--muted)}.tide .step .ic{color:var(--gi)}
.tide .ans{font-size:16px;line-height:1.5}.tide .ans b{font-weight:800}
.tide .lcard{background:var(--surface-2);border-radius:var(--r);padding:14px 16px;display:flex;flex-direction:column;gap:12px;box-shadow:inset 0 0 0 1px var(--line)}.tide .lcard .lh{display:flex;align-items:baseline;gap:8px}.tide .lcard .lh b{font-size:15px}.tide .lcard .lh span{font-size:13px;color:var(--muted)}.tide .lcard .lh strong{margin-left:auto;font-size:16px}
.tide .lrow{display:flex;align-items:center;gap:12px}.tide .lrow .tl{width:36px;height:36px}.tide .lrow b{display:block;font-size:14.5px;font-weight:600;line-height:1.25}.tide .lrow small{font-size:12.5px;color:var(--muted)}.tide .lrow .r{margin-left:auto;font-weight:700;font-size:13px;white-space:nowrap}.tide .lcard .ft{font-size:13px;color:var(--muted)}
.tide .acard{border-radius:var(--r);padding:14px 16px;background:var(--surface);box-shadow:0 0 0 1.5px var(--gi);display:flex;flex-direction:column;gap:10px}.tide .acard .h{display:flex;gap:10px;align-items:center;font-weight:800;font-size:15px}.tide .acard .row{display:flex;gap:10px}.tide .acard .row>*{flex:1}
.tide .ecard{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}.tide .ecard b{display:block;font-size:14.5px}.tide .ecard small{font-size:12.5px;color:var(--muted)}.tide .ecard .ok{margin-left:auto;color:var(--gi);font-weight:700;font-size:13.5px}.tide .ecard .op{font-weight:700;font-size:14px}
.tide .comp{display:flex;align-items:center;gap:8px;margin:6px 18px 18px;padding:6px 6px 6px 18px;height:52px;border-radius:26px;background:var(--composer);color:var(--muted);font-size:16px}.tide.dk .comp{background:var(--surface-2)}
.tide .typing{display:flex;align-items:center;gap:10px}.tide .typing .dots{display:flex;gap:5px;padding:12px 14px;border-radius:999px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}.tide .typing .dots i{width:7px;height:7px;border-radius:50%;background:var(--muted);opacity:.6}.tide .typing .dots i:nth-child(2){opacity:.8}.tide .typing .dots i:nth-child(3){opacity:1}
.tide .avm{width:30px;height:30px;border-radius:50%;background:var(--green);display:grid;place-items:center;flex:none}.tide .avm img{width:22px;height:22px}
.tide .rg3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.tide .rg4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.tide .empty{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:30px 20px}.tide .empty h3{font-size:20px}.tide .empty p{color:var(--muted);max-width:340px;font-size:14.5px}.tide .empty img{height:96px}
.tide .lockc{display:flex;gap:12px;padding:14px 16px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line);align-items:flex-start}
.tide .dev{border:1.5px dashed var(--muted);border-radius:var(--r)}
.tide .code{font:12.5px/1.5 var(--mono);background:var(--surface-2);border-radius:12px;padding:12px 14px;box-shadow:inset 0 0 0 1px var(--line);white-space:pre;overflow:hidden}
.tide .sample-in{display:inline-block;margin-left:8px}
/* responsive frames */
.tide.t1024 .sb{width:76px;padding:16px 10px;align-items:center}.tide.t1024 .sb .hide1{display:none}.tide.t1024 .nav a{width:48px;padding:0;justify-content:center}.tide.t1024 .pillb{width:48px;height:48px}.tide.t1024 .brand{padding:0}
.tide.t1024 .cols{grid-template-columns:minmax(0,1fr) 300px;gap:20px}.tide.t1024 .mn{padding:20px 22px}.tide.t1024 .hero{padding:26px}.tide.t1024 .hero h2{font-size:36px}.tide.t1024 .bignum b{font-size:56px}
.tide.t390{flex-direction:column}.tide.t390 .sb{display:none}.tide.t390 .mn{padding:14px;gap:14px}.tide.t390 .top h1{font-size:28px}.tide.t390 .hero{padding:20px 18px;min-height:0;border-radius:22px}.tide.t390 .hero h2{font-size:28px}.tide.t390 .bignum b{font-size:48px}
.tide.t390 .cols{grid-template-columns:1fr}.tide.t390 .askbar{height:52px;font-size:15px;margin-top:14px}.tide.t390 .peek{display:none}.tide.t390 .chips .chip{height:38px;font-size:13px}.tide .mbar{display:none}.tide.t390 .mbar{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;border-bottom:1px solid var(--line);font-weight:800}
`;
