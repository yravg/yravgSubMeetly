import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = 8879;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function waitForServer(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Lab server did not start at ${url}`);
}

test('production export card uses selected realtime data and persists cross-OS options', async (t) => {
  const server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill('SIGTERM'));
  await waitForServer(`${ORIGIN}/app.html`);

  const browser = await puppeteer.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    // Only wipe storage for the FIRST document. This hook re-runs on every
    // navigation, so clearing unconditionally would also wipe the settings
    // right before the post-reload assertions that check they persisted.
    if (!sessionStorage.getItem('__exportTestCleared')) {
      localStorage.clear();
      sessionStorage.setItem('__exportTestCleared', '1');
    }
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download) {
        const record = { name: this.download, href: this.href, bytes: null, text: null };
        window.__exportDownloads = window.__exportDownloads || [];
        window.__exportDownloads.push(record);
        fetch(this.href).then((res) => res.arrayBuffer()).then((buffer) => {
          record.bytes = [...new Uint8Array(buffer)];
          record.text = new TextDecoder().decode(buffer);
        });
        return;
      }
      return nativeClick.call(this);
    };
  });

  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#helper-export [data-export-kind="srt"]');

  assert.equal(await page.$eval('#helper-export [data-export-kind="srt"]', (el) => el.disabled), true);
  assert.equal(await page.$$eval('#settings-modal #helper-export, #export-format-list', (els) => els.length), 0);

  await page.evaluate(() => {
    window.__mockEmit({
      target: 'panel',
      type: 'subtitle',
      data: {
        source: 'Selamat pagi',
        translation: 'Good morning',
        t0: 1.25,
        t1: 3.5,
        final: true,
      },
    });
  });
  await page.waitForFunction(() => !document.querySelector('#helper-export [data-export-kind="srt"]').disabled);

  const preview = await page.$eval('#helper-export-name-hint', (el) => el.textContent);
  assert.match(preview, /Lab_demo_looping_speech\.zh-en\.srt/);

  await page.click('#helper-export [data-export-kind="vtt"]');
  await page.waitForFunction(() => window.__exportDownloads?.[0]?.text != null);
  const first = await page.evaluate(() => window.__exportDownloads[0]);
  assert.equal(first.name, 'Lab_demo_looping_speech.zh-en.vtt');
  assert.match(first.text, /^WEBVTT\n/);
  assert.match(first.text, /Selamat pagi\nGood morning/);
  assert.doesNotMatch(first.text, /meeting_notes_demo|Project Manager/);
  assert.match(await page.$eval('#helper-export-name-hint', (el) => el.textContent), /\.vtt$/);

  // Menyalakan satu opsi membuat kartu me-render ulang seluruh isinya, jadi
  // kedua klik tidak boleh beruntun: klik kedua bisa mendarat pada checkbox
  // yang sudah dilepas dari DOM dan hilang begitu saja (uji jadi flaky).
  const setExportOpt = async (name) => {
    await page.waitForSelector(`#helper-export [data-export-opt="${name}"]`);
    await page.click(`#helper-export [data-export-opt="${name}"]`);
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem('settings') || 'null')?.exportOptions?.[key] === true,
      {},
      name,
    );
  };
  await setExportOpt('crlf');
  await setExportOpt('bom');
  await page.click('#helper-export [data-export-kind="srt"]');
  await page.waitForFunction(() => window.__exportDownloads?.[1]?.text != null);
  const second = await page.evaluate(() => window.__exportDownloads[1]);
  assert.equal(second.name, 'Lab_demo_looping_speech.zh-en.srt');
  assert.deepEqual(second.bytes.slice(0, 3), [0xef, 0xbb, 0xbf]);
  assert.match(second.text, /\r\n/);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#helper-export [data-export-opt="crlf"]');
  assert.equal(await page.$eval('#helper-export [data-export-opt="crlf"]', (el) => el.checked), true);
  assert.equal(await page.$eval('#helper-export [data-export-opt="bom"]', (el) => el.checked), true);

  await page.click('#btn-export-os-default');
  await page.waitForFunction(() => {
    const settings = JSON.parse(localStorage.getItem('settings') || 'null');
    return settings?.exportOptions?.crlf === false && settings?.exportOptions?.bom === false;
  });
  assert.equal(await page.$eval('#helper-export [data-export-opt="crlf"]', (el) => el.checked), false);
  assert.equal(await page.$eval('#helper-export [data-export-opt="bom"]', (el) => el.checked), false);
});
