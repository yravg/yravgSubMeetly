import test from 'node:test';
import assert from 'node:assert/strict';
import { engineWording } from '../src/lib/engine-wording.js';

test('Helper words become Engine; code-like spellings stay', () => {
  const cases = [
    ['Native Helper', 'Engine'],
    ['Native helper · cpu', 'Engine · cpu'],
    ['Helper address', 'Engine address'],
    ['Restart the helper to apply.', 'Restart the engine to apply.'],
    ['Island captions need the Native Helper engine.', 'Island captions need the Engine.'],
    ['Subtitel di island memerlukan mesin Native Helper.', 'Subtitel di island memerlukan Engine.'],
    ['Native Messaging host com.yraveragesubmin.helper is installed', 'Native Messaging host com.yraveragesubmin.helper is installed'],
    ['class helper-status and ./helper/run', 'class helper-status and ./helper/run'],
    ['Browser (in-extension)', 'Browser (in-extension)'],
  ];
  for (const [from, to] of cases) assert.equal(engineWording(from), to, from);
});
