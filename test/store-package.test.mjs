/**
 * Paket Chrome Web Store (store/releases/local-transsub-<versi>.zip).
 *   node --test test/store-package.test.mjs
 *
 * Yang dijaga: zip yang diunggah benar-benar paket MV3 versi ini, berisi
 * seluruh permukaan produk (termasuk register dengan Library/Training), dan
 * tidak membawa berkas pengembangan. Dilewati bila zip belum dibuat
 * (`npm run pack:store`), supaya suite tetap jalan di mesin tanpa artefak.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifestSrc = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
// fileURLToPath, bukan .pathname: path repo ini mengandung spasi (%20 → tidak ditemukan → tes diam-diam dilewati).
const ZIP = fileURLToPath(new URL(`../store/releases/local-transsub-${pkg.version}.zip`, import.meta.url));
const hasZip = existsSync(ZIP);
const hasUnzip = spawnSync('sh', ['-c', 'command -v unzip'], { encoding: 'utf8' }).status === 0;
const skip = !hasZip ? 'zip belum dibuat (npm run pack:store)' : !hasUnzip ? 'unzip tidak ada' : false;

const list = () => spawnSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const read = (name) => spawnSync('unzip', ['-p', ZIP, name], { encoding: 'utf8' }).stdout;

test('versi zip, package.json, dan manifest sumber sejalan', { skip }, () => {
  assert.equal(manifestSrc.version, pkg.version, 'package.json dan src/manifest.json harus dinaikkan bersama');
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, pkg.version, 'zip dibuat dari dist lama — jalankan build + pack:store');
  assert.equal(m.background?.service_worker, 'background.js');
  assert.equal(m.side_panel?.default_path, 'sidepanel.html');
});

test('seluruh permukaan produk ada di paket', { skip }, () => {
  const files = new Set(list());
  for (const f of ['manifest.json', 'background.js', 'offscreen.js', 'sidepanel.html', 'sidepanel.js', 'content.js', 'minutes.html', 'minutes.js', 'ai-worker.js']) {
    assert.ok(files.has(f), `${f} hilang dari zip`);
  }
  // Register harus membawa Library + Training yang dibundel esbuild.
  const minutes = read('minutes.js');
  assert.match(minutes, /btn-library/, 'bundel minutes.js tidak memuat Library/Training');
});

test('tidak ada berkas pengembangan atau sampah di paket', { skip }, () => {
  const junk = list().filter((f) => /\.map$|\.DS_Store|^test\/|node_modules|\.env|\.log$|\.py$|\.sh$|\.bat$|\.md$/.test(f));
  assert.deepEqual(junk, [], `berkas yang tidak boleh diunggah: ${junk.join(', ')}`);
});

test('setiap izin manifest dibahas di MV3-AUDIT.md (bahan justifikasi review)', () => {
  const audit = readFileSync(new URL('../store/MV3-AUDIT.md', import.meta.url), 'utf8');
  const perms = [...manifestSrc.permissions, ...(manifestSrc.host_permissions || [])];
  const missing = perms.filter((p) => !audit.includes(p));
  assert.deepEqual(missing, [], `izin tanpa justifikasi tertulis: ${missing.join(', ')}`);
});
