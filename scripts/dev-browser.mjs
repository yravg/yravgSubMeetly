// Launch Chrome with the unpacked extension for manual testing / DevTools inspect.
// Opens the side panel page and a sample tab you can caption.
import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(root, 'dist');
const PROFILE = path.join(root, '.dev-profile');
const PORT = 8799;

function startTestServer() {
  const testDir = path.join(root, 'test');
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const rel = req.url === '/' ? '/audio-page.html' : req.url.split('?')[0];
      const file = path.join(testDir, rel.replace(/^\//, ''));
      try {
        const body = readFileSync(file);
        const ext = path.extname(file);
        const type =
          ext === '.html'
            ? 'text/html'
            : ext === '.js'
              ? 'text/javascript'
              : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[dev-browser] test server http://127.0.0.1:${PORT}/audio-page.html`);
      resolve(server);
    });
  });
}

const server = await startTestServer();

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  devtools: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
  ],
});

const swTarget = await browser.waitForTarget(
  (t) => t.type() === 'service_worker' && t.url().includes('background.js'),
  { timeout: 20000 },
);
const extId = new URL(swTarget.url()).host;
console.log('[dev-browser] extension id:', extId);
console.log('[dev-browser] side panel: chrome-extension://' + extId + '/sidepanel.html');
console.log('[dev-browser] Press Ctrl+C to close Chrome.');

const audioPage = await browser.newPage();
await audioPage.goto(`http://127.0.0.1:${PORT}/audio-page.html`, { waitUntil: 'load' });

const panel = await browser.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: 'load' });
await panel.bringToFront();

process.on('SIGINT', async () => {
  await browser.close().catch(() => {});
  server.close();
  process.exit(0);
});

await new Promise(() => {});
