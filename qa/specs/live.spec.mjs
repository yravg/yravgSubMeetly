// Real engine, real Whisper weights, real audio: live captions, translation and the meeting flow. No mocked helper.
// Needs QA_ENGINE_BIN (a built submeetly-engine) and openai/whisper-base in QA_HF_HOME; see qa/strategy.md.
import { expect, test } from '@playwright/test';
import { nativeDraft, nativeTranscribe, nativeTranslate } from '../../src/lib/native.js';
import { emitPanel, openApp, openView } from './helpers.mjs';
import { decodeSample, engineBin, qwenSkipReason, startEngine, whisperSkipReason } from './live-helpers.mjs';

let engine;
test.beforeAll(async () => {
  if (engineBin()) engine = await startEngine();
});
test.afterAll(() => engine?.stop());
test.beforeEach(() => test.skip(!engine, 'no engine binary (set QA_ENGINE_BIN)'));

const secs = (pcm, from, to) => pcm.subarray(Math.round(from * 16000), Math.round(to * 16000));
const words = (s) => (s.toLowerCase().match(/[a-z']+/g) || []).length;
const sample = (label, a, b) => console.log(`[sample] ${label}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);

test('TC024 real-time captions: audio goes through the engine, interim then final reach the panel in order', async ({ page }) => {
  test.skip(!!whisperSkipReason(), whisperSkipReason() || '');
  test.setTimeout(240_000);
  await openApp(page);
  await openView(page, 'captions');
  const pcm = await decodeSample(page, '/speech.wav');
  expect(pcm.length, 'speech.wav decodes to about 20 s at 16 kHz').toBeGreaterThan(16000 * 15);
  const lane = page.locator('#live-src-lines');
  await emitPanel(page, 'pipeline-status', { state: 'listening', device: 'cpu' });

  // The offscreen document sends the growing speech window for interim captions and the whole segment for the final one.
  const interim = [];
  for (const end of [5, 10]) {
    const text = await nativeTranscribe(engine.url, secs(pcm, 0, end), { language: 'en' });
    expect(text.length, `interim text at ${end} s`).toBeGreaterThan(5);
    interim.push(text);
    await emitPanel(page, 'subtitle', { source: text, translation: '', interim: true, partial: true });
    await expect(lane.locator('.line.interim')).toHaveText(text);
  }
  const final = await nativeTranscribe(engine.url, secs(pcm, 0, 15), { language: 'en' });
  expect(words(final), 'the final line carries more speech than the first interim').toBeGreaterThan(words(interim[0]));
  expect(final.toLowerCase()).toMatch(/senate|army|approval|fighting/); // the first 15 s of speech.wav (public-domain memoir reading)
  await emitPanel(page, 'subtitle', { source: final, translation: '', t0: 0, t1: 15 });
  await expect(lane.locator('.line.interim')).toHaveCount(0);
  await expect(lane.locator('.line').last()).toHaveText(final);

  // The engine counted the calls in order and kept the last one.
  const live = await (await fetch(`${engine.url}/live`)).json();
  expect(live.seq).toBeGreaterThanOrEqual(3);
  expect(live.source).toBe(final);
  expect(live.rtf, 'real-time factor reported').toBeGreaterThan(0);
  sample('TC024 interim 5 s', interim[0], '');
  sample('TC024 final 15 s', final, `(rtf ${live.rtf})`);
});

test('TC025 real-time translation with the Qwen model: English speech to Indonesian text', async ({ page }) => {
  test.skip(!!whisperSkipReason(), whisperSkipReason() || '');
  test.skip(!!qwenSkipReason(), qwenSkipReason() || '');
  test.setTimeout(360_000);
  const mt = await startEngine({ translate: true });
  try {
    const line = 'Please send the revised plan by Friday.';
    const id = await nativeTranslate(mt.url, line, 'en', 'id');
    expect(id.length).toBeGreaterThan(5);
    expect(id.toLowerCase()).not.toBe(line.toLowerCase());
    expect(id.toLowerCase()).toMatch(/rencana|kirim|jumat/);
    sample('TC025 /translate en->id', line, id);

    await openApp(page);
    const pcm = await decodeSample(page, '/speech.wav');
    const draft = await nativeDraft(mt.url, secs(pcm, 0, 8), 'en', 'id', { language: 'en' });
    expect(draft?.source.length).toBeGreaterThan(5);
    expect(draft?.translation.length).toBeGreaterThan(5);
    sample('TC025 /draft 8 s', draft.source, draft.translation);
  } finally {
    mt.stop();
  }
});

test('TC028 real-time translation through Whisper alone: German and Indonesian speech to English captions', async ({ page }) => {
  test.skip(!!whisperSkipReason(), whisperSkipReason() || '');
  test.setTimeout(300_000);
  await openApp(page);
  await openView(page, 'captions');
  const tgt = page.locator('#live-tgt-lines');
  for (const [code, file] of [['de', 'de-1'], ['id', 'id-1']]) {
    const pcm = secs(await decodeSample(page, `/samples/cc0/${file}.mp3`), 0, 10);
    const source = await nativeTranscribe(engine.url, pcm, { language: code, task: 'transcribe' });
    const english = await nativeTranscribe(engine.url, pcm, { language: code, task: 'translate' });
    expect(source.length, `${code} transcript`).toBeGreaterThan(5);
    expect(english.length, `${code} translation`).toBeGreaterThan(5);
    expect(english, 'translation differs from the source text').not.toBe(source);
    const english_words = (english.toLowerCase().match(/\b(the|and|of|to|a|is|in|was|that|he|it|with|for)\b/g) || []).length;
    expect(english_words, `${code} translation reads as English: ${english}`).toBeGreaterThanOrEqual(2);
    sample(`TC028 ${code}->en`, source, english);
    await emitPanel(page, 'subtitle', { source, translation: english, t0: 0, t1: 10, dir: { src: code, tgt: 'en' } });
    await expect(tgt).toContainText(`${code.toUpperCase()} → EN`);
    await expect(tgt).toContainText(english);
  }
});

test('TC026 meeting flow: session lines, End & draft, register, then the engine serves the note the island reads', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  // The panel talks to the default helper port (never ours): send that to this run's engine.
  await context.route('http://127.0.0.1:17865/**', (r) => r.continue({ url: r.request().url().replace(':17865', `:${new URL(engine.url).port}`) }));
  const page = await context.newPage();
  const errors = await openApp(page);
  await page.locator('#btn-settings').click();
  await page.locator('#settings-tabs [data-stab="engine"]').click();
  await page.locator('#engine-toggle').selectOption('native');
  await page.locator('#btn-native-check').click();
  await expect(page.locator('#native-status')).toHaveClass(/\bon\b/);
  await page.keyboard.press('Escape');

  // A session: three finished caption lines (Indonesian speech, English captions) while capture is running.
  await emitPanel(page, 'state', { active: true, tabId: 1 });
  const lines = [
    ['Kita putuskan merilis build lab hari Jumat.', 'We decided to ship the lab build on Friday.'],
    ['Dewi akan mengirim rencana revisi sebelum Senin.', 'Dewi will send the revised plan by Monday.'],
    ['Apakah anggaran fase kedua disetujui?', 'Is the budget approved for the second phase?'],
  ];
  let t = 0;
  for (const [source, translation] of lines) {
    await emitPanel(page, 'subtitle', { source, translation, t0: t, t1: t + 4, dir: { src: 'id', tgt: 'en' } });
    t += 5;
  }
  await openView(page, 'notes');
  await page.locator('#btn-end-draft:not([disabled])').waitFor();
  const registerTab = context.waitForEvent('page');
  await page.locator('#btn-end-draft').click();
  const register = await registerTab;
  await register.waitForLoadState();

  // The panel's notes show the drafted decision and action; the register opens in its own tab with the same items.
  await expect(page.locator('#view-notes')).toContainText('We decided to ship the lab build on Friday.');
  await expect(page.locator('#view-notes')).toContainText('Dewi will send the revised plan by Monday.');
  await expect(register.locator('body')).toContainText('Untitled meeting', { timeout: 15_000 });
  await expect(register.locator('body')).toContainText(/Decision\s*1/);
  await expect(register.locator('body')).toContainText(/Action\s*1/);
  await expect(register.locator('body')).toContainText('3 register items');

  // Sync pushes the note to the engine (POST /notes); GET /notes is what the island Meeting page reads.
  expect((await (await fetch(`${engine.url}/notes`)).json()).notes).toHaveLength(0);
  await page.locator('#btn-notes-sync').click();
  await expect.poll(async () => (await (await fetch(`${engine.url}/notes`)).json()).notes.length).toBe(1);
  const { notes } = await (await fetch(`${engine.url}/notes`)).json();
  const note = notes[0];
  expect(note.decisions).toEqual(['We decided to ship the lab build on Friday.']);
  expect(note.actions).toHaveLength(1);
  expect(note.actions[0]).toMatchObject({ owner: 'Dewi', status: 'open', text: 'Dewi will send the revised plan by Monday.' });
  expect(note.items.map((i) => i.type).sort()).toEqual(['action', 'decision', 'question']);
  const one = await (await fetch(`${engine.url}/notes/${encodeURIComponent(note.id)}`)).json();
  expect(one.note.id).toBe(note.id);
  expect(errors, 'no page errors').toEqual([]);
  await context.close();
});
