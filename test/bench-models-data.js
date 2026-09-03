/**
 * Lab benchmark kinerja model (Fase 1).
 *
 * Frontend-first: katalog model + angka tiruan. Jika `last-bench.json` ada
 * (keluaran scripts/bench-lab.py), bagian Native Helper digabung dari file itu.
 * Halaman ini tidak menjalankan inferensi.
 */

export const TARGET_DRAFT_MS = 500;

/** @typedef {'pass' | 'fail' | 'warn' | 'unverified'} BenchStatus */

/**
 * @typedef {object} ModelBench
 * @property {string} id
 * @property {string} name
 * @property {'browser' | 'native'} engine
 * @property {string} device
 * @property {string} size
 * @property {number | null} draftMs
 * @property {number | null} asrMs
 * @property {number | null} mtMs
 * @property {number | null} rtf
 * @property {BenchStatus} status
 * @property {string} note
 */

/** @type {ModelBench[]} */
export const STUB_MODELS = [
  {
    id: 'whisper-tiny-wasm',
    name: 'Whisper Tiny',
    engine: 'browser',
    device: 'WASM q8',
    size: '~45 MB',
    draftMs: 920,
    asrMs: 780,
    mtMs: null,
    rtf: 0.45,
    status: 'warn',
    note: 'Paling cepat di browser; akurasi rendah. Angka stub.',
  },
  {
    id: 'whisper-base-wasm',
    name: 'Whisper Base',
    engine: 'browser',
    device: 'WASM q8',
    size: '~80 MB',
    draftMs: 1600,
    asrMs: 1400,
    mtMs: null,
    rtf: 0.7,
    status: 'warn',
    note: 'Keseimbangan yang disarankan README. Angka stub.',
  },
  {
    id: 'whisper-small-wasm',
    name: 'Whisper Small',
    engine: 'browser',
    device: 'WASM q8',
    size: '~250 MB',
    draftMs: 3200,
    asrMs: 2800,
    mtMs: null,
    rtf: 1.4,
    status: 'fail',
    note: 'Lambat di WASM; lebih masuk akal di WebGPU. Angka stub.',
  },
  {
    id: 'whisper-large-webgpu',
    name: 'Whisper Large v3 Turbo',
    engine: 'browser',
    device: 'WebGPU q4f16',
    size: '~565 MB',
    draftMs: 1100,
    asrMs: 900,
    mtMs: null,
    rtf: 0.35,
    status: 'warn',
    note: 'Hanya WebGPU. Masih di atas target draft 500 ms. Angka stub.',
  },
  {
    id: 'voxtral-mini-webgpu',
    name: 'Voxtral Mini 3B',
    engine: 'browser',
    device: 'WebGPU q4',
    size: '~2.7 GB',
    draftMs: 2800,
    asrMs: 2400,
    mtMs: null,
    rtf: 0.9,
    status: 'fail',
    note: 'Kualitas tinggi, butuh ≥16 GB RAM. Tidak untuk caption live. Angka stub.',
  },
  {
    id: 'opus-mt-wasm',
    name: 'Opus-MT (per pasangan)',
    engine: 'browser',
    device: 'WASM q8',
    size: '~115 MB / pasangan',
    draftMs: null,
    asrMs: null,
    mtMs: 180,
    rtf: null,
    status: 'pass',
    note: 'Fallback terjemahan lokal. Bukan ASR. Angka stub.',
  },
  {
    id: 'native-mlx-large',
    name: 'Native mlx-whisper Large v3 Turbo',
    engine: 'native',
    device: 'Apple GPU (MLX)',
    size: '~1.6 GB',
    draftMs: 566,
    asrMs: 90,
    mtMs: 480,
    rtf: 0.05,
    status: 'warn',
    note: 'Target draft ≤500 ms. Diisi dari last-bench.json bila ada.',
  },
];

export const STUB_BENCH = {
  source: 'stub',
  generatedAt: '2026-09-03T00:00:00Z',
  targetDraftMs: TARGET_DRAFT_MS,
  models: STUB_MODELS,
  nativeRows: [],
  nativeHealth: null,
};

function statusFromDraft(ms) {
  if (ms == null) return 'unverified';
  if (ms <= TARGET_DRAFT_MS) return 'pass';
  if (ms <= 900) return 'warn';
  return 'fail';
}

function summarizeNativeRows(rows) {
  const drafts = rows.filter((r) => String(r.stage || '').startsWith('draft'));
  if (!drafts.length) return null;
  const times = drafts.map((r) => r.ms).filter((n) => typeof n === 'number');
  const asr = drafts.map((r) => r.asr_ms).filter((n) => typeof n === 'number');
  const mt = drafts.map((r) => r.translate_ms).filter((n) => typeof n === 'number');
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const under = times.filter((t) => t <= TARGET_DRAFT_MS).length;
  return {
    draftMs: times.length ? Math.min(...times) : null,
    draftAvgMs: avg(times),
    asrMs: avg(asr),
    mtMs: avg(mt),
    under,
    total: times.length,
  };
}

export function mergeLastBench(catalog, lastBench) {
  if (!lastBench?.rows) return catalog;
  const stats = summarizeNativeRows(lastBench.rows);
  const models = catalog.models.map((m) => {
    if (m.id !== 'native-mlx-large' || !stats) return m;
    const engine = lastBench.health?.engine || 'mlx-whisper';
    const modelName = (lastBench.health?.model || '').split('/').pop() || m.name;
    return {
      ...m,
      name: `Native ${engine} · ${modelName}`,
      draftMs: stats.draftMs,
      asrMs: stats.asrMs,
      mtMs: stats.mtMs,
      status: statusFromDraft(stats.draftMs),
      note: `Draft terbaik ${stats.draftMs} ms · ≤${TARGET_DRAFT_MS} ms: ${stats.under}/${stats.total} · dari last-bench.json`,
    };
  });
  return {
    ...catalog,
    source: catalog.source === 'stub' ? 'stub+last-bench.json' : catalog.source,
    generatedAt: lastBench.at || catalog.generatedAt,
    models,
    nativeRows: lastBench.rows,
    nativeHealth: lastBench.health || null,
  };
}

export async function loadBenchReport() {
  let catalog = {
    ...STUB_BENCH,
    models: STUB_MODELS.map((m) => ({ ...m })),
    nativeRows: [],
  };
  try {
    const r = await fetch('last-models-bench.json');
    if (r.ok) {
      const j = await r.json();
      return {
        source: j.source || 'last-models-bench.json',
        generatedAt: j.generatedAt || catalog.generatedAt,
        targetDraftMs: j.targetDraftMs || TARGET_DRAFT_MS,
        models: j.models || catalog.models,
        nativeRows: j.nativeRows || [],
        nativeHealth: j.nativeHealth || null,
      };
    }
  } catch {
    /* tidak ada / server tanpa file */
  }
  try {
    const r = await fetch('last-bench.json');
    if (r.ok) catalog = mergeLastBench(catalog, await r.json());
  } catch {
    /* file tidak ada / lab server tanpa last-bench */
  }
  return catalog;
}

export function summarizeModels(models) {
  const counts = { pass: 0, fail: 0, warn: 0, unverified: 0 };
  for (const m of models) counts[m.status] = (counts[m.status] ?? 0) + 1;
  return { total: models.length, ...counts };
}
