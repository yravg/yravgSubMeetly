import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseTeamsTranscript, looksLikeTeamsTranscript } from '../src/lib/teams-transcript.js';
import { generateNotesFromTranscript } from '../src/lib/notes-generate.js';

const raw = readFileSync(new URL('./fixtures/teams-transcript.txt', import.meta.url), 'utf8');

test('membuang derau antarmuka Teams, bukan isi rapat', () => {
  const { lines } = parseTeamsTranscript(raw);
  const blob = lines.map((l) => l.text).join(' ');
  for (const noise of ['Search', 'AI-generated', 'arrow keys', 'started transcription', 'stopped transcription']) {
    assert.ok(!blob.includes(noise), `derau bocor: ${noise}`);
  }
  assert.ok(lines.length >= 10);
});

test('nama pembicara tidak tercampur ke ucapan pembicara sebelumnya', () => {
  const { lines } = parseTeamsTranscript(raw);
  const first = lines[0];
  assert.equal(first.speaker, 'Janewut Chan');
  assert.equal(first.text, 'Good morning.', 'nama pembicara berikutnya tidak boleh menempel');
});

test('stempel waktu diubah ke detik, termasuk bentuk tanpa detik dan tunggal', () => {
  const { lines } = parseTeamsTranscript(raw);
  assert.equal(lines[0].t0, 172, '2:52 → 172 detik');
  assert.ok(lines.some((l) => l.t0 === 480), '"8 minutes" tanpa detik');
  assert.ok(lines.some((l) => l.t0 === 541), '"9 minutes 1 second" tunggal');
  assert.equal(lines[lines.length - 1].t0, 2518, '41:58 → 2518 detik');
});

test('nama dengan koma/jabatan tetap utuh sebagai satu pembicara', () => {
  const { speakers } = parseTeamsTranscript(raw);
  assert.ok(speakers.includes('Lai Kong Teng, CPOC-DPE'));
  assert.ok(speakers.includes('Mohamad Effendi Mohd Zulkifli, CPOC-DPE'));
  assert.equal(new Set(speakers).size, speakers.length, 'tanpa duplikat');
});

test('mendeteksi tempelan Teams, dan tidak salah mengenali teks biasa', () => {
  assert.equal(looksLikeTeamsTranscript(raw), true);
  assert.equal(looksLikeTeamsTranscript('Rapat biasa.\nTidak ada stempel waktu di sini.'), false);
  assert.equal(looksLikeTeamsTranscript(''), false);
});

test('hasil parse langsung bisa dipakai generator notulen', () => {
  const { lines } = parseTeamsTranscript(raw);
  const note = generateNotesFromTranscript(lines, { title: 'GZS Weekly Progress Meeting' });
  assert.ok(note, 'notulen terbentuk');
  assert.ok(String(note.summary || '').length > 0, 'ada ringkasan');
});

test('masukan kosong/rusak tidak melempar', () => {
  assert.deepEqual(parseTeamsTranscript('').lines, []);
  assert.deepEqual(parseTeamsTranscript(null).lines, []);
  assert.equal(parseTeamsTranscript('cuma satu baris').lines.length, 0);
});
