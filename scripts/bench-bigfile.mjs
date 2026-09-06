#!/usr/bin/env node
/**
 * Benchmark berkas >2 GiB — memverifikasi klaim yang sebenarnya dibuat fitur
 * transkripsi streaming: pemakaian memori TIDAK ikut membesar bersama berkas.
 *
 * Cara membuktikannya: jalankan dekode streaming yang sama pada berkas
 * pembanding dan pada berkas >2 GiB, lalu bandingkan puncak RSS-nya. Keduanya
 * harus sama-sama melewati beberapa jendela. Kalau memori memang
 * O(jendela), keduanya nyaris sama; kalau berkas dimuat utuh (perilaku lama),
 * yang besar akan meledak.
 *
 * Yang TIDAK diukur di sini: wall-clock Whisper untuk seluruh berkas. Berkas
 * 2,5 GiB berisi ±4 jam audio dan butuh berjam-jam untuk ditranskrip penuh;
 * benchmark yang jujur mengukur bagian yang diklaim — I/O dan memori — lalu
 * memakai potongan pendek untuk membuktikan rantai ASR-nya tetap utuh.
 *
 * Usage:
 *   node scripts/bench-bigfile.mjs                  # buat berkas 2,5 GiB lalu ukur
 *   node scripts/bench-bigfile.mjs --size-gib 3
 *   node scripts/bench-bigfile.mjs --file /path/besar.wav   # pakai berkas sendiri
 *   node scripts/bench-bigfile.mjs --keep            # jangan hapus berkas yang dibuat
 *   node scripts/bench-bigfile.mjs --upload          # + unggah HTTP >2 GiB ke helper
 *                                                    # (butuh helper hidup + ruang disk 2×)
 *
 * Menulis test/last-bigfile-bench.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'test', 'last-bigfile-bench.json');
const PY = fs.existsSync(path.join(ROOT, 'native', '.venv', 'bin', 'python'))
  ? path.join(ROOT, 'native', '.venv', 'bin', 'python')
  : 'python3';
const PROBE = path.join(ROOT, 'scripts', 'bench-bigfile-probe.py');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const SIZE_GIB = Number(arg('--size-gib', '2.5'));
const USER_FILE = arg('--file', null);
const KEEP = process.argv.includes('--keep');
const UPLOAD = process.argv.includes('--upload');
const HELPER = process.env.NATIVE_URL || 'http://127.0.0.1:17865';

const log = (...a) => console.log('[bench-bigfile]', ...a);
const GIB = 1024 ** 3;

function ffmpegBin() {
  const r = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  const w = spawnSync('where', ['ffmpeg'], { encoding: 'utf8' });
  return w.status === 0 ? w.stdout.split(/\r?\n/)[0].trim() : null;
}

/** Ruang kosong pada volume yang memuat `dir`, dalam byte. */
function freeBytes(dir) {
  try {
    return fs.statfsSync(dir).bavail * fs.statfsSync(dir).bsize;
  } catch {
    return Infinity; // Node lama: biarkan ffmpeg sendiri yang gagal.
  }
}

/** WAV PCM sintetis berdurasi tepat agar ukurannya mendekati target. */
function makeBigWav(bin, targetBytes, dir, tag = 'bigfile') {
  const bytesPerSec = 44100 * 2 * 2; // 44,1 kHz stereo s16
  const seconds = Math.ceil(targetBytes / bytesPerSec);
  const out = path.join(dir, `${tag}-${(targetBytes / GIB).toFixed(2)}gib.wav`);
  log(`membuat ${(targetBytes / GIB).toFixed(2)} GiB (${(seconds / 3600).toFixed(2)} jam audio) → ${out}`);
  const t0 = Date.now();
  const r = spawnSync(
    bin,
    ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i',
      `sine=frequency=220:sample_rate=44100:duration=${seconds}`,
      '-ac', '2', '-c:a', 'pcm_s16le', out, '-y'],
    { encoding: 'utf8', timeout: 30 * 60_000 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg gagal membuat berkas: ${r.stderr || r.error}`);
  log(`selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);
  return out;
}

/**
 * Unggah berkas ke helper memakai Content-Length eksplisit.
 *
 * fetch() akan memakai Transfer-Encoding: chunked untuk body berupa stream,
 * sedangkan helper membaca Content-Length — jadi http.request dipakai supaya
 * yang diuji benar-benar bentuk permintaan yang dikirim ekstensi (XHR + Blob).
 */
function uploadJob(file) {
  const size = fs.statSync(file).size;
  const u = new URL(`${HELPER}/transcribe_file_job`);
  u.searchParams.set('language', 'en');
  u.searchParams.set('task', 'transcribe');
  u.searchParams.set('filename', path.basename(file));
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    fs.createReadStream(file).pipe(req);
  });
}

function probe(file) {
  const r = spawnSync(PY, [PROBE, file], { encoding: 'utf8', timeout: 60 * 60_000, cwd: ROOT });
  if (r.status !== 0) throw new Error(`probe gagal: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

async function main() {
  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg tidak ada di PATH — benchmark ini mendekode media sungguhan');

  let big = USER_FILE;
  let created = null;
  const workDir = os.tmpdir();
  if (!big) {
    const need = SIZE_GIB * GIB * 1.05;
    const free = freeBytes(workDir);
    if (free < need) {
      throw new Error(
        `butuh ~${(need / GIB).toFixed(1)} GiB kosong di ${workDir}, tersedia ${(free / GIB).toFixed(1)} GiB. ` +
          `Pakai --size-gib lebih kecil, atau --file untuk berkas besar yang sudah ada.`,
      );
    }
    big = created = makeBigWav(bin, SIZE_GIB * GIB, workDir);
  }
  // Pembanding harus SAMA-SAMA melewati beberapa jendela. Berkas yang lebih
  // pendek dari satu jendela hanya mengukur baseline interpreter, bukan biaya
  // penjendelaan, sehingga rasionya menyesatkan.
  const baselineGib = 0.15;
  const baseline = makeBigWav(bin, baselineGib * GIB, workDir, 'baseline');

  const bigBytes = fs.statSync(big).size;
  if (bigBytes <= 2 * GIB) {
    log(`⚠ berkas ${(bigBytes / GIB).toFixed(2)} GiB TIDAK di atas 2 GiB — klaimnya tidak teruji`);
  }

  try {
    log(`mengukur pembanding (${baselineGib} GiB)…`);
    const a = probe(baseline);
    log(`  ${a.windows} jendela → puncak RSS ${a.peak_rss_mb.toFixed(0)} MB`);

    log(`mengukur berkas besar (${(bigBytes / GIB).toFixed(2)} GiB)…`);
    const b = probe(big);
    const mibPerSec = b.file_bytes / 1024 ** 2 / b.elapsed_s;
    const xRealtime = b.audio_seconds / b.elapsed_s;
    log(
      `  ${b.windows} jendela · ${(b.audio_seconds / 3600).toFixed(2)} jam audio · ` +
        `${b.elapsed_s.toFixed(1)} dtk · ${mibPerSec.toFixed(0)} MiB/dtk · ${xRealtime.toFixed(0)}× realtime`,
    );
    log(`  puncak RSS ${b.peak_rss_mb.toFixed(0)} MB`);

    // --- penilaian --------------------------------------------------------
    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, status: ok ? 'pass' : 'fail', detail });

    add('over-2gib', bigBytes > 2 * GIB, `${(bigBytes / GIB).toFixed(2)} GiB`);

    // Bukti utama: memori tidak ikut membesar. Ambang 1,5× memberi ruang untuk
    // derau alokasi; kegagalan sesungguhnya (berkas dimuat utuh) berbeda
    // ratusan kali lipat, jadi tidak akan lolos secara kebetulan.
    const sizeRatio = bigBytes / a.file_bytes;
    const ratio = b.peak_rss_mb / Math.max(1, a.peak_rss_mb);
    add(
      'memori-datar',
      ratio < 1.5,
      `berkas ${sizeRatio.toFixed(0)}× lebih besar, puncak RSS hanya ${ratio.toFixed(2)}× ` +
        `(${b.peak_rss_mb.toFixed(0)} MB vs ${a.peak_rss_mb.toFixed(0)} MB)`,
    );

    // Jendela dibatasi (chunk + overlap), bukan seukuran berkas.
    const capSamples = (b.chunk_sec + b.overlap_sec) * 16000;
    add('jendela-dibatasi', b.max_window_samples <= capSamples,
      `jendela terbesar ${b.max_window_samples} sampel ≤ batas ${capSamples}`);

    // Seluruh berkas benar-benar dibaca, bukan berhenti di tengah.
    const expectedSeconds = bigBytes / (44100 * 2 * 2);
    const covered = USER_FILE ? 1 : b.audio_seconds / expectedSeconds;
    add('berkas-habis-dibaca', USER_FILE ? b.audio_seconds > 0 : covered > 0.99,
      USER_FILE ? `${(b.audio_seconds / 3600).toFixed(2)} jam terbaca` : `${(covered * 100).toFixed(1)}% durasi terbaca`);

    // --- jalur unggah HTTP (opsional) -------------------------------------
    // Separuh lain dari klaim ">2 GiB": ekstensi mengalirkan berkas ke helper.
    // Pemotongan 32-bit di sini akan merusak berkas tanpa pesan galat.
    let upload = null;
    if (UPLOAD) {
      log(`mengunggah ${(bigBytes / GIB).toFixed(2)} GiB ke ${HELPER}…`);
      const tUp = Date.now();
      const res = await uploadJob(big);
      const upSec = (Date.now() - tUp) / 1000;
      if (res.status !== 202) {
        add('unggah-2gib', false, `helper menjawab ${res.status}: ${res.body.slice(0, 200)}`);
      } else {
        const { jobId } = JSON.parse(res.body);
        const job = await (await fetch(`${HELPER}/jobs/${jobId}`)).json();
        // Batalkan segera: mentranskrip 4 jam audio bukan yang diukur di sini.
        await fetch(`${HELPER}/jobs/${jobId}/cancel`, { method: 'POST' });
        add('unggah-2gib', job.sizeBytes === bigBytes,
          `helper menerima ${job.sizeBytes} byte dari ${bigBytes} (${(bigBytes / GIB).toFixed(2)} GiB, ` +
            `${upSec.toFixed(1)} dtk, ${(bigBytes / 1024 ** 2 / upSec).toFixed(0)} MiB/dtk)`);
        upload = { bytesReceived: job.sizeBytes, seconds: upSec, streaming: job.streaming };
      }
    }

    const failed = checks.filter((c) => c.status === 'fail');
    for (const c of checks) log(`${c.status === 'pass' ? '✓' : '✗'} ${c.id} — ${c.detail}`);

    const report = {
      source: 'bench-bigfile',
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}/${process.arch}`,
      status: failed.length ? 'fail' : 'pass',
      command: `node scripts/bench-bigfile.mjs${USER_FILE ? ` --file ${USER_FILE}` : ` --size-gib ${SIZE_GIB}`}`,
      measures: {
        big: { ...b, gib: bigBytes / GIB, mibPerSec, xRealtime },
        baseline: { ...a, gib: a.file_bytes / GIB },
        sizeRatio,
        rssRatio: ratio,
        upload,
      },
      checks,
      // Dicatat eksplisit supaya laporan ini tidak dibaca sebagai klaim yang
      // lebih besar daripada yang benar-benar diukur.
      notMeasured: 'wall-clock ASR seluruh berkas (±4 jam audio); yang diukur adalah I/O dan memori jalur streaming',
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    log(`wrote ${path.relative(ROOT, OUT)}`);
    log(failed.length ? `GAGAL: ${failed.map((c) => c.id).join(', ')}` : 'SEMUA PEMERIKSAAN OK');
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    fs.rmSync(baseline, { force: true });
    if (created && !KEEP) {
      fs.rmSync(created, { force: true });
      log(`berkas sementara dihapus (${path.basename(created)}) — pakai --keep untuk menyimpannya`);
    }
  }
}

main().catch((e) => {
  console.error('[bench-bigfile] GAGAL:', e.message);
  process.exitCode = 1;
});
