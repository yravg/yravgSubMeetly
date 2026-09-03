// Tiered local translation (main thread of the offscreen document):
//   1. whisper-direct — Whisper task:'translate' (audio → English, no MT model)
//   2. native helper LLM (when the native engine is on and has mlx-lm)
//   3. Chrome built-in Translator API (on-device, Chrome 138+) when creatable
//   4. Opus-MT (Xenova ONNX, q8, WASM) inside the AI worker — guaranteed-local
//   5. Opus-MT pivot via English (src→en→tgt) when no direct pair exists
import { translationPlan } from './registry.js';
import { nativeHealth, nativeTranslate, nativeTranslateRefine } from './native.js';

function bcp47(code) {
  return code === 'zh' ? 'zh-Hans' : code;
}

async function tryChromeTranslator(src, tgt) {
  if (typeof self.Translator === 'undefined') return null;
  for (const [s, t] of [
    [bcp47(src), bcp47(tgt)],
    [src, tgt],
  ]) {
    try {
      return await self.Translator.create({ sourceLanguage: s, targetLanguage: t });
    } catch {
      /* not available / needs activation / pair unsupported */
    }
  }
  return null;
}

function withRefine(kind, translate, refine, translateFast) {
  return {
    kind,
    translate,
    refine: refine || translate,
    translateFast: translateFast || translate,
  };
}

// Returns {kind, translate(text), refine(text, draft)}.
// rpc(op, args, onProgress) talks to the AI worker (for Opus-MT).
export async function makeTranslator(
  { srcLang, tgtLang, taskMode, dualLine, refineTranslation },
  progress_callback,
  { engine = 'browser', nativeUrl, rpc, skipChrome = false } = {},
) {
  const none = withRefine('none', async () => '', async () => '');
  if (taskMode !== 'translate') return none;

  const plan = translationPlan(srcLang, tgtLang, { dualLine, refineTranslation });
  if (plan.mode === 'none') return none;
  if (plan.mode === 'whisper-direct') {
    return withRefine('whisper-direct', async () => '', async () => '');
  }

  if (engine === 'native') {
    try {
      const h = await nativeHealth(nativeUrl);
      if (h?.translate) {
        const translate = async (text) => {
          if (!text) return '';
          try {
            return (await nativeTranslate(nativeUrl, text, srcLang, tgtLang)) || '';
          } catch (e) {
            console.warn('native translate failed', e);
            return '';
          }
        };
        const translateFast = async (text) => {
          if (!text) return '';
          try {
            return (await nativeTranslate(nativeUrl, text, srcLang, tgtLang, { fast: true })) || '';
          } catch (e) {
            console.warn('native fast translate failed', e);
            return translate(text);
          }
        };
        const refine = async (text, draft) => {
          if (!text) return draft || '';
          if (!draft) return translate(text);
          try {
            return (await nativeTranslateRefine(nativeUrl, text, draft, srcLang, tgtLang)) || translate(text);
          } catch (e) {
            console.warn('native refine failed', e);
            return translate(text);
          }
        };
        return withRefine('native-llm', translate, refine, translateFast);
      }
    } catch {
      /* helper down or no translation support — use browser tiers */
    }
  }

  // 'auto' source can't drive an MT pair — Chrome API might handle detection,
  // Opus-MT cannot. Skip Chrome API for force-translate (often returns unchanged text).
  const chrome_t =
    !skipChrome && srcLang !== 'auto' ? await tryChromeTranslator(srcLang, tgtLang) : null;
  if (chrome_t) {
    const translate = async (text) => {
      try {
        return (await chrome_t.translate(text)) || '';
      } catch {
        return '';
      }
    };
    return withRefine('chrome-api', translate, translate);
  }

  if (plan.pivot) {
    if (!rpc) throw new Error('Opus-MT pivot requires the AI worker');
    const { leg1, leg2, leg1Key, leg2Key } = plan.pivot;
    await rpc('mtLoad', { pair: leg1 }, (p) => progress_callback?.({ ...p, key: leg1Key }));
    await rpc('mtLoad', { pair: leg2 }, (p) => progress_callback?.({ ...p, key: leg2Key }));
    const translate = async (text) => {
      if (!text) return '';
      const mid = await rpc('mtTranslate', { pairId: leg1.id, text });
      return mid ? rpc('mtTranslate', { pairId: leg2.id, text: mid }) : '';
    };
    return withRefine('opus-mt-pivot', translate, translate);
  }

  if (!plan.pair) {
    throw new Error(
      `No local translation model available for ${srcLang} → ${tgtLang}. ` +
        `Download the suggested models, enable the native helper LLM, or pick a supported pair.`,
    );
  }
  if (!rpc) throw new Error('Opus-MT requires the AI worker');
  await rpc('mtLoad', { pair: plan.pair }, progress_callback);
  const translate = async (text) => (text ? rpc('mtTranslate', { pairId: plan.pair.id, text }) : '');
  return withRefine('opus-mt', translate, translate);
}
