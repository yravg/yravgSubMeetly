// The Windows island starts the engine itself and reads the register from it. Needs QA_ISLAND_EXE (a built poni.exe) and QA_ENGINE_BIN.
// The pill is not photographed: it is a DirectComposition window (PrintWindow returns black) and a screen grab would catch whatever is behind it.
import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { engineBin } from './live-helpers.mjs';

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const health = async (port) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

test('TC027 island starts the engine on its own and the engine serves the register the Meeting page reads', async () => {
  const island = process.env.QA_ISLAND_EXE;
  test.skip(process.platform !== 'win32' || !island || !existsSync(island), 'needs Windows and QA_ISLAND_EXE (a built poni.exe)');
  test.skip(!engineBin(), 'no engine binary (set QA_ENGINE_BIN)');
  test.setTimeout(120_000);
  const port = await freePort();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qa-island-'));
  const home = path.join(dir, 'home');
  const state = path.join(dir, 'state');
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  // A dev island (own PONI_HOME, own port): opens on the Meeting page, stays open, sits off the installed island.
  writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ start_page: 'meeting', collapse_delay_ms: 600000, island_x: 0.25 }));
  writeFileSync(
    path.join(state, 'notes.json'),
    JSON.stringify({ notes: [{ id: 'MOM-QA-1', title: 'Weekly sync (fixture)', date: '2026-11-08', decisions: ['Ship the lab build on Friday'], actions: [{ text: 'Send the revised plan', owner: 'Dewi', status: 'open' }] }] }),
  );
  const child = spawn(island, [], {
    env: { ...process.env, PONI_HOME: home, SUBMEETLY_ENGINE_EXE: engineBin(), YSM_HELPER_PORT: String(port), YSM_STATE_DIR: state },
    stdio: 'ignore',
  });
  try {
    expect(await health(port), 'nothing answers on the port before the island starts').toBe(false);
    // The supervisor asks /health every 2.5 s and starts the engine when nobody answers.
    await expect.poll(() => health(port), { timeout: 60_000, intervals: [500] }).toBe(true);
    const { notes } = await (await fetch(`http://127.0.0.1:${port}/notes`)).json();
    expect(notes.map((n) => n.title)).toContain('Weekly sync (fixture)');
    const log = readFileSync(path.join(home, 'cache', 'poni.log'), 'utf8');
    expect(log).toContain('service engine link: started');
    expect(log).toContain('service helper link: started');
    expect(child.exitCode, 'the island is still running').toBeNull();
  } finally {
    await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' }).catch(() => {});
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dir, { recursive: true, force: true });
  }
});
