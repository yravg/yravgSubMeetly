/**
 * Pustaka contoh transkrip — kontrak data + jalur impor.
 *   node --test --test-concurrency=1 test/sample-library.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_VERSION, DOMAINS, buildLibraryIndex, buildTranscript, listTranscriptIds,
  importSeries, importTranscript,
} from '../src/lib/sample-library.js';
import { PROJECT_TYPES } from '../src/lib/notes-schema.js';
import { generateNotesFromTranscript } from '../src/lib/notes-generate.js';

const ids = listTranscriptIds();
const all = ids.map((id) => buildTranscript(id));
const index = buildLibraryIndex();

test('>= 200 unique ids, every projectType valid, version exported', () => {
  assert.equal(LIBRARY_VERSION, 1);
  assert.ok(ids.length >= 200, `only ${ids.length} transcripts`);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(DOMAINS.length >= 12 && DOMAINS.length <= 14);
  for (const tr of all) {
    assert.ok(PROJECT_TYPES.includes(tr.projectType), `${tr.id}: ${tr.projectType}`);
    assert.match(tr.id, /^LIB-[A-Z]+\d?-(W|S)\d{2}$/);
    assert.ok(tr.title && tr.chair && tr.attendees.length >= 4);
    assert.equal(tr.weekLabel, `W${String(tr.seq).padStart(2, '0')}`);
  }
});

test('deterministic: building twice gives identical output', () => {
  for (const id of ids.filter((_, i) => i % 7 === 0)) {
    assert.deepEqual(buildTranscript(id), buildTranscript(id));
  }
  assert.deepEqual(buildLibraryIndex(), index);
});

test('series: contiguous seq, dates +7d, >= 60% in series, continuity of actions', () => {
  let inSeries = 0;
  let continuityChecks = 0;
  for (const d of index.domains) {
    for (const s of d.series) {
      assert.ok(s.weeks.length >= 4 && s.weeks.length <= 12, `${s.seriesId} has ${s.weeks.length} weeks`);
      const trs = s.weeks.map((w) => buildTranscript(w.id));
      inSeries += trs.length;
      trs.forEach((tr, i) => {
        assert.equal(tr.seq, i + 1);
        assert.equal(tr.seriesId, s.seriesId);
        if (i > 0) {
          const prev = trs[i - 1];
          assert.equal(new Date(tr.date) - new Date(prev.date), 7 * 86400000, `${tr.id} date gap`);
          assert.equal(tr.chair, prev.chair);
          assert.deepEqual(tr.attendees, prev.attendees);
          // Kesinambungan: setiap action minggu N disebut lagi di minggu N+1.
          const text = tr.lines.map((l) => l.text).join('\n');
          for (const a of prev.actions) {
            assert.ok(text.includes(a.obj), `${tr.id} does not mention "${a.obj}" from ${prev.id}`);
            assert.ok(text.includes(a.owner), `${tr.id} does not mention owner ${a.owner}`);
            continuityChecks++;
          }
          assert.ok(tr.recap.length === prev.actions.length);
          assert.ok(tr.recap.some((r) => r.status === 'closed') || tr.recap.some((r) => r.status === 'open'));
        }
      });
    }
  }
  assert.ok(inSeries / ids.length >= 0.6, `series share ${inSeries}/${ids.length}`);
  assert.ok(continuityChecks > 100);
});

test('lines: 25–90 per transcript, timestamps monotonic, text present', () => {
  for (const tr of all) {
    assert.ok(tr.lines.length >= 25 && tr.lines.length <= 90, `${tr.id}: ${tr.lines.length} lines`);
    let prevT1 = -1;
    for (const l of tr.lines) {
      assert.ok(l.t0 < l.t1, `${tr.id} t0<t1`);
      assert.ok(l.t0 >= prevT1, `${tr.id} monotonic`);
      prevT1 = l.t1;
      assert.ok(l.text && l.text === l.source);
      assert.ok(l.speaker);
      if (tr.bilingual) assert.ok(l.translation && l.translation !== l.text);
    }
  }
});

test('language mix: mostly English, several Indonesian, a few bilingual', () => {
  const en = all.filter((t) => t.locale === 'en').length;
  const id = all.filter((t) => t.locale === 'id').length;
  const bi = all.filter((t) => t.bilingual).length;
  assert.ok(en > id && id >= 20 && bi >= 10, `en=${en} id=${id} bilingual=${bi}`);
});

test('generateNotesFromTranscript yields >= 1 decision and >= 1 action on samples', () => {
  const picked = ids.filter((_, i) => i % 13 === 0); // 16+ deterministic "random" samples
  assert.ok(picked.length >= 10);
  for (const id of picked) {
    const tr = buildTranscript(id);
    const m = generateNotesFromTranscript(tr.lines, { title: tr.title, date: tr.date, locale: tr.locale, seriesId: tr.seriesId });
    const types = m.items.map((i) => i.type);
    assert.ok(types.includes('decision'), `${id}: no decision`);
    assert.ok(types.includes('action'), `${id}: no action`);
    const owners = m.items.filter((i) => i.type === 'action').map((i) => i.owner);
    assert.ok(owners.some((o) => tr.actions.some((a) => a.owner === o)), `${id}: owner not extracted`);
  }
});

test('importSeries: N meetings, carried items in week 2+, some closed via transcript', async () => {
  const saved = [];
  const save = async (m) => { saved.push(m); return m; };
  const s = index.domains[0].series[0];
  const meetings = await importSeries(s.seriesId, { save });
  assert.equal(meetings.length, s.weeks.length);
  assert.equal(saved.length, s.weeks.length);
  meetings.forEach((m, i) => {
    assert.equal(m.seq, i + 1);
    assert.equal(m.id, s.weeks[i].id);
    assert.equal(m.seriesId, s.seriesId);
    assert.equal(m.projectType, 'weekly-progress');
    assert.ok(m.agenda.length >= 3);
    if (i > 0) {
      const carried = m.items.filter((it) => it.carriedFrom === meetings[i - 1].id);
      assert.ok(carried.length >= 1, `${m.id} has no carried items`);
      assert.ok(m.items.some((it) => !it.carriedFrom && it.type === 'action'), `${m.id} has no new actions`);
    }
  });
  const closedCarried = meetings.flatMap((m) => m.items).filter((it) => it.carriedFrom && it.status === 'closed');
  assert.ok(closedCarried.length >= 1, 'no carried item was closed from the recap');
  // Deterministik selain generatedAt yang kita tetapkan sendiri dari tanggal rapat.
  const again = await importSeries(s.seriesId, { save: async (m) => m });
  assert.deepEqual(
    JSON.parse(JSON.stringify(again, (k, v) => (k === 'at' ? undefined : v))),
    JSON.parse(JSON.stringify(meetings, (k, v) => (k === 'at' ? undefined : v))),
  );
});

test('importTranscript: single meeting, Indonesian sample also extracts items', async () => {
  const idTr = all.find((t) => t.locale === 'id' && !t.bilingual);
  let stored = null;
  const m = await importTranscript(idTr.id, { save: async (x) => { stored = x; return x; } });
  assert.equal(stored.id, idTr.id);
  assert.equal(m.locale, 'id');
  assert.ok(m.items.some((i) => i.type === 'action'));
  assert.ok(m.items.some((i) => i.type === 'decision'));
  assert.ok(m.chair && m.attendees.length >= 4);
});

test('buildLibraryIndex is light: no lines anywhere and < 200 KB', () => {
  const json = JSON.stringify(index);
  assert.ok(json.length < 200 * 1024, `index is ${json.length} bytes`);
  assert.ok(!/"lines"/.test(json));
  assert.equal(index.total, ids.length);
  const counted = index.domains.reduce((n, d) => n + d.count, 0);
  assert.equal(counted, ids.length);
  for (const d of index.domains) {
    assert.ok(d.label.en && d.label.id);
    for (const s of d.series) {
      assert.ok(s.title && s.projectType);
      s.weeks.forEach((w, i) => assert.equal(w.seq, i + 1));
    }
    for (const st of d.standalone) assert.ok(st.id && st.date && st.title);
  }
});
