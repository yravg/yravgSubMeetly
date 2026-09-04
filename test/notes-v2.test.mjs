/**
 * Uji lapisan data Minutes Register v2.
 *   node --test test/notes-v2.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMeeting, createMinuteItem, nextRef, meetingStats, itemAgeDays, pickText, toTimecode,
} from '../src/lib/notes-schema.js';
import { migrateStore, migrateNoteV1 } from '../src/lib/notes-migrate.js';
import * as A from '../src/lib/notes-actions.js';
import { makeT } from '../src/lib/notes-i18n.js';

const NOW = new Date('2026-09-03T00:00:00Z');

function meetingFixture() {
  return createMeeting({
    id: 'MOM-CPOC7-W36', seriesId: 'CPOC7-WEEKLY', seq: 36,
    title: 'CPOC Phase 7 — GZS Weekly Progress', date: '2026-09-02', locale: 'en',
    agenda: [{ ref: 'A2', title: 'Dropped-object controls', covered: true },
             { ref: 'A8', title: 'Look-ahead', covered: false }],
    items: [
      { ref: 'W36-002', type: 'decision', topic: 'controls', agenda: 'A2',
        text: { en: 'Inspect and secure cranes before operation and transport' },
        owner: 'Lai Kong Teng', org: 'COMPANY', status: 'closed', review: 'accepted', confidence: 0.91 },
      { ref: 'W36-003', type: 'action', topic: 'controls', agenda: 'A2',
        text: { en: 'Issue crane inspection checklist' },
        owner: 'Lai Kong Teng', due: '2026-09-08', status: 'open',
        review: 'ai', confidence: 0.88, openedAt: '2026-09-02' },
      { ref: 'W36-017', type: 'risk', topic: 'schedule', agenda: 'A8',
        text: { en: 'Delay risk on Ben and Coding activities for DNS shipment' },
        owner: 'Nasmee Samang', due: '2026-09-09', status: 'open',
        review: 'ai', confidence: 0.61, openedAt: '2026-09-02',
        src: { t0: 3738, t1: 3761, speaker: 'Nasmee Samang', lang: 'zh',
               orig: '弯管和涂敷的活动有明显的延误风险', tr: 'delay risk on the bending and coating activities',
               segmentIds: ['s1284'] } },
      { ref: 'W36-016', type: 'metric', topic: 'progress', agenda: 'A8',
        text: { en: 'Cumulative actual progress, week 36' }, status: 'closed',
        review: 'accepted', confidence: 0.94,
        metric: { measure: 'cumulative_progress', value: 10.89, baseline: 9.78, unit: '%', asOf: '2026-08-28' } },
    ],
  });
}

test('schema: refs, timecodes and text fallback', () => {
  const m = meetingFixture();
  assert.equal(m.schemaVersion, 2);
  assert.equal(nextRef(m), 'W36-018');
  assert.equal(toTimecode(3738), '01:02:18');
  assert.equal(pickText({ en: 'hello' }, 'id', 'en'), 'hello');
  assert.equal(m.items[3].metric.variance, 1.11, 'variance derived from value - baseline');
  assert.equal(m.items[2].src.tc, '01:02:18', 'timecode derived from t0');
});

test('schema: stats count what the header claims', () => {
  const s = meetingStats(meetingFixture(), NOW);
  assert.equal(s.total, 4);
  assert.equal(s.actionsOpen, 1);
  assert.equal(s.actionsTotal, 1);
  assert.equal(s.decisions, 1);
  assert.equal(s.unreviewed, 2);
  assert.equal(s.lowConfidence, 1, 'W36-017 sits below the 0.7 threshold');
  assert.equal(s.agendaPct, 50);
  assert.equal(s.variance, 1.11);
});

test('migration: v1 decisions become addressable items with no invented source', () => {
  const out = migrateStore({
    schemaVersion: 1,
    notes: [{ id: 'note-1', title: 'Standup', locale: 'id', generatedAt: '2026-09-03T04:00:00Z',
              summary: 'Ringkasan', decisions: ['Soft-launch internal', 'Target draft 500 ms'],
              actions: [{ text: 'Jalankan e2e --pick', owner: 'Citra', due: '2026-09-04', status: 'open' }] }],
  });
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.migrated, 1);
  const m = out.meetings[0];
  assert.equal(m.items.length, 4);
  assert.deepEqual(m.items.map((i) => i.type), ['info', 'decision', 'decision', 'action']);
  for (const i of m.items) {
    assert.equal(i.src, null, 'v1 had no transcript pointer — do not fabricate one');
    assert.equal(i.confidence, 0, 'imported items claim no confidence');
  }
  assert.equal(m.items[3].owner, 'Citra');
  assert.equal(m.items[3].openedAt, '2026-09-03');
});

test('migration is idempotent on a v2 envelope', () => {
  const once = migrateStore({ schemaVersion: 1, notes: [{ id: 'n', decisions: ['d'] }] });
  const twice = migrateStore({ schemaVersion: 2, meetings: once.meetings });
  assert.equal(twice.migrated, 0);
  assert.equal(twice.meetings.length, 1);
});

test('actions: accept flips ai -> accepted and records it', () => {
  const m = A.acceptItem(meetingFixture(), 'W36-003');
  const it = m.items.find((i) => i.ref === 'W36-003');
  assert.equal(it.review, 'accepted');
  assert.equal(it.history.at(-1).field, 'review');
  assert.equal(it.history.at(-1).to, 'accepted');
});

test('actions: editing marks edited, not accepted, and keeps the before value', () => {
  const m = A.editItem(meetingFixture(), 'W36-017', {
    text: { en: 'Delay risk on bending and coating activities for DNS shipment' },
  });
  const it = m.items.find((i) => i.ref === 'W36-017');
  assert.equal(it.review, 'edited');
  assert.match(it.text.en, /bending and coating/);
  const rev = it.history.find((h) => h.field === 'text.en');
  assert.match(rev.from, /Ben and Coding/, 'the mishearing stays in the audit trail');
  assert.equal(it.src.orig, '弯管和涂敷的活动有明显的延误风险', 'provenance is never edited');
});

test('actions: carry-forward keeps age and points back at the original meeting', () => {
  const w36 = meetingFixture();
  const w37 = A.startNextMeeting(w36, { id: 'MOM-CPOC7-W37', date: '2026-09-09' });
  assert.equal(w37.seq, 37);
  const carried = w37.items.filter((i) => i.carriedFrom);
  assert.equal(carried.length, 2, 'the open action and the open risk carry; note and metric do not');
  const risk = carried.find((i) => i.links[0] === 'W36-017');
  assert.equal(risk.ref, 'W37-002');
  assert.equal(risk.openedAt, '2026-09-02', 'age does not reset');
  assert.equal(risk.carriedFrom, 'MOM-CPOC7-W36');
  assert.equal(risk.src.meetingId, 'MOM-CPOC7-W36', 'playback still finds the original sentence');
  assert.equal(itemAgeDays(risk, new Date('2026-09-09T00:00:00Z')), 7);
});

test('actions: carry-forward does not duplicate on a second run', () => {
  const w36 = meetingFixture();
  const once = A.startNextMeeting(w36, { id: 'W37', date: '2026-09-09' });
  const twice = A.carryForward(once, w36);
  assert.equal(twice.items.length, once.items.length);
});

test('actions: issuing is blocked while AI drafts remain, and force is recorded', () => {
  const m = meetingFixture();
  assert.equal(A.blockingItems(m).length, 2);
  assert.throws(() => A.issueMeeting(m), (e) => e.code === 'unreviewed');
  const forced = A.issueMeeting(m, { force: true });
  assert.ok(forced.issuedAt);
  assert.deepEqual(forced.issuedWithUnreviewed, ['W36-003', 'W36-017']);
});

test('actions: an issued MoM is frozen; amendments are the way back in', () => {
  const issued = A.issueMeeting(meetingFixture(), { force: true });
  assert.throws(() => A.editItem(issued, 'W36-003', { owner: 'X' }), (e) => e.code === 'issued');
  const a1 = A.createAmendment(issued);
  assert.equal(a1.id, 'MOM-CPOC7-W36-A1');
  assert.equal(a1.issuedAt, null);
  assert.equal(a1.amends, 'MOM-CPOC7-W36');
  assert.doesNotThrow(() => A.editItem(a1, 'W36-003', { owner: 'X' }));
});

test('actions: metric series is a curve, not a sentence', () => {
  const w36 = meetingFixture();
  const w35 = createMeeting({
    id: 'W35', seriesId: 'CPOC7-WEEKLY', seq: 35, date: '2026-08-26',
    items: [{ ref: 'W35-016', type: 'metric', text: { en: 'progress' },
              metric: { measure: 'cumulative_progress', value: 9.2, baseline: 9.1, unit: '%', asOf: '2026-08-21' } }],
  });
  const pts = A.metricSeries([w36, w35], 'cumulative_progress');
  assert.equal(pts.length, 2);
  assert.deepEqual(pts.map((p) => p.asOf), ['2026-08-21', '2026-08-28'], 'ordered by report date, not meeting date');
  assert.equal(pts[1].variance, 1.11);
});

test('actions: series summary ranks by age and splits by party', () => {
  const s = A.seriesSummary([meetingFixture()], new Date('2026-09-20T00:00:00Z'));
  assert.equal(s.open, 2);
  assert.equal(s.oldest, 18);
  assert.equal(s.rows[0].age, 18);
  assert.equal(s.byOrg.unassigned, 2);
});

test('i18n: no UI string is hardcoded; both locales resolve', () => {
  const en = makeT('en');
  const id = makeT('id');
  assert.equal(en('decision'), 'Decision');
  assert.equal(id('decision'), 'Keputusan');
  assert.equal(id('showing', 9, 22), 'Menampilkan 9 dari 22');
  assert.equal(makeT('ja')('decision'), 'Decision', 'unknown locales fall back to English');
});

test('i18n: every English key exists in Indonesian', async () => {
  const { NOTES_I18N } = await import('../src/lib/notes-i18n.js');
  const missing = Object.keys(NOTES_I18N.en).filter((k) => !(k in NOTES_I18N.id));
  assert.deepEqual(missing, []);
});

test('actions: the extractor correction is applied everywhere and audited', () => {
  const base = meetingFixture();
  base.items[2] = createMinuteItem({
    ...base.items[2],
    text: { en: 'Delay risk on Ben and Coding activities for DNS shipment',
            id: 'Risiko keterlambatan pada aktivitas Ben and Coding untuk pengiriman DNS' },
    correction: { from: 'Ben and Coding', to: 'bending and coating' },
  });
  assert.deepEqual(base.items[2].correction, { from: 'Ben and Coding', to: 'bending and coating' });

  const fixed = A.applyCorrection(base, 'W36-017');
  const it = fixed.items.find((i) => i.ref === 'W36-017');
  assert.match(it.text.en, /bending and coating/);
  assert.match(it.text.id, /bending and coating/, 'every language gets the same correction');
  assert.equal(it.correction, null, 'the suggestion is consumed');
  assert.equal(it.review, 'edited', 'a correction is an edit, not an acceptance');
  assert.match(it.history.find((h) => h.field === 'text.en').from, /Ben and Coding/);
  assert.equal(it.src.tr, 'delay risk on the bending and coating activities', 'provenance untouched');

  const kept = A.acceptItem(base, 'W36-017');
  const k = kept.items.find((i) => i.ref === 'W36-017');
  assert.equal(k.review, 'accepted');
  assert.equal(k.correction, null, '"keep as heard" dismisses the suggestion');
  assert.match(k.text.en, /Ben and Coding/, '…but does not rewrite the text');
  assert.equal(k.history.at(-1).field, 'correction');

  assert.throws(() => A.applyCorrection(base, 'W36-003'), (e) => e.code === 'no_correction');
});

test('actions: standing register counts a carried item once and knows how long it has bounced', () => {
  const w36 = meetingFixture();
  const w37 = A.startNextMeeting(w36, { id: 'MOM-CPOC7-W37', date: '2026-09-09' });
  const w38 = A.startNextMeeting(w37, { id: 'MOM-CPOC7-W38', date: '2026-09-16' });
  const series = [w36, w37, w38];
  const s = A.seriesSummary(series, new Date('2026-09-16T00:00:00Z'));
  assert.equal(s.open, 2, 'the action and the risk exist once each, not once per meeting');
  assert.ok(s.rows.every((r) => r.meeting.id === 'MOM-CPOC7-W38'), 'the newest copy is the one that counts');
  assert.deepEqual(s.rows.map((r) => r.chain), [3, 3], 'both have been raised in three consecutive meetings');
  assert.equal(s.rows[0].age, 14, 'age still runs from the original meeting');

  const flow = A.seriesFlow(series);
  assert.deepEqual(flow.map((f) => [f.seq, f.opened, f.closed, f.open]), [[36, 2, 0, 2], [37, 0, 0, 2], [38, 0, 0, 2]]);
});

test('actions: linked items resolve across the series in both directions', () => {
  const w36 = meetingFixture();
  const w37 = A.startNextMeeting(w36, { id: 'MOM-CPOC7-W37', date: '2026-09-09' });
  const carriedRisk = w37.items.find((i) => i.links[0] === 'W36-017');
  const links = A.linkedItems([w36, w37], w37, carriedRisk);
  assert.equal(links.length, 1);
  assert.equal(links[0].item.ref, 'W36-017');
  assert.equal(links[0].meeting.id, 'MOM-CPOC7-W36');
  const back = A.linkedItems([w36, w37], w36, w36.items.find((i) => i.ref === 'W36-016'));
  assert.equal(back.length, 0, 'nothing points at the metric');
});
