/**
 * Uji definisi tur terpandu (data saja).
 *   node --test test/learning-tours.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TOURS, TOUR_IDS, tourById, tourProgressPercent } from '../src/lib/learning-tours.js';
import { TRAINING_TOURS } from '../src/lib/learning-progress.js';

test('tours: ids, surfaces and step shape', () => {
  assert.deepEqual(TOUR_IDS, ['record', 'register', 'library']);
  assert.deepEqual([...TRAINING_TOURS], [...TOUR_IDS], 'training tours == defined tours');
  for (const tour of TOURS) {
    assert.ok(tour.title.en && tour.title.id, tour.id);
    assert.ok(['sidepanel', 'minutes'].includes(tour.surface));
    assert.ok(tour.steps.length >= 5, `${tour.id} has ${tour.steps.length} steps`);
    const stepIds = tour.steps.map((s) => s.id);
    assert.equal(new Set(stepIds).size, stepIds.length, 'unique step ids');
    for (const s of tour.steps) {
      assert.match(s.target, /^[a-z0-9-]+$/, `${tour.id}/${s.id} target`);
      assert.ok(s.title.en && s.title.id && s.body.en && s.body.id, `${tour.id}/${s.id} copy`);
      assert.ok(Number.isInteger(s.waitMs) && s.waitMs >= 3000 && s.waitMs <= 6000);
      assert.equal(typeof s.requireClick, 'boolean');
    }
  }
});

test('tours: required targets are present in order', () => {
  const targets = (id) => tourById(id).steps.map((s) => s.target);
  assert.deepEqual(targets('record'), ['notes-project-type', 'btn-start', 'notes-flag', 'notes-end-draft', 'notes-open-register']);
  assert.deepEqual(targets('register'), ['m-switch', 'chips', 'row-accept', 'drawer', 'view-topic', 'view-carry', 'view-series', 'btn-issue']);
  assert.deepEqual(targets('library'), ['view-library', 'lib-domain', 'lib-series', 'lib-import', 'lib-week-next']);
  assert.equal(tourById('nope'), null);
  assert.equal(tourById('register').steps.find((s) => s.target === 'drawer').requireClick, false);
});

test('tourProgressPercent: DCS semantics', () => {
  assert.equal(tourProgressPercent(0, 5, true), 100);
  assert.equal(tourProgressPercent(4, 5, false), 99, 'last step but not completed stays below 100');
  assert.equal(tourProgressPercent(0, 5, false), 20);
  assert.equal(tourProgressPercent(2, 8, false), 38);
  assert.equal(tourProgressPercent(3, 0, false), 0);
  assert.equal(tourProgressPercent(99, 5, false), 99);
  assert.equal(tourProgressPercent(-1, 5, false), 0);
});
