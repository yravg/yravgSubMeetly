#!/usr/bin/env node
/**
 * Buat paket ZIP produksi untuk Chrome Web Store dari folder dist/.
 *
 * Output kanonis (identik):
 *   store/releases/yraverage-submin-<version>.zip  ← unggah ke dashboard
 *   store/yraverage-submin-<version>.zip           ← salinan ringkas di root store/
 *
 * Versi diambil dari src/manifest.json dan harus cocok dengan package.json.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripKey } from './store-manifest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const storeDir = join(root, 'store');
const releasesDir = join(storeDir, 'releases');

const manifest = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = manifest.version || '0.0.0';

if (pkg.version !== version) {
  console.error(
    `Version mismatch: package.json=${pkg.version} vs src/manifest.json=${version}`,
  );
  process.exit(1);
}

if (!existsSync(dist)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

const required = [
  'manifest.json',
  'background.js',
  'sidepanel.js',
  'sidepanel.html',
  'sidepanel.css',
  'notes-panel.css',
  'content.js',
  'offscreen.js',
  'offscreen.html',
  'ai-worker.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];
const missing = required.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.error('dist/ incomplete — missing:', missing.join(', '));
  process.exit(1);
}

const distManifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
if (distManifest.version !== version) {
  console.error(`dist/manifest.json version ${distManifest.version} ≠ ${version}`);
  process.exit(1);
}

mkdirSync(releasesDir, { recursive: true });
const releaseZip = join(releasesDir, `yraverage-submin-${version}.zip`);
const rootZip = join(storeDir, `yraverage-submin-${version}.zip`);

rmSync(releaseZip, { force: true });
rmSync(rootZip, { force: true });

// Zip a staged copy: the store assigns its own ID, so the manifest loses "key".
const stage = join(storeDir, '.stage');
rmSync(stage, { recursive: true, force: true });
cpSync(dist, stage, { recursive: true });
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(stripKey(distManifest), null, 2) + '\n');
const r = spawnSync('zip', ['-r', '-q', releaseZip, '.', '-x', '*.map'], {
  cwd: stage,
  encoding: 'utf8',
});
if (r.status !== 0) {
  rmSync(stage, { recursive: true, force: true });
  console.error(r.stderr || 'zip failed');
  process.exit(r.status || 1);
}
rmSync(stage, { recursive: true, force: true });
copyFileSync(releaseZip, rootZip);

const bytes = statSync(releaseZip).size;
console.log(`Wrote ${relative(root, releaseZip)} (${bytes} bytes)`);
console.log(`Wrote ${relative(root, rootZip)} (copy)`);
console.log(`Upload: ${relative(root, releaseZip)}`);
