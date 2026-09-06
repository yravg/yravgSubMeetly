// Pemasang Native Messaging Host tidak bisa dijalankan di CI macOS/Linux,
// tapi isinya bisa diperiksa: bentuk manifest, nama host, target registry,
// dan — yang paling penting — bahwa Windows menunjuk ke pembungkus yang bisa
// dieksekusi, bukan langsung ke berkas .py (Chrome tidak bisa menjalankan .py).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { NATIVE_HOST_NAME } from '../src/lib/native-host.js';

const bat = readFileSync(new URL('../native/install-host.bat', import.meta.url), 'utf8');
const sh = readFileSync(new URL('../native/install-host.sh', import.meta.url), 'utf8');

test('Linux mendaftarkan Chrome, Chromium, Edge, dan varian Flatpak', () => {
  for (const dir of [
    '.config/google-chrome/NativeMessagingHosts',
    '.config/chromium/NativeMessagingHosts',
    '.config/microsoft-edge/NativeMessagingHosts',
  ]) {
    assert.ok(sh.includes(dir), `direktori Linux hilang: ${dir}`);
  }
  assert.match(sh, /\.var\/app\/com\.google\.Chrome/, 'Flatpak Chrome');
  assert.match(sh, /\.var\/app\/com\.microsoft\.Edge/, 'Flatpak Edge');
});

test('Linux memakai .py langsung (punya shebang), bukan pembungkus', () => {
  const host = readFileSync(new URL('../native/messaging_host.py', import.meta.url), 'utf8');
  assert.match(host.split('\n')[0], /^#!.*python3/, 'shebang wajib agar bisa dieksekusi');
  assert.match(sh, /chmod \+x/, 'bit executable harus dipasang');
});

/** Rekonstruksi JSON dari blok `echo` di dalam .bat. */
function manifestFromBat(source, { extId, wrapper }) {
  const start = source.indexOf('> "%MANIFEST%" (');
  // Ambil HANYA blok itu: berhenti di ')' penutup, kalau tidak baris echo
  // sesudahnya (pesan ke layar) ikut terbaca sebagai JSON.
  const end = source.indexOf('\n)', start);
  const body = source.slice(start, end);
  const lines = [...body.matchAll(/^\s*echo (.*)$/gm)].map((m) => m[1]);
  const json = lines
    .join('\n')
    .replace(/\^/g, '')
    .replace(/%WRAPPER_JSON%/g, wrapper.replace(/\\/g, '\\\\'))
    .replace(/%EXT_ID%/g, extId);
  return JSON.parse(json);
}

test('manifest Windows valid dan cocok dengan nama host yang dipakai ekstensi', () => {
  const m = manifestFromBat(bat, { extId: 'abcdefghijklmnop', wrapper: 'C:\\app\\messaging_host.bat' });
  assert.equal(m.name, NATIVE_HOST_NAME, 'nama host harus sama dengan konstanta ekstensi');
  assert.equal(m.type, 'stdio');
  assert.deepEqual(m.allowed_origins, ['chrome-extension://abcdefghijklmnop/']);
});

test('Windows menunjuk ke pembungkus .bat, bukan .py', () => {
  const m = manifestFromBat(bat, { extId: 'x', wrapper: 'C:\\app\\messaging_host.bat' });
  assert.ok(m.path.endsWith('.bat'), `path harus .bat, dapat ${m.path}`);
  assert.ok(!m.path.endsWith('.py'), 'Chrome tidak bisa mengeksekusi .py sebagai host');
  assert.match(bat, /messaging_host\.bat/, 'pembungkus harus dibuat oleh skrip');
});

test('registry didaftarkan untuk Chrome, Edge, dan Chromium', () => {
  for (const hive of [
    'Software\\Google\\Chrome\\NativeMessagingHosts',
    'Software\\Microsoft\\Edge\\NativeMessagingHosts',
    'Software\\Chromium\\NativeMessagingHosts',
  ]) {
    assert.ok(bat.includes(hive), `registry hilang: ${hive}`);
  }
});

test('skrip Windows memeriksa Python dan argumen extension id', () => {
  assert.match(bat, /where py |where python/, 'harus mencari Python');
  assert.match(bat, /Usage: install-host\.bat/, 'harus menolak pemakaian tanpa extension id');
});

test('nama host konsisten antara pemasang Windows dan POSIX', () => {
  assert.ok(sh.includes(NATIVE_HOST_NAME), 'pemasang shell memakai nama host yang sama');
  assert.ok(bat.includes(NATIVE_HOST_NAME), 'pemasang Windows memakai nama host yang sama');
});
