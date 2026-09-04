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
  document.querySelector('#d-apply').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(document.querySelector('#d-body .lowconf'), null, 'banner is gone once the correction is applied');
  assert.match(document.querySelector('#f-text').value, /bending and coating/);

  // Metric item opens the Progress-artboard detail with the chart.
  q.value = 'Cumulative';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  document.querySelector('#pane tbody tr').dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  assert.ok(document.querySelector('#d-body .mcards'), 'metric drawer shows actual / baseline / variance');
  assert.ok(document.querySelector('#d-body .chart svg polyline'), 'metric drawer draws the series curve');
  q.value = '';
  q.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

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
