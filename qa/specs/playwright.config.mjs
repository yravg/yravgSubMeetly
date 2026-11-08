import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// Absolute, forward-slash path: Windows paths with spaces break the reporter option.
const reporter = path.join(os.homedir(), '.yraverage', 'qa', 'qa-reporter.mjs').replace(/\\/g, '/');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH;

export default defineConfig({
  testDir: here,
  testMatch: '*.spec.mjs',
  outputDir: path.join(root, 'qa', '.pw-output'),
  globalSetup: path.join(here, 'global-setup.mjs'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], [reporter, { qaDir: path.join(root, 'qa').replace(/\\/g, '/') }]],
  use: {
    screenshot: 'on',
    video: 'on',
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
});
