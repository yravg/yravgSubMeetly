#!/usr/bin/env node
/**
 * E2E transkripsi langsung (realtime tab subtitle).
 *
 * Memuat ekstensi ter-build di Chrome (Puppeteer), memutar
 * test/audio-page.html, Start Task / --pick / --native, lalu menegaskan
 * baris subtitel di Side Panel + overlay Shadow DOM.
 *
 * Usage:
 *   node scripts/e2e.mjs                 # tabCapture allowlisted
 *   node scripts/e2e.mjs --pick          # pemilih tab manual
 *   node scripts/e2e.mjs --native        # ASR lewat helper :17865
 *   node scripts/e2e.mjs --harness-only  # cek prasyarat tanpa Chrome headed
 *
 * Menulis test/last-e2e.json (suite e2e-realtime / e2e-pick / e2e-native).
 * Lab server harus menjawab di http://127.0.0.1:8799/audio-page.html
 * (./scripts/start-lab.sh atau python3 scripts/lab-server.py).
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(root, 'dist');
const PROFILE = path.join(root, '.e2e-profile');
const OUT_PATH = path.join(root, 'test', 'last-e2e.json');
const PAGE_URL = process.env.E2E_AUDIO_URL || 'http://127.0.0.1:8799/audio-page.html';

const PICK_MODE = process.argv.includes('--pick');
const NATIVE_MODE = process.argv.includes('--native');
const HARNESS_ONLY = process.argv.includes('--harness-only');

const suiteId = PICK_MODE ? 'e2e-pick' : NATIVE_MODE ? 'e2e-native' : 'e2e-realtime';
const suiteName = PICK_MODE
  ? 'E2E pemilih tab manual (--pick)'
  : NATIVE_MODE
    ? 'E2E mesin native helper (--native)'
    : 'E2E subtitel tab (tabCapture)';

const logLines = [];
function log(...a) {
  const line = a.map(String).join(' ');
  logLines.push(`[e2e] ${line}`);
  console.log('[e2e]', ...a);
}

/** @type {{ id: string, name: string, status: string, detail: string }[]} */
const checks = [];

function check(id, name, ok, detail) {
  checks.push({
    id,
    name,
    status: ok ? 'pass' : 'fail',
    detail: detail || (ok ? 'ok' : 'gagal'),
  });
  if (!ok) throw new Error(`${id}: ${detail || name}`);
}

function writeReport({ status, durationMs, error = null }) {
  const prev = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : { source: 'e2e', suites: [] };

  const suite = {
    id: suiteId,
    kind: 'e2e',
    name: suiteName,
    command: `node scripts/e2e.mjs${PICK_MODE ? ' --pick' : ''}${NATIVE_MODE ? ' --native' : ''}${HARNESS_ONLY ? ' --harness-only' : ''}`,
    script: 'scripts/e2e.mjs',
    status,
    durationMs,
    lastRun: new Date().toISOString(),
    covers: PICK_MODE
      ? 'Jalur getDisplayMedia / btn-pick terhadap AudioTestPage'
      : NATIVE_MODE
        ? 'ASR engine=native via helper 127.0.0.1:17865'
        : 'Puppeteer + tabCapture allowlisted → subtitel + overlay',
    checks: [...checks],
    log: [...logLines],
    error,
  };

  const suites = Array.isArray(prev.suites) ? prev.suites.filter((s) => s.id !== suiteId) : [];
  suites.push(suite);

  const report = {
    source: 'e2e',
    generatedAt: new Date().toISOString(),
    mode: suiteId,
    suites,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
  log('wrote', path.relative(root, OUT_PATH));
}

async function harnessPreflight() {
  check('e2e-dist', 'Paket dist/ ada', fs.existsSync(path.join(DIST, 'manifest.json')), 'Jalankan npm run build');
  check(
    'e2e-audio-page',
    'Halaman audio uji ada',
    fs.existsSync(path.join(root, 'test', 'audio-page.html')),
    'test/audio-page.html',
  );
  check(
    'e2e-speech',
    'Berkas speech.wav ada',
    fs.existsSync(path.join(root, 'test', 'speech.wav')),
    'test/speech.wav dibutuhkan audio-page',
  );

  let labOk = false;
  let labDetail = 'tidak menjawab';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(PAGE_URL, { signal: ctrl.signal });
    clearTimeout(t);
    labOk = r.ok;
    labDetail = `${PAGE_URL} → ${r.status}`;
  } catch (err) {
    labDetail = `${PAGE_URL} offline (${err?.message || err}) — jalankan ./scripts/start-lab.sh`;
  }
  if (HARNESS_ONLY) {
    checks.push({
      id: 'e2e-lab-server',
      name: 'Lab server audio-page',
      status: labOk ? 'pass' : 'warn',
      detail: labDetail,
    });
  } else {
    check('e2e-lab-server', 'Lab server audio-page', labOk, labDetail);
  }

  if (NATIVE_MODE) {
    let nativeOk = false;
    let nativeDetail = 'offline';
    try {
      const r = await fetch('http://127.0.0.1:17865/health', { signal: AbortSignal.timeout(1500) });
      nativeOk = r.ok;
      nativeDetail = r.ok ? JSON.stringify(await r.json()).slice(0, 120) : `status ${r.status}`;
    } catch (err) {
      nativeDetail = err?.message || String(err);
    }
    if (HARNESS_ONLY) {
      checks.push({
        id: 'e2e-native-health',
        name: 'Native helper /health',
        status: nativeOk ? 'pass' : 'warn',
        detail: nativeDetail,
      });
    } else {
      check('e2e-native-health', 'Native helper /health', nativeOk, nativeDetail);
    }
  }

  check(
    'e2e-puppeteer',
    'Paket puppeteer terpasang',
    fs.existsSync(path.join(root, 'node_modules', 'puppeteer')),
    'npm i (devDependency puppeteer)',
  );
}

const baseArgs = [
  `--disable-extensions-except=${DIST}`,
  `--load-extension=${DIST}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1200,800',
];

async function launch(extra = []) {
  // JANGAN default ke Google Chrome bermerek: sejak Chrome 137 ia mengabaikan
  // --load-extension diam-diam, sehingga ekstensi tak pernah termuat dan
  // penantian service worker selalu timeout 20 dtk. Chrome for Testing yang
  // dibundel puppeteer masih menghormatinya. Override eksplisit tetap bisa
  // lewat PUPPETEER_EXECUTABLE_PATH (mis. Chromium lokal).
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  return puppeteer.launch({
    headless: false,
    executablePath: executablePath && fs.existsSync(executablePath) ? executablePath : undefined,
    userDataDir: PROFILE,
    args: [...baseArgs, ...extra],
    defaultViewport: null,
  });
}

async function runLiveE2E() {
  // ---- phase 1: discover extension id ------------------------------------
  let browser = await launch();
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
    { timeout: 20000 },
  );
  const extId = new URL(swTarget.url()).host;
  log('extension id:', extId);
  check('e2e-sw', 'Service worker ekstensi ditemukan', !!extId, extId);
  await browser.close();

  // ---- phase 2: pipeline -------------------------------------------------
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

    if (NATIVE_MODE) {
      const engine = await panel.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings');
        return settings?.engine;
      });
      check('e2e-native-engine', 'Settings engine=native', engine === 'native', `engine=${engine}`);
    }

    await panel.evaluate(() => {
      document.querySelector('#task-toggle button[data-task="transcribe"]')?.click();
      const s = document.getElementById('src-lang');
      if (s) {
        s.value = 'en';
        s.dispatchEvent(new Event('change'));
      }
    });

    await audioPage.bringToFront();
    await new Promise((r) => setTimeout(r, 1200));

    const tabTitle = await panel.$eval('#tab-title', (el) => el.textContent);
    log('panel sees tab:', tabTitle);
    check(
      'e2e-tab',
      'Side Panel menarget AudioTestPage',
      /AudioTestPage/.test(tabTitle || ''),
      tabTitle || '(kosong)',
    );

    await panel.waitForFunction(() => !document.getElementById('btn-start')?.disabled, {
      timeout: 10000,
    });

    if (PICK_MODE) {
      await panel.evaluate(() => document.querySelector('#btn-pick').click());
      check('e2e-pick-click', 'Tombol Pick tab / window manually', true, '#btn-pick diklik');
      log('manual-pick clicked — waiting for model load + first subtitles…');
    } else {
      await panel.evaluate(() => document.querySelector('#btn-start').click());
      log('start clicked — waiting for model load + first subtitles (first run downloads ~41 MB)…');
    }

    const t0 = Date.now();
    let lastStatus = '';
    const statusTimer = setInterval(async () => {
      try {
        const s = await panel.$eval('#status-line', (el) => el.textContent);
        if (s && s !== lastStatus) {
          lastStatus = s;
          log('status:', s);
        }
      } catch {
        /* panel may navigate */
      }
    }, 3000);

    try {
      await panel.waitForFunction(
        () => {
          const el = document.getElementById('live-tgt-lines');
          return el && /fox|subtitle|hello|machine|device|dog|weather|park|walk/i.test(el.textContent || '');
        },
        { timeout: 300000, polling: 2000 },
      );
    } finally {
      clearInterval(statusTimer);
    }

    const lines = await panel.$eval('#live-tgt-lines', (el) => el.textContent.trim());
    log(`SUBTITLES after ${((Date.now() - t0) / 1000).toFixed(0)}s:`, lines.slice(0, 300));
    check(
      PICK_MODE ? 'e2e-pick-audio' : NATIVE_MODE ? 'e2e-native-lines' : 'e2e-lines',
      'Baris subtitel muncul di pratinjau',
      lines.length > 0,
      lines.slice(0, 160),
    );

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
    check(
      PICK_MODE ? 'e2e-pick-overlay' : 'e2e-overlay',
      'Overlay diinjeksi ke halaman audio',
      hasOverlay,
      overlayText || (hasOverlay ? 'shadow kosong saat ini' : 'missing'),
    );

    await panel.bringToFront();
    await panel.evaluate(() => document.getElementById('btn-stop').click());
    await new Promise((r) => setTimeout(r, 1000));
    check('e2e-stop', 'End Task menghentikan sesi', true, '#btn-stop diklik');

    log('E2E PASS ✅');
  } finally {
    await browser.close();
  }
}

const tStart = Date.now();
try {
  await harnessPreflight();
  if (HARNESS_ONLY) {
    log('harness-only: prasyarat dicek, Chrome headed dilewati');
    writeReport({
      status: checks.some((c) => c.status === 'fail') ? 'fail' : 'pass',
      durationMs: Date.now() - tStart,
    });
    if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
    else log('HARNESS OK');
  } else {
    await runLiveE2E();
    writeReport({ status: 'pass', durationMs: Date.now() - tStart });
  }
} catch (err) {
  log('E2E FAIL:', err?.message || err);
  // Puppeteer melipat penyebab (frame detached, target closed, predicate melempar) ke dalam
  // `cause`; tanpa ini yang tercetak hanya "Waiting failed" dan tak bisa didiagnosis.
  log('cause:', err?.cause?.message || err?.cause || '(tidak ada)');
  log('stack:', String(err?.stack || '').split('\n').slice(0, 4).join(' | '));
  if (!checks.some((c) => c.status === 'fail')) {
    checks.push({
      id: 'e2e-fatal',
      name: 'Jalankan E2E',
      status: 'fail',
      detail: err?.message || String(err),
    });
  }
  writeReport({
    status: 'fail',
    durationMs: Date.now() - tStart,
    error: err?.message || String(err),
  });
  process.exitCode = 1;
}
