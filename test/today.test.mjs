/**
 * src/lib/today.js — angka beranda Today (A01) dari register, dihitung tangan.
 *   node --test test/today.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingKey, meetingMinutes, computeToday } from '../src/lib/today.js';

// Senin 9 Nov 2026, 09:30 waktu lokal.
const NOW = new Date(2026, 10, 9, 9, 30);
const it = (ref, type, extra = {}) => ({ ref, type, status: 'open', owner: null, due: null, ...extra });
const M = (id, date, extra = {}) => ({ id, seriesId: 'S1', title: id, date, start: null, end: null, issuedAt: null, items: [], engine: null, ...extra });

test('sapaan menurut jam', () => {
  assert.equal(greetingKey(new Date(2026, 10, 9, 5, 0)), 'morning');
  assert.equal(greetingKey(new Date(2026, 10, 9, 11, 59)), 'morning');
  assert.equal(greetingKey(new Date(2026, 10, 9, 12, 0)), 'afternoon');
  assert.equal(greetingKey(new Date(2026, 10, 9, 18, 0)), 'evening');
  assert.equal(greetingKey(new Date(2026, 10, 9, 2, 0)), 'evening');
});

test('durasi rapat: durationSec menang, lalu start–end, lalu nol', () => {
  assert.equal(meetingMinutes(M('a', '2026-11-09', { engine: { durationSec: 2520 }, start: '06:15', end: '06:30' })), 42);
  assert.equal(meetingMinutes(M('b', '2026-11-09', { start: '07:00', end: '07:30' })), 30);
  assert.equal(meetingMinutes(M('c', '2026-11-09', { start: '23:30', end: '00:15' })), 45, 'melewati tengah malam');
  assert.equal(meetingMinutes(M('d', '2026-11-09')), 0);
});

test('register kosong: semua nol, tanpa kartu kemarin', () => {
  const t = computeToday([], { now: NOW });
  assert.equal(t.minutesToday, 0);
  assert.deepEqual(t.meetingsToday, []);
  assert.equal(t.week.items, 0);
  assert.equal(t.week.delta, 0);
  assert.equal(t.overdue.count, 0);
  assert.equal(t.yesterdayOpen, null);
  assert.equal(t.empty, true);
});

test('hari ini, minggu ini, minggu lalu, kemarin, lewat tenggat', () => {
  const meetings = [
    M('today1', '2026-11-09', { start: '07:00', end: '07:30', issuedAt: '2026-11-09T08:00:00Z', items: [it('D1', 'decision'), it('A1', 'action', { owner: 'Mei', due: '2026-11-06' })] }),
    M('today2', '2026-11-09', { engine: { durationSec: 3720 }, items: [it('R1', 'risk'), it('Q1', 'question')] }),
    M('yday', '2026-11-08', { items: [it('A2', 'action', { owner: 'Lars', due: '2026-11-01' }), it('N1', 'note')] }),
    M('lastwk', '2026-11-04', { issuedAt: 'x', items: [it('D9', 'decision'), it('A9', 'action', { status: 'closed', due: '2026-10-01' })] }),
    M('other', '2026-11-09', { seriesId: 'S2', items: [it('A1', 'action', { owner: 'Mei', due: '2026-12-01' })] }),
  ];
  const t = computeToday(meetings, { now: NOW });
  // Hari ini: 30 + 62 + 0 menit; urut jam mulai, yang tanpa jam di akhir (lalu id).
  assert.equal(t.minutesToday, 92);
  assert.deepEqual(t.meetingsToday.map((m) => [m.id, m.status, m.minutes]), [['today1', 'issued', 30], ['other', 'draft', 0], ['today2', 'draft', 62]]);
  // Minggu ini (Sen 9 – Min 15 Nov): 2 + 2 + 1 = 5. Minggu 8 Nov masuk minggu lalu.
  assert.equal(t.week.items, 5);
  // Minggu lalu (2–8 Nov): yday 2 + lastwk 2 = 4.
  assert.equal(t.week.lastWeek, 4);
  assert.equal(t.week.delta, 1);
  assert.deepEqual(t.week.byType, { decision: 1, action: 2, question: 1, risk: 1 });
  assert.deepEqual(t.week.owners, ['Mei']);
  assert.deepEqual(computeToday(meetings, { now: NOW, owner: 'Mei' }).week.byType, { decision: 0, action: 2, question: 0, risk: 0 });
  // Lewat tenggat: A1 di S1 (6 Nov) dan A2 (1 Nov). A9 tertutup; A1 di S2 tenggat Desember.
  assert.equal(t.overdue.count, 2);
  assert.deepEqual(t.overdue.first, { ref: 'A2', due: '2026-11-01', meetingId: 'yday' });
  assert.equal(t.yesterdayOpen.id, 'yday');
  assert.equal(t.empty, false);
});

test('butir bawaan (ref sama di seri sama) dihitung sekali, versi rapat terbaru', () => {
  const meetings = [
    M('w1', '2026-11-02', { items: [it('A1', 'action', { due: '2026-11-03' })] }),
    M('w2', '2026-11-09', { items: [it('A1', 'action', { due: '2026-11-03', status: 'closed' })] }),
  ];
  assert.equal(computeToday(meetings, { now: NOW }).overdue.count, 0, 'ditutup di rapat terbaru');
});

test('"milik Anda": tindak lanjut minggu ini atas nama pengguna, tanpa membedakan huruf besar', () => {
  const meetings = [M('m', '2026-11-09', { items: [it('A1', 'action', { owner: 'Enrico' }), it('A2', 'action', { owner: 'enrico ' }), it('A3', 'action', { owner: 'Mei Lin' }), it('D1', 'decision', { owner: 'Enrico' })] })];
  assert.equal(computeToday(meetings, { now: NOW, me: 'Enrico' }).week.yoursAction, 2);
  assert.equal(computeToday(meetings, { now: NOW }).week.yoursAction, 0, 'tanpa nama: nol');
  assert.equal(computeToday(meetings, { now: NOW, me: 'Mei Lin' }).week.yoursAction, 1);
});
