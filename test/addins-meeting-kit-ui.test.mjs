/**
 * Recap email, Glossary and Due dates to calendar on app.html (PRD ADD-001): trust gate -> Notes strip,
 * each in its states (normal, empty, needs input, error, locked).
 *   node --test test/addins-meeting-kit-ui.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const PORT = 8886;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

const MEETING = {
  id: 'MOM-K3-W2', seriesId: 'komite-k3', seq: 2, title: 'Komite K3', date: '2026-09-02', locale: 'en', projectType: 'hse',
  attendees: [{ name: 'Lai', org: 'HSE', email: 'lai@example.com' }, { name: 'Dewi', org: 'QA' }],
  items: [
    { ref: 'W2-001', type: 'decision', text: { en: 'Secure cranes' }, status: 'closed' },
    { ref: 'W2-002', type: 'action', text: { en: 'Issue checklist' }, status: 'open', owner: 'Lai', due: '2026-09-10' },
    { ref: 'W2-003', type: 'action', text: { en: 'Close audit' }, status: 'open', owner: 'Dewi' },
  ],
};
const seed = (over) => page.evaluate(async (m) => {
  const { saveMeeting } = await import('/src/lib/notes-store.js');
  await saveMeeting(m);
}, { ...MEETING, ...over });

async function boot(over = {}, { trust = true } = {}) {
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { localStorage.clear(); });
  await seed(over);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-mount .bottom-nav-item');
  await page.waitForFunction(() => document.getElementById('addins-mount')?.children.length > 0, { timeout: 10_000 });
  // Capture what the add-ins hand to the browser: window.open(url) and Blob downloads.
  await page.evaluate(() => {
    window.__opened = [];
    window.__blobs = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return create(b); };
    HTMLAnchorElement.prototype.click = function click() { window.__downloads = [...(window.__downloads || []), this.download]; };
  });
  if (trust) await trustAll();
}

async function trustAll() {
  await page.evaluate(() => {
    document.getElementById('btn-settings').click();
    document.querySelector('#settings-tabs button[data-stab="addins"]').click();
  });
  await page.waitForSelector('.ai-wrap');
  for (const name of ['Recap email', 'Glossary', 'Due dates to calendar']) {
    await page.evaluate((n) => [...document.querySelectorAll('.ai-row')].find((r) => r.textContent.includes(n)).click(), name);
    await page.waitForFunction((n) => document.querySelector('.ai-mh h4')?.textContent === n, {}, name);
    await page.evaluate(() => document.querySelector('[data-ai="trust"]')?.click());
    await page.waitForFunction((n) => document.querySelector('.ai-mh h4')?.textContent === n && document.querySelector('.ai-pill-enabled'), {}, name);
  }
  await page.evaluate(() => document.getElementById('btn-close-settings').click());
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav-item')].find((b) => /Notes/.test(b.textContent)).click());
  await page.waitForSelector('[data-addins-strip]', { timeout: 8000 });
}
// Trusting is locked on an issued meeting, so trust first, then issue and reload.
async function issueOpenMeeting() {
  await seed({ issuedAt: '2026-09-03T00:00:00Z' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.bottom-nav-item')].find((b) => /Notes/.test(b.textContent)).click());
  await page.waitForSelector('[data-addins-strip]', { timeout: 8000 });
}
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const text = (sel) => page.$eval(sel, (e) => e.textContent);

before(async () => {
  assert.ok(existsSync('dist/sidepanel.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/app.html`);
  browser = await puppeteer.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('untrusted: no chip and no glossary panel in the Notes strip', async () => {
  await boot({}, { trust: false });
  assert.equal(await page.$('[data-addins-strip]'), null);
  await page.close();
});

test('Recap email: card with recipients, mailto draft opens, nothing is sent', async () => {
  await boot();
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('[data-ai-result="recap"]');
  assert.match(await text('[data-ai-result="recap"]'), /To: 1 attendee with a known email/);
  assert.match(await text('[data-ai-result="recap"]'), /No email for: Dewi/);
  assert.match(await text('.ai-pre'), /Issue checklist — Lai, due 2026-09-10/);
  assert.match(await text('.ai-pre'), /Close audit — Dewi, no due date/);
  await click('[data-ai-act="recap-open"]');
  const opened = await page.evaluate(() => window.__opened);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /^mailto:lai@example\.com\?subject=Recap%3A%20Komite%20K3/);
  await click('[data-ai-act="dismiss"]');
  assert.equal(await page.$('[data-ai-result]'), null);
  await page.close();
});

test('Recap email: copy shows Copied, or says plainly that the browser blocked it', async () => {
  await boot();
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('[data-ai-result="recap"]');
  await click('[data-ai-act="recap-copy"]');
  await page.waitForFunction(() => /Copied/.test(document.querySelector('[data-ai-act="recap-copy"]').textContent) || document.querySelector('.ai-result [role="alert"]'));
  await page.close();
});

test('Recap email: no known email -> says so and still offers Copy; empty meeting -> says nothing to send; issued meeting still works', async () => {
  await boot({ attendees: [{ name: 'Dewi', org: 'QA' }] });
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('.ai-need');
  assert.match(await text('.ai-need'), /No attendee email is known/);
  assert.equal(await page.$eval('[data-ai-act="recap-copy"]', (b) => b.disabled), false);
  await page.close();

  await boot({ items: [] });
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('.ai-res-empty');
  assert.match(await text('.ai-res-empty'), /Nothing to send yet/);
  await page.close();

  await boot();
  await issueOpenMeeting();
  assert.equal(await page.$eval('[data-addin="recap-email:recap"]', (b) => b.disabled), false, 'reading is allowed after issue');
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('[data-ai-result="recap"]');
  await page.close();
});

test('Recap email: a body too long for mailto falls back to Copy with a note', async () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ ref: `W2-${i + 10}`, type: 'decision', text: { en: `Decision number ${i} with a fairly long sentence so the link grows` }, status: 'closed' }));
  await boot({ items });
  await click('[data-addin="recap-email:recap"]');
  await page.waitForSelector('[data-ai-result="recap"]');
  assert.match(await text('[data-ai-result="recap"]'), /Too long for a mail link/);
  assert.equal(await page.$eval('[data-ai-act="recap-open"]', (b) => b.disabled), true);
  assert.equal(await page.$eval('[data-ai-act="recap-copy"]', (b) => b.disabled), false);
  await page.close();
});

test('Due dates to calendar: one .ics download, parses, counts the skipped action', async () => {
  await boot();
  await click('[data-addin="due-to-calendar:ics"]');
  await page.waitForSelector('[data-ai-result="ics"]');
  assert.match(await text('[data-ai-result="ics"]'), /1 action saved to actions-komite-k3\.ics/);
  assert.match(await text('[data-ai-result="ics"]'), /1 open action has no due date and was left out/);
  const ics = await page.evaluate(async () => {
    const b = window.__blobs.at(-1);
    return { name: window.__downloads?.at(-1), text: await b.text() };
  });
  assert.equal(ics.name, 'actions-komite-k3.ics');
  assert.ok(ics.text.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.text.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics.text, /UID:MOM-K3-W2-W2-002@submeetly/);
  assert.match(ics.text, /DTSTART;VALUE=DATE:20260910/);
  await page.close();
});

test('Due dates to calendar: nothing dated -> no file, an explanation; issued meeting still exports', async () => {
  await boot({ items: [{ ref: 'A-1', type: 'action', text: { en: 'x' }, status: 'open' }] });
  await click('[data-addin="due-to-calendar:ics"]');
  await page.waitForSelector('.ai-res-empty');
  assert.match(await text('.ai-res-empty'), /No open action has a due date yet/);
  assert.equal(await page.evaluate(() => (window.__blobs || []).length), 0);
  await page.close();

  await boot();
  await issueOpenMeeting();
  assert.equal(await page.$eval('[data-addin="due-to-calendar:ics"]', (b) => b.disabled), false);
  await page.close();
});

test('Glossary: add, needs-input error, replace same term, remove, CSV import and export', async () => {
  await boot();
  await page.waitForSelector('[data-ai-panel="glossary"]');
  assert.match(await text('[data-ai-panel="glossary"]'), /No terms yet/);
  // needs input
  await click('[data-ai-act="gl-add"]');
  await page.waitForSelector('.ai-note-error');
  assert.match(await text('.ai-note-error'), /Type the term first/);
  // add
  await page.type('#gl-term', 'Kubernetes');
  await page.type('#gl-heard', 'cooper netties | kubernetties');
  await click('[data-ai-act="gl-add"]');
  await page.waitForFunction(() => document.querySelector('.gl-list li b')?.textContent === 'Kubernetes');
  assert.match(await text('.gl-list'), /cooper netties \| kubernetties/);
  assert.equal(await page.$('.ai-note-error'), null, 'the error clears once the add works');
  // same term again replaces, never duplicates
  await page.type('#gl-term', 'kubernetes');
  await page.type('#gl-trans', 'Kubernetes');
  await click('[data-ai-act="gl-add"]');
  await page.waitForFunction(() => document.querySelector('.gl-tr'));
  assert.equal(await page.$$eval('.gl-list li', (l) => l.length), 1);
  // CSV import (header + one bad row + one good row) and export
  const dir = mkdtempSync(join(tmpdir(), 'gl-'));
  const csv = join(dir, 'terms.csv');
  writeFileSync(csv, 'term,heard_as,translation\r\n,x,y\r\nPTTEP,p t t e p,\r\n');
  await (await page.$('#gl-file')).uploadFile(csv);
  await page.waitForFunction(() => /1 term imported/.test(document.querySelector('.ai-note')?.textContent || ''));
  assert.match(await text('.ai-note'), /1 row skipped\. First: line 2, term is empty/);
  assert.equal(await page.$$eval('.gl-list li', (l) => l.length), 2);
  await click('[data-ai-act="gl-export"]');
  const out = await page.evaluate(async () => (await window.__blobs.at(-1).text()));
  assert.match(out, /term,heard_as,translation\r\n/);
  assert.match(out, /PTTEP,p t t e p,/);
  // remove
  await click('[data-ai-act="gl-del"]');
  await page.waitForFunction(() => document.querySelectorAll('.gl-list li').length === 1);
  await page.close();
});

test('Glossary is kept per series and survives a reload', async () => {
  await boot();
  await page.waitForSelector('[data-ai-panel="glossary"]');
  await page.type('#gl-term', 'GMDR');
  await click('[data-ai-act="gl-add"]');
  await page.waitForFunction(() => document.querySelector('.gl-list li b')?.textContent === 'GMDR');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ysmGlossary')));
  assert.deepEqual(Object.keys(stored), ['komite-k3']);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.gl-list li b');
  assert.equal(await text('.gl-list li b'), 'GMDR');
  await page.close();
});

test('Add-in how-to text and icons show in Settings › Add-ins; no page errors', async () => {
  await boot({}, { trust: false });
  await page.evaluate(() => {
    document.getElementById('btn-settings').click();
    document.querySelector('#settings-tabs button[data-stab="addins"]').click();
  });
  await page.waitForSelector('.ai-wrap');
  for (const [name, re] of [['Recap email', /Open mail draft/], ['Glossary', /expand Glossary/], ['Due dates to calendar', /\.ics file/]]) {
    await page.evaluate((n) => [...document.querySelectorAll('.ai-row')].find((r) => r.textContent.includes(n)).click(), name);
    await page.waitForFunction((n) => document.querySelector('.ai-mh h4')?.textContent === n, {}, name);
    assert.match(await text('.ai-how'), re);
    assert.equal(await page.$eval('.ai-quote', (e) => /declared, not fired/.test(e.textContent)), false, 'glossary hooks do fire, so no "not fired" note');
  }
  assert.deepEqual(pageErrors, []);
  await page.close();
});
