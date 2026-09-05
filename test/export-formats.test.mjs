import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMarkdown, formatCsv, formatJson } from '../src/lib/export-formats.js';

const lines = [
  { t0: 1.25, t1: 3.5, src: 'おはよう', tgt: 'Good morning' },
  { t0: 3.5, t1: 6, src: 'He said "hi", then left', tgt: 'Dia bilang "hai", lalu pergi' },
];
const meta = { title: 'Rapat', url: 'https://example.com/a', srcLang: 'ja', tgtLang: 'en' };

test('Markdown: waktu + terjemahan, teks asli hanya saat dualLine', () => {
  const one = formatMarkdown(lines, meta);
  assert.match(one, /^# Rapat/);
  assert.match(one, /\*\*00:00:01\.250\*\* — Good morning/);
  assert.ok(!one.includes('> おはよう'), 'tanpa dualLine tidak menampilkan teks asli');
  const dual = formatMarkdown(lines, { ...meta, dualLine: true });
  assert.match(dual, /> おはよう/);
});

test('CSV: header tetap baris pertama, koma & kutip di-escape', () => {
  const csv = formatCsv(lines, meta);
  const rows = csv.split('\n');
  assert.equal(rows[0], 'start,end,duration,source,translation');
  // teks mengandung koma DAN tanda kutip → harus dikutip dan kutipnya digandakan
  assert.match(rows[2], /"He said ""hi"", then left"/);
  assert.equal(rows.length, 3, 'header + 2 baris');
});

test('CSV: durasi dihitung, bukan disalin', () => {
  const rows = formatCsv(lines, meta).split('\n');
  assert.equal(rows[1].split(',')[2], '2.25');
});

test('JSON: lossless dan bisa di-parse balik', () => {
  const parsed = JSON.parse(formatJson(lines, meta));
  assert.equal(parsed.kind, 'yraverage-transcript');
  assert.equal(parsed.srcLang, 'ja');
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[1].tgt, 'Dia bilang "hai", lalu pergi');
});

test('bentuk baris lama (t dalam ms) ikut dinormalkan', () => {
  const legacy = [{ t: 2000, t1: 5000, src: 'a', tgt: 'b' }];
  assert.match(formatMarkdown(legacy, {}), /\*\*00:00:02\.000\*\*/);
  assert.equal(JSON.parse(formatJson(legacy, {})).lines[0].t1, 5);
});

test('daftar kosong tidak error', () => {
  assert.match(formatMarkdown([], { title: 'Kosong' }), /^# Kosong/);
  assert.equal(formatCsv([], {}).split('\n').length, 1);
  assert.deepEqual(JSON.parse(formatJson(null, {})).lines, []);
});
