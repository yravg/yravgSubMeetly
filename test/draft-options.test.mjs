/**
 * T03 — opsi draf "End & draft": tiga draf dari baris yang sama, pilih + catatan,
 * Diff terima/tolak, duplikat dilewati dan dihitung, rapat terbit beku.
 *   node --test test/draft-options.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting } from '../src/lib/notes-schema.js';
import { RegisterError } from '../src/lib/notes-actions.js';
import { generateNotesFromTranscript } from '../src/lib/notes-generate.js';
import { buildDraftVariants, diffDraft, applyChanges, wordDiff } from '../src/lib/draft-options.js';

// Baris sesi: kontrak bidang source/translation (bukan src/tgt).
const L = (t0, source, translation, speaker = 'James Miller') => ({ t0, t1: t0 + 5, speaker, source, text: source, ...(translation ? { translation } : {}) });
const LINES = [
  L(10, 'Hello everyone, can you hear me?', 'Halo semua'),
  L(20, 'We decided the evacuation drill moves to Friday 07:30 for all contractors.', 'Kami memutuskan drill evakuasi pindah ke Jumat 07:30.'),
  L(30, 'Mei Lin will send the toolbox topic sheet before the end of this week.', 'Mei Lin akan mengirim lembar topik toolbox minggu ini.', 'Mei Lin'),
  L(40, 'Lars Nilsen will send the incident investigation report to Client HSE on Wednesday.', 'Lars akan mengirim laporan investigasi insiden hari Rabu.', 'Lars Nilsen'),
  L(50, 'Is there confirmation from Client HSE about the near-miss log for the drill?', 'Apakah ada konfirmasi dari Client HSE soal log near-miss?'),
  L(60, 'There is a risk that heat stress controls are delayed again this month.', 'Ada risiko kontrol heat stress terlambat bulan ini.'),
];
const PAIR = { src: 'en', tgt: 'id' };
const meetingOf = (extra = {}) => createMeeting({ id: 'MOM-1', seq: 1, title: 'HSE', date: '2026-02-17', locale: 'en', ...extra });

test('tiga draf dari baris yang sama: Short, Full, Bilingual', () => {
  const r = buildDraftVariants(LINES, { locale: 'en', pair: PAIR });
  assert.deepEqual(r.drafts.map((d) => d.key), ['a', 'b', 'c']);
  assert.deepEqual(r.drafts.map((d) => d.name), ['Short', 'Full', 'Bilingual']);
  assert.ok(r.drafts.every((d) => d.status === 'ready' && d.items.length > 0));
  const [a, b, c] = r.drafts;
  assert.equal(a.items[0].type, 'decision', 'Short: keputusan lebih dulu');
  assert.ok(b.items.length >= a.items.length, 'Full memuat semua butir');
  assert.ok(c.items[0].text.includes(' / '), 'Bilingual: baris sumber / terjemahan');
  assert.ok(c.items[0].text.includes('Kami memutuskan'));
});

test('Suggested membawa alasan', () => {
  const r = buildDraftVariants(LINES, { locale: 'en', pair: PAIR });
  assert.equal(r.suggested.key, 'a');
  assert.match(r.suggested.reason, /decision/i);
});

test('tanpa transkrip: kosong, tanpa draf', () => {
  const r = buildDraftVariants([], { locale: 'en' });
  assert.equal(r.empty, true);
  assert.equal(r.drafts.length, 0);
});

test('Bilingual butuh pasangan bahasa dan baris terjemahan', () => {
  const noPair = buildDraftVariants(LINES, { locale: 'en' });
  assert.equal(noPair.drafts[2].status, 'need');
  assert.equal(noPair.drafts[2].need, 'pair');
  const noTr = buildDraftVariants(LINES.map(({ translation, ...l }) => l), { locale: 'en', pair: PAIR });
  assert.equal(noTr.drafts[2].need, 'translation');
  assert.equal(noTr.drafts[0].status, 'ready', 'A dan B tidak ikut terhenti');
});

test('generator gagal untuk satu varian: error terisolasi, bisa diulang', () => {
  let n = 0;
  const generate = (lines, meta) => { n += 1; if (n === 2) throw new Error('boom'); return generateNotesFromTranscript(lines, meta); };
  const r = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }, { generate });
  assert.equal(r.drafts[1].status, 'error');
  assert.match(r.drafts[1].error, /boom/);
  assert.equal(r.drafts[0].status, 'ready');
  assert.equal(r.drafts[2].status, 'ready');
  const again = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }, { only: 'b' });
  assert.equal(again.drafts.length, 1);
  assert.equal(again.drafts[0].status, 'ready');
});

test('pakai draf terpilih menulis lewat addItem; catatan tersimpan di riwayat', () => {
  const m = meetingOf();
  const draft = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }).drafts[0];
  const d = diffDraft(m, draft);
  const out = applyChanges(m, d.changes, {}, { note: 'shorter please', by: 'tester', undecided: 'accept' });
  assert.equal(out.added, draft.items.length);
  assert.equal(out.meeting.items.length, draft.items.length);
  const first = out.meeting.items[0];
  assert.match(first.ref, /^W01-\d{3}$/, 'ref dialokasikan addItem');
  assert.equal(first.review, 'ai');
  assert.ok(first.history.some((h) => h.field === 'created'));
  assert.ok(first.history.some((h) => h.field === 'draft-note' && h.to === 'shorter please'));
  assert.equal(m.items.length, 0, 'meeting asal tidak berubah');
});

test('duplikat dilewati dan dihitung', () => {
  const draft = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }).drafts[0];
  const first = applyChanges(meetingOf(), diffDraft(meetingOf(), draft).changes, {}, { undecided: 'accept' }).meeting;
  const d2 = diffDraft(first, draft);
  assert.equal(d2.counts.dup, draft.items.length);
  assert.equal(d2.counts.add, 0);
  const out = applyChanges(first, d2.changes, {}, { undecided: 'accept' });
  assert.equal(out.added, 0);
  assert.equal(out.skipped, draft.items.length);
  assert.equal(out.meeting.items.length, first.items.length);
  assert.ok(d2.changes.find((c) => c.kind === 'dup').ref, 'duplikat menyebut ref yang sudah ada');
});

test('Diff: terima dan tolak per perubahan; mirip = ubah teks, bukan butir baru', () => {
  const m = meetingOf({ items: [{ ref: 'W01-001', type: 'decision', text: { en: 'We decided the evacuation drill moves to Thursday 07:30 for all contractors.' }, status: 'closed' }] });
  const draft = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }).drafts[0];
  const d = diffDraft(m, draft);
  const change = d.changes.find((c) => c.kind === 'change');
  assert.ok(change, 'butir Kamis→Jumat terbaca sebagai perubahan');
  assert.equal(change.ref, 'W01-001');
  assert.ok(change.parts.some((p) => p.t === 'del' && /Thursday/.test(p.s)));
  assert.ok(change.parts.some((p) => p.t === 'ins' && /Friday/.test(p.s)));
  const adds = d.changes.filter((c) => c.kind === 'add');
  assert.ok(adds.length > 0);
  // tolak perubahan, terima satu butir baru; sisanya tak diputuskan → tidak diterapkan
  const decisions = { [change.id]: 'reject', [adds[0].id]: 'accept' };
  const out = applyChanges(m, d.changes, decisions, {});
  assert.equal(out.rejected, 1);
  assert.equal(out.added, 1);
  assert.match(out.meeting.items[0].text.en, /Thursday/, 'ditolak: teks lama tetap');
  // terima perubahan
  const acc = applyChanges(m, d.changes, { [change.id]: 'accept' }, {});
  assert.equal(acc.edited, 1);
  assert.match(acc.meeting.items[0].text.en, /Friday/);
  assert.equal(acc.meeting.items[0].review, 'edited');
});

test('rapat terbit beku: tidak ada yang ditulis', () => {
  const m = meetingOf({ issuedAt: '2026-02-18T00:00:00Z' });
  const draft = buildDraftVariants(LINES, { locale: 'en', pair: PAIR }).drafts[0];
  const d = diffDraft(m, draft);
  assert.equal(d.locked, true);
  assert.throws(() => applyChanges(m, d.changes, {}, { undecided: 'accept' }), (e) => e instanceof RegisterError && e.code === 'issued');
});

test('wordDiff memisah hapus dan sisip per kata', () => {
  const p = wordDiff('drill on Thursday 07:30', 'drill on Friday 07:30');
  assert.deepEqual(p.filter((x) => x.t !== 'same').map((x) => [x.t, x.s.trim()]), [['del', 'Thursday'], ['ins', 'Friday']]);
});
