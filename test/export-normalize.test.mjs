/**
 * Normalisasi berkas ekspor SRT / VTT / TXT.
 *   node --test test/export-normalize.test.mjs
 *
 * Berkas ekspor dibaca alat lain (pemutar, ffmpeg, unggah Teams/Zoom), jadi
 * yang diuji bukan hanya isinya tapi keabsahan bentuknya. Di mana ffmpeg
 * tersedia, ia dipakai sebagai pembaca sungguhan — bukan hanya cocok-cocokan regex.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSrt, formatVtt, formatTxt, normalizeCues } from '../src/lib/transcript-cache.js';

const FFMPEG = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
const HAS_FFMPEG = FFMPEG.status === 0;
const ffmpegBin = HAS_FFMPEG ? FFMPEG.stdout.trim() : null;

/** Berapa cue yang benar-benar berhasil dibaca ffmpeg dari teks subtitel ini. */
function cuesReadByFfmpeg(text, ext) {
  const p = join(mkdtempSync(join(tmpdir(), 'lts-sub-')), `s.${ext}`);
  writeFileSync(p, text);
  const r = spawnSync(ffmpegBin, ['-hide_banner', '-v', 'error', '-i', p, '-f', 'srt', '-'], { encoding: 'utf8' });
  return (r.stdout.match(/^\d+$/gm) || []).length;
}

const TWO = [
  { t0: 0, t1: 2, tgt: 'Halo dunia' },
  { t0: 2, t1: 4, tgt: 'Baris kedua' },
];

test('VTT: ada baris kosong antara blok header dan cue pertama', () => {
  assert.match(formatVtt(TWO), /^WEBVTT\n\n\d\d:/, 'tanda tangan WEBVTT harus diikuti baris kosong');
  assert.match(formatVtt(TWO, { title: 'Rapat', url: 'https://x.test' }), /NOTE Title: Rapat\n\n\d\d:/);
});

test('VTT: ffmpeg membaca SEMUA cue, dengan maupun tanpa header NOTE', { skip: !HAS_FFMPEG && 'ffmpeg tidak ada' }, () => {
  // Regresi yang dijaga: tanpa baris kosong ffmpeg membuang cue pertama, dan
  // dengan baris NOTE ia membuang seluruhnya — diam-diam, tanpa galat.
  assert.equal(cuesReadByFfmpeg(formatVtt(TWO), 'vtt'), 2);
  assert.equal(cuesReadByFfmpeg(formatVtt(TWO, { title: 'Rapat' }), 'vtt'), 2);
  assert.equal(cuesReadByFfmpeg(formatVtt(TWO, { title: 'Rapat', url: 'https://x.test' }), 'vtt'), 2);
});

test('SRT: ffmpeg membaca semua cue dan indeksnya berurut', { skip: !HAS_FFMPEG && 'ffmpeg tidak ada' }, () => {
  const srt = formatSrt(TWO);
  assert.equal(cuesReadByFfmpeg(srt, 'srt'), 2);
  assert.deepEqual(srt.match(/^\d+$/gm), ['1', '2']);
});

test('stempel waktu rusak tidak pernah menghasilkan "NaN" di berkas', () => {
  const junk = [
    { t0: undefined, t1: undefined, tgt: 'a' },
    { t0: 'bukan angka', t1: 5, tgt: 'b' },
    { t0: Infinity, t1: NaN, tgt: 'c' },
  ];
  for (const out of [formatSrt(junk), formatVtt(junk), formatTxt(junk)]) {
    assert.doesNotMatch(out, /NaN/, 'berkas dengan NaN tidak bisa diurai pemutar mana pun');
  }
});

test('cue diurutkan menurut waktu mulai, dan durasinya selalu positif', () => {
  const messy = [
    { t0: 5, t1: 7, tgt: 'ketiga' },
    { t0: 0, t1: 0, tgt: 'pertama' }, // durasi nol → tidak pernah tampil
    { t0: 2, t1: 1, tgt: 'kedua' }, // mundur
  ];
  const n = normalizeCues(messy);
  assert.deepEqual(n.map((c) => c.tgt), ['pertama', 'kedua', 'ketiga']);
  for (const c of n) assert.ok(c.t1 > c.t0, `durasi ${c.t0}→${c.t1} tidak positif`);

  // Waktu mulai sama harus mempertahankan urutan asli (pengurutan stabil).
  const tie = normalizeCues([{ t0: 1, t1: 2, tgt: 'a' }, { t0: 1, t1: 2, tgt: 'b' }]);
  assert.deepEqual(tie.map((c) => c.tgt), ['a', 'b']);
});

test('cue yang tidak urut tetap keluar berurut di berkas SRT', () => {
  const srt = formatSrt([{ t0: 5, t1: 7, tgt: 'kedua' }, { t0: 0, t1: 3, tgt: 'pertama' }]);
  const starts = [...srt.matchAll(/^(\d\d:\d\d:\d\d,\d\d\d) -->/gm)].map((m) => m[1]);
  assert.deepEqual(starts, ['00:00:00,000', '00:00:05,000']);
});

test('ekspor menyimpan sumber dan terjemahan sekaligus', () => {
  const line = [{ t0: 0, t1: 4, src: 'Hello world', tgt: '你好世界' }];
  for (const out of [formatVtt(line), formatSrt(line)]) {
    assert.match(out, /Hello world\n你好世界/, 'berkas ekspor adalah arsip — jangan buang teks asli');
  }
});
