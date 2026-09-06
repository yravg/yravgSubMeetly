// Ukuran panel harus selalu berada di rentang aman sebelum disimpan.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampSize } from '../src/lib/resizable.js';

test('clampSize keeps values inside [min, max] and rounds', () => {
  assert.equal(clampSize(50, 160, 800), 160);
  assert.equal(clampSize(5000, 160, 800), 800);
  assert.equal(clampSize(321.6, 160, 800), 322);
});

test('clampSize rejects non-numeric input (stale storage)', () => {
  assert.equal(clampSize('abc', 160, 800), null);
  assert.equal(clampSize(undefined, 160, 800), null);
  assert.equal(clampSize(null, 160, 800), null, 'nothing saved yet must not collapse to min');
});
