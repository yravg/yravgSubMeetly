/**
 * Laporan uji asap (smoke) dan E2E untuk verifikasi rilis Fase 1.
 *
 * Frontend-first: `loadQaReport()` mengembalikan data tiruan dengan bentuk
 * yang sama seperti kontrak nanti (GET /api/qa-report atau last-smoke.json /
 * last-e2e.json). Halaman ini tidak menjalankan skrip uji.
 */

/** @typedef {'pass' | 'fail' | 'unverified' | 'skip'} QaStatus */

/**
 * @typedef {object} QaCheck
 * @property {string} id
 * @property {string} name
 * @property {QaStatus} status
 * @property {string} detail
 */

/**
 * @typedef {object} QaSuite
 * @property {string} id
 * @property {'smoke' | 'e2e'} kind
 * @property {string} name
 * @property {string} command
 * @property {string} script
 * @property {QaStatus} status
 * @property {number | null} durationMs
 * @property {string | null} lastRun
 * @property {string} covers
 * @property {QaCheck[]} checks
 * @property {string[]} log
 */

/** @type {QaSuite[]} */
export const STUB_SUITES = [
  {
    id: 'smoke-pipeline',
    kind: 'smoke',
    name: 'Uji asap pipeline transformers.js',
    command: 'node scripts/smoke.mjs',
    script: 'scripts/smoke.mjs',
    status: 'pass',
    durationMs: 18420,
    lastRun: '2026-09-03T00:00:00Z',
    covers: 'Bentuk keluaran ASR Whisper Tiny (q8) dan Opus-MT ja→en yang dipakai ekstensi.',
    checks: [
      {
        id: 'smoke-asr-load',
        name: 'Muat whisper-tiny q8',
        status: 'pass',
        detail: 'onnx-community/whisper-tiny · encoder/decoder q8 (jalur WASM src/lib/asr.js)',
      },
      {
        id: 'smoke-asr-text',
        name: 'transcribe mengembalikan .text string',
        status: 'pass',
        detail: 'task:transcribe language:en — menolak jika out.text bukan string',
      },
      {
        id: 'smoke-asr-translate',
        name: 'Whisper-direct task:translate',
        status: 'pass',
        detail: 'language:ja — jalur any→en tanpa model MT',
      },
      {
        id: 'smoke-asr-chunks',
        name: 'return_timestamps menghasilkan .chunks array',
        status: 'pass',
        detail: 'chunk_length_s:30 stride_length_s:5',
      },
      {
        id: 'smoke-opus',
        name: 'Opus-MT ja-en .translation_text',
        status: 'pass',
        detail: 'Xenova/opus-mt-ja-en dtype q8 — sama seperti src/lib/translate.js',
      },
    ],
    log: [
      '[smoke] loading whisper-tiny (q8)…',
      '[smoke] whisper loaded',
      '[smoke] transcribe out: {"text":""}',
      '[smoke] translate-direct out: {"text":""}',
      '[smoke] timestamps out: {"text":"","chunks":[]}',
      '[smoke] loading opus-mt-ja-en (q8)…',
      '[smoke] MT out: [{"translation_text":"Hello, world. It is nice weather today."}]',
      '[smoke] ALL OK',
    ],
  },
  {
    id: 'e2e-realtime',
    kind: 'e2e',
    name: 'E2E subtitel tab (tabCapture)',
    command: 'node scripts/e2e.mjs',
    script: 'scripts/e2e.mjs',
    status: 'pass',
    durationMs: 41200,
    lastRun: '2026-09-03T00:00:00Z',
    covers: 'Puppeteer memuat dist/, memutar test/audio-page.html, Start Task, menegaskan baris transkrip dan overlay Shadow DOM.',
    checks: [
      {
        id: 'e2e-sw',
        name: 'Service worker ekstensi ditemukan',
        status: 'pass',
        detail: 'Target background.js → id ekstensi stabil dari path',
      },
      {
        id: 'e2e-tab',
        name: 'Side Panel menarget AudioTestPage',
        status: 'pass',
        detail: '#tab-title mengandung AudioTestPage',
      },
      {
        id: 'e2e-lines',
        name: 'Baris subtitel muncul di pratinjau',
        status: 'pass',
        detail: '#live-tgt-lines cocok /fox|subtitle|hello|machine|device|dog/i',
      },
      {
        id: 'e2e-overlay',
        name: 'Overlay diinjeksi ke halaman audio',
        status: 'pass',
        detail: '#__local_transsub_overlay ada di tab uji',
      },
      {
        id: 'e2e-stop',
        name: 'End Task menghentikan sesi',
        status: 'pass',
        detail: '#btn-stop diklik, browser ditutup bersih',
      },
    ],
    log: [
      '[e2e] extension id: abcdefghijklmnop',
      '[e2e] audio page playing',
      '[e2e] settings: {"uiLang":"en","device":"wasm","asrModel":"whisper-tiny","engine":"browser"}',
      '[e2e] panel sees tab: AudioTestPage',
      '[e2e] start clicked — waiting for model load + first subtitles…',
      '[e2e] SUBTITLES after 28s: The quick brown fox',
      '[e2e] overlay injected into page: true',
      '[e2e] E2E PASS ✅',
    ],
  },
  {
    id: 'e2e-pick',
    kind: 'e2e',
    name: 'E2E pemilih tab manual (--pick)',
    command: 'node scripts/e2e.mjs --pick',
    script: 'scripts/e2e.mjs',
    status: 'unverified',
    durationMs: null,
    lastRun: null,
    covers: 'Jalur getDisplayMedia tanpa --allowlisted-extension-id; picker otomatis memilih judul AudioTestPage.',
    checks: [
      {
        id: 'e2e-pick-click',
        name: 'Tombol Pick tab / window manually',
        status: 'unverified',
        detail: 'Klik #btn-pick, bukan #btn-start',
      },
      {
        id: 'e2e-pick-audio',
        name: 'Audio tab ikut terbagi',
        status: 'unverified',
        detail: '--auto-select-tab-capture-source-by-title=AudioTestPage',
      },
      {
        id: 'e2e-pick-overlay',
        name: 'Overlay tetap muncul',
        status: 'unverified',
        detail: 'Sama seperti jalur tabCapture',
      },
    ],
    log: ['[e2e] (stub) suite belum dijalankan dari dasbor'],
  },
  {
    id: 'e2e-native',
    kind: 'e2e',
    name: 'E2E mesin native helper (--native)',
    command: 'node scripts/e2e.mjs --native',
    script: 'scripts/e2e.mjs',
    status: 'unverified',
    durationMs: null,
    lastRun: null,
    covers: 'ASR lewat http://127.0.0.1:17865; helper harus sudah hidup sebelum tes.',
    checks: [
      {
        id: 'e2e-native-engine',
        name: 'Settings engine=native',
        status: 'unverified',
        detail: 'chrome.storage.local.settings.engine',
      },
      {
        id: 'e2e-native-lines',
        name: 'Subtitel dari helper',
        status: 'unverified',
        detail: 'Pratinjau Side Panel terisi',
      },
    ],
    log: ['[e2e] (stub) suite belum dijalankan — native helper tidak diandaikan hidup'],
  },
];

export const STUB_QA_REPORT = {
  source: 'stub',
  generatedAt: '2026-09-03T00:00:00Z',
  suites: STUB_SUITES,
};

export async function loadQaReport() {
  return STUB_QA_REPORT;
}

export function summarizeSuites(suites) {
  const counts = { pass: 0, fail: 0, unverified: 0, skip: 0 };
  let checks = 0;
  let checksPass = 0;
  for (const s of suites) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
    for (const c of s.checks) {
      checks += 1;
      if (c.status === 'pass') checksPass += 1;
    }
  }
  return {
    total: suites.length,
    smoke: suites.filter((s) => s.kind === 'smoke').length,
    e2e: suites.filter((s) => s.kind === 'e2e').length,
    checks,
    checksPass,
    ...counts,
  };
}
