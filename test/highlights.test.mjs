/**
 * Meeting Highlights (board T04): counts, Needs you, files, links, changes.
 *   node --test test/highlights.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting, meetingStats } from '../src/lib/notes-schema.js';
import { acceptItem } from '../src/lib/notes-actions.js';
import { highlightsFor } from '../src/lib/highlights.js';

const NOW = new Date('2026-09-10T12:00:00Z');
const base = (ref, type, extra = {}) => ({ ref, type, text: { en: `${type} ${ref}` }, status: 'open', review: 'accepted', confidence: 0.95, ...extra });
const M = createMeeting({
  id: 'H-1', title: 'Rapat K3 W01', date: '2026-09-09',
  items: [
    base('AI-001', 'decision', { review: 'ai' }),
    base('AI-002', 'action', { due: '2026-09-01', owner: 'Mei' }), // overdue
    base('AI-003', 'action', { confidence: 0.55, review: 'ai' }), // low confidence, not yet reviewed (more specific than "review")
    base('AI-004', 'question', { text: { en: 'See https://client.example/portal and plan-v2.pdf please' } }),
    base('AI-005', 'risk', { owner: null }),
    base('AI-006', 'action', { due: '2026-09-01', status: 'closed' }), // closed: never overdue
    base('AI-007', 'info', { text: { en: 'Attached site-b-hse-plan.xlsx' } }),
    { ...base('AI-008', 'action'), history: [{ at: '2026-09-09T08:00:00Z', by: 'me', field: 'due', from: '2026-09-10', to: '2026-09-14' }] },
  ],
});

test('counts equal what the register reports', () => {
  const h = highlightsFor(M, { now: NOW });
  const s = meetingStats(M, NOW);
  assert.equal(h.counts.decisions, s.decisions);
  assert.equal(h.counts.actions, s.actionsTotal);
  assert.equal(h.counts.questions, 1);
  assert.equal(h.counts.risks, 1);
});

test('Needs you: review ai, confidence < 0.7, overdue open action; each with a reason; closed never', () => {
  const by = Object.fromEntries(highlightsFor(M, { now: NOW }).needsYou.map((n) => [n.ref, n.reason]));
  assert.equal(by['AI-001'], 'review');
  assert.equal(by['AI-002'], 'overdue');
  assert.equal(by['AI-003'], 'low');
  assert.ok(!('AI-006' in by));
  assert.ok(!('AI-004' in by));
});

test('accepting an item removes it from Needs you (a tick updates the count)', () => {
  const before = highlightsFor(M, { now: NOW }).needsYou.length;
  assert.equal(highlightsFor(acceptItem(M, 'AI-001'), { now: NOW }).needsYou.length, before - 1);
  const looked = highlightsFor(acceptItem(M, 'AI-003'), { now: NOW }).needsYou.map((n) => n.ref);
  assert.ok(!looked.includes('AI-003'));
});

test('last five items, newest ref first', () => {
  const h = highlightsFor(M, { now: NOW });
  assert.deepEqual(h.last.map((i) => i.ref), ['AI-008', 'AI-007', 'AI-006', 'AI-005', 'AI-004']);
});

test('files and links are found in the meeting text; changes come from item history', () => {
  const h = highlightsFor(M, { now: NOW });
  assert.deepEqual(h.files.map((f) => f.name).sort(), ['plan-v2.pdf', 'site-b-hse-plan.xlsx']);
  assert.deepEqual(h.links.map((l) => l.url), ['https://client.example/portal']);
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].ref, 'AI-008');
  assert.equal(h.changes[0].field, 'due');
});

test('source line counts real provenance', () => {
  const h = highlightsFor(M, { now: NOW });
  assert.equal(h.source.total, M.items.length);
  assert.equal(h.source.withSource, 0);
});

test('empty meeting: zero counts, nothing needs you', () => {
  const h = highlightsFor(createMeeting({ id: 'E-1', title: 'Empty', date: '2026-09-09' }), { now: NOW });
  assert.equal(h.needsYou.length, 0);
  assert.equal(h.last.length, 0);
  assert.equal(h.counts.decisions, 0);
});
