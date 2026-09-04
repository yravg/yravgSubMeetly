/**
 * needsTranslation / pickUntranslatedLines must judge a two-way (consecutive)
 * line by its own `dir`, not by the session's srcLang/tgtLang — half of a
 * two-way session's lines run opposite to the session config.
 *   node --test test/translation-utils.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  needsTranslation,
  lineDirection,
  pickUntranslatedLines,
  cueToLine,
} from '../src/lib/translation-utils.js';

test('a two-way EN->ZH line is judged by its own dir, not the zh/en session config', () => {
  // Session is configured (a='zh', b='en') for the two-way pair, but this
  // particular line ran the other way: spoken English, translated to Chinese.
  const line = {
    src: 'Hello, how are you?',
    tgt: '你好，你怎么样？',
    dir: { src: 'en', tgt: 'zh' },
  };
  // Judging by the raw session languages (zh, en) would wrongly flag this —
  // a Chinese target with an 'en' session tgtLang trips the CJK-vs-en rule.
  assert.equal(needsTranslation(line, 'zh', 'en'), false);
});

test('a two-way ZH->EN line with an untranslated (still-CJK) target IS flagged', () => {
  const line = {
    src: '你好，你怎么样？',
    tgt: '你好，你怎么样？', // translation never landed — still Chinese
    dir: { src: 'zh', tgt: 'en' },
  };
  assert.equal(needsTranslation(line, 'zh', 'en'), true);
});

test('a two-way ZH->EN line WITH a real English target is not flagged', () => {
  const line = {
    src: '你好，你怎么样？',
    tgt: 'Hello, how are you?',
    dir: { src: 'zh', tgt: 'en' },
  };
  assert.equal(needsTranslation(line, 'zh', 'en'), false);
});

test('lines without dir behave exactly as before (session languages apply)', () => {
  // tgtLang 'en' with a still-CJK target: old one-way rule flags it.
  const untranslated = { src: '你好', tgt: '你好' };
  assert.equal(needsTranslation(untranslated, 'zh', 'en'), true);

  const translated = { src: '你好', tgt: 'Hello' };
  assert.equal(needsTranslation(translated, 'zh', 'en'), false);

  // ja -> en CJK-without-latin special case, unchanged.
  const jaUntranslated = { src: 'こんにちは', tgt: 'こんにちは' };
  assert.equal(needsTranslation(jaUntranslated, 'ja', 'en'), true);

  const jaTranslated = { src: 'こんにちは', tgt: 'Hello' };
  assert.equal(needsTranslation(jaTranslated, 'ja', 'en'), false);
});

test('lineDirection reads a line dir when present and falls back to session languages', () => {
  assert.deepEqual(
    lineDirection({ dir: { src: 'en', tgt: 'zh' } }, 'zh', 'en'),
    { srcLang: 'en', tgtLang: 'zh' },
  );
  assert.deepEqual(lineDirection({}, 'zh', 'en'), { srcLang: 'zh', tgtLang: 'en' });
  // malformed dir (missing a leg) is ignored, not partially trusted
  assert.deepEqual(lineDirection({ dir: { src: 'en' } }, 'zh', 'en'), { srcLang: 'zh', tgtLang: 'en' });
});

test('pickUntranslatedLines carries dir through onto the returned lines', () => {
  const lines = [
    {
      t0: 0,
      t1: 2,
      src: 'Hello',
      tgt: '你好',
      dir: { src: 'en', tgt: 'zh' },
    }, // fully translated for its own direction — should be excluded
    {
      t0: 3,
      t1: 5,
      src: '你好吗',
      tgt: '你好吗', // untranslated
      dir: { src: 'zh', tgt: 'en' },
    },
    {
      t0: 6,
      t1: 8,
      src: 'こんにちは',
      tgt: 'こんにちは', // untranslated, no dir — old one-way path
    },
  ];
  const picked = pickUntranslatedLines([lines], 'ja', 'en');
  assert.equal(picked.length, 2);
  const withDir = picked.find((l) => l.t0 === 3);
  assert.deepEqual(withDir.dir, { src: 'zh', tgt: 'en' });
  const withoutDir = picked.find((l) => l.t0 === 6);
  assert.equal(withoutDir.dir, undefined);
});

// --- overlay cue -> force-translate line payload (src/content.js mappers) ---

test('an overlay EN->ZH cue is not untranslated under a zh->en session', () => {
  // The shape the injected overlay keeps in its `cues` map.
  const cue = { t0: 1, t1: 3, rawSrc: 'Hello, how are you?', rawTgt: '你好，你怎么样？', dir: { src: 'en', tgt: 'zh' } };
  assert.equal(needsTranslation(cue, 'zh', 'en'), false);
  // …and would be wrongly flagged if the cue had lost its dir on the way in.
  assert.equal(needsTranslation({ ...cue, dir: undefined }, 'zh', 'en'), true);
});

test('cueToLine carries dir onto the mapped payload', () => {
  const line = cueToLine({ t0: 1, t1: 3, rawSrc: 'Hello', rawTgt: '你好', dir: { src: 'en', tgt: 'zh' } });
  assert.deepEqual(line.dir, { src: 'en', tgt: 'zh' });
  assert.equal(line.src, 'Hello');
  assert.equal(line.rawSrc, 'Hello');
  assert.equal(line.tgt, '你好');
  assert.equal(line.rawTgt, '你好');
  assert.equal(line.translation, '你好');
  assert.equal(line.t1, 3);
});

test('cueToLine omits dir for one-way cues and defaults t1', () => {
  const line = cueToLine({ t0: 4, rawSrc: 'Hello', rawTgt: 'Hola' });
  assert.equal('dir' in line, false);
  assert.equal(line.t1, 6);
});

test('a mapped two-way payload survives the round trip through pickUntranslatedLines', () => {
  const cues = [
    { t0: 0, t1: 2, rawSrc: 'Hello', rawTgt: '你好', dir: { src: 'en', tgt: 'zh' } },
    { t0: 3, t1: 5, rawSrc: '你好吗', rawTgt: '你好吗', dir: { src: 'zh', tgt: 'en' } },
  ].map(cueToLine);
  const picked = pickUntranslatedLines([cues], 'zh', 'en');
  assert.equal(picked.length, 1);
  assert.equal(picked[0].t0, 3);
  assert.deepEqual(picked[0].dir, { src: 'zh', tgt: 'en' });
});
