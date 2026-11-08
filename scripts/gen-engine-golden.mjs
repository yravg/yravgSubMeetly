#!/usr/bin/env node
/**
 * Capture the engine HTTP contract as goldens from the Python oracle.
 *
 *   node scripts/gen-engine-golden.mjs            # writes engine-rs/golden/*.json
 *   node scripts/gen-engine-golden.mjs --python C:\py\python.exe
 *
 * The Python helper refuses to start without an ASR engine and would download
 * a Whisper model on import. This harness injects stub `faster_whisper` and
 * `ctranslate2` modules (bootstrap below) so the process starts instantly and
 * no ML route is ever exercised. Only non-ML routes are captured; the Rust
 * engine answers the ML routes with 501 by design, so those are not goldens.
 *
 * Every golden is request + oracle status + oracle JSON body + the response
 * fields that legitimately vary (masked on both sides when replayed).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const GOLDEN_DIR = path.join(ROOT, 'engine-rs', 'golden');
const argPython = process.argv.indexOf('--python');
const PYTHON =
  (argPython > -1 && process.argv[argPython + 1]) ||
  process.env.PYTHON ||
  (process.platform === 'win32' ? 'python' : 'python3');

const BOOTSTRAP = `
import os, runpy, sys, types

fw = types.ModuleType("faster_whisper")
class WhisperModel:
    def __init__(self, *args, **kwargs):
        pass
    def transcribe(self, *args, **kwargs):
        raise RuntimeError("stubbed ASR engine: ML routes are not part of the goldens")
fw.WhisperModel = WhisperModel
sys.modules["faster_whisper"] = fw

ct2 = types.ModuleType("ctranslate2")
ct2.get_cuda_device_count = lambda: 0
sys.modules["ctranslate2"] = ct2

sys.argv = [os.environ["YSM_SERVER"]]
runpy.run_path(os.environ["YSM_SERVER"], run_name="__main__")
`;

const HEALTH_MASK = [
  'engine',
  'engine_label',
  'model',
  'ffmpeg',
  'translate_model',
  'draft_model',
  'device',
  'compute',
  'platform',
  'features.fast_translate',
  'features.translate_refine',
  'features.draft',
  'features.transcribe_file_jobs',
  'features.streaming_file_jobs',
  'features.faster_whisper',
  'features.models',
];
const DEVICE_MASK = ['active', 'compute'];
const LANGUAGES_MASK = ['engine'];

const requests = [];

function req(method, reqPath, { json, body, headers = {}, mask = [], name } = {}) {
  const h = { ...headers };
  let rawBody = null;
  if (json !== undefined) {
    rawBody = JSON.stringify(json);
    h['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    rawBody = body;
    h['Content-Type'] = h['Content-Type'] || 'application/json';
  }
  requests.push({
    name: name || `${method} ${reqPath}`,
    request: { method, path: reqPath, headers: h, body: rawBody },
    mask,
  });
}
const get = (p, o = {}) => req('GET', p, o);
const post = (p, json, o = {}) => req('POST', p, { ...o, json });
const postBody = (p, body, o = {}) => req('POST', p, { ...o, body });
const del = (p, o = {}) => req('DELETE', p, o);
function raw(method, p, { host, origin, body, mask = [], name } = {}) {
  const headers = { Host: host };
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  requests.push({
    name: name || `${method} ${p} (Host: ${host})`,
    request: { method, path: p, headers, body: body ?? null },
    mask,
  });
}

// ---------------------------------------------------------------- fixed docs
const NOTE_A = {
  note: {
    id: 'golden-note-1',
    title: 'Rapat Mingguan — Proyek Alpha',
    date: '2026-11-08',
    source: 'extension',
    status: 'issued',
    generatedAt: '2026-11-08T09:30:00Z',
    summary: 'Ringkasan rapat: keputusan utama dan tindak lanjut.',
    decisions: ['Setujui jadwal baru', '  Tunda rilis beta  ', 5, null, '   '],
    actions: [
      { id: 'act-1', text: 'Kirim jadwal ke tim', owner: 'Rina', due: '2026-11-10', status: 'open' },
      { text: 'Perbarui dokumen', owner: 'Budi', due: '2026-11-12', status: 'closed' },
      { text: 'Status tak dikenal', status: 'aneh' },
    ],
    transcriptPreview: 'Halo semua, mari kita mulai.',
    meeting: {
      seriesId: 'series-alpha',
      seq: 7,
      projectType: 'engineering',
      locale: 'id',
      tz: 'Asia/Jakarta',
      start: '2026-11-08T09:00:00+07:00',
      end: '2026-11-08T09:30:00+07:00',
      chair: 'Rina',
      attendees: ['Rina', 'Budi', 'Sari'],
      agenda: { total: 5, covered: 4 },
      issuedAt: '2026-11-08T09:35:00Z',
      generatedAt: '2026-11-08T09:30:00Z',
      engine: { asr: 'faster-whisper', mt: 'mlx-lm', segments: 42, durationSec: 1800 },
    },
    transcript: [
      { t0: 0.5, t1: 2.5, source: { id: 'Halo semua', en: 'Hello all' }, translation: 'Hello all' },
      { t0: -3, t1: '4.25', text: 'Baris kedua', translation: { en: 'Second line' } },
      { t0: 'x', t1: null, source: { en: 'Only EN' }, translation: { id: 'Hanya ID', en: 'Only ID' } },
    ],
    items: [
      {
        ref: 'D-01',
        type: 'decision',
        topic: 'Jadwal',
        text: 'Jadwal baru disetujui',
        owner: 'Rina',
        org: 'PMO',
        due: '2026-11-10',
        status: 'closed',
        priority: 'high',
        likelihood: 'certain',
        review: 'accepted',
        confidence: 0.93,
        tc: '00:01:10',
        speaker: 'Rina',
        carriedFrom: 'meeting-2026-10-01',
        links: ['A-2', 'D-1'],
        metric: {
          measure: 'Kapasitas',
          value: 12.5,
          unit: 'orang',
          baseline: '10',
          variance: 2.5,
          asOf: '2026-11-08',
        },
      },
      {
        text: { id: 'Pertanyaan penting', en: 'Important question' },
        type: 'weird',
        status: 'blocked',
        priority: 'urgent',
        likelihood: 'impossible',
        review: 'draft',
        confidence: 0.55,
        metric: { measure: 'Tanpa nilai', unit: 'x' },
        links: 'bukan list',
      },
      {
        text: 'Metrik lengkap',
        confidence: '0.9',
        metric: { measure: 'Biaya', value: '1500', unit: 'USD', baseline: 'n/a', variance: 100, asOf: 5 },
      },
      'bukan objek',
      {
        ref: '1234567890123456789012345678901234567890-EXTRA',
        text: 'Ref panjang',
        confidence: 2,
        links: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v'],
      },
      { text: '', type: 'risk' },
      { text: {} },
      {
        text: 'x'.repeat(4100),
        topic: 'T'.repeat(130),
        owner: 'O'.repeat(90),
        org: 'G'.repeat(90),
        due: 'D'.repeat(40),
        tc: 'C'.repeat(20),
        speaker: 'S'.repeat(90),
        carriedFrom: 'F'.repeat(70),
        needsReview: true,
      },
      {
        text: '  Ruang  ',
        owner: 42,
        due: 20261110,
        tc: 12,
        speaker: true,
        status: 'carried',
        priority: 'low',
        likelihood: 'unlikely',
        review: 'edited',
        metric: { measure: 'Bool', value: true },
      },
    ],
  },
};

const NOTE_B = {
  note: {
    id: 'note two',
    title: 'Catatan Dua',
    generatedAt: '2026-11-08T10:00:00Z',
    decisions: ['Lanjut'],
    actions: [{ text: 'Tutup tiket', status: 'closed', owner: null, due: null }],
  },
};

const NOTE_C = {
  note: {
    id: 'golden-note-3',
    generatedAt: '2026-11-08T10:30:00Z',
    summary: { en: 'English summary chosen by the oracle' },
  },
};

const INLINE_EXPORT = {
  id: 'inline-1',
  title: 'Rapat & Rencana / 2026',
  date: '2026-11-08',
  status: 'issued',
  generatedAt: '2026-11-08T11:00:00Z',
  summary: 'Catatan inline.',
  decisions: ['Disetujui'],
  actions: [
    { text: 'Kerjakan A', owner: 'Sari', due: '2026-11-20', status: 'open' },
    { text: 'Kerjakan B', owner: null, due: null, status: 'closed' },
  ],
};

const NOTE_ACTION_CAP = {
  note: {
    id: 'golden-note-actions',
    title: 'Batas tindakan',
    generatedAt: '2026-11-08T12:00:00Z',
    actions: Array.from({ length: 100 }, (_, i) => ({
      id: `a-${i + 1}`,
      text: `Tindakan ${i + 1}`,
      status: i === 0 ? 'closed' : 'open',
    })).concat(['bukan objek']),
  },
};

const NOTE_ITEM_CAP = {
  note: {
    id: 'golden-note-500',
    title: 'Batas butir',
    generatedAt: '2026-11-08T12:30:00Z',
    items: Array.from({ length: 505 }, (_, i) => ({ text: `Item ${i + 1}` })),
  },
};

// -------------------------------------------------------------- request list
get('/health', { mask: HEALTH_MASK });

get('/engine/device', { mask: DEVICE_MASK });
post('/engine/device', { device: 'cpu' });
get('/engine/device', { mask: DEVICE_MASK });
post('/engine/device', { device: 'cuda' });
post('/engine/device', { device: 'gpu' });
postBody('/engine/device', '{bad json');
get('/engine/device', { mask: DEVICE_MASK });

get('/engine/mode');
post('/engine/mode', { mode: 'balanced' });
get('/engine/mode');
post('/engine/mode', { mode: 'accurate' });
get('/engine/mode');
post('/engine/mode', { mode: 'turbo' });
postBody('/engine/mode', '{bad json');

get('/languages/targets', { mask: LANGUAGES_MASK });

get('/ui-prefs');
post('/ui-prefs', { theme: 'dark' });
get('/ui-prefs');
post('/ui-prefs', { reskin: 'coretax' });
post('/ui-prefs', { theme: 'neon' });
post('/ui-prefs', {});
postBody('/ui-prefs', '{bad json');

get('/notes');
post('/notes', NOTE_A);
get('/notes');
get('/notes/golden-note-1');
get('/notes/missing');
get('/notes/');
get('/notes/a/b');
post('/notes', NOTE_B);
get('/notes');
get('/notes/note%20two');
post('/notes', { note: { ...NOTE_B.note, title: 'Catatan Dua (revisi)' } });
post('/notes', { note: { ...NOTE_A.note, title: 5 } });
post('/notes', { note: { ...NOTE_A.note, summary: 5 } });
post('/notes', { note: { ...NOTE_A.note, summary: null } });
post('/notes', { note: { ...NOTE_A.note, decisions: 'x' } });
post('/notes', { note: { ...NOTE_A.note, actions: 'x' } });
post('/notes', { note: { ...NOTE_A.note, actions: [{ text: 'ok' }, { text: 'ok' }, 'rusak'] } });
post('/notes', NOTE_C);
get('/notes');

post('/notes/export', { id: 'golden-note-1', format: 'txt' });
post('/notes/export', { id: 'note two', format: 'md' });
post('/notes/export', { note: INLINE_EXPORT, format: 'md' });
post('/notes/export', { note: { ...INLINE_EXPORT, title: 5 } });
post('/notes/export', {});
post('/notes/export', { id: 'golden-note-1', format: 'pdf' });
post('/notes/export', { id: 'missing-note' });
postBody('/notes/export', '{bad json');
post('/notes/export', {
  note: { ...INLINE_EXPORT, title: 'Judul '.repeat(12) },
  format: 'txt',
});
post('/notes/export', { note: 5 });

del('/notes/note%20two');
del('/notes/note%20two');
del('/notes/missing');
get('/notes');
get('/notes', { headers: { Origin: 'http://localhost:8799' } });

post('/notes', NOTE_ACTION_CAP);
post('/notes', NOTE_ITEM_CAP);
postBody('/notes', '', { mask: ['note.id', 'note.generatedAt'] });
post('/notes', { note: 5 });

get('/jobs/unknown');
post('/jobs/unknown/cancel');
get('/nope');
post('/nope');
del('/nope');

req('OPTIONS', '/shutdown');
req('OPTIONS', '/shutdown', { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
req('OPTIONS', '/shutdown', { headers: { Origin: 'https://evil.example' } });

get('/health', { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' }, mask: HEALTH_MASK });
get('/health', { headers: { Origin: 'http://127.0.0.1:8799' }, mask: HEALTH_MASK });
get('/health', { headers: { Origin: 'https://evil.example' } });
post('/notes', { note: 5 }, { headers: { Origin: 'https://evil.example' } });
get('/health', { headers: { Origin: 'null' } });
get('/health', { headers: { Origin: 'file://' } });

let port = 0;
raw('GET', '/health', { host: `evil.example:${'{port}'}` });
raw('GET', '/health', { host: `localhost:${'{port}'}`, mask: HEALTH_MASK });
raw('GET', '/health', { host: `[::1]:${'{port}'}`, mask: HEALTH_MASK });

get('/health', { mask: HEALTH_MASK });

// ------------------------------------------------------------------ helpers
function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
  });
}

function rawSend(request, targetPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(targetPort, '127.0.0.1', () => {
      const lines = [`${request.method} ${request.path} HTTP/1.1`];
      for (const [key, value] of Object.entries(request.headers)) lines.push(`${key}: ${value}`);
      if (request.body != null) lines.push(`Content-Length: ${Buffer.byteLength(request.body)}`);
      lines.push('Connection: close');
      sock.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (request.body != null) sock.write(request.body);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
    });
    sock.on('end', () => {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return reject(new Error('response without headers'));
      const head = buf.subarray(0, sep).toString('utf8');
      const text = buf.subarray(sep + 4).toString('utf8');
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1]);
      if (!status) return reject(new Error(`bad status line: ${head.split('\r\n')[0]}`));
      let body = null;
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          return reject(new Error(`non-JSON response: ${text.slice(0, 200)}`));
        }
      }
      resolve({ status, body });
    });
    sock.on('error', reject);
    sock.setTimeout(20_000, () => {
      sock.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function waitReady(targetPort, child, logsRef) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`python exited early:\n${logsRef.text}`);
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/health`, { signal: AbortSignal.timeout(1000) });
      await res.text();
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`python did not become ready:\n${logsRef.text}`);
}

// ---------------------------------------------------------------- main flow
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-golden-state-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-golden-home-'));
const bootstrapPath = path.join(fakeHome, 'bootstrap.py');
fs.writeFileSync(bootstrapPath, BOOTSTRAP);

const env = { ...process.env };
for (const key of [
  'ALLOWED_ORIGINS',
  'NOTES_PATH',
  'ENGINE_MODE_PATH',
  'DEVICE_PREF_PATH',
  'UI_PREFS_PATH',
  'DEVICE',
  'COMPUTE',
  'FFMPEG',
]) {
  delete env[key];
}
Object.assign(env, {
  YSM_SERVER: path.join(ROOT, 'native', 'server.py'),
  YSM_STATE_DIR: stateDir,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  HOST: '127.0.0.1',
  ENGINE: 'auto',
  TRANSLATE: 'on',
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
});

port = await freePort();
env.PORT = String(port);
for (const item of requests) {
  item.name = item.name.replaceAll('{port}', String(port));
  for (const [key, value] of Object.entries(item.request.headers)) {
    item.request.headers[key] = value.replaceAll('{port}', String(port));
  }
}

const child = spawn(PYTHON, [bootstrapPath], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
const logs = { text: '' };
child.stdout.on('data', (d) => {
  logs.text += d.toString();
});
child.stderr.on('data', (d) => {
  logs.text += d.toString();
});

let results;
try {
  await waitReady(port, child, logs);
  results = [];
  for (const item of requests) {
    // Every request goes over a fresh raw connection: the oracle replies to a
    // rejected origin before reading the body, so a pooled keep-alive socket
    // would desync the next request.
    results.push({ ...item, response: await rawSend(item.request, port) });
  }
  try {
    await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  } catch {
    // server may exit before the response is read
  }
} finally {
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

await new Promise((r) => setTimeout(r, 200));
if (child.exitCode === null) child.kill();
fs.rmSync(stateDir, { recursive: true, force: true });
fs.rmSync(fakeHome, { recursive: true, force: true });

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
for (const name of fs.readdirSync(GOLDEN_DIR)) {
  if (name.endsWith('.json')) fs.unlinkSync(path.join(GOLDEN_DIR, name));
}
results.forEach((item, index) => {
  const file = path.join(GOLDEN_DIR, `${String(index + 1).padStart(3, '0')}-${slug(item.name)}.json`);
  const golden = {
    name: item.name,
    capturedFrom: 'native/server.py (faster_whisper/ctranslate2 stubbed; ML routes not captured)',
    request: item.request,
    response: item.response,
    mask: item.mask,
  };
  fs.writeFileSync(file, `${JSON.stringify(golden, null, 2)}\n`);
});

const byRoute = new Map();
for (const item of results) {
  const key = `${item.request.method} ${item.request.path.split('?')[0]}`;
  byRoute.set(key, (byRoute.get(key) || 0) + 1);
}
console.log(`captured ${results.length} goldens into ${path.relative(ROOT, GOLDEN_DIR)}`);
for (const [route, count] of [...byRoute.entries()].sort()) {
  console.log(`  ${route.padEnd(34)} ${count}`);
}
