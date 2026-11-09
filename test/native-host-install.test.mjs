// Pemasang Native Messaging Host tidak bisa dijalankan di CI macOS/Linux,
// tapi isinya bisa diperiksa: bentuk manifest, nama host, target registry,
// dan — yang terpenting — bahwa manifest menunjuk langsung ke biner Rust
// (submeetly-engine), bukan ke skrip Python atau pembungkus .bat.
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

test('pemasang POSIX menunjuk ke biner Rust lewat engine-path.sh, tanpa Python', () => {
  assert.match(sh, /engine-path\.sh/, 'lokasi biner harus lewat engine-path.sh');
  assert.doesNotMatch(sh, /python|messaging_host|\.venv/i);
});

/** Rekonstruksi JSON dari blok `echo` di dalam .bat. */
function manifestFromBat(source, { extId, engine }) {
  const start = source.indexOf('> "%MANIFEST%" (');
  // Ambil HANYA blok itu: berhenti di ')' penutup, kalau tidak baris echo
  // sesudahnya (pesan ke layar) ikut terbaca sebagai JSON.
  const end = source.indexOf('\n)', start);
  const body = source.slice(start, end);
  const lines = [...body.matchAll(/^\s*echo (.*)$/gm)].map((m) => m[1].replace(/\r$/, ''));
  const json = lines
    .join('\n')
    .replace(/\^/g, '')
    .replace(/%ENGINE_JSON%/g, engine.replace(/\\/g, '\\\\'))
    .replace(/%EXT_ID%/g, extId);
  return JSON.parse(json);
}

test('manifest Windows valid dan cocok dengan nama host yang dipakai ekstensi', () => {
  const m = manifestFromBat(bat, { extId: 'abcdefghijklmnop', engine: 'C:\\app\\submeetly-engine.exe' });
  assert.equal(m.name, NATIVE_HOST_NAME, 'nama host harus sama dengan konstanta ekstensi');
  assert.equal(m.type, 'stdio');
  assert.deepEqual(m.allowed_origins, ['chrome-extension://abcdefghijklmnop/']);
});

test('Windows menunjuk langsung ke submeetly-engine.exe, bukan .py atau pembungkus', () => {
  const m = manifestFromBat(bat, { extId: 'x', engine: 'C:\\app\\submeetly-engine.exe' });
  assert.ok(m.path.endsWith('submeetly-engine.exe'), `path harus biner engine, dapat ${m.path}`);
  assert.doesNotMatch(bat, /python|messaging_host|\.venv/i);
  // Backslash di JSON harus digandakan, kalau tidak Chrome menolak manifest.
  assert.ok(bat.includes('set "ENGINE_JSON=%ENGINE:\\=\\\\%"'),'ENGINE_JSON harus menggandakan backslash');
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

test('skrip Windows mencari engine dan menolak pemakaian tanpa extension id', () => {
  assert.match(bat, /submeetly-engine\.exe/, 'harus mencari engine');
  assert.match(bat, /Usage: install-host\.bat/, 'harus menolak pemakaian tanpa extension id');
});

test('nama host konsisten antara pemasang Windows dan POSIX', () => {
  assert.ok(sh.includes(NATIVE_HOST_NAME), 'pemasang shell memakai nama host yang sama');
  assert.ok(bat.includes(NATIVE_HOST_NAME), 'pemasang Windows memakai nama host yang sama');
});
