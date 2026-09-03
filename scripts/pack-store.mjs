#!/usr/bin/env node
/**
 * Buat paket ZIP produksi untuk Chrome Web Store dari folder dist/.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const storeDir = join(root, 'store');
const manifest = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));
const version = manifest.version || '0.0.0';
const outZip = join(storeDir, `local-transsub-${version}.zip`);

if (!existsSync(dist)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}
mkdirSync(storeDir, { recursive: true });

const r = spawnSync('zip', ['-r', '-q', outZip, '.'], { cwd: dist, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || 'zip failed');
  process.exit(r.status || 1);
}
console.log(`Wrote ${outZip}`);
