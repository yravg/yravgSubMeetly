// Map raw pipeline / capture / model errors to a stable category so the panel
// can show a human-readable title + recovery hint instead of a stack-trace-like
// string. Pure and UI-free: the panel resolves `key` through i18n.
//
// Each rule: { key, test: RegExp, action?: 'pick' | 'settings' | 'retry' }
//   action = the one-click recovery the panel should offer (optional).
const RULES = [
  { key: 'cancelled', test: /^cancelled$|cancelled/i, action: null },
  { key: 'captureBlocked', test: /invoked|activeTab|not been invoked/i, action: 'pick' },
  { key: 'pageNotCapturable', test: /cannot be captured|normal website tab|chrome:\/\/|chrome-extension:/i, action: null },
  { key: 'noAudioShared', test: /no audio was shared|canRequestAudioTrack|no audio track/i, action: 'pick' },
  { key: 'captureFailed', test: /audio capture failed|getMediaStreamId|tabCapture|capture-ended|track ended/i, action: 'retry' },
  { key: 'fileTooLarge', test: /1\.5 ?GB|need ffmpeg|ffmpeg/i, action: 'settings' },
  { key: 'fileRead', test: /could not be read|NotReadableError|permission denied reading/i, action: null },
  { key: 'webgpu', test: /WebGPU/i, action: 'settings' },
  { key: 'nativeOffline', test: /native \/\w+ \d+|Failed to fetch|ECONNREFUSED|NetworkError|Load failed|helper (is )?(offline|not running|unavailable)|nativeMessaging unavailable/i, action: 'settings' },
  { key: 'outOfMemory', test: /out of memory|OOM|RangeError|allocation failed|memory/i, action: 'settings' },
  { key: 'vad', test: /VAD init failed/i, action: 'retry' },
  { key: 'modelLoad', test: /model|download|onnx|404|Failed to load|not loaded|checkpoint|HTTP error/i, action: 'settings' },
];

/**
 * @param {unknown} raw  Error, string, or object with `message`.
 * @returns {{ key: string, action: string | null, detail: string }}
 */
export function classifyError(raw) {
  const detail = String(raw?.message ?? raw ?? '').trim();
  for (const r of RULES) {
    if (r.test.test(detail)) return { key: r.key, action: r.action, detail };
  }
  return { key: 'generic', action: 'retry', detail };
}

/** i18n key helpers so callers don't hand-build strings. */
export const errTitleKey = (key) => `err_${key}_title`;
export const errHintKey = (key) => `err_${key}_hint`;
