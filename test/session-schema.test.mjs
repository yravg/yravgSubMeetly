// Skema + migrasi riwayat sesi: data lama harus terangkat tanpa kehilangan isi.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSession, SESSION_SCHEMA_VERSION, MAX_SESSIONS, shouldAutosave } from '../src/lib/session-schema.js';
import { migrateSessions, needsMigration } from '../src/lib/session-migrate.js';

test('entri lama tanpa versi dinaikkan tanpa kehilangan transkrip', () => {
  const legacy = [
    { id: 'off-1', ts: 1000, mode: 'offline', title: 'Rapat.mp4', srcLang: 'ja', tgtLang: 'en',
      lines: [{ t: 0, t1: 2000, src: 'こんにちは', tgt: 'Hello' }] },
  ];
  assert.equal(needsMigration(legacy), true);
  const out = migrateSessions(legacy);
  assert.equal(out.length, 1);
  assert.equal(out[0].v, SESSION_SCHEMA_VERSION);
  assert.equal(out[0].lines[0].src, 'こんにちは');
  assert.equal(out[0].lineCount, 1);
  assert.equal(needsMigration(out), false, 'migrasi harus idempoten');
  assert.deepEqual(migrateSessions(out), out, 'menjalankan ulang tidak mengubah apa pun');
});

test('bentuk baris alternatif (source/translation, t0 detik) ikut dinormalkan', () => {
  const s = normalizeSession({
    id: 'rt-1', ts: 5, mode: 'realtime',
    lines: [{ t0: 1.5, t1: 4.25, source: 'Hola', translation: 'Halo' }],
  });
  assert.equal(s.lines[0].t, 1500);
  assert.equal(s.lines[0].tgt, 'Halo');
  assert.ok(s.lines[0].t1 > s.lines[0].t, 't1 harus di depan t');
});

test('urut terbaru dulu, id ganda dibuang, dipotong ke batas', () => {
  const many = Array.from({ length: MAX_SESSIONS + 10 }, (_, i) => ({ id: `s${i}`, ts: i, lines: [] }));
  many.push({ id: 's0', ts: 999, lines: [] }); // duplikat id
  const out = migrateSessions(many);
  assert.equal(out.length, MAX_SESSIONS);
  assert.ok(out[0].ts >= out[1].ts, 'terbaru di depan');
  assert.equal(new Set(out.map((s) => s.id)).size, out.length, 'id unik');
});

test('masukan rusak tidak merusak daftar', () => {
  const out = migrateSessions([null, 'bukan objek', undefined, { id: 'ok', ts: 1, lines: [] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'ok');
  assert.deepEqual(migrateSessions(null), []);
});

test('throttle simpan-otomatis: sering dipanggil, jarang menulis', () => {
  const iv = 10_000;
  // baru saja menyimpan → jangan menulis lagi
  assert.equal(shouldAutosave({ now: 1000, lastAt: 500, lineCount: 3, intervalMs: iv }), false);
  // sudah lewat jeda → menulis
  assert.equal(shouldAutosave({ now: 11_000, lastAt: 500, lineCount: 3, intervalMs: iv }), true);
  // force (saat sesi berhenti) mengabaikan throttle — baris terakhir tak boleh hilang
  assert.equal(shouldAutosave({ now: 600, lastAt: 500, lineCount: 3, force: true, intervalMs: iv }), true);
  // tidak ada yang bisa disimpan
  assert.equal(shouldAutosave({ now: 99_000, lastAt: 0, lineCount: 0, intervalMs: iv }), false);
  // sesi sudah tidak aktif
  assert.equal(shouldAutosave({ now: 99_000, lastAt: 0, lineCount: 5, active: false, intervalMs: iv }), false);
});
