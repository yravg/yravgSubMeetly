/**
 * PMM-024: the Minutes register lists the meetings the island saved.
 *   node --test test/register-sync.test.mjs
 *
 * Chain: island Stop -> POST /notes (poni_core::meeting_doc) -> engine notes.rs
 * normaliser -> GET /notes -> startEngineSync pull -> docToMeeting -> register.
 * The engine is stubbed through globalThis.fetch; nothing here touches the real engine.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { meetingToDoc, docToMeeting } from '../src/lib/notes-sync.js';
import { createMeeting, createMinuteItem } from '../src/lib/notes-schema.js';
import { isDemoMeeting } from '../src/lib/notes-fixture.js';
import { startEngineSync } from '../src/lib/engine-sync.js';
import { listMeetings, saveMeeting, deleteMeeting, __resetForTests } from '../src/lib/notes-store.js';

const ORIGIN = 'http://127.0.0.1:17865';

// Mirrors poni_core::meeting_doc::meeting_doc (island/crates/poni-core/src/meeting_doc.rs) after the
// engine's normalize_note_doc (engine-rs/engine/src/notes.rs): transcript, AI-draft items with
// confidence 0.6, meeting.start as local YYYY-MM-DDTHH:MM, meeting.attendees empty, nulls as null.
const islandDoc = () => ({
  id: 'MOM-WIN-1731234567',
  title: 'Meeting 2026-11-10 09:05',
  date: '2026-11-10',
  source: 'island',
  status: 'ready',
  generatedAt: '2026-11-10T01:05:59Z',
  summary: 'line one ... line two (2 segmen).',
  decisions: ['We decided line one'],
  actions: [{ id: 'A-1', text: 'Alya to send line two', owner: null, due: null, status: 'open' }],
  transcriptPreview: 'line one\nline two',
  savedLocally: true,
  schemaVersion: 2,
  meeting: {
    seriesId: '', seq: null, projectType: 'general', locale: 'en', tz: '',
    start: '2026-11-10T09:05', end: null, chair: null, attendees: [],
    agenda: { total: 0, covered: 0 }, issuedAt: null, generatedAt: '',
    engine: { asr: '', mt: null, segments: 2, durationSec: 8 },
  },
  items: [
    { ref: 'D-1', type: 'decision', topic: '', text: 'We decided line one', owner: null, org: null, due: null, status: 'open', priority: null, likelihood: null, review: 'ai', confidence: 0.6, needsReview: true, tc: null, speaker: null, carriedFrom: null, links: [], metric: null },
    { ref: 'A-1', type: 'action', topic: '', text: 'Alya to send line two', owner: null, due: null, status: 'open', priority: null, likelihood: null, review: 'ai', confidence: 0.6, needsReview: true, tc: null, speaker: null, carriedFrom: null, links: [], metric: null },
  ],
  transcript: [
    { t0: 0, t1: 4, source: 'line one', translation: 'linie eins' },
    { t0: 4, t1: 8, source: 'line two', translation: '' },
  ],
});

let engineDocs; // id -> doc, newest first like the engine
let posts;
let down;
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await __resetForTests();
  engineDocs = new Map();
  posts = []; down = false;
  globalThis.fetch = async (url, init = {}) => {
    if (down) throw new Error('connection refused');
    const u = new URL(url);
    assert.equal(u.origin, ORIGIN, 'only the stub engine is reachable');
    const method = init.method || 'GET';
    if (u.pathname === '/notes' && method === 'GET') return json({ notes: [...engineDocs.values()] });
    if (u.pathname === '/notes' && method === 'POST') {
      const { note } = JSON.parse(init.body);
      posts.push(note.id);
      engineDocs = new Map([[note.id, note], ...[...engineDocs].filter(([k]) => k !== note.id)]);
      return json({ ok: true, note });
    }
    if (method === 'DELETE') { engineDocs.delete(decodeURIComponent(u.pathname.split('/').pop())); return json({ ok: true }); }
    return json({ error: 'nope' }, 404);
  };
});
const handles = [];
afterEach(() => { handles.splice(0).forEach((h) => h.stop()); globalThis.fetch = realFetch; });

const sync = (extra = {}) => { const h = startEngineSync({ origin: ORIGIN, pollMs: 0, ...extra }); handles.push(h); return h; };
const settle = async (h) => { await h.flushNow(); return h; };

test('docToMeeting inverts meetingToDoc: items and meta survive the round trip', () => {
  const m = createMeeting({
    id: 'MOM-X-1', seriesId: 'S1', seq: 3, projectType: 'weekly-progress', title: 'Weekly', date: '2026-11-03',
    start: '10:00', end: '11:00', chair: 'Alya', locale: 'en', summary: { en: 'All good.' },
    attendees: [{ name: 'Alya', org: 'PMO' }, { name: 'Bima' }],
    items: [
      createMinuteItem({ ref: 'W03-001', type: 'decision', text: { en: 'Ship Friday' }, status: 'closed', review: 'accepted', confidence: 0.9 }),
      createMinuteItem({ ref: 'W03-002', type: 'action', text: { en: 'Send plan' }, owner: 'Alya', due: '2026-11-05', status: 'open' }),
    ],
  });
  const back = docToMeeting(meetingToDoc(m, 'en'), 'en');
  assert.equal(back.id, m.id);
  assert.equal(back.title, 'Weekly');
  assert.equal(back.seriesId, 'S1');
  assert.equal(back.seq, 3);
  assert.equal(back.projectType, 'weekly-progress');
  assert.equal(back.chair, 'Alya');
  assert.deepEqual(back.attendees.map((a) => [a.name, a.org]), [['Alya', 'PMO'], ['Bima', null]]);
  assert.deepEqual(back.items.map((i) => [i.ref, i.type, i.text.en, i.owner, i.due, i.status]), [
    ['W03-001', 'decision', 'Ship Friday', null, null, 'closed'],
    ['W03-002', 'action', 'Send plan', 'Alya', '2026-11-05', 'open'],
  ]);
  assert.equal(back.summary.en, 'All good.');
});

test('an island meeting_doc becomes a meeting with transcript lines and AI-draft items', () => {
  const m = docToMeeting(islandDoc(), 'en');
  assert.equal(m.id, 'MOM-WIN-1731234567');
  assert.equal(m.source, 'island');
  assert.equal(m.date, '2026-11-10');
  assert.equal(m.start, '09:05', 'the local date part is dropped, the register shows the time');
  assert.equal(m.transcript.length, 2);
  assert.deepEqual([m.transcript[0].source, m.transcript[0].translation], ['line one', 'linie eins']);
  assert.deepEqual(m.items.map((i) => [i.ref, i.type, i.review, i.confidence]), [['D-1', 'decision', 'ai', 0.6], ['A-1', 'action', 'ai', 0.6]]);
  assert.equal(m.engine.segments, 2);
  assert.equal(m.issuedAt, null);
});

test('a v1 doc with only decisions and actions still converts', () => {
  const m = docToMeeting({ id: 'H-1', title: 'Old', date: '2026-01-01', decisions: ['Go'], actions: [{ id: 'act-1', text: 'Do it', owner: 'Bima', due: null, status: 'closed' }], items: [], meeting: null }, 'en');
  assert.deepEqual(m.items.map((i) => [i.type, i.text.en, i.owner, i.status]), [['decision', 'Go', null, 'open'], ['action', 'Do it', 'Bima', 'closed']]);
});

test('an engine meeting appears in the register; a local-only meeting stays and is pushed', async () => {
  engineDocs.set('MOM-WIN-1731234567', islandDoc());
  await saveMeeting({ id: 'MOM-LOCAL-1', title: 'Local only', date: '2026-11-09' });
  const events = [];
  await settle(sync({ onSync: (s) => events.push(s) }));
  const ids = (await listMeetings()).map((m) => m.id);
  assert.deepEqual(ids.sort(), ['MOM-LOCAL-1', 'MOM-WIN-1731234567']);
  assert.ok(engineDocs.has('MOM-LOCAL-1'), 'local-only meeting reaches the island');
  assert.ok(events.some((e) => e.ok && e.changed === 1), 'the pull reported one import');
});

test('engine wins for an id both hold, and keeps the local detail the engine does not store', async () => {
  const local = createMeeting({
    id: 'MOM-X-2', title: 'Weekly', date: '2026-11-03', locale: 'en',
    attendees: [{ name: 'Alya', org: 'PMO', email: 'alya@example.com' }],
    agenda: [{ ref: 'A1', title: { en: 'Progress' }, covered: true }],
    items: [createMinuteItem({ ref: 'W-001', type: 'action', text: { en: 'Send plan' }, owner: 'Alya', status: 'open', src: { t0: 60, tc: '00:01:00', speaker: 'Alya' } })],
  });
  await saveMeeting(local);
  const doc = meetingToDoc(local, 'en');
  doc.items[0].status = 'closed'; // the island closed it
  doc.items[0].owner = 'Chen';
  doc.meeting.attendees = ['Alya (PMO)'];
  engineDocs.set(doc.id, doc);
  await settle(sync());
  const [m] = await listMeetings();
  assert.deepEqual([m.items[0].status, m.items[0].owner], ['closed', 'Chen']);
  assert.equal(m.items[0].src.speaker, 'Alya', 'provenance the engine does not keep is not lost');
  assert.equal(m.attendees[0].email, 'alya@example.com');
  assert.equal(m.agenda.length, 1);
});

test('no echo: a pulled doc is not pushed back, and an unchanged pull changes nothing', async () => {
  engineDocs.set('MOM-WIN-1731234567', islandDoc());
  const h = await settle(sync());
  await new Promise((r) => setTimeout(r, 1500)); // past the push debounce
  await h.flushNow();
  assert.deepEqual(posts, [], 'nothing was POSTed');
  const events = [];
  const h2 = await settle(sync({ onSync: (s) => events.push(s) }));
  await h2.flushNow();
  assert.equal(events.at(-1).changed, 0);
  assert.deepEqual(posts, []);
});

test('demo meetings are never pushed, nor imported from the engine, and are recognised as Sample', async () => {
  await saveMeeting({ id: 'MOM-CPOC7-W35', title: 'CPOC demo', date: '2026-08-19' });
  await saveMeeting({ id: 'MOM-CPOC7-W36', title: 'CPOC demo', date: '2026-09-02' });
  await saveMeeting({ id: 'MOM-REAL-1', title: 'Real', date: '2026-11-01' });
  engineDocs.set('MOM-CPOC7-W35', { ...islandDoc(), id: 'MOM-CPOC7-W35' }); // pushed by an older build
  await deleteMeeting('MOM-CPOC7-W35'); // user removed the demo
  await settle(sync());
  assert.deepEqual(posts, ['MOM-REAL-1']);
  assert.ok(!(await listMeetings()).some((m) => m.id === 'MOM-CPOC7-W35'), 'a removed demo is not resurrected');
  assert.ok(isDemoMeeting({ id: 'MOM-CPOC7-W36' }));
});

test('a video kept as a transcript stays out of the register until it is saved as a meeting (PMM-015)', async () => {
  engineDocs.set('MOM-WIN-2', { ...islandDoc(), id: 'MOM-WIN-2', source: 'media' });
  await settle(sync());
  assert.deepEqual(await listMeetings(), [], 'a transcript is not a meeting');
  assert.deepEqual(posts, [], 'and nothing is pushed or deleted for it');
  engineDocs.set('MOM-WIN-2', { ...islandDoc(), id: 'MOM-WIN-2', source: 'island' }); // Save as meeting on the island
  await settle(sync());
  assert.deepEqual((await listMeetings()).map((m) => m.id), ['MOM-WIN-2']);
});

test('a register edit is written back to the engine', async () => {
  engineDocs.set('MOM-WIN-1731234567', islandDoc());
  const h = await settle(sync());
  const m = (await listMeetings())[0];
  m.items[0].status = 'closed';
  await saveMeeting(m);
  await h.flushNow();
  assert.deepEqual(posts, ['MOM-WIN-1731234567']);
  assert.equal(engineDocs.get('MOM-WIN-1731234567').items[0].status, 'closed');
  assert.equal(engineDocs.get('MOM-WIN-1731234567').source, 'island', 'the island keeps its source');
});

test('engine down: the register keeps its meetings and reports the engine as not answering', async () => {
  await saveMeeting({ id: 'MOM-LOCAL-2', title: 'Local', date: '2026-11-09' });
  down = true;
  const events = [];
  await settle(sync({ onSync: (s) => events.push(s), onError: () => {} }));
  assert.equal(events.at(-1).ok, false);
  assert.equal((await listMeetings()).length, 1);
});
