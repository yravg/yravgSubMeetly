/**
 * Interpreter-mode settings normalisation.
 *   node --test test/interpreter.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeInterpreter,
  isConsecutive,
  interpreterPairs,
  INTERPRETER_MODES,
} from '../src/lib/interpreter.js';

test('settings from before this feature load unchanged (one-way)', () => {
  const old = { uiLang: 'en', engine: 'browser', dualLine: false };
  assert.deepEqual(normalizeInterpreter(old, 'ja', 'en'), {
    mode: 'simultaneous',
    a: 'ja',
    b: 'en',
  });
  assert.deepEqual(normalizeInterpreter(null, 'zh', 'en'), {
    mode: 'simultaneous',
    a: 'zh',
    b: 'en',
  });
  assert.deepEqual(normalizeInterpreter(undefined, 'de', 'fr'), {
    mode: 'simultaneous',
    a: 'de',
    b: 'fr',
  });
});

test('a stored consecutive record round-trips', () => {
  const s = { interpreter: { mode: 'consecutive', a: 'zh', b: 'en' } };
  assert.deepEqual(normalizeInterpreter(s, 'ja', 'en'), { mode: 'consecutive', a: 'zh', b: 'en' });
});

test('unknown or missing mode degrades to simultaneous', () => {
  assert.equal(normalizeInterpreter({ interpreter: { a: 'zh', b: 'en' } }, 'ja', 'en').mode,
    'simultaneous');
  assert.equal(
    normalizeInterpreter({ interpreter: { mode: 'bilateral', a: 'zh', b: 'en' } }, 'ja', 'en').mode,
    'simultaneous',
  );
  assert.equal(normalizeInterpreter({ interpreter: 'consecutive' }, 'ja', 'en').mode, 'simultaneous');
});

test('missing a/b fall back to the current From/To languages', () => {
  assert.deepEqual(normalizeInterpreter({ interpreter: { mode: 'consecutive' } }, 'zh', 'en'), {
    mode: 'consecutive',
    a: 'zh',
    b: 'en',
  });
  assert.deepEqual(
    normalizeInterpreter({ interpreter: { mode: 'consecutive', a: 'ko' } }, 'zh', 'en'),
    { mode: 'consecutive', a: 'ko', b: 'en' },
  );
});

test('a two-way session needs two distinct concrete languages', () => {
  // same language on both ends
  assert.equal(
    normalizeInterpreter({ interpreter: { mode: 'consecutive', a: 'en', b: 'en' } }, 'ja', 'en').mode,
    'simultaneous',
  );
  // 'auto' is not a usable end of a two-way pair — it falls back to the
  // current From language, which IS concrete, so the mode survives
  assert.deepEqual(
    normalizeInterpreter({ interpreter: { mode: 'consecutive', a: 'auto', b: 'en' } }, 'ja', 'en'),
    { mode: 'consecutive', a: 'ja', b: 'en' },
  );
  // …but when the fallback is 'auto' too there is nothing concrete left
  assert.equal(
    normalizeInterpreter({ interpreter: { mode: 'consecutive' } }, 'auto', 'en').mode,
    'simultaneous',
  );
});

test('isConsecutive / interpreterPairs', () => {
  const two = { mode: 'consecutive', a: 'zh', b: 'en' };
  const one = { mode: 'simultaneous', a: 'ja', b: 'en' };
  assert.equal(isConsecutive(two), true);
  assert.equal(isConsecutive(one), false);
  assert.equal(isConsecutive(null), false);
  assert.deepEqual(interpreterPairs(two), [
    ['zh', 'en'],
    ['en', 'zh'],
  ]);
  assert.deepEqual(interpreterPairs(one), []);
});

test('the mode list is exactly the two supported modes', () => {
  assert.deepEqual(INTERPRETER_MODES, ['simultaneous', 'consecutive']);
});
