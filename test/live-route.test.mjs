/**
 * GET /live in native/server.py: idle shape, then the line a /transcribe call
 * produced, with the real-time factor (compute seconds / audio seconds).
 * Needs `python` with numpy (PYTHON env overrides); skips without it.
 *   node --test test/live-route.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const hasNumpy = spawnSync(PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' }).status === 0;

// Stub ASR: every call hears "halo dunia" and takes 100 ms.
const BOOTSTRAP = `
import os, runpy, sys, time, types
fw = types.ModuleType("faster_whisper")
class Seg:
    start, end, text = 0.0, 1.0, " halo dunia "
class WhisperModel:
    def __init__(self, *a, **k): pass
    def transcribe(self, *a, **k):
        time.sleep(0.1)
        return [Seg()], None
fw.WhisperModel = WhisperModel
sys.modules["faster_whisper"] = fw
ct2 = types.ModuleType("ctranslate2")
ct2.get_cuda_device_count = lambda: 0
sys.modules["ctranslate2"] = ct2
sys.argv = [os.environ["YSM_SERVER"]]
runpy.run_path(os.environ["YSM_SERVER"], run_name="__main__")
`;

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

test('GET /live: idle, then the last transcribed line with rtf', { skip: !hasNumpy && 'python+numpy missing', timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-live-'));
  const boot = path.join(dir, 'boot.py');
  fs.writeFileSync(boot, BOOTSTRAP);
  const port = await freePort();
  const child = spawn(PYTHON, [boot], {
    cwd: ROOT,
    env: { ...process.env, YSM_SERVER: path.join(ROOT, 'native', 'server.py'), YSM_STATE_DIR: dir, HOME: dir, USERPROFILE: dir, HOST: '127.0.0.1', PORT: String(port), ENGINE: 'auto', PYTHONUTF8: '1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch { /* not up yet */ }
      assert.ok(i < 100, 'server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
    const idle = await (await fetch(`${base}/live`)).json();
    assert.deepEqual(idle, { seq: 0, source: '', translation: '', ms: null, audio_s: null, rtf: null, at: null });

    const pcm = Buffer.from(new Float32Array(32000).buffer); // 2 s of audio
    const r = await fetch(`${base}/transcribe?language=id`, { method: 'POST', body: pcm });
    assert.equal((await r.json()).text, 'halo dunia');
    const live = await (await fetch(`${base}/live`)).json();
    assert.equal(live.seq, 1);
    assert.equal(live.source, 'halo dunia');
    assert.equal(live.audio_s, 2);
    assert.ok(live.ms >= 100, `ms ${live.ms}`);
    assert.ok(Math.abs(live.rtf - live.ms / 2000) < 0.002, `rtf ${live.rtf} for ms ${live.ms}`);
    assert.ok(live.at > 0);

    // Too little audio is not a line: seq stays.
    await fetch(`${base}/transcribe`, { method: 'POST', body: Buffer.alloc(40) });
    assert.equal((await (await fetch(`${base}/live`)).json()).seq, 1);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
