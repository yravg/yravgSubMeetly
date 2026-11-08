/**
 * Inbox zero (board T01): pure grouping + the archive/snooze helpers.
 *   node --test test/inbox.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting } from '../src/lib/notes-schema.js';
import { seriesSummary, startNextMeeting, setStatus, editItem } from '../src/lib/notes-actions.js';
import { groupInbox, snoozeDue, finishedRows, closedAt, itemKey } from '../src/lib/inbox.js';

const NOW = new Date('2026-09-10T12:00:00Z');
const it = (ref, type, extra = {}) => ({ ref, type, text: { en: `${type} ${ref}` }, status: 'open', review: 'accepted', openedAt: '2026-09-01', ...extra });
const origin = (r) => (r.item.carriedFrom ? r.item.links[0] : r.item.ref);

function fixture() {
  const w1 = createMeeting({
    id: 'M-W01', seriesId: 'S1', seq: 1, title: 'Komite K3 W01', date: '2026-09-01',
    items: [
      it('A-1', 'action', { due: '2026-09-05', owner: 'Mei' }), // overdue
      it('A-2', 'action', { due: '2026-09-12', owner: 'Lars' }), // this week
      it('A-3', 'action', { owner: 'James' }), // no date
      it('A-4', 'action', { due: '2026-09-30', owner: 'Riza' }), // later
      it('A-5', 'action', { status: 'progress', due: '2026-09-02' }), // doing, even though late
      it('Q-1', 'question', {}), // no date
      it('R-1', 'risk', { due: '2026-09-09' }), // overdue
      it('D-1', 'decision', { status: 'closed' }), // closed, no closing revision
      it('I-1', 'info'), // never an inbox row
    ],
  });
  // Carries the open ones forward: the originals are superseded by the copies.
  const w2 = startNextMeeting(w1, { id: 'M-W02', date: '2026-09-08' });
  return [w1, w2];
}

test('open count equals seriesSummary(...).open and every open row lands in exactly one group', () => {
  const meetings = fixture();
  const g = groupInbox(meetings, { now: NOW });
  assert.equal(g.open, seriesSummary(meetings, NOW).open);
  const placed = ['overdue', 'week', 'nodate', 'later', 'doing'].reduce((n, k) => n + g.groups[k].length, 0);
  assert.equal(placed, g.open);
  assert.ok(g.open > 0);
});

test('grouping: Overdue / This week / No date / Later / Doing', () => {
  const g = groupInbox(fixture(), { now: NOW });
  const refs = (k) => g.groups[k].map(origin).sort();
  assert.deepEqual(refs('overdue'), ['A-1', 'R-1']);
  assert.deepEqual(refs('week'), ['A-2']);
  assert.deepEqual(refs('nodate'), ['A-3', 'Q-1']);
  assert.deepEqual(refs('later'), ['A-4']);
  assert.deepEqual(refs('doing'), ['A-5']);
  assert.equal(g.counts.overdue, 2);
});

test('a carried copy replaces the original: each thread appears once, newest meeting', () => {
  const all = Object.values(groupInbox(fixture(), { now: NOW }).groups).flat();
  assert.ok(all.every((r) => r.meeting.id === 'M-W02'));
});

test('type filter narrows rows but not the unfiltered open total', () => {
  const meetings = fixture();
  const g = groupInbox(meetings, { now: NOW, types: new Set(['question']) });
  assert.equal(Object.values(g.groups).flat().length, 1);
  assert.equal(g.open, seriesSummary(meetings, NOW).open);
});

test('closing moves a row to Finished; archive hides it; Finished needs a closing revision', () => {
  const [w1, w2] = fixture();
  const ref = w2.items.find((i) => i.links[0] === 'A-1').ref;
  const closed = setStatus(w2, ref, 'closed');
  const after = [w1, closed];
  const g = groupInbox(after, { now: NOW });
  assert.equal(g.open, seriesSummary(after, NOW).open);
  assert.equal(g.groups.done.length, 1);
  assert.equal(g.groups.done[0].item.ref, ref);
  assert.ok(closedAt(g.groups.done[0].item));
  // D-1 was closed by the sample data, not by the inbox: never listed as Finished.
  assert.ok(!g.groups.done.some((r) => r.item.type === 'decision'));
  const arch = groupInbox(after, { now: NOW, archived: new Set([itemKey(closed.id, ref)]) });
  assert.equal(arch.groups.done.length, 0);
  assert.equal(arch.archived.length, 1);
  assert.equal(finishedRows(after, { now: NOW }).length, 1);
});

test('reopening (Undo) puts the row back in the open count', () => {
  const [w1, w2] = fixture();
  const ref = w2.items.find((i) => i.links[0] === 'A-3').ref;
  const reopened = setStatus(setStatus(w2, ref, 'closed'), ref, 'open');
  assert.equal(groupInbox([w1, reopened], { now: NOW }).open, groupInbox([w1, w2], { now: NOW }).open);
});

test('snooze: tomorrow / next week set due; an overdue row leaves Overdue; clearing goes to No date', () => {
  assert.equal(snoozeDue('tomorrow', NOW), '2026-09-11');
  assert.equal(snoozeDue('week', NOW), '2026-09-17');
  assert.equal(snoozeDue('none', NOW), null);
  const [w1, w2] = fixture();
  const ref = w2.items.find((i) => i.links[0] === 'A-1').ref;
  const g = groupInbox([w1, editItem(w2, ref, { due: snoozeDue('week', NOW) })], { now: NOW });
  assert.ok(!g.groups.overdue.some((r) => r.item.ref === ref));
  assert.ok(g.groups.week.some((r) => r.item.ref === ref));
  const c = groupInbox([w1, editItem(w2, ref, { due: snoozeDue('none', NOW) })], { now: NOW });
  assert.ok(c.groups.nodate.some((r) => r.item.ref === ref));
});

test('no meetings: zero state with no next meeting named', () => {
  const g = groupInbox([], { now: NOW });
  assert.equal(g.open, 0);
  assert.equal(g.next, null);
});

test('inbox zero names the next meeting (the newest meeting)', () => {
  const [w1, w2] = fixture();
  const closedAll = { ...w2, items: w2.items.map((i) => ({ ...i, status: 'closed' })) };
  const g = groupInbox([w1, closedAll], { now: NOW });
  assert.equal(g.open, 0);
  assert.equal(g.next.id, 'M-W02');
});
