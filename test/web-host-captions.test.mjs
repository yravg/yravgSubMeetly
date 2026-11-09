/**
 * Captions end to end in the Windows app window: real engine, real Whisper, real VAD.
 *   node --test test/web-host-captions.test.mjs
 *
 * The engine serves dist/ at /app/ and transcribes with whisper-base. A real clip
 * (test/samples/cc0/en-1.mp3) plays into the page through a stubbed getDisplayMedia,
 * so capture itself (the OS picker) is the only part not exercised.
 * Skipped without an engine binary or the cached whisper-base weights.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { engineSkip, startEngine } from './engine-bin.mjs';

const hub = process.env.HF_HOME ? join(process.env.HF_HOME, 'hub') : join(homedir(), '.cache', 'huggingface', 'hub');
const baseDir = join(hub, 'models--openai--whisper-base', 'snapshots');
const haveWeights = existsSync(baseDir) && readdirSync(baseDir).some((s) => existsSync(join(baseDir, s, 'model.safetensors')));
const skip = engineSkip || (!haveWeights && 'whisper-base weights are not in the Hugging Face cache') || (!existsSync('dist/app.html') && 'dist/ not built');

let engine; let browser;
before(async () => {
  if (skip) return;
  engine = await startEngine({ env: { WHISPER_MODEL: 'base', SUBMEETLY_APP_DIR: join(process.cwd(), 'dist') } });
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => { await browser?.close(); engine?.stop(); });

test('a spoken clip becomes a subtitle line through the engine, by default', { skip, timeout: 240_000 }, async () => {
  const mp3 = readFileSync('test/samples/cc0/en-1.mp3').toString('base64');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const engineCalls = [];
  page.on('request', (r) => { if (r.url().startsWith(engine.url) && !r.url().includes('/app/')) engineCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.evaluateOnNewDocument((b64) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      return new MediaStream([...dest.stream.getAudioTracks(), ...document.createElement('canvas').captureStream(1).getVideoTracks()]);
    };
  }, mp3);
  // Nothing is configured: the window must pick the engine it was served from.
  await page.goto(`${engine.url}/app/sidepanel.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => chrome.storage.local.set({ lastConfig: { srcLang: 'en', tgtLang: 'id', taskMode: 'transcribe' } }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => document.querySelector('#btn-start').click());
  await page.waitForFunction(() => window.__ysmWebHost.session().lines.length > 0, { timeout: 200_000, polling: 1000 });
  const line = await page.evaluate(() => window.__ysmWebHost.session().lines[0]);
  const text = String(line.src || '');
  assert.ok(text.split(/\s+/).filter(Boolean).length >= 3, `a real sentence, got: ${JSON.stringify(line)}`);
  assert.ok(engineCalls.some((c) => c.startsWith('POST /transcribe')), `engine did the ASR: ${engineCalls.join(', ')}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});
