/**
 * Dokumentasi instalasi Windows/Linux harus cocok dengan skrip yang benar-benar
 * dijalankan pengguna.
 *   node --test test/setup-docs.test.mjs
 *
 * Prosedur yang salah lebih buruk daripada tidak ada dokumentasi: pengguna
 * mengikutinya, gagal, dan menyalahkan aplikasinya. Tes ini memeriksa perintah,
 * path, dan kunci registry yang disebut SETUP.md memang ada di skripnya.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const doc = readFileSync('native/SETUP.md', 'utf8');
const runSh = readFileSync('native/run.sh', 'utf8');
const runBat = readFileSync('native/run.bat', 'utf8');
const installSh = readFileSync('native/install-host.sh', 'utf8');
const installBat = readFileSync('native/install-host.bat', 'utf8');

test('setiap skrip yang disebut dokumen benar-benar ada dan bisa dieksekusi', () => {
  for (const f of ['run.sh', 'install-host.sh', 'install-host-linux.sh', 'uninstall-host.sh']) {
    assert.ok(existsSync(`native/${f}`), `native/${f} disebut SETUP.md tapi tidak ada`);
    assert.ok(statSync(`native/${f}`).mode & 0o111, `native/${f} tidak bisa dieksekusi`);
  }
  for (const f of ['run.bat', 'install-host.bat', 'uninstall-host.bat']) {
    assert.ok(existsSync(`native/${f}`), `native/${f} disebut SETUP.md tapi tidak ada`);
  }
});

test('path manifest Linux yang didokumentasikan memang ditulis installer', () => {
  for (const dir of ['.config/google-chrome', '.config/chromium', '.config/microsoft-edge', '.var/app/com.google.Chrome']) {
    assert.ok(doc.includes(dir), `SETUP.md tidak menyebut ${dir}`);
    assert.ok(installSh.includes(dir), `install-host.sh tidak menulis ke ${dir}`);
  }
});

test('kunci registry Windows yang didokumentasikan memang didaftarkan', () => {
  for (const key of [
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
    'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
    'HKCU\\Software\\Chromium\\NativeMessagingHosts',
  ]) {
    assert.ok(doc.includes(key), `SETUP.md tidak menyebut ${key}`);
    assert.ok(installBat.includes(key), `install-host.bat tidak mendaftarkan ${key}`);
  }
  assert.ok(installBat.includes('yraverageSubMin'), 'lokasi manifest berbeda dari yang didokumentasikan');
});

test('model MLX tidak pernah dipaksakan ke faster-whisper (Windows/Linux)', () => {
  // Bobot MLX khusus Apple; CTranslate2 tidak bisa memuatnya, jadi helper mati
  // saat start. run.sh dulu mengekspornya di semua OS.
  const mlxExports = runSh.match(/^\s*export (WHISPER_MODEL|DRAFT_WHISPER_MODEL|TRANSLATE_MODEL)=.*mlx-community/gm) || [];
  assert.ok(mlxExports.length > 0, 'default macOS seharusnya masih ada');
  const guarded = /if \$IS_MAC_ARM; then[\s\S]*?mlx-community[\s\S]*?\nfi/.test(runSh);
  assert.ok(guarded, 'default mlx-community harus dipagari cabang Apple Silicon');
  // Boleh menyebutnya di komentar penjelas; yang dilarang adalah MENYETELNYA.
  assert.doesNotMatch(runBat, /^\s*set\s+"?WHISPER_MODEL=.*mlx-community/im,
    'peluncur Windows tidak boleh menyetel model MLX');
});

test('peluncur menangani tata letak venv kedua OS', () => {
  assert.match(runSh, /\.venv\/bin\/python/, 'POSIX');
  assert.match(runSh, /\.venv\/Scripts\/python\.exe/, 'Git Bash di Windows memakai Scripts/');
  assert.match(runBat, /\.venv\\Scripts\\python\.exe/);
  // Stub Microsoft Store bernama python.exe menyesatkan; `py -3` lebih dipercaya.
  assert.match(runBat, /where py /, 'run.bat harus mencoba peluncur py lebih dulu');
});

test('dokumen menyebut prasyarat yang benar-benar menentukan berhasil/gagal', () => {
  assert.match(doc, /ffmpeg/i, 'ffmpeg menentukan transkripsi berkas');
  assert.match(doc, /python3-venv|Add python\.exe to PATH/i);
  assert.match(doc, /<EXT_ID>/, 'ID ekstensi wajib untuk manifest host');
  // Bagian pemecahan masalah harus menutup kegagalan yang benar-benar terjadi.
  for (const gejala of ['python: not found', 'ffmpeg', '17865']) {
    assert.ok(doc.includes(gejala), `pemecahan masalah tidak menyebut ${gejala}`);
  }
});

test('perintah verifikasi yang didokumentasikan memakai endpoint yang ada', () => {
  const server = readFileSync('native/server.py', 'utf8');
  for (const path of ['/health', '/engine/device']) {
    assert.ok(doc.includes(path), `SETUP.md tidak menyebut ${path}`);
    assert.ok(server.includes(`"${path}"`), `server.py tidak melayani ${path}`);
  }
});
