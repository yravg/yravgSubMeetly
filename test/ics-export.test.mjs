/**
 * Due dates to calendar — pure core (add-in `due-to-calendar`). Hand-computed fixtures.
 *   node --test test/ics-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, dueActionRows, foldLine, escapeText, nextDay } from '../src/lib/ics-export.js';

const NOW = new Date('2026-09-02T08:05:09Z');
const m1 = {
  id: 'MOM-K3-W2', seriesId: 'k3', title: 'Komite K3', date: '2026-09-02', locale: 'en',
  items: [
    { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
    { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai', due: '2026-09-10' },
    { ref: 'W2-003', type: 'action', text: { en: 'Book auditor' }, status: 'open', owner: 'Dewi', due: null },
    { ref: 'W2-004', type: 'action', text: { en: 'Done thing' }, status: 'closed', owner: 'Lai', due: '2026-09-05' },
    { ref: 'W2-005', type: 'action', text: { en: 'Bad date' }, status: 'open', owner: 'Lai', due: '2026-02-31' },
  ],
};

test('nextDay rolls month and year ends', () => {
  assert.equal(nextDay('2026-09-10'), '20260911');
  assert.equal(nextDay('2026-12-31'), '20270101');
  assert.equal(nextDay('2028-02-28'), '20280229');
});

test('escapeText escapes backslash, semicolon, comma and newlines (RFC 5545 3.3.11)', () => {
  assert.equal(escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
});

test('foldLine folds at 75 octets, never inside a multibyte character', () => {
  const short = 'SUMMARY:short';
  assert.equal(foldLine(short), short);
  const line = `SUMMARY:${'a'.repeat(100)}`; // 108 octets
  const parts = foldLine(line).split('\r\n');
  assert.equal(parts[0].length, 75);
  assert.equal(parts[1].startsWith(' '), true);
  assert.equal(parts[1].length, 1 + 33); // 108 - 75 = 33 left, plus the folding space
  const cjk = `SUMMARY:${'会'.repeat(30)}`; // 8 + 90 octets
  for (const p of foldLine(cjk).split('\r\n')) assert.ok(Buffer.byteLength(p) <= 75, p);
  assert.equal(foldLine(cjk).replace(/\r\n /g, ''), cjk);
});

test('dueActionRows keeps open actions with a real due date, counts the rest', () => {
  const { rows, skipped } = dueActionRows([m1], { now: NOW });
  assert.deepEqual(rows.map((r) => r.ref), ['W2-002']);
  assert.equal(skipped, 2); // W2-003 no date, W2-005 impossible date; closed W2-004 is not counted
  assert.equal(rows[0].owner, 'Lai');
  assert.equal(rows[0].meetingTitle, 'Komite K3');
});

test('buildIcs matches a hand-computed all-day VEVENT, CRLF line ends', () => {
  const { rows } = dueActionRows([m1], { now: NOW });
  const ics = buildIcs(rows, { now: NOW });
  const expected = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yraverageSubMeetly//Add-in due-to-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:MOM-K3-W2-W2-002@submeetly',
    'DTSTAMP:20260902T080509Z',
    'DTSTART;VALUE=DATE:20260910',
    'DTEND;VALUE=DATE:20260911',
    'SUMMARY:Issue checklist',
    'DESCRIPTION:Komite K3 (2026-09-02)\\nOwner: Lai\\nRef: W2-002',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  assert.equal(ics, expected);
});

test('the file parses: unfold, every line is NAME[;params]:value, BEGIN/END balance, UID unique', () => {
  const many = { ...m1, items: Array.from({ length: 6 }, (_, i) => ({ ref: `W2-0${i}`, type: 'action', status: 'open', owner: 'Ö; Lai, Jr', due: `2026-10-0${i + 1}`, text: { en: `Task ${i}, with; odd\\chars and a very long text ${'x'.repeat(90)}` } })) };
  const ics = buildIcs(dueActionRows([many], { now: NOW }).rows, { now: NOW });
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF found');
  const unfolded = ics.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);
  const stack = [];
  const uids = new Set();
  for (const l of unfolded) {
    assert.match(l, /^[A-Z-]+(;[A-Z-]+=[^:;]+)*:.*$/, l);
    const [name] = l.split(/[:;]/);
    if (name === 'BEGIN') stack.push(l.slice(6));
    else if (name === 'END') assert.equal(stack.pop(), l.slice(4));
    else if (name === 'UID') uids.add(l);
  }
  assert.equal(stack.length, 0);
  assert.equal(uids.size, 6);
  for (const raw of ics.split('\r\n')) assert.ok(Buffer.byteLength(raw) <= 75);
});

test('UID is stable per item id across runs and ignores the clock', () => {
  const a = buildIcs(dueActionRows([m1], { now: NOW }).rows, { now: NOW });
  const b = buildIcs(dueActionRows([m1], { now: new Date('2027-01-01T00:00:00Z') }).rows, { now: new Date('2027-01-01T00:00:00Z') });
  const uid = (s) => s.match(/UID:(.*)\r\n/)[1];
  assert.equal(uid(a), uid(b));
});

test('empty rows -> null, so the UI can say "nothing to export" instead of saving an empty file', () => {
  assert.equal(buildIcs([], { now: NOW }), null);
});
