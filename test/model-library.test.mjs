// node --test test/model-library.test.mjs — the main app's model library rules (PMM-028/029/030).
import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryRows, languagesOf, canDelete, languageRows, pairLangs, manualDir } from '../src/lib/model-library.js';

const names = { en: 'English', id: 'Indonesian', ja: 'Japanese', zh: 'Chinese' };
const res = {
  recommended: { id: 'Qwen/big', downloaded: false },
  catalog: [
    { kind: 'asr', id: 'openai/whisper-base', label: 'Whisper base', selected: true, downloaded: true },
    { kind: 'asr', id: 'openai/whisper-small', label: 'Whisper small', downloaded: true },
    { kind: 'translate', id: 'Qwen/small', label: 'Qwen small', selected: true, downloaded: true },
    { kind: 'translate', id: 'Qwen/big', label: 'Qwen big', pulling: true },
    { kind: 'translate-pair', id: 'Helsinki-NLP/opus-mt-en-id', label: 'OPUS-MT English to Indonesian', downloaded: true },
    { kind: 'translate-pair', id: 'Helsinki-NLP/opus-mt-ja-en', label: 'OPUS-MT Japanese to English' },
  ],
};
const ids = (rows) => rows.map((m) => m.id.split('/')[1]);

test('filters: on device, all, recommended (engine pick, speech in use, the pair for my languages)', () => {
  assert.deepEqual(ids(libraryRows(res, { filter: 'device' })), ['whisper-base', 'whisper-small', 'small', 'opus-mt-en-id']);
  assert.equal(libraryRows(res, { filter: 'all' }).length, 6);
  assert.deepEqual(ids(libraryRows(res, { filter: 'recommended', src: 'en', tgt: 'id' })), ['whisper-base', 'big', 'opus-mt-en-id']);
  assert.deepEqual(ids(libraryRows(res, { filter: 'recommended', src: 'ja', tgt: 'en' })), ['whisper-base', 'big', 'opus-mt-ja-en']);
});

test('search reads name, id, kind and languages, ignoring case', () => {
  assert.deepEqual(ids(libraryRows(res, { query: ' JAPANESE ', names })), ['opus-mt-ja-en']);
  assert.deepEqual(ids(libraryRows(res, { query: 'whisper', filter: 'device' })), ['whisper-base', 'whisper-small']);
  assert.deepEqual(libraryRows(res, { query: 'nothing like it' }), []);
  assert.deepEqual(libraryRows(null), [], 'an engine without a catalog lists nothing');
});

test('languages, delete rule, by-hand folder', () => {
  assert.equal(languagesOf(res.catalog[0], names), 'All languages');
  assert.equal(languagesOf(res.catalog[4], names), 'English → Indonesian');
  assert.deepEqual(pairLangs('Qwen/small'), null);
  assert.deepEqual(res.catalog.map(canDelete), [false, true, false, false, true, false], 'never the one in use, a download or what is not on disk');
  assert.equal(manualDir('openai/whisper-small'), '%USERPROFILE%\\yravgSubMeetly-models\\openai--whisper-small');
});

test('languages on this device', () => {
  const rows = languageRows(res, ['en', 'id', 'zh'], names);
  assert.deepEqual(rows.map((r) => r.text), [
    'Speech on device · translated by Whisper itself · fast pair from Japanese: not downloaded',
    'Speech on device · translated by Qwen small, on device · fast pair from English: on device',
    'Speech on device · translated by Qwen small, on device',
  ]);
  assert.equal(languageRows({ catalog: [] }, ['id'], names)[0].text, 'Speech model not chosen · translation off');
});
