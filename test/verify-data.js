/**
 * Katalog 26 sub-fitur Fase 1 untuk dashboard verifikasi rilis.
 *
 * Frontend-first: `loadVerifyCatalog()` mengembalikan data tiruan dengan
 * bentuk yang sama seperti kontrak yang akan diisi smoke/E2E/lab nanti
 * (GET /api/verify-status). Jangan mengandalkan backend di halaman ini.
 */

export const VERIFY_TARGET = 26;

/** @typedef {'pass' | 'fail' | 'warn' | 'unverified'} VerifyStatus */
/** @typedef {'e2e' | 'smoke' | 'unit' | 'lab' | 'visual' | 'manual' | 'none'} EvidenceKind */

/**
 * @typedef {object} VerifyFeature
 * @property {string} id
 * @property {string} name
 * @property {string} group
 * @property {string} summary
 * @property {string} surface
 * @property {VerifyStatus} status
 * @property {{ kind: EvidenceKind, label: string, href: string | null }} evidence
 * @property {string | null} lastRun
 */

/** @type {VerifyFeature[]} */
export const STUB_FEATURES = [
  {
    id: 'ext-tab-capture',
    name: 'Subtitel tab real-time',
    group: 'Ekstensi Chrome',
    summary: 'Tangkap audio tab aktif lewat tabCapture, transkripsi lokal, overlay di halaman.',
    surface: 'src/background.js · src/offscreen.js',
    status: 'pass',
    evidence: { kind: 'e2e', label: 'scripts/e2e.mjs', href: null },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'ext-tab-picker',
    name: 'Pemilih tab / jendela manual',
    group: 'Ekstensi Chrome',
    summary: 'Jalur getDisplayMedia ketika Chrome menolak tabCapture otomatis.',
    surface: 'src/sidepanel.js · src/offscreen.js',
    status: 'unverified',
    evidence: { kind: 'e2e', label: 'e2e --pick (belum dijalankan di dasbor)', href: null },
    lastRun: null,
  },
  {
    id: 'ext-vad',
    name: 'Silero VAD di Offscreen Document',
    group: 'Ekstensi Chrome',
    summary: 'Potong ucapan, tahan musik/hening, kurangi halusinasi Whisper.',
    surface: 'src/offscreen.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Belum ada harness khusus', href: null },
    lastRun: null,
  },
  {
    id: 'ext-overlay',
    name: 'Overlay Shadow DOM + fullscreen',
    group: 'Ekstensi Chrome',
    summary: 'Subtitel mengambang di content script, bisa digeser, ikut fullscreen.',
    surface: 'src/content.js',
    status: 'pass',
    evidence: { kind: 'visual', label: 'test/overlay-test.html', href: 'overlay-test.html' },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'ext-sidepanel',
    name: 'Side Panel start/stop + pratinjau',
    group: 'Ekstensi Chrome',
    summary: 'Kontrol sesi, status, dan kotak pratinjau teks langsung.',
    surface: 'src/sidepanel.html',
    status: 'unverified',
    evidence: { kind: 'visual', label: 'test/panel-test.html', href: 'panel-test.html' },
    lastRun: null,
  },
  {
    id: 'ext-transcribe',
    name: 'Mode Transcribe',
    group: 'Ekstensi Chrome',
    summary: 'Hanya ASR, tanpa terjemahan, bahasa sumber bisa dipilih atau auto.',
    surface: 'src/sidepanel.html · src/lib/asr.js',
    status: 'unverified',
    evidence: { kind: 'smoke', label: 'scripts/smoke.mjs (bentuk keluaran ASR)', href: null },
    lastRun: null,
  },
  {
    id: 'ext-translate',
    name: 'Mode +Translate + pemilih bahasa',
    group: 'Ekstensi Chrome',
    summary: 'Transkripsi lalu terjemahan ke bahasa target dari Side Panel.',
    surface: 'src/sidepanel.html · src/lib/translate.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Menunggu E2E translate', href: null },
    lastRun: null,
  },
  {
    id: 'ext-dual-line',
    name: 'Tampilan dual-line',
    group: 'Ekstensi Chrome',
    summary: 'Tampilkan baris asli dan terjemahan bersamaan di overlay dan pratinjau.',
    surface: 'src/content.js · src/sidepanel.html',
    status: 'pass',
    evidence: { kind: 'visual', label: 'overlay-test demoDual', href: 'overlay-test.html' },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'ext-refine',
    name: 'Refine (draft + koreksi akhir)',
    group: 'Ekstensi Chrome',
    summary: 'Draft cepat saat berbicara, koreksi semantik di akhir kalimat.',
    surface: 'src/lib/translate.js · native/server.py',
    status: 'warn',
    evidence: { kind: 'lab', label: 'test/lab.html · last-bench.json (beberapa draft >500 ms)', href: 'lab.html' },
    lastRun: '2026-08-22T21:57:26Z',
  },
  {
    id: 'ext-offline-file',
    name: 'Transkripsi berkas offline (OPFS)',
    group: 'Ekstensi Chrome',
    summary: 'Drop mp3/wav/m4a/mp4/webm/ogg, stage chunked ke OPFS, transcribeLong.',
    surface: 'src/lib/offline-io.js · src/offscreen.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Menunggu E2E berkas', href: null },
    lastRun: null,
  },
  {
    id: 'ext-history',
    name: 'Riwayat sesi',
    group: 'Ekstensi Chrome',
    summary: 'Simpan sesi realtime/offline ke chrome.storage, ekspor ulang dari History.',
    surface: 'src/sidepanel.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Belum ada harness', href: null },
    lastRun: null,
  },
  {
    id: 'ext-models',
    name: 'Manajer model browser',
    group: 'Ekstensi Chrome',
    summary: 'Unduh/hapus Whisper & Opus-MT, sumber HF/HF-Mirror, perangkat Auto/WebGPU/WASM.',
    surface: 'src/lib/models.js · src/lib/registry.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Uji manual Settings → Model Files', href: null },
    lastRun: null,
  },
  {
    id: 'mt-whisper-direct',
    name: 'Whisper-direct any → en',
    group: 'Terjemahan berjenjang',
    summary: 'Terjemahan bicara ke Inggris tanpa model MT tambahan.',
    surface: 'src/lib/asr.js · src/lib/translate.js',
    status: 'pass',
    evidence: { kind: 'smoke', label: 'scripts/smoke.mjs task:translate', href: null },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'mt-chrome',
    name: 'Chrome Translator API',
    group: 'Terjemahan berjenjang',
    summary: 'Penerjemah on-device Chrome 138+ bila pasangan bahasa tersedia.',
    surface: 'src/lib/translate.js',
    status: 'unverified',
    evidence: { kind: 'manual', label: 'Butuh Chrome 138+', href: null },
    lastRun: null,
  },
  {
    id: 'mt-opus',
    name: 'Opus-MT WASM',
    group: 'Terjemahan berjenjang',
    summary: 'Fallback terjemahan lokal Helsinki-NLP via transformers.js q8.',
    surface: 'src/lib/opus.js · src/lib/translate.js',
    status: 'pass',
    evidence: { kind: 'smoke', label: 'scripts/smoke.mjs Xenova/opus-mt-ja-en', href: null },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'mt-native-llm',
    name: 'LLM native (Qwen / MLX)',
    group: 'Terjemahan berjenjang',
    summary: 'Terjemahan berkualitas lewat helper (translate / translate_refine).',
    surface: 'native/server.py · src/lib/native.js',
    status: 'warn',
    evidence: { kind: 'lab', label: 'test/last-bench.json', href: 'last-bench.json' },
    lastRun: '2026-08-22T21:57:26Z',
  },
  {
    id: 'export-srt',
    name: 'Ekspor SRT',
    group: 'Ekspor',
    summary: 'Cue berwaktu, dual-line opsional, pecah segmen ASR yang terlalu panjang.',
    surface: 'src/lib/transcript-cache.js formatSrt',
    status: 'pass',
    evidence: { kind: 'unit', label: 'test/subtitle-export.test.js', href: 'subtitle-export.test.js' },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'export-vtt',
    name: 'Ekspor WebVTT',
    group: 'Ekspor',
    summary: 'WebVTT dengan dukungan dual-line tanpa menggandakan teks saat dual mati.',
    surface: 'src/lib/transcript-cache.js formatVtt',
    status: 'pass',
    evidence: { kind: 'unit', label: 'test/subtitle-export.test.js', href: 'subtitle-export.test.js' },
    lastRun: '2026-09-03T00:00:00Z',
  },
  {
    id: 'export-txt',
    name: 'Ekspor TXT',
    group: 'Ekspor',
    summary: 'Teks polos dari cue, folder ekspor lewat File System Access API.',
    surface: 'src/lib/transcript-cache.js formatTxt · src/lib/export.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Unit test belum mencakup TXT', href: null },
    lastRun: null,
  },
  {
    id: 'helper-http',
    name: 'HTTP lokal + Native Messaging',
    group: 'Native Helper',
    summary: 'Server 127.0.0.1:17865 dan host com.yraveragesubmin.helper.',
    surface: 'native/server.py · native/messaging_host.py',
    status: 'unverified',
    evidence: { kind: 'lab', label: 'GET /health dari lab.html', href: 'lab.html' },
    lastRun: null,
  },
  {
    id: 'helper-asr',
    name: 'ASR native (mlx-whisper / faster-whisper)',
    group: 'Native Helper',
    summary: 'Whisper di GPU Apple (MLX) atau CPU/CUDA di OS lain.',
    surface: 'native/server.py',
    status: 'warn',
    evidence: { kind: 'lab', label: 'last-bench.json engine mlx-whisper', href: 'last-bench.json' },
    lastRun: '2026-08-22T21:57:26Z',
  },
  {
    id: 'helper-large-file',
    name: 'Berkas besar via helper',
    group: 'Native Helper',
    summary: 'Transkripsi berkas yang tidak muat di memori browser (>1.5–2 GiB).',
    surface: 'native/server.py · src/lib/native.js',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Menunggu E2E /transcribe_file', href: null },
    lastRun: null,
  },
  {
    id: 'mac-capture',
    name: 'Tangkap audio sistem (ScreenCaptureKit)',
    group: 'Aplikasi macOS',
    summary: 'Audio aplikasi / sistem / mikrofon dari menu bar app.',
    surface: 'mac/Sources/TransSubKit',
    status: 'unverified',
    evidence: { kind: 'manual', label: 'mac --selftest', href: null },
    lastRun: null,
  },
  {
    id: 'mac-overlay',
    name: 'Overlay NSPanel + terjemahan Apple',
    group: 'Aplikasi macOS',
    summary: 'Panel mengambang di atas app lain; tangga low-latency / high-fidelity / FM.',
    surface: 'mac/Sources/LocalTransSub/OverlayWindow.swift',
    status: 'unverified',
    evidence: { kind: 'manual', label: 'mac --overlay-probe', href: null },
    lastRun: null,
  },
  {
    id: 'mac-dictation',
    name: 'Dikte hold-to-talk',
    group: 'Aplikasi macOS',
    summary: 'Tahan hotkey, transkrip lokal, tempel ke kursor (Cmd+V sintetis).',
    surface: 'mac/Sources/LocalTransSub/DictationController.swift',
    status: 'unverified',
    evidence: { kind: 'manual', label: 'Uji manual Accessibility + Input Monitoring', href: null },
    lastRun: null,
  },
  {
    id: 'mac-file',
    name: 'Transkripsi berkas macOS + ekspor',
    group: 'Aplikasi macOS',
    summary: 'Pilih berkas di app native, progres, ekspor SRT/VTT.',
    surface: 'mac/Sources/LocalTransSub/MainView.swift',
    status: 'unverified',
    evidence: { kind: 'none', label: 'Belum ada harness otomatis', href: null },
    lastRun: null,
  },
];

export const STUB_CATALOG = {
  source: 'stub',
  generatedAt: '2026-09-03T00:00:00Z',
  target: VERIFY_TARGET,
  features: STUB_FEATURES,
};

/**
 * Kontrak yang akan dipakai smoke/E2E: ganti badan fungsi ini ke fetch
 * tanpa mengubah bentuk { source, generatedAt, target, features }.
 */
export async function loadVerifyCatalog() {
  return STUB_CATALOG;
}

export function summarize(features) {
  const counts = { pass: 0, fail: 0, warn: 0, unverified: 0 };
  for (const f of features) counts[f.status] = (counts[f.status] ?? 0) + 1;
  const checked = counts.pass + counts.fail + counts.warn;
  return {
    total: features.length,
    ...counts,
    checked,
    passRate: features.length ? Math.round((counts.pass / features.length) * 100) : 0,
  };
}
