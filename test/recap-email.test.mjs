/**
 * Recap email — pure core (add-in `recap-email`). Hand-computed fixtures.
 *   node --test test/recap-email.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecap, mailtoUrl, isEmail, MAILTO_MAX } from '../src/lib/recap-email.js';

const meeting = {
  id: 'MOM-K3-W2', seriesId: 'k3', title: 'Komite K3', date: '2026-09-02', locale: 'en',
  attendees: [
    { name: 'Lai Tan', org: 'HSE', email: 'lai.tan@example.com' },
    { name: 'Dewi', org: 'Ops' },
    { name: 'Bad', org: null, email: 'not an email' },
  ],
  items: [
    { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
    { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai', due: '2026-09-10' },
    { ref: 'W2-003', type: 'action', text: { en: 'Book auditor' }, status: 'open', owner: 'Dewi', due: null },
    { ref: 'W2-004', type: 'action', text: { en: 'Closed one' }, status: 'closed', owner: 'Lai', due: '2026-09-01' },
    { ref: 'W2-005', type: 'question', text: { en: 'Who owns the permit?' }, status: 'open' },
    { ref: 'W2-006', type: 'question', text: { en: 'Answered' }, status: 'closed' },
    { ref: 'W2-007', type: 'info', text: { en: 'Noise' }, status: 'closed' },
  ],
};

test('isEmail accepts plain addresses and refuses header-breaking ones', () => {
  assert.equal(isEmail('lai.tan@example.com'), true);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('a b@example.com'), false);
  assert.equal(isEmail('a@example.com?cc=x@y.com'), false);
  assert.equal(isEmail('a@example.com,b@example.com'), false);
});

test('buildRecap matches a hand-computed plain-text body', () => {
  const r = buildRecap(meeting);
  assert.equal(r.subject, 'Recap: Komite K3 (2026-09-02)');
  assert.deepEqual(r.to, ['lai.tan@example.com']);
  assert.equal(r.empty, false);
  assert.equal(r.body, [
    'Komite K3',
    'Date: 2026-09-02',
    'Attendees: Lai Tan (HSE), Dewi (Ops), Bad',
    '',
    'Decisions',
    '- W2-001 Secure cranes',
    '',
    'Actions',
    '- W2-002 Issue checklist — Lai, due 2026-09-10',
    '- W2-003 Book auditor — Dewi, no due date',
    '',
    'Open questions',
    '- W2-005 Who owns the permit?',
    '',
  ].join('\n'));
  assert.deepEqual(r.noEmail, ['Dewi', 'Bad']);
});

test('sections with nothing in them are left out; a meeting with no items is "empty"', () => {
  const r = buildRecap({ ...meeting, items: meeting.items.filter((i) => i.type === 'decision') });
  assert.ok(!r.body.includes('Actions'));
  assert.ok(!r.body.includes('Open questions'));
  const e = buildRecap({ ...meeting, items: [] });
  assert.equal(e.empty, true);
});

test('labels and language: text is picked in the UI language, headings come from labels', () => {
  const r = buildRecap({ ...meeting, items: [{ ...meeting.items[0], text: { en: 'Secure cranes', id: 'Amankan crane' } }] }, {
    lang: 'id', labels: { subject: 'Ringkasan', date: 'Tanggal', attendees: 'Peserta', decisions: 'Keputusan', actions: 'Tindak lanjut', questions: 'Pertanyaan terbuka', due: 'tenggat', noDue: 'tanpa tenggat' },
  });
  assert.equal(r.subject, 'Ringkasan: Komite K3 (2026-09-02)');
  assert.ok(r.body.includes('Tanggal: 2026-09-02'));
  assert.ok(r.body.includes('- W2-001 Amankan crane'));
});

test('mailtoUrl encodes subject and body, joins recipients, uses CRLF in the body', () => {
  const u = mailtoUrl({ to: ['a@example.com', 'b@example.com'], subject: 'Recap: A&B', body: 'x\ny' });
  assert.equal(u.tooLong, false);
  assert.equal(u.url, 'mailto:a@example.com,b@example.com?subject=Recap%3A%20A%26B&body=x%0D%0Ay');
});

test('mailtoUrl without recipients is still a valid draft', () => {
  assert.equal(mailtoUrl({ to: [], subject: 's', body: 'b' }).url, 'mailto:?subject=s&body=b');
});

test('a body past the mailto limit gives no link, only the copy path', () => {
  const body = 'word '.repeat(600);
  const u = mailtoUrl({ to: [], subject: 's', body });
  assert.equal(u.tooLong, true);
  assert.equal(u.url, null);
  assert.ok(MAILTO_MAX <= 2000);
  const edge = mailtoUrl({ to: [], subject: 's', body: 'a'.repeat(MAILTO_MAX - 'mailto:?subject=s&body='.length) });
  assert.equal(edge.tooLong, false);
  assert.equal(edge.url.length, MAILTO_MAX);
});
