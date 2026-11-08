/**
 * Locate and start the Rust engine (`submeetly-engine`) for tests and scripts.
 *   SUBMEETLY_ENGINE_BIN=path  forces a binary; else engine-rs/target and
 *   $CARGO_TARGET_DIR are searched (release first, then debug).
 * Build one with: cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXE = process.platform === 'win32' ? 'submeetly-engine.exe' : 'submeetly-engine';

export const BUILD_HINT = 'cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml';

export function engineBinary() {
  if (process.env.SUBMEETLY_ENGINE_BIN) {
    return existsSync(process.env.SUBMEETLY_ENGINE_BIN) ? process.env.SUBMEETLY_ENGINE_BIN : null;
  }
  const targets = [process.env.CARGO_TARGET_DIR, join(ROOT, 'engine-rs', 'target')].filter(Boolean);
  for (const target of targets) {
    for (const profile of ['release', 'debug']) {
      const candidate = join(target, profile, EXE);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Why a test that needs the engine is skipped, or false when it can run. */
export const engineSkip = engineBinary() ? false : `engine binary missing (${BUILD_HINT})`;

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start the engine on a free loopback port with a private state dir.
 * Never uses 17865. Returns { url, port, stateDir, stop() }.
 */
export async function startEngine({ stateDir, env = {} } = {}) {
  const bin = engineBinary();
  if (!bin) throw new Error(`engine binary missing (${BUILD_HINT})`);
  const port = await freePort();
  const dir = stateDir || mkdtempSync(join(tmpdir(), 'ysm-engine-'));
  const child = spawn(bin, [], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), YSM_STATE_DIR: dir, ...env },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill();
      throw new Error('engine did not start');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    port,
    stateDir: dir,
    stop() {
      child.kill();
      if (!stateDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
