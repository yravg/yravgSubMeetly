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

// Steps per UI language; `guideFor` falls back to English (zh reads commands and paths fine in English).
export const OS_GUIDES = {
  macos: {
    label: 'macOS',
    engine: 'mlx-whisper (Apple Silicon) / faster-whisper',
    steps: {
      en: [
        'Run ./scripts/ensure-native.sh or native/run.sh',
        'Make sure the Native Messaging host com.yraveragesubmin.helper is installed',
        'Side Panel → Settings → Engine → Native helper',
      ],
      id: [
        'Jalankan ./scripts/ensure-native.sh atau native/run.sh',
        'Pastikan Native Messaging Host com.yraveragesubmin.helper terpasang',
        'Side Panel → Settings → Engine → Native helper',
      ],
    },
  },
  windows: {
    label: 'Windows',
    engine: 'faster-whisper (CPU/CUDA)',
    steps: {
      en: [
        'Install Python 3, then run native\\run.bat (or native\\run.sh in Git Bash)',
        'Register the Native Messaging host for Chrome (manifest in native/)',
        'Open http://127.0.0.1:17865/health — it must answer {ok:true}',
        'In the extension choose Engine → Native helper',
      ],
      id: [
        'Install Python 3 + jalankan native\\run.sh (Git Bash) atau native\\run.bat bila ada',
        'Daftarkan Native Messaging Host untuk Chrome (manifest di native/)',
        'Buka http://127.0.0.1:17865/health — harus {ok:true}',
        'Di ekstensi pilih Engine → Native helper',
      ],
    },
  },
  linux: {
    label: 'Linux',
    engine: 'faster-whisper (CPU/CUDA)',
    steps: {
      en: [
        'Create a venv with python3 -m venv in native/, then run ./native/run.sh',
        'Install the Native Messaging host (JSON in ~/.config/google-chrome/NativeMessagingHosts/)',
        'Check with curl -sf http://127.0.0.1:17865/health',
        'Side Panel → Native helper',
      ],
      id: [
        'python3 -m venv di native/ lalu ./native/run.sh',
        'Pasang host Native Messaging (JSON di ~/.config/google-chrome/NativeMessagingHosts/)',
        'Verifikasi curl -sf http://127.0.0.1:17865/health',
        'Side Panel → Native helper',
      ],
    },
  },
  unknown: {
    label: { en: 'this OS', id: 'OS ini', zh: '此系统' },
    engine: 'faster-whisper / mlx-whisper',
    steps: {
      en: ['Follow the Native Helper README', 'Make sure port 17865 answers /health'],
      id: ['Ikuti README Native Helper', 'Pastikan port 17865 menjawab /health'],
    },
  },
};

const pick = (v, lang) => (typeof v === 'string' ? v : v[lang] || v.en);

/** The guide for one OS in one UI language: { label, engine, steps[] }. */
export function guideFor(os, lang = 'en') {
  const g = OS_GUIDES[os] || OS_GUIDES.unknown;
  return { label: pick(g.label, lang), engine: g.engine, steps: pick(g.steps, lang) };
}

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
