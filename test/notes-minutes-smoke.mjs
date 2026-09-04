// Smoke test for src/minutes.js — the Minutes Register full-tab workspace.
//
// Boots the real controller against a real (jsdom) DOM, no browser required:
// loads sample data through the same seedSampleData() path the empty-state
// button uses, then asserts the register actually renders — catches the
// class of bug static checks (node --check, grep-based id audits) cannot:
// wrong DOM ids, elements the controller expects but the markup lacks, event
// wiring that throws.
//
// Optional dev tooling: skips cleanly if jsdom isn't installed
// (`npm install --no-save jsdom`) rather than failing the suite for anyone
// who hasn't pulled it in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, '..', 'src');

async function withMinutesDom() {
  const { JSDOM } = await import('jsdom');
  const html = fs.readFileSync(path.join(srcDir, 'minutes.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/minutes.html', pretendToBeVisual: true });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.HTMLElement = window.HTMLElement;
  global.URL = window.URL;
  global.Blob = window.Blob || class Blob { constructor(parts) { this.parts = parts; } };
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock';
  if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
  global.confirm = () => true;
  global.prompt = () => null;

  await import(path.join(srcDir, 'minutes.js'));

  // boot() is async and fire-and-forget from module top level — wait for it.
  const deadline = Date.now() + 4000;
  while (document.querySelector('#pane')?.innerHTML.trim() === '' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return { window, document: window.document };
}

test('minutes.html has every DOM id minutes.js queries', () => {
  const html = fs.readFileSync(path.join(srcDir, 'minutes.html'), 'utf8');
  const js = fs.readFileSync(path.join(srcDir, 'minutes.js'), 'utf8');
  // minutes.js also injects its own markup at runtime (the drawer body) —
  // an id is fine if it's declared either in the static shell or in a
  // template string minutes.js writes into the document before querying it.
  const idsAvailable = new Set([
    ...[...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]),
    ...[...js.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]),
    ...[...js.matchAll(/id=\\"([\w-]+)\\"/g)].map((m) => m[1]),
  ]);
  const idsQueried = new Set([...js.matchAll(/\$\(['"]#([\w-]+)['"]/g)].map((m) => m[1]));
  const missing = [...idsQueried].filter((id) => !idsAvailable.has(id));
  assert.deepEqual(missing, [], `minutes.js queries #id(s) missing from minutes.html/minutes.js markup: ${missing.join(', ')}`);
});

test('minutes workspace: boots empty, then loads sample data and renders the register', async (t) => {
  let ctx;
  try {
    ctx = await withMinutesDom();
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') return t.skip('jsdom not installed — npm install --no-save jsdom to run this check');
    throw e;
  }
  const { document } = ctx;
  assert.equal(document.querySelector('#empty-state').hidden, false, 'empty state shown with no stored meetings');
  assert.equal(document.querySelector('#workspace').hidden, true);

  document.querySelector('#btn-load-sample').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));

  const deadline = Date.now() + 4000;
  while (document.querySelector('#workspace').hidden && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.equal(document.querySelector('#workspace').hidden, false, 'workspace visible after sample data loads');
  const rows = document.querySelectorAll('#pane tbody tr');
  assert.ok(rows.length >= 8, `register table has rows (got ${rows.length})`);
  assert.match(document.querySelector('#m-title').textContent, /CPOC Phase 7/);

  // Detail drawer opens on row click and shows provenance for a sourced item.
  const withSource = [...rows].find((r) => r.querySelector('.src')?.textContent.trim());
  assert.ok(withSource, 'at least one row has a source cell');
  withSource.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(document.querySelector('#drawer').hidden, false, 'drawer opens on row click');

  // Search narrows the register.
  const q = document.querySelector('#q');
  q.value = 'bending and coating';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  const filteredRows = document.querySelectorAll('#pane tbody tr');
  assert.equal(filteredRows.length, 1, 'search narrows to the Ben-and-Coding provenance item');

  // The low-confidence item gets the correction banner from the Provenance
  // artboard, and the register row is flagged.
  q.value = 'bending and coating';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  const flagged = document.querySelector('#pane tbody tr');
  assert.ok(flagged.querySelector('.pill-warn'), 'low-ASR row carries the "Low ASR confidence" pill');
  assert.ok(flagged.querySelector('.flagword'), 'the mis-heard phrase is underlined in the row');
  flagged.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.ok(document.querySelector('#d-body .lowconf'), 'drawer shows the correction banner');
  assert.ok(document.querySelector('#d-apply'), 'banner offers "Apply correction"');
  assert.ok(document.querySelector('#d-body .wave'), 'drawer shows the cited-span waveform');
  const spoken = document.querySelector('#d-body .qt.orig');
  assert.equal(spoken.querySelector('mark')?.textContent, '弯管和涂敷',
    'the mis-heard phrase is marked in the source-language quote too, not only the translation');
  document.querySelector('#d-apply').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(document.querySelector('#d-body .lowconf'), null, 'banner is gone once the correction is applied');
  assert.match(document.querySelector('#f-text').value, /bending and coating/);

  // Metric item opens the Progress-artboard detail: a WIDE drawer with the
  // three numbers, the curve, the linked items and a real title.
  q.value = 'Cumulative';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  document.querySelector('#pane tbody tr').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  const drawer = document.querySelector('#drawer');
  assert.ok(drawer.classList.contains('wide'), 'the metric drawer widens to the Progress surface');
  assert.equal(document.querySelectorAll('#d-body .mcards .mc').length, 3, 'actual / baseline / variance');
  assert.ok(document.querySelector('#d-body .chart svg polyline'), 'metric drawer draws the series curve');
  assert.match(drawer.querySelector('h1')?.textContent || '', /Cumulative actual progress/, 'the metric has a title, not a textarea');
  const linkBlock = [...document.querySelectorAll('#d-body .pcard')].find((c) => c.querySelector('.linkrow'));
  assert.ok(linkBlock, 'the Linked items panel renders beside the chart');
  assert.ok(linkBlock.querySelectorAll('.linkrow').length >= 2, 'the figure cites at least two register items');
  assert.ok(document.querySelector('#d-body .mprov .mnote'), 'a sourced metric with a baseline explains why it is a measure');

  // …but a bare count with no cited sentence is told no story about itself.
  q.value = 'HSE incidents';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  document.querySelector('#pane tbody tr').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.ok(document.querySelector('#d-body .mprov'), 'it still gets the Progress surface');
  assert.equal(document.querySelector('#d-body .mprov .mnote'), null,
    'the "three numbers from one sentence" note is not printed on an unsourced, baseline-less count');

  // A non-metric item goes back to the narrow Provenance drawer.
  q.value = 'bending and coating';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  document.querySelector('#pane tbody tr').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.equal(drawer.classList.contains('wide'), false, 'only metrics get the wide surface');
  assert.ok(document.querySelector('#f-likelihood'), 'a risk is edited as severity × likelihood');
  q.value = '';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

  // Grouping inserts full-width group headers and keeps the rows.
  const group = document.querySelector('#group-by');
  group.value = 'topic';
  group.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  const gheads = document.querySelectorAll('#pane tbody tr.ghead');
  assert.ok(gheads.length >= 2, `grouping by topic emits group headers (got ${gheads.length})`);
  assert.equal(gheads[0].querySelector('td').getAttribute('colspan'), '8', 'the header spans the table');
  assert.ok(document.querySelectorAll('#pane tbody tr[data-ref]').length >= 8, 'no row is lost to grouping');
  group.value = 'none';
  group.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  assert.equal(document.querySelectorAll('#pane tbody tr.ghead').length, 0);

  // Series tab renders the standing register + right rail without throwing.
  document.querySelector('#tabs button[data-view="series"]').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.match(document.querySelector('#pane').innerHTML, /mini/);
  assert.ok(document.querySelector('#pane .mstrip .mcard.cur'), 'meeting strip marks the active meeting');
  assert.ok(document.querySelector('#pane .flow .bars'), 'opened/closed chart renders');
  assert.ok(document.querySelector('#btn-export-standing'), 'standing register can be exported');

  // Minutes tab renders the issued-document (paper) layout.
  document.querySelector('#tabs button[data-view="doc"]').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  const paper = document.querySelector('#pane .paper');
  assert.ok(paper, 'Minutes view is the A4 paper document');
  assert.match(paper.textContent, /MINUTES OF MEETING/);
  assert.match(paper.textContent, /‡/, 'AI-drafted items are marked ‡ in the issued document');
  assert.match(paper.textContent, /↩/, 'carried items are marked ↩');

  // The summary is prose the minute-taker owns while the MoM is still a draft.
  const summaryBox = paper.querySelector('[contenteditable]');
  assert.ok(summaryBox, 'an unissued MoM offers an editable summary');
  assert.equal(summaryBox.id, 'doc-summary');
  assert.match(summaryBox.textContent, /dropped-object incident/, 'it shows the authored summary, not the statistics sentence');
  assert.ok(paper.querySelector('#btn-save-summary'), 'and a way to save it');
  assert.equal(paper.querySelector('.genfallback'), null, 'no generated fallback once a summary is authored');

  // A meeting with no authored summary must NOT pre-fill the box with the
  // machine's sentence — one Save would sign it as the minute-taker's prose.
  const switcher = document.querySelector('#m-switch');
  switcher.value = [...switcher.options].map((o) => o.value).find((v) => /W35/.test(v));
  switcher.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  const blankBox = document.querySelector('#pane .paper [contenteditable]');
  assert.equal(blankBox.textContent, '', 'the editable summary starts empty when nobody has written one');
  assert.match(blankBox.getAttribute('data-placeholder') || '', /own words/, 'and says what to type');
  assert.match(document.querySelector('#pane .paper .genfallback').textContent, /decision\(s\)/,
    'the generated sentence still carries the document, read-only');
  switcher.value = [...switcher.options].map((o) => o.value).find((v) => /W36/.test(v));
  switcher.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  const paper36 = document.querySelector('#pane .paper');

  // Risks read as a matrix, and the KPI band carries the man-hours measure.
  assert.match(paper36.textContent, /High × Possible/, 'risks are severity × likelihood in the issued document');
  assert.match(paper36.querySelector('.kpi').textContent, /35,000/, 'man-hours gets thousands separators');
  assert.match(paper36.querySelector('.meta').textContent, /2026-09-02, 10:00–12:00 GMT\+8/, 'the meeting states when it ran');
});

test('notes-panel.js: compact ticker mounts and reflects the register', async (t) => {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND') return t.skip('jsdom not installed — npm install --no-save jsdom to run this check');
    throw e;
  }
  const dom = new JSDOM('<div id="notes-mount"></div>', { url: 'http://localhost/sidepanel.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.HTMLElement = dom.window.HTMLElement;

  // Ticker starts from an empty register: seed it directly through the store
  // (independent of minutes.js) so this test doesn't depend on load order.
  const { seedSampleData } = await import(path.join(srcDir, 'lib', 'notes-fixture.js') + '?panel-test');
  await seedSampleData();

  const { mountNotesPanel } = await import(path.join(srcDir, 'notes-panel.js') + '?panel-test');
  const root = document.getElementById('notes-mount');
  await mountNotesPanel(root);

  assert.match(root.innerHTML, /CPOC Phase 7/, 'ticker shows the active meeting title');
  const openBtn = root.querySelector('#btn-open-register');
  assert.ok(openBtn, 'has an "open register" action');
  assert.doesNotThrow(() => openBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true })));
});
