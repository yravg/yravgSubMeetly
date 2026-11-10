/**
 * Daftar halaman uji, paragraf "How the lab works" dan catatan mode mock — satu sumber untuk
 * lab lama (test/app.html) dan halaman Developer di app shell (src/app-pages/developer.js).
 * Teks halaman tetap persis seperti di lab: label kendali dicatat di
 * docs/design/tide-shell-canvas/shots/controls.json dan dijaga test/app-controls.test.mjs.
 */
export const DEV =
  '<b>Browser tab · on-device Whisper</b> — Same pipeline as the extension (<code>offscreen.js</code> → <code>ai-worker.js</code> → ASR/MT). ' +
  '<b>Realtime:</b> Start loops a CC0/demo clip via <code>captureStream</code>; Pick uses <code>getDisplayMedia</code> (share a tab + audio). ' +
  'Overlay injection and <code>tabCapture</code> still need the Chrome extension. ' +
  'Offline → CC0 test samples for 10–30s public-domain clips per language.';

export const PAGES = [
  ['Guides and register', 'docs', [
    ['Panduan pengguna — ekstensi', '/guide.html', 'Pasang, subtitel langsung, berkas, ekspor, notulen, helper.', 1],
    ['Panduan pengguna — macOS', '/guide.html?doc=USER-GUIDE-MACOS.md', 'Audio sistem, overlay layar penuh, dikte global, izin macOS.', 1],
    ['Panduan pengguna — Windows & Linux', '/guide.html?doc=USER-GUIDE-WINLINUX.md', 'Native Helper faster-whisper, installer host per OS, GPU CUDA, ekspor CRLF/BOM.', 1],
    ['Minutes Register (full tab)', '/src/minutes.html', 'Typed register, provenance drawer, series view and the issued-MoM document.', 1]]],
  ['Tools', 'pages', [
    ['Translation Lab', '/lab.html', 'Media player + automated zh↔en / ja↔en benchmark against the native helper.'],
    ['Offline Studio (transcription / export)', '/studio.html', 'File transcription, dual-line translation and the SRT/VTT/TXT export panel.'],
    ['Model manager (mock)', '/models.html', 'ASR + translation model sizes, download states and actions — preview only.'],
    ['Session history (samples)', '/history.html', 'Saved sessions list, transcript preview and per-session export — sample data.'],
    ['Helper status (mock)', '/helper-status.html', 'Native Helper cards for macOS / Windows / Linux with sample states.'],
    ['Helper install guide & troubleshooting (harness)', '/helper-guide.html', 'Per-OS install steps, live diagnostics and ranked troubleshooting — the panel inside the Native Helper card.'],
    ['Meeting notes ticker (harness)', '/notes-panel.html', 'Side-panel notes ticker on the v2 register.']]],
  ['Release QA', 'perf', [
    ['Phase 1 release verification', '/verify.html', 'Status dashboard for the 26 baseline sub-features before smoke, E2E and the lab are wired up.'],
    ['Smoke & E2E test report', '/qa-report.html', 'Summary of scripts/smoke.mjs and scripts/e2e.mjs (tabCapture, --pick, --native).'],
    ['Model performance benchmark lab', '/bench.html', 'Whisper / Voxtral / Opus-MT / native MLX comparison (last-bench.json).'],
    ['Release defect list', '/defects.html', 'Phase 1 release gate: must-fix defects vs accepted limitations (DRM, MKV, single tab, etc.).']]],
  ['Extension harnesses', 'helper', [
    ['Audio test page', '/audio-page.html', 'Looping tab audio for extension e2e / dev-browser.'],
    ['Overlay test', '/overlay-test.html', ''], ['Panel test', '/panel-test.html', ''], ['Offscreen test', '/offscreen-test.html', '']]],
  ['More', 'register', [['Test page index', '/', ''], ['CC0 sample credits', '/samples/ATTRIBUTION.md', '']]],
];

export const MODE_NOTE = {
  passthrough: 'Requests to 127.0.0.1:17865 go to the real helper if one is running.',
  offline: 'Every request fails like a helper that is not running. Use it to see the fallback to the browser engine.',
  fixture: 'Answers /health and /engine/device from the fixtures below, no network.',
};
