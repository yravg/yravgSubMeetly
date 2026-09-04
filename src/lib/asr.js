// Speech-recognition engine abstraction.
//   whisper : transformers.js ASR pipeline (tiny … large-v3-turbo)
//   voxtral : transformers.js VoxtralForConditionalGeneration (WebGPU)
//   native  : local helper server over localhost (see lib/native.js)
import {
  pipeline,
  VoxtralForConditionalGeneration,
  VoxtralProcessor,
} from '@huggingface/transformers';
import { ASR_MODELS, DEFAULT_ASR } from './registry.js';
import { nativeHealth, nativeTranscribe } from './native.js';

let backend = null; // 'whisper' | 'voxtral' | 'native'
let asrPipe = null; // whisper pipeline
let vox = null; // { model, processor }
let nativeUrl = null;
let asrKey = null;
let asrDevice = null;

export async function hasWebGPU() {
  try {
    return !!navigator.gpu && !!(await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function pickDevice(pref = 'auto', spec = null) {
  const gpuOK = await hasWebGPU();
  if (spec?.webgpuOnly) {
    if (!gpuOK) throw new Error(`${spec.label} needs WebGPU, which is unavailable in this browser.`);
    return 'webgpu';
  }
  if (pref === 'wasm') return 'wasm';
  if (pref === 'webgpu') return gpuOK ? 'webgpu' : 'wasm';
  // auto: small Whisper models are usually faster on WASM (int8+SIMD) than on
  // Apple's WebGPU; larger models only make sense on the GPU.
  const isMac = /Mac/i.test(navigator.platform || '');
  if (spec && /small|large/.test(spec.id) && gpuOK) return 'webgpu';
  return gpuOK && !isMac ? 'webgpu' : 'wasm';
}

function dtypeFor(device, spec) {
  if (spec?.dtype) return spec.dtype;
  // fp16 Whisper encoder is broken (garbage/NaN) — never use it.
  return device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'q8', decoder_model_merged: 'q8' };
}

async function disposeLoaded() {
  if (asrPipe) {
    try {
      await asrPipe.dispose();
    } catch {}
    asrPipe = null;
  }
  if (vox) {
    try {
      await vox.model.dispose();
    } catch {}
    vox = null;
  }
  backend = null;
  asrKey = null;
  asrDevice = null;
}

// opts: { engine: 'browser'|'native', nativeUrl }
export async function loadASR(modelKey = DEFAULT_ASR, devicePref = 'auto', progress_callback, opts = {}) {
  if (opts.engine === 'native') {
    const h = await nativeHealth(opts.nativeUrl);
    if (!h) {
      throw new Error(
        'Native helper not reachable. Start it with  native/run.sh  (see README), or switch Engine to Browser in Settings.',
      );
    }
    await disposeLoaded();
    backend = 'native';
    nativeUrl = opts.nativeUrl;
    asrKey = `native:${h.model || ''}`;
    asrDevice = `native · ${h.engine || ''} · ${h.model || ''}`;
    return { backend, info: h };
  }

  const spec = ASR_MODELS[modelKey] || ASR_MODELS[DEFAULT_ASR];
  const device = await pickDevice(devicePref, spec);
  if (backend && asrKey === modelKey && asrDevice === device) return { backend };
  await disposeLoaded();

  if (spec.engine === 'voxtral') {
    const processor = await VoxtralProcessor.from_pretrained(spec.id, { progress_callback });
    const model = await VoxtralForConditionalGeneration.from_pretrained(spec.id, {
      dtype: spec.dtype,
      device: 'webgpu',
      progress_callback,
    });
    vox = { model, processor };
    backend = 'voxtral';
    asrDevice = 'webgpu';
  } else {
    try {
      asrPipe = await pipeline('automatic-speech-recognition', spec.id, {
        dtype: dtypeFor(device, spec),
        device,
        progress_callback,
      });
      asrDevice = device;
    } catch (e) {
      if (device === 'webgpu' && !spec.webgpuOnly) {
        // WebGPU init can fail on some drivers — silently fall back to WASM.
        asrPipe = await pipeline('automatic-speech-recognition', spec.id, {
          dtype: dtypeFor('wasm', spec),
          device: 'wasm',
          progress_callback,
        });
        asrDevice = 'wasm';
      } else {
        throw e;
      }
    }
    backend = 'whisper';
  }
  asrKey = modelKey;
  return { backend };
}

export function activeDevice() {
  return asrDevice;
}
export function activeBackend() {
  return backend;
}

export async function warmup() {
  try {
    if (backend === 'whisper') {
      await asrPipe(new Float32Array(16000), { language: 'en', task: 'transcribe' });
    } else if (backend === 'voxtral') {
      await voxtralGenerate(new Float32Array(16000), { language: 'en', task: 'transcribe' }, 4);
    }
  } catch {}
}

const VOX_LANG = { auto: 'en' };
async function voxtralGenerate(audio, { language, task }, maxNew = 200) {
  const lang = VOX_LANG[language] || language || 'en';
  const instruction =
    task === 'translate'
      ? 'Translate the speech in this audio into English. Reply with only the English translation.'
      : `lang:${lang}[TRANSCRIBE]`;
  const conversation = [
    { role: 'user', content: [{ type: 'audio' }, { type: 'text', text: instruction }] },
  ];
  const text = vox.processor.apply_chat_template(conversation, { tokenize: false });
  const inputs = await vox.processor(text, audio);
  const ids = await vox.model.generate({ ...inputs, max_new_tokens: maxNew });
  const newTokens = ids.slice(null, [inputs.input_ids.dims.at(-1), null]);
  return (vox.processor.batch_decode(newTokens, { skip_special_tokens: true })[0] || '').trim();
}

// audio: Float32Array @ 16 kHz. Returns trimmed text.
export async function transcribe(audio, { language = 'auto', task = 'transcribe' } = {}) {
  if (backend === 'native') return nativeTranscribe(nativeUrl, audio, { language, task });
  if (backend === 'voxtral') return voxtralGenerate(audio, { language, task });
  if (!asrPipe) throw new Error('ASR model not loaded');
  const opts = { task };
  if (language && language !== 'auto') opts.language = language;
  const out = await asrPipe(audio, opts);
  return (out?.text || '').trim();
}

// Long audio with timestamps (browser engines). Returns [{t0, t1, text}].
export async function transcribeLong(audio, { language = 'auto', task = 'transcribe' } = {}) {
  if (backend !== 'whisper') throw new Error('transcribeLong requires the Whisper backend');
  const opts = { task, chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  if (language && language !== 'auto') opts.language = language;
  const out = await asrPipe(audio, opts);
  return (out?.chunks || []).map((c) => ({
    t0: c.timestamp?.[0] ?? 0,
    t1: c.timestamp?.[1] ?? 0,
    text: (c.text || '').trim(),
  }));
}

export async function disposeASR() {
  await disposeLoaded();
}
