// Reproduce the panel freeze and dump the JS stack of whichever extension
// document is spinning (panel or offscreen) via Debugger.pause.
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(root, 'dist');
const PROFILE = path.join(root, '.e2e-profile');
const PAGE_URL = 'http://localhost:8799/test/audio-page.html';
const log = (...a) => console.log('[dbg]', ...a);

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  protocolTimeout: 20000,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--allowlisted-extension-id=jhbcabgpdhiiilmmpigkloimeigmmmgi',
  ],
});
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 20000 });
  const extId = new URL(sw.url()).host;

  const audioPage = await browser.newPage();
  await audioPage.goto(PAGE_URL);
  const panel = await browser.newPage();
  panel.on('console', (m) => log('panel console', m.type(), m.text().slice(0, 160)));
  panel.on('pageerror', (e) => log('panel pageerror', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(() =>
    chrome.storage.local.set({
      settings: { uiLang: 'en', mirror: 'huggingface', device: 'wasm', dualLine: false,
        overlayFontSize: 24, asrModel: 'whisper-tiny', engine: 'browser',
        nativeUrl: 'http://127.0.0.1:17865' },
    }),
  );
  await panel.reload({ waitUntil: 'load' });
  const panelCdp = await panel.createCDPSession();
  await panelCdp.send('Debugger.enable');

  async function alive(page, label) {
    const t0 = Date.now();
    try {
      await Promise.race([
        page.evaluate(() => 1),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      log(`${label} responsive (${Date.now() - t0} ms)`);
      return true;
    } catch {
      log(`${label} FROZEN`);
      return false;
    }
  }

  await alive(panel, 'panel after reload');
  await panel.click('#task-toggle button[data-task="transcribe"]');
  await panel.select('#src-lang', 'en');
  await alive(panel, 'panel after selects');
  await audioPage.bringToFront();
  await new Promise((r) => setTimeout(r, 1500));
  const ok1 = await alive(panel, 'panel after bringToFront');

  await panel.waitForFunction(() => !document.getElementById('btn-start').disabled, { timeout: 10000 });
  log('btn-start enabled');
  try {
    await panel.click('#btn-start');
    log('start clicked');
  } catch (e) {
    log('click failed:', e.message.slice(0, 100));
  }

  // poll for up to 150 s through model load + inference
  let frozen = !ok1;
  for (let i = 0; i < 50 && !frozen; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    frozen = !(await alive(panel, `panel t+${(i + 1) * 3}s`));
    if (!frozen) {
      const st = await panel.$eval('#status-line', (el) => el.textContent).catch(() => '?');
      const lines = await panel.$eval('#live-tgt-lines', (el) => el.textContent.trim().slice(0, 80)).catch(() => '');
      log('   status:', st, lines ? '| lines: ' + lines : '');
      if (/fox|subtitle|hello/i.test(lines)) {
        log('SUBTITLES OK');
        break;
      }
    }
  }

  if (frozen) {
    log('pausing panel JS thread to capture stack…');
    const paused = new Promise((res) => panelCdp.once('Debugger.paused', res));
    panelCdp.send('Debugger.pause').catch((e) => log('pause err', e.message));
    const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 8000))]);
    if (ev) {
      for (const f of ev.callFrames.slice(0, 12)) {
        log(`  at ${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`);
      }
      await panelCdp.send('Debugger.resume').catch(() => {});
    } else {
      log('no paused event — main thread may be blocked outside JS (e.g. in the offscreen doc)');
    }
  }

  // also probe the offscreen document
  const off = browser.targets().find((t) => t.url().includes('offscreen.html'));
  log('offscreen target:', off ? off.url() : 'none');
  if (off) {
    const offCdp = await off.createCDPSession();
    try {
      await offCdp.send('Runtime.enable');
      const r = await Promise.race([
        offCdp.send('Runtime.evaluate', { expression: '1+1' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      log('offscreen responsive:', JSON.stringify(r.result));
    } catch {
      log('offscreen FROZEN — pausing…');
      await offCdp.send('Debugger.enable').catch(() => {});
      const paused = new Promise((res) => offCdp.once('Debugger.paused', res));
      offCdp.send('Debugger.pause').catch(() => {});
      const ev = await Promise.race([paused, new Promise((r) => setTimeout(() => r(null), 8000))]);
      if (ev) for (const f of ev.callFrames.slice(0, 12)) log(`  at ${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`);
      else log('no paused event for offscreen');
    }
  }
} finally {
  await browser.close().catch(() => {});
}
