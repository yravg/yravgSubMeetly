#!/usr/bin/env node
/**
 * Benchmark kinerja model lokal (browser transformers.js + native helper).
 *
 * Usage:
 *   node scripts/bench-models.mjs                 # gabung last-bench + ukur browser bila cache/HF ada
 *   node scripts/bench-models.mjs --browser       # paksa ukur Whisper Tiny (q8) di Node
 *   node scripts/bench-models.mjs --native        # jalankan scripts/bench-lab.py bila helper hidup
 *   node scripts/bench-models.mjs --catalog-only  # tanpa inferensi: katalog + last-bench.json
 *
 * Menulis test/last-models-bench.json (bentuk untuk test/bench.html / laporan pembanding).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { STUB_MODELS, TARGET_DRAFT_MS, mergeLastBench, STUB_BENCH } from '../test/bench-models-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'test', 'last-models-bench.json');
const LAST_NATIVE = path.join(ROOT, 'test', 'last-bench.json');
const SAMPLE = path.join(ROOT, 'test', 'samples', 'en-zh-1.wav');
const SPEECH = path.join(ROOT, 'test', 'speech.wav');

const WANT_BROWSER = process.argv.includes('--browser');
const WANT_NATIVE = process.argv.includes('--native');
const CATALOG_ONLY = process.argv.includes('--catalog-only');
const DEFAULT = !WANT_BROWSER && !WANT_NATIVE && !CATALOG_ONLY;

const log = (...a) => console.log('[bench-models]', ...a);

function statusFromMs(ms, target = TARGET_DRAFT_MS) {
  if (ms == null) return 'unverified';
  if (ms <= target) return 'pass';
  if (ms <= target * 1.8) return 'warn';
  return 'fail';
}

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function probeNative() {
  try {
    const r = await fetch('http://127.0.0.1:17865/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function runNativeBenchLab() {
  const py = path.join(ROOT, 'scripts', 'bench-lab.py');
  log('menjalankan bench-lab.py → test/last-bench.json');
  const r = spawnSync(process.env.PYTHON || 'python3', [py, '--json', LAST_NATIVE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 600_000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`bench-lab.py exit ${r.status}`);
  }
  return loadJson(LAST_NATIVE);
}

/** Baca WAV mono 16-bit → Float32Array PCM (tanpa resampling). */
function readWavPcm(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${filePath}: bukan WAV`);
  // Cari chunk 'data'
  let offset = 12;
  let dataOffset = null;
  let dataSize = 0;
  let sampleRate = 16000;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset == null) throw new Error('WAV data chunk missing');
  if (bits !== 16) throw new Error(`need 16-bit PCM, got ${bits}`);
  const samples = dataSize / 2;
  const i16 = new Int16Array(buf.buffer, buf.byteOffset + dataOffset, samples);
  const mono = new Float32Array(channels === 1 ? samples : Math.floor(samples / channels));
  if (channels === 1) {
    for (let i = 0; i < samples; i++) mono[i] = i16[i] / 32768;
  } else {
    for (let i = 0, j = 0; j < mono.length; i += channels, j++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += i16[i + c];
      mono[j] = s / channels / 32768;
    }
  }
  return { pcm: mono, sampleRate, durationSec: mono.length / sampleRate };
}

async function benchBrowserWhisperTiny() {
  const wavPath = fs.existsSync(SAMPLE) ? SAMPLE : SPEECH;
  if (!fs.existsSync(wavPath)) {
    return {
      id: 'whisper-tiny-wasm',
      error: 'Tidak ada berkas sampel WAV',
      status: 'fail',
    };
  }
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(__dirname, '.hf-cache');
  log('memuat onnx-community/whisper-tiny (q8)…');
  const tLoad0 = Date.now();
  const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  });
  const loadMs = Date.now() - tLoad0;
  log(`whisper-tiny loaded in ${loadMs}ms`);

  const { pcm, durationSec } = readWavPcm(wavPath);
  // Batasi ~4 dtk agar cepat
  const maxSamples = Math.min(pcm.length, 16000 * 4);
  const clip = pcm.subarray(0, maxSamples);
  const clipDur = maxSamples / 16000;

  const t0 = Date.now();
  const out = await asr(clip, { task: 'transcribe', language: 'en', return_timestamps: false });
  const asrMs = Date.now() - t0;
  const text = typeof out?.text === 'string' ? out.text : '';
  const rtf = Number((asrMs / 1000 / clipDur).toFixed(3));
  log(`ASR ${asrMs}ms rtf=${rtf} → ${text.slice(0, 80)}`);

  return {
    id: 'whisper-tiny-wasm',
    name: 'Whisper Tiny',
    engine: 'browser',
    device: 'WASM q8 (Node)',
    size: '~45 MB',
    draftMs: asrMs,
    asrMs,
    mtMs: null,
    rtf,
    loadMs,
    status: statusFromMs(asrMs, 2000),
    note: `Live Node bench · ${path.basename(wavPath)} ${clipDur.toFixed(1)}s · "${text.slice(0, 60)}"`,
    text,
  };
}

async function benchBrowserOpus() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(__dirname, '.hf-cache');
  log('memuat Xenova/opus-mt-ja-en (q8)…');
  const tLoad0 = Date.now();
  const mt = await pipeline('translation', 'Xenova/opus-mt-ja-en', { dtype: 'q8' });
  const loadMs = Date.now() - tLoad0;
  const sample = 'こんにちは、世界。今日はいい天気ですね。';
  const t0 = Date.now();
  const tr = await mt(sample);
  const mtMs = Date.now() - t0;
  const text = tr?.[0]?.translation_text || '';
  log(`Opus-MT ${mtMs}ms → ${text.slice(0, 80)}`);
  return {
    id: 'opus-mt-wasm',
    name: 'Opus-MT (per pasangan)',
    engine: 'browser',
    device: 'WASM q8 (Node)',
    size: '~115 MB / pasangan',
    draftMs: null,
    asrMs: null,
    mtMs,
    rtf: null,
    loadMs,
    status: statusFromMs(mtMs, 500),
    note: `Live Node bench · ja→en · "${text.slice(0, 60)}"`,
    text,
  };
}

async function main() {
  let nativeBench = loadJson(LAST_NATIVE);
  const health = await probeNative();

  if ((WANT_NATIVE || (DEFAULT && health)) && !CATALOG_ONLY) {
    if (!health) {
      log('helper offline — lewati --native (pakai last-bench.json bila ada)');
    } else {
      try {
        nativeBench = runNativeBenchLab();
      } catch (err) {
        log('bench-lab gagal:', err.message, '— lanjut dengan last-bench yang ada');
      }
    }
  }

  /** @type {any[]} */
  let models = STUB_MODELS.map((m) => ({ ...m }));
  let source = 'catalog';

  if (nativeBench) {
    const merged = mergeLastBench(
      { ...STUB_BENCH, models, source: 'bench-models' },
      nativeBench,
    );
    models = merged.models;
    source = 'catalog+last-bench';
  }

  const live = [];
  if ((WANT_BROWSER || DEFAULT) && !CATALOG_ONLY) {
    try {
      const tiny = await benchBrowserWhisperTiny();
      live.push(tiny);
      models = models.map((m) => (m.id === tiny.id ? { ...m, ...tiny } : m));
      source = source.includes('live') ? source : source + '+live-browser';
    } catch (err) {
      log('browser whisper-tiny gagal:', err.message);
      live.push({ id: 'whisper-tiny-wasm', error: err.message, status: 'fail' });
    }
    if (WANT_BROWSER) {
      try {
        const opus = await benchBrowserOpus();
        live.push(opus);
        models = models.map((m) => (m.id === opus.id ? { ...m, ...opus } : m));
      } catch (err) {
        log('browser opus gagal:', err.message);
      }
    }
  }

  const report = {
    source,
    generatedAt: new Date().toISOString(),
    targetDraftMs: TARGET_DRAFT_MS,
    models,
    live,
    nativeRows: nativeBench?.rows || [],
    nativeHealth: nativeBench?.health || health,
    nativeAt: nativeBench?.at || null,
    command: `node scripts/bench-models.mjs${WANT_BROWSER ? ' --browser' : ''}${WANT_NATIVE ? ' --native' : ''}${CATALOG_ONLY ? ' --catalog-only' : ''}`,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  log('wrote', path.relative(ROOT, OUT));
  log(
    `models=${models.length} live=${live.length} nativeRows=${report.nativeRows.length} source=${source}`,
  );

  const fails = models.filter((m) => m.status === 'fail').length;
  if (fails && WANT_BROWSER) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[bench-models] fatal:', err);
  process.exitCode = 1;
});
