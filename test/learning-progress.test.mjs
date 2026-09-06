/**
 * Uji lapisan XP/level/pencapaian/streak (port dari DCS learning.py).
 *   node --test test/learning-progress.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHIEVEMENTS, LEVELS, XP_BY_KIND, TRAINING_TOURS,
  createState, normalizeState, awardEvent, recordTourStep, completeTour, recordHelpView,
  recordQuizAnswer, touchStreak, evaluateAchievements, levelFromXp, xpBarPercent,
  understandingFromState, understandingLabel, summary, eventHistory,
  createLearningStore, memoryBackend, STORE_KEY,
} from '../src/lib/learning-progress.js';

const NOW = new Date('2026-09-05T08:00:00Z');
const has = (s, id) => Object.hasOwn(s.achievements, id);

test('xp: idempotent event keys', () => {
  const s = createState();
  const a = awardEvent(s, 'mom-issued:MOM-1', 'mom-issued', { now: NOW });
  const b = awardEvent(s, 'mom-issued:MOM-1', 'mom-issued', { now: NOW });
  assert.equal(a.xp, 40);
  assert.equal(b.xp, 0);
  assert.equal(b.duplicate, true);
  assert.equal(s.xp, 40);
  assert.equal(Object.keys(s.events).length, 1);
  assert.throws(() => awardEvent(s, 'x', 'nope'), /kind tidak dikenal/);
  for (const [k, v] of Object.entries({ 'tour-start': 10, 'tour-watch': 50, 'tour-try': 100, 'help-view': 8 })) {
    assert.equal(XP_BY_KIND[k], v, `DCS value for ${k}`);
  }
});

test('levels: DCS table boundaries', () => {
  assert.deepEqual(LEVELS.map((l) => [l.minXp, l.level, l.title.en]), [
    [0, 1, 'Newcomer'], [100, 2, 'Trainee'], [250, 3, 'Operator'], [450, 4, 'Controller'],
    [700, 5, 'Specialist'], [1000, 6, 'Expert'], [1400, 7, 'Master'],
  ]);
  const l0 = levelFromXp(0);
  assert.equal(l0.level, 1); assert.equal(l0.xpIntoLevel, 0); assert.equal(l0.xpForNext, 100); assert.equal(l0.nextLevelXp, 100);
  const l999 = levelFromXp(999);
  assert.equal(l999.level, 5); assert.equal(l999.xpIntoLevel, 299); assert.equal(l999.xpForNext, 300);
  const l1000 = levelFromXp(1000);
  assert.equal(l1000.level, 6); assert.equal(l1000.title.en, 'Expert'); assert.equal(l1000.xpIntoLevel, 0); assert.equal(l1000.xpForNext, 400);
  const top = levelFromXp(5000);
  assert.equal(top.level, 7); assert.equal(top.xpForNext, 0); assert.equal(top.nextLevelXp, 1400);
  assert.equal(levelFromXp(-5).level, 1);
  assert.equal(levelFromXp('garbage').level, 1);
});

test('xpBarPercent clamps like learningProgress.ts', () => {
  assert.equal(xpBarPercent(0, 100), 0);
  assert.equal(xpBarPercent(-4, 100), 0);
  assert.equal(xpBarPercent(50, 100), 50);
  assert.equal(xpBarPercent(150, 100), 100);
  assert.equal(xpBarPercent(10, 0), 100, 'top level → full bar');
  assert.equal(xpBarPercent(1, 3), 33);
});

test('understanding: formula matches DCS for a known state', () => {
  const s = createState();
  completeTour(s, 'record', 'try', { stepCount: 5, now: NOW });     // try 8 + training 8
  completeTour(s, 'register', 'watch', { stepCount: 8, now: NOW }); // watch 3
  for (let i = 0; i < 5; i++) recordHelpView(s, `topic-${i}`, { now: NOW }); // 5*0.8 = 4
  const u = understandingFromState(s.tours, s.help);
  assert.equal(u.score, 23);
  assert.equal(u.label.en, 'Familiar');
  assert.deepEqual([u.tryTours, u.watchTours, u.helpTopics, u.trainingTry], [1, 1, 5, 1]);
  // help is capped at 40 topics
  const s2 = createState();
  for (let i = 0; i < 60; i++) s2.help[`t${i}`] = null;
  assert.equal(understandingFromState(s2.tours, s2.help).score, 32);
  // all three training tours in try → 3*8 + 3*8 = 48; + 40 help → 80 → Expert
  const s3 = createState();
  for (const id of TRAINING_TOURS) completeTour(s3, id, 'try', { now: NOW });
  assert.equal(understandingFromState(s3.tours, s3.help).score, 48);
  for (let i = 0; i < 40; i++) s3.help[`h${i}`] = null;
  const u3 = understandingFromState(s3.tours, s3.help);
  assert.equal(u3.score, 80);
  assert.equal(u3.label.en, 'Expert');
  assert.equal(understandingLabel(0).en, 'Getting started');
  assert.equal(understandingLabel(40).en, 'Competent');
  assert.equal(understandingLabel(60).en, 'Proficient');
  assert.equal(understandingFromState(null, null).score, 0);
});

test('achievements: every id has bilingual copy and unlocks are idempotent', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.title.en && a.title.id && a.description.en && a.description.id, a.id);
  }
  const s = createState();
  const r = recordTourStep(s, 'record', 'watch', 0, 5, { now: NOW });
  assert.deepEqual(r.newly, ['first-steps']);
  assert.equal(r.xp, 10);
  assert.deepEqual(evaluateAchievements(s, { now: NOW }), [], 'second evaluation adds nothing');
  assert.equal(s.achievements['first-steps'], NOW.toISOString());
});

test('achievements: tour-based unlock conditions', () => {
  const s = createState();
  let r = completeTour(s, 'record', 'watch', { stepCount: 5, now: NOW });
  assert.equal(r.xp, 60, 'start 10 + watch 50');
  assert.ok(r.newly.includes('spectator') && r.newly.includes('tour-record') && r.newly.includes('first-steps'));
  assert.ok(!has(s, 'hands-on'));
  r = completeTour(s, 'record', 'try', { stepCount: 5, now: NOW });
  assert.equal(r.xp, 110, 'start 10 + try 100');
  assert.ok(r.newly.includes('hands-on') && r.newly.includes('both-modes'));
  r = completeTour(s, 'record', 'try', { now: NOW });
  assert.equal(r.xp, 0, 'repeat completion awards nothing');
  completeTour(s, 'register', 'watch', { now: NOW });
  assert.ok(has(s, 'tour-register') && !has(s, 'training-watch'));
  completeTour(s, 'library', 'try', { now: NOW });
  assert.ok(has(s, 'tour-library') && has(s, 'training-watch') && !has(s, 'training-try'));
  completeTour(s, 'register', 'try', { now: NOW });
  assert.ok(has(s, 'training-try'));
  assert.ok(!has(s, 'module-five'));
  completeTour(s, 'extra-1', 'watch', { now: NOW });
  completeTour(s, 'extra-2', 'watch', { now: NOW });
  assert.ok(has(s, 'module-five'), '5 distinct tours');
  assert.equal(s.tours.record.try.maxStep, 4, 'completion lifts maxStep to stepCount-1');
});

test('achievements: help, xp, understanding thresholds', () => {
  const s = createState();
  for (let i = 0; i < 4; i++) recordHelpView(s, `h${i}`, { now: NOW });
  assert.ok(!has(s, 'help-5'));
  recordHelpView(s, 'h4', { now: NOW });
  assert.ok(has(s, 'help-5'));
  assert.equal(recordHelpView(s, 'h4', { now: NOW }).xp, 0, 'same topic no XP');
  for (let i = 5; i < 15; i++) recordHelpView(s, `h${i}`, { now: NOW });
  assert.ok(has(s, 'help-15') && !has(s, 'help-40'));
  for (let i = 15; i < 40; i++) recordHelpView(s, `h${i}`, { now: NOW });
  assert.ok(has(s, 'help-40'));
  assert.equal(s.xp, 320);
  assert.ok(!has(s, 'xp-500'));
  for (let i = 0; i < 5; i++) awardEvent(s, `mom-issued:M${i}`, 'mom-issued', { now: NOW });
  assert.equal(s.xp, 520);
  assert.ok(has(s, 'xp-500') && has(s, 'first-minutes') && !has(s, 'xp-1000'));
  for (let i = 0; i < 5; i++) completeTour(s, `t${i}`, 'try', { now: NOW });
  assert.ok(s.xp >= 1000 && has(s, 'xp-1000'));
  // understanding: 5 try (40) + 40 help (32) = 72 → gets it; not hall ready
  assert.equal(understandingFromState(s.tours, s.help).score, 72);
  assert.ok(has(s, 'understanding-60') && !has(s, 'understanding-90'));
  for (const id of TRAINING_TOURS) completeTour(s, id, 'try', { now: NOW });
  // 8 try (64) + 3 training (24) + 32 = 120 → 100
  assert.equal(understandingFromState(s.tours, s.help).score, 100);
  assert.ok(has(s, 'understanding-90'));
});

test('achievements: product-specific — reviewer, quiz-10, streak-7', () => {
  const s = createState();
  for (let i = 0; i < 24; i++) awardEvent(s, `item-accepted:W1-${i}`, 'item-accepted', { now: NOW });
  assert.ok(!has(s, 'reviewer'));
  awardEvent(s, 'item-accepted:W1-24', 'item-accepted', { now: NOW });
  assert.ok(has(s, 'reviewer'));
  for (let i = 0; i < 9; i++) recordQuizAnswer(s, `q${i}`, true, { now: NOW });
  recordQuizAnswer(s, 'wrong', false, { now: NOW });
  assert.deepEqual(s.quiz, { asked: 10, correct: 9 });
  assert.ok(!has(s, 'quiz-10'));
  const r = recordQuizAnswer(s, 'q9', true, { now: NOW });
  assert.equal(r.xp, 15);
  assert.ok(has(s, 'quiz-10'));
  assert.equal(recordQuizAnswer(s, 'q9', true, { now: NOW }).xp, 0, 'same question no XP');
  assert.equal(s.quiz.correct, 11, 'counters still move');
});

test('streak: increments on consecutive days, resets after a gap, once per day', () => {
  const s = createState();
  const day = (n) => new Date(Date.UTC(2026, 8, n, 9));
  let r = touchStreak(s, day(1));
  assert.equal(r.xp, 10);
  assert.deepEqual(s.streak, { current: 1, best: 1, lastDay: '2026-09-01' });
  r = touchStreak(s, day(1));
  assert.equal(r.xp, 0, 'same day: no second award');
  assert.equal(s.streak.current, 1);
  for (let n = 2; n <= 6; n++) touchStreak(s, day(n));
  assert.equal(s.streak.current, 6);
  assert.ok(!has(s, 'streak-7'));
  r = touchStreak(s, day(7));
  assert.equal(s.streak.current, 7);
  assert.ok(r.newly.includes('streak-7'));
  touchStreak(s, day(10));
  assert.deepEqual(s.streak, { current: 1, best: 7, lastDay: '2026-09-10' });
  assert.equal(s.xp, 8 * 10);
  assert.deepEqual(touchStreak(s, 'not a date'), { xp: 0, newly: [], day: null });
});

test('normalizeState tolerates garbage', () => {
  assert.deepEqual(normalizeState(undefined), createState());
  assert.deepEqual(normalizeState('junk'), createState());
  assert.deepEqual(normalizeState([1, 2]), createState());
  const s = normalizeState({
    xp: '250.7', events: { ok: { kind: 'help-view', xp: 8, at: 'x' }, bad: 3, '': {} },
    tours: { record: { watch: { completed: 1, stepCount: '5' }, try: 'nope' }, junk: 4 },
    help: { a: 1, b: '2026' }, achievements: { 'first-steps': true, x: 5 },
    quiz: { asked: 2, correct: 9 }, streak: { current: -1, best: 'z', lastDay: 'yesterday' },
  });
  assert.equal(s.xp, 250);
  assert.deepEqual(Object.keys(s.events), ['ok']);
  assert.equal(s.tours.record.watch.completed, true);
  assert.equal(s.tours.record.watch.maxStep, 4);
  assert.equal(s.tours.record.try.completed, false);
  assert.equal(s.tours.junk, undefined);
  assert.deepEqual(s.help, { a: null, b: '2026' });
  assert.deepEqual(s.achievements, { 'first-steps': null });
  assert.deepEqual(s.quiz, { asked: 2, correct: 2 });
  assert.deepEqual(s.streak, { current: 0, best: 0, lastDay: null });
  assert.equal(summary(s).level, 3);
});

test('summary + history shape', () => {
  const s = createState();
  completeTour(s, 'record', 'watch', { stepCount: 5, now: NOW });
  recordTourStep(s, 'register', 'try', 2, 8, { now: new Date(NOW.getTime() + 1000) });
  const sum = summary(s);
  assert.equal(sum.xp, 70);
  assert.equal(sum.level, 1);
  assert.equal(sum.xpPercent, 70);
  assert.equal(sum.achievements.length, ACHIEVEMENTS.length);
  assert.equal(sum.achievements.find((a) => a.id === 'spectator').unlockedAt, NOW.toISOString());
  assert.equal(sum.achievements.find((a) => a.id === 'hands-on').unlockedAt, null);
  assert.deepEqual(sum.tours.map((t) => [t.id, t.mode, t.percent]), [['record', 'watch', 100], ['register', 'try', 38]]);
  assert.equal(sum.understanding.score, 3);
  const hist = eventHistory(s);
  assert.equal(hist.length, 3);
  assert.equal(hist[0].key, 'tour-start:register:try', 'newest first');
});

test('store: round-trip with memoryBackend', async () => {
  const backend = memoryBackend();
  const store = createLearningStore(backend);
  assert.deepEqual(await store.load(), createState());
  const { result } = await store.update((s) => completeTour(s, 'record', 'try', { stepCount: 5, now: NOW }));
  assert.equal(result.xp, 110);
  const again = await store.load();
  assert.equal(again.xp, 110);
  assert.ok(Object.hasOwn(again.achievements, 'hands-on'));
  assert.ok(backend._dump()[STORE_KEY]);
  await backend.set(STORE_KEY, { xp: 'garbage', tours: 7 });
  assert.equal((await store.load()).xp, 0, 'corrupt payload normalizes');
  await store.reset();
  assert.deepEqual(await store.load(), createState());
  assert.throws(() => createLearningStore({}), /get\/set/);
});
