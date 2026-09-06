import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchSessions, parseQuery, matchingLines } from '../src/lib/session-search.js';

const sessions = [
  { id: 'a', title: 'Rapat mingguan', url: 'https://example.com/rapat',
    lines: [{ src: 'おはようございます', tgt: 'Good morning' }, { src: '議題', tgt: 'The agenda' }] },
  { id: 'b', title: 'Kuliah fisika', url: 'https://youtube.com/watch?v=1',
    lines: [{ src: 'Energy is conserved', tgt: 'Energi kekal' }] },
  { id: 'c', title: 'Tanpa transkrip', url: '', lines: [] },
];

test('mencari di judul, URL, dan isi transkrip', () => {
  assert.deepEqual(searchSessions(sessions, 'rapat').map((s) => s.id), ['a']);
  assert.deepEqual(searchSessions(sessions, 'youtube').map((s) => s.id), ['b']);
  // kata ini hanya ada di dalam transkrip, bukan judul
  assert.deepEqual(searchSessions(sessions, 'agenda').map((s) => s.id), ['a']);
  assert.deepEqual(searchSessions(sessions, 'kekal').map((s) => s.id), ['b']);
});

test('tidak peka huruf besar-kecil dan mendukung non-Latin', () => {
  assert.deepEqual(searchSessions(sessions, 'GOOD MORNING').map((s) => s.id), ['a']);
  assert.deepEqual(searchSessions(sessions, '議題').map((s) => s.id), ['a']);
});

test('banyak kata mempersempit (AND), bukan memperluas', () => {
  assert.deepEqual(searchSessions(sessions, 'rapat agenda').map((s) => s.id), ['a']);
  assert.deepEqual(searchSessions(sessions, 'rapat fisika'), []);
});

test('frasa dalam tanda kutip diperlakukan utuh', () => {
  assert.deepEqual(parseQuery('"good morning" rapat'), ['good morning', 'rapat']);
  assert.deepEqual(searchSessions(sessions, '"good morning"').map((s) => s.id), ['a']);
  assert.deepEqual(searchSessions(sessions, '"morning good"'), []);
});

test('kueri kosong mengembalikan semuanya; sesi tanpa transkrip tidak error', () => {
  assert.equal(searchSessions(sessions, '   ').length, 3);
  assert.equal(searchSessions(sessions, '').length, 3);
  assert.deepEqual(searchSessions(null, 'x'), []);
});

test('cuplikan baris yang cocok untuk ditampilkan', () => {
  const hits = matchingLines(sessions[0], 'agenda');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tgt, 'The agenda');
  assert.deepEqual(matchingLines(sessions[2], 'apa pun'), []);
});
