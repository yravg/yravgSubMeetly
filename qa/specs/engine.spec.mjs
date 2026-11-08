// Rust engine HTTP on a free loopback port (started by global-setup).
import { expect, test } from '@playwright/test';
import { ENGINE, LAB } from './helpers.mjs';

const NOTE = {
  id: 'MOM-QA-0001',
  title: 'QA fixture weekly sync',
  summary: 'Fixture summary for the engine round trip.',
  decisions: ['Ship the lab build'],
  actions: [{ text: 'Rerun the suite', owner: 'Dewi Fixture' }],
};

test.beforeEach(() => {
  test.skip(!ENGINE(), 'engine binary not built or not started (set QA_ENGINE_BIN or install Rust)');
});

test('TC014 engine /health answers and a note round-trips', async ({ request }) => {
  const health = await request.get(`${ENGINE()}/health`);
  expect(health.status()).toBe(200);
  expect((await health.json()).ok).toBe(true);

  const post = await request.post(`${ENGINE()}/notes`, { data: { note: NOTE } });
  expect(post.status()).toBe(200);
  expect((await post.json()).ok).toBe(true);

  const list = await (await request.get(`${ENGINE()}/notes`)).json();
  const found = list.notes.find((n) => n.id === NOTE.id);
  expect(found, 'posted note is listed').toBeTruthy();
  expect(found.title).toBe(NOTE.title);

  const exp = await request.post(`${ENGINE()}/notes/export`, { data: { id: NOTE.id, format: 'txt' } });
  expect(exp.status()).toBe(200);
  expect(await exp.text()).toContain(NOTE.title);

  const bad = await request.post(`${ENGINE()}/notes`, { data: 'not json', headers: { 'content-type': 'text/plain' } });
  expect(bad.status()).toBe(400);
});

test('TC015 engine refuses foreign origins and non-loopback Host, allows the lab and extension', async ({ request }) => {
  const denied = await request.get(`${ENGINE()}/health`, { headers: { Origin: 'https://evil.example' } });
  expect(denied.status()).toBe(403);
  expect(denied.headers()['access-control-allow-origin']).toBeUndefined();

  const foreignHost = await request.get(`${ENGINE()}/health`, { headers: { Host: 'evil.example' } });
  expect(foreignHost.status()).toBe(403);

  for (const origin of ['chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'http://127.0.0.1:8799', LAB()]) {
    const ok = await request.get(`${ENGINE()}/health`, { headers: { Origin: origin } });
    expect(ok.status(), origin).toBe(200);
    expect(ok.headers()['access-control-allow-origin'], origin).toBe(origin);
  }
});
