/**
 * Cross-OS subtitle export options (CRLF/BOM/filename).
 *   node --test test/export-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_KINDS,
  defaultExportOptions,
  normalizeExportOptions,
  applyExportOptions,
  exportFilename,
  exportMime,
  describeExportOptions,
} from '../src/lib/export-options.js';

test('defaults: Windows → CRLF + BOM, Linux/macOS → LF, no BOM', () => {
  assert.deepEqual(defaultExportOptions('windows'), { crlf: true, bom: true, langSuffix: true });
  assert.deepEqual(defaultExportOptions('linux'), { crlf: false, bom: false, langSuffix: true });
  assert.deepEqual(defaultExportOptions('macos'), { crlf: false, bom: false, langSuffix: true });
  assert.deepEqual(normalizeExportOptions({ crlf: false, junk: 1 }, 'windows'), { crlf: false, bom: true, langSuffix: true });
  assert.deepEqual(normalizeExportOptions(null, 'linux'), defaultExportOptions('linux'));
});

test('applyExportOptions: idempotent CRLF/BOM handling', () => {
  const src = '1\n00:00:01,000 --> 00:00:02,000\nhello\n';
  const win = applyExportOptions(src, { crlf: true, bom: true });
  assert.equal(win.charCodeAt(0), 0xfeff);
  assert.equal(win.slice(1), src.replace(/\n/g, '\r\n'));
  // re-applying does not double BOM or CRCRLF
  assert.equal(applyExportOptions(win, { crlf: true, bom: true }), win);
  // back to LF strips both
  assert.equal(applyExportOptions(win, { crlf: false, bom: false }), src);
});

test('exportFilename: safe basename, drops media extension, language suffix', () => {
  assert.equal(exportFilename('Rapat Q3: "final" <v2>.mkv', 'srt', { srcLang: 'id', tgtLang: 'en' }), 'Rapat_Q3_final_v2.id-en.srt');
  assert.equal(exportFilename('talk.mp4', 'txt', { srcLang: 'ja', tgtLang: 'ja' }), 'talk.ja.txt');
  assert.equal(exportFilename('talk.mp4', 'vtt', { srcLang: 'ja', tgtLang: 'en', langSuffix: false }), 'talk.vtt');
  assert.equal(exportFilename('', 'bogus'), 'subtitles.srt');
  // srt/vtt/txt untuk pemutar video; md/csv/json ditambahkan untuk dokumen,
  // analisis spreadsheet, dan impor ulang lossless.
  assert.deepEqual(EXPORT_KINDS, ['srt', 'vtt', 'txt', 'md', 'csv', 'json']);
  assert.equal(exportMime('vtt'), 'text/vtt');
  assert.equal(exportMime('md'), 'text/markdown');
  assert.equal(exportMime('csv'), 'text/csv');
  assert.equal(exportMime('json'), 'application/json');
  // ekstensi berkas harus mengikuti format yang dipilih
  assert.equal(exportFilename('rapat.mp4', 'md', { langSuffix: false }), 'rapat.md');
  assert.equal(exportFilename('rapat.mp4', 'json', { langSuffix: false }), 'rapat.json');
  assert.equal(describeExportOptions({ crlf: true, bom: true }), 'CRLF · BOM');
  assert.equal(describeExportOptions({ crlf: false, bom: false }), 'LF');
});
