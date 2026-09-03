// Full end-to-end test: loads the built extension in a real Chrome (for
// Testing), plays real spoken audio in a tab, starts a realtime session from
// the side panel page, and asserts that transcribed subtitle lines appear and
// that the overlay is injected into the page.
//
// The --allowlisted-extension-id flag bypasses the "extension must be invoked"
// gate for tabCapture (the same thing a real user's toolbar-click/context-menu
// grant does) so the whole pipeline can be exercised unattended.
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(root, 'dist');
const PROFILE = path.join(root, '.e2e-profile');
const PAGE_URL = 'http://127.0.0.1:8799/audio-page.html';
// --pick: exercise the manual "Teams-style" picker path instead of tabCapture.
// Runs WITHOUT --allowlisted-extension-id on purpose: the picker path must
// work with no invocation grant at all.
const PICK_MODE = process.argv.includes('--pick');
// --native: route ASR through the native helper (must already be running).
const NATIVE_MODE = process.argv.includes('--native');

const baseArgs = [
  `--disable-extensions-except=${DIST}`,
  `--load-extension=${DIST}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1200,800',
];

async function launch(extra = []) {
  return puppeteer.launch({
    headless: false,
    userDataDir: PROFILE,
    args: [...baseArgs, ...extra],
    defaultViewport: null,
  });
}

function log(...a) {
  console.log('[e2e]', ...a);
}

// ---- phase 1: discover the (path-derived, stable) extension id -------------
let browser = await launch();
const swTarget = await browser.waitForTarget(
  (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
  { timeout: 20000 },
);
const extId = new URL(swTarget.url()).host;
log('extension id:', extId);
await browser.close();

// ---- phase 2: run the pipeline --------------------------------------------
browser = await launch(
  PICK_MODE
    ? ['--auto-select-tab-capture-source-by-title=AudioTestPage']
    : [`--allowlisted-extension-id=${extId}`],
);
try {
  const audioPage = await browser.newPage();
  await audioPage.goto(PAGE_URL, { waitUntil: 'load' });
  log('audio page playing');

  const panel = await browser.newPage();
  panel.on('console', (m) => {
    if (m.type() === 'error') log('panel console error:', m.text().slice(0, 200));
  });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'load' });

  // fast settings: tiny model on WASM
  const e2eSettings = {
    uiLang: 'en',
    mirror: 'huggingface',
    device: process.env.E2E_DEVICE || 'wasm',
    dualLine: false,
    overlayFontSize: 24,
    asrModel: process.env.E2E_MODEL || 'whisper-tiny',
    engine: NATIVE_MODE ? 'native' : 'browser',
    nativeUrl: 'http://127.0.0.1:17865',
  };
  log('settings:', JSON.stringify(e2eSettings));
  await panel.evaluate((s) => chrome.storage.local.set({ settings: s }), e2eSettings);
  await panel.reload({ waitUntil: 'load' });
  // NOTE: use main-world evaluate for all DOM interaction — puppeteer's
  // ElementHandle calls (click/select/$eval on handles) run in an isolated
  // world that intermittently stalls on extension pages.
  await panel.evaluate(() => {
    document.querySelector('#task-toggle button[data-task="transcribe"]').click();
    const s = document.getElementById('src-lang');
    s.value = 'en';
    s.dispatchEvent(new Event('change'));
  });

  // make the audio tab the active one so the panel targets it
  await audioPage.bringToFront();
  await new Promise((r) => setTimeout(r, 1200));

  const tabTitle = await panel.$eval('#tab-title', (el) => el.textContent);
  log('panel sees tab:', tabTitle);
  if (!/AudioTestPage/.test(tabTitle)) throw new Error('panel did not pick up the audio tab');

  await panel.waitForFunction(() => !document.getElementById('btn-start').disabled, {
    timeout: 10000,
  });
  await panel.evaluate((sel) => document.querySelector(sel).click(), PICK_MODE ? '#btn-pick' : '#btn-start');
  log(
    `${PICK_MODE ? 'manual-pick' : 'start'} clicked — waiting for model load + first subtitles (first run downloads ~41 MB)…`,
  );

  const t0 = Date.now();
  let lastStatus = '';
  const statusTimer = setInterval(async () => {
    try {
      const s = await panel.$eval('#status-line', (el) => el.textContent);
      if (s && s !== lastStatus) {
        lastStatus = s;
        log('status:', s);
      }
    } catch {}
  }, 3000);

  try {
    await panel.waitForFunction(
      () => {
        const el = document.getElementById('live-tgt-lines');
        return el && /fox|subtitle|hello|machine|device|dog/i.test(el.textContent || '');
      },
      { timeout: 300000, polling: 2000 },
    );
  } finally {
    clearInterval(statusTimer);
  }

  const lines = await panel.$eval('#live-tgt-lines', (el) => el.textContent.trim());
  log(`SUBTITLES after ${((Date.now() - t0) / 1000).toFixed(0)}s:`, lines.slice(0, 300));

  const hasOverlay = await audioPage.evaluate(
    () => !!document.getElementById('__local_transsub_overlay'),
  );
  log('overlay injected into page:', hasOverlay);

  const overlayText = hasOverlay
    ? await audioPage.evaluate(() => {
        const h = document.getElementById('__local_transsub_overlay');
        return h.shadowRoot ? h.shadowRoot.textContent.trim().slice(0, 200) : '(no shadow)';
      })
    : '';
  log('overlay text:', overlayText || '(empty right now)');

  // stop cleanly
  await panel.bringToFront();
  await panel.evaluate(() => document.getElementById('btn-stop').click());
  await new Promise((r) => setTimeout(r, 1000));

  if (!hasOverlay) throw new Error('overlay missing');
  log('E2E PASS ✅');
} finally {
  await browser.close();
}
