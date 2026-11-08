/**
 * Threadbear boards on the real page (dist/minutes.html, Puppeteer):
 * Inbox (T01), Projects / Librarian (T02), Meeting Highlights (T04).
 * Each board: open, act, undo, reload persists, plus the error and locked states.
 *   node --test test/threads-ui.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';
import { seriesSummary } from '../src/lib/notes-actions.js';

const PORT = 8890;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const people = [{ name: 'Mei', org: 'GZS' }, { name: 'Budi', org: 'GZS' }, { name: 'Citra', org: 'GZS' }];
const it = (ref, type, extra = {}) => ({
  ref, type, text: { en: `${type} ${ref} text` }, status: 'open', review: 'accepted', confidence: 0.95,
  src: { t0: 12, t1: 20, speaker: 'Mei' }, ...extra,
});

function fixture({ issuedB = false } = {}) {
  const a = createMeeting({
    id: 'T-A', seriesId: 'S1', seq: 1, title: 'Rapat K3 mingguan W01', date: day(-14), chair: 'Mei', attendees: people, projectType: 'general',
    items: [
      it('A-001', 'action', { owner: 'Mei', due: day(-3) }),
      it('A-002', 'action', { owner: 'Budi', due: day(3) }),
      it('A-003', 'action'),
      it('A-004', 'action', { owner: 'Citra', status: 'progress' }),
    ],
  });
  const b = createMeeting({
    id: 'T-B', seriesId: 'S2', seq: 1, title: 'Rapat K3 mingguan W02', date: day(-7), chair: 'Mei', attendees: people, projectType: 'general',
    issuedAt: issuedB ? new Date().toISOString() : null,
    items: [
      it('B-001', 'decision', { review: 'ai', confidence: 0.5, text: { en: 'Approve plan-v2.pdf, see https://client.example/portal' } }),
      it('B-002', 'question'),
      it('B-003', 'risk', { owner: 'Budi' }),
    ],
  });
  return [a, b];
}
const expectedOpen = (ms) => seriesSummary(ms, new Date()).open;

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server did not start at ${url}`);
}

async function seed(meetings) {
  await page.evaluate((env) => {
    for (const k of ['ysmInboxArchived', 'ysmLibrarianLooks', 'ysmLibrarianPaused', 'ysmMeetingsClosed']) localStorage.removeItem(k);
    localStorage.setItem('minutesRegister', JSON.stringify(env));
  }, wrapMeetingStore(meetings));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#pane');
}
const openView = async (view, board) => { await click(`#tabs [data-view="${view}"]`); await page.waitForSelector(board); };
const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const count = (sel) => page.$$eval(sel, (e) => e.length);
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('minutesRegister')).meetings);
const CARD = '#th-projects .th-card[data-mid="T-B"]';
const rowIn = (sec) => `#th-inbox [data-sec="${sec}"] .th-row`;
const act = async (sel, a) => { await page.evaluate((s, x) => document.querySelector(`${s} [data-th="${x}"]`).click(), sel, a); await wait(250); };

before(async () => {
  assert.ok(existsSync('dist/minutes.js'), 'dist/ is not built — run `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1400,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('T01 inbox: groups and count equal seriesSummary(...).open', async () => {
  const ms = fixture();
  await seed(ms);
  await openView('inbox', '#th-inbox');
  assert.equal(Number(await text('#th-open-count')), expectedOpen(ms));
  const sum = await page.$$eval('#th-inbox [data-sec]:not([data-sec="done"]):not([data-sec="archived"]) .th-row', (r) => r.length);
  assert.equal(sum, expectedOpen(ms));
  for (const sec of ['overdue', 'week', 'nodate', 'doing']) assert.ok(await count(rowIn(sec)) >= 1, sec);
  const row = await text(`${rowIn('overdue')}`);
  assert.match(row, /A-001/);
  assert.match(row, /Rapat K3 mingguan W01/);
  assert.match(row, /Mei/);
  assert.match(await text(rowIn('nodate')), /No owner/);
});

test('T01 inbox: Close writes status closed, Undo restores open, reload persists', async () => {
  await seed(fixture());
  await openView('inbox', '#th-inbox');
  const before = Number(await text('#th-open-count'));
  await act(`${rowIn('overdue')}:first-child`, 'close');
  assert.equal(Number(await text('#th-open-count')), before - 1);
  assert.equal((await stored()).find((m) => m.id === 'T-A').items.find((i) => i.ref === 'A-001').status, 'closed');
  assert.match(await text('#th-inbox [data-sec="done"]'), /A-001/);
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('inbox', '#th-inbox');
  assert.equal(Number(await text('#th-open-count')), before - 1);
  await act(`${rowIn('done')}:first-child`, 'reopen');
  assert.equal(Number(await text('#th-open-count')), before);
  // Undo of a close
  await act(`${rowIn('overdue')}:first-child`, 'close');
  await click('#th-inbox [data-th="undo"]'); await wait(300);
  assert.equal((await stored()).find((m) => m.id === 'T-A').items.find((i) => i.ref === 'A-001').status, 'open');
  assert.equal(Number(await text('#th-open-count')), before);
});

test('T01 inbox: Snooze tomorrow / next week goes through editItem; Undo restores the date', async () => {
  await seed(fixture());
  await openView('inbox', '#th-inbox');
  const first = `${rowIn('week')}:first-child`;
  await act(first, 'snoozemenu');
  await page.evaluate(() => document.querySelector('#th-inbox [data-sec="week"] [data-th="snooze"][data-k="tomorrow"]').click());
  await wait(300);
  const due = () => stored().then((ms) => ms.find((m) => m.id === 'T-A').items.find((i) => i.ref === 'A-002').due);
  assert.equal(await due(), day(1));
  await click('#th-inbox [data-th="undo"]'); await wait(300);
  assert.equal(await due(), day(3));
  await act(first, 'snoozemenu');
  await page.evaluate(() => document.querySelector('#th-inbox [data-th="snooze"][data-k="week"]').click());
  await wait(300);
  assert.equal(await due(), day(7));
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await due(), day(7));
});

test('T01 inbox: Archive all moves Finished away, Undo brings it back, reload persists', async () => {
  await seed(fixture());
  await openView('inbox', '#th-inbox');
  await act(`${rowIn('nodate')}:first-child`, 'close');
  await act(`${rowIn('overdue')}:first-child`, 'close');
  assert.equal(await count(rowIn('done')), 2);
  await click('#th-inbox [data-th="archiveall"]'); await wait(300);
  assert.equal(await count(rowIn('done')), 0);
  assert.match(await text('#th-inbox [data-sec="archived"]'), /Archived 2/);
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('inbox', '#th-inbox');
  assert.equal(await count(rowIn('done')), 0);
  assert.ok(await count('#th-inbox [data-sec="archived"]') === 1);
  // Undo path
  await seed(fixture());
  await openView('inbox', '#th-inbox');
  await act(`${rowIn('nodate')}:first-child`, 'close');
  await click('#th-inbox [data-th="archiveall"]'); await wait(300);
  await click('#th-inbox [data-th="undo"]'); await wait(300);
  assert.equal(await count(rowIn('done')), 1);
});

test('T01 inbox: row tap opens the register at that item; search filters rows', async () => {
  await seed(fixture());
  await openView('inbox', '#th-inbox');
  await page.evaluate(() => document.querySelector('#th-inbox [data-sec="week"] .th-row').click());
  await page.waitForSelector('#pane tbody tr[data-ref]');
  assert.equal(await page.$eval('#pane tbody tr[aria-selected="true"]', (r) => r.dataset.ref), 'A-002');
  await openView('inbox', '#th-inbox');
  await page.$eval('#q', (e) => { e.value = 'A-004'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(200);
  assert.equal(await count('#th-inbox .th-row'), 1);
  await page.$eval('#q', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
});

test('T01 inbox: inbox zero names the next meeting; works with the network off', async () => {
  await seed(fixture());
  await page.setOfflineMode(true);
  await openView('inbox', '#th-inbox');
  for (let i = 0; i < 12 && Number(await text('#th-open-count')) > 0; i += 1) {
    await page.evaluate(() => document.querySelector('#th-inbox [data-sec]:not([data-sec="done"]):not([data-sec="archived"]) [data-th="close"]')?.click());
    await wait(250);
  }
  assert.equal(Number(await text('#th-open-count')), 0);
  const z = await text('#th-inbox');
  assert.match(z, /Inbox zero/);
  assert.match(z, /Next meeting: Rapat K3 mingguan W02/);
  await page.setOfflineMode(false);
});

test('T01 inbox: error state shows Retry and clears; issued meeting rows are locked', async () => {
  await seed(fixture({ issuedB: true }));
  await openView('inbox', '#th-inbox');
  await page.evaluate(() => { globalThis.__ysmThreadsFail = true; });
  await click('#tabs [data-view="projects"]'); await click('#tabs [data-view="inbox"]'); await wait(200);
  assert.ok(await count('#th-inbox .th-banner.err') === 1);
  await click('#th-inbox [data-th="retry"]'); await wait(300);
  assert.ok(await count('#th-inbox .th-banner.err') === 0);
  const ms = fixture({ issuedB: true });
  assert.equal(Number(await text('#th-open-count')), expectedOpen(ms));
  // Carried rows of an issued meeting get a lock note, not buttons.
  const locked = await page.$$eval('#th-inbox .th-row', (rows) => rows.filter((r) => /Issued meeting/.test(r.textContent)).every((r) => !r.querySelector('[data-th="close"]')));
  assert.ok(locked);
});

test('T02 projects: suggestion card; Accept files the meeting; reload persists; look history readable', async () => {
  await seed(fixture());
  await openView('projects', '#th-projects');
  assert.equal(await count(CARD), 1);
  const card = await text(CARD);
  assert.match(card, /Rapat K3 mingguan W02/);
  assert.match(card, /same chair/);
  assert.match(card, /never overwritten without Accept/);
  assert.equal((await stored()).find((m) => m.id === 'T-B').seriesId, 'S2', 'nothing written before Accept');
  await act(CARD, 'accept');
  assert.equal((await stored()).find((m) => m.id === 'T-B').seriesId, 'S1');
  assert.equal(await count(CARD), 0);
  assert.match(await text('#th-projects [data-sec="confirm"]'), /Rapat K3 mingguan W01|Nothing to confirm/);
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('projects', '#th-projects');
  assert.match(await text('#th-looks'), /accepted/);
  assert.equal(await count(CARD), 0);
});

test('T02 projects: Dismiss is not shown again for that meeting; Pause hides suggestions', async () => {
  await seed(fixture());
  await openView('projects', '#th-projects');
  await act(CARD, 'dismiss');
  assert.equal((await stored()).find((m) => m.id === 'T-B').seriesId, 'S2');
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('projects', '#th-projects');
  assert.equal(await count(CARD), 0);
  assert.match(await text('#th-projects [data-sec="dismissed"]'), /Rapat K3 mingguan W02/);
  await seed(fixture());
  await openView('projects', '#th-projects');
  await act('#th-projects .th-head', 'pause');
  assert.equal(await count('#th-projects .th-card'), 0);
  assert.match(await text('#th-projects'), /Librarian is paused/);
  await act('#th-projects .th-head', 'pause');
  assert.equal(await count(CARD), 1);
});

test('T02 projects: Change needs a title, applies only what was chosen; Unfiled bucket lists loose meetings', async () => {
  await seed(fixture());
  await openView('projects', '#th-projects');
  assert.ok(await count('#th-projects [data-sec="unfiled"] .th-row') >= 1);
  await act(CARD, 'change');
  await page.$eval('#th-projects [data-th-f="title"]', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.$eval('#th-projects [data-th="applychange"]', (b) => b.disabled), true);
  await page.$eval('#th-projects [data-th-f="title"]', (e) => { e.value = 'Rapat K3 (diubah)'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.select('#th-projects [data-th-f="projectType"]', 'training');
  await act(CARD, 'applychange');
  const b = (await stored()).find((m) => m.id === 'T-B');
  assert.equal(b.title, 'Rapat K3 (diubah)');
  assert.equal(b.projectType, 'training');
  assert.match(await text('#th-looks'), /changed/);
});

test('T04 highlights: counts, Needs you tick, source line, files and links; reload persists', async () => {
  await seed(fixture());
  await openView('highlights', '#th-highlights');
  const n = (ty) => text(`#th-highlights [data-count="${ty}"]`);
  assert.deepEqual([await n('decision'), await n('action'), await n('question'), await n('risk')], ['1', '0', '1', '1']);
  assert.equal(await count('#th-highlights [data-sec="needs"] .th-row'), 1);
  assert.match(await text('#th-highlights [data-sec="needs"]'), /Low confidence/);
  assert.match(await text('#th-highlights [data-sec="source"]'), /3 of 3 items/);
  assert.match(await text('#th-highlights [data-sec="files"]'), /plan-v2\.pdf/);
  assert.match(await text('#th-highlights [data-sec="links"]'), /client\.example\/portal/);
  await act('#th-highlights [data-sec="needs"] .th-row', 'tick');
  assert.equal(await count('#th-highlights [data-sec="needs"] .th-row'), 0);
  assert.equal((await stored()).find((m) => m.id === 'T-B').items.find((i) => i.ref === 'B-001').review, 'accepted');
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('highlights', '#th-highlights');
  assert.equal(await count('#th-highlights [data-sec="needs"] .th-row'), 0);
  assert.ok((await text('#th-highlights [data-sec="changes"]')).length > 0);
});

test('T04 highlights: Issue MoM locks the meeting; Close without MoM is read only; Undo reopens it', async () => {
  await seed(fixture());
  await openView('highlights', '#th-highlights');
  await act('#th-highlights .th-head', 'issue');
  assert.equal((await stored()).find((m) => m.id === 'T-B').issuedAt, null, 'blocked by the unreviewed draft');
  await act('#th-highlights [data-sec="needs"] .th-row', 'tick');
  await act('#th-highlights .th-head', 'issue');
  assert.equal((await stored()).find((m) => m.id === 'T-B').issuedAt, null, 'accepted but still below the confidence line');
  await act('#th-highlights', 'issueforce');
  assert.ok((await stored()).find((m) => m.id === 'T-B').issuedAt);
  assert.match(await text('#th-highlights .th-banner.lock'), /read only/);
  assert.equal(await count('#th-highlights [data-th="issue"]'), 0);

  await seed(fixture());
  await openView('highlights', '#th-highlights');
  await act('#th-highlights .th-head', 'closemeeting');
  assert.match(await text('#th-highlights .th-banner.lock'), /Closed without MoM/);
  await page.reload({ waitUntil: 'networkidle0' });
  await openView('highlights', '#th-highlights');
  assert.equal(await count('#th-highlights .th-banner.lock'), 1);
  await seed(fixture());
  await openView('highlights', '#th-highlights');
  await act('#th-highlights .th-head', 'closemeeting');
  await click('#th-highlights [data-th="undo"]'); await wait(300);
  assert.equal(await count('#th-highlights .th-banner.lock'), 0);
});

test('no page errors', () => { assert.deepEqual(pageErrors, []); });
