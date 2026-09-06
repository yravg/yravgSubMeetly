/**
 * Uji pembangkit kuis dari Meeting.
 *   node --test test/learning-quiz.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeeting } from '../src/lib/notes-schema.js';
import { buildQuiz, gradeAnswer, QUIZ_KINDS } from '../src/lib/learning-quiz.js';

function meeting() {
  return createMeeting({
    id: 'MOM-CPOC7-W36', seriesId: 'CPOC7-WEEKLY', seq: 36, date: '2026-09-02',
    participants: [{ name: 'Lai Kong Teng' }, { name: 'Nasmee Samang' }, { name: 'Wang Lei' }, { name: 'Sari Dewi' }],
    agenda: [
      { ref: 'A1', title: 'Safety', covered: true },
      { ref: 'A2', title: 'Dropped-object controls', covered: true },
      { ref: 'A5', title: 'Procurement', covered: true },
      { ref: 'A8', title: 'Look-ahead', covered: false },
    ],
    items: [
      { ref: 'W36-001', type: 'info', agenda: 'A1', text: { en: 'Toolbox talk held' }, status: 'closed' },
      { ref: 'W36-002', type: 'decision', agenda: 'A2', text: { en: 'Inspect cranes before transport' }, owner: 'Lai Kong Teng', status: 'closed' },
      { ref: 'W36-003', type: 'action', agenda: 'A2', text: { en: 'Issue crane inspection checklist' }, owner: 'Lai Kong Teng', due: '2026-09-08', status: 'open' },
      { ref: 'W36-004', type: 'action', agenda: 'A5', text: { en: 'Expedite flange PO' }, owner: 'Wang Lei', due: '2026-09-12', status: 'progress' },
      { ref: 'W36-005', type: 'action', agenda: 'A5', text: { en: 'Confirm vendor audit date' }, owner: 'Sari Dewi', due: '2026-09-15', status: 'closed' },
      { ref: 'W36-017', type: 'risk', agenda: 'A8', text: { en: 'Delay risk on coating' }, owner: 'Nasmee Samang', due: '2026-09-09', status: 'open' },
      { ref: 'W36-016', type: 'metric', agenda: 'A8', text: { en: 'Cumulative progress' }, status: 'closed',
        metric: { measure: 'cumulative_progress', value: 10.89, baseline: 9.78, unit: '%' } },
      { ref: 'W36-018', type: 'question', agenda: 'A8', text: { en: 'Who signs the DNS shipment?' }, status: 'open' },
    ],
  });
}

test('quiz: deterministic for the same seed, differs across seeds', () => {
  const a = buildQuiz(meeting(), { count: 5, seed: 'abc' });
  const b = buildQuiz(meeting(), { count: 5, seed: 'abc' });
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  const c = buildQuiz(meeting(), { count: 5, seed: 'xyz' });
  assert.notDeepEqual(a.map((q) => [q.id, q.choices]), c.map((q) => [q.id, q.choices]));
  assert.equal(new Set(a.map((q) => q.id)).size, 5, 'unique question ids');
});

test('quiz: every question is well-formed', () => {
  const qs = buildQuiz(meeting(), { count: 12, seed: 7 });
  assert.ok(qs.length >= 8);
  assert.deepEqual([...new Set(qs.map((q) => q.kind))].sort(), [...QUIZ_KINDS].sort(), 'all five kinds appear');
  for (const q of qs) {
    assert.ok(QUIZ_KINDS.includes(q.kind), q.id);
    assert.ok(q.prompt.en && q.prompt.id, `${q.id} prompt`);
    assert.equal(q.choices.length, 4, `${q.id} choices`);
    assert.equal(new Set(q.choices.map(String)).size, 4, `${q.id} distinct distractors`);
    assert.ok(q.answerIndex >= 0 && q.answerIndex < 4, `${q.id} answerIndex`);
    assert.ok(q.ref);
  }
});

test('quiz: answers are correct against the meeting', () => {
  const m = meeting();
  const qs = buildQuiz(m, { count: 20, seed: 'check' });
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  assert.equal(byId['who-owns:W36-004'].choices[byId['who-owns:W36-004'].answerIndex], 'Wang Lei');
  assert.equal(byId['due-when:W36-003'].choices[byId['due-when:W36-003'].answerIndex], '2026-09-08');
  assert.equal(byId['what-type:W36-017'].choices[byId['what-type:W36-017'].answerIndex], 'risk');
  assert.ok(byId['what-type:W36-017'].choiceLabels[0].id, 'type choices carry bilingual labels');
  const hm = byId['how-many:MOM-CPOC7-W36'];
  assert.equal(hm.choices[hm.answerIndex], 2, 'two actions not closed');
  const ag = byId['which-agenda:W36-001'];
  assert.match(ag.choices[ag.answerIndex], /^A1 — Safety/);
  assert.ok(gradeAnswer(hm, hm.answerIndex));
  assert.ok(!gradeAnswer(hm, (hm.answerIndex + 1) % 4));
  assert.ok(!gradeAnswer(hm, 1.5));
  assert.ok(!gradeAnswer(null, 0));
});

test('quiz: never crashes on empty or thin meetings', () => {
  assert.deepEqual(buildQuiz(createMeeting({ id: 'x', seriesId: 's' })), []);
  assert.deepEqual(buildQuiz(null), []);
  assert.deepEqual(buildQuiz({}), []);
  assert.deepEqual(buildQuiz(meeting(), { count: 0 }), []);
  // one action, one owner, no agenda: who-owns / which-agenda lack distractors and are skipped
  const thin = createMeeting({ id: 't', seriesId: 's', items: [
    { ref: 'T-1', type: 'action', text: { en: 'Do it' }, owner: 'Only One', due: '2026-09-08', status: 'open' },
  ] });
  const qs = buildQuiz(thin, { count: 10, seed: 1 });
  assert.ok(qs.length > 0);
  assert.ok(qs.every((q) => ['what-type', 'due-when', 'how-many'].includes(q.kind)), qs.map((q) => q.kind).join());
  for (const q of qs) assert.equal(new Set(q.choices.map(String)).size, 4);
});
