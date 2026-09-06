// Offscreen document: the entire local AI pipeline.
//   tab capture → speaker passthrough → Silero VAD → Whisper → translation
// plus model management and offline file jobs.
import { MicVAD, NonRealTimeVAD } from '@ricky0123/vad-web';
import { makeTranslator } from './lib/translate.js';
import { isHallucination } from './lib/registry.js';
import { sourceText, needsTranslation, lineDirection } from './lib/translation-utils.js';
import { nativeDraft, nativeHealth, nativeTranscribeFile, nativeTranscribeFileJob } from './lib/native.js';
import { detectLanguage } from './lib/lang-detect.js';
import { isConsecutive, interpreterPairs } from './lib/interpreter.js';
import {
  getOfflineInputFile,
  needsNativeFilePath,
  readOfflineInputBytes,
} from './lib/offline-io.js';

const MAX_UTTERANCE_MS = 25_000; // force-flush before Whisper's 30 s window
const MAX_QUEUE = 12;
const REFINE_INTERVAL_MS = 300; // ~0.3 s between draft updates (native draft pipeline targets 0.3–0.5 s)
const MIN_PARTIAL_SAMPLES = 4800; // 0.3 s @ 16 kHz before first draft
const PARTIAL_ASR_MAX_SAMPLES = 8000; // 0.5 s — fast draft ASR stays under ~100 ms on base Whisper

function toBG(type, data) {
  chrome.runtime.sendMessage({ target: 'bg', type, data }).catch(() => {});
}

// Offscreen documents have no chrome.storage access; the background worker
// attaches the current settings to every command message.
let curSettings = {};

function engineOpts() {
  return { engine: curSettings.engine || 'browser', nativeUrl: curSettings.nativeUrl };
}

// ---------------------------------------------------------------------------
// Sampel kinerja untuk tab Performance: satu baris per tahap (asr/mt/draft/refine)
// dengan mesin, perangkat, platform, pasangan bahasa, durasi audio, dan panjang teks.
// Dikirim ke background (disimpan + diteruskan ke panel). Tidak pernah melempar.
function perfPlatform() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('mac')) return 'macos';
  if (p.includes('win')) return 'windows';
  if (p.includes('linux')) return 'linux';
  return 'unknown';
}
function perfSample(stage, ms, extra = {}) {
  try {
    const engine = curSettings.engine || 'browser';
    const device = extra.device || (engine === 'native' ? 'native' : String(curSettings.device || 'wasm'));
    toBG('perf-sample', {
      at: new Date().toISOString(),
      stage,
      ms: Math.round(ms),
      engine,
      device,
      platform: perfPlatform(),
      src: extra.src || rt?.config?.srcLang || null,
      tgt: extra.tgt || rt?.config?.tgtLang || null,
      audioSec: extra.audioSec ?? null,
      chars: extra.chars ?? null,
      mode: extra.mode || 'realtime',
      source: 'session',
    });
  } catch { /* telemetri lokal tidak boleh mengganggu pipeline */ }
}

// ---------------------------------------------------------------------------
// AI worker RPC — inference runs off the main thread (see ai-worker.js).
const worker = new Worker(chrome.runtime.getURL('ai-worker.js'), { type: 'module' });
const pending = new Map();
let seq = 0;
worker.onmessage = (e) => {
  const m = e.data;
  const p = pending.get(m.id);
  if (!p) return;
  if (m.progress) {
    p.onProgress?.(m.progress);
    return;
  }
  pending.delete(m.id);
  if (m.error) p.reject(new Error(m.error));
  else p.resolve(m.result);
};
worker.onerror = (e) => console.error('ai-worker error', e.message || e);
function rpc(op, args = {}, onProgress, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, op, args }, transfer);
  });
}
async function configureWorker() {
  await rpc('configure', { settings: curSettings, baseUrl: chrome.runtime.getURL('') });
}
// Load the configured ASR engine; progress is reported under the model key.
async function loadEngine(config) {
  return rpc(
    'loadASR',
    { modelKey: config.asrModel, devicePref: curSettings.device || 'auto', engine: engineOpts() },
    (p) => toBG('model-progress', { key: config.asrModel, ...p }),
  );
}
function transcribeDetailed(audio, opts) {
  const ownsBuffer = audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength;
  const payload = ownsBuffer ? audio : audio.slice();
  return rpc('transcribeDetailed', { audio: payload, opts }, null, [payload.buffer]);
}
function transcribe(audio, opts) {
  // Only transfer when `audio` owns its whole buffer (realtime utterances are
  // fresh arrays). Offline segments are subarray views into one big buffer —
  // transferring would detach the shared buffer, so copy those instead.
  const ownsBuffer = audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength;
  const payload = ownsBuffer ? audio : audio.slice();
  return rpc('transcribe', { audio: payload, opts }, null, [payload.buffer]);
}
// Whisper-family engines report language as either an ISO code or a full
// English name ("chinese", "german", …) depending on backend/version. Map the
// common ones to ISO so `reported === a || reported === b` actually matches —
// naive slice(0,2) turned "chinese" into "ch" (not "zh") and "japanese" into
// "ja" only by coincidence.
const ENGINE_LANG_NAMES = {
  english: 'en',
  chinese: 'zh',
  mandarin: 'zh',
  german: 'de',
  spanish: 'es',
  japanese: 'ja',
  korean: 'ko',
  french: 'fr',
  italian: 'it',
  dutch: 'nl',
  polish: 'pl',
  vietnamese: 'vi',
  portuguese: 'pt',
  turkish: 'tr',
  russian: 'ru',
  ukrainian: 'uk',
  arabic: 'ar',
  thai: 'th',
  hindi: 'hi',
  indonesian: 'id',
};
function normalizeEngineLanguage(lang) {
  if (typeof lang !== 'string' || !lang) return '';
  const s = lang.trim().toLowerCase();
  if (!s) return '';
  if (ENGINE_LANG_NAMES[s]) return ENGINE_LANG_NAMES[s];
  // Already a short code (ISO 639-1, or a 639-2/BCP-47 tag like "zh-cn").
  return s.slice(0, 2);
}

function mtProgress(config) {
  return mtProgressPair(config.srcLang, config.tgtLang);
}
function mtProgressPair(srcLang, tgtLang) {
  return (p) => toBG('model-progress', { key: `${srcLang}-${tgtLang}`, ...p });
}

// ---------------------------------------------------------------------------
// Realtime session
const rt = {
  active: false,
  media: null,
  audioStream: null,
  ctx: null,
  vad: null,
  translator: null,
  translators: null, // two-way: { 'a>b': translator, 'b>a': translator }
  config: null,
  queue: [],
  processing: false,
  flushTimer: null,
  refineActive: false,
  refineTimer: null,
  speechChunks: [],
  partialDraft: { source: '', translation: '' },
  partialBusy: false,
};

/** Two-way (consecutive) interpreting: direction is decided per utterance. */
function twoWay() {
  return isConsecutive(rt.config?.interpreter);
}

function refineEnabled() {
  // Drafting mid-utterance needs a fixed source language; two-way has none.
  return !!(rt.config?.refineTranslation && rt.config?.taskMode === 'translate' && !twoWay());
}

function concatSpeechBuffer() {
  const chunks = rt.speechChunks;
  if (!chunks.length) return new Float32Array(0);
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function stopRefineLoop() {
  clearTimeout(rt.refineTimer);
  rt.refineTimer = null;
  rt.refineActive = false;
}

function partialAsrWindow() {
  const audio = concatSpeechBuffer();
  if (audio.length < MIN_PARTIAL_SAMPLES) return null;
  if (audio.length <= PARTIAL_ASR_MAX_SAMPLES) return audio;
  return audio.subarray(audio.length - PARTIAL_ASR_MAX_SAMPLES);
}

function schedulePartialRefine() {
  if (!rt.refineActive) return;
  clearTimeout(rt.refineTimer);
  rt.refineTimer = setTimeout(() => {
    void runPartialRefine();
  }, REFINE_INTERVAL_MS);
}

async function runPartialRefine() {
  if (!rt.refineActive || rt.partialBusy || !rt.active) {
    schedulePartialRefine();
    return;
  }
  const audio = partialAsrWindow();
  if (!audio) {
    schedulePartialRefine();
    return;
  }

  const t = rt.translator;
  if (!t || t.kind === 'none' || t.kind === 'whisper-direct') {
    schedulePartialRefine();
    return;
  }

  rt.partialBusy = true;
  try {
    const { srcLang, tgtLang } = rt.config;
    const useNativeDraft = (curSettings.engine || 'browser') === 'native';

    let text = '';
    let translation = '';

    if (useNativeDraft) {
      try {
        const tDraft = performance.now();
        const draft = await nativeDraft(curSettings.nativeUrl, audio, srcLang, tgtLang, {
          language: srcLang,
        });
        perfSample('draft', performance.now() - tDraft, { device: 'native', audioSec: audio.length / 16000, chars: (draft?.source || '').length });
        if (draft?.source) {
          text = draft.source;
          translation = draft.translation || '';
        }
      } catch (e) {
        console.warn('native draft failed, falling back', e);
      }
    }

    if (!text) {
      const tAsr = performance.now();
      text = await transcribe(audio, { language: srcLang, task: 'transcribe' });
      perfSample('asr-partial', performance.now() - tAsr, { audioSec: audio.length / 16000, chars: (text || '').length });
      if (!text || isHallucination(text)) return;
      if (text === rt.partialDraft.source && rt.partialDraft.translation) return;

      const translateFn = t.translateFast || t.translate;
      const tMt = performance.now();
      translation = await translateFn(text);
      perfSample('mt-partial', performance.now() - tMt, { chars: text.length, device: t.kind === 'chrome-translator' ? 'chrome-translator' : undefined });
    } else if (isHallucination(text)) {
      return;
    }

    if (text === rt.partialDraft.source && rt.partialDraft.translation) return;

    rt.partialDraft = { source: text, translation: translation || text };

    const t1 = await getVideoTime();
    const fullLen = concatSpeechBuffer().length;
    const durationSec = fullLen / 16000;
    const t0 = Math.max(0, t1 - durationSec);

    toBG('subtitle', {
      interim: true,
      partial: true,
      source: text,
      translation: translation || text,
      rawSource: text,
      rawTranslation: translation || '',
      t0,
      t1,
    });
  } catch (e) {
    console.warn('partial refine failed', e);
  } finally {
    rt.partialBusy = false;
    schedulePartialRefine();
  }
}

function startRefineLoop() {
  stopRefineLoop();
  rt.refineActive = true;
  rt.speechChunks = [];
  rt.partialDraft = { source: '', translation: '' };
  void runPartialRefine();
}

async function startCapture({ streamId, captureType = 'tab', config, settings }) {
  await stopCapture();
  if (settings) curSettings = settings;
  rt.config = config;
  rt.active = true;

  try {
    // Grab the stream FIRST — the streamId expires within seconds.
    if (captureType === 'media') {
      // Lab / browser-tab harness: MediaStream already acquired via
      // getDisplayMedia or <audio|video>.captureStream() (same page as offscreen).
      const stream = globalThis.__ltsCaptureStream;
      if (!stream || typeof stream.getAudioTracks !== 'function') {
        throw new Error('No lab capture stream — Start demo audio or Pick (share tab audio).');
      }
      rt.media = stream;
    } else if (captureType === 'desktop') {
      // desktopCapture picker stream: Chrome requires requesting video along
      // with audio; we only need the audio and stop the video track at once.
      rt.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId },
        },
        video: {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId },
        },
      });
      for (const track of rt.media.getVideoTracks()) track.stop();
    } else {
      rt.media = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
        },
        video: false,
      });
    }
  } catch (e) {
    rt.active = false;
    toBG('pipeline-error', { message: `Audio capture failed: ${e.message || e}` });
    return;
  }

  const audioTrack = rt.media.getAudioTracks()[0];
  if (!audioTrack) {
    rt.active = false;
    toBG('pipeline-error', {
      message: 'No audio track was shared. Re-open the picker and tick “Also share tab audio”.',
    });
    await stopCapture();
    return;
  }
  // VAD and the audio graph should only ever see the audio track.
  rt.audioStream = new MediaStream([audioTrack]);

  rt.ctx = new AudioContext();
  const src = rt.ctx.createMediaStreamSource(rt.audioStream);
  if (captureType === 'tab') {
    // chrome.tabCapture silences the tab — route audio back to the speakers.
    // Desktop / lab media already play locally (or via a demo <audio>), so
    // passthrough would echo.
    src.connect(rt.ctx.destination);
  }

  audioTrack.addEventListener('ended', () => {
    if (rt.active) toBG('capture-ended', {});
  });

  let info;
  try {
    await configureWorker();
    toBG('pipeline-status', { state: 'loading', detail: 'asr' });
    info = await loadEngine(config);

    toBG('pipeline-status', { state: 'loading', detail: 'translator' });
    rt.translator = null;
    rt.translators = null;
    if (twoWay()) {
      // Both directions must be ready before the first utterance arrives.
      rt.translators = {};
      for (const [from, to] of interpreterPairs(config.interpreter)) {
        rt.translators[`${from}>${to}`] = await makeTranslator(
          { ...config, srcLang: from, tgtLang: to, taskMode: 'translate', refineTranslation: false },
          mtProgressPair(from, to),
          { ...engineOpts(), rpc },
        );
      }
    } else {
      rt.translator = await makeTranslator(config, mtProgress(config), { ...engineOpts(), rpc });
    }

    toBG('pipeline-status', { state: 'warmup', device: info.device });
    await rpc('warmup');
  } catch (e) {
    toBG('pipeline-error', { message: String(e.message || e) });
    await stopCapture();
    return;
  }

  if (!rt.active) return; // stopped while loading

  // VAD-gated segmentation of the live tab audio.
  try {
    rt.vad = await MicVAD.new({
      getStream: async () => rt.audioStream,
      model: 'v5',
      baseAssetPath: chrome.runtime.getURL('vad/'),
      onnxWASMBasePath: chrome.runtime.getURL('vad/ort/'),
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('vad/ort/');
        ort.env.wasm.numThreads = 1;
      },
      // media audio has music/effects — be stricter than the defaults
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 400,
      preSpeechPadMs: 200,
      minSpeechMs: 250,
      submitUserSpeechOnPause: true,
      onFrameProcessed: (_probs, frame) => {
        if (rt.refineActive) {
          rt.speechChunks.push(frame.slice());
        }
      },
      onSpeechStart: () => {
        toBG('speech-start', {});
        clearTimeout(rt.flushTimer);
        if (refineEnabled()) {
          startRefineLoop();
        } else {
          toBG('subtitle', { interim: true });
        }
        rt.flushTimer = setTimeout(() => {
          // continuous speech — force a segment so we stay under 30 s
          if (rt.vad) {
            try {
              rt.vad.pause();
              rt.vad.start();
            } catch {}
          }
        }, MAX_UTTERANCE_MS);
      },
      onSpeechEnd: (audio) => {
        clearTimeout(rt.flushTimer);
        const draft = refineEnabled() ? { ...rt.partialDraft } : null;
        stopRefineLoop();
        rt.speechChunks = [];
        enqueue(audio, draft);
      },
      onVADMisfire: () => {},
    });
    rt.vad.start();
    toBG('pipeline-status', { state: 'listening', device: info.device });
  } catch (e) {
    toBG('pipeline-error', { message: `VAD init failed: ${e.message || e}` });
    await stopCapture();
  }
}

function enqueue(audio, draft = null) {
  if (!rt.active) return;
  rt.queue.push({ audio, draft });
  // Latency guard: if inference falls behind, drop the oldest utterances.
  while (rt.queue.length > MAX_QUEUE) rt.queue.shift();
  processQueue();
}

async function processQueue() {
  if (rt.processing) return;
  rt.processing = true;
  try {
    while (rt.active && rt.queue.length > 0) {
      const item = rt.queue.shift();
      try {
        await processUtterance(item);
      } catch (e) {
        console.warn('utterance failed', e);
      }
    }
  } finally {
    rt.processing = false;
  }
}

async function getVideoTime() {
  const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'get-video-time' }).catch(() => null);
  return r?.time ?? 0;
}

async function isCachedRange(t0, t1) {
  const r = await chrome.runtime
    .sendMessage({ target: 'bg', type: 'check-cache-range', data: { t0, t1 } })
    .catch(() => null);
  return !!r?.cached;
}

async function processUtterance({ audio, draft = null }) {
  const { srcLang, taskMode, refineTranslation } = rt.config;
  const t = rt.translator;
  const durationSec = audio.length / 16000;
  const t1 = await getVideoTime();
  const t0 = Math.max(0, t1 - durationSec);

  try {
    // Skip only when this exact segment is already in the transcript cache.
    if (await isCachedRange(t0, t1)) return;

    if (twoWay()) {
      await processTwoWayUtterance(audio, t0, t1);
      return;
    }

    if (t && t.kind === 'whisper-direct') {
      const tWd = performance.now();
      const en = await transcribe(audio, { language: srcLang, task: 'translate' });
      perfSample('asr', performance.now() - tWd, { audioSec: audio.length / 16000, chars: (en || '').length });
      if (isHallucination(en)) return;
      toBG('subtitle', {
        final: true,
        source: '',
        translation: en,
        rawSource: '',
        rawTranslation: en,
        t0,
        t1,
      });
      return;
    }

    const tAsr = performance.now();
    const text = await transcribe(audio, { language: srcLang, task: 'transcribe' });
    perfSample('asr', performance.now() - tAsr, { audioSec: audio.length / 16000, chars: (text || '').length });
    if (isHallucination(text)) return;

    let translation = '';
    if (taskMode === 'translate' && t && t.kind !== 'none') {
      const draftText = draft?.translation || '';
      const tMt = performance.now();
      const mtDevice = t.kind === 'chrome-translator' ? 'chrome-translator' : undefined;
      if (refineTranslation && draftText && typeof t.refine === 'function') {
        translation = await t.refine(text, draftText);
        perfSample('refine', performance.now() - tMt, { chars: text.length, device: mtDevice });
      } else {
        translation = await t.translate(text);
        perfSample('mt', performance.now() - tMt, { chars: text.length, device: mtDevice });
      }
      if (!translation) console.warn('translation empty for:', text.slice(0, 80));
    }
    const displayTranslation = taskMode === 'translate' ? translation || text : translation || text;
    toBG('subtitle', {
      final: true,
      source: text,
      translation: displayTranslation,
      rawSource: text,
      rawTranslation: translation,
      t0,
      t1,
    });
  } finally {
    toBG('subtitle', { interim: false });
  }
}

/**
 * One utterance in two-way mode: transcribe with language:'auto', work out
 * which of the two conversation languages was spoken, and translate it into
 * the other one.
 */
async function processTwoWayUtterance(audio, t0, t1) {
  const { a, b } = rt.config.interpreter;
  // transcribeDetailed transfers the buffer it is handed; when one direction is
  // Whisper-direct we may need the samples again, so send it a copy.
  const reuseAudio = Object.values(rt.translators || {}).some((x) => x?.kind === 'whisper-direct');
  const out = await transcribeDetailed(reuseAudio ? audio.slice() : audio, {
    language: 'auto',
    task: 'transcribe',
  });
  const text = (out?.text || '').trim();
  if (!text || isHallucination(text)) return;

  // Trust the engine only when it actually named one of our two languages.
  const reported = normalizeEngineLanguage(out?.language);
  const src = reported === a || reported === b ? reported : detectLanguage(text, [a, b]);
  const tgt = src === a ? b : a;

  const t = rt.translators?.[`${src}>${tgt}`];
  let translation = '';
  if (t && t.kind === 'whisper-direct') {
    // tgt is English — Whisper's own translate task does it without an MT model.
    translation = await transcribe(audio, { language: src, task: 'translate' });
    if (isHallucination(translation)) translation = '';
  } else if (t && t.kind !== 'none') {
    translation = await t.translate(text);
  }
  if (!translation) console.warn('two-way translation empty for:', text.slice(0, 80));

  toBG('subtitle', {
    final: true,
    source: text,
    translation: translation || text,
    rawSource: text,
    rawTranslation: translation,
    dir: { src, tgt },
    t0,
    t1,
  });
}

async function stopCapture() {
  rt.active = false;
  clearTimeout(rt.flushTimer);
  stopRefineLoop();
  rt.speechChunks = [];
  rt.partialDraft = { source: '', translation: '' };
  rt.partialBusy = false;
  rt.queue = [];
  rt.translators = null;
  if (rt.vad) {
    try {
      rt.vad.destroy();
    } catch {}
    rt.vad = null;
  }
  if (rt.media) {
    for (const track of rt.media.getTracks()) track.stop();
    rt.media = null;
  }
  rt.audioStream = null;
  if (rt.ctx) {
    try {
      await rt.ctx.close();
    } catch {}
    rt.ctx = null;
  }
  rt.translator = null;
}

// ---------------------------------------------------------------------------
// Offline file job
const off = { running: false, cancelled: false, /** @type {null | { cancel: () => Promise<void> }} */ job: null };

async function decodeToMono16k(arrayBuffer) {
  const ac = new AudioContext();
  let buf;
  try {
    buf = await ac.decodeAudioData(arrayBuffer);
  } finally {
    ac.close().catch(() => {});
  }
  const oc = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const node = oc.createBufferSource();
  node.buffer = buf;
  node.connect(oc.destination);
  node.start();
  const rendered = await oc.startRendering();
  return rendered.getChannelData(0);
}

async function readOfflineInput() {
  return readOfflineInputBytes();
}

async function runOfflineNativeFile({ name, size, config, settings, emit, translator }) {
  const url = settings.nativeUrl;
  const health = await nativeHealth(url, 3000);
  if (!health?.ok) {
    throw new Error(
      'Files over 1.5 GB need the native helper running. Open Settings → Engine → Native and click Start (or run ./scripts/start-native.sh).',
    );
  }
  if (!health.ffmpeg) {
    throw new Error(
      'Files over 1.5 GB need ffmpeg on the helper machine (macOS: brew install ffmpeg · Windows: winget install Gyan.FFmpeg · Linux: apt install ffmpeg), then Restart the helper.',
    );
  }

  const file = await getOfflineInputFile();
  const whisperDirect = translator.kind === 'whisper-direct';
  const asrTask =
    config.taskMode === 'translate' && whisperDirect ? 'translate' : 'transcribe';
  const lf = { name, sizeBytes: size || file.size || 0, large: true };

  let segments;
  if (health.features?.transcribe_file_jobs) {
    // Async job: upload progress (XHR), then poll /jobs/:id — cancel works mid-flight.
    const ctl = {};
    off.job = ctl;
    try {
      segments = await nativeTranscribeFileJob(
        url,
        file,
        name,
        { language: config.srcLang, task: asrTask, sizeBytes: lf.sizeBytes },
        (p) => emit('offline-progress', { ...lf, ...p, pct: Math.round(p.pct * 0.88) }),
        ctl,
      );
    } finally {
      off.job = null;
    }
  } else {
    // Old helper without job endpoints: single synchronous POST, coarse progress.
    emit('offline-progress', { ...lf, stage: 'upload', pct: 3 });
    segments = await nativeTranscribeFile(
      url,
      file,
      name,
      { language: config.srcLang, task: asrTask },
      (pct) => emit('offline-progress', { ...lf, stage: 'transcribe', pct: 3 + pct * 0.85 }),
    );
  }
  if (off.cancelled) throw new Error('cancelled');

  const lines = [];
  const dual = !!config.dualLine;
  for (let i = 0; i < segments.length; i++) {
    if (off.cancelled) throw new Error('cancelled');
    const { t0, t1, text } = segments[i];
    let src = '';
    let tgt = '';
    if (whisperDirect) {
      tgt = text;
      if (isHallucination(tgt)) continue;
    } else {
      src = text;
      if (isHallucination(src)) continue;
      if (config.taskMode === 'translate' && translator.kind !== 'none') {
        tgt = await translator.translate(src);
      }
    }
    const outSrc = dual ? src : '';
    const outTgt = tgt || (dual ? '' : src);
    const line = { t0, t1, src: outSrc, tgt: outTgt };
    lines.push(line);
    emit('offline-line', { line, idx: i + 1, total: segments.length });
    emit('offline-progress', {
      ...lf,
      stage: config.taskMode === 'translate' && !whisperDirect ? 'translate' : 'finalize',
      pct: 88 + (12 * (i + 1)) / segments.length,
      idx: i + 1,
      total: segments.length,
    });
  }
  return lines;
}

function saveOffline(name, config, lines) {
  toBG('save-history', {
    id: `off-${Date.now()}`,
    ts: Date.now(),
    mode: 'offline',
    title: name,
    srcLang: config.srcLang,
    tgtLang: config.tgtLang,
    lines: lines.map((l) => ({
      t: Math.round(l.t0 * 1000),
      t1: Math.round(l.t1 * 1000),
      src: l.src,
      tgt: l.tgt,
    })),
  });
}

async function runOfflineJob({ name, size = 0, config, settings }) {
  if (off.running) return;
  off.running = true;
  off.cancelled = false;
  if (settings) curSettings = settings;
  const emit = (type, data) => toBG(type, data);
  const large = needsNativeFilePath(size);
  try {
    await configureWorker();
    emit('offline-progress', { stage: 'load-models', pct: 1 });
    const info = await loadEngine(config);
    const translator = await makeTranslator(config, mtProgress(config), { ...engineOpts(), rpc });

    if (large) {
      const lines = await runOfflineNativeFile({ name, size, config, settings: curSettings, emit, translator });
      saveOffline(name, config, lines);
      emit('offline-done', { lines });
      return;
    }

    const raw = await readOfflineInput();

    // Decode + VAD-segment in the browser, then transcribe each segment. The
    // browser handles container formats (mp3/mp4/m4a/wav/webm/ogg) via
    // decodeAudioData; the ASR backend (browser or native) transcribes the raw
    // PCM segments — so native offline needs no ffmpeg on the helper side.
    emit('offline-progress', { stage: 'decode', pct: 3 });
    const audio = await decodeToMono16k(raw);

    emit('offline-progress', { stage: 'vad', pct: 5 });
    const vad = await NonRealTimeVAD.new({
      modelURL: chrome.runtime.getURL('vad/silero_vad_legacy.onnx'),
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('vad/ort/');
        ort.env.wasm.numThreads = 1;
      },
      positiveSpeechThreshold: 0.55,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 600,
      preSpeechPadMs: 300,
      minSpeechMs: 300,
    });

    const segments = [];
    const MAX_SEG = 28 * 16000;
    for await (const { audio: seg, start, end } of vad.run(audio, 16000)) {
      if (off.cancelled) throw new Error('cancelled');
      // split very long continuous speech into <28 s windows
      for (let i = 0; i < seg.length; i += MAX_SEG) {
        const part = seg.subarray(i, Math.min(i + MAX_SEG, seg.length));
        const t0 = start / 1000 + i / 16000;
        segments.push({ part, t0, t1: t0 + part.length / 16000 });
      }
    }
    emit('offline-progress', { stage: 'transcribe', pct: 8, segments: segments.length });

    const lines = [];
    for (let i = 0; i < segments.length; i++) {
      if (off.cancelled) throw new Error('cancelled');
      const { part, t0, t1 } = segments[i];
      let src = '';
      let tgt = '';
      if (translator.kind === 'whisper-direct') {
        tgt = await transcribe(part, { language: config.srcLang, task: 'translate' });
        if (isHallucination(tgt)) continue;
      } else {
        src = await transcribe(part, { language: config.srcLang, task: 'transcribe' });
        if (isHallucination(src)) continue;
        if (config.taskMode === 'translate' && translator.kind !== 'none') {
          tgt = await translator.translate(src);
        }
      }
      const dual = !!config.dualLine;
      const outSrc = dual ? src : '';
      const outTgt = tgt || (dual ? '' : src);
      const line = { t0, t1, src: outSrc, tgt: outTgt };
      lines.push(line);
      emit('offline-line', { line, idx: i + 1, total: segments.length });
      emit('offline-progress', {
        stage: 'transcribe',
        pct: 8 + (92 * (i + 1)) / segments.length,
        idx: i + 1,
        total: segments.length,
      });
    }

    saveOffline(name, config, lines);
    emit('offline-done', { lines });
  } catch (e) {
    if (String(e.message).includes('cancelled')) {
      emit('offline-error', { message: 'Cancelled', cancelled: true });
    } else {
      emit('offline-error', { message: String(e.message || e) });
    }
  } finally {
    off.running = false;
  }
}

async function runForceTranslate({ lines, config, settings, retranslate = false }) {
  if (settings) curSettings = settings;
  const cfg = {
    ...(rt.config || {}),
    ...(config || {}),
    taskMode: 'translate',
    dualLine: true,
  };
  if (cfg.taskMode !== 'translate') throw new Error('Not in translate mode');
  if (!cfg.srcLang || !cfg.tgtLang) throw new Error('Missing source or target language');

  await configureWorker();

  // Two-way lines carry their own direction, so a single cfg translator would
  // overwrite half the transcript with garbage. Build (and cache) one text
  // translator per direction actually present in the batch.
  const built = new Map();
  async function translatorFor(from, to) {
    const key = `${from}>${to}`;
    if (built.has(key)) return built.get(key);
    let t = null;
    try {
      t = await makeTranslator(
        { ...cfg, srcLang: from, tgtLang: to },
        mtProgressPair(from, to),
        { ...engineOpts(), rpc, skipChrome: true },
      );
    } catch (e) {
      console.warn(`force-translate: no translator for ${key}`, e);
    }
    // whisper-direct needs the audio, which force-translate does not have.
    if (!t || t.kind === 'none' || t.kind === 'whisper-direct') t = null;
    built.set(key, t);
    return t;
  }

  let translated = 0;
  let candidates = 0; // lines that actually wanted translating
  let usable = 0; // …of those, the ones a translator exists for
  // Directions we had to give up on, and how many lines each one cost —
  // silently translating "some" of a two-way transcript is a lie.
  const skippedByDir = new Map();
  for (const line of lines || []) {
    const src = sourceText(line);
    if (!src) continue;
    const { srcLang: from, tgtLang: to } = lineDirection(line, cfg.srcLang, cfg.tgtLang);
    if (!from || !to || from === to) continue;
    if (!retranslate && !needsTranslation(line, cfg.srcLang, cfg.tgtLang)) continue;
    candidates++;

    const t = await translatorFor(from, to);
    if (!t) {
      const key = `${from} \u2192 ${to}`;
      skippedByDir.set(key, (skippedByDir.get(key) || 0) + 1);
      continue;
    }
    usable++;

    const out = (await t.translate(src)).trim();
    if (!out || out === src) continue;

    toBG('subtitle', {
      final: true,
      source: src,
      translation: out,
      rawSource: src,
      rawTranslation: out,
      ...(line.dir ? { dir: line.dir } : {}),
      t0: line.t0 ?? 0,
      t1: line.t1 ?? (line.t0 ?? 0) + 2,
    });
    translated++;
  }
  if (candidates && !usable) {
    const missing = [...built.entries()].filter(([, t]) => !t).map(([k]) => k.replace('>', ' \u2192 '));
    throw new Error(
      `No text translation model for ${missing.join(', ') || `${cfg.srcLang} \u2192 ${cfg.tgtLang}`}. Download the pair model in Settings.`,
    );
  }
  let skipped = 0;
  for (const n of skippedByDir.values()) skipped += n;
  return {
    translated,
    skipped,
    skippedDirections: [...skippedByDir.keys()],
  };
}

// ---------------------------------------------------------------------------
// Message handling
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'offscreen') return;
  switch (msg.type) {
    case 'start-capture':
      startCapture(msg.data);
      break;
    case 'stop-capture':
      stopCapture();
      break;
    case 'update-config':
      if (msg.data?.config) {
        const prevRefine = refineEnabled();
        rt.config = { ...rt.config, ...msg.data.config };
        if (prevRefine && !refineEnabled()) stopRefineLoop();
      }
      break;
    case 'force-translate':
      (async () => {
        try {
          const res = await runForceTranslate(msg.data || {});
          toBG('force-translate-done', res);
        } catch (e) {
          toBG('force-translate-done', { translated: 0, error: String(e.message || e) });
        }
      })();
      break;
    case 'offline-process':
      runOfflineJob(msg.data);
      break;
    case 'offline-cancel':
      off.cancelled = true;
      // Large-file job on the helper: abort the upload / ask the helper to stop.
      off.job?.cancel?.().catch(() => {});
      break;
    case 'model-download': {
      (async () => {
        const key = msg.data.key;
        try {
          if (msg.data.settings) curSettings = msg.data.settings;
          await configureWorker();
          const { bytes } = await rpc(
            'download',
            { key, devicePref: curSettings.device || 'auto' },
            (p) => toBG('model-progress', p),
          );
          toBG('mark-model', { key, extra: { bytes } });
          toBG('model-done', { key });
        } catch (e) {
          toBG('model-error', { key, message: String(e.message || e) });
        }
      })();
      break;
    }
    case 'model-delete': {
      (async () => {
        const key = msg.data.key;
        try {
          await rpc('delete', { key });
          toBG('mark-model', { key, deleted: true });
          toBG('model-done', { key, deleted: true });
        } catch (e) {
          toBG('model-error', { key, message: String(e.message || e) });
        }
      })();
      break;
    }
  }
});
