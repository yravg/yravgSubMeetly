#!/usr/bin/env node
/**
 * Benchmark berkas >2 GiB pada engine Rust — memverifikasi klaim fitur
 * streaming: pemakaian memori engine TIDAK ikut membesar bersama berkas.
 *
 * Cara: untuk berkas pembanding (0,15 GiB) dan berkas >2 GiB, nyalakan engine
 * baru di port bebas, unggah berkas sebagai job (`POST /transcribe_file_job`,
 * body distream ke disk, Content-Length eksplisit), lalu ambil puncak RSS proses
 * engine selama unggah dan beberapa detik pertama job. Memori O(jendela) berarti
 * kedua puncak nyaris sama; berkas dimuat utuh berarti yang besar meledak.
 *
 * Yang TIDAK diukur: wall-clock Whisper seluruh berkas (±4 jam audio) dan RSS
 * per jendela ASR — yang terakhir dijaga tes Rust (merge_window, streaming di
 * engine-rs). ffmpeg hanya dipakai untuk MEMBUAT berkas uji, bukan oleh engine.
 *
 * Usage:
 *   node scripts/bench-bigfile.mjs                  # buat berkas 2,5 GiB lalu ukur
 *   node scripts/bench-bigfile.mjs --size-gib 3
 *   node scripts/bench-bigfile.mjs --file /path/besar.wav
 *   node scripts/bench-bigfile.mjs --keep           # jangan hapus berkas yang dibuat
 *   (--upload diterima demi kompatibilitas; unggah kini selalu dilakukan)
 *
 * Butuh biner engine (lihat test/engine-bin.mjs) dan ruang disk ±2× ukuran berkas.
 * Menulis test/last-bigfile-bench.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startEngine, engineBinary, BUILD_HINT } from '../test/engine-bin.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'test', 'last-bigfile-bench.json');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const SIZE_GIB = Number(arg('--size-gib', '2.5'));
const USER_FILE = arg('--file', null);
const KEEP = process.argv.includes('--keep');

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
function uploadJob(HELPER, file) {
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

/** Resident set size (MB) proses `pid`, atau 0 bila tak terbaca. */
function rssMb(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const kb = Number((r.stdout.match(/"([d.,]+) K"s*$/m) || [])[1]?.replace(/[.,]/g, ''));
    return kb / 1024 || 0;
  }
  const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  return Number(r.stdout.trim()) / 1024 || 0;
}

/** Engine baru → unggah `file` sebagai job → puncak RSS engine. */
async function measure(file) {
  const eng = await startEngine();
  let peak = rssMb(eng.pid);
  const timer = setInterval(() => { peak = Math.max(peak, rssMb(eng.pid)); }, 100);
  try {
    const size = fs.statSync(file).size;
    const t0 = Date.now();
    const res = await uploadJob(eng.url, file);
    const upload_s = (Date.now() - t0) / 1000;
    if (res.status !== 202) throw new Error(`engine menjawab ${res.status}: ${res.body.slice(0, 200)}`);
    const { jobId } = JSON.parse(res.body);
    const job = await (await fetch(`${eng.url}/jobs/${jobId}`)).json();
    // Beri job beberapa detik membaca jendela pertama, lalu batalkan.
    await new Promise((r) => setTimeout(r, 5000));
    await fetch(`${eng.url}/jobs/${jobId}/cancel`, { method: 'POST' });
    peak = Math.max(peak, rssMb(eng.pid));
    return { file_bytes: size, received_bytes: job.sizeBytes, streaming: job.streaming, upload_s, peak_rss_mb: peak };
  } finally {
    clearInterval(timer);
    eng.stop();
  }
}

async function main() {
  if (!engineBinary()) throw new Error(`biner engine tidak ada — bangun: ${BUILD_HINT}`);
  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg tidak ada di PATH — diperlukan untuk membuat berkas uji');

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
    const a = await measure(baseline);
    log(`  unggah ${a.upload_s.toFixed(1)} dtk → puncak RSS ${a.peak_rss_mb.toFixed(0)} MB`);

    log(`mengukur berkas besar (${(bigBytes / GIB).toFixed(2)} GiB)…`);
    const b = await measure(big);
    const mibPerSec = bigBytes / 1024 ** 2 / b.upload_s;
    log(`  unggah ${b.upload_s.toFixed(1)} dtk · ${mibPerSec.toFixed(0)} MiB/dtk · puncak RSS ${b.peak_rss_mb.toFixed(0)} MB`);

    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, status: ok ? 'pass' : 'fail', detail });

    add('over-2gib', bigBytes > 2 * GIB, `${(bigBytes / GIB).toFixed(2)} GiB`);

    // Ambang 1,5× memberi ruang untuk derau alokasi; berkas dimuat utuh
    // berbeda ratusan kali lipat, jadi tidak lolos secara kebetulan.
    const sizeRatio = bigBytes / a.file_bytes;
    const ratio = b.peak_rss_mb / Math.max(1, a.peak_rss_mb);
    add(
      'memori-datar',
      a.peak_rss_mb > 0 && b.peak_rss_mb > 0 && ratio < 1.5,
      `berkas ${sizeRatio.toFixed(0)}× lebih besar, puncak RSS hanya ${ratio.toFixed(2)}× ` +
        `(${b.peak_rss_mb.toFixed(0)} MB vs ${a.peak_rss_mb.toFixed(0)} MB)`,
    );

    // Pemotongan 32-bit di jalur unggah merusak berkas tanpa pesan galat.
    add('unggah-utuh', b.received_bytes === bigBytes,
      `engine menerima ${b.received_bytes} byte dari ${bigBytes}`);
    const upload = { bytesReceived: b.received_bytes, seconds: b.upload_s, streaming: b.streaming };

    const failed = checks.filter((c) => c.status === 'fail');
    for (const c of checks) log(`${c.status === 'pass' ? '✓' : '✗'} ${c.id} — ${c.detail}`);

    const report = {
      source: 'bench-bigfile',
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}/${process.arch}`,
      status: failed.length ? 'fail' : 'pass',
      command: `node scripts/bench-bigfile.mjs${USER_FILE ? ` --file ${USER_FILE}` : ` --size-gib ${SIZE_GIB}`}`,
      measures: {
        big: { ...b, gib: bigBytes / GIB, mibPerSec },
        baseline: { ...a, gib: a.file_bytes / GIB },
        sizeRatio,
        rssRatio: ratio,
        upload,
      },
      checks,
      // Dicatat eksplisit supaya laporan ini tidak dibaca sebagai klaim yang
      // lebih besar daripada yang benar-benar diukur.
      notMeasured: 'wall-clock ASR seluruh berkas (±4 jam audio) dan RSS per jendela ASR; yang diukur adalah memori engine saat unggah + awal job',
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
