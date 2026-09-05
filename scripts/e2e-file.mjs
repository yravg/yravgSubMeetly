#!/usr/bin/env node
/**
 * E2E berkas offline + ekspor SRT / VTT / TXT.
 *
 * Default (cepat): uji kontrak formatSrt/formatVtt/formatTxt + wiring Side Panel
 * offline (tanpa Chrome headed).
 *
 * Usage:
 *   node scripts/e2e-file.mjs              # export + wiring (default)
 *   node scripts/e2e-file.mjs --harness-only
 *   node scripts/e2e-file.mjs --browser    # Puppeteer: mode Offline + sample wav
 *                                         # (butuh dist/, lama karena unduh model)
 *
 * Menulis/menggabung suite `e2e-file` ke test/last-e2e.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSrt, formatVtt, formatTxt, splitSubtitleCues } from '../src/lib/transcript-cache.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(root, 'dist');
const OUT_PATH = path.join(root, 'test', 'last-e2e.json');
const SAMPLE =
  process.env.E2E_FILE_SAMPLE || path.join(root, 'test', 'samples', 'cc0', 'en-1.mp3');
const FALLBACK_SPEECH = path.join(root, 'test', 'speech.wav');

const BROWSER = process.argv.includes('--browser');
const HARNESS_ONLY = process.argv.includes('--harness-only');

const suiteId = 'e2e-file';
const logLines = [];
function log(...a) {
  const line = a.map(String).join(' ');
  logLines.push(`[e2e-file] ${line}`);
  console.log('[e2e-file]', ...a);
}

/** @type {{ id: string, name: string, status: string, detail: string }[]} */
const checks = [];

function pass(id, name, detail = 'ok') {
  checks.push({ id, name, status: 'pass', detail });
}

function fail(id, name, detail) {
  checks.push({ id, name, status: 'fail', detail });
  throw new Error(`${id}: ${detail}`);
}

function warn(id, name, detail) {
  checks.push({ id, name, status: 'warn', detail });
}

function writeReport({ status, durationMs, error = null }) {
  const prev = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : { source: 'e2e', suites: [] };
  const suite = {
    id: suiteId,
    kind: 'e2e',
    name: 'E2E berkas offline + ekspor SRT/VTT/TXT',
    command: `node scripts/e2e-file.mjs${BROWSER ? ' --browser' : ''}${HARNESS_ONLY ? ' --harness-only' : ''}`,
    script: 'scripts/e2e-file.mjs',
    status,
    durationMs,
    lastRun: new Date().toISOString(),
    covers:
      'formatSrt/formatVtt/formatTxt + wiring Offline dropzone; opsional Puppeteer --browser',
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

function assertFile(rel, id, name) {
  const full = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!fs.existsSync(full)) fail(id, name, `Tidak ada: ${rel}`);
  pass(id, name, path.relative(root, full));
  return full;
}

function assertContains(rel, pattern, id, name) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) fail(id, name, `Tidak ada: ${rel}`);
  const text = fs.readFileSync(full, 'utf8');
  if (!pattern.test(text)) fail(id, name, `${rel} tidak memuat ${pattern}`);
  pass(id, name, rel);
}

const WALL =
  'This is a very long transcription segment that would cover the entire video screen ' +
  'if exported as a single subtitle cue because speech recognition returns multi-sentence ' +
  'chunks that can last twenty or thirty seconds with hundreds of characters of continuous text.';

function runExportContracts() {
  const cues = splitSubtitleCues([{ t0: 0, t1: 30, src: WALL, tgt: WALL }]);
  if (cues.length < 3) fail('e2e-split', 'splitSubtitleCues memecah segmen panjang', `got ${cues.length}`);
  pass('e2e-split', 'splitSubtitleCues memecah segmen panjang', `${cues.length} cues`);

  const sample = [
    { t0: 0, t1: 2.5, src: 'Hello world', tgt: 'Halo dunia' },
    { t0: 2.5, t1: 5, src: 'Second line', tgt: 'Baris dua' },
  ];

  const srt = formatSrt(sample, { dualLine: true, title: 'e2e-file' });
  if (!/00:00:00,000/.test(srt) || !/Hello world/.test(srt) || !/Halo dunia/.test(srt)) {
    fail('e2e-export-srt', 'formatSrt dual-line', srt.slice(0, 120));
  }
  pass('e2e-export-srt', 'Ekspor SRT', `${srt.split(/\n\n+/).length} blok`);

  const vttDual = formatVtt(sample, { dualLine: true });
  const vttSingle = formatVtt(sample, { dualLine: false });
  if (!/^WEBVTT/m.test(vttDual) || !/Hello world/.test(vttDual) || !/Halo dunia/.test(vttDual)) {
    fail('e2e-export-vtt', 'formatVtt dual-line', vttDual.slice(0, 120));
  }
  if (!/Halo dunia/.test(vttSingle)) {
    fail('e2e-export-vtt-single', 'formatVtt single (tgt)', vttSingle.slice(0, 120));
  }
  pass('e2e-export-vtt', 'Ekspor WebVTT', 'dual + single OK');

  const txt = formatTxt(sample, { title: 'E2E File', url: 'file://sample.wav' });
  if (!/Title: E2E File/.test(txt) || !/Hello world/.test(txt) || !/Halo dunia/.test(txt)) {
    fail('e2e-export-txt', 'formatTxt header + baris', txt.slice(0, 160));
  }
  pass('e2e-export-txt', 'Ekspor TXT', 'header + src/tgt');
}

function runWiringChecks() {
  assertFile('src/lib/offline-io.js', 'e2e-offline-io', 'Modul staging OPFS');
  assertContains(
    'src/sidepanel.html',
    /id="off-drop"|id="off-file"/,
    'e2e-off-drop',
    'Dropzone Offline di Side Panel',
  );
  assertContains(
    'src/sidepanel.html',
    /id="btn-srt"|id="btn-vtt"|id="btn-txt"/,
    'e2e-export-btns',
    'Tombol ekspor SRT/VTT/TXT',
  );
  assertContains(
    'src/sidepanel.js',
    /exportLines\('srt'\)|btn-srt/,
    'e2e-export-handlers',
    'Handler ekspor di sidepanel.js',
  );
  assertContains(
    'src/offscreen.js',
    /offline-process|transcribeLong/,
    'e2e-offscreen-offline',
    'Offscreen memproses berkas offline',
  );

  const samplePath = fs.existsSync(SAMPLE) ? SAMPLE : FALLBACK_SPEECH;
  assertFile(samplePath, 'e2e-sample-wav', 'Berkas audio sampel untuk uji berkas');
}

async function runBrowserOffline() {
  const puppeteer = (await import('puppeteer')).default;
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    fail('e2e-file-dist', 'dist/ untuk --browser', 'Jalankan npm run build');
  }
  pass('e2e-file-dist', 'dist/ siap', 'manifest.json');

  const samplePath = fs.existsSync(SAMPLE) ? SAMPLE : FALLBACK_SPEECH;
  // Chrome bermerek ≥137 mengabaikan --load-extension diam-diam; pakai Chrome
  // for Testing bundel puppeteer kecuali di-override lewat PUPPETEER_EXECUTABLE_PATH.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: executablePath && fs.existsSync(executablePath) ? executablePath : undefined,
    userDataDir: path.join(root, '.e2e-file-profile'),
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1100,800',
    ],
    defaultViewport: null,
  });

  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
      { timeout: 20000 },
    );
    const extId = new URL(swTarget.url()).host;
    log('extension id:', extId);
    pass('e2e-file-sw', 'Service worker', extId);

    const panel = await browser.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'load' });
    await panel.evaluate((s) => chrome.storage.local.set({ settings: s }), {
      uiLang: 'en',
      mirror: 'huggingface',
      device: process.env.E2E_DEVICE || 'wasm',
      dualLine: true,
      asrModel: process.env.E2E_MODEL || 'whisper-tiny',
      engine: 'browser',
    });
    await panel.reload({ waitUntil: 'load' });

    await panel.evaluate(() => {
      document.querySelector('#mode-toggle button[data-mode="offline"]')?.click();
      document.querySelector('#task-toggle button[data-task="transcribe"]')?.click();
    });
    const offlineVisible = await panel.$eval('#off-drop', (el) => !el.classList.contains('hidden'));
    if (!offlineVisible) fail('e2e-file-mode', 'Mode Offline aktif', 'off-drop masih hidden');
    pass('e2e-file-mode', 'Mode Offline aktif', '#off-drop visible');

    const input = await panel.$('#off-file');
    if (!input) fail('e2e-file-input', 'Input #off-file', 'tidak ditemukan');
    await input.uploadFile(samplePath);
    log('uploaded', path.basename(samplePath));

    // tunggu staging selesai (nama file muncul tanpa "staging")
    await panel.waitForFunction(
      () => {
        const t = document.getElementById('off-filename')?.textContent || '';
        return t && !/staging|%/i.test(t);
      },
      { timeout: 60000 },
    );
    pass('e2e-file-staged', 'Berkas di-stage ke OPFS', await panel.$eval('#off-filename', (el) => el.textContent));

    await panel.waitForFunction(() => !document.getElementById('btn-start')?.disabled, {
      timeout: 10000,
    });
    await panel.evaluate(() => document.getElementById('btn-start').click());
    log('offline Start Task — menunggu transcribeLong…');

    await panel.waitForFunction(
      () => (document.getElementById('off-lines')?.children?.length || 0) > 0,
      { timeout: 300000, polling: 2000 },
    );
    const n = await panel.$eval('#off-lines', (el) => el.children.length);
    pass('e2e-file-lines', 'Hasil offline muncul', `${n} baris`);

    // Pastikan tombol ekspor bisa diklik (unduh/blob path tanpa folder picker)
    for (const [btn, kind] of [
      ['#btn-srt', 'srt'],
      ['#btn-vtt', 'vtt'],
      ['#btn-txt', 'txt'],
    ]) {
      await panel.evaluate((sel) => document.querySelector(sel).click(), btn);
      pass(`e2e-file-click-${kind}`, `Klik ekspor ${kind.toUpperCase()}`, btn);
    }

    log('E2E FILE PASS ✅');
  } finally {
    await browser.close();
  }
}

const t0 = Date.now();
try {
  runWiringChecks();
  if (!HARNESS_ONLY) runExportContracts();
  else pass('e2e-export-skip', 'Kontrak ekspor', 'dilewati (--harness-only)');

  if (BROWSER) {
    await runBrowserOffline();
  } else if (!HARNESS_ONLY) {
    log('mode default: kontrak ekspor + wiring (pakai --browser untuk Puppeteer offline)');
  }

  const status = checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
  writeReport({ status, durationMs: Date.now() - t0 });
  if (status === 'fail') process.exitCode = 1;
  else log('ALL OK');
} catch (err) {
  log('FAIL:', err?.message || err);
  log('cause:', err?.cause?.message || err?.cause || '(tidak ada)');
  if (!checks.some((c) => c.status === 'fail')) {
    checks.push({
      id: 'e2e-file-fatal',
      name: 'Jalankan e2e-file',
      status: 'fail',
      detail: err?.message || String(err),
    });
  }
  writeReport({
    status: 'fail',
    durationMs: Date.now() - t0,
    error: err?.message || String(err),
  });
  process.exitCode = 1;
}
