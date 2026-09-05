/**
 * Native helper hanya boleh dijangkau dari mesin ini.
 *   node --test test/native-origin.test.mjs
 *
 * Helper menyimpan transkrip + catatan rapat dan bisa dimatikan lewat HTTP,
 * semuanya tanpa autentikasi. Dulu ia menjawab `Access-Control-Allow-Origin: *`,
 * jadi situs web mana pun yang dibuka pengguna bisa membaca isinya. Tes ini
 * menjaga batas itu tetap tertutup: CORS ketat, header Host diperiksa
 * (anti DNS rebinding), dan pengikatan non-loopback ditolak.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

const PY = existsSync('native/.venv/bin/python') ? 'native/.venv/bin/python' : 'python3';
const PORT = 17871;
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(PY, ['test/native-origin-probe.py'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    let out = '';
    const t = setTimeout(() => rej(new Error(`helper uji tidak siap: ${out}`)), 30_000);
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('READY')) {
        clearTimeout(t);
        res();
      }
    });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('exit', (c) => { clearTimeout(t); rej(new Error(`keluar lebih awal (${c}): ${out}`)); });
  });
});

after(() => proc?.kill());

const get = (headers = {}) => fetch(`${BASE}/health`, { headers });

/**
 * Permintaan HTTP mentah — fetch() melarang menyetel header Host, padahal
 * justru header itu yang harus diuji untuk DNS rebinding.
 */
function rawGet(hostHeader, path = '/health') {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf)?.[1])));
    sock.on('error', reject);
    sock.setTimeout(10_000, () => { sock.destroy(); reject(new Error('timeout')); });
  });
}

test('permintaan lokal tanpa Origin tetap dilayani (curl, app macOS, host NM)', async () => {
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'tanpa Origin tidak perlu header CORS');
});

test('situs web biasa ditolak — inti pembatasan ini', async () => {
  for (const origin of ['https://evil.example', 'http://example.com', 'https://mail.google.com']) {
    const r = await get({ Origin: origin });
    assert.equal(r.status, 403, `${origin} seharusnya ditolak`);
    assert.equal(r.headers.get('access-control-allow-origin'), null, 'jangan pernah memantulkan asal yang ditolak');
  }
});

test('preflight untuk endpoint berbahaya juga ditolak dari web', async () => {
  const r = await fetch(`${BASE}/shutdown`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.status, 403, 'tanpa ini situs web bisa mematikan helper');
});

test('ekstensi dan halaman loopback tetap diizinkan, asalnya dipantulkan tepat', async () => {
  for (const origin of ['chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'http://127.0.0.1:8799', 'http://localhost:8799']) {
    const r = await get({ Origin: origin });
    assert.equal(r.status, 200, `${origin} seharusnya boleh`);
    assert.equal(r.headers.get('access-control-allow-origin'), origin, 'pantulkan asal, bukan "*"');
    assert.equal(r.headers.get('vary'), 'Origin', 'Vary wajib supaya cache tidak mencampur asal');
  }
});

test('Origin: null (iframe sandbox / file://) ditolak', async () => {
  const r = await get({ Origin: 'null' });
  assert.equal(r.status, 403);
});

test('header Host bukan loopback ditolak — menahan DNS rebinding', async () => {
  // Situs jahat bisa mengarahkan namanya sendiri ke 127.0.0.1; permintaannya
  // lalu datang dari loopback, tapi header Host-nya membocorkan asalnya.
  for (const host of ['evil.example', `evil.example:${PORT}`, 'attacker.test']) {
    assert.equal(await rawGet(host), 403, `Host: ${host} seharusnya ditolak`);
  }
  assert.equal(await rawGet(`127.0.0.1:${PORT}`), 200);
  assert.equal(await rawGet(`localhost:${PORT}`), 200);
  assert.equal(await rawGet(`[::1]:${PORT}`), 200, 'IPv6 loopback juga sah');
});

test('mengikat alamat yang bisa dijangkau jaringan ditolak, kecuali disengaja', () => {
  const r = spawnSync(PY, ['test/native-origin-probe.py'], {
    encoding: 'utf8',
    env: { ...process.env, HOST: '0.0.0.0', PORT: '17872' },
    timeout: 60_000,
  });
  assert.equal(r.status, 2, 'harus menolak, bukan menyala di 0.0.0.0');
  assert.match(r.stderr, /bukan loopback/);
  assert.match(r.stderr, /ALLOW_REMOTE=1/, 'sebutkan jalan keluar yang disengaja');
});
