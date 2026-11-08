/**
 * Librarian lite (board T02): pure rules, no network, no clock, no randomness.
 *   node --test test/librarian.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting, PROJECT_TYPES } from '../src/lib/notes-schema.js';
import {
  suggestFiling, applySuggestion, recordLook, latestLook, pendingSuggestions, whyText, UNFILED_BELOW,
} from '../src/lib/librarian.js';

const att = (...n) => n.map((name) => ({ name }));
const LINES = [
  { t0: 1, t1: 4, speaker: 'James', source: 'Drill evakuasi dipindah ke Jumat. Near-miss log dan toolbox briefing tetap.' },
  { t0: 5, t1: 8, speaker: 'Mei', source: 'Heat stress risk and PPE inspection for the safety walk.' },
];
const W01 = createMeeting({ id: 'K3-W01', seriesId: 'LIB-HSE2', seq: 1, projectType: 'hse', title: 'Rapat Komite K3 Mingguan Site B - W01', chair: 'James Miller', attendees: att('James Miller', 'Mei Lin', 'Lars Nilsen', 'Dewi', 'Riza'), date: '2026-09-01' });
const W02 = createMeeting({ id: 'K3-W02', seriesId: 'S-tmp', seq: 1, title: 'Rapat Komite K3 Mingguan Site B - W02', chair: 'James Miller', attendees: att('James Miller', 'Mei Lin', 'Lars Nilsen', 'Dewi'), date: '2026-09-08', agenda: [{ ref: 'A1', title: { en: 'Safety moment' } }] });

test('files into the existing series by chair, attendees and title, and says why', () => {
  const s = suggestFiling(W02, { meetings: [W01, W02], lines: LINES });
  assert.equal(s.seriesId, 'LIB-HSE2');
  assert.equal(s.projectType, 'hse');
  assert.ok(s.confidence >= UNFILED_BELOW);
  assert.match(s.why, /same chair/);
  assert.match(s.why, /4 of 5 attendees/);
  assert.match(s.why, /title match/);
  assert.match(s.title, /W02/);
  assert.ok(PROJECT_TYPES.includes(s.projectType));
});

test('the same fixture gives the same suggestion twice (deterministic)', () => {
  const a = suggestFiling(W02, { meetings: [W01, W02], lines: LINES });
  const b = suggestFiling(W02, { meetings: [W01, W02], lines: LINES });
  assert.deepEqual(a, b);
});

test('a lone meeting with no signal is Unfiled: low confidence, kept series, general type', () => {
  const m = createMeeting({ id: 'X-1', seriesId: 'S-x', title: 'Quick sync', date: '2026-09-09' });
  const s = suggestFiling(m, { meetings: [W01, m], lines: [] });
  assert.ok(s.confidence < UNFILED_BELOW);
  assert.equal(s.projectType, 'general');
  assert.equal(s.seriesId, 'S-x');
});

test('project type comes from title, agenda and transcript', () => {
  const m = createMeeting({ id: 'X-2', title: 'Sprint planning', agenda: [{ ref: 'A1', title: { en: 'Backlog grooming' } }], date: '2026-09-09' });
  assert.equal(suggestFiling(m, { meetings: [m], lines: [] }).projectType, 'sprint');
  const t = createMeeting({ id: 'X-3', title: 'Weekly sync', date: '2026-09-09' });
  assert.equal(suggestFiling(t, { meetings: [t], lines: LINES }).projectType, 'hse');
});

test('applySuggestion changes only the named fields and never mutates the input', () => {
  const s = suggestFiling(W02, { meetings: [W01, W02], lines: LINES });
  const before = JSON.stringify(W02);
  const out = applySuggestion(W02, { projectType: s.projectType });
  assert.equal(JSON.stringify(W02), before);
  assert.equal(out.projectType, 'hse');
  assert.equal(out.seriesId, W02.seriesId);
  assert.equal(out.title, W02.title);
  const all = applySuggestion(W02, s, { meetings: [W01, W02] });
  assert.equal(all.seriesId, 'LIB-HSE2');
  assert.equal(all.seq, 2);
});

test('issued meetings are frozen: applySuggestion refuses', () => {
  const issued = { ...W02, issuedAt: '2026-09-09T00:00:00Z' };
  assert.throws(() => applySuggestion(issued, { projectType: 'hse' }), /terbit|issued/i);
});

test('look history: dismissed is not shown again for that meeting', () => {
  const meetings = [W01, W02];
  let looks = [];
  const p = pendingSuggestions(meetings, looks, {});
  assert.deepEqual(p.map((x) => x.meeting.id), ['K3-W02']);
  looks = recordLook(looks, { meetingId: 'K3-W02', suggestion: p[0].suggestion, outcome: 'dismissed', at: '2026-09-09T10:00:00Z' });
  assert.equal(latestLook(looks, 'K3-W02').outcome, 'dismissed');
  assert.equal(pendingSuggestions(meetings, looks, {}).length, 0);
  assert.equal(looks.length, 1);
});

test('nothing to confirm when the meeting already matches its suggestion', () => {
  const filed = applySuggestion(W02, suggestFiling(W02, { meetings: [W01, W02], lines: LINES }), { meetings: [W01, W02] });
  assert.equal(pendingSuggestions([W01, filed], [], {}).length, 0);
});

test('whyText speaks Indonesian too', () => {
  const s = suggestFiling(W02, { meetings: [W01, W02], lines: LINES });
  assert.match(whyText(s, 'id'), /ketua sama/);
});
