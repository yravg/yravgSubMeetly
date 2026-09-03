#!/usr/bin/env node
/**
 * Capture store listing screenshots from the lab panel harness.
 * Requires: dist/ built, lab on LAB_URL (default http://127.0.0.1:8765).
 *
 *   node scripts/capture-store-screens.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'store', 'screenshots');
const LAB = process.env.LAB_URL || 'http://127.0.0.1:8799';

async function waitForLab(url, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url + '/');
      if (r.ok || r.status === 404) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function ensureLab() {
  if (await waitForLab(LAB, 2000)) return null;
  const child = spawn('python3', [path.join(ROOT, 'scripts/lab-server.py')], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const ok = await waitForLab(LAB, 20000);
  if (!ok) throw new Error('lab server did not start on ' + LAB);
  return child;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await ensureLab();

  const puppeteer = await import('puppeteer');
  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--window-size=1280,800', '--disable-dev-shm-usage'],
  };
  const exe =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].find((p) => fs.existsSync(p));
  if (exe) launchOpts.executablePath = exe;
  const browser = await puppeteer.default.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.goto(`${LAB}/panel-test.html`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.brand, .topbar', { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const panelPath = path.join(OUT, '01-sidepanel-realtime.png');
  await page.screenshot({ path: panelPath, fullPage: false });
  console.log('Wrote', path.relative(ROOT, panelPath));

  await page.goto(`${LAB}/studio.html`, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  const studioPath = path.join(OUT, '02-offline-studio.png');
  await page.screenshot({ path: studioPath, fullPage: false });
  console.log('Wrote', path.relative(ROOT, studioPath));

  await page.goto(`${LAB}/notes-panel.html`, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800));
  const notesPath = path.join(OUT, '03-notes-helper.png');
  await page.screenshot({ path: notesPath, fullPage: false });
  console.log('Wrote', path.relative(ROOT, notesPath));

  await browser.close();
  console.log('Store screenshots ready under store/screenshots/');
  // Chrome sometimes keeps the Node process alive after close.
  setTimeout(() => process.exit(0), 250);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
