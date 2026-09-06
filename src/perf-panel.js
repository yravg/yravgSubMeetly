/**
 * Tab Performance (child tab dari Captions) — analitik kecepatan ASR/terjemahan
 * per bahasa dan per mesin (helper native mac/win/linux, browser WebGPU, browser
 * WASM). Bisa "diapungkan" sebagai jendela yang digeser, diekspor sebagai laporan
 * JSON/Markdown untuk dibagikan, dan mengimpor laporan/bench dari mesin lain.
 *
 * Data: sampel `perf-sample` dari offscreen (disimpan background di
 * chrome.storage.local `perfSamples`) + impor `scripts/bench-lab.py`.
 * Chart: src/lib/perf-charts.js (SVG murni). Agregasi: src/lib/perf-log.js.
 */
import {
  PERF_KEY, SERIES, STAGES, normalizeAll, filterSamples, summarize, groupBy, pairLabel,
  p50ByPair, scatterPoints, lineSeries, fromBenchJson, toReport, fromReport, toMarkdown,
} from './lib/perf-log.js';
import { barChart, scatterChart, lineChart, legend } from './lib/perf-charts.js';

const STR = {
  title: { en: 'Performance', id: 'Kinerja' },
  sub: { en: 'How fast recognition and translation run on this machine, per language and per engine. Export a report to compare platforms.', id: 'Seberapa cepat pengenalan dan terjemahan berjalan di mesin ini, per bahasa dan per mesin. Ekspor laporan untuk membandingkan platform.' },
  stage: { en: 'Stage', id: 'Tahap' }, all: { en: 'All', id: 'Semua' },
  pair: { en: 'Language pair', id: 'Pasangan bahasa' }, source: { en: 'Source', id: 'Sumber' },
  session: { en: 'This device', id: 'Perangkat ini' }, bench: { en: 'Lab bench', id: 'Bench lab' }, import: { en: 'Imported', id: 'Impor' },
  kpiAsr: { en: 'ASR p50', id: 'ASR p50' }, kpiMt: { en: 'MT p50', id: 'MT p50' }, kpiRtf: { en: 'RTF (p50)', id: 'RTF (p50)' }, kpiN: { en: 'Samples', id: 'Sampel' },
  rtfHint: { en: 'processing time ÷ audio time; < 1 is faster than realtime', id: 'waktu proses ÷ durasi audio; < 1 lebih cepat dari realtime' },
  chartPair: { en: 'p50 latency per language pair', id: 'Latensi p50 per pasangan bahasa' },
  chartScatter: { en: 'Latency vs audio length', id: 'Latensi vs durasi audio' },
  chartLine: { en: 'Latency over samples', id: 'Latensi sepanjang sampel' },
  table: { en: 'Table', id: 'Tabel' }, charts: { en: 'Charts', id: 'Grafik' },
  float: { en: 'Float', id: 'Apungkan' }, dock: { en: 'Dock', id: 'Tambatkan' },
  exportJson: { en: 'Export report (JSON)', id: 'Ekspor laporan (JSON)' }, exportMd: { en: 'Export (Markdown)', id: 'Ekspor (Markdown)' },
  importJson: { en: 'Import report / bench JSON', id: 'Impor laporan / bench JSON' }, loadBench: { en: 'Load lab bench', id: 'Muat bench lab' },
  clear: { en: 'Clear device samples', id: 'Hapus sampel perangkat' },
  empty: { en: 'No samples yet. Run a live session or an offline file — every recognition and translation step is timed automatically.', id: 'Belum ada sampel. Jalankan sesi langsung atau berkas offline — tiap langkah pengenalan dan terjemahan diukur otomatis.' },
  imported: { en: (n) => `${n} samples imported`, id: (n) => `${n} sampel diimpor` },
  cleared: { en: 'Device samples cleared', id: 'Sampel perangkat dihapus' },
  hEngine: { en: 'Engine', id: 'Mesin' }, hStage: { en: 'Stage', id: 'Tahap' }, hPair: { en: 'Pair', id: 'Pasangan' }, hN: 'n', hP50: 'p50', hP95: 'p95', hRtf: 'RTF', hPlatform: { en: 'Platform', id: 'Platform' },
};
const pick = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.en : v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtMs = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

function storage() {
  if (globalThis.chrome?.storage?.local) {
    return {
      async get() { const o = await chrome.storage.local.get(PERF_KEY); return o?.[PERF_KEY] || []; },
      async set(v) { await chrome.storage.local.set({ [PERF_KEY]: v }); },
    };
  }
  return {
    async get() { try { return JSON.parse(localStorage.getItem(PERF_KEY) || '[]'); } catch { return []; } },
    async set(v) { try { localStorage.setItem(PERF_KEY, JSON.stringify(v)); } catch { /* kuota */ } },
  };
}

/**
 * @param {HTMLElement} root       kontainer (#view-perf)
 * @param {{ lang: () => string, toast?: (m:string)=>void, download?: (name:string, text:string, mime:string)=>void }} ctx
 */
export function mountPerfPanel(root, ctx) {
  const tx = (k, ...a) => { const v = pick(STR[k], ctx.lang()); return typeof v === 'function' ? v(...a) : v; };
  const store = storage();
  const ui = { samples: [], extra: [], filter: { stage: 'all', series: new Set(), pair: 'all', source: 'all' }, view: 'charts', floating: false, pos: null };
  let win = null; // jendela mengapung
  let tip = null;

  const all = () => normalizeAll([...ui.samples, ...ui.extra]);
  const shown = () => filterSamples(all(), ui.filter);

  async function load() {
    ui.samples = await store.get();
    try { ui.pos = JSON.parse(localStorage.getItem('perfFloatPos') || 'null'); } catch { ui.pos = null; }
  }

  function download(name, text, mime) {
    if (ctx.download) return ctx.download(name, text, mime);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function kpi(label, value, hint = '') {
    return `<div class="perf-kpi" title="${esc(hint)}"><span class="perf-kpi-v">${esc(value)}</span><span class="perf-kpi-l">${esc(label)}</span></div>`;
  }

  function render() {
    const lang = ctx.lang();
    const host = ui.floating && win ? win.querySelector('.perf-win-body') : root;
    if (!host) return;
    const data = shown();
    const asr = summarize(data.filter((s) => s.stage === 'asr'));
    const mt = summarize(data.filter((s) => s.stage === 'mt' || s.stage === 'refine'));
    const rtf = summarize(data.filter((s) => s.stage === 'asr' || s.stage === 'draft')).rtf;
    const pairs = [...new Set(all().map(pairLabel))].sort();
    const seriesPresent = SERIES.filter((s) => data.some((x) => x.series === s.id));

    host.innerHTML = `
      <div class="perf-head">
        <div><h2 class="perf-title">📈 ${esc(tx('title'))}</h2><p class="perf-sub">${esc(tx('sub'))}</p></div>
        <div class="perf-actions">
          <button type="button" class="mini-btn" data-act="view">${esc(ui.view === 'charts' ? tx('table') : tx('charts'))}</button>
          <button type="button" class="mini-btn" data-act="float">${esc(ui.floating ? tx('dock') : tx('float'))}</button>
        </div>
      </div>
      <div class="perf-filters" role="group">
        <label>${esc(tx('stage'))}<select data-f="stage">${['all', ...STAGES].map((s) => `<option value="${s}"${ui.filter.stage === s ? ' selected' : ''}>${s === 'all' ? esc(tx('all')) : s}</option>`).join('')}</select></label>
        <label>${esc(tx('pair'))}<select data-f="pair"><option value="all"${ui.filter.pair === 'all' ? ' selected' : ''}>${esc(tx('all'))}</option>${pairs.map((p) => `<option value="${esc(p)}"${ui.filter.pair === p ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
        <label>${esc(tx('source'))}<select data-f="source">${['all', 'session', 'bench', 'import'].map((s) => `<option value="${s}"${ui.filter.source === s ? ' selected' : ''}>${esc(s === 'all' ? tx('all') : tx(s))}</option>`).join('')}</select></label>
        <div class="perf-series">${SERIES.map((s, i) => `<button type="button" class="perf-chip${ui.filter.series.size && !ui.filter.series.has(s.id) ? ' off' : ''}" data-series="${s.id}" aria-pressed="${!ui.filter.series.size || ui.filter.series.has(s.id)}"><i class="viz-s${i + 1}"></i>${esc(pick(s.label, lang))}</button>`).join('')}</div>
      </div>
      ${data.length ? `
      <div class="perf-kpis">${kpi(tx('kpiAsr'), fmtMs(asr.p50))}${kpi(tx('kpiMt'), fmtMs(mt.p50))}${kpi(tx('kpiRtf'), rtf == null ? '—' : rtf.toFixed(2), tx('rtfHint'))}${kpi(tx('kpiN'), String(data.length))}</div>
      ${ui.view === 'charts' ? `
        <section class="perf-chart"><h3>${esc(tx('chartPair'))}</h3>${barChart({ rows: p50ByPair(data), target: 500, lang })}</section>
        <section class="perf-chart"><h3>${esc(tx('chartScatter'))}</h3>${seriesPresent.length > 1 ? legend(seriesPresent, SERIES, lang) : ''}${scatterChart({ points: scatterPoints(data), series: SERIES, lang })}</section>
        <section class="perf-chart"><h3>${esc(tx('chartLine'))}</h3>${seriesPresent.length > 1 ? legend(seriesPresent, SERIES, lang) : ''}${lineChart({ series: lineSeries(data), order: SERIES })}</section>`
      : `<div class="perf-table-wrap"><table class="perf-table"><thead><tr><th>${esc(tx('hEngine'))}</th><th>${esc(tx('hPlatform'))}</th><th>${esc(tx('hStage'))}</th><th>${esc(tx('hPair'))}</th><th>n</th><th>p50</th><th>p95</th><th>RTF</th></tr></thead><tbody>${
          [...groupBy(data, (s) => [s.series, s.platform, s.stage, pairLabel(s)].join('|')).entries()].map(([k, list]) => { const [ser, plat, st, pr] = k.split('|'); const sm = summarize(list); return `<tr><td>${esc(pick(SERIES.find((x) => x.id === ser)?.label, lang) || ser)}</td><td>${esc(plat)}</td><td>${esc(st)}</td><td>${esc(pr)}</td><td>${sm.n}</td><td>${Math.round(sm.p50)}</td><td>${Math.round(sm.p95)}</td><td>${sm.rtf ?? '—'}</td></tr>`; }).join('')
        }</tbody></table></div>`}`
      : `<p class="perf-empty">${esc(tx('empty'))}</p>`}
      <div class="perf-foot">
        <button type="button" class="mini-btn" data-act="export-json"${data.length ? '' : ' disabled'}>${esc(tx('exportJson'))}</button>
        <button type="button" class="mini-btn" data-act="export-md"${data.length ? '' : ' disabled'}>${esc(tx('exportMd'))}</button>
        <label class="mini-btn perf-import">${esc(tx('importJson'))}<input type="file" accept="application/json,.json" hidden data-act="import"></label>
        <button type="button" class="mini-btn" data-act="load-bench">${esc(tx('loadBench'))}</button>
        <button type="button" class="mini-btn" data-act="clear"${ui.samples.length ? '' : ' disabled'}>${esc(tx('clear'))}</button>
      </div>
      <div class="perf-tip" hidden></div>`;
    wire(host);
  }

  function wire(host) {
    host.querySelectorAll('select[data-f]').forEach((sel) => sel.addEventListener('change', () => { ui.filter[sel.dataset.f] = sel.value; render(); }));
    host.querySelectorAll('[data-series]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.series;
      if (ui.filter.series.has(id)) ui.filter.series.delete(id); else ui.filter.series.add(id);
      if (ui.filter.series.size === SERIES.length) ui.filter.series.clear();
      render();
    }));
    host.querySelector('[data-act="view"]')?.addEventListener('click', () => { ui.view = ui.view === 'charts' ? 'table' : 'charts'; render(); });
    host.querySelector('[data-act="float"]')?.addEventListener('click', () => (ui.floating ? dock() : float()));
    host.querySelector('[data-act="export-json"]')?.addEventListener('click', () => {
      const rep = toReport(shown(), { platform: shown()[0]?.platform });
      download(`yraveragesub-performance-${rep.generatedAt.slice(0, 10)}.json`, JSON.stringify(rep, null, 2), 'application/json');
    });
    host.querySelector('[data-act="export-md"]')?.addEventListener('click', () => {
      const rep = toReport(shown(), { platform: shown()[0]?.platform });
      download(`yraveragesub-performance-${rep.generatedAt.slice(0, 10)}.md`, toMarkdown(rep), 'text/markdown');
    });
    host.querySelector('[data-act="import"]')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try {
        const json = JSON.parse(await f.text());
        const added = json.version === 1 ? fromReport(json) : fromBenchJson(json);
        ui.extra.push(...added);
        ctx.toast?.(tx('imported', added.length));
      } catch (err) { ctx.toast?.(String(err?.message || err)); }
      render();
    });
    host.querySelector('[data-act="load-bench"]')?.addEventListener('click', async () => {
      // Hanya bermakna di lab (127.0.0.1:8799 menyajikan test/); di ekstensi tidak ada berkas itu.
      try {
        const r = await fetch('/last-bench.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const added = fromBenchJson(await r.json(), { platform: 'macos' });
        ui.extra = ui.extra.filter((s) => s.source !== 'bench').concat(added);
        ctx.toast?.(tx('imported', added.length));
      } catch (err) { ctx.toast?.(`bench: ${err?.message || err}`); }
      render();
    });
    host.querySelector('[data-act="clear"]')?.addEventListener('click', async () => {
      ui.samples = []; await store.set([]); ctx.toast?.(tx('cleared')); render();
    });
    // Tooltip: satu elemen, mengikuti mark yang punya data-tip.
    tip = host.querySelector('.perf-tip');
    host.querySelectorAll('.viz-hit').forEach((h) => {
      h.addEventListener('pointerenter', (e) => { tip.textContent = h.dataset.tip; tip.hidden = false; place(e); });
      h.addEventListener('pointermove', place);
      h.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
  }
  function place(e) {
    if (!tip) return;
    const r = tip.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 200)}px`;
    tip.style.top = `${e.clientY - r.top + 12}px`;
  }

  /* ---------------- jendela mengapung ---------------- */
  function float() {
    if (win) return;
    win = document.createElement('div');
    win.className = 'perf-win';
    win.innerHTML = `<div class="perf-win-head"><span>📈 ${esc(tx('title'))}</span><span class="spacer"></span><button type="button" class="mini-btn" data-act="dock">${esc(tx('dock'))}</button></div><div class="perf-win-body"></div>`;
    document.body.appendChild(win);
    const p = ui.pos || { x: Math.max(8, window.innerWidth - 640), y: 60 };
    win.style.left = `${p.x}px`; win.style.top = `${p.y}px`;
    win.querySelector('[data-act="dock"]').addEventListener('click', dock);
    // Geser lewat kepala jendela; posisi diingat.
    const head = win.querySelector('.perf-win-head');
    let drag = null;
    head.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop }; head.setPointerCapture(e.pointerId); });
    head.addEventListener('pointermove', (e) => { if (!drag) return; win.style.left = `${Math.max(0, e.clientX - drag.dx)}px`; win.style.top = `${Math.max(0, e.clientY - drag.dy)}px`; });
    head.addEventListener('pointerup', () => { if (!drag) return; drag = null; ui.pos = { x: win.offsetLeft, y: win.offsetTop }; try { localStorage.setItem('perfFloatPos', JSON.stringify(ui.pos)); } catch { /* opsional */ } });
    ui.floating = true;
    root.innerHTML = `<p class="perf-empty">${esc(tx('title'))} → ${esc(tx('float'))}</p>`;
    render();
  }
  function dock() {
    ui.floating = false;
    win?.remove(); win = null;
    render();
  }

  /** Dipanggil side panel saat pesan `perf-sample` datang. */
  function push(sample) {
    ui.samples.push(sample);
    if (ui.samples.length > 3000) ui.samples.splice(0, ui.samples.length - 3000);
    if (!root.classList.contains('hidden') || ui.floating) render();
  }

  load().then(render);
  return { render, push, float, dock, reload: () => load().then(render) };
}
