/**
 * PMM-024 on the real page: minutes.html served as the engine serves it (/app/minutes.html on
 * 127.0.0.1) lists the meeting the island saved, tags the demo meetings Sample, and shows the
 * "Synced with island" pill. The engine is stubbed with request interception: /app/* is
 * answered from the lab server's /src/*, /notes from an in-memory list. The real engine is never touched.
 *   node --test test/register-sync-page.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8883;
const LAB = `http://127.0.0.1:${PORT}`;
const ENGINE = 'http://127.0.0.1:17865'; // never contacted: every request to it is answered by the stub
let server;
let browser;
let page;
const pageErrors = [];
const posts = [];

// Shape of poni_core::meeting_doc after the engine normaliser (see test/register-sync.test.mjs).
const islandDoc = {
  id: 'MOM-WIN-1731234567', title: 'Weekly site coordination', date: '2026-11-10', source: 'island', status: 'ready',
  summary: 'Crane slot moved.', decisions: ['Move the crane slot to Thursday'], actions: [], schemaVersion: 2,
  meeting: { seriesId: '', seq: null, projectType: 'general', locale: 'en', tz: '', start: '2026-11-10T09:05', end: null, chair: null, attendees: [], agenda: { total: 0, covered: 0 }, issuedAt: null, generatedAt: '', engine: { asr: '', mt: null, segments: 1, durationSec: 4 } },
  items: [{ ref: 'D-1', type: 'decision', topic: '', text: 'Move the crane slot to Thursday', owner: null, org: null, due: null, status: 'open', priority: null, likelihood: null, review: 'ai', confidence: 0.6, needsReview: true, tc: null, speaker: null, carriedFrom: null, links: [], metric: null }],
  transcript: [{ t0: 0, t1: 4, source: 'Move the crane slot to Thursday', translation: '' }],
};

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`lab server did not start at ${url}`);
}

before(async () => {
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${LAB}/src/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    // Unbundled, minutes.js also imports ../docs/... which the engine serves from the same origin.
    if (u.origin === ENGINE && (u.pathname.startsWith('/app/') || u.pathname.startsWith('/docs/'))) {
      const r = await fetch(u.pathname.startsWith('/app/') ? `${LAB}/src/${u.pathname.slice(5)}` : `${LAB}${u.pathname}`);
      return req.respond({ status: r.status, contentType: r.headers.get('content-type') || 'text/plain', body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.origin === ENGINE && u.pathname === '/notes') {
      if (req.method() === 'POST') { posts.push(JSON.parse(req.postData()).note.id); return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }); }
      return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ notes: [islandDoc] }) });
    }
    if (u.origin === ENGINE) return req.respond({ status: 404, body: '{}' });
    return req.continue();
  });
  // Browser storage is per origin: seed the engine origin with the CPOC demo meetings an earlier click left behind.
  await page.goto(`${ENGINE}/app/minutes.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('minutesRegister'));
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('the register lists the island meeting, tags old demo meetings Sample, and shows the sync pill', async () => {
  // Make the stale demo meetings the pre-fix page would have shown.
  await page.evaluate(async () => {
    const m = await import('/app/lib/notes-store.js');
    const f = await import('/app/lib/notes-fixture.js');
    await f.seedSampleData().catch(() => {});
    return m.listMeetings().then((l) => l.length);
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => /Synced with island/.test(document.getElementById('sync-text')?.textContent || ''), { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const sel = document.getElementById('m-switch');
    return {
      pill: document.getElementById('sync-text').textContent,
      pillShown: !document.getElementById('sync-pill').hidden,
      options: [...sel.options].map((o) => o.textContent),
      groups: [...sel.querySelectorAll('optgroup')].map((g) => g.label),
      title: document.getElementById('m-title').textContent,
      source: document.getElementById('m-source').textContent,
      sampleBadgeHidden: document.getElementById('sample-badge').classList.contains('hidden'),
    };
  });
  assert.equal(r.pillShown, true);
  assert.match(r.pill, /Synced with island · just now/);
  assert.ok(r.options.some((o) => o.includes('Weekly site coordination') && !o.includes('Sample')), r.options.join(' | '));
  assert.equal(r.options.filter((o) => o.includes('Sample')).length, 2, 'both CPOC demo meetings are tagged Sample');
  assert.deepEqual(r.groups, ['From the island', 'Demo']);
  assert.equal(r.title, 'Weekly site coordination', 'the island meeting is the newest, so it opens first');
  assert.equal(r.source, 'Island');
  assert.equal(r.sampleBadgeHidden, true);
  assert.deepEqual(posts.filter((id) => id.startsWith('MOM-CPOC7')), [], 'demo meetings are never pushed to the engine');
  assert.deepEqual(pageErrors, []);
});

test('picking a demo meeting shows the Sample badge; Remove demo meetings removes them and keeps the island one', async () => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    const sel = document.getElementById('m-switch');
    sel.value = [...sel.options].find((o) => o.textContent.includes('Sample')).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await w(200);
    const badge = !document.getElementById('sample-badge').classList.contains('hidden');
    window.confirm = () => true;
    document.getElementById('btn-remove-demo').click();
    await w(400);
    return { badge, options: [...document.getElementById('m-switch').options].map((o) => o.textContent) };
  });
  assert.equal(r.badge, true);
  assert.equal(r.options.length, 1);
  assert.match(r.options[0], /Weekly site coordination/);
});
