/**
 * The Rust engine answers 409 { code: 'model-not-downloaded', id } when a model is not on disk (it downloads nothing by itself).
 *   node --test test/native-refused.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDraft, nativeTranscribeDetailed, nativeTranslate } from '../src/lib/native.js';

const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const audio = new Float32Array(160);

test('409 model-not-downloaded carries code and model id on every call that needs a model', async () => {
  for (const call of [
    () => nativeTranscribeDetailed('http://127.0.0.1:1', audio),
    () => nativeDraft('http://127.0.0.1:1', audio, 'en', 'de'),
    () => nativeTranslate('http://127.0.0.1:1', 'hi', 'en', 'de'),
  ]) {
    globalThis.fetch = reply(409, { code: 'model-not-downloaded', error: 'x', id: 'openai/whisper-small' });
    await assert.rejects(call, (e) => e.code === 'model-not-downloaded' && e.modelId === 'openai/whisper-small' && e.message === 'model-not-downloaded openai/whisper-small');
  }
});

test('other refusals keep their plain message and no code', async () => {
  globalThis.fetch = reply(409, { code: 'busy' });
  await assert.rejects(() => nativeDraft('http://127.0.0.1:1', audio, 'en', 'de'), (e) => e.code === undefined && /native \/draft 409/.test(e.message));
  globalThis.fetch = reply(500, 'boom');
  await assert.rejects(() => nativeTranscribeDetailed('http://127.0.0.1:1', audio), (e) => e.code === undefined && /500: boom/.test(e.message));
});

test('/draft reports the translation model state', async () => {
  globalThis.fetch = reply(200, { source: 'hallo', translation: '', translateState: 'loading' });
  assert.equal((await nativeDraft('http://127.0.0.1:1', audio, 'de', 'en')).translateState, 'loading');
  globalThis.fetch = reply(200, { source: 'hallo', translation: 'hello' });
  assert.equal((await nativeDraft('http://127.0.0.1:1', audio, 'de', 'en')).translateState, '', 'an engine that says nothing is not guessed about');
});
