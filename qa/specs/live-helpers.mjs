// Helpers for the live-engine cases (TC024-TC028): a private engine with a real Whisper model, never the default one.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Hub cache the live cases read: QA_HF_HOME, else HF_HOME, else ~/.cache/huggingface. */
export const hfHome = () => process.env.QA_HF_HOME || process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface');

/** True when the repo's weights are on disk. The cases never download: the default engine model is 1.6 GB. */
export function modelCached(repo, file = 'model.safetensors') {
  const snaps = path.join(hfHome(), 'hub', `models--${repo.replace('/', '--')}`, 'snapshots');
  if (!existsSync(snaps)) return false;
  return readdirSync(snaps).some((s) => existsSync(path.join(snaps, s, file)));
}

/** Model the live cases use. `base` (290 MB) is the smallest multilingual Whisper that is usable. */
export const WHISPER = () => process.env.QA_WHISPER_MODEL || 'base';
export const whisperSkipReason = () =>
  modelCached(`openai/whisper-${WHISPER()}`) ? null : `openai/whisper-${WHISPER()} is not in ${hfHome()} (set QA_HF_HOME; the cases never download)`;

export const QWEN = () => process.env.QA_TRANSLATE_MODEL || 'Qwen/Qwen2.5-0.5B-Instruct';
export const qwenSkipReason = () => (modelCached(QWEN()) ? null : `${QWEN()} is not in ${hfHome()} (about 1 GB, never downloaded by the suite)`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Same binary rules as global-setup: QA_ENGINE_BIN, else the debug build. Release builds also work through QA_ENGINE_BIN. */
export function engineBin() {
  if (process.env.QA_ENGINE_BIN) return existsSync(process.env.QA_ENGINE_BIN) ? process.env.QA_ENGINE_BIN : null;
  const target = process.env.CARGO_TARGET_DIR || path.join(ROOT, 'engine-rs', 'target');
  const exe = path.join(target, 'debug', process.platform === 'win32' ? 'submeetly-engine.exe' : 'submeetly-engine');
  return existsSync(exe) ? exe : null;
}

/** Start an engine with a real Whisper model (and Qwen only when asked). Returns { url, stateDir, stop }. */
export async function startEngine({ translate = false } = {}) {
  const bin = engineBin();
  if (!bin) throw new Error('no engine binary (set QA_ENGINE_BIN)');
  const port = await freePort();
  const stateDir = mkdtempSync(path.join(os.tmpdir(), 'qa-live-'));
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    YSM_STATE_DIR: stateDir,
    HF_HOME: hfHome(),
    HF_HUB_OFFLINE: '1', // a missing model must fail loudly, not start a download
    WHISPER_MODEL: WHISPER(),
    DEVICE: 'cpu',
  };
  if (translate) env.TRANSLATE_MODEL = QWEN();
  else env.TRANSLATE = 'off';
  const child = spawn(bin, [], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const end = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      /* retry */
    }
    if (Date.now() > end) throw new Error('engine did not answer /health');
    await new Promise((r) => setTimeout(r, 100));
  }
  const stop = () => {
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else child.kill('SIGTERM');
    }
    rmSync(stateDir, { recursive: true, force: true });
  };
  return { url, stateDir, stop };
}

/** Decode a lab-served audio file (wav or mp3) to 16 kHz mono Float32 in the page. The panel's mock wraps fetch, so the bytes come from Node. */
export async function decodeSample(page, urlPath) {
  const bytes = Buffer.from(await (await fetch(`${process.env.QA_LAB_URL}${urlPath}`)).arrayBuffer());
  const b64 = await page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(raw.buffer);
    const out = new Uint8Array(audio.getChannelData(0).slice().buffer);
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(bin);
  }, bytes.toString('base64'));
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
