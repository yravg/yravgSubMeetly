#!/usr/bin/env node
/**
 * E2E lintas-OS — jalur yang harus bekerja sama di Windows, Linux, dan macOS.
 *
 * Berbeda dari e2e.mjs (butuh Chrome headed) dan e2e-file.mjs (kontrak format),
 * skrip ini menempuh rantai nyata dari ujung ke ujung tanpa browser:
 *
 *   berkas media → job helper (streaming) → segmen → ekspor SRT/VTT
 *                → dibaca ulang ffmpeg
 *
 * Ekspornya diverifikasi oleh pembaca sungguhan, bukan regex: berkas subtitel
 * yang "kelihatan benar" tapi ditolak ffmpeg pernah lolos berkali-kali.
 * Ditambah dua pemeriksaan yang tidak bergantung OS tapi menentukan kelayakan
 * rilis Windows/Linux: pembatasan loopback dan bridge Native Messaging.
 *
 * Usage:
 *   node scripts/e2e-crossos.mjs                # penuh (butuh helper hidup)
 *   node scripts/e2e-crossos.mjs --harness-only # hanya prasyarat
 *
 * Menulis/menggabung suite `e2e-crossos` ke test/last-e2e.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatSrt, formatVtt } from '../src/lib/transcript-cache.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = path.join(root, 'test', 'last-e2e.json');
const HELPER = process.env.NATIVE_URL || 'http://127.0.0.1:17865';
const SAMPLE = process.env.E2E_SAMPLE || path.join(root, 'test', 'speech.wav');
const HARNESS_ONLY = process.argv.includes('--harness-only');
const suiteId = 'e2e-crossos';

const checks = [];
const logLines = [];
const log = (...a) => {
  const line = a.join(' ');
  logLines.push(line);
  console.log('[e2e-crossos]', line);
};
const pass = (id, name, detail = 'ok') => checks.push({ id, name, status: 'pass', detail });
const warn = (id, name, detail) => checks.push({ id, name, status: 'warn', detail });
const fail = (id, name, detail) => {
  checks.push({ id, name, status: 'fail', detail });
  throw new Error(`${id}: ${detail}`);
};

function ffmpegBin() {
  const r = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  // Windows tanpa shell POSIX.
  const w = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  return w.status === 0 ? w.stdout.split(/\r?\n/)[0].trim() : null;
}

/** Berapa cue yang benar-benar bisa dibaca ffmpeg kembali dari berkas ini. */
function cuesReadBack(bin, text, ext) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lts-e2e-')), `sub.${ext}`);
  fs.writeFileSync(p, text);
  const r = spawnSync(bin, ['-hide_banner', '-v', 'error', '-i', p, '-f', 'srt', '-'], { encoding: 'utf8' });
  return (r.stdout.match(/^\d+$/gm) || []).length;
}

async function main() {
  const t0 = Date.now();
  log(`platform=${process.platform} arch=${process.arch}`);

  // ---- prasyarat ---------------------------------------------------------
  const bin = ffmpegBin();
  if (!bin) fail('crossos-ffmpeg', 'ffmpeg tersedia', 'ffmpeg tidak ada di PATH — transkripsi berkas tidak akan jalan');
  pass('crossos-ffmpeg', 'ffmpeg tersedia', bin);

  if (!fs.existsSync(SAMPLE)) fail('crossos-sample', 'Sampel media ada', `${SAMPLE} tidak ditemukan`);
  pass('crossos-sample', 'Sampel media ada', path.relative(root, SAMPLE));

  let health = null;
  try {
    const r = await fetch(`${HELPER}/health`, { signal: AbortSignal.timeout(4000) });
    health = await r.json();
  } catch {
    health = null;
  }
  if (!health) {
    if (HARNESS_ONLY) {
      warn('crossos-helper', 'Helper hidup', `${HELPER} tidak menjawab — jalankan native/run.sh (run.bat di Windows)`);
      return { status: 'warn', durationMs: Date.now() - t0 };
    }
    fail('crossos-helper', 'Helper hidup', `${HELPER} tidak menjawab`);
  }
  pass('crossos-helper', 'Helper hidup', `engine=${health.engine} model=${health.model}`);

  // Engine yang dipakai memang yang benar untuk OS ini.
  const expected = process.platform === 'darwin' && process.arch === 'arm64' ? 'mlx-whisper' : 'faster-whisper';
  if (health.engine !== expected) {
    warn('crossos-engine', 'Engine sesuai platform', `dapat ${health.engine}, diharapkan ${expected}`);
  } else {
    pass('crossos-engine', 'Engine sesuai platform', health.engine);
  }

  if (health.ffmpeg !== true) fail('crossos-helper-ffmpeg', 'Helper menemukan ffmpeg', 'health.ffmpeg=false');
  pass('crossos-helper-ffmpeg', 'Helper menemukan ffmpeg');

  if (HARNESS_ONLY) return { status: 'pass', durationMs: Date.now() - t0 };

  // ---- pembatasan loopback ----------------------------------------------
  // Menentukan kelayakan rilis di OS mana pun: helper tanpa autentikasi tidak
  // boleh bisa dibaca situs web yang kebetulan dibuka pengguna.
  const evil = await fetch(`${HELPER}/health`, { headers: { Origin: 'https://evil.example' } });
  if (evil.status !== 403) fail('crossos-loopback', 'Asal web ditolak', `situs web mendapat ${evil.status}, seharusnya 403`);
  pass('crossos-loopback', 'Asal web ditolak', '403');

  // ---- job berkas → segmen ----------------------------------------------
  const body = fs.readFileSync(SAMPLE);
  const q = new URLSearchParams({ language: 'en', task: 'transcribe', filename: path.basename(SAMPLE) });
  const started = await fetch(`${HELPER}/transcribe_file_job?${q}`, { method: 'POST', body });
  if (started.status !== 202) fail('crossos-job', 'Job berkas diterima', `status ${started.status}`);
  const { jobId } = await started.json();
  log(`job ${jobId}`);

  let job = null;
  const deadline = Date.now() + 300_000;
  let sawProgress = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    job = await (await fetch(`${HELPER}/jobs/${jobId}`)).json();
    if (job.progress > 0 && job.progress < 1) sawProgress = true;
    if (job.status === 'done' || job.status === 'error') break;
  }
  if (!job || job.status !== 'done') fail('crossos-job', 'Job berkas selesai', `status=${job?.status} error=${job?.error}`);
  const segs = job.segments || [];
  if (!segs.length) fail('crossos-job', 'Job berkas selesai', 'tidak ada segmen');
  pass('crossos-job', 'Job berkas selesai', `${segs.length} segmen, progress terlihat=${sawProgress}`);

  // Stempel waktu harus waras — inilah yang merusak ekspor.
  const bad = segs.filter((s) => !(s.end > s.start) || !Number.isFinite(s.start) || !Number.isFinite(s.end));
  if (bad.length) fail('crossos-times', 'Stempel waktu waras', `${bad.length} segmen dengan durasi tidak positif/NaN`);
  pass('crossos-times', 'Stempel waktu waras', `max end=${Math.max(...segs.map((s) => s.end)).toFixed(2)}s`);

  // ---- ekspor → dibaca ulang pembaca sungguhan ---------------------------
  const cues = segs.map((s) => ({ t0: s.start, t1: s.end, tgt: s.text }));
  for (const [kind, text] of [
    ['srt', formatSrt(cues, { title: 'E2E lintas-OS' })],
    ['vtt', formatVtt(cues, { title: 'E2E lintas-OS' })],
  ]) {
    if (/NaN/.test(text)) fail(`crossos-export-${kind}`, `Ekspor ${kind.toUpperCase()}`, 'berisi NaN');
    const n = cuesReadBack(bin, text, kind);
    // Jumlahnya boleh berbeda dari segmen (cue panjang dipecah), yang penting
    // ffmpeg tidak kehilangan isinya — dulu header VTT membuat cue hilang.
    if (n === 0) fail(`crossos-export-${kind}`, `Ekspor ${kind.toUpperCase()} bisa dibaca ffmpeg`, 'ffmpeg tidak membaca satu cue pun');
    pass(`crossos-export-${kind}`, `Ekspor ${kind.toUpperCase()} bisa dibaca ffmpeg`, `${n} cue terbaca`);
  }

  return { status: 'pass', durationMs: Date.now() - t0 };
}

function writeReport({ status, durationMs, error = null }) {
  const prev = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : { source: 'e2e', suites: [] };
  const suite = {
    id: suiteId,
    kind: 'e2e',
    name: 'E2E lintas-OS (helper → job → ekspor → ffmpeg)',
    command: `node scripts/e2e-crossos.mjs${HARNESS_ONLY ? ' --harness-only' : ''}`,
    script: 'scripts/e2e-crossos.mjs',
    status,
    durationMs,
    lastRun: new Date().toISOString(),
    platform: `${process.platform}/${process.arch}`,
    covers: 'job berkas streaming, stempel waktu, ekspor SRT/VTT diverifikasi ffmpeg, pembatasan loopback',
    checks: [...checks],
    log: [...logLines],
    error,
  };
  const suites = Array.isArray(prev.suites) ? prev.suites.filter((s) => s.id !== suiteId) : [];
  suites.push(suite);
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify({ source: 'e2e', generatedAt: new Date().toISOString(), mode: suiteId, suites }, null, 2),
  );
  console.log(`[e2e-crossos] wrote ${path.relative(root, OUT_PATH)}`);
}

main()
  .then((r) => {
    writeReport(r);
    const failed = checks.filter((c) => c.status === 'fail').length;
    console.log(`[e2e-crossos] summary: pass=${checks.filter((c) => c.status === 'pass').length} warn=${checks.filter((c) => c.status === 'warn').length} fail=${failed}`);
    process.exitCode = failed ? 1 : 0;
  })
  .catch((e) => {
    writeReport({ status: 'fail', durationMs: 0, error: String(e.message || e) });
    console.error('[e2e-crossos] FAILED:', e.message);
    process.exitCode = 1;
  });
