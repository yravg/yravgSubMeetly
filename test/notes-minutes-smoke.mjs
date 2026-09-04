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

test('notes-panel.js: the live-capture rail clocks a running task and flags the moment', async (t) => {
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
  localStorage.clear();

  const { seedSampleData } = await import(path.join(srcDir, 'lib', 'notes-fixture.js') + '?rail-test');
  await seedSampleData();

  const { mountNotesPanel } = await import(path.join(srcDir, 'notes-panel.js') + '?rail-test');
  const root = document.getElementById('notes-mount');
  // The rail owns a 1 s interval; a failing assertion must not leave it
  // running or `node --test` never exits.
  t.after(() => {
    if (root.__notesTick) clearInterval(root.__notesTick);
    if (root.__notesNoticeTimer) clearTimeout(root.__notesNoticeTimer);
    root.__notesTick = null;
    root.__notesNoticeTimer = null;
  });
  const capture = { running: true, startedAt: Date.now() - 65000, engine: 'MLX · GPU' };
  await mountNotesPanel(root, { getCapture: () => capture, onEndCapture: () => {} });

  const card = root.querySelector('#notes-recording-card');
  assert.ok(card, 'a running capture shows the recording card');
  assert.ok(card.querySelector('.notes-rec-dot.live'), 'the status dot is live while recording');
  assert.equal(card.querySelector('#notes-elapsed').textContent.trim(), '00:01:05', 'elapsed clock counts from startedAt');
  assert.match(card.querySelector('.notes-engine').textContent, /MLX/, 'the engine badge names what is transcribing');
  assert.equal(root.querySelectorAll('.notes-wave span').length, 20, 'the waveform strip is 20 bars');
  assert.equal(root.querySelectorAll('.notes-wave span.on').length, 5, 'the last five bars read as live');
  assert.equal(root.querySelector('#btn-end-draft').disabled, false, '"End & draft" is live while a task runs');
  assert.equal(root.querySelector('button[id="btn-pause"]'), null, 'no dead Pause control — the pipeline has none');

  const flag = root.querySelector('#btn-flag-moment');
  assert.ok(flag, 'the flag button is in the rail');
  assert.equal(flag.disabled, false, 'a running capture enables flagging');

  const { listMeetings } = await import(path.join(srcDir, 'lib', 'notes-store.js') + '?rail-test');
  const before = (await listMeetings())[0].items.length;
  flag.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const deadline = Date.now() + 2000;
  let after = before;
  while (after === before && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    after = (await listMeetings())[0].items.length;
  }
  assert.equal(after, before + 1, 'clicking the flag adds one register item');
  const item = (await listMeetings())[0].items.at(-1);
  assert.equal(item.topic, 'flag');
  assert.equal(item.review, 'edited');
  assert.match(item.src.tc, /^00:01:0\d$/, 'the flag carries the recording timecode');
  assert.equal(item.src.orig, '', 'and no invented transcript words');
  // "Latest" is ordered by position in the recording (src.t0), so a flag at
  // 00:01:05 of an hour-long meeting correctly stays below the later items…
  assert.doesNotMatch(root.querySelector('#notes-open-list')?.textContent || '', /Flagged at/,
    'a flag early in the recording does not jump the queue');

  // …and a flag dropped after everything else leads the list.
  capture.startedAt = Date.now() - 4200000; // 01:10:00 into the capture
  await mountNotesPanel(root, { getCapture: () => capture, onEndCapture: () => {} });
  root.querySelector('#btn-flag-moment').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const listDeadline = Date.now() + 2000;
  while (!/Flagged at/.test(root.querySelector('#notes-open-list')?.textContent || '') && Date.now() < listDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(root.querySelector('#notes-open-list')?.textContent || '', /Flagged at 01:1\d:\d\d/,
    'the freshly flagged item leads "Latest" once it is the newest timecode');

  // Idle: the card stays (grey), and the flag button is disabled with a reason.
  capture.running = false;
  await mountNotesPanel(root, { getCapture: () => capture });
  assert.equal(root.querySelector('.notes-rec-dot.live'), null, 'the dot goes grey when idle');
  assert.equal(root.querySelectorAll('.notes-wave span.on').length, 0);
  assert.equal(root.querySelector('#btn-flag-moment').disabled, true);
  assert.match(root.querySelector('#btn-flag-moment').getAttribute('title') || '', /capture task/);
  assert.equal(root.querySelector('#btn-end-draft').disabled, true);

  // Re-mounting (applyI18n does this on a language change) must not leak the
  // 1 s tick — one root, one interval.
  const first = root.__notesTick;
  await mountNotesPanel(root, { getCapture: () => capture });
  assert.notEqual(root.__notesTick, first, 'the old interval is replaced, not stacked');

  // An ISSUED MoM is frozen: the flag button says so instead of failing
  // silently when the shortcut lands on it.
  const { saveMeeting: save, listMeetings: list } = await import(path.join(srcDir, 'lib', 'notes-store.js') + '?rail-test');
  const A = await import(path.join(srcDir, 'lib', 'notes-actions.js') + '?rail-test');
  const live = (await list())[0];
  await save(A.issueMeeting(live, { force: true }));
  capture.running = true;
  await mountNotesPanel(root, { getCapture: () => capture, onEndCapture: () => {} });
  const frozen = root.querySelector('#btn-flag-moment');
  assert.equal(frozen.disabled, true, 'a running capture cannot flag an issued MoM');
  assert.match(frozen.getAttribute('title') || '', /issued/, 'and the tooltip says why');
  assert.equal(root.querySelector('#btn-end-draft').disabled, false, 'ending the capture is still allowed');

  // The refusal is spoken, not swallowed: the shortcut path calls the handler
  // directly (the button is disabled, so a click never fires).
  const itemsBefore = (await list())[0].items.length;
  const btn = root.querySelector('#btn-flag-moment');
  btn.disabled = false; // the shortcut path, as if the button had been reachable
  btn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const noticeDeadline = Date.now() + 2000;
  while (!/issued/.test(root.querySelector('#notes-status-pill')?.textContent || '') && Date.now() < noticeDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.match(root.querySelector('#notes-status-pill')?.textContent || '', /issued/,
    'the refusal shows up in the status row instead of only the console');
  assert.ok(root.querySelector('#notes-status-pill').classList.contains('error'));
  assert.equal((await list())[0].items.length, itemsBefore, 'and nothing was written to the frozen MoM');
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
