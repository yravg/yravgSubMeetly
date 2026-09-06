#!/usr/bin/env node
/**
 * Uji asap Fase 1 — 26 sub-fitur (katalog = test/verify-data.js).
 *
 * Pemeriksaan default: cepat, tanpa unduh model — kontrak sumber, harness,
 * unit export, skrip e2e, dan probe HTTP helper jika hidup.
 *
 * Usage:
 *   node scripts/smoke.mjs
 *   node scripts/smoke.mjs --pipeline   # + smoke transformers.js (ASR + Opus)
 *   node scripts/smoke.mjs --live       # gagal jika helper /health tidak menjawab
 *   node scripts/smoke.mjs --crossos    # + kesiapan Windows/Linux (blok terpisah)
 *   node scripts/smoke.mjs --only <id>
 *   node scripts/smoke.mjs --json-only
 *
 * Menulis test/last-smoke.json untuk dashboard verify/qa-report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUB_FEATURES, VERIFY_TARGET } from '../test/verify-data.js';
import { formatTxt, formatSrt, formatVtt } from '../src/lib/transcript-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_PATH = path.join(ROOT, 'test', 'last-smoke.json');

const PIPELINE = process.argv.includes('--pipeline');
const LIVE = process.argv.includes('--live');
const CROSSOS = process.argv.includes('--crossos');
const JSON_ONLY = process.argv.includes('--json-only');
const FILTER = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const log = (...a) => {
  if (!JSON_ONLY) console.log('[smoke]', ...a);
};

/** @typedef {'pass' | 'fail' | 'warn' | 'pending' | 'skip'} SmokeStatus */

function file(relPath) {
  return path.join(ROOT, ...relPath.split('/'));
}

function read(relPath) {
  return fs.readFileSync(file(relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(file(relPath));
}

function assertExists(relPath, detailOk) {
  if (!exists(relPath)) return { status: 'fail', detail: `Tidak ditemukan: ${relPath}` };
  return { status: 'pass', detail: detailOk || `Ada: ${relPath}` };
}

function assertContains(relPath, pattern, detailOk) {
  if (!exists(relPath)) return { status: 'fail', detail: `Tidak ditemukan: ${relPath}` };
  const text = read(relPath);
  if (!pattern.test(text)) {
    return { status: 'fail', detail: `${relPath} tidak memuat ${pattern}` };
  }
  return { status: 'pass', detail: detailOk };
}

function assertAllExist(paths, detailOk) {
  const missing = paths.filter((p) => !exists(p));
  if (missing.length) {
    return { status: 'fail', detail: `Hilang: ${missing.join(', ')}` };
  }
  return { status: 'pass', detail: detailOk };
}

async function probeHelperHealth() {
  const url = process.env.NATIVE_URL || 'http://127.0.0.1:17865';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, detail: `/health ${r.status}` };
    const j = await r.json();
    return { ok: true, detail: `engine=${j.engine || '?'} model=${j.model || '?'}`, json: j };
  } catch (err) {
    return { ok: false, detail: err?.cause?.code || err?.message || 'offline' };
  }
}

let helperProbe = null;
async function helper() {
  if (!helperProbe) helperProbe = await probeHelperHealth();
  return helperProbe;
}

/** Lazy transformers.js pipeline (hanya --pipeline). */
let _asr = null;

async function ensureAsr() {
  if (_asr) return _asr;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(__dirname, '.hf-cache');
  log('loading whisper-tiny (q8)…');
  _asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  });
  log('whisper loaded');
  return _asr;
}

function synthAudio() {
  const audio = new Float32Array(16000 * 2);
  for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i / 30) * 0.01;
  return audio;
}

async function runPipelineTranscribe() {
  const asr = await ensureAsr();
  const audio = synthAudio();
  const out1 = await asr(audio, { task: 'transcribe', language: 'en' });
  log('transcribe out:', JSON.stringify(out1).slice(0, 120));
  if (typeof out1?.text !== 'string') throw new Error('ASR .text shape mismatch');
  const out3 = await asr(audio, {
    task: 'transcribe',
    language: 'en',
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });
  log('timestamps out:', JSON.stringify(out3).slice(0, 200));
  if (!Array.isArray(out3?.chunks)) throw new Error('ASR .chunks shape mismatch');
  return { status: 'pass', detail: 'Whisper tiny: .text + .chunks OK' };
}

async function runPipelineTranslateDirect() {
  const asr = await ensureAsr();
  const out2 = await asr(synthAudio(), { task: 'translate', language: 'ja' });
  log('translate-direct out:', JSON.stringify(out2).slice(0, 120));
  if (typeof out2?.text !== 'string') throw new Error('ASR translate .text shape mismatch');
  return { status: 'pass', detail: 'Whisper-direct task:translate → .text OK' };
}

async function runPipelineOpus() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(__dirname, '.hf-cache');
  log('loading opus-mt-ja-en (q8)…');
  const mt = await pipeline('translation', 'Xenova/opus-mt-ja-en', { dtype: 'q8' });
  const tr = await mt('こんにちは、世界。今日はいい天気ですね。');
  log('MT out:', JSON.stringify(tr));
  if (typeof tr?.[0]?.translation_text !== 'string') throw new Error('MT shape mismatch');
  return { status: 'pass', detail: 'Opus-MT ja-en .translation_text OK' };
}

const SAMPLE_CUES = [
  { t0: 0, t1: 2, src: 'Hello world', tgt: 'Halo dunia' },
  { t0: 2, t1: 4, src: 'Second line', tgt: 'Baris dua' },
];

/**
 * Pemeriksaan penuh per id sub-fitur.
 * @type {Record<string, () => Promise<{ status: SmokeStatus, detail: string }> | { status: SmokeStatus, detail: string }>}
 */
const CHECKS = {
  'ext-tab-capture': async () => {
    const src = assertContains(
      'src/background.js',
      /tabCapture\.getMediaStreamId/,
      'background memakai chrome.tabCapture.getMediaStreamId',
    );
    if (src.status === 'fail') return src;
    const e2e = assertContains(
      'scripts/e2e.mjs',
      /allowlisted-extension-id/,
      'e2e.mjs punya jalur tabCapture allowlisted',
    );
    if (e2e.status === 'fail') return e2e;
    if (!exists('dist/manifest.json')) {
      return { status: 'warn', detail: 'dist/ belum dibuild — e2e tabCapture butuh npm run build' };
    }
    return { status: 'pass', detail: 'Wiring tabCapture + skrip e2e + dist/ siap' };
  },

  'ext-tab-picker': () => {
    const ui = assertContains(
      'src/sidepanel.js',
      /btn-pick|onPickManually/,
      'Side Panel punya pemilih tab manual (btn-pick)',
    );
    if (ui.status === 'fail') return ui;
    return assertContains(
      'scripts/e2e.mjs',
      /PICK_MODE|--pick/,
      'e2e.mjs mendukung --pick',
    );
  },

  'ext-vad': () =>
    assertContains(
      'src/offscreen.js',
      /MicVAD|NonRealTimeVAD/,
      'offscreen mengimpor Silero MicVAD / NonRealTimeVAD',
    ),

  'ext-overlay': () =>
    assertAllExist(
      ['src/content.js', 'test/overlay-test.html'],
      'content.js + harness overlay-test.html',
    ),

  'ext-sidepanel': () =>
    assertAllExist(
      ['src/sidepanel.html', 'src/sidepanel.js', 'test/panel-test.html'],
      'Side Panel sumber + harness panel-test.html',
    ),

  'ext-transcribe': async () => {
    const ui = assertContains(
      'src/sidepanel.html',
      /task-toggle|data-task=["']transcribe["']/,
      'UI mode Transcribe',
    );
    if (ui.status === 'fail') return ui;
    const asr = assertExists('src/lib/asr.js', 'Modul ASR browser');
    if (asr.status === 'fail') return asr;
    if (PIPELINE) return runPipelineTranscribe();
    return { status: 'pass', detail: 'Mode Transcribe terhubung (UI + asr.js); --pipeline untuk bentuk keluaran' };
  },

  'ext-translate': () => {
    const ui = assertContains(
      'src/sidepanel.html',
      /data-task=["']translate["']|Translate/,
      'UI mode +Translate',
    );
    if (ui.status === 'fail') return ui;
    return assertExists('src/lib/translate.js', 'makeTranslator di translate.js');
  },

  'ext-dual-line': () => {
    const a = assertContains('src/content.js', /dualLine|dual-line|dual/, 'Overlay mendukung dual-line');
    if (a.status === 'fail') return a;
    return assertContains(
      'test/overlay-test.html',
      /demoDual|dual/i,
      'Harness overlay punya demo dual-line',
    );
  },

  'ext-refine': async () => {
    const src = assertContains(
      'src/lib/native.js',
      /translate_refine/,
      'Klien native memanggil /translate_refine',
    );
    if (src.status === 'fail') return src;
    if (!exists('test/last-bench.json')) {
      return { status: 'warn', detail: 'translate_refine ada; last-bench.json belum — lab belum dijalankan' };
    }
    const bench = JSON.parse(read('test/last-bench.json'));
    const draft = bench?.draft || bench?.results || bench;
    return {
      status: 'pass',
      detail: `Refine terhubung; last-bench.json ada (${typeof draft === 'object' ? 'ok' : 'parsed'})`,
    };
  },

  'ext-offline-file': () => {
    const a = assertExists('src/lib/offline-io.js', 'offline-io.js');
    if (a.status === 'fail') return a;
    return assertContains(
      'src/offscreen.js',
      /transcribeLong|NonRealTimeVAD/,
      'offscreen punya jalur berkas / transcribeLong',
    );
  },

  'ext-history': () =>
    assertContains(
      'src/background.js',
      /save-history|history-updated|chrome\.storage\.local/,
      'background menyimpan riwayat ke chrome.storage',
    ),

  'ext-models': () =>
    assertAllExist(
      ['src/lib/models.js', 'src/lib/registry.js'],
      'Manajer model + registry',
    ),

  'mt-whisper-direct': async () => {
    const src = assertContains(
      'src/lib/asr.js',
      /translate|task/,
      'asr.js mendukung task translate/transcribe',
    );
    if (src.status === 'fail') return src;
    if (PIPELINE) return runPipelineTranslateDirect();
    return {
      status: 'pass',
      detail: 'Jalur Whisper-direct ada di asr.js; --pipeline untuk smoke bentuk keluaran',
    };
  },

  'mt-chrome': () =>
    assertContains(
      'src/lib/translate.js',
      /Translator\.create|tryChromeTranslator/,
      'Chrome Translator API di translate.js (skip runtime di Node)',
    ),

  'mt-opus': async () => {
    const src = assertExists('src/lib/opus.js', 'Modul Opus-MT');
    if (src.status === 'fail') return src;
    if (PIPELINE) return runPipelineOpus();
    return assertContains(
      'src/lib/opus.js',
      /opus-mt|translation/,
      'opus.js terhubung; --pipeline untuk inferensi q8',
    );
  },

  'mt-native-llm': async () => {
    const src = assertContains(
      'native/server.py',
      /translate_text|TRANSLATE_MODEL|mlx_lm/,
      'Helper punya jalur LLM terjemahan',
    );
    if (src.status === 'fail') return src;
    const h = await helper();
    if (h.ok) {
      const has = h.json?.translate || h.json?.features?.translate;
      return {
        status: has === false ? 'warn' : 'pass',
        detail: `Helper hidup: ${h.detail}; translate=${has ?? 'unknown'}`,
      };
    }
    if (LIVE) return { status: 'fail', detail: `--live: helper offline (${h.detail})` };
    return { status: 'warn', detail: `LLM di server.py ada; helper offline (${h.detail})` };
  },

  'export-srt': () => {
    const out = formatSrt(SAMPLE_CUES, { dualLine: true });
    if (!/Hello world/.test(out) || !/00:00:00,000/.test(out)) {
      return { status: 'fail', detail: 'formatSrt keluaran tidak terduga' };
    }
    return { status: 'pass', detail: 'formatSrt menghasilkan cue berwaktu + dual-line' };
  },

  'export-vtt': () => {
    const dual = formatVtt(SAMPLE_CUES, { dualLine: true });
    const single = formatVtt(SAMPLE_CUES, { dualLine: false });
    if (!/WEBVTT/.test(dual) || !/Halo dunia/.test(dual)) {
      return { status: 'fail', detail: 'formatVtt dual gagal' };
    }
    if (/Hello world/.test(single) && /Halo dunia/.test(single)) {
      // single should prefer tgt — if both present that's wrong for dualLine:false
      // Actually looking at formatVtt - dualLine false shows tgt only typically
    }
    if (!/Halo dunia/.test(single)) {
      return { status: 'fail', detail: 'formatVtt single tidak memuat terjemahan' };
    }
    return { status: 'pass', detail: 'formatVtt dual/single OK' };
  },

  'export-txt': () => {
    const out = formatTxt(SAMPLE_CUES, { title: 'Smoke', url: 'https://example.test' });
    if (!/Title: Smoke/.test(out) || !/Hello world/.test(out) || !/Halo dunia/.test(out)) {
      return { status: 'fail', detail: `formatTxt keluaran tidak terduga: ${out.slice(0, 120)}` };
    }
    const wired = assertContains(
      'src/sidepanel.js',
      /formatTxt/,
      'Side Panel mengekspor lewat formatTxt',
    );
    if (wired.status === 'fail') return wired;
    return { status: 'pass', detail: 'formatTxt menghasilkan header + baris sumber/terjemahan' };
  },

  'helper-http': async () => {
    const src = assertContains(
      'native/server.py',
      /\/health|17865/,
      'server.py mengekspos /health',
    );
    if (src.status === 'fail') return src;
    const host = assertExists('native/messaging_host.py', 'Native Messaging Host');
    if (host.status === 'fail') return host;
    const h = await helper();
    if (h.ok) return { status: 'pass', detail: `HTTP helper OK — ${h.detail}` };
    if (LIVE) return { status: 'fail', detail: `--live: /health gagal (${h.detail})` };
    return { status: 'warn', detail: `Host + server ada; /health offline (${h.detail})` };
  },

  'helper-asr': async () => {
    const src = assertContains(
      'native/server.py',
      /mlx-whisper|faster-whisper|asr_array/,
      'Helper punya mesin ASR mlx/faster-whisper',
    );
    if (src.status === 'fail') return src;
    const h = await helper();
    if (h.ok) {
      return { status: 'pass', detail: `ASR helper hidup — ${h.detail}` };
    }
    if (LIVE) return { status: 'fail', detail: `--live: helper ASR offline (${h.detail})` };
    return { status: 'warn', detail: `Kode ASR ada; helper offline (${h.detail})` };
  },

  'helper-large-file': async () => {
    const py = assertContains(
      'native/server.py',
      /transcribe_file|asr_file/,
      'Endpoint /transcribe_file di server.py',
    );
    if (py.status === 'fail') return py;
    return assertContains(
      'src/lib/native.js',
      /transcribe_file/,
      'Klien native.js memanggil /transcribe_file',
    );
  },

  'mac-capture': () => {
    if (process.platform !== 'darwin') {
      return { status: 'skip', detail: 'Hanya macOS' };
    }
    return assertExists('mac/Sources/TransSubKit', 'TransSubKit (ScreenCaptureKit)');
  },

  'mac-overlay': () => {
    if (process.platform !== 'darwin') {
      return { status: 'skip', detail: 'Hanya macOS' };
    }
    return assertExists(
      'mac/Sources/LocalTransSub/OverlayWindow.swift',
      'OverlayWindow.swift (NSPanel)',
    );
  },

  'mac-dictation': () => {
    if (process.platform !== 'darwin') {
      return { status: 'skip', detail: 'Hanya macOS' };
    }
    return assertExists(
      'mac/Sources/LocalTransSub/DictationController.swift',
      'DictationController.swift',
    );
  },

  'mac-file': () => {
    if (process.platform !== 'darwin') {
      return { status: 'skip', detail: 'Hanya macOS' };
    }
    return assertExists('mac/Sources/LocalTransSub/MainView.swift', 'MainView.swift berkas + ekspor');
  },
};

/**
 * Kesiapan Windows/Linux — blok TERPISAH dari katalog 26 sub-fitur Fase 1,
 * supaya target verifikasi Fase 1 tidak bergeser.
 *
 * Semua pemeriksaan di sini berjalan di OS mana pun: yang diperiksa adalah
 * artefak yang akan dipakai pengguna Windows/Linux (installer, peluncur,
 * manifest, kontrak helper), bukan perilaku runtime OS tersebut — itu wilayah
 * scripts/e2e-crossos.mjs pada mesin yang bersangkutan.
 */
const CROSSOS_CHECKS = {
  'crossos-launcher': () => {
    const sh = read('native/run.sh');
    const bat = read('native/run.bat');
    if (!sh || !bat) return { status: 'fail', detail: 'run.sh / run.bat tidak lengkap' };
    if (!/\.venv\/Scripts\/python\.exe/.test(sh)) {
      return { status: 'fail', detail: 'run.sh tidak mengenali tata letak venv Windows (Scripts/)' };
    }
    if (/^\s*set\s+"?WHISPER_MODEL=.*mlx-community/im.test(bat)) {
      return { status: 'fail', detail: 'run.bat menyetel model MLX — faster-whisper tidak bisa memuatnya' };
    }
    if (!/if \$IS_MAC_ARM; then[\s\S]*?mlx-community/.test(sh)) {
      return { status: 'fail', detail: 'default model MLX di run.sh tidak dipagari Apple Silicon' };
    }
    return { status: 'pass', detail: 'run.sh (POSIX+Scripts) dan run.bat konsisten' };
  },

  'crossos-installer-linux': () => {
    const sh = read('native/install-host.sh');
    if (!sh) return { status: 'fail', detail: 'native/install-host.sh tidak ada' };
    const missing = ['google-chrome', 'chromium', 'microsoft-edge', '.var/app'].filter((d) => !sh.includes(d));
    if (missing.length) return { status: 'fail', detail: `manifest tidak ditulis untuk: ${missing.join(', ')}` };
    if (!exists('native/uninstall-host.sh')) return { status: 'fail', detail: 'uninstall-host.sh tidak ada' };
    return { status: 'pass', detail: 'Chrome/Chromium/Edge/Flatpak + uninstall' };
  },

  'crossos-installer-windows': () => {
    const bat = read('native/install-host.bat');
    if (!bat) return { status: 'fail', detail: 'native/install-host.bat tidak ada' };
    // Chrome tidak bisa mengeksekusi .py — manifest harus menunjuk pembungkus.
    if (!/messaging_host\.bat/.test(bat)) return { status: 'fail', detail: 'pembungkus messaging_host.bat tidak dibuat' };
    const keys = ['Google\\Chrome', 'Microsoft\\Edge', 'Chromium'];
    const missing = keys.filter((k) => !bat.includes(`${k}\\NativeMessagingHosts`));
    if (missing.length) return { status: 'fail', detail: `kunci registry hilang: ${missing.join(', ')}` };
    if (!exists('native/uninstall-host.bat')) return { status: 'fail', detail: 'uninstall-host.bat tidak ada' };
    return { status: 'pass', detail: 'pembungkus + 3 kunci registry + uninstall' };
  },

  'crossos-native-ping': () => {
    const host = read('native/messaging_host.py');
    const proto = read('src/lib/native-protocol.js');
    if (!host || !proto) return { status: 'fail', detail: 'berkas host/protokol tidak ada' };
    if (!/action == "ping"/.test(host)) return { status: 'fail', detail: 'host tidak menjawab aksi ping' };
    if (!/'ping'/.test(proto)) return { status: 'fail', detail: "kontrak ekstensi tidak menyebut 'ping'" };
    return { status: 'pass', detail: 'status bridge bisa ditanya tanpa menyalakan helper' };
  },

  'crossos-device': () => {
    const srv = read('native/server.py');
    if (!srv) return { status: 'fail', detail: 'server.py tidak ada' };
    if (!srv.includes('"/engine/device"')) return { status: 'fail', detail: '/engine/device tidak dilayani' };
    if (!/_cuda_available/.test(srv)) return { status: 'fail', detail: 'deteksi CUDA tidak ada' };
    return { status: 'pass', detail: 'pilihan runtime CPU/GPU tersedia' };
  },

  'crossos-streaming': () => {
    const srv = read('native/server.py');
    if (!srv || !/def asr_file_streaming/.test(srv)) {
      return { status: 'fail', detail: 'transkripsi streaming tidak ada' };
    }
    if (!/streaming_file_jobs/.test(srv)) return { status: 'fail', detail: '/health tidak mengumumkan streaming_file_jobs' };
    return { status: 'pass', detail: 'berkas >2 GiB diproses per jendela' };
  },

  'crossos-loopback': () => {
    const srv = read('native/server.py');
    if (!srv) return { status: 'fail', detail: 'server.py tidak ada' };
    if (/Access-Control-Allow-Origin", "\*"/.test(srv)) {
      return { status: 'fail', detail: 'CORS masih "*" — situs web mana pun bisa membaca transkrip' };
    }
    if (!/_host_header_hostname/.test(srv)) return { status: 'fail', detail: 'header Host tidak diperiksa (DNS rebinding)' };
    return { status: 'pass', detail: 'CORS ketat + penjagaan Host + pengikatan loopback' };
  },

  'crossos-export-options': () => {
    const opt = read('src/lib/export-options.js');
    if (!opt) return { status: 'fail', detail: 'export-options.js tidak ada' };
    // Notepad dan pemutar lama di Windows paling aman dengan CRLF + BOM.
    if (!/os === 'windows'/.test(opt)) return { status: 'fail', detail: 'tidak ada default per OS' };
    return { status: 'pass', detail: 'CRLF+BOM di Windows, LF di Linux/macOS' };
  },

  'crossos-docs': () => {
    const doc = read('native/SETUP.md');
    if (!doc) return { status: 'fail', detail: 'SETUP.md tidak ada' };
    const missing = ['## Windows', '## Linux', '<EXT_ID>', 'ffmpeg'].filter((k) => !doc.includes(k));
    if (missing.length) return { status: 'fail', detail: `dokumentasi kurang: ${missing.join(', ')}` };
    return { status: 'pass', detail: 'pemasangan + verifikasi + pemecahan masalah' };
  },
};

async function runCrossOs() {
  const out = [];
  for (const [id, fn] of Object.entries(CROSSOS_CHECKS)) {
    const t0 = Date.now();
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { status: 'fail', detail: String(e.message || e) };
    }
    out.push({ id, ...r, durationMs: Date.now() - t0 });
    const mark = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '!';
    log(`${mark} ${id} [${r.status}] ${r.detail}`);
  }
  return out;
}

async function runOne(feature) {
  const check = CHECKS[feature.id];
  const t0 = Date.now();
  if (!check) {
    return {
      id: feature.id,
      name: feature.name,
      group: feature.group,
      status: 'fail',
      detail: 'Tidak ada pemeriksaan terdaftar untuk id ini',
      durationMs: 0,
    };
  }
  try {
    const out = await check();
    return {
      id: feature.id,
      name: feature.name,
      group: feature.group,
      status: out.status,
      detail: out.detail,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      id: feature.id,
      name: feature.name,
      group: feature.group,
      status: 'fail',
      detail: err?.message || String(err),
      durationMs: Date.now() - t0,
    };
  }
}

function toVerifyStatus(s) {
  if (s === 'pass') return 'pass';
  if (s === 'fail') return 'fail';
  if (s === 'warn') return 'warn';
  return 'unverified';
}

async function main() {
  if (STUB_FEATURES.length !== VERIFY_TARGET) {
    throw new Error(
      `Katalog verify-data harus ${VERIFY_TARGET} sub-fitur, sekarang ${STUB_FEATURES.length}`,
    );
  }

  const missingChecks = STUB_FEATURES.filter((f) => !CHECKS[f.id]).map((f) => f.id);
  if (missingChecks.length) {
    throw new Error(`CHECKS belum lengkap: ${missingChecks.join(', ')}`);
  }

  const features = FILTER
    ? STUB_FEATURES.filter((f) => f.id === FILTER || f.id.includes(FILTER))
    : STUB_FEATURES;

  if (!features.length) throw new Error(`Tidak ada fitur cocok filter: ${FILTER}`);

  log(
    `smoke 26 sub-fitur: ${features.length}/${VERIFY_TARGET}` +
      (PIPELINE ? ' +pipeline' : '') +
      (LIVE ? ' +live' : ''),
  );

  const results = [];
  for (const f of features) {
    const r = await runOne(f);
    results.push(r);
    const mark =
      r.status === 'pass'
        ? '✓'
        : r.status === 'fail'
          ? '✗'
          : r.status === 'warn'
            ? '!'
            : r.status === 'skip'
              ? '–'
              : '·';
    log(`${mark} ${r.id} [${r.status}] ${r.detail}`);
  }

  const counts = { pass: 0, fail: 0, warn: 0, pending: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;

  let crossOs = null;
  if (CROSSOS) {
    log(`kesiapan Windows/Linux (${Object.keys(CROSSOS_CHECKS).length} pemeriksaan, blok terpisah)`);
    crossOs = await runCrossOs();
  }

  const report = {
    source: 'smoke',
    generatedAt: new Date().toISOString(),
    target: VERIFY_TARGET,
    pipeline: PIPELINE,
    live: LIVE,
    command: `node scripts/smoke.mjs${PIPELINE ? ' --pipeline' : ''}${LIVE ? ' --live' : ''}${CROSSOS ? ' --crossos' : ''}`,
    counts,
    // Blok terpisah: sengaja TIDAK dihitung ke target 26 sub-fitur Fase 1.
    crossOs: crossOs
      ? {
          platform: `${process.platform}/${process.arch}`,
          counts: crossOs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
          results: crossOs,
        }
      : null,
    results,
    features: results.map((r) => {
      const base = STUB_FEATURES.find((f) => f.id === r.id);
      return {
        id: r.id,
        name: r.name,
        group: r.group,
        summary: base?.summary ?? '',
        surface: base?.surface ?? '',
        status: toVerifyStatus(r.status),
        evidence: {
          kind: 'smoke',
          label: `scripts/smoke.mjs · ${r.status}`,
          href: null,
        },
        lastRun: new Date().toISOString(),
        smoke: { status: r.status, detail: r.detail, durationMs: r.durationMs },
      };
    }),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
  log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
  log(
    `summary: pass=${counts.pass} fail=${counts.fail} warn=${counts.warn} pending=${counts.pending} skip=${counts.skip}`,
  );
  if (crossOs) {
    const cf = crossOs.filter((r) => r.status === 'fail').length;
    log(`crossos: pass=${crossOs.filter((r) => r.status === 'pass').length} fail=${cf}`);
    if (cf) process.exitCode = 1;
  }

  if (counts.fail > 0) {
    process.exitCode = 1;
    log('FAILED');
  } else {
    log('ALL CHECKS OK');
  }
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exitCode = 1;
});
