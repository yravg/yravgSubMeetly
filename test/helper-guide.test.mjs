/**
 * Panduan pemasangan + pemecahan masalah Native Helper (data + diagnostik).
 *   node --test test/helper-guide.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUIDE_OS_ORDER,
  INSTALL_GUIDES,
  TROUBLESHOOTING,
  HELPER_GUIDE_I18N,
  guideOsFor,
  makeGuideT,
  runDiagnostics,
  summarizeDiagnostics,
  relevantTroubleshooting,
  troubleshootingFor,
  cmdFor,
  pickLang,
} from '../src/lib/helper-guide.js';

const HEALTH_LINUX_CUDA = {
  ok: true, engine: 'faster-whisper', model: 'large-v3-turbo', ffmpeg: true, translate: false,
  device: 'cuda', platform: 'linux', features: { transcribe_file_jobs: true },
};
const HEALTH_MAC = {
  ok: true, engine: 'mlx-whisper', model: 'mlx-community/whisper-large-v3-turbo', ffmpeg: true,
  translate: true, translate_model: 'mlx-community/Qwen2.5-3B-Instruct-4bit', device: 'apple-silicon',
  platform: 'darwin', features: { transcribe_file_jobs: true },
};

test('i18n: id dictionary mirrors every en key (incl. nested checks/detail/os)', () => {
  const walk = (a, b, path = '') => {
    for (const k of Object.keys(a)) {
      assert.ok(k in b, `missing id key ${path}${k}`);
      if (a[k] && typeof a[k] === 'object') walk(a[k], b[k], `${path}${k}.`);
    }
  };
  walk(HELPER_GUIDE_I18N.en, HELPER_GUIDE_I18N.id);
  const G = makeGuideT('id');
  assert.equal(G('copy'), 'Salin');
  assert.equal(makeGuideT('xx')('copy'), 'Copy'); // fallback → en
  assert.match(G('detail.platformWarn', 'Linux', 'Windows'), /Linux.*Windows/);
});

test('install guides: every OS has prereqs (en+id), steps with bilingual text, host manifest path', () => {
  for (const os of GUIDE_OS_ORDER) {
    const g = INSTALL_GUIDES[os];
    assert.ok(g, os);
    assert.ok(g.prereqs.en.length >= 3 && g.prereqs.id.length === g.prereqs.en.length, `${os} prereqs`);
    assert.ok(g.steps.length >= 4, `${os} steps`);
    for (const s of g.steps) {
      assert.ok(s.text.en && s.text.id, `${os} step text bilingual`);
      if (s.cmd) assert.equal(typeof s.cmd, 'string');
    }
    assert.match(g.hostManifest, /com\.yraveragesubmin\.helper\.json$/);
    // the installer for this OS must be referenced verbatim
    const installer = { windows: 'install-host.bat', linux: 'install-host-linux.sh', macos: 'install-host.sh' }[os];
    assert.ok(g.steps.some((s) => s.cmd && s.cmd.includes(installer)), `${os} references ${installer}`);
    assert.ok(g.steps.some((s) => s.cmd && s.cmd.includes('/health')), `${os} has a /health verification step`);
  }
  assert.match(INSTALL_GUIDES.windows.hostRegistry, /^HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts/);
});

test('troubleshooting: unique ids, bilingual, cmd maps only to known OS keys', () => {
  const ids = new Set();
  for (const e of TROUBLESHOOTING) {
    assert.ok(!ids.has(e.id), `dup id ${e.id}`);
    ids.add(e.id);
    for (const f of ['symptom', 'cause', 'fix']) assert.ok(e[f].en && e[f].id, `${e.id}.${f}`);
    if (e.cmd && typeof e.cmd === 'object') {
      for (const k of Object.keys(e.cmd)) assert.ok(GUIDE_OS_ORDER.includes(k), `${e.id} cmd key ${k}`);
    }
    if (e.os) for (const o of e.os) assert.ok(GUIDE_OS_ORDER.includes(o));
  }
  // OS filter: 'cpu-slow' is Win/Linux only; macOS never shows it
  assert.ok(troubleshootingFor('windows').some((e) => e.id === 'cpu-slow'));
  assert.ok(!troubleshootingFor('macos').some((e) => e.id === 'cpu-slow'));
  assert.ok(!troubleshootingFor('linux').some((e) => e.id === 'firewall'));
  assert.equal(cmdFor(TROUBLESHOOTING.find((e) => e.id === 'ffmpeg'), 'windows'), 'winget install Gyan.FFmpeg');
  assert.equal(cmdFor(TROUBLESHOOTING.find((e) => e.id === 'engine-browser'), 'linux'), '');
});

test('guideOsFor: unknown UA falls back to linux (faster-whisper path)', () => {
  assert.equal(guideOsFor('unknown'), 'linux');
  assert.equal(guideOsFor('macos'), 'macos');
  assert.equal(pickLang({ en: 'a', id: 'b' }, 'id'), 'b');
  assert.equal(pickLang({ en: 'a', id: 'b' }, 'fr'), 'a');
});

test('diagnostics: helper offline → reachable fails, the rest unknown, engine warn', () => {
  const d = runDiagnostics({ os: 'windows', health: null, engine: 'browser', nativeHostSupported: true, hostInstalled: null, lang: 'en' });
  const by = Object.fromEntries(d.map((c) => [c.id, c.state]));
  assert.equal(by.reachable, 'fail');
  assert.equal(by.engineSel, 'warn');
  assert.equal(by.host, 'unknown');
  assert.equal(by.ffmpeg, 'unknown');
  assert.equal(summarizeDiagnostics(d).healthy, false);
});

test('diagnostics: Linux + CUDA helper → all ok except translate (warn, expected on Win/Linux)', () => {
  const d = runDiagnostics({ os: 'linux', health: HEALTH_LINUX_CUDA, engine: 'native', nativeHostSupported: true, hostInstalled: true, lang: 'id' });
  const by = Object.fromEntries(d.map((c) => [c.id, c.state]));
  assert.deepEqual(
    { ...by },
    { reachable: 'ok', engineSel: 'ok', host: 'ok', platform: 'ok', ffmpeg: 'ok', gpu: 'ok', translate: 'warn', bigFile: 'ok' },
  );
  assert.equal(summarizeDiagnostics(d).healthy, true);
  assert.match(d.find((c) => c.id === 'reachable').detail, /faster-whisper · large-v3-turbo/);
});

test('diagnostics: platform mismatch + cpu + no ffmpeg + old helper are surfaced', () => {
  const h = { ...HEALTH_LINUX_CUDA, platform: 'windows', device: 'cpu', ffmpeg: false, features: {} };
  const d = runDiagnostics({ os: 'linux', health: h, engine: 'native', nativeHostSupported: false, lang: 'en' });
  const by = Object.fromEntries(d.map((c) => [c.id, c.state]));
  assert.equal(by.platform, 'warn');
  assert.equal(by.gpu, 'warn');
  assert.equal(by.ffmpeg, 'fail');
  assert.equal(by.bigFile, 'warn');
  assert.equal(by.host, 'unknown'); // no native messaging in this browser
  assert.equal(summarizeDiagnostics(d).fail, 1);
});

test('diagnostics: Rust engine decodes media itself, so ffmpeg=false + media_decoder is ok', () => {
  const h = { ...HEALTH_LINUX_CUDA, ffmpeg: false, media_decoder: 'symphonia' };
  const d = runDiagnostics({ os: 'linux', health: h, engine: 'native', nativeHostSupported: false, lang: 'en' });
  assert.equal(d.find((c) => c.id === 'ffmpeg').state, 'ok');
});

test('diagnostics: macOS Apple Silicon helper reports darwin → macos and LLM translate ok', () => {
  const d = runDiagnostics({ os: 'macos', health: HEALTH_MAC, engine: 'native', nativeHostSupported: true, hostInstalled: true, lang: 'en' });
  const by = Object.fromEntries(d.map((c) => [c.id, c.state]));
  assert.equal(by.platform, 'ok');
  assert.equal(by.gpu, 'ok');
  assert.equal(by.translate, 'ok');
  assert.match(d.find((c) => c.id === 'translate').detail, /Qwen2.5-3B-Instruct-4bit/);
});

test('relevantTroubleshooting: entries tied to failing checks float to the top and are flagged', () => {
  const offline = runDiagnostics({ os: 'windows', health: null, engine: 'native', nativeHostSupported: true, hostInstalled: false, lang: 'en' });
  const tips = relevantTroubleshooting('windows', offline);
  assert.equal(tips[0].id, 'not-running');
  assert.equal(tips[0].flagged, 'fail');
  const flaggedFail = tips.filter((t) => t.flagged === 'fail').map((t) => t.id);
  assert.deepEqual(flaggedFail, ['not-running', 'port-busy', 'firewall', 'python-missing']);
  assert.equal(tips.find((t) => t.id === 'host-missing').flagged, 'warn');
  assert.equal(tips.find((t) => t.id === 'model-download').flagged, null);
  // fail group precedes warn group precedes null group
  const ranks = tips.map((t) => (t.flagged === 'fail' ? 0 : t.flagged === 'warn' ? 1 : 2));
  assert.deepEqual(ranks, [...ranks].sort());

  const healthy = runDiagnostics({ os: 'linux', health: HEALTH_LINUX_CUDA, engine: 'native', nativeHostSupported: true, hostInstalled: true, lang: 'en' });
  const tips2 = relevantTroubleshooting('linux', healthy);
  assert.ok(tips2.every((t) => t.flagged !== 'fail'));
  assert.equal(tips2[0].id, 'not-running'); // stable original order when nothing fails
});

test('diagnostik host: keadaan sambungan membedakan ditolak / gagal jalan / belum dipasang', () => {
  const base = { os: 'windows', health: null, engine: 'native', nativeHostSupported: true, lang: 'en' };
  const hostCheck = (ctx) => runDiagnostics(ctx).find((c) => c.id === 'host');

  assert.equal(hostCheck({ ...base, hostConnection: { state: 'connected' } }).state, 'ok');

  // Terpasang tapi id ekstensi belum diizinkan — bukan "belum dipasang".
  const forb = hostCheck({ ...base, hostConnection: { state: 'forbidden' }, hostInstalled: true });
  assert.equal(forb.state, 'fail');
  assert.match(forb.detail, /allowed_origins/);

  const crashed = hostCheck({ ...base, hostConnection: { state: 'crashed' }, hostInstalled: true });
  assert.equal(crashed.state, 'fail');
  assert.match(crashed.detail, /Python/);

  assert.equal(hostCheck({ ...base, hostConnection: { state: 'not-installed' } }).state, 'warn');
  assert.equal(hostCheck({ ...base, hostConnection: { state: 'timeout' } }).state, 'warn');
  assert.equal(hostCheck({ ...base, hostConnection: { state: 'unsupported' } }).state, 'unknown');
});

test('diagnostik host: tanpa hostConnection tetap memakai hostInstalled seperti sebelumnya', () => {
  const base = { os: 'linux', health: null, engine: 'native', nativeHostSupported: true, lang: 'id' };
  const hostCheck = (ctx) => runDiagnostics(ctx).find((c) => c.id === 'host');
  assert.equal(hostCheck({ ...base, hostInstalled: true }).state, 'ok');
  assert.equal(hostCheck({ ...base, hostInstalled: false }).state, 'warn');
  assert.equal(hostCheck({ ...base, hostInstalled: null }).state, 'unknown');
});
