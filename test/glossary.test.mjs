/**
 * Glossary — pure core (add-in `glossary`). Hand-computed fixtures.
 *   node --test test/glossary.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, toCsv, applyGlossary, applyToLine, applyToMeeting, markedHtml, GLOSSARY_MAX,
} from '../src/lib/glossary.js';

const G = [
  { term: 'Kubernetes', heard: ['cooper netties', 'kubernetties'], translation: '' },
  { term: 'PTTEP', heard: ['p t t e p'], translation: '' },
  { term: 'wellhead', heard: [], translation: 'kepala sumur' },
];

test('heard-as variants become the term; word boundaries respected; marks say what changed', () => {
  const r = applyGlossary('We run cooper netties and Cooper Netties daily, not supercooper nettiesx', G, 'source');
  assert.equal(r.text, 'We run Kubernetes and Kubernetes daily, not supercooper nettiesx');
  assert.deepEqual(r.marks.map((m) => [m.from, m.to, m.at]), [['cooper netties', 'Kubernetes', 7], ['Cooper Netties', 'Kubernetes', 22]]);
});

test('case-aware: the term itself is fixed only when its case is wrong, exact matches are untouched and unmarked', () => {
  assert.deepEqual(applyGlossary('pttep and PTTEP', G, 'source').marks.map((m) => m.from), ['pttep']);
  assert.equal(applyGlossary('pttep and PTTEP', G, 'source').text, 'PTTEP and PTTEP');
  const same = applyGlossary('PTTEP signed', G, 'source');
  assert.equal(same.text, 'PTTEP signed');
  assert.equal(same.marks.length, 0);
});

test('translation line: a fixed translation replaces the term and its variants', () => {
  const r = applyGlossary('Pasang wellhead baru, lalu Wellhead lama', G, 'translation');
  assert.equal(r.text, 'Pasang kepala sumur baru, lalu kepala sumur lama');
  assert.equal(r.marks.length, 2);
  // source line is NOT touched by a translation-only entry other than case-fixing
  assert.equal(applyGlossary('install the wellhead', G, 'source').text, 'install the wellhead');
});

test('longest variant wins and replacements are never re-scanned', () => {
  const e = [{ term: 'AB', heard: ['a b'], translation: '' }, { term: 'A B C', heard: ['a b c'], translation: '' }];
  assert.equal(applyGlossary('say a b c then a b', e, 'source').text, 'say A B C then AB');
});

test('regex characters in a term are literal; CJK terms match without spaces around them', () => {
  assert.equal(applyGlossary('use c++ now', [{ term: 'C++', heard: ['see plus plus', 'c++'], translation: '' }], 'source').text, 'use C++ now');
  assert.equal(applyGlossary('我们用库伯尼特斯部署', [{ term: 'Kubernetes', heard: ['库伯尼特斯'], translation: '' }], 'source').text, '我们用Kubernetes部署');
});

test('applyToLine fixes src and tgt separately and keeps untouched lines identical', () => {
  const l = applyToLine({ src: 'cooper netties up', tgt: 'wellhead ok' }, G);
  assert.equal(l.src, 'Kubernetes up');
  assert.equal(l.tgt, 'kepala sumur ok');
  assert.equal(l.changes, 2);
  assert.equal(applyToLine({ src: 'nothing', tgt: 'nothing' }, G).changes, 0);
});

test('applyToMeeting rewrites item text and summary in every language, logs one revision per item', () => {
  const m = {
    summary: { en: 'We moved to cooper netties.' },
    items: [
      { ref: 'W1-001', type: 'action', text: { en: 'Migrate to cooper netties', id: 'Pindah ke cooper netties' }, history: [] },
      { ref: 'W1-002', type: 'info', text: { en: 'No change here' }, history: [] },
    ],
  };
  const r = applyToMeeting(m, G, { now: new Date('2026-09-02T00:00:00Z') });
  assert.equal(r.changes, 3);
  assert.equal(r.meeting.items[0].text.en, 'Migrate to Kubernetes');
  assert.equal(r.meeting.items[0].text.id, 'Pindah ke Kubernetes');
  assert.equal(r.meeting.summary.en, 'We moved to Kubernetes.');
  assert.deepEqual(r.meeting.items[0].history.map((h) => [h.by, h.field]), [['addin:glossary', 'text']]);
  assert.equal(r.meeting.items[1].history.length, 0);
  assert.equal(m.items[0].text.en, 'Migrate to cooper netties', 'input is not mutated');
});

test('markedHtml escapes text and wraps each change in <mark> with the heard form as title', () => {
  const r = applyGlossary('a <b> cooper netties', G, 'source');
  assert.equal(markedHtml(r.text, r.marks), 'a &lt;b&gt; <mark class="gl-mark" title="cooper netties">Kubernetes</mark>');
});

test('CSV: round-trips quotes, commas, newlines in quotes, "|" lists and a header row', () => {
  const entries = [{ term: 'Smith, J.', heard: ['smith j', 'smyth'], translation: 'Smith "J."' }, { term: 'OK', heard: [], translation: '' }];
  const csv = toCsv(entries);
  assert.equal(csv, 'term,heard_as,translation\r\n"Smith, J.",smith j|smyth,"Smith ""J."""\r\nOK,,\r\n');
  const back = parseCsv(csv);
  assert.deepEqual(back.entries, entries);
  assert.deepEqual(back.errors, []);
});

test('CSV import reports bad rows and keeps the good ones; limits are enforced', () => {
  const r = parseCsv('term,heard_as,translation\n,x,y\nGood,g,\n"unclosed,a,b');
  assert.deepEqual(r.entries.map((e) => e.term), ['Good']);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0].msg, /term/);
  assert.equal(r.errors[0].line, 2);
  const many = parseCsv(Array.from({ length: GLOSSARY_MAX + 5 }, (_, i) => `T${i},,`).join('\n'));
  assert.equal(many.entries.length, GLOSSARY_MAX);
  assert.match(many.errors.at(-1).msg, /limit/);
  assert.equal(parseCsv('x'.repeat(100)).errors[0].msg.includes('80'), true);
  assert.deepEqual(parseCsv('').entries, []);
});

test('CSV import merges duplicate terms case-insensitively (last one wins)', () => {
  const r = parseCsv('A,x,\na,y,\n');
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.entries[0].heard, ['y']);
});
