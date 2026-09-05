/**
 * Transkripsi streaming berkas besar (native/server.py).
 *   node --test test/native-streaming.test.mjs
 *
 * asr_file() menyerahkan seluruh berkas ke engine, yang menahan audio terdekode
 * di RAM (~230 MB/jam). Jalur streaming membaca PCM per jendela dari satu pipa
 * ffmpeg, jadi berkas >2 GiB tetap muat. Yang diuji di sini: pemotongan jendela,
 * waktu absolut, dedupe tumpang tindih, kemajuan, dan pembatalan — engine ASR
 * di-stub, tapi ffmpeg dan berkas medianya sungguhan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PY = existsSync('native/.venv/bin/python') ? 'native/.venv/bin/python' : 'python3';
const SR = 16000;

function ffmpegPath() {
  const r = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
const FFMPEG = ffmpegPath();

/** Berkas media sungguhan berdurasi `sec`. */
function makeMedia(sec) {
  const p = join(mkdtempSync(join(tmpdir(), 'lts-stream-')), 'probe.wav');
  const r = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${sec}`, '-ar', '44100', '-ac', '1', p, '-y']);
  assert.equal(r.status, 0, `ffmpeg gagal: ${r.stderr}`);
  return p;
}

function probe(media, env = {}) {
  const r = spawnSync(PY, ['test/native-streaming-probe.py'], {
    encoding: 'utf8',
    env: { ...process.env, MEDIA: media, STREAM_CHUNK_SEC: '5', STREAM_OVERLAP_SEC: '1', ...env },
  });
  assert.equal(r.status, 0, `probe gagal: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('durasi media terbaca dari berkas sungguhan', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const d = probe(makeMedia(12)).duration;
  assert.ok(Math.abs(d - 12) < 0.2, `durasi ${d} ≠ 12`);
});

test('jendela menutupi seluruh berkas tanpa celah, dan RAM tetap dibatasi', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12));
  assert.deepEqual(r.raw_windows.map((w) => w.start), [0, 5, 10], 'audio baru harus bersambung tanpa celah');
  assert.deepEqual(r.raw_windows.map((w) => w.lead), [0, 1, 1], 'jendela pertama tanpa lead-in');

  // Total audio baru = durasi berkas: tidak ada yang terlewat, tidak ada ganda.
  const fresh = r.raw_windows.reduce((n, w) => n + w.samples - w.lead * SR, 0);
  assert.ok(Math.abs(fresh / SR - 12) < 0.05, `audio baru ${fresh / SR}s ≠ 12s`);

  // Inti dari fitur ini: tiap jendela dibatasi (chunk + overlap), bukan
  // sebesar berkasnya — inilah yang membuat berkas >2 GiB muat.
  const cap = (5 + 1) * SR;
  for (const w of r.raw_windows) assert.ok(w.samples <= cap, `jendela ${w.samples} sampel > batas ${cap}`);
});

test('waktu segmen absolut terhadap berkas, bukan relatif ke jendela', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12));
  assert.equal(r.asr_calls, 3);
  // Basis jendela kedua adalah 4,0 (mulai 5 dtk, lead-in 1 dtk), tapi bagian
  // sebelum detik 5 sudah ditranskrip jendela pertama, jadi awalnya dimajukan.
  assert.deepEqual(r.segments.map((x) => x.start), [0, 5, 10]);
  assert.equal(r.segments.at(-1).end, 12, 'segmen terakhir harus mencapai akhir berkas');
  for (const s of r.segments) assert.ok(s.end > s.start);
});

test('segmen yang hanya berada di lead-in dibuang, tapi tidak di jendela pertama', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12), { STUB: 'leadin' });
  const texts = r.segments.map((s) => s.text);
  assert.deepEqual(texts, ['echo1', 'w1', 'w2', 'w3'], 'echo2/echo3 mengulang audio yang sudah ditranskrip');
  // Hasil akhir harus urut dan tidak tumpang tindih.
  for (let i = 1; i < r.segments.length; i++) {
    assert.ok(r.segments[i].start >= r.segments[i - 1].end, `segmen ${i} tumpang tindih`);
  }
});

test('kemajuan naik monoton, dilaporkan sambil jalan, dan tidak pernah 1.0 sebelum selesai', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12));
  assert.equal(r.progress.length, 3, 'satu laporan per jendela — bukan hanya di akhir');
  for (let i = 1; i < r.progress.length; i++) assert.ok(r.progress[i] > r.progress[i - 1]);
  assert.ok(r.progress.at(-1) <= 0.99, 'job belum selesai saat jendela terakhir ditranskrip');
  // Hasil sebagian tumbuh, jadi UI bisa menampilkannya sebelum berkas habis.
  assert.deepEqual(r.segments_len, [1, 2, 3]);
});

test('pembatalan berhenti di batas jendela, tidak menunggu berkas habis', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12), { CANCEL_AFTER: '2' });
  assert.equal(r.cancelled, true);
  assert.equal(r.asr_calls, 2, 'jendela ketiga tidak boleh ditranskrip lagi');
});

test('berkas lebih pendek dari satu jendela tetap menghasilkan satu jendela', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(2));
  assert.equal(r.raw_windows.length, 1);
  assert.equal(r.raw_windows[0].lead, 0);
  assert.ok(Math.abs(r.raw_windows[0].samples / SR - 2) < 0.05);
});

test('stempel waktu yang melampaui jendela dijepit ke batas berkas', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  // Whisper sungguhan pernah mengembalikan end 29,98 dtk untuk berkas 16 dtk;
  // tanpa penjepitan, ekspor SRT/VTT mendapat waktu di luar durasi media.
  const r = probe(makeMedia(12), { STUB: 'overflow' });
  for (const s of r.segments) {
    assert.ok(s.end <= 12.001, `end ${s.end} melewati durasi berkas`);
    assert.ok(s.start >= 0 && s.start < s.end);
  }
  assert.equal(r.segments.at(-1).end, 12);
});

test('segmen yang melintasi batas jendela tidak bertindihan dengan jendela sebelumnya', { skip: !FFMPEG && 'ffmpeg tidak ada' }, () => {
  const r = probe(makeMedia(12), { STUB: 'straddle' });
  // Jendela pertama tanpa lead-in, jadi 0,2 dtk memang awal yang sah.
  assert.deepEqual(r.segments.map((s) => [s.start, s.end]), [[0.2, 5], [5, 10], [10, 12]],
    'awal segmen sesudahnya harus dimajukan ke batas audio baru');
  for (let i = 1; i < r.segments.length; i++) {
    assert.ok(r.segments[i].start >= r.segments[i - 1].end, `cue ${i} bertindihan`);
  }
});
