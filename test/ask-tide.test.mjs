/**
 * src/lib/ask-tide.js — inti Ask Tide (TIDE-007, 018, 019): murni, fetch distub.
 *   node --test test/ask-tide.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readStream, chatRequest, buildGrounding, registerAnswer, proposeStatus, applyProposal,
  trimHistory, PROVIDERS, CLOUD_MODELS, exportAnswer,
} from '../src/lib/ask-tide.js';

const NOW = new Date(2026, 10, 9, 9, 30);
const it = (ref, type, extra = {}) => ({ ref, type, status: 'open', owner: null, due: null, text: { en: `${ref} text` }, ...extra });
const M = (id, date, extra = {}) => ({ id, seriesId: 'S1', seq: 1, title: `Meeting ${id}`, date, issuedAt: null, items: [], summary: { en: '' }, ...extra });

/** Response palsu dengan body yang dipotong di tempat-tempat jahat. */
function sseResponse(chunks, { ok = true, status = 200 } = {}) {
  const enc = new TextEncoder();
  return {
    ok, status,
    body: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }),
    json: async () => ({}),
  };
}

test('readStream: delta, done dan error melewati batas potongan', async () => {
  const res = sseResponse(['data: {"del', 'ta":"Hel"}\n\ndata: {"delta":"lo"}\n', '\n: ping\n\ndata: {"done":true,"model":"qwen2.5"}\n\n']);
  const out = [];
  for await (const ev of readStream(res)) out.push(ev);
  assert.deepEqual(out, [{ delta: 'Hel' }, { delta: 'lo' }, { done: true, model: 'qwen2.5' }]);
  const bad = [];
  for await (const ev of readStream(sseResponse(['data: {"error":"model not loaded"}\n\n']))) bad.push(ev);
  assert.deepEqual(bad, [{ error: 'model not loaded' }]);
});

test('chatRequest: POST /ask ke helper dengan {question, grounding, history≤6}, provider dan model', async () => {
  const calls = [];
  const fetchStub = async (url, init) => { calls.push({ url, init }); return sseResponse(['data: {"delta":"ok"}\n\ndata: {"done":true}\n\n']); };
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const events = [];
  for await (const ev of chatRequest({ provider: 'local', system: 'SYS', history, question: 'Q', fetch: fetchStub })) events.push(ev);
  assert.equal(calls[0].url, 'http://127.0.0.1:17865/ask');
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.provider, 'local');
  assert.equal(body.question, 'Q');
  assert.equal(body.grounding, 'SYS');
  assert.deepEqual(body.history.map((h) => h.content), ['m4', 'm5', 'm6', 'm7', 'm8', 'm9'], '6 giliran terakhir');
  assert.equal(body.messages, undefined, 'bentuk lama tidak dikirim lagi');
  assert.deepEqual(events.map((e) => e.delta || (e.done && 'done')), ['ok', 'done']);
});

test('chatRequest: helper tanpa /ask atau mati → satu event error yang jelas, bukan lemparan', async () => {
  const e404 = [];
  for await (const ev of chatRequest({ provider: 'local', system: '', history: [], question: 'Q', fetch: async () => ({ ok: false, status: 404, body: null }) })) e404.push(ev);
  assert.deepEqual(e404, [{ error: 'not-connected', status: 404 }]);
  const off = [];
  for await (const ev of chatRequest({ provider: 'cloud', model: CLOUD_MODELS[0].id, system: '', history: [], question: 'Q', fetch: async () => { throw new TypeError('Failed to fetch'); } })) off.push(ev);
  assert.deepEqual(off, [{ error: 'helper-offline' }]);
});

test('trimHistory menyimpan 6 giliran terakhir', () => {
  const h = Array.from({ length: 9 }, (_, i) => ({ role: 'user', content: String(i) }));
  assert.deepEqual(trimHistory(h).map((m) => m.content), ['3', '4', '5', '6', '7', '8']);
});

test('PROVIDERS: Local bawaan, Register only tanpa model, Cloud harus izin', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['local', 'register', 'cloud']);
  assert.equal(PROVIDERS.find((p) => p.id === 'cloud').needsConsent, true);
  assert.equal(CLOUD_MODELS.length, 3);
});

test('buildGrounding: You are Tide + MEETING, REGISTER, EARLIER IN THIS SERIES, APP FEATURES', () => {
  const ms = [M('B', '2026-11-09', { seq: 2, items: [it('A1', 'action', { owner: 'Mei', due: '2026-11-12' }), it('D1', 'decision')] }), M('A', '2026-11-02', { items: [it('Q1', 'question')] })];
  const g = buildGrounding(ms, { meetingId: 'B' });
  assert.match(g, /^You are Tide/);
  for (const sec of ['MEETING', 'REGISTER', 'EARLIER IN THIS SERIES', 'APP FEATURES']) assert.match(g, new RegExp(`^${sec}`, 'm'));
  assert.match(g, /A1 \[action\] A1 text — owner Mei, due 2026-11-12, open/);
  assert.match(g, /Meeting A \(2026-11-02\)/);
  assert.ok(!/Meeting A \(2026-11-02\)[\s\S]*REGISTER/.test(g), 'rapat lebih awal di bagiannya sendiri');
});

test('registerAnswer: empat chip dijawab dari register, dengan kartu dan langkah', () => {
  const ms = [
    M('B', '2026-11-09', { items: [it('A1', 'action', { owner: 'Mei', due: '2026-11-06' }), it('A2', 'action', { owner: 'Lars', due: '2026-11-20' }), it('D1', 'decision'), it('R1', 'risk')] }),
    M('A', '2026-11-02', { issuedAt: 'x', items: [it('A0', 'action', { owner: 'Mei', status: 'closed' })] }),
  ];
  const recap = registerAnswer('Recap last meeting', ms, { now: NOW });
  assert.equal(recap.intent, 'recap');
  assert.match(recap.text, /\*\*4 items\*\*/);
  assert.deepEqual(recap.cards.map((c) => c.kind), ['bars', 'list']);
  assert.ok(recap.steps.length >= 1);

  const mine = registerAnswer('What did I promise?', ms, { now: NOW, me: 'Mei' });
  assert.equal(mine.intent, 'promises');
  assert.deepEqual(mine.cards[0].rows.map((r) => r.ref), ['A1']);
  assert.match(mine.text, /\*\*1 open action\*\*/);

  const noName = registerAnswer('What did I promise?', ms, { now: NOW });
  assert.equal(noName.intent, 'promises');
  assert.match(noName.text, /your name/i, 'tanpa nama: minta nama, tidak menebak');

  const open = registerAnswer('Open actions', ms, { now: NOW });
  assert.deepEqual(open.cards[0].rows.map((r) => r.ref), ['A1', 'A2']);
  assert.match(open.text, /\*\*1 overdue\*\*/);
  assert.equal(open.cards.at(-1).kind, 'action', 'mengusulkan tandai selesai untuk yang lewat tenggat');

  const tr = registerAnswer('Translate a file', ms, { now: NOW });
  assert.equal(tr.intent, 'translate-file');
  assert.equal(tr.cards[0].kind, 'link');
  assert.equal(tr.cards[0].href, '#files');

  const other = registerAnswer('what is the weather', ms, { now: NOW });
  assert.equal(other.intent, 'unknown');
  assert.equal(other.cards.length, 0);
});

test('tulis hanya lewat Konfirmasi: usulan tidak mengubah apa pun, apply mengembalikan rapat baru', () => {
  const ms = [M('B', '2026-11-09', { items: [it('A1', 'action', { due: '2026-11-06' })] })];
  const snapshot = JSON.stringify(ms);
  const p = proposeStatus(ms, 'B', ['A1'], 'closed');
  assert.equal(JSON.stringify(ms), snapshot, 'usulan tidak menyentuh register');
  assert.deepEqual(p, { kind: 'action', op: 'status', meetingId: 'B', refs: ['A1'], status: 'closed' });
  const next = applyProposal(ms[0], p);
  assert.equal(JSON.stringify(ms), snapshot, 'apply tidak memutasi masukan');
  assert.equal(next.items[0].status, 'closed');
  assert.notEqual(next, ms[0]);
  assert.throws(() => applyProposal({ ...ms[0], issuedAt: 'x' }, p), /issued/);
  assert.throws(() => applyProposal(ms[0], { ...p, meetingId: 'Z' }), /meeting/);
});

test('exportAnswer: "Export open actions to Markdown" → kartu export + berkas .md yang dihitung tangan', () => {
  const ms = [
    M('B', '2026-11-09', { items: [it('A1', 'action', { owner: 'Mei', due: '2026-11-06' }), it('A2', 'action', { owner: 'Lars', due: '2026-11-20' }), it('D1', 'decision'), it('R1', 'risk')] }),
    M('A', '2026-11-02', { issuedAt: 'x', items: [it('A0', 'action', { owner: 'Mei', status: 'closed' })] }),
  ];
  const r = exportAnswer('Export open actions to Markdown', ms, { now: NOW });
  assert.match(r.text, /\*\*2 rows\*\*/);
  assert.deepEqual(r.card, { kind: 'export', title: 'Export to Markdown', sub: 'Open actions · all series', count: 2, filename: 'open-actions-2026-11-09.md' });
  assert.equal(r.file.name, 'open-actions-2026-11-09.md');
  assert.equal(r.file.mime, 'text/markdown');
  assert.equal(r.file.content, [
    '# Open actions', '',
    'Exported from yravgSubMeetly on 2026-11-09 · 2 rows', '',
    '| Ref | Item | Owner | Due | Status | Meeting |',
    '| --- | --- | --- | --- | --- | --- |',
    '| A1 | A1 text | Mei | 2026-11-06 | open | Meeting B |',
    '| A2 | A2 text | Lars | 2026-11-20 | open | Meeting B |', '',
  ].join('\n'));
  const dec = exportAnswer('Ekspor decisions', ms, { now: NOW });
  assert.equal(dec.card.sub, 'Decisions · all series');
  assert.equal(dec.card.count, 1);
  assert.equal(dec.file.name, 'decisions-2026-11-09.md');
});

test('exportAnswer: bukan permintaan ekspor → null; tanpa baris → tanpa kartu/berkas; sel dibersihkan', () => {
  const ms = [M('B', '2026-11-09', { items: [it('A1', 'action', { text: { en: 'Fix a|b\nline two' } })] })];
  assert.equal(exportAnswer('Open actions', ms, { now: NOW }), null);
  assert.equal(exportAnswer('Translate a file', ms, { now: NOW }), null);
  const none = exportAnswer('Export risks', ms, { now: NOW });
  assert.equal(none.card, null);
  assert.equal(none.file, null);
  assert.match(none.text, /nothing to export/i);
  const row = exportAnswer('Export open actions', ms, { now: NOW }).file.content.split('\n').find((l) => l.startsWith('| A1'));
  assert.equal(row, '| A1 | Fix a\\|b line two |  |  | open | Meeting B |');
});

test('kartu daftar: judul, jumlah rapat, dan baris dengan nama rapat + label status (Overdue / Due Wed / Due 20 Nov / Done)', () => {
  const ms = [M('B', '2026-11-09', { items: [
    it('A1', 'action', { owner: 'Mei', due: '2026-11-06' }),
    it('A2', 'action', { owner: 'Lars', due: '2026-11-20' }),
    it('A3', 'action', { owner: 'Lars', due: '2026-11-11' }),
    it('A4', 'action', { owner: 'Lars' }),
  ] }), M('C', '2026-11-03', { seriesId: 'S2', items: [it('A9', 'action', { owner: 'Mei', due: '2026-11-04' })] })];
  const open = registerAnswer('Open actions', ms, { now: NOW });
  const card = open.cards[0];
  assert.equal(card.title, 'Open actions');
  assert.equal(card.meetings, 2);
  const by = Object.fromEntries(card.rows.map((r) => [r.ref, r]));
  assert.deepEqual([by.A1.label, by.A1.late], ['Overdue', true]);
  assert.deepEqual([by.A3.label, by.A3.late], ['Due Wed', false]);
  assert.deepEqual([by.A2.label, by.A2.late], ['Due 20 Nov', false]);
  assert.equal(by.A4.label, '', 'tanpa tenggat: tanpa label');
  assert.equal(by.A1.meeting, 'Meeting B');
  assert.equal(by.A9.meeting, 'Meeting C');
  const action = open.cards.find((c) => c.kind === 'action');
  assert.equal(action.head, 'Mark as done');
});
