/**
 * Ask Tide di kerangka (T7: TIDE-007, 018..021; papan A03, A03b, A10) pada dist/app.html.
 * Helper /ask distub lewat intersepsi permintaan; tidak ada kunci awan di mesin ini.
 *   node --test test/ask-tide-ui.test.mjs
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createMeeting, wrapMeetingStore } from '../src/lib/notes-schema.js';

const PORT = 8913;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server; let browser; let page;
const pageErrors = [];
const asked = [];
let askMode = 'stream'; // stream | 404 | 501
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

const d = (o) => { const x = new Date(); x.setDate(x.getDate() + o); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const ENV = wrapMeetingStore([createMeeting({ id: 'M1', seriesId: 'S', title: 'Site walk', date: d(0), items: [
  { ref: 'A1', type: 'action', owner: 'Mei', due: d(-2), status: 'open', text: { en: 'Fix the gate' } },
  { ref: 'A2', type: 'action', owner: 'Lars', due: d(4), status: 'open', text: { en: 'Order helmets' } },
  { ref: 'D1', type: 'decision', status: 'open', text: { en: 'Walk weekly' } },
] })]);
const regStatus = (ref) => page.evaluate((r) => JSON.parse(localStorage.getItem('minutesRegister')).meetings[0].items.find((i) => i.ref === r).status, ref);
const dialogText = () => page.$eval('.ask-body', (b) => b.textContent.replace(/\s+/g, ' '));

before(async () => {
  assert.ok(existsSync('dist/app.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], { cwd: new URL('..', import.meta.url), env: { ...process.env, LAB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer(`${ORIGIN}/dist/app.html`);
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.host !== '127.0.0.1:17865') return req.continue();
    if (u.pathname === '/ask') {
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
      asked.push(JSON.parse(req.postData() || '{}'));
      if (askMode !== 'stream') return req.respond({ status: askMode === '404' ? 404 : 501, headers: { 'access-control-allow-origin': '*' }, body: '' });
      return req.respond({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: 'data: {"delta":"You have **2** open actions."}\n\ndata: {"done":true}\n\n' });
    }
    if (u.pathname === '/health') return req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, engine: 'whisper', model: 'large-v3-turbo', device: 'cpu' }) });
    return req.respond({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });
  await page.goto(`${ORIGIN}/dist/app.html`, { waitUntil: 'networkidle0' });
  await page.evaluate((env) => { localStorage.clear(); localStorage.setItem('minutesRegister', JSON.stringify(env)); localStorage.setItem('ysmShellWelcomed', 'true'); localStorage.setItem('ysmShowPlans', 'true'); localStorage.setItem('ysmAskProvider', '"register"'); }, ENV);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.askbar');
});

after(async () => { await browser?.close(); server?.kill('SIGTERM'); });

test('chip Open actions (Register only): daftar + kartu aksi; tidak ada yang ditulis sebelum Confirm', async () => {
  await page.click('.chips [data-i="2"]');
  await page.waitForSelector('.ask-card.action');
  assert.match(await dialogText(), /2 open actions/);
  assert.match(await dialogText(), /1 overdue/);
  assert.match(await dialogText(), /From your register/);
  assert.equal(await regStatus('A1'), 'open', 'belum dikonfirmasi → register utuh');
  await page.click('.ask-card.action [data-act="confirm"]');
  await page.waitForFunction(() => /register is updated/.test(document.querySelector('.ask-body').textContent));
  assert.equal(await regStatus('A1'), 'closed');
  assert.equal(await regStatus('A2'), 'open');
});

test('Cancel pada kartu aksi tidak mengubah apa pun', async () => {
  await page.click('[data-ask="new"]');
  await page.type('.ask-comp textarea', 'Open actions');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-card.list');
  const hasAction = await page.$('.ask-card.action [data-act="cancel"]');
  if (hasAction) { await hasAction.click(); await page.waitForFunction(() => /Nothing changed/.test(document.querySelector('.ask-body').textContent)); }
  assert.equal(await regStatus('A2'), 'open');
});

test('Local: jawaban dialirkan dari helper /ask, dengan grounding dan sumber', async () => {
  await page.click('[data-ask="new"]');
  await page.click('.ask-model'); await page.click('.ask-pick [data-prov="local"]');
  askMode = 'stream';
  await page.type('.ask-comp textarea', 'How many open actions?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /You have 2 open actions/.test(document.querySelector('.ask-body').textContent));
  const html = await page.$eval('.a-txt', (t) => t.innerHTML);
  assert.match(html, /<b>2<\/b>/, 'angka kunci tebal');
  assert.match(await dialogText(), /Local model · Qwen · 0 credits/, 'Plans menyala (A03b): sumber menyebut 0 kredit');
  const body = asked.at(-1);
  assert.equal(body.provider, 'local');
  assert.equal(body.question, 'How many open actions?');
  assert.match(body.grounding, /^You are Tide[\s\S]*REGISTER[\s\S]*A1 \[action\] Fix the gate/);
});

test('Local tanpa rute /ask: dikatakan jelas, lalu jawaban dari register', async () => {
  askMode = '404';
  await page.type('.ask-comp textarea', 'Open actions');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /no Ask route/.test(document.querySelector('.ask-body').textContent));
  await page.click('.ask-card [data-act="use-register"]');
  await page.waitForFunction(() => document.querySelectorAll('.ask-card.list').length >= 1);
});

test('Awan: kartu persetujuan dulu; Batal kembali ke Lokal; Nyalakan → belum tersambung', async () => {
  await page.click('[data-ask="new"]');
  await page.click('.ask-model'); await page.click('.ask-pick [data-prov="cloud"]');
  const n = asked.length;
  await page.type('.ask-comp textarea', 'Recap last meeting');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-card.consent');
  assert.equal(asked.length, n, 'tidak ada yang dikirim sebelum persetujuan');
  await page.click('[data-act="consent-no"]');
  await page.waitForFunction(() => /Local/.test(document.querySelector('.ask-model').textContent));
  assert.equal(asked.length, n);
  await page.click('.ask-model'); await page.click('.ask-pick [data-prov="cloud"]');
  askMode = '501';
  await page.type('.ask-comp textarea', 'Recap last meeting');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-act="consent-yes"]');
  await page.click('[data-act="consent-yes"]');
  await page.waitForFunction(() => /Cloud is not connected/.test(document.querySelector('.ask-body').textContent));
  assert.equal(asked.at(-1).provider, 'cloud');
  assert.match(asked.at(-1).model, /claude-sonnet-5/);
  assert.equal(await page.evaluate(() => chrome.storage.local.get('ysmAskCloudConsent').then((r) => r.ysmAskCloudConsent)), true);
});

test('Escape menutup; / membuka; kredit = belum ada server', async () => {
  assert.match(await page.$eval('.credits', (c) => c.textContent), /No server yet/);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.ask-ov', (o) => o.hidden), true);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('/');
  assert.equal(await page.$eval('.ask-ov', (o) => o.hidden), false);
  await page.keyboard.press('Escape');
});

test('A10 Paket: tiga kartu, tombol Coming soon, paket isi ulang, belum ada server', async () => {
  await page.click('#plans-link');
  await page.waitForSelector('.plans');
  const r = await page.evaluate(() => ({
    plans: [...document.querySelectorAll('.plan .price span')].map((s) => s.textContent),
    buttons: [...document.querySelectorAll('.plan button')].map((b) => [b.textContent, b.disabled]),
    packs: document.querySelectorAll('.pack').length,
    page: document.querySelector('#page').textContent,
  }));
  assert.deepEqual(r.plans, ['$0.00', '$4.99', '$9.99']);
  assert.ok(r.buttons.every(([, dis]) => dis), 'belum ada pembayaran: semua tombol nonaktif');
  assert.deepEqual(r.buttons.map(([t]) => t), ['What you have now', 'Coming soon', 'Coming soon']);
  assert.equal(r.packs, 4);
  assert.match(r.page, /No server yet/);
  assert.match(r.page, /1 credit = Rp100/);
});

async function openAskFresh() {
  await page.evaluate(() => document.body.focus());
  if (await page.$eval('.ask-ov', (o) => o.hidden)) await page.keyboard.press('/');
  await page.waitForSelector('.ask-ov:not([hidden])');
  await page.click('[data-ask="new"]');
}
const exportCard = () => page.$eval('.ask-card.export', (c) => ({ text: c.textContent.replace(/\s+/g, ' ').trim(), hasOpen: !!c.querySelector('[data-act="open-file"]'), file: c.querySelector('.fn')?.textContent || null }));

test('Ekspor di lab (tanpa chrome.downloads): kartu "Done · N rows" + nama berkas, tanpa tautan Open yang mati', async () => {
  await page.evaluate(() => {
    window.__dl = [];
    HTMLAnchorElement.prototype.click = function () { fetch(this.href).then((r) => r.text()).then((t) => window.__dl.push({ name: this.download, text: t })); };
  });
  await openAskFresh();
  await page.type('.ask-comp textarea', 'Export open actions to Markdown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-card.export');
  const c = await exportCard();
  assert.match(c.text, /Export to Markdown/);
  assert.match(c.text, /Done · 1 row/, 'A1 sudah closed oleh tes pertama: sisa A2');
  assert.equal(c.hasOpen, false, 'halaman web tidak bisa membuka berkas: tidak ada tombol Open');
  assert.match(c.file, /^open-actions-\d{4}-\d{2}-\d{2}\.md$/);
  await page.waitForFunction(() => window.__dl.length === 1);
  const dl = await page.evaluate(() => window.__dl[0]);
  assert.equal(dl.name, c.file);
  assert.match(dl.text, /^# Open actions\n[\s\S]*\| A2 \| Order helmets \| Lars \|/);
  assert.doesNotMatch(dl.text, /Fix the gate/, 'A1 closed tidak ikut');
  const turn = await page.$eval('.a-turn', (t) => t.textContent);
  assert.doesNotMatch(turn, /From your register|Looked at/, 'kartu adalah jawabannya, seperti di papan');
});

test('Ekspor di ekstensi: chrome.downloads.download lalu Open memanggil chrome.downloads.show(id)', async () => {
  await page.evaluate(() => {
    window.__saved = []; window.__shown = [];
    chrome.permissions = { contains: async () => true, request: async () => true };
    chrome.downloads = { download: async (o) => { window.__saved.push(o); return 7; }, show: (id) => window.__shown.push(id) };
  });
  await page.click('[data-ask="new"]');
  await page.type('.ask-comp textarea', 'Export open actions to Markdown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-card.export [data-act="open-file"]');
  const saved = await page.evaluate(() => window.__saved);
  assert.equal(saved.length, 1);
  assert.match(saved[0].filename, /^open-actions-.*\.md$/);
  assert.equal(saved[0].saveAs, false);
  assert.deepEqual(await page.evaluate(() => window.__shown), [], 'belum dibuka sebelum Open ditekan');
  await page.click('.ask-card.export [data-act="open-file"]');
  assert.deepEqual(await page.evaluate(() => window.__shown), [7]);
  assert.equal((await exportCard()).file, null, 'dengan Open, nama berkas tidak dobel');
  await page.evaluate(() => { delete chrome.downloads; delete chrome.permissions; });
});

test('Ekspor tanpa baris: jawaban teks, tanpa kartu dan tanpa unduhan', async () => {
  await page.evaluate(() => { window.__dl = []; });
  await page.click('[data-ask="new"]');
  await page.type('.ask-comp textarea', 'Export risks');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /nothing to export/i.test(document.querySelector('.ask-body').textContent));
  assert.equal(await page.$('.ask-card.export'), null);
  assert.equal(await page.evaluate(() => window.__dl.length), 0);
  await page.keyboard.press('Escape');
});

test('Papan A03: bubble hitam, baris langkah dengan mata, kartu daftar dengan ubin + label status, kartu aksi berbingkai hijau', async () => {
  await page.evaluate((env) => localStorage.setItem('minutesRegister', JSON.stringify(env)), ENV); // A1 kembali terbuka dan terlambat
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#ask-field');
  await openAskFresh();
  await page.click('.ask-model'); await page.click('.ask-pick [data-prov="register"]');
  await page.type('.ask-comp textarea', 'Open actions');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.ask-card.list');
  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rows = [...document.querySelectorAll('.ask-card.list .lrow')].map((x) => ({ tile: !!x.querySelector('.tl2'), late: !!x.querySelector('.tl2.late'), label: x.querySelector('.r').textContent }));
    return { step: !!q('.steps.one svg'), title: q('.ask-card.list .lh b').textContent, total: q('.ask-card.list .lh strong').textContent, foot: q('.ask-card.list .ft').textContent, rows, action: getComputedStyle(q('.ask-card.action')).boxShadow, h: q('.ask-card.action .h').textContent, cancelFlex: getComputedStyle(q('.ask-card.action .btn')).flexGrow };
  });
  assert.equal(r.step, true, 'satu langkah: teks sendiri dengan ikon mata, tanpa chevron');
  assert.equal(r.title, 'Open actions');
  assert.equal(r.total, '2');
  assert.match(r.foot, /2 items in 1 meeting/);
  assert.deepEqual(r.rows.map((x) => [x.tile, x.late, x.label]), [[true, true, 'Overdue'], [true, false, 'Due ' + new Date(Date.now() + 4 * 864e5).toLocaleDateString('en-US', { weekday: 'short' })]]);
  assert.match(r.action, /rgb/, 'bingkai hijau 1,5 px');
  assert.match(r.h, /Mark as done/);
  assert.equal(r.cancelFlex, '1');
});

test('Picker model: grup "On this computer" + "Cloud · OpenRouter", radio, petunjuk biaya; tiga id OpenRouter yang diverifikasi', async () => {
  await page.click('.ask-model');
  const r = await page.evaluate(() => ({
    groups: [...document.querySelectorAll('.ask-pick .g')].map((g) => g.textContent),
    options: [...document.querySelectorAll('.ask-pick [role="option"]')].map((o) => [o.querySelector('b').textContent, o.querySelector('.hint')?.textContent || '', o.dataset.model]),
    selected: document.querySelectorAll('.ask-pick [aria-selected="true"]').length,
  }));
  assert.deepEqual(r.groups, ['On this computer', 'Cloud · OpenRouter']);
  assert.deepEqual(r.options.map((o) => o[0]), ['Local', 'Register only', 'Claude Sonnet 5', 'Gemini 3.1 Flash Lite', 'GPT-5.5']);
  assert.deepEqual(r.options.slice(2).map((o) => o[2]), ['anthropic/claude-sonnet-5', 'google/gemini-3.1-flash-lite', 'openai/gpt-5.5']);
  assert.ok(r.options.slice(2).every((o) => /credits \/ answer/.test(o[1])));
  assert.equal(r.selected, 1);
  await page.keyboard.press('Escape');
});

test('A03b kredit: tanpa server tidak ada saldo; contoh berlabel "sample": <10 = banner, 0 = kartu Out of credits + Kirim mati + Use Local', async () => {
  assert.match(await page.$eval('.credits', (c) => c.textContent), /No server yet/);
  await page.evaluate(() => localStorage.setItem('ysmCreditsSample', '8'));
  await page.click('.ask-model'); await page.click('.ask-pick [data-prov="cloud"]');
  await page.evaluate(() => { document.querySelector('.ask-model').blur(); });
  const low = await dialogText();
  assert.match(low, /8 credits left\./);
  assert.match(await page.$eval('.credits', (c) => c.textContent), /Credits 8 · sample/);
  await page.evaluate(() => localStorage.setItem('ysmCreditsSample', '0'));
  await page.click('[data-ask="new"]');
  await page.type('.ask-comp textarea', 'hello');
  assert.equal(await page.$eval('.send', (b) => b.disabled), true, 'Kirim mati pada 0 kredit di Awan');
  assert.match(await dialogText(), /Out of credits\. Local answers still work\./);
  await page.click('[data-act="use-local-banner"]');
  assert.doesNotMatch(await dialogText(), /Out of credits/);
  assert.equal(await page.$eval('.send', (b) => b.disabled), false, 'Lokal gratis: Kirim hidup lagi');
  await page.evaluate(() => localStorage.removeItem('ysmCreditsSample'));
  await page.$eval('.ask-comp textarea', (t) => { t.value = ''; });
  await page.keyboard.press('Escape');
});

test('tanpa galat halaman', () => assert.deepEqual(pageErrors, []));
