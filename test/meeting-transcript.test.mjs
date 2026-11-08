/**
 * T03 follow-up: a meeting keeps its own transcript lines (written by End & draft)
 * and the draft options read them before the library.
 *   node --test test/meeting-transcript.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeeting, sessionLinesToTranscript } from '../src/lib/notes-schema.js';

test('createMeeting keeps transcript lines in one shape and drops empty ones', () => {
  const m = createMeeting({
    id: 'T-1',
    transcript: [
      { t0: 1, t1: 3, src: 'Halo semua', tgt: 'Hello all' },
      { t0: 4, t1: 6, source: 'Lanjut', translation: '', speaker: 'Mei' },
      { t0: 7, t1: 8, src: '  ', tgt: '' },
    ],
  });
  assert.deepEqual(m.transcript, [
    { t0: 1, t1: 3, speaker: '', source: 'Halo semua', translation: 'Hello all' },
    { t0: 4, t1: 6, speaker: 'Mei', source: 'Lanjut', translation: '' },
  ]);
});

test('a meeting without transcript has an empty list, and round-trips', () => {
  assert.deepEqual(createMeeting({ id: 'T-2' }).transcript, []);
  const once = createMeeting({ id: 'T-3', transcript: [{ t0: 0, src: 'a b' }] });
  assert.equal(createMeeting(JSON.parse(JSON.stringify(once))).transcript.length, 1);
});

test('the list is capped so a long session cannot fill the store', () => {
  const lines = Array.from({ length: 4000 }, (_, i) => ({ t0: i, t1: i + 1, src: `line ${i}` }));
  assert.equal(createMeeting({ id: 'T-4', transcript: lines }).transcript.length, 3000);
});

test('sessionLinesToTranscript maps the side panel shape', () => {
  assert.deepEqual(sessionLinesToTranscript([{ t0: 1, t1: 2, src: 'a b', tgt: 'c' }]), [{ t0: 1, t1: 2, speaker: '', source: 'a b', translation: 'c' }]);
});
