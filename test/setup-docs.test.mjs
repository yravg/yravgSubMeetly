/**
 * Dokumentasi instalasi Windows/Linux harus cocok dengan skrip yang benar-benar
 * dijalankan pengguna.
 *   node --test test/setup-docs.test.mjs
 *
 * Prosedur yang salah lebih buruk daripada tidak ada dokumentasi: pengguna
 * mengikutinya, gagal, dan menyalahkan aplikasinya. Tes ini memeriksa perintah,
 * path, dan kunci registry yang disebut SETUP.md memang ada di skripnya, dan
 * bahwa tidak ada lagi petunjuk Python/venv untuk helper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Windows tidak punya bit eksekusi di disk; bit yang dibagikan ke Mac/Linux ada di mode git (100755).
const executable = (p) => (process.platform === 'win32'
  ? execFileSync('git', ['ls-files', '-s', p], { encoding: 'utf8' }).startsWith('100755')
  : (statSync(p).mode & 0o111) !== 0);

const doc = readFileSync('native/SETUP.md', 'utf8');
const installSh = readFileSync('native/install-host.sh', 'utf8');
const installBat = readFileSync('native/install-host.bat', 'utf8');
const runSh = readFileSync('native/run.sh', 'utf8');
const runBat = readFileSync('native/run.bat', 'utf8');

test('setiap skrip yang disebut dokumen benar-benar ada dan bisa dieksekusi', () => {
  for (const f of ['run.sh', 'engine-path.sh', 'install-host.sh', 'install-host-linux.sh', 'uninstall-host.sh']) {
    assert.ok(existsSync(`native/${f}`), `native/${f} dipakai SETUP.md/skrip tapi tidak ada`);
    assert.ok(executable(`native/${f}`), `native/${f} tidak bisa dieksekusi`);
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

test('peluncur dan pemasang hanya menjalankan biner Rust, tanpa Python/venv', () => {
  for (const [nama, isi] of [['run.sh', runSh], ['run.bat', runBat], ['install-host.sh', installSh], ['install-host.bat', installBat]]) {
    assert.doesNotMatch(isi, /python|\.venv|pip install|messaging_host|server\.py/i, `${nama} masih menyebut Python`);
    assert.match(isi, /engine/i, `${nama} tidak menyebut engine`);
  }
  assert.match(runBat, /submeetly-engine\.exe/);
  assert.match(readFileSync('native/engine-path.sh', 'utf8'), /submeetly-engine/);
});

test('dokumen menunjuk ke engine Rust dan tidak menyuruh pip/venv', () => {
  assert.match(doc, /submeetly-engine/);
  assert.match(doc, /cargo build --release -p submeetly-engine/);
  assert.doesNotMatch(doc, /pip install|-m venv|\.venv|python3-venv/);
  assert.match(doc, /<EXT_ID>/, 'ID ekstensi wajib untuk manifest host');
  assert.match(doc, /belum diuji/i, 'Metal di macOS harus diberi tanda belum diuji');
  for (const gejala of ['17865', 'submeetly-engine not built']) {
    assert.ok(doc.includes(gejala), `pemecahan masalah tidak menyebut ${gejala}`);
  }
});

test('perintah verifikasi yang didokumentasikan memakai endpoint yang ada di engine', () => {
  const routes = readFileSync('engine-rs/engine/src/app.rs', 'utf8');
  for (const path of ['/health', '/engine/device', '/shutdown']) {
    assert.ok(doc.includes(path), `SETUP.md tidak menyebut ${path}`);
    assert.ok(routes.includes(`"${path}"`), `engine tidak melayani ${path}`);
  }
});
