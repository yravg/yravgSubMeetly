// AI worker: all heavy inference (Whisper / Voxtral / Opus-MT / downloads) runs
// here, on its own thread, so the side panel and offscreen audio graph never
// freeze while a model loads or decodes.
//
// Protocol: main → {id, op, args}; worker → {id, progress} (0..n times) then
// {id, result} | {id, error}.
import { configureHF, makeProgressAggregator } from './lib/hf-env.js';
import * as asr from './lib/asr.js';
import { preloadPair, releasePair, translateWith } from './lib/opus.js';
import { downloadModel, deleteModel } from './lib/models.js';

let settings = {};

async function handle(op, a, progress) {
  switch (op) {
    case 'configure':
      settings = a.settings || {};
      configureHF(settings, a.baseUrl);
      return true;

    case 'loadASR':
      await asr.loadASR(a.modelKey, a.devicePref, makeProgressAggregator(progress), a.engine || {});
      return { device: asr.activeDevice(), backend: asr.activeBackend() };

    case 'activeInfo':
      return { device: asr.activeDevice(), backend: asr.activeBackend() };

    case 'warmup':
      await asr.warmup();
      return true;

    case 'transcribe':
      return await asr.transcribe(a.audio, a.opts);

    case 'transcribeDetailed':
      return await asr.transcribeDetailed(a.audio, a.opts);

    case 'transcribeLong':
      return await asr.transcribeLong(a.audio, a.opts);

    case 'disposeASR':
      await asr.disposeASR();
      return true;

    case 'mtLoad':
      await preloadPair(a.pair, makeProgressAggregator(progress));
      return true;

    case 'mtTranslate':
      return await translateWith(a.pairId, a.text);

    case 'mtRelease':
      await releasePair(a.pair);
      return true;

    case 'download':
      return await downloadModel(a.key, a.devicePref, progress);

    case 'delete':
      await deleteModel(a.key);
      return true;

    default:
      throw new Error(`unknown op ${op}`);
  }
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data || {};
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    const result = await handle(op, args || {}, progress);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
