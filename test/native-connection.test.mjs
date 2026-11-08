/**
 * Perintah status "Native Messaging terhubung".
 *   node --test test/native-connection.test.mjs
 *
 * Dua sisi diuji:
 *  - klasifikasi galat + nativeHostConnection() di ekstensi (chrome dipalsukan)
 *  - host Rust sungguhan (`submeetly-engine native-host`) lewat framing 4-byte,
 *    supaya kontraknya tidak bisa lepas diam-diam di satu sisi saja.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  classifyNativeHostError,
  hostInstalledFromState,
  NATIVE_HOST_ACTIONS,
  NATIVE_CONNECTION_STATES,
} from '../src/lib/native-protocol.js';
import { engineBinary, engineSkip } from './engine-bin.mjs';

test('galat Chrome dipetakan ke keadaan yang perbaikannya berbeda', () => {
  const cases = {
    'Specified native messaging host not found.': 'not-installed',
    'Native messaging host com.yraveragesubmin.helper is not registered.': 'not-installed',
    'Access to the specified native messaging host is forbidden.': 'forbidden',
    'Native host has exited.': 'crashed',
    'Failed to start native messaging host.': 'crashed',
    'Native host timed out': 'timeout',
    'Native messaging is not available in this browser': 'unsupported',
    'Error when communicating with the native messaging host.': 'error',
  };
  for (const [msg, want] of Object.entries(cases)) {
    assert.equal(classifyNativeHostError(new Error(msg)), want, msg);
    assert.ok(NATIVE_CONNECTION_STATES.includes(want));
  }
  // Tidak boleh melempar untuk masukan aneh.
  assert.equal(classifyNativeHostError(null), 'error');
  assert.equal(classifyNativeHostError(''), 'error');
  assert.equal(classifyNativeHostError({ nope: 1 }), 'error');
});

test('hostInstalled: ditolak/crash tetap berarti terpasang, bukan hilang', () => {
  assert.equal(hostInstalledFromState('connected'), true);
  assert.equal(hostInstalledFromState('forbidden'), true, 'manifest ketemu, hanya id ekstensi yang salah');
  assert.equal(hostInstalledFromState('crashed'), true, 'Chrome sempat menjalankannya');
  assert.equal(hostInstalledFromState('not-installed'), false);
  assert.equal(hostInstalledFromState('unsupported'), null);
  assert.equal(hostInstalledFromState('timeout'), null, 'jangan menebak saat tidak ada jawaban');
});

/** chrome.runtime.connectNative palsu: satu port, satu balasan. */
function fakeConnectNative(reply) {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      connectNative() {
        const msgL = [];
        const disL = [];
        const port = {
          onMessage: { addListener: (f) => msgL.push(f) },
          onDisconnect: { addListener: (f) => disL.push(f) },
          disconnect() {},
          postMessage(m) {
            queueMicrotask(() => {
              const r = reply(m);
              if (r && r.__disconnect) {
                chrome.runtime.lastError = { message: r.__disconnect };
                disL.forEach((f) => f());
              } else if (r !== undefined) {
                msgL.forEach((f) => f(r));
              }
            });
          },
        };
        return port;
      },
    },
  };
}

test('nativeHostConnection: host sehat → connected + info host', async () => {
  const seen = [];
  fakeConnectNative((m) => {
    seen.push(m);
    return { ok: true, connected: true, host: { host: 'com.yraveragesubmin.helper', protocol: 1 }, helper_port_open: true };
  });
  const { nativeHostConnection } = await import('../src/lib/native-host.js');
  const r = await nativeHostConnection();
  assert.deepEqual(seen, [{ action: 'ping' }], 'harus memakai ping, bukan start yang mahal');
  assert.equal(r.state, 'connected');
  assert.equal(r.connected, true);
  assert.equal(r.hostInstalled, true);
  assert.equal(r.helperPortOpen, true);
  assert.equal(r.info.protocol, 1);
});

test('nativeHostConnection: host belum dipasang / ditolak → keadaan spesifik, tanpa melempar', async () => {
  const { nativeHostConnection } = await import('../src/lib/native-host.js');

  fakeConnectNative(() => ({ __disconnect: 'Specified native messaging host not found.' }));
  const miss = await nativeHostConnection();
  assert.equal(miss.state, 'not-installed');
  assert.equal(miss.hostInstalled, false);
  assert.equal(miss.connected, false);
  assert.match(miss.error, /not found/);

  fakeConnectNative(() => ({ __disconnect: 'Access to the specified native messaging host is forbidden.' }));
  const forb = await nativeHostConnection();
  assert.equal(forb.state, 'forbidden');
  assert.equal(forb.hostInstalled, true);
});

test('nativeHostConnection: browser tanpa connectNative → unsupported, tidak mencoba menyambung', async () => {
  globalThis.chrome = { runtime: {} };
  const { nativeHostConnection } = await import('../src/lib/native-host.js');
  const r = await nativeHostConnection();
  assert.equal(r.state, 'unsupported');
  assert.equal(r.hostInstalled, null);
});

test('host lama yang belum kenal ping tetap dihitung terhubung', async () => {
  fakeConnectNative(() => ({ ok: false, error: 'unknown action: ping' }));
  const { nativeHostConnection } = await import('../src/lib/native-host.js');
  const r = await nativeHostConnection();
  assert.equal(r.state, 'connected', 'jawaban apa pun membuktikan bridge hidup');
  assert.equal(r.hostInstalled, true);
  assert.match(r.error, /host lama/);
});

/* -------------------------------------------------------------------------
 * Host Rust sungguhan: bicara framing Native Messaging yang sebenarnya.
 */

function talkToHost(messages) {
  const chunks = messages.map((m) => {
    const b = Buffer.from(JSON.stringify(m), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  });
  const r = spawnSync(engineBinary(), ['native-host'], {
    input: Buffer.concat(chunks),
    timeout: 20_000,
    // Port tak terpakai: tes ini tidak boleh bergantung pada helper pemilik.
    env: { ...process.env, PORT: '9' },
  });
  assert.equal(r.error, undefined, String(r.error));
  const out = [];
  let buf = r.stdout;
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    out.push(JSON.parse(buf.subarray(4, 4 + n).toString('utf8')));
    buf = buf.subarray(4 + n);
  }
  return out;
}

test('host Rust menjawab ping dengan identitas dirinya', { skip: engineSkip }, () => {
  const [ping] = talkToHost([{ action: 'ping' }]);
  assert.equal(ping.ok, true);
  assert.equal(ping.connected, true);
  assert.equal(ping.host.host, 'com.yraveragesubmin.helper');
  assert.equal(typeof ping.host.protocol, 'number');
  assert.equal(typeof ping.host.rust, 'string');
  assert.equal(typeof ping.helper_port_open, 'boolean');
});

test('ping tidak menunggu helper, dan status tetap membawa health', { skip: engineSkip }, () => {
  const [ping, status] = talkToHost([{ action: 'ping' }, { action: 'status' }]);
  assert.equal(ping.ok, true);
  assert.ok(!('health' in ping), 'ping harus murah — jangan panggil /health');
  // status tetap kompatibel ke belakang, plus identitas host.
  assert.equal(status.ok, true);
  assert.equal(typeof status.running, 'boolean');
  assert.ok('health' in status);
  assert.equal(status.connected, true);
  assert.equal(status.host.host, 'com.yraveragesubmin.helper');
});

test('aksi tak dikenal ditolak jelas, dan ping terdaftar di kontrak', { skip: engineSkip }, () => {
  const [r] = talkToHost([{ action: 'tidak-ada' }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown action/);
  assert.ok(NATIVE_HOST_ACTIONS.includes('ping'), 'kontrak ekstensi harus menyebut ping');
});
