/**
 * Panduan pemasangan + pemecahan masalah Native Helper (Windows / Linux / macOS).
 *
 * Murni data + logika (tanpa DOM) supaya bisa diuji di Node:
 *   node --test test/helper-guide.test.mjs
 *
 * - INSTALL_GUIDES     : langkah pemasangan per OS, perintah persis dari native/SETUP.md
 * - TROUBLESHOOTING    : gejala → penyebab → perbaikan, terhubung ke id pemeriksaan
 * - runDiagnostics()   : membaca /health + konteks ekstensi → daftar pemeriksaan ok/warn/fail
 * - relevantTroubleshooting(): urutkan entri: yang terkait pemeriksaan gagal dulu
 *
 * Semua teks antarmuka lewat HELPER_GUIDE_I18N (en/id); locale lain mundur ke en.
 */

export const HELPER_PORT = 17865;
export const HELPER_URL = `http://127.0.0.1:${HELPER_PORT}`;
export const HOST_NAME = 'com.localtranssub.helper';

/** @typedef {'macos' | 'windows' | 'linux'} GuideOS */
export const GUIDE_OS_ORDER = /** @type {GuideOS[]} */ (['windows', 'linux', 'macos']);

/** Petakan hasil detectOs() (bisa 'unknown') ke tab panduan. */
export function guideOsFor(os) {
  return GUIDE_OS_ORDER.includes(os) ? os : 'linux';
}

const en = {
  title: 'Install guide & troubleshooting',
  subtitle: 'Get the Native Helper running on this machine — everything stays on 127.0.0.1.',
  tabs: 'Operating system',
  prereqs: 'Before you start',
  steps: 'Install steps',
  copy: 'Copy',
  copied: 'Copied',
  hostManifest: 'Native Messaging manifest',
  diagnostics: 'Diagnostics',
  rerun: 'Re-check',
  openDocs: 'Full guide (native/SETUP.md)',
  troubleshooting: 'Troubleshooting',
  cause: 'Why',
  fix: 'Fix',
  relatedFail: 'Flagged by diagnostics',
  extIdHint: 'Replace <EXT_ID> with the extension ID shown on chrome://extensions (Developer mode).',
  stateOk: 'OK',
  stateWarn: 'Check',
  stateFail: 'Problem',
  stateUnknown: 'Unknown',
  allGood: 'Everything looks good — the helper is reachable and ready.',
  offlineIntro: 'The helper is not reachable. Work through the install steps, then Re-check.',
  browserEngineNote: 'Engine is set to Browser — the helper is optional. Switch to Native helper in Settings to use it.',
  os: { windows: 'Windows', linux: 'Linux', macos: 'macOS' },
  osEngine: {
    windows: 'faster-whisper · CPU or CUDA',
    linux: 'faster-whisper · CPU or CUDA',
    macos: 'mlx-whisper (Apple Silicon) · faster-whisper fallback',
  },
  checks: {
    reachable: 'Helper reachable on 127.0.0.1:17865',
    platform: 'Helper OS matches this browser',
    engineSel: 'Extension engine set to Native helper',
    host: 'Native Messaging host (Start/Stop from the panel)',
    ffmpeg: 'ffmpeg available to the helper',
    gpu: 'Hardware acceleration',
    translate: 'On-device translation LLM',
    bigFile: 'Large-file jobs (>2 GiB) supported',
  },
  detail: {
    reachableOk: (m) => `${m}`,
    reachableFail: 'GET /health did not answer — the helper process is not running or the port is blocked.',
    platformOk: (p) => `helper reports ${p}`,
    platformWarn: (p, o) => `helper reports ${p} but this browser is on ${o} — remote helper?`,
    engineSelOk: 'native',
    engineSelWarn: 'browser — the helper is not used for captions until you switch.',
    hostOk: 'connected — Start / Stop / Restart work from Settings.',
    hostForbidden: 'installed but this extension ID is not in the host manifest allowed_origins.',
    hostCrashed: 'manifest found but the host process failed to start — check the Python path inside it.',
    hostTimeout: 'no reply from the host — it may be hung; restart Chrome and re-check.',
    hostWarn: 'not registered — Start/Stop need the host manifest; you can still run ./run.sh manually.',
    hostUnknown: 'native messaging is not available in this browser.',
    ffmpegOk: 'found',
    ffmpegFail: 'missing — media files (mp4, mkv, m4a…) cannot be decoded.',
    gpuOk: (d) => `${d}`,
    gpuWarn: 'cpu — transcription works but is slower; CUDA needs an NVIDIA GPU + CUDA runtime.',
    translateOk: (m) => `${m}`,
    translateWarn: 'off — translation falls back to the in-browser Opus-MT models (fine on Windows/Linux).',
    bigFileOk: 'transcribe_file jobs with progress/cancel',
    bigFileWarn: 'helper is too old — Restart it to load the job endpoints.',
    unknown: 'run the checks with the helper online.',
  },
};

const id = {
  title: 'Panduan pemasangan & pemecahan masalah',
  subtitle: 'Jalankan Native Helper di mesin ini — semuanya tetap di 127.0.0.1.',
  tabs: 'Sistem operasi',
  prereqs: 'Sebelum mulai',
  steps: 'Langkah pemasangan',
  copy: 'Salin',
  copied: 'Tersalin',
  hostManifest: 'Manifest Native Messaging',
  diagnostics: 'Diagnostik',
  rerun: 'Periksa ulang',
  openDocs: 'Panduan lengkap (native/SETUP.md)',
  troubleshooting: 'Pemecahan masalah',
  cause: 'Penyebab',
  fix: 'Perbaikan',
  relatedFail: 'Ditandai diagnostik',
  extIdHint: 'Ganti <EXT_ID> dengan ID ekstensi di chrome://extensions (Developer mode).',
  stateOk: 'OK',
  stateWarn: 'Periksa',
  stateFail: 'Masalah',
  stateUnknown: 'Belum diketahui',
  allGood: 'Semua baik — helper terjangkau dan siap dipakai.',
  offlineIntro: 'Helper tidak terjangkau. Ikuti langkah pemasangan, lalu Periksa ulang.',
  browserEngineNote: 'Mesin masih Browser — helper opsional. Pilih Native helper di Pengaturan untuk memakainya.',
  os: { windows: 'Windows', linux: 'Linux', macos: 'macOS' },
  osEngine: {
    windows: 'faster-whisper · CPU atau CUDA',
    linux: 'faster-whisper · CPU atau CUDA',
    macos: 'mlx-whisper (Apple Silicon) · cadangan faster-whisper',
  },
  checks: {
    reachable: 'Helper terjangkau di 127.0.0.1:17865',
    platform: 'OS helper cocok dengan browser ini',
    engineSel: 'Mesin ekstensi diset ke Native helper',
    host: 'Host Native Messaging (Start/Stop dari panel)',
    ffmpeg: 'ffmpeg tersedia untuk helper',
    gpu: 'Akselerasi perangkat keras',
    translate: 'LLM terjemahan on-device',
    bigFile: 'Job berkas besar (>2 GiB) didukung',
  },
  detail: {
    reachableOk: (m) => `${m}`,
    reachableFail: 'GET /health tidak menjawab — proses helper tidak jalan atau port terblokir.',
    platformOk: (p) => `helper melapor ${p}`,
    platformWarn: (p, o) => `helper melapor ${p} tapi browser ini di ${o} — helper remote?`,
    engineSelOk: 'native',
    engineSelWarn: 'browser — helper tidak dipakai untuk subtitel sampai Anda beralih.',
    hostOk: 'terhubung — Start / Stop / Restart bisa dari Pengaturan.',
    hostForbidden: 'terpasang, tapi ID ekstensi ini belum ada di allowed_origins manifest host.',
    hostCrashed: 'manifest ketemu tapi proses host gagal dijalankan — periksa path Python di dalamnya.',
    hostTimeout: 'host tidak menjawab — mungkin menggantung; mulai ulang Chrome lalu periksa lagi.',
    hostWarn: 'belum terdaftar — Start/Stop butuh manifest host; ./run.sh manual tetap bisa.',
    hostUnknown: 'native messaging tidak tersedia di browser ini.',
    ffmpegOk: 'ditemukan',
    ffmpegFail: 'tidak ada — berkas media (mp4, mkv, m4a…) tidak bisa didekode.',
    gpuOk: (d) => `${d}`,
    gpuWarn: 'cpu — transkripsi jalan tapi lebih lambat; CUDA butuh GPU NVIDIA + runtime CUDA.',
    translateOk: (m) => `${m}`,
    translateWarn: 'mati — terjemahan memakai model Opus-MT di browser (wajar di Windows/Linux).',
    bigFileOk: 'job transcribe_file dengan progres/batal',
    bigFileWarn: 'helper terlalu lama — Restart agar endpoint job termuat.',
    unknown: 'jalankan pemeriksaan saat helper hidup.',
  },
};

export const HELPER_GUIDE_I18N = { en, id };

export function guideStrings(lang) {
  return HELPER_GUIDE_I18N[lang] || HELPER_GUIDE_I18N.en;
}

/** Penerjemah kecil: G('copy') → string; G('detail.platformWarn', a, b) untuk fungsi bersarang. */
export function makeGuideT(lang) {
  const dict = guideStrings(lang);
  return function G(path, ...args) {
    const pick = (d) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
    const v = pick(dict) ?? pick(HELPER_GUIDE_I18N.en) ?? path;
    return typeof v === 'function' ? v(...args) : v;
  };
}

/**
 * Langkah pemasangan per OS. `cmd` disalin apa adanya (tombol Salin);
 * `text` bilingual dijelaskan di sebelahnya. Sumber kebenaran: native/SETUP.md
 * dan skrip di native/ (run.sh, install-host.sh, install-host-linux.sh, install-host.bat).
 */
export const INSTALL_GUIDES = {
  windows: {
    prereqs: {
      en: ['Python 3.10+ (python.org — tick "Add to PATH")', 'Git Bash or WSL to run run.sh', 'ffmpeg on PATH (winget install Gyan.FFmpeg)', 'Optional: NVIDIA GPU + CUDA 12 runtime for faster-whisper'],
      id: ['Python 3.10+ (python.org — centang "Add to PATH")', 'Git Bash atau WSL untuk menjalankan run.sh', 'ffmpeg di PATH (winget install Gyan.FFmpeg)', 'Opsional: GPU NVIDIA + runtime CUDA 12 untuk faster-whisper'],
    },
    steps: [
      { text: { en: 'Open Git Bash in the repo and start the helper (creates .venv, installs faster-whisper, serves :17865)', id: 'Buka Git Bash di repo dan jalankan helper (membuat .venv, memasang faster-whisper, melayani :17865)' }, cmd: 'cd native && ./run.sh' },
      { text: { en: 'No Git Bash? Plain PowerShell works too', id: 'Tanpa Git Bash? PowerShell biasa juga bisa' }, cmd: 'cd native; python -m venv .venv; .venv\\Scripts\\pip install faster-whisper numpy; .venv\\Scripts\\python server.py' },
      { text: { en: 'Register the Native Messaging host so Start/Stop work from this panel (Command Prompt)', id: 'Daftarkan host Native Messaging agar Start/Stop bisa dari panel ini (Command Prompt)' }, cmd: 'cd native && install-host.bat <EXT_ID>' },
      { text: { en: 'Verify the helper answers', id: 'Pastikan helper menjawab' }, cmd: `curl.exe -sf ${HELPER_URL}/health` },
      { text: { en: 'Reload the extension, then Settings → Engine → Native helper → Refresh', id: 'Muat ulang ekstensi, lalu Pengaturan → Mesin → Native helper → Refresh' } },
    ],
    hostManifest: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\NativeMessagingHosts\\com.localtranssub.helper.json',
    hostRegistry: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.localtranssub.helper',
  },
  linux: {
    prereqs: {
      en: ['Python 3.10+ with venv (apt install python3-venv)', 'ffmpeg (apt install ffmpeg / dnf install ffmpeg)', 'Google Chrome or Chromium', 'Optional: NVIDIA driver + CUDA 12 runtime'],
      id: ['Python 3.10+ dengan venv (apt install python3-venv)', 'ffmpeg (apt install ffmpeg / dnf install ffmpeg)', 'Google Chrome atau Chromium', 'Opsional: driver NVIDIA + runtime CUDA 12'],
    },
    steps: [
      { text: { en: 'Start the helper (creates .venv, installs faster-whisper, serves :17865)', id: 'Jalankan helper (membuat .venv, memasang faster-whisper, melayani :17865)' }, cmd: 'cd native && ./run.sh' },
      { text: { en: 'Register the Native Messaging host for Chrome/Chromium', id: 'Daftarkan host Native Messaging untuk Chrome/Chromium' }, cmd: 'cd native && ./install-host-linux.sh <EXT_ID>' },
      { text: { en: 'Verify the helper answers', id: 'Pastikan helper menjawab' }, cmd: `curl -sf ${HELPER_URL}/health` },
      { text: { en: 'Reload the extension, then Settings → Engine → Native helper → Refresh', id: 'Muat ulang ekstensi, lalu Pengaturan → Mesin → Native helper → Refresh' } },
    ],
    hostManifest: '~/.config/google-chrome/NativeMessagingHosts/com.localtranssub.helper.json',
    hostManifestChromium: '~/.config/chromium/NativeMessagingHosts/com.localtranssub.helper.json',
  },
  macos: {
    prereqs: {
      en: ['Python 3.10+ (brew install python)', 'ffmpeg (brew install ffmpeg)', 'Apple Silicon for mlx-whisper; Intel Macs fall back to faster-whisper'],
      id: ['Python 3.10+ (brew install python)', 'ffmpeg (brew install ffmpeg)', 'Apple Silicon untuk mlx-whisper; Mac Intel memakai faster-whisper'],
    },
    steps: [
      { text: { en: 'One-shot setup from the repo root (venv, launcher, host)', id: 'Pemasangan sekali jalan dari root repo (venv, launcher, host)' }, cmd: './scripts/ensure-native.sh' },
      { text: { en: 'Or start manually (mlx-whisper on Apple Silicon)', id: 'Atau jalankan manual (mlx-whisper di Apple Silicon)' }, cmd: 'cd native && ./run.sh' },
      { text: { en: 'Register the Native Messaging host', id: 'Daftarkan host Native Messaging' }, cmd: 'cd native && ./install-host.sh <EXT_ID>' },
      { text: { en: 'Verify the helper answers', id: 'Pastikan helper menjawab' }, cmd: `curl -sf ${HELPER_URL}/health` },
      { text: { en: 'Settings → Engine → Native helper → Start / Refresh', id: 'Pengaturan → Mesin → Native helper → Start / Refresh' } },
    ],
    hostManifest: '~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localtranssub.helper.json',
  },
};

/**
 * Entri pemecahan masalah. `checks` = id pemeriksaan yang, bila gagal/warn,
 * mengangkat entri ini ke atas. `os` membatasi ke OS tertentu (kosong = semua).
 */
export const TROUBLESHOOTING = [
  {
    id: 'not-running',
    checks: ['reachable'],
    symptom: { en: 'Helper disconnected / "Native helper not running"', id: 'Helper terputus / "Native helper not running"' },
    cause: { en: 'server.py is not running, crashed on start, or is bound to another port.', id: 'server.py tidak jalan, gagal saat start, atau terikat ke port lain.' },
    fix: { en: 'Start it from a terminal and watch the first lines of output for errors, then press Re-check.', id: 'Jalankan dari terminal dan perhatikan baris awal keluaran untuk galat, lalu tekan Periksa ulang.' },
    cmd: { windows: 'cd native && ./run.sh', linux: 'cd native && ./run.sh', macos: './scripts/start-native.sh' },
  },
  {
    id: 'port-busy',
    checks: ['reachable'],
    symptom: { en: 'Port 17865 already in use (EADDRINUSE / OSError 98 / 10048)', id: 'Port 17865 sudah dipakai (EADDRINUSE / OSError 98 / 10048)' },
    cause: { en: 'A previous helper is still alive, or another program took the port.', id: 'Helper lama masih hidup, atau program lain memakai port itu.' },
    fix: { en: 'Stop the old process, then start again.', id: 'Hentikan proses lama, lalu jalankan lagi.' },
    cmd: {
      windows: 'netstat -ano | findstr :17865   (then)   taskkill /PID <pid> /F',
      linux: 'fuser -k 17865/tcp   # or: lsof -i :17865',
      macos: './scripts/stop-native.sh   # or: lsof -i :17865',
    },
  },
  {
    id: 'host-missing',
    checks: ['host'],
    symptom: { en: 'Start / Stop buttons do nothing — "Native launcher not installed"', id: 'Tombol Start / Stop tidak berfungsi — "Native launcher not installed"' },
    cause: { en: `Chrome cannot find the ${HOST_NAME} manifest, or its allowed_origins has the wrong extension ID.`, id: `Chrome tidak menemukan manifest ${HOST_NAME}, atau allowed_origins berisi ID ekstensi yang salah.` },
    fix: { en: 'Re-run the host installer with the current extension ID from chrome://extensions, then reload the extension. On Windows the installer also writes the HKCU registry key.', id: 'Jalankan ulang installer host dengan ID ekstensi terkini dari chrome://extensions, lalu muat ulang ekstensi. Di Windows installer juga menulis kunci registry HKCU.' },
    cmd: { windows: 'cd native && install-host.bat <EXT_ID>', linux: 'cd native && ./install-host-linux.sh <EXT_ID>', macos: 'cd native && ./install-host.sh <EXT_ID>' },
  },
  {
    id: 'ffmpeg',
    checks: ['ffmpeg'],
    symptom: { en: 'Media files fail: "ffmpeg not installed"', id: 'Berkas media gagal: "ffmpeg not installed"' },
    cause: { en: 'The helper decodes mp4/mkv/m4a with ffmpeg; it is not on PATH for the helper process.', id: 'Helper mendekode mp4/mkv/m4a dengan ffmpeg; ffmpeg tidak ada di PATH proses helper.' },
    fix: { en: 'Install ffmpeg, then Restart the helper so it picks up the new PATH.', id: 'Pasang ffmpeg, lalu Restart helper agar PATH baru terbaca.' },
    cmd: { windows: 'winget install Gyan.FFmpeg', linux: 'sudo apt install ffmpeg', macos: 'brew install ffmpeg' },
  },
  {
    id: 'cpu-slow',
    checks: ['gpu'],
    os: ['windows', 'linux'],
    symptom: { en: 'Transcription is slow / helper reports device=cpu', id: 'Transkripsi lambat / helper melapor device=cpu' },
    cause: { en: 'faster-whisper found no CUDA device (no NVIDIA GPU, missing driver, or CTranslate2 built without CUDA).', id: 'faster-whisper tidak menemukan CUDA (tanpa GPU NVIDIA, driver hilang, atau CTranslate2 tanpa CUDA).' },
    fix: { en: 'Install the NVIDIA driver + CUDA 12 runtime (cuBLAS, cuDNN) and restart; or use a smaller model to stay on CPU.', id: 'Pasang driver NVIDIA + runtime CUDA 12 (cuBLAS, cuDNN) lalu restart; atau pakai model kecil agar nyaman di CPU.' },
    cmd: { windows: 'set WHISPER_MODEL=small && ./run.sh', linux: 'WHISPER_MODEL=small ./run.sh   # or DEVICE=cuda ./run.sh', macos: '' },
  },
  {
    id: 'engine-browser',
    checks: ['engineSel'],
    symptom: { en: 'Helper is online but captions still use the browser engine', id: 'Helper hidup tapi subtitel masih memakai mesin browser' },
    cause: { en: 'The extension engine is still set to Browser.', id: 'Mesin ekstensi masih diset ke Browser.' },
    fix: { en: 'Settings → Engine → Native helper. The next task uses the helper.', id: 'Pengaturan → Mesin → Native helper. Tugas berikutnya memakai helper.' },
  },
  {
    id: 'big-file',
    checks: ['bigFile'],
    symptom: { en: 'Files over 2 GiB fail or freeze the side panel', id: 'Berkas di atas 2 GiB gagal atau membekukan side panel' },
    cause: { en: 'In-browser decoding cannot hold a >2 GiB file; it must be streamed to the helper as a job.', id: 'Dekode di browser tidak sanggup menampung berkas >2 GiB; harus dialirkan ke helper sebagai job.' },
    fix: { en: 'Use Offline mode with Engine = Native helper; progress and Cancel appear in the Native Helper card. Restart an old helper if the job endpoints are missing.', id: 'Pakai mode Luring dengan Mesin = Native helper; progres dan Batalkan tampil di kartu Native Helper. Restart helper lama bila endpoint job tidak ada.' },
  },
  {
    id: 'firewall',
    checks: ['reachable'],
    os: ['windows'],
    symptom: { en: 'Windows Firewall / antivirus prompt when the helper starts', id: 'Prompt Windows Firewall / antivirus saat helper mulai' },
    cause: { en: 'Python opens a listening socket. It is loopback-only (127.0.0.1) and never reachable from the network.', id: 'Python membuka soket pendengar. Hanya loopback (127.0.0.1) dan tidak pernah terjangkau dari jaringan.' },
    fix: { en: 'Allow it for private networks (or dismiss — loopback works regardless). Do not expose the port.', id: 'Izinkan untuk jaringan privat (atau tutup saja — loopback tetap jalan). Jangan buka port ke luar.' },
  },
  {
    id: 'python-missing',
    checks: ['reachable'],
    symptom: { en: '"python3: command not found" / "No module named venv"', id: '"python3: command not found" / "No module named venv"' },
    cause: { en: 'Python is not installed, not on PATH, or the venv module is packaged separately (Debian/Ubuntu).', id: 'Python belum terpasang, tidak di PATH, atau modul venv dipaket terpisah (Debian/Ubuntu).' },
    fix: { en: 'Install Python 3.10+ and re-run run.sh. You can point run.sh at a specific interpreter with PYTHON=.', id: 'Pasang Python 3.10+ dan jalankan ulang run.sh. Interpreter tertentu bisa dipilih lewat PYTHON=.' },
    cmd: { windows: 'winget install Python.Python.3.12', linux: 'sudo apt install python3 python3-venv', macos: 'brew install python' },
  },
  {
    id: 'model-download',
    checks: [],
    symptom: { en: 'First start hangs on "Downloading model…"', id: 'Start pertama tertahan di "Downloading model…"' },
    cause: { en: 'Whisper weights (~1.6 GB for large-v3-turbo) download once from Hugging Face; slow or blocked networks stall.', id: 'Bobot Whisper (~1,6 GB untuk large-v3-turbo) diunduh sekali dari Hugging Face; jaringan lambat/terblokir membuatnya tertahan.' },
    fix: { en: 'Wait for the first download, or start with a smaller model. After that everything runs offline.', id: 'Tunggu unduhan pertama, atau mulai dengan model kecil. Setelahnya semua jalan luring.' },
    cmd: { windows: 'set WHISPER_MODEL=base && ./run.sh', linux: 'WHISPER_MODEL=base ./run.sh', macos: 'WHISPER_MODEL=mlx-community/whisper-small-mlx ./run.sh' },
  },
];

/** Entri yang berlaku untuk OS ini. */
export function troubleshootingFor(os) {
  const g = guideOsFor(os);
  return TROUBLESHOOTING.filter((e) => !e.os || e.os.includes(g));
}

/**
 * Jalankan pemeriksaan dari konteks ekstensi. Tanpa jaringan — memakai objek
 * /health yang sudah diambil pemanggil (null bila helper mati).
 *
 * @param {object} ctx
 * @param {GuideOS|string} ctx.os              hasil detectOs()
 * @param {object|null} ctx.health             respons /health atau null
 * @param {string} [ctx.engine]                'browser' | 'native'
 * @param {boolean} [ctx.nativeHostSupported]  chrome.runtime.connectNative ada?
 * @param {boolean|null} [ctx.hostInstalled]   null = belum dicoba
 * @param {{state: string}|null} [ctx.hostConnection]  hasil nativeHostConnection()
 * @param {string} [ctx.lang]
 */
export function runDiagnostics(ctx) {
  const G = makeGuideT(ctx.lang);
  const os = guideOsFor(ctx.os);
  const h = ctx.health || null;
  const online = !!h;
  const out = [];
  const push = (id, state, detail) => out.push({ id, state, label: G(`checks.${id}`), detail });

  push(
    'reachable',
    online ? 'ok' : 'fail',
    online
      ? G('detail.reachableOk', `${h.engine || 'asr'} · ${(h.model || '').split('/').pop() || h.model || ''}`)
      : G('detail.reachableFail'),
  );

  const engine = ctx.engine || 'browser';
  push('engineSel', engine === 'native' ? 'ok' : 'warn', engine === 'native' ? G('detail.engineSelOk') : G('detail.engineSelWarn'));

  // Keadaan sambungan (dari nativeHostConnection) lebih tajam daripada boolean
  // hostInstalled: 'terpasang tapi ditolak' dan 'gagal jalan' butuh perbaikan
  // yang berbeda. hostInstalled tetap dipakai bila pemanggil belum mengirimnya.
  const conn = ctx.hostConnection?.state || null;
  if (ctx.nativeHostSupported === false || conn === 'unsupported') push('host', 'unknown', G('detail.hostUnknown'));
  else if (conn === 'connected') push('host', 'ok', G('detail.hostOk'));
  else if (conn === 'forbidden') push('host', 'fail', G('detail.hostForbidden'));
  else if (conn === 'crashed') push('host', 'fail', G('detail.hostCrashed'));
  else if (conn === 'timeout') push('host', 'warn', G('detail.hostTimeout'));
  else if (conn === 'not-installed') push('host', 'warn', G('detail.hostWarn'));
  else if (ctx.hostInstalled === true) push('host', 'ok', G('detail.hostOk'));
  else if (ctx.hostInstalled === false) push('host', 'warn', G('detail.hostWarn'));
  else push('host', 'unknown', G('detail.unknown'));

  if (!online) {
    push('platform', 'unknown', G('detail.unknown'));
    push('ffmpeg', 'unknown', G('detail.unknown'));
    push('gpu', 'unknown', G('detail.unknown'));
    push('translate', 'unknown', G('detail.unknown'));
    push('bigFile', 'unknown', G('detail.unknown'));
    return out;
  }

  const plat = String(h.platform || '').toLowerCase();
  const platOs = plat === 'darwin' ? 'macos' : plat === 'windows' ? 'windows' : plat === 'linux' ? 'linux' : '';
  if (!platOs) push('platform', 'unknown', G('detail.unknown'));
  else if (platOs === os) push('platform', 'ok', G('detail.platformOk', G(`os.${platOs}`)));
  else push('platform', 'warn', G('detail.platformWarn', G(`os.${platOs}`), G(`os.${os}`)));

  push('ffmpeg', h.ffmpeg ? 'ok' : 'fail', h.ffmpeg ? G('detail.ffmpegOk') : G('detail.ffmpegFail'));

  const device = String(h.device || '').toLowerCase();
  const accel = device && device !== 'cpu';
  push('gpu', accel ? 'ok' : 'warn', accel ? G('detail.gpuOk', device) : G('detail.gpuWarn'));

  push(
    'translate',
    h.translate ? 'ok' : 'warn',
    h.translate ? G('detail.translateOk', (h.translate_model || 'llm').split('/').pop()) : G('detail.translateWarn'),
  );

  const jobs = !!(h.features && h.features.transcribe_file_jobs);
  push('bigFile', jobs ? 'ok' : 'warn', jobs ? G('detail.bigFileOk') : G('detail.bigFileWarn'));

  return out;
}

/** Ringkasan: ada fail? ada warn? */
export function summarizeDiagnostics(checks) {
  const fail = checks.filter((c) => c.state === 'fail').length;
  const warn = checks.filter((c) => c.state === 'warn').length;
  const ok = checks.filter((c) => c.state === 'ok').length;
  return { fail, warn, ok, healthy: fail === 0 };
}

/**
 * Urutkan entri troubleshooting untuk OS ini: yang terkait pemeriksaan fail
 * dulu, lalu warn, lalu sisanya (urutan asli dipertahankan di tiap kelompok).
 * Tiap entri diberi `flagged: 'fail'|'warn'|null`.
 */
export function relevantTroubleshooting(os, checks) {
  const state = new Map((checks || []).map((c) => [c.id, c.state]));
  const rank = (e) => {
    const states = (e.checks || []).map((id) => state.get(id));
    if (states.includes('fail')) return 0;
    if (states.includes('warn')) return 1;
    return 2;
  };
  return troubleshootingFor(os)
    .map((e, i) => ({ ...e, _i: i, _r: rank(e) }))
    .sort((a, b) => a._r - b._r || a._i - b._i)
    .map(({ _i, _r, ...e }) => ({ ...e, flagged: _r === 0 ? 'fail' : _r === 1 ? 'warn' : null }));
}

/** Ambil teks bilingual { en, id } menurut bahasa UI. */
export function pickLang(obj, lang) {
  if (!obj || typeof obj !== 'object') return obj ?? '';
  return obj[lang] ?? obj.en ?? '';
}

/** Perintah untuk OS tertentu dari entri (string tunggal atau peta per OS). */
export function cmdFor(entry, os) {
  const c = entry?.cmd;
  if (!c) return '';
  if (typeof c === 'string') return c;
  return c[guideOsFor(os)] || '';
}
