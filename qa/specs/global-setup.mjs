// Starts the lab server and the Rust engine on free ports, exports their URLs in env, stops them at teardown.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitFor(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const kill = (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
};

function engineBinary() {
  if (process.env.QA_ENGINE_BIN) return existsSync(process.env.QA_ENGINE_BIN) ? process.env.QA_ENGINE_BIN : null;
  const cargo = process.platform === 'win32' ? path.join(os.homedir(), '.cargo', 'bin', 'cargo.exe') : 'cargo';
  const build = spawnSync(existsSync(cargo) ? cargo : 'cargo', ['build', '-p', 'submeetly-engine'], {
    cwd: path.join(ROOT, 'engine-rs'),
    stdio: 'inherit',
  });
  if (build.status !== 0) return null;
  const target = process.env.CARGO_TARGET_DIR || path.join(ROOT, 'engine-rs', 'target');
  const exe = path.join(target, 'debug', process.platform === 'win32' ? 'submeetly-engine.exe' : 'submeetly-engine');
  return existsSync(exe) ? exe : null;
}

export default async function globalSetup() {
  const children = [];
  let stateDir = null;

  const labPort = await freePort();
  const python = process.env.QA_PYTHON || 'python3';
  const lab = spawn(python, ['scripts/lab-server.py'], {
    cwd: ROOT,
    env: { ...process.env, LAB_PORT: String(labPort), PYTHONUTF8: '1' },
    stdio: 'ignore',
  });
  children.push(lab);
  process.env.QA_LAB_URL = `http://127.0.0.1:${labPort}`;
  if (!(await waitFor(`${process.env.QA_LAB_URL}/app.html`))) throw new Error(`lab server did not start (python: ${python})`);

  const bin = engineBinary();
  if (bin) {
    const enginePort = await freePort();
    stateDir = mkdtempSync(path.join(os.tmpdir(), 'qa-engine-'));
    const engine = spawn(bin, [], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(enginePort), YSM_STATE_DIR: stateDir },
      stdio: 'ignore',
    });
    children.push(engine);
    process.env.QA_ENGINE_URL = `http://127.0.0.1:${enginePort}`;
    if (!(await waitFor(`${process.env.QA_ENGINE_URL}/health`))) delete process.env.QA_ENGINE_URL;
  }

  return async () => {
    children.forEach(kill);
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  };
}
