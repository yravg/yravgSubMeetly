/**
 * Status Native Helper lintas platform (Fase 2 — Windows/Linux/macOS).
 * Frontend-first: panduan per OS + indikator; health nyata dari /health.
 */

/** @typedef {'macos' | 'windows' | 'linux' | 'unknown'} HelperOS */

export function detectOs() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export const OS_GUIDES = {
  macos: {
    label: 'macOS',
    engine: 'mlx-whisper (Apple Silicon) / faster-whisper',
    steps: [
      'Jalankan ./scripts/ensure-native.sh atau native/run.sh',
      'Pastikan Native Messaging Host com.yraveragesubmin.helper terpasang',
      'Side Panel → Settings → Engine → Native helper',
    ],
  },
  windows: {
    label: 'Windows',
    engine: 'faster-whisper (CPU/CUDA)',
    steps: [
      'Install Python 3 + jalankan native\\run.sh (Git Bash) atau native\\run.bat bila ada',
      'Daftarkan Native Messaging Host untuk Chrome (manifest di native/)',
      'Buka http://127.0.0.1:17865/health — harus {ok:true}',
      'Di ekstensi pilih Engine → Native helper',
    ],
  },
  linux: {
    label: 'Linux',
    engine: 'faster-whisper (CPU/CUDA)',
    steps: [
      'python3 -m venv di native/ lalu ./native/run.sh',
      'Pasang host Native Messaging (JSON di ~/.config/google-chrome/NativeMessagingHosts/)',
      'Verifikasi curl -sf http://127.0.0.1:17865/health',
      'Side Panel → Native helper',
    ],
  },
  unknown: {
    label: 'OS ini',
    engine: 'faster-whisper atau mlx-whisper',
    steps: [
      'Ikuti README Native Helper',
      'Pastikan port 17865 menjawab /health',
    ],
  },
};

/** Nama unduhan seragam lintas OS (tanpa karakter bermasalah). */
export function exportBasename(title, kind) {
  const safe = String(title || 'subtitles')
    .replace(/[^\w\s.-]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'subtitles';
  const ext = kind === 'vtt' ? 'vtt' : kind === 'txt' ? 'txt' : 'srt';
  return `${safe}.${ext}`;
}

export const STUB_LARGE_FILE = {
  name: 'conference-long.wav',
  sizeBytes: 2.4 * 1024 * 1024 * 1024,
  progress: 0.42,
  cancellable: true,
  status: 'running', // idle | running | cancelling | cancelled | done | error
  stage: 'transcribe', // upload | queued | transcribe | translate | finalize | …
  elapsedS: 154,
};

export function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${Math.round(n / 1024)} KiB`;
}
