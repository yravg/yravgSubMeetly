/**
 * Log kinerja ASR/MT — murni, tanpa DOM.
 *
 * Sampel datang dari offscreen (`perf-sample`) per tahap: asr, asr-partial, mt,
 * mt-partial, draft, refine. Modul ini menormalkan, mengelompokkan (per seri
 * mesin, pasangan bahasa, platform), menghitung p50/p95/RTF, mengimpor hasil
 * bench-lab (`test/last-bench.json`), dan menyusun laporan yang bisa dibagikan
 * pengguna (JSON untuk diimpor mesin lain, Markdown untuk dibaca).
 *
 * Seri kategorikal dibatasi TIGA (batas scatter/all-pairs pada panduan dataviz):
 * native, browser-webgpu, browser-wasm. Translator bawaan Chrome dicatat pada
 * perangkat `chrome-translator` dan tampil sebagai filter/tabel, bukan seri ke-4.
 */

export const PERF_KEY = 'perfSamples';
export const PERF_MAX = 3000;
export const STAGES = /** @type {const} */ (['asr', 'asr-partial', 'mt', 'mt-partial', 'draft', 'refine']);

/** Urutan seri TETAP — warna mengikuti entitas, bukan peringkat. */
export const SERIES = /** @type {const} */ ([
  { id: 'native', label: { en: 'Native helper', id: 'Helper native' }, cssVar: '--viz-1' },
  { id: 'browser-webgpu', label: { en: 'Browser · WebGPU', id: 'Browser · WebGPU' }, cssVar: '--viz-2' },
  { id: 'browser-wasm', label: { en: 'Browser · WASM', id: 'Browser · WASM' }, cssVar: '--viz-3' },
]);

const num = (v, d = null) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v) => (v == null ? null : String(v));

export function seriesOf(s) {
  if (s.engine === 'native') return 'native';
  return String(s.device || '').toLowerCase() === 'webgpu' ? 'browser-webgpu' : 'browser-wasm';
}

export function normalizeSample(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ms = num(raw.ms);
  const stage = STAGES.includes(raw.stage) ? raw.stage : null;
  if (ms == null || ms < 0 || !stage) return null;
  const out = {
    at: str(raw.at) || new Date(0).toISOString(),
    stage,
    ms: Math.round(ms),
    engine: raw.engine === 'native' ? 'native' : 'browser',
    device: str(raw.device) || 'wasm',
    platform: ['macos', 'windows', 'linux'].includes(raw.platform) ? raw.platform : 'unknown',
    src: str(raw.src),
    tgt: str(raw.tgt),
    audioSec: num(raw.audioSec),
    chars: num(raw.chars),
    mode: raw.mode === 'offline' || raw.mode === 'bench' ? raw.mode : 'realtime',
    source: raw.source === 'bench' || raw.source === 'import' ? raw.source : 'session',
  };
  out.series = seriesOf(out);
  return out;
}

export function normalizeAll(list) {
  return (Array.isArray(list) ? list : []).map(normalizeSample).filter(Boolean);
}

export function pairLabel(s) {
  if (!s.src) return '—';
  return s.tgt && s.tgt !== s.src ? `${s.src}→${s.tgt}` : s.src;
}

export function quantile(values, q) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Ringkasan satu kelompok sampel. RTF = ms / (audioSec·1000), hanya untuk tahap ASR/draft. */
export function summarize(samples) {
  const ms = samples.map((s) => s.ms);
  const withAudio = samples.filter((s) => s.audioSec > 0 && (s.stage.startsWith('asr') || s.stage === 'draft'));
  const rtf = withAudio.length
    ? quantile(withAudio.map((s) => s.ms / (s.audioSec * 1000)), 0.5)
    : null;
  return {
    n: samples.length,
    p50: quantile(ms, 0.5),
    p95: quantile(ms, 0.95),
    mean: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    min: ms.length ? Math.min(...ms) : null,
    max: ms.length ? Math.max(...ms) : null,
    rtf: rtf == null ? null : Math.round(rtf * 1000) / 1000,
  };
}

export function groupBy(samples, keyFn) {
  const m = new Map();
  for (const s of samples) {
    const k = keyFn(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}

/**
 * @param {object} f  { stage?: string|'all', series?: Set<string>, pair?: string|'all', source?: 'all'|'session'|'bench'|'import', platform?: string|'all' }
 */
export function filterSamples(samples, f = {}) {
  return samples.filter((s) => {
    if (f.stage && f.stage !== 'all' && s.stage !== f.stage) return false;
    if (f.series && f.series.size && !f.series.has(s.series)) return false;
    if (f.pair && f.pair !== 'all' && pairLabel(s) !== f.pair) return false;
    if (f.source && f.source !== 'all' && s.source !== f.source) return false;
    if (f.platform && f.platform !== 'all' && s.platform !== f.platform) return false;
    return true;
  });
}

/** Baris bar: p50 per pasangan bahasa, urut dari yang paling lambat. */
export function p50ByPair(samples, { limit = 12 } = {}) {
  const rows = [...groupBy(samples, pairLabel).entries()].map(([label, list]) => ({
    label,
    value: summarize(list).p50,
    n: list.length,
  }));
  rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (rows.length <= limit) return rows;
  const head = rows.slice(0, limit - 1);
  const rest = rows.slice(limit - 1);
  const all = samples.filter((s) => rest.some((r) => r.label === pairLabel(s)));
  head.push({ label: 'Other', value: summarize(all).p50, n: all.length, other: true });
  return head;
}

/** Titik scatter: durasi audio (dtk) vs waktu (ms), diwarnai per seri. */
export function scatterPoints(samples) {
  return samples
    .filter((s) => s.audioSec > 0)
    .map((s) => ({ x: s.audioSec, y: s.ms, series: s.series, label: `${pairLabel(s)} · ${s.stage}` }));
}

/** Garis: ms berurutan waktu per seri (indeks sampel sebagai x supaya bench & sesi sebanding). */
export function lineSeries(samples) {
  const sorted = [...samples].sort((a, b) => a.at.localeCompare(b.at));
  return SERIES.map((ser) => ({
    id: ser.id,
    label: ser.label,
    points: sorted.filter((s) => s.series === ser.id).map((s, i) => ({ x: i + 1, y: s.ms, at: s.at })),
  })).filter((s) => s.points.length);
}

/**
 * Impor keluaran `scripts/bench-lab.py` (`{at, url, health, rows:[{pair, stage, ms, ...}]}`).
 * Tahap bench: "draft@0.5s" → draft, "final ASR" → asr, "fast MT" → mt, "refine" → refine.
 */
export function fromBenchJson(json, { platform } = {}) {
  const rows = Array.isArray(json?.rows) ? json.rows : [];
  const engine = json?.health?.engine ? 'native' : 'native';
  const dev = String(json?.health?.device || json?.health?.platform || '').toLowerCase();
  const plat = platform || (dev.includes('apple') || dev.includes('mlx') || dev.includes('darwin') ? 'macos' : dev.includes('cuda') || dev.includes('cpu') ? 'unknown' : 'unknown');
  const out = [];
  for (const r of rows) {
    const st = String(r.stage || '');
    const stage = st.startsWith('draft') ? 'draft' : st === 'final ASR' ? 'asr' : st === 'fast MT' ? 'mt' : st === 'refine' ? 'refine' : null;
    if (!stage) continue;
    const [src, tgt] = String(r.pair || '').split('→');
    // bench-lab menulis "draft 0.35s" (spasi); versi lama memakai "draft@0.35s".
    const win = /draft[@ ]([\d.]+)s/.exec(st);
    out.push(normalizeSample({
      at: json?.at || new Date(0).toISOString(),
      stage, ms: r.ms, engine, device: engine === 'native' ? 'native' : 'wasm', platform: plat,
      src: src?.trim() || null, tgt: tgt?.trim() || null,
      audioSec: win ? Number(win[1]) : null,
      chars: (r.source || r.translation || '').length || null,
      mode: 'bench', source: 'bench',
    }));
  }
  return out.filter(Boolean);
}

/** Laporan yang bisa dibagikan pengguna & diimpor kembali (`fromReport`). */
export function toReport(samples, meta = {}) {
  const bySeries = {};
  for (const [k, list] of groupBy(samples, (s) => s.series)) bySeries[k] = summarize(list);
  const byStage = {};
  for (const [k, list] of groupBy(samples, (s) => s.stage)) byStage[k] = summarize(list);
  const byPair = {};
  for (const [k, list] of groupBy(samples, pairLabel)) byPair[k] = summarize(list);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: meta.platform || samples[0]?.platform || 'unknown',
    app: meta.app || 'yraverageSub',
    counts: { total: samples.length },
    summary: { bySeries, byStage, byPair },
    samples,
  };
}

export function fromReport(json) {
  if (!json || json.version !== 1 || !Array.isArray(json.samples)) return [];
  return normalizeAll(json.samples).map((s) => ({ ...s, source: 'import' }));
}

const fmt = (v) => (v == null ? '—' : String(Math.round(v)));

export function toMarkdown(report) {
  const L = [];
  L.push(`# Performance report — ${report.app} (${report.platform})`, '', `Generated ${report.generatedAt} · ${report.counts.total} samples`, '');
  const table = (title, obj) => {
    L.push(`## ${title}`, '', '| Key | n | p50 ms | p95 ms | mean | RTF |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [k, s] of Object.entries(obj)) L.push(`| ${k} | ${s.n} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.mean)} | ${s.rtf ?? '—'} |`);
    L.push('');
  };
  table('By engine', report.summary.bySeries);
  table('By stage', report.summary.byStage);
  table('By language pair', report.summary.byPair);
  return L.join('\n');
}
