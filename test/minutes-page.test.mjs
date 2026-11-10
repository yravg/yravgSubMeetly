/**
 * A04 halaman Minutes asli di kerangka (src/app-pages/minutes.js): logika murni.
 *   node --test test/minutes-page.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { typeCounts, needsReview, visibleItems, groupItems, defaultMeetingId, patchLayout } from '../src/app-pages/minutes.js';

const it = (ref, type, extra = {}) => ({ ref, type, status: 'open', review: 'accepted', confidence: 0.95, owner: null, topic: 'general', ...extra });
const ITEMS = [
  it('A1', 'action', { owner: 'Mei', topic: 'hse' }), it('A2', 'action', { owner: 'Lars', review: 'ai', confidence: 0.9 }),
  it('D1', 'decision', { owner: 'Mei' }), it('R1', 'risk', { confidence: 0.5 }), it('Q1', 'question', { status: 'closed' }),
];

test('typeCounts: total and one count per type', () => {
  assert.deepEqual(typeCounts(ITEMS), { all: 5, decision: 1, action: 2, question: 1, risk: 1, metric: 0, info: 0 });
});

test('needsReview: AI draft or low confidence (< 0.7)', () => {
  assert.deepEqual(ITEMS.filter(needsReview).map((i) => i.ref), ['A2', 'R1']);
});

test('visibleItems: type filter, review-only and mine combine; the counts of typeCounts stay on the full list', () => {
  assert.deepEqual(visibleItems(ITEMS, { types: new Set(['action']) }).map((i) => i.ref), ['A1', 'A2']);
  assert.deepEqual(visibleItems(ITEMS, { types: new Set(['action']), reviewOnly: true }).map((i) => i.ref), ['A2']);
  assert.deepEqual(visibleItems(ITEMS, { mine: true, me: 'Mei' }).map((i) => i.ref), ['A1', 'D1']);
  assert.deepEqual(visibleItems(ITEMS, { types: new Set() }).length, 5);
});

test('groupItems: none keeps one run; owner groups keep first-seen order and counts', () => {
  assert.equal(groupItems(ITEMS, 'none', {}).length, 1);
  const g = groupItems(ITEMS, 'owner', { noOwner: 'Unassigned' });
  assert.deepEqual(g.map((x) => [x.label, x.count]), [['Mei', 2], ['Lars', 1], ['Unassigned', 2]]);
});

test('defaultMeetingId: newest meeting of the series, or of everything', () => {
  const ms = [{ id: 'a', seriesId: 'S1', date: '2026-01-01', start: '09:00' }, { id: 'b', seriesId: 'S1', date: '2026-01-08', start: '09:00' }, { id: 'c', seriesId: 'S2', date: '2026-02-01', start: '09:00' }];
  assert.equal(defaultMeetingId(ms, 'S1'), 'b');
  assert.equal(defaultMeetingId(ms, ''), 'c');
  assert.equal(defaultMeetingId([], ''), null);
});

test('patchLayout: rail / float / expand-dock / hide / reset change only what they say', () => {
  const base = { v: 1, theme: 'dark', top: true, left: { mode: 'docked', size: 232 }, right: { mode: 'docked', size: 520 }, bottom: { mode: 'docked', size: 190 }, dock: { pos: 'bottom', mini: true } };
  const rail = patchLayout(base, 'rail');
  assert.deepEqual([rail.left.mode, rail.right.mode, rail.bottom.mode], ['rail', 'rail', 'rail']);
  assert.equal(rail.theme, 'dark');
  assert.equal(base.left.mode, 'docked', 'input is not mutated');
  assert.equal(patchLayout(base, 'float').bottom.mode, 'float');
  assert.equal(patchLayout(base, 'expand-dock').dock.mini, false);
  assert.equal(patchLayout(base, 'hide').top, false);
  assert.equal(patchLayout(base, 'reset'), null, 'reset removes the saved layout');
});
