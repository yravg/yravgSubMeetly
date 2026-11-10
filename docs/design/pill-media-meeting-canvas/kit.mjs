// Shared pieces for the pill Media / Meeting canvas: markers, real island icons, board chrome CSS, pill CSS.
// The pill is drawn at 1x (620 DIP wide) with the island's SUBMEETLY_PAPER look (island/crates/poni-core/src/look.rs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const NEW = (inner, style = '', cls = '') => `<div class="new ${cls}" style="${style}"><span class="newtag">NEW</span>${inner}</div>`;
export const PART = (inner, style = '', cls = '') => `<div class="part ${cls}" style="${style}"><span class="parttag">PARTIAL</span>${inner}</div>`;
export const bt = (g, k, label, on, cls = '') => `<button type="button" class="${cls}" data-g="${g}" data-k="${k}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
export const dp = (tokens, inner, style = '') => `<div data-p="${tokens}"${style ? ` style="${style}"` : ''}>${inner}</div>`;

/* ---- icons: real path data from island/crates/poni/src/icons.rs (24 grid, stroke 2, round caps) ---- */
const here = path.dirname(fileURLToPath(import.meta.url));
const iconsRs = fs.readFileSync(path.resolve(here, '../../../island/crates/poni/src/icons.rs'), 'utf8');
const consts = Object.fromEntries([...iconsRs.matchAll(/const (\w+): &str = "([^"]*)";/g)].map((m) => [m[1], m[2]]));
const realIcon = (name) => {
  const i = iconsRs.indexOf(`        ${name} => p![`);
  if (i < 0) throw new Error(`icon ${name} not in icons.rs`);
  const rest = iconsRs.slice(i + 8);
  const end = rest.search(/\n {8}[A-Z]\w* =>/);
  const body = rest.slice(0, end < 0 ? undefined : end);
  return [...body.matchAll(/\b([sf])\(\s*(?:"([^"]*)"|([A-Z_0-9]+))\s*\)/g)].map((m) => ({ k: m[1], d: m[2] ?? consts[m[3]] }));
};
// Drawn for this canvas, marked NEW where used (no call or pencil icon exists in icons.rs).
const OWN = {
  Call: [{ k: 's', d: 'M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A14.5 14.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z' }],
  Edit: [{ k: 's', d: 'M5 19l1-4 9.5-9.5 3 3L9 18z' }, { k: 's', d: 'M13.5 7.5l3 3' }],
  Caret: [{ k: 's', d: 'M7 10l5 5 5-5' }],
  Prev: [{ k: 'f', d: 'M11 6v12L3 12z' }, { k: 'f', d: 'M21 6v12l-8-6z' }],
  Next: [{ k: 'f', d: 'M13 6v12l8-6z' }, { k: 'f', d: 'M3 6v12l8-6z' }],
};
const cache = {};
export const ic = (name, size = 16, cls = '') => {
  const parts = OWN[name] || (cache[name] ||= realIcon(name));
  const inner = parts.map((p) => (p.k === 's' ? `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="${p.d}" fill="currentColor"/>`)).join('');
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
};

/** One pane rule per data-p token found in the html (driven by the pressed buttons). */
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

/* ===== board chrome (the canvas itself): Geist, navy notes, yellow NEW, amber PARTIAL ===== */
export const BOARD_CSS = `
:root{--white:#fff;--black:#000;--ground:#E7E9EF;--ground-2:#F3F4F8;--win:#fff;--side-2:#ECEEF4;--line:#E2E5EC;--line-2:#D3D7E1;--ink:#171B26;--muted-c:#545B6E;--navy:#212C5F;--navy-2:#2F3D80;--yellow:#FFC91B;--ok-c:#1E7B4E;--ok-soft:#E5F3EB;--warn-c:#8A5D00;--warn-ink:#5E3F00;--warn-soft:#FFF1D1;--amber:#C27A00;--sh-a:rgba(23,27,38,.5);--vw-shadow:rgba(23,27,38,.12);--sans:'Geist',system-ui,sans-serif;--monoc:'Geist Mono',ui-monospace,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--ground);font-family:var(--sans);color:var(--ink);font-size:13px;line-height:1.4}
.toc{display:flex;flex-wrap:wrap;gap:4px 14px;width:1640px;padding:12px 56px;background:var(--ground-2);border-bottom:1px solid var(--line-2);font-size:12.5px}
.toc a{color:var(--navy-2);text-decoration:none;padding:3px 0}.toc a:hover{text-decoration:underline}
main.cv{width:1640px;flex:none}
.cover,.board,.index{width:1640px;padding:52px 56px;border-bottom:1px solid var(--line-2)}
.cover h1{font-size:44px;margin:0 0 8px;letter-spacing:-1px}.cover p{color:var(--muted-c);max-width:960px;font-size:15px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}.tile{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:18px}.tile b{font-size:34px;display:block}
.legend{display:flex;gap:28px;align-items:center;margin:0 0 28px;flex-wrap:wrap}.lg{padding:6px 10px;border-radius:8px}.lgn{outline:2px solid var(--yellow)}.lgp{outline:2px dashed var(--amber)}
table.stt{width:100%;border-collapse:collapse;background:var(--win);border-radius:12px;overflow:hidden}table.stt td,table.stt th{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}table.stt th{font:600 10.5px var(--monoc);letter-spacing:.1em;color:var(--muted-c)}
table.stt a{color:var(--navy-2)}.cover h3{margin:28px 0 10px}
.hd{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}.ey{display:flex;gap:10px;align-items:center;font:500 11.5px/1 var(--monoc);letter-spacing:.08em;color:var(--muted-c)}
.tier{font:600 11px/1 var(--monoc);letter-spacing:.08em;padding:5px 9px;border-radius:99px;background:var(--navy);color:var(--white)}
.ttl{margin:0;font-size:38px;line-height:44px;font-weight:600;letter-spacing:-.8px}.ext{font-size:14px;color:var(--muted-c)}.ext b{color:var(--ink)}
.ixh{display:flex;gap:16px;align-items:center;margin-bottom:18px}
.vw{display:inline-flex;padding:2px;border-radius:8px;background:var(--side-2);gap:2px}
.vw button{height:28px;padding:0 14px;border:0;border-radius:6px;background:transparent;font:500 12.5px var(--sans);color:var(--muted-c);cursor:pointer}
.vw button[aria-pressed="true"]{background:var(--win);color:var(--ink);box-shadow:0 1px 2px var(--vw-shadow)}
.ixcap{font-size:12px;color:var(--muted-c);display:flex;gap:8px;align-items:center;margin:0 0 8px}
.vt{font:600 10.5px/1 var(--monoc);padding:4px 8px;border-radius:99px;background:var(--side-2);color:var(--muted-c)}
.ixi{display:block;max-width:100%;border:1px solid var(--line-2);border-radius:12px}
.stage{width:1528px}.gr2{display:grid;grid-template-columns:1fr 1fr;gap:34px 24px;align-items:start}.row2{display:grid;grid-template-columns:752px 1fr;gap:24px;align-items:start}
.grp{display:flex;flex-direction:column;gap:10px;min-width:0}.gl{font:600 11px/1 var(--monoc);letter-spacing:.1em;text-transform:uppercase;color:var(--muted-c)}
.bk{background:#CDD1DC;border-radius:14px;padding:22px 16px;display:flex;justify-content:center}.bk.dk{background:#0E0E10}.bk.wide{padding:22px 16px}
.nr{display:flex;flex-wrap:wrap;gap:10px}.nc{display:flex;flex-direction:column;gap:10px;padding-top:34px}
.note{max-width:360px;background:var(--navy);color:var(--white);font-size:12px;line-height:17px;padding:8px 11px;border-radius:8px;box-shadow:0 8px 20px -8px var(--sh-a)}.note b{color:var(--yellow);font-weight:600}.note.pn{border-left:4px solid var(--amber)}
.aside4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:30px}
.card{background:var(--win);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.lbl{font:600 10.5px/1.2 var(--monoc);letter-spacing:.12em;text-transform:uppercase;color:var(--muted-c)}
.must{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}.motion{display:flex;flex-direction:column;gap:7px;font-size:12.5px}.motion .m{display:flex;gap:8px}.motion .m span:first-child{font:600 11px var(--monoc);color:var(--navy-2);white-space:nowrap}
.st{display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--line);padding-top:8px}.sti{display:flex;align-items:center;gap:8px}.sid{font:600 11.5px var(--monoc)}
.src{font:600 10px/1 var(--monoc);padding:3px 6px;border-radius:5px;background:var(--side-2);color:var(--muted-c)}
.stat,.spill{margin-left:auto;font:600 10.5px/1 var(--monoc);padding:3px 7px;border-radius:99px}.stat.built,.spill.built{background:var(--ok-soft);color:var(--ok-c)}.stat.partial,.spill.partial{background:var(--warn-soft);color:var(--warn-c)}.stat.new,.spill.new{background:var(--navy);color:var(--white)}
.spill{margin-left:0}.gap{font-size:12px;color:var(--warn-c)}.gap b{color:var(--warn-ink)}.where{display:flex;flex-direction:column;gap:6px;font-size:12.5px}
.new:not(.stat):not(.spill){outline:2px solid var(--yellow);outline-offset:2px;border-radius:8px;position:relative}
.newtag{position:absolute;top:-10px;left:8px;background:var(--yellow);color:var(--navy);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:3px 6px;border-radius:99px;z-index:20}
.part>.parttag+.new>.newtag,.new>.newtag+.part>.parttag{left:84px}.part{outline:2px dashed var(--amber);outline-offset:2px;border-radius:8px;position:relative}
.parttag{position:absolute;top:-10px;left:8px;background:var(--warn-soft);color:var(--warn-c);border:1px solid var(--amber);font:700 9.5px/1 var(--monoc);letter-spacing:.1em;padding:2px 6px;border-radius:99px;z-index:20}
.kept{margin-top:18px;background:var(--win);border:1px solid var(--line);border-radius:14px;padding:14px 18px}.kept .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.kept .chips span{font-size:11.5px;padding:3px 9px;border-radius:99px;background:var(--side-2);color:var(--ink)}
.flow{display:flex;align-items:stretch;gap:0}.fb{background:var(--win);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:12.5px;display:flex;flex-direction:column;gap:5px}.fb b{font-size:13px}.fb small{color:var(--muted-c);font-size:11.5px}.fa{align-self:center;padding:0 8px;color:var(--muted-c);font:600 16px var(--monoc)}
.flow.col{flex-direction:column;gap:8px}
`;

/* ===== the pill (After and drawn Before) ===== */
export const PILL_CSS = `
.pl{--pg:#fff;--ink:#131B44;--tx:rgba(19,27,68,.96);--dim:rgba(19,27,68,.62);--faint:rgba(19,27,68,.5);--sf:rgba(19,27,68,.08);--sf2:rgba(19,27,68,.15);--trk:rgba(19,27,68,.16);--sel:rgba(19,27,68,.14);--acc:#212C5F;--gold:#FFC91B;--bd:#E0E2E9;--grn:#17744A;--ora:#D99A00;--orat:#7A5200;--red:#B02A1E;--blu:#1F5F9E;--cy:#0B6E83;--pur:#4A3C94;
  width:620px;flex:none;background:var(--pg);border:1px solid var(--bd);border-radius:40px;box-shadow:0 18px 40px -16px rgba(19,27,68,.45);font:13px/1.3 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;color:var(--tx);position:relative;overflow:hidden}
.pl *{box-sizing:border-box}.pl .ic{flex:none;display:block}
.pl .ph{height:50px;padding:6px 22px 0 16px;display:flex;align-items:center}
.pl .tb{width:30px;height:28px;display:grid;place-items:center;color:var(--dim);position:relative;flex:none}.pl .tb.menu{width:32px}
.pl .tb.on{width:auto;padding:0 12px 0 6px;display:flex;gap:2px;align-items:center;background:var(--sel);border-radius:14px;color:var(--tx);font-weight:600;font-size:13px;margin:0 2px 0 0}
.pl .ld{position:absolute;right:3px;top:3px;width:7px;height:7px;border-radius:50%;background:var(--red);box-shadow:0 0 0 2px var(--pg)}.pl .tb.on .ld{right:auto;left:20px}
.pl .ghost{width:30px;height:28px;border:1px dashed var(--faint);border-radius:14px;flex:none;position:relative}
.pl .clk{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;font-size:13px;padding-left:6px}
.pl .pb{position:relative;padding:0 22px 18px 18px}
.pl .gd{height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 4px;font-size:11px;color:var(--faint)}.pl .gd span.o{color:var(--acc);font-weight:600}.pl .gd i{font-style:normal;margin-left:10px}
.pl .cap{font-size:11px;color:var(--faint);letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.pl .btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:14px;background:var(--sf);font-size:12px;font-weight:600;white-space:nowrap;flex:none}
.pl .btn.pri{background:var(--acc);color:#fff}.pl .btn.org{background:var(--ora);color:#1b1300}.pl .btn.util{background:transparent;box-shadow:inset 0 0 0 1px var(--bd);color:var(--dim)}.pl .btn.on{background:var(--acc);color:#fff}.pl .btn.sq{width:28px;padding:0;justify-content:center}.pl .btn.rd{color:var(--red)}
.pl .dot{width:8px;height:8px;border-radius:50%;background:var(--grn);flex:none}.pl .dot.o{background:var(--ora)}.pl .dot.r{background:var(--red)}.pl .dot.f{background:var(--faint)}
.pl .dim{color:var(--dim)}.pl .fa{color:var(--faint)}
/* media page */
.pl .mp{height:148px;display:flex;gap:20px}.pl .mblk{width:319px;position:relative;flex:none}.pl .mcol{width:245px;flex:none;position:relative}
.pl .art{position:absolute;left:0;top:0;width:72px;height:72px;border-radius:14px;background:linear-gradient(140deg,#9db7d3,#e6ddd0 55%,#7d8aa6);display:grid;place-items:center;font:700 8.5px/1.1 sans-serif;color:#34405e;text-align:center;overflow:hidden}.pl .art.m{background:linear-gradient(140deg,#c98f77,#f0c9a3 55%,#8c5a78)}
.pl .mt{position:absolute;left:86px;top:8px;right:0}.pl .mt .t{font-size:18px;font-weight:600;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:6px}.pl .mt .a{font-size:15px;color:var(--dim);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pl .eq{position:absolute;right:2px;top:7px;display:flex;gap:2px;align-items:center;height:16px}.pl .eq i{width:4px;border-radius:2px;background:var(--orat);opacity:.8}
.pl .pr{position:absolute;left:0;right:0;top:80px;height:20px;display:flex;align-items:center;gap:14px;font-size:12px;color:var(--dim);font-weight:600;font-variant-numeric:tabular-nums}.pl .pr .bar{flex:1;height:5px;border-radius:3px;background:var(--trk);position:relative}.pl .pr .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--acc)}
.pl .ctl{position:absolute;left:0;right:0;top:112px;height:30px;display:flex;justify-content:center;align-items:center;gap:40px;color:var(--faint)}.pl .ctl .pz{display:flex;gap:5px}.pl .ctl .pz i{width:7px;height:24px;border-radius:2px;background:var(--acc)}
.pl .ctl.l .pz i:last-child{display:none}.pl .ctl.l .pl2{width:0;height:0;border-left:19px solid var(--acc);border-top:12px solid transparent;border-bottom:12px solid transparent}
.pl .lyr .cw{margin-top:10px}.pl .lyr{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;text-align:center;color:var(--dim);font-size:12.5px}
.pl .syn{height:100%;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:0 4px}.pl .syn .l1{font-size:13px;color:var(--faint)}.pl .syn .l2{font-size:16px;font-weight:600}.pl .syn .l3{font-size:13px;color:var(--cy)}.pl .syn .l4{font-size:13px;color:var(--faint)}
/* caption column and live */
.pl .cc{height:100%;display:flex;flex-direction:column;gap:5px;padding:2px 2px 0}.pl .cc .top{display:flex;align-items:center;gap:6px;height:28px}.pl .cc .top .s{font-size:11px;color:var(--faint);font-weight:600;letter-spacing:.05em;text-transform:uppercase;display:flex;align-items:center;gap:5px}.pl .cc .top .btn{margin-left:auto}
.pl .cc .p{font-size:12px;color:var(--faint);line-height:16px;height:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.pl .cc .c{font-size:15px;font-weight:600;line-height:19px}.pl .cc .tr{font-size:13px;color:var(--cy);line-height:17px}
.pl .lv{height:168px;position:relative}.pl .lh{height:34px;display:flex;align-items:center;gap:8px}.pl .lh .t{font-size:12px;font-weight:600;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pl .lh .t b{color:var(--tx);font-weight:600}.pl .lh .r{margin-left:auto;display:flex;gap:8px}
.pl .lines{padding:4px 4px 0;display:flex;flex-direction:column;gap:5px}.pl .lines .p{font-size:12px;color:var(--faint);height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.pl .lines .c{font-size:15px;font-weight:600;line-height:20px}.pl .lines .tr{font-size:13px;color:var(--cy);line-height:17px}
.pl .lv .ft{position:absolute;left:4px;right:4px;bottom:4px;display:flex;justify-content:space-between;font-size:11px;color:var(--dim)}
/* quick strip */
.pl .qs{height:34px;display:flex;align-items:center;gap:5px;padding:0 4px;margin-top:2px;border-top:1px solid var(--bd);padding-top:6px;height:40px}
.pl .chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 3px 0 8px;border-radius:14px;background:var(--sf);font-size:11.5px;font-weight:600;white-space:nowrap;flex:none}.pl .chip .k{color:var(--dim);font-weight:600}
.pl .chip .sw{width:22px;height:13px;border-radius:7px;background:var(--trk);position:relative}.pl .chip .sw::after{content:"";position:absolute;top:2px;left:2px;width:9px;height:9px;border-radius:50%;background:#fff}.pl .chip .sw.on{background:var(--grn)}.pl .chip .sw.on::after{left:11px}
.pl .chip .stp{width:19px;height:19px;border-radius:50%;background:var(--sf2);display:grid;place-items:center;color:var(--tx)}.pl .chip .nm{padding:0 2px;display:flex;align-items:center;gap:3px;color:var(--tx)}.pl .chip.arrow{padding-left:7px}
.pl .chip.sel{box-shadow:inset 0 0 0 2px var(--acc)}
.pl .lgrid{position:absolute;left:18px;right:22px;top:76px;bottom:12px;background:var(--pg);border-radius:20px;box-shadow:0 8px 24px -8px rgba(19,27,68,.5),inset 0 0 0 1px var(--bd);padding:10px 12px;z-index:5;display:flex;flex-direction:column;gap:8px}
.pl .lgrid .h{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);font-weight:600;letter-spacing:.05em;text-transform:uppercase}.pl .lgrid .g{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 8px}
.pl .lgrid .g span{height:22px;border-radius:11px;padding:0 9px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;background:var(--sf)}.pl .lgrid .g span.cur{background:var(--acc);color:#fff}
/* meeting page */
.pl .lnk{display:flex;align-items:center;gap:8px;width:320px;height:34px;border:1px solid var(--bd);border-radius:17px;padding:0 3px 0 14px;background:#fff}.pl .lnk .in{flex:1;text-align:left;color:var(--faint);font-size:12.5px}.pl .ask{display:flex;align-items:center;gap:8px;min-height:36px;margin:4px 0;padding:4px 8px 4px 12px;border-radius:18px;background:var(--sf);font-size:12.5px}.pl .ask>span:first-child{flex:1;color:var(--dim)}.pl .mt3{height:366px}.pl .mh{height:34px;display:flex;align-items:center;gap:8px}.pl .mh .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pl .mh .src{font-size:11px;font-weight:600;color:var(--dim);background:var(--sf);border-radius:10px;padding:2px 8px}.pl .mh .tm{font-weight:600;font-variant-numeric:tabular-nums;color:var(--red);display:flex;align-items:center;gap:5px}.pl .mh .r{margin-left:auto;display:flex;gap:8px;align-items:center}
.pl .cols{display:flex;gap:18px;height:324px;margin-top:2px}.pl .cl{width:236px;flex:none;border-right:1px solid var(--bd);padding-right:14px;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding-bottom:6px}.pl .cl .p{font-size:12px;color:var(--dim);line-height:16px}.pl .cl .pt{font-size:11px;color:var(--dim);line-height:15px;margin-bottom:4px}.pl .cl .c{font-size:15px;font-weight:600;line-height:19px}.pl .cl .tr{font-size:13px;color:var(--cy);line-height:17px}
.pl .nt{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;position:relative}.pl .nt .nh{display:flex;align-items:center;gap:8px;height:22px}.pl .nt .nh .ai{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--pur);background:rgba(74,60,148,.12);border-radius:8px;padding:1px 7px}.pl .nt .nh .up{margin-left:auto;font-size:11px;color:var(--faint)}
.pl .ns{display:flex;flex-direction:column;gap:3px}.pl .ns .k{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}.pl .ns .k.d{color:var(--blu)}.pl .ns .k.a{color:var(--grn)}.pl .ns .k.q{color:var(--pur)}.pl .ns .k.s{color:var(--dim)}
.pl .it{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:16px;min-height:18px}.pl .it .tx{flex:1;min-width:0}.pl .it .ow{font-size:11px;font-weight:600;color:var(--grn);background:rgba(23,116,74,.12);border-radius:8px;padding:0 6px;white-space:nowrap}.pl .it .kp{font-size:10.5px;font-weight:700;color:var(--grn)}
.pl .it .ac{display:flex;gap:3px;flex:none}.pl .it .ac span{width:20px;height:18px;border-radius:9px;background:var(--sf2);display:grid;place-items:center;color:var(--tx)}.pl .it.sel{background:var(--sf);border-radius:8px;padding:2px 4px;margin:0 -4px}
.pl .sk{height:10px;border-radius:5px;background:linear-gradient(90deg,var(--sf),var(--sf2),var(--sf))}
.pl .pa{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:auto;padding-top:4px}
.pl .warn{display:flex;align-items:center;gap:8px;background:rgba(217,154,0,.16);color:var(--orat);border-radius:10px;padding:7px 10px;font-size:12px;font-weight:600}
.pl .emp{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center}.pl .emp b{font-size:15px}.pl .emp span{color:var(--dim);font-size:12.5px;max-width:300px}.pl .emp .r{display:flex;gap:8px}
.pl .sv{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:10px;text-align:center}.pl .sv .ok{width:40px;height:40px;border-radius:50%;background:rgba(23,116,74,.14);color:var(--grn);display:grid;place-items:center}.pl .sv b{font-size:16px}.pl .sv .m{font-size:12.5px;color:var(--dim);max-width:360px}.pl .sv .r{display:flex;gap:8px;margin-top:10px}
.pl .hist{display:flex;flex-direction:column}.pl .hr{display:flex;align-items:center;gap:10px;height:36px;border-bottom:1px solid var(--bd);font-size:12.5px}.pl .hr .ty{font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:9px;background:var(--sf);color:var(--dim)}.pl .hr .ty.v{background:rgba(31,95,158,.12);color:var(--blu)}.pl .hr .tx{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* captions on pop-up */
.pop{width:var(--pw,372px);height:48px;border-radius:24px;background:#fff;border:1px solid #E0E2E9;box-shadow:0 14px 30px -12px rgba(19,27,68,.5);display:flex;align-items:center;gap:10px;padding:0 8px 0 8px;font:13px/1.25 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;color:rgba(19,27,68,.96);--acc:#212C5F;--dim:rgba(19,27,68,.62);--sf:rgba(19,27,68,.08);--bd:#E0E2E9;--cy:#0B6E83}
.pop *{box-sizing:border-box}.pop .disc{width:32px;height:32px;border-radius:50%;background:var(--acc);color:#fff;display:grid;place-items:center;flex:none}.pop .tt{display:flex;flex-direction:column;min-width:0}.pop .tt b{font-size:13px;white-space:nowrap}.pop .tt small{font-size:12px;color:var(--dim);white-space:nowrap}
.pop .btn{display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:14px;box-shadow:inset 0 0 0 1px var(--bd);font-size:12px;font-weight:600;color:var(--dim);margin-left:auto;white-space:nowrap;flex:none}
.pop .lp{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px;border-radius:12px;background:var(--sf);font-size:11.5px;font-weight:600;white-space:nowrap;flex:none}.pop .lp.x{background:rgba(11,110,131,.12);color:var(--cy)}.pop .ar{color:var(--dim);font-weight:600;flex:none}
.pop .ic{display:block}
/* settings window, dark (the real one is dark) */
.sw2{width:840px;flex:none;background:#1c1c1e;border:1px solid #38383b;border-radius:12px;display:flex;font:14px/1.3 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;color:#fff;overflow:hidden;position:relative}
.sw2 *{box-sizing:border-box}.sw2 .rl{width:220px;flex:none;background:#202023;border-right:1px solid #38383b;padding:14px 10px;display:flex;flex-direction:column;gap:2px}.sw2 .rl .ti{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;padding:2px 8px 12px}.sw2 .rl .lg{width:22px;height:22px;border-radius:6px;background:#3a3a3d}
.sw2 .ri{display:flex;align-items:center;gap:10px;height:32px;padding:0 8px;border-radius:8px;color:#e6e6e8;position:relative}.sw2 .ri.on{background:#3a3a3d}.sw2 .ri .tl{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;flex:none}.sw2 .ri .tl svg{width:12px;height:12px}.sw2 .ri.push{margin-top:auto}
.sw2 .ct{flex:1;padding:22px 26px 26px;display:flex;flex-direction:column;gap:6px;min-width:0}.sw2 .ct h1{font-size:22px;margin:0 0 8px;font-weight:700}.sw2 .ct h4{margin:10px 0 2px 2px;font-size:12.5px;font-weight:600;color:#a0a0a5}
.sw2 .gp{background:#2a2a2d;border-radius:10px;display:flex;flex-direction:column}.sw2 .rw{display:flex;align-items:center;gap:14px;padding:9px 14px;border-bottom:1px solid #3a3a3e}.sw2 .rw:last-child{border-bottom:0}.sw2 .rw .tx{flex:1;min-width:0}.sw2 .rw b{display:block;font-weight:500;font-size:13.5px}.sw2 .rw small{display:block;color:#a8a8ad;font-size:11.5px;margin-top:1px}
.sw2 .sw{width:34px;height:20px;border-radius:10px;background:#59595d;position:relative;flex:none}.sw2 .sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff}.sw2 .sw.on{background:#F2745A}.sw2 .sw.on::after{left:16px}
.sw2 .stp{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px}.sw2 .stp i{width:24px;height:24px;border-radius:50%;background:#3d3d41;display:grid;place-items:center;font-style:normal}
.sw2 .rw.sub{padding-left:34px}
.sw2 .rmv{font-size:12px;color:#e6e6e8;background:#3d3d41;border-radius:12px;padding:3px 11px;flex:none}.sw2 .rw.add b{color:#F2745A}.sw2 .btn2,.dlg .btn2{font-size:13px;font-weight:600;color:#fff;background:#3d3d41;border-radius:8px;padding:5px 14px;flex:none}.btn2.pri{background:#F2745A;color:#1c1c1e}
.dlg{width:410px;background:#2a2a2d;border:1px solid #38383b;border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;font:14px/1.3 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;color:#fff;box-sizing:border-box}.dlg *{box-sizing:border-box}.dlg>b{font-size:15px}.dlg small{color:#a8a8ad;font-size:12px}.dlg small b{color:#fff}.dlg .sg{display:flex;background:#1c1c1e;border-radius:8px;padding:3px}.dlg .sg span{flex:1;text-align:center;padding:5px 0;border-radius:6px;font-size:13px;color:#a8a8ad}.dlg .sg .on{background:#3d3d41;color:#fff}.dlg .fld{background:#1c1c1e;border:1px solid #59595d;border-radius:8px;padding:8px 10px;font-size:13px;color:#e6e6e8}.dlg .ap{display:flex;justify-content:space-between;align-items:center;background:#1c1c1e;border-radius:8px;padding:8px 10px;font-size:13px}.dlg .ap i{font-style:normal;color:#F2745A;font-size:12px}.dlg .ap.dis{opacity:.55}.dlg .ap.dis i{color:#a8a8ad}.dlg .ft{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.sw2 .tabrow{display:flex;align-items:center;gap:12px}
`;

// Moves raw colour literals out of declarations into named custom properties
// (product-replica pixels live in :root, not in each rule). Used on the final markup.
export const tokenize = (html) => {
  const defs = new Map();
  const nameOf = (lit) => {
    const key = lit.toLowerCase().replace(/\s+/g, '');
    const n = '--k-' + key.replace(/^#/, 'h').replace(/^rgba?\(/, 'c').replace(/[(),.]/g, (c) => (c === '.' ? 'p' : '-')).replace(/-+$/, '');
    defs.set(n, lit);
    return `var(${n})`;
  };
  const out = html.replace(/(^|[{;"'\s])((?:color|background(?:-color)?|border(?:-(?:top|bottom|left|right))?(?:-color)?|fill|stroke|box-shadow))(\s*:\s*)([^;}"]*)/g, (m, pre, prop, colon, val) => {
    if (!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(val)) return m;
    return pre + prop + colon + val.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, nameOf);
  });
  const root = ':root{' + [...defs].map(([k, v]) => `${k}:${v}`).join(';') + '}';
  return out.replace('<style>', '<style>' + root);
};
