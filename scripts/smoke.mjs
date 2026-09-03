// Smoke test of the exact pipeline API shapes used by the extension.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = new URL('./.hf-cache', import.meta.url).pathname;

const log = (...a) => console.log('[smoke]', ...a);

// 1) Whisper ASR — same options as src/lib/asr.js (WASM-path dtypes)
log('loading whisper-tiny (q8)…');
const asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
});
log('whisper loaded');

const audio = new Float32Array(16000 * 2); // 2 s of silence-ish noise
for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i / 30) * 0.01;

const out1 = await asr(audio, { task: 'transcribe', language: 'en' });
log('transcribe out:', JSON.stringify(out1).slice(0, 120));
if (typeof out1?.text !== 'string') throw new Error('ASR .text shape mismatch');

const out2 = await asr(audio, { task: 'translate', language: 'ja' });
log('translate-direct out:', JSON.stringify(out2).slice(0, 120));

const out3 = await asr(audio, {
  task: 'transcribe',
  language: 'en',
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: true,
});
log('timestamps out:', JSON.stringify(out3).slice(0, 200));
if (!Array.isArray(out3?.chunks)) throw new Error('ASR .chunks shape mismatch');

// 2) Opus-MT — same options as src/lib/translate.js
log('loading opus-mt-ja-en (q8)…');
const mt = await pipeline('translation', 'Xenova/opus-mt-ja-en', { dtype: 'q8' });
const tr = await mt('こんにちは、世界。今日はいい天気ですね。');
log('MT out:', JSON.stringify(tr));
if (typeof tr?.[0]?.translation_text !== 'string') throw new Error('MT shape mismatch');

log('ALL OK');
