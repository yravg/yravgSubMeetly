/**
 * Heuristic per-utterance language picker for two-way interpreter mode.
 *   node --test test/lang-detect.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLanguage, STOP_WORDS, tokenize } from '../src/lib/lang-detect.js';

test('script: Han vs Latin', () => {
  assert.equal(detectLanguage('今天的进度报告已经完成了', ['zh', 'en']), 'zh');
  assert.equal(detectLanguage('The progress report is finished', ['zh', 'en']), 'en');
});

test('script: Hiragana/Katakana wins over Han for ja vs zh', () => {
  assert.equal(detectLanguage('こんにちは、会議を始めましょう', ['zh', 'ja']), 'ja');
  assert.equal(detectLanguage('カタカナのテスト', ['zh', 'ja']), 'ja');
  // no kana at all → Han means Chinese
  assert.equal(detectLanguage('你好世界', ['zh', 'ja']), 'zh');
});

test('script: Hangul, Thai, Arabic, Devanagari', () => {
  assert.equal(detectLanguage('안녕하세요 여러분', ['ko', 'en']), 'ko');
  assert.equal(detectLanguage('สวัสดีครับ', ['th', 'en']), 'th');
  assert.equal(detectLanguage('مرحبا بالجميع', ['ar', 'en']), 'ar');
  assert.equal(detectLanguage('नमस्ते दोस्तों', ['hi', 'en']), 'hi');
});

test('script: Cyrillic splits ru vs uk on ї/є/ґ/і', () => {
  assert.equal(detectLanguage('Добрый день, начнём совещание', ['ru', 'uk']), 'ru');
  assert.equal(detectLanguage('Доброго дня, які є питання?', ['ru', 'uk']), 'uk');
  // only one Cyrillic candidate → that one, whichever letters appear
  assert.equal(detectLanguage('Привет', ['ru', 'en']), 'ru');
  assert.equal(detectLanguage('Привіт усім', ['uk', 'en']), 'uk');
});

test('Latin: stop words discriminate en vs id', () => {
  assert.equal(
    detectLanguage('This is the report that we have for you about the schedule', ['en', 'id']),
    'en',
  );
  assert.equal(
    detectLanguage('Ini adalah laporan yang kami punya untuk kamu tentang jadwal', ['en', 'id']),
    'id',
  );
});

test('Latin: stop words discriminate en vs de', () => {
  assert.equal(detectLanguage('The meeting will start in ten minutes', ['en', 'de']), 'en');
  assert.equal(
    detectLanguage('Die Besprechung wird in zehn Minuten beginnen und das ist wichtig', ['en', 'de']),
    'de',
  );
});

test('Latin: stop words discriminate fr vs es', () => {
  assert.equal(
    detectLanguage("Nous pensons que c'est une bonne idée pour la réunion", ['fr', 'es']),
    'fr',
  );
  assert.equal(
    detectLanguage('Creemos que es una buena idea para la reunión, pero hay mucho trabajo', [
      'fr',
      'es',
    ]),
    'es',
  );
});

test('ties and no evidence fall back to candidates[0]', () => {
  // "que" is a stop word in both lists → tie → first candidate
  assert.equal(detectLanguage('que', ['es', 'fr']), 'es');
  assert.equal(detectLanguage('que', ['fr', 'es']), 'fr');
  // nothing recognisable at all
  assert.equal(detectLanguage('zzz qqq xyzzy', ['de', 'en']), 'de');
  assert.equal(detectLanguage('12345 !!!', ['en', 'de']), 'en');
});

test('empty / missing text returns candidates[0]', () => {
  assert.equal(detectLanguage('', ['ja', 'en']), 'ja');
  assert.equal(detectLanguage('   ', ['en', 'ja']), 'en');
  assert.equal(detectLanguage(null, ['en', 'zh']), 'en');
  assert.equal(detectLanguage(undefined, ['zh', 'en']), 'zh');
});

test('degenerate candidate lists', () => {
  assert.equal(detectLanguage('anything', []), '');
  assert.equal(detectLanguage('你好', ['en']), 'en');
});

test('stop-word lists are exported, lowercase and at least 25 words each', () => {
  const langs = ['en', 'id', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'vi', 'pt', 'tr'];
  for (const l of langs) {
    const words = STOP_WORDS[l];
    assert.ok(Array.isArray(words), `${l} missing`);
    assert.ok(words.length >= 25, `${l} has only ${words.length} words`);
    assert.equal(new Set(words).size, words.length, `${l} has duplicates`);
    for (const w of words) assert.equal(w, w.toLowerCase(), `${l}: "${w}" is not lowercase`);
  }
  // diacritics are kept, not stripped
  assert.ok(STOP_WORDS.fr.includes('très'));
  assert.ok(STOP_WORDS.pl.includes('się'));
});

test('tokenize keeps letters and marks, drops punctuation', () => {
  assert.deepEqual(tokenize('Hello, world! Ça va?'), ['hello', 'world', 'ça', 'va']);
});
