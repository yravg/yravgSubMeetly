/**
 * Migrasi saat produk berganti nama menjadi yraverageSubMin.
 *   node --test test/rename-migration.test.mjs
 *
 * Yang dijaga di sini bukan tulisannya, melainkan datanya: kunci localStorage
 * berawalan `lts`, direktori state helper `~/.localtranssub` (berisi notulen
 * pengguna), dan host Native Messaging yang sudah telanjur terpasang dengan
 * nama lama. Ketiganya gagal DIAM-DIAM kalau migrasinya rusak — pengguna cuma
 * melihat pengaturannya kembali ke awal — jadi ketiganya diuji terpisah.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrateLegacyLocalKeys, LEGACY_LOCAL_KEYS } from '../src/lib/legacy-keys.js';

/** localStorage tiruan yang cukup untuk migrasi. */
function fakeStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()].sort(),
    map,
  };
}

test('kunci lts lama dipindah ke ysm, lalu kunci lamanya dibuang', () => {
  const s = fakeStore({ ltsMinutesLayout: '{"density":"compact"}', ltsGlossary: '["ISO"]', lain: 'utuh' });
  const moved = migrateLegacyLocalKeys(s);

  assert.deepEqual(moved.sort(), ['ysmGlossary', 'ysmMinutesLayout']);
  assert.equal(s.getItem('ysmMinutesLayout'), '{"density":"compact"}', 'nilai tata letak hilang saat dipindah');
  assert.equal(s.getItem('ysmGlossary'), '["ISO"]');
  assert.equal(s.getItem('ltsMinutesLayout'), null, 'kunci lama harus dibuang setelah dipindah');
  assert.equal(s.getItem('lain'), 'utuh', 'kunci di luar daftar tidak boleh disentuh');
});

test('nilai baru yang sudah ada tidak ditimpa nilai lama', () => {
  // Pengguna sempat memakai versi baru di perangkat ini; sisa kunci lama
  // tidak boleh memundurkan pengaturannya.
  const s = fakeStore({ ltsMinutesLang: 'en', ysmMinutesLang: 'id' });
  const moved = migrateLegacyLocalKeys(s);

  assert.deepEqual(moved, [], 'tidak ada yang perlu dipindah');
  assert.equal(s.getItem('ysmMinutesLang'), 'id', 'nilai baru tertimpa nilai lama');
  assert.equal(s.getItem('ltsMinutesLang'), null, 'kunci lama tetap harus dibersihkan');
});

test('migrasi idempoten dan tahan storage yang melempar', () => {
  const s = fakeStore({ ltsMinutesMe: 'Rina' });
  migrateLegacyLocalKeys(s);
  const after = s.keys();
  migrateLegacyLocalKeys(s);
  assert.deepEqual(s.keys(), after, 'pemanggilan kedua mengubah keadaan');

  const galak = {
    getItem: () => { throw new Error('storage diblokir'); },
    setItem: () => {}, removeItem: () => {},
  };
  assert.deepEqual(migrateLegacyLocalKeys(galak), [], 'storage yang melempar tidak boleh menggagalkan boot');
  assert.deepEqual(migrateLegacyLocalKeys(null), [], 'tanpa storage sama sekali pun harus aman');
});

test('daftar kunci lama mencakup seluruh kunci yang benar-benar bertahan di disk', () => {
  // Kalau ada kunci `lts` baru ditambahkan tanpa masuk peta ini, datanya akan
  // menguap tanpa suara pada rilis berikutnya.
  const src = ['src/minutes.js', 'src/minutes-dock.js', 'src/sidepanel.js', 'test/app.html']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const tersisa = [...new Set(src.match(/\blts[A-Z][A-Za-z]*/g) || [])];
  assert.deepEqual(tersisa, [], `kunci lts masih dipakai di sumber: ${tersisa.join(', ')}`);
  assert.ok(Object.keys(LEGACY_LOCAL_KEYS).length >= 6);
});

test('direktori state helper ~/.localtranssub dipindah beserta isinya', () => {
  const home = mkdtempSync(join(tmpdir(), 'ysm-home-'));
  const lama = join(home, '.localtranssub');
  mkdirSync(lama);
  writeFileSync(join(lama, 'notes.json'), '{"notes":[{"id":"rapat-1"}]}');
  writeFileSync(join(lama, 'device.json'), '{"device":"mlx"}');

  // server.py menjalankan migrasi saat impor, sebelum dependensi berat dimuat;
  // impornya boleh gagal di numpy — yang diuji efeknya pada berkas.
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('python3', ['-c',
    'import sys\nsys.path.insert(0, "native")\ntry:\n    import server\nexcept Exception:\n    pass\n'],
    { cwd: root, env: { ...process.env, HOME: home } });

  const baru = join(home, '.yraveragesubmin');
  assert.ok(existsSync(baru), 'direktori baru tidak terbentuk');
  assert.equal(existsSync(lama), false, 'direktori lama harus dipindah, bukan disalin');
  assert.deepEqual(readdirSync(baru).sort(), ['device.json', 'notes.json']);
  assert.equal(readFileSync(join(baru, 'notes.json'), 'utf8'), '{"notes":[{"id":"rapat-1"}]}',
    'isi notulen berubah saat dipindah');
});

test('direktori baru yang sudah ada tidak ditimpa direktori lama', () => {
  const home = mkdtempSync(join(tmpdir(), 'ysm-home-'));
  mkdirSync(join(home, '.localtranssub'));
  writeFileSync(join(home, '.localtranssub', 'notes.json'), '{"lama":true}');
  mkdirSync(join(home, '.yraveragesubmin'));
  writeFileSync(join(home, '.yraveragesubmin', 'notes.json'), '{"baru":true}');

  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('python3', ['-c',
    'import sys\nsys.path.insert(0, "native")\ntry:\n    import server\nexcept Exception:\n    pass\n'],
    { cwd: root, env: { ...process.env, HOME: home } });

  assert.equal(readFileSync(join(home, '.yraveragesubmin', 'notes.json'), 'utf8'), '{"baru":true}',
    'notulen yang lebih baru tertimpa yang lama');
});

/** Stub chrome.runtime.connectNative: host mana yang menjawab, sisanya galat. */
function stubChrome(hostYangHidup, galat = 'Specified native messaging host not found.') {
  const dicoba = [];
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      connectNative(name) {
        dicoba.push(name);
        const port = {
          onMessage: { listeners: [], addListener(f) { this.listeners.push(f); } },
          onDisconnect: { listeners: [], addListener(f) { this.listeners.push(f); } },
          disconnect() {},
          postMessage() {
            queueMicrotask(() => {
              if (name === hostYangHidup) {
                port.onMessage.listeners.forEach((f) => f({ ok: true, host: { name } }));
              } else {
                globalThis.chrome.runtime.lastError = { message: galat };
                port.onDisconnect.listeners.forEach((f) => f());
                globalThis.chrome.runtime.lastError = undefined;
              }
            });
          },
        };
        return port;
      },
    },
  };
  return dicoba;
}

test('host Native Messaging: nama baru dicoba dulu, lalu mundur ke nama lama', async () => {
  const mod = await import(`../src/lib/native-host.js?fallback=${Date.now()}`);
  const dicoba = stubChrome(mod.LEGACY_NATIVE_HOST_NAME);

  const res = await mod.nativeHostAction('ping', { timeoutMs: 2000 });
  assert.equal(res.ok, true);
  assert.deepEqual(dicoba, [mod.NATIVE_HOST_NAME, mod.LEGACY_NATIVE_HOST_NAME],
    'urutan percobaan salah — nama baru harus didahulukan');
  assert.equal(mod.activeNativeHostName(), mod.LEGACY_NATIVE_HOST_NAME);

  // Setelah satu nama terbukti hidup, percobaan ganda tidak diulang.
  dicoba.length = 0;
  await mod.nativeHostAction('ping', { timeoutMs: 2000 });
  assert.deepEqual(dicoba, [mod.LEGACY_NATIVE_HOST_NAME], 'host yang sudah terbukti harus diingat');
});

test('galat selain "host tidak ditemukan" tidak boleh memicu percobaan nama lain', async () => {
  const mod = await import(`../src/lib/native-host.js?forbidden=${Date.now()}`);
  // Tidak ada host yang hidup, dan galatnya "forbidden" — artinya manifestnya
  // ADA tapi allowed_origins-nya salah. Mencoba nama lain hanya akan menutupi
  // galat sebenarnya dari pengguna.
  const dicoba = stubChrome(null, 'Access to the specified native messaging host is forbidden.');

  await assert.rejects(mod.nativeHostAction('ping', { timeoutMs: 2000 }), /forbidden/i);
  assert.deepEqual(dicoba, [mod.NATIVE_HOST_NAME], 'seharusnya berhenti di percobaan pertama');
  assert.equal(mod.activeNativeHostName(), null);
});
