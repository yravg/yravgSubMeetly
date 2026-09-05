/**
 * Large-file helper job client (src/lib/native.js): upload progress, polling,
 * monotonic pct, cancel during upload and during processing.
 *   node --test test/native-file-job.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const URL_ = 'http://127.0.0.1:17865';

/** Fake XMLHttpRequest that reports upload progress then a JSON {jobId}. */
function installFakeXhr({ jobId = 'job-1', status = 202, chunks = [0.5, 1], aborted = { v: false } } = {}) {
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.headers = {};
      FakeXhr.instances.push(this);
    }
    open(m, u) {
      this.method = m;
      this.url = u;
    }
    setRequestHeader(k, v) {
      this.headers[k] = v;
    }
    abort() {
      aborted.v = true;
      this._aborted = true;
      this.onabort?.();
    }
    send(body) {
      this.body = body;
      const total = 1000;
      let i = 0;
      const tick = () => {
        if (this._aborted) return;
        if (i < chunks.length) {
          this.upload.onprogress?.({ lengthComputable: true, loaded: chunks[i] * total, total });
          i++;
          setTimeout(tick, 1);
        } else {
          this.status = status;
          this.responseText = status === 202 ? JSON.stringify({ jobId }) : 'boom';
          this.onload?.();
        }
      };
      setTimeout(tick, 1);
    }
  }
  FakeXhr.instances = [];
  globalThis.XMLHttpRequest = FakeXhr;
  return FakeXhr;
}

/** Fake fetch for GET /jobs/:id and POST /jobs/:id/cancel. */
function installFakeFetch(script) {
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if (/\/cancel$/.test(url)) return { ok: true, json: async () => ({ ok: true }) };
    if (/\/jobs\//.test(url)) {
      const body = typeof script === 'function' ? script(n++) : script[Math.min(n++, script.length - 1)];
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, text: async () => 'nf' };
  };
  return calls;
}

test('happy path: upload 0→40, queued 40, server progress → done, segments mapped, pct monotonic', async () => {
  installFakeXhr({ jobId: 'job-9' });
  const calls = installFakeFetch([
    { status: 'running', progress: 0.05 },
    { status: 'running', progress: 0.2 },
    { status: 'running', progress: 0.2 },
    { status: 'done', progress: 1, segments: [{ start: 0, end: 2.5, text: ' hello ' }, { start: 2.5, end: 4, text: 'world' }] },
  ]);
  const { nativeTranscribeFileJob } = await import('../src/lib/native.js');
  const events = [];
  const segs = await nativeTranscribeFileJob(
    URL_,
    new Uint8Array(10),
    'big.mkv',
    { language: 'auto', task: 'transcribe', pollMs: 2, sizeBytes: 1000 },
    (p) => events.push(p),
  );
  assert.deepEqual(segs, [
    { t0: 0, t1: 2.5, text: 'hello' },
    { t0: 2.5, t1: 4, text: 'world' },
  ]);
  const stages = events.map((e) => e.stage);
  assert.equal(stages[0], 'upload');
  assert.ok(stages.includes('queued'));
  assert.equal(stages.at(-1), 'transcribe');
  assert.equal(events.at(-1).pct, 100);
  const up = events.filter((e) => e.stage === 'upload').map((e) => e.pct);
  assert.deepEqual(up, [0, 20, 40]);
  const pcts = events.map((e) => e.pct);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] >= pcts[i - 1], `monotonic at ${i}: ${pcts}`);
  // server progress 0.2 → at least 52 (40 + 0.2*60)
  const during = events.filter((e) => e.stage === 'transcribe' && e.pct < 100);
  assert.ok(during.some((e) => e.pct >= 52));
  assert.ok(during.every((e) => e.pct <= 95));
  assert.ok(calls.some((c) => /\/jobs\/job-9$/.test(c.url)));
  assert.ok(events.some((e) => e.jobId === 'job-9'));
});

test('helper job error surfaces as a thrown error', async () => {
  installFakeXhr();
  installFakeFetch([{ status: 'running', progress: 0.05 }, { status: 'error', error: 'ffmpeg exploded' }]);
  const { nativeTranscribeFileJob } = await import('../src/lib/native.js');
  await assert.rejects(
    nativeTranscribeFileJob(URL_, new Uint8Array(1), 'x.mp4', { pollMs: 1 }, () => {}),
    /ffmpeg exploded/,
  );
});

test('cancel during processing → POST /jobs/:id/cancel and "cancelled" rejection', async () => {
  installFakeXhr({ jobId: 'job-c' });
  const calls = installFakeFetch(() => ({ status: 'running', progress: 0.2 }));
  const { nativeTranscribeFileJob } = await import('../src/lib/native.js');
  const ctl = {};
  let sawQueued = false;
  const p = nativeTranscribeFileJob(
    URL_,
    new Uint8Array(1),
    'x.mp4',
    { pollMs: 2 },
    (e) => {
      if (e.stage === 'queued' && !sawQueued) {
        sawQueued = true;
        setTimeout(() => ctl.cancel(), 3);
      }
    },
    ctl,
  );
  await assert.rejects(p, /cancelled/);
  assert.ok(calls.some((c) => c.method === 'POST' && /\/jobs\/job-c\/cancel$/.test(c.url)));
});

test('cancel during upload aborts the XHR before any job exists', async () => {
  const aborted = { v: false };
  installFakeXhr({ chunks: [0.1, 0.2, 0.3, 0.4, 0.5], aborted });
  const calls = installFakeFetch(() => ({ status: 'running', progress: 0.2 }));
  const { nativeTranscribeFileJob } = await import('../src/lib/native.js');
  const ctl = {};
  const p = nativeTranscribeFileJob(
    URL_,
    new Uint8Array(1),
    'x.mp4',
    { pollMs: 2 },
    (e) => {
      if (e.stage === 'upload' && e.pct >= 8) ctl.cancel();
    },
    ctl,
  );
  await assert.rejects(p, /cancelled/);
  assert.equal(aborted.v, true);
  assert.ok(!calls.some((c) => /\/jobs\//.test(c.url)), 'no job polled after an aborted upload');
});

test('upload HTTP error is reported with status', async () => {
  installFakeXhr({ status: 500 });
  installFakeFetch([]);
  const { nativeTranscribeFileJob } = await import('../src/lib/native.js');
  await assert.rejects(nativeTranscribeFileJob(URL_, new Uint8Array(1), 'x.mp4', { pollMs: 1 }, () => {}), /500/);
});
