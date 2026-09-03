// Model & language registry shared by the side panel UI and the offscreen pipeline.

// ---------------------------------------------------------------------------
// ASR (Whisper) models — onnx-community ONNX exports for transformers.js.
// Sizes are approximate total downloads (encoder + decoder + tokenizer).
export const ASR_MODELS = {
  'whisper-tiny': {
    id: 'onnx-community/whisper-tiny',
    label: 'Whisper Tiny',
    sizeWebgpu: '~120 MB',
    sizeWasm: '~45 MB',
    note: 'fastest, lowest accuracy',
  },
  'whisper-base': {
    id: 'onnx-community/whisper-base',
    label: 'Whisper Base',
    sizeWebgpu: '~210 MB',
    sizeWasm: '~80 MB',
    note: 'recommended balance',
  },
  'whisper-small': {
    id: 'onnx-community/whisper-small',
    label: 'Whisper Small',
    sizeWebgpu: '~590 MB',
    sizeWasm: '~250 MB',
    note: 'good accuracy, slower on WASM',
  },
  'whisper-large-v3-turbo': {
    id: 'onnx-community/whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    sizeWebgpu: '~565 MB',
    sizeWasm: '—',
    note: 'high accuracy · WebGPU only',
    webgpuOnly: true,
    dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
  },
  'voxtral-mini': {
    id: 'onnx-community/Voxtral-Mini-3B-2507-ONNX',
    label: 'Voxtral Mini 3B',
    sizeWebgpu: '~2.7 GB',
    sizeWasm: '—',
    note: 'best quality · WebGPU + ≥16 GB RAM · slower',
    webgpuOnly: true,
    engine: 'voxtral',
    dtype: { embed_tokens: 'q4', audio_encoder: 'q4f16', decoder_model_merged: 'q4f16' },
  },
};
export const DEFAULT_ASR = 'whisper-base';

// Where inference runs.
//   browser : transformers.js inside the extension (WASM / WebGPU)
//   native  : the bundled local helper server (native/server.py) — Apple
//             Silicon GPU via MLX, whisper-large-v3-turbo, ~10-20× realtime
export const ENGINES = {
  browser: { label: 'Browser (in-extension, WASM/WebGPU)' },
  native: { label: 'Native helper (localhost · fastest & most accurate)' },
};
export const DEFAULT_NATIVE_URL = 'http://127.0.0.1:17865';

// ---------------------------------------------------------------------------
// Source languages Whisper handles well (subset of its 99). 'auto' lets the
// model detect per-utterance.
export const SOURCE_LANGS = [
  ['auto', 'Auto detect'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['ru', 'Russian'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
  ['uk', 'Ukrainian'],
];

export const TARGET_LANGS = [
  ['en', 'English'],
  ['zh', 'Chinese'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['ru', 'Russian'],
  ['it', 'Italian'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
];

// ---------------------------------------------------------------------------
// Opus-MT translation pairs available as Xenova ONNX exports (q8 ≈ 110–125 MB
// per pair). Key format: `${src}-${tgt}`.
export const MT_PAIRS = {
  'ja-en': { id: 'Xenova/opus-mt-ja-en', size: '~116 MB' },
  'zh-en': { id: 'Xenova/opus-mt-zh-en', size: '~120 MB' },
  'ko-en': { id: 'Xenova/opus-mt-ko-en', size: '~115 MB' },
  'de-en': { id: 'Xenova/opus-mt-de-en', size: '~115 MB' },
  'fr-en': { id: 'Xenova/opus-mt-fr-en', size: '~115 MB' },
  'es-en': { id: 'Xenova/opus-mt-es-en', size: '~115 MB' },
  'ru-en': { id: 'Xenova/opus-mt-ru-en', size: '~115 MB' },
  'it-en': { id: 'Xenova/opus-mt-it-en', size: '~115 MB' },
  'nl-en': { id: 'Xenova/opus-mt-nl-en', size: '~115 MB' },
  'pl-en': { id: 'Xenova/opus-mt-pl-en', size: '~115 MB' },
  'ar-en': { id: 'Xenova/opus-mt-ar-en', size: '~115 MB' },
  'vi-en': { id: 'Xenova/opus-mt-vi-en', size: '~115 MB' },
  'id-en': { id: 'Xenova/opus-mt-id-en', size: '~115 MB' },
  'uk-en': { id: 'Xenova/opus-mt-uk-en', size: '~115 MB' },
  'en-zh': { id: 'Xenova/opus-mt-en-zh', size: '~121 MB' },
  'en-de': { id: 'Xenova/opus-mt-en-de', size: '~115 MB' },
  'en-fr': { id: 'Xenova/opus-mt-en-fr', size: '~115 MB' },
  'en-es': { id: 'Xenova/opus-mt-en-es', size: '~115 MB' },
  'en-ru': { id: 'Xenova/opus-mt-en-ru', size: '~115 MB' },
  'en-it': { id: 'Xenova/opus-mt-en-it', size: '~115 MB' },
  'en-id': { id: 'Xenova/opus-mt-en-id', size: '~115 MB' },
  'en-vi': { id: 'Xenova/opus-mt-en-vi', size: '~115 MB' },
};

export const LANG_NAMES = Object.fromEntries([...SOURCE_LANGS, ...TARGET_LANGS]);

// "ja-en" -> "Japanese → English"
export function pairLabel(key) {
  const [s, t] = key.split('-');
  return `${LANG_NAMES[s] || s} → ${LANG_NAMES[t] || t}`;
}

// How a (source → target) request is fulfilled.
//   whisper-direct : Whisper task:'translate' emits English straight from audio
//   mt             : transcribe, then run an MT model (Chrome Translator API
//                    is tried first at runtime; Opus-MT pair is the fallback)
export function translationPlan(src, tgt, { dualLine = false, refineTranslation = false } = {}) {
  if (!tgt || src === tgt) return { mode: 'none' };
  const key = src !== 'auto' && src !== 'en' ? `${src}-${tgt}` : '';
  const pair = key ? MT_PAIRS[key] || null : null;
  const separateMt = dualLine || refineTranslation;
  // Prefer Opus-MT over Whisper speech-translation when we ship a pair (e.g.
  // ja→en). Browser Whisper often returns Japanese instead of English.
  if (pair && tgt === 'en' && !separateMt) {
    return { mode: 'mt', pairKey: key, pair };
  }
  if (tgt === 'en' && !separateMt) return { mode: 'whisper-direct' };
  // Pivot via English when no direct Opus-MT pair exists (e.g. ja → zh).
  if (!pair && src !== 'auto' && src !== 'en' && tgt !== 'en') {
    const leg1 = MT_PAIRS[`${src}-en`];
    const leg2 = MT_PAIRS[`en-${tgt}`];
    if (leg1 && leg2) {
      return {
        mode: 'mt',
        pairKey: key,
        pair: null,
        pivot: { leg1, leg2, leg1Key: `${src}-en`, leg2Key: `en-${tgt}` },
      };
    }
  }
  return { mode: 'mt', pairKey: key, pair };
}

// Whisper output strings that are hallucinations on music/silence.
export const HALLUCINATIONS = [
  'thank you for watching', 'thanks for watching', 'please subscribe',
  'subtitles by', 'subs by', 'amara.org', 'www.', 'copyright',
  'ご視聴ありがとうございました', 'ご視聴ありがとうございます', 'チャンネル登録',
  '字幕視聴ありがとうございました', '訂閱', '点赞', '字幕由', '謝謝觀看', '谢谢观看',
  '請不吝點贊訂閱', 'thank you.', 'thank you', 'bye.', 'you',
];

export function isHallucination(text) {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return HALLUCINATIONS.some((h) => t === h || (t.length < h.length + 6 && t.includes(h)));
}
