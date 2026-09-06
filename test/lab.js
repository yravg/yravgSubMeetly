/** yraverageSubMin Translation Lab — client logic */
const NATIVE = 'http://127.0.0.1:17865';
const TARGET_DRAFT_MS = 500;

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const resultsBody = $('results-body');

let pcmCache = null; // Float32Array @16kHz
let manifest = null;
let liveTimer = null;
let liveRunning = false;

function ts() {
  return new Date().toLocaleTimeString();
}

function log(msg, cls = '') {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${ts()}] ${msg}`;
  logEl.prepend(line);
}

function nativeUrl() {
  return ($('native-url').value || NATIVE).replace(/\/+$/, '');
}

async function api(path, opts = {}) {
  const r = await fetch(`${nativeUrl()}${path}`, opts);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${text.slice(0, 200)}`);
  return json;
}

function addResult(row) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${row.pair}</td>
    <td>${row.stage}</td>
    <td class="${row.ms <= TARGET_DRAFT_MS ? 'ok' : row.ms <= 900 ? 'warn' : 'bad'}">${row.ms} ms</td>
    <td>${row.asrMs ?? '—'}</td>
    <td>${row.mtMs ?? '—'}</td>
    <td class="src">${escapeHtml(row.source || '')}</td>
    <td class="tgt">${escapeHtml(row.translation || '')}</td>
    <td>${row.pass ? '✅' : '⚠️'}</td>
  `;
  resultsBody.prepend(tr);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function checkHealth() {
  const el = $('health');
  try {
    const h = await api('/health');
    el.className = 'pill ok';
    el.textContent = 'Native OK';
    $('health-detail').textContent = [
      h.engine,
      h.model?.split('/').pop(),
      h.draft_model ? `draft: ${h.draft_model.split('/').pop()}` : 'no draft',
      h.features?.draft ? 'draft pipeline' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return h;
  } catch (e) {
    el.className = 'pill bad';
    el.textContent = 'Native offline';
    $('health-detail').textContent = String(e.message);
    return null;
  }
}

async function loadManifest() {
  const r = await fetch('samples/manifest.json');
  manifest = await r.json();
  const sel = $('sample-select');
  sel.innerHTML = '';
  for (const s of manifest.samples) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.label} — ${s.text.slice(0, 40)}…`;
    sel.appendChild(o);
  }
}

async function decodeToMono16k(arrayBuffer) {
  const ac = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ac.decodeAudioData(arrayBuffer.slice(0));
    const len = Math.ceil(buf.duration * 16000);
    const off = new OfflineAudioContext(1, len, 16000);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  } finally {
    ac.close().catch(() => {});
  }
}

async function loadSample(id) {
  const sample = manifest.samples.find((s) => s.id === id);
  if (!sample) return;
  $('src-lang').value = sample.src;
  $('tgt-lang').value = sample.tgt;
  $('expected-text').textContent = sample.text;

  const r = await fetch(`samples/${sample.file}`);
  if (!r.ok) throw new Error(`Missing ${sample.file} — run: ./scripts/gen-samples.sh`);
  const ab = await r.arrayBuffer();
  pcmCache = await decodeToMono16k(ab);

  const blob = new Blob([ab], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const v = $('player');
  v.src = url;
  v.load();
  log(`Loaded ${sample.id} (${(pcmCache.length / 16000).toFixed(2)}s PCM)`, 'ok');
}

async function loadFromFile(file) {
  const ab = await file.arrayBuffer();
  pcmCache = await decodeToMono16k(ab);
  const url = URL.createObjectURL(file);
  $('player').src = url;
  $('player').load();
  log(`Loaded file ${file.name} (${(pcmCache.length / 16000).toFixed(2)}s)`, 'ok');
}

async function loadFromUrl(url) {
  if (isYouTubeUrl(url)) return loadFromYouTube(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  const ab = await r.arrayBuffer();
  pcmCache = await decodeToMono16k(ab);
  hideYouTubeEmbed();
  $('player').src = url;
  $('player').load();
  log(`Loaded URL (${(pcmCache.length / 16000).toFixed(2)}s)`, 'ok');
}

function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

function showYouTubeEmbed(url) {
  const wrap = $('yt-embed-wrap');
  const vid = extractYouTubeId(url);
  if (!wrap || !vid) return;
  wrap.hidden = false;
  wrap.querySelector('iframe').src = `https://www.youtube.com/embed/${vid}`;
}

function hideYouTubeEmbed() {
  const wrap = $('yt-embed-wrap');
  if (!wrap) return;
  wrap.hidden = true;
  const iframe = wrap.querySelector('iframe');
  if (iframe) iframe.src = '';
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function loadFromYouTube(url) {
  const btn = $('btn-load-url');
  const vid = extractYouTubeId(url);
  btn.disabled = true;
  btn.textContent = 'Loading…';
  showYouTubeEmbed(url);
  $('yt-title').textContent = vid ? `YouTube: ${vid}` : url;

  try {
    log('YouTube: fetching audio via lab server (yt-dlp)…');
    const infoRes = await fetch(`/api/youtube-info?url=${encodeURIComponent(url)}`);
    const info = await infoRes.json();
    if (!infoRes.ok) throw new Error(info.error || `Info failed ${infoRes.status}`);

    $('yt-title').textContent = info.title || vid;
    log(
      `YouTube: “${info.title || info.id}” (${info.duration ? `${info.duration}s` : '?'})` +
        (info.cached ? ' [cached]' : ' — downloading…'),
    );

    const audioRes = await fetch(`/api/youtube-audio?url=${encodeURIComponent(url)}`);
    if (!audioRes.ok) {
      const err = await audioRes.json().catch(() => ({}));
      throw new Error(err.error || `Audio failed ${audioRes.status}`);
    }
    const ab = await audioRes.arrayBuffer();
    pcmCache = await decodeToMono16k(ab);
    const blobUrl = URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
    $('player').src = blobUrl;
    $('player').load();
    log(`YouTube audio ready (${(pcmCache.length / 16000).toFixed(1)}s for benchmark)`, 'ok');
  } catch (e) {
    const msg = e.message || String(e);
    log(`YouTube audio failed: ${msg}`, 'bad');
    if (/bot|sign in/i.test(msg)) {
      log('YouTube wants a signed-in session. Upload cookies.txt below, or use the extension (dev-browser.sh).', 'warn');
      $('yt-help')?.setAttribute('open', '');
    }
    if (vid) {
      $('btn-open-tab').onclick = () => window.open(`https://www.youtube.com/watch?v=${vid}`, '_blank');
      $('btn-open-tab').hidden = false;
    }
    pcmCache = null;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
}

function slicePcm(startSec, durSec) {
  const s0 = Math.floor(startSec * 16000);
  const s1 = Math.min(pcmCache.length, s0 + Math.floor(durSec * 16000));
  return pcmCache.subarray(s0, s1);
}

async function postDraft(audio, src, tgt) {
  const q = new URLSearchParams({ src, tgt, language: src });
  const t0 = performance.now();
  const j = await api(`/draft?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  const ms = Math.round(performance.now() - t0);
  return { ...j, ms, asr_ms: j.asr_ms, translate_ms: j.translate_ms };
}

async function postTranscribe(audio, lang) {
  const q = new URLSearchParams({ language: lang, task: 'transcribe' });
  const t0 = performance.now();
  const j = await api(`/transcribe?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
  });
  return { text: j.text, ms: Math.round(performance.now() - t0) };
}

async function postTranslate(text, src, tgt, fast) {
  const q = new URLSearchParams({ src, tgt });
  if (fast) q.set('fast', '1');
  const t0 = performance.now();
  const j = await api(`/translate?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: text,
  });
  return { text: j.text, ms: Math.round(performance.now() - t0) };
}

async function postRefine(text, draft, src, tgt) {
  const q = new URLSearchParams({ src, tgt });
  const t0 = performance.now();
  const j = await api(`/translate_refine?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, draft }),
  });
  return { text: j.text, ms: Math.round(performance.now() - t0) };
}

async function runDraftWindow(pairLabel, src, tgt, windowSec, offsetSec = 0) {
  if (!pcmCache?.length) throw new Error('No audio loaded');
  const audio = slicePcm(offsetSec, windowSec);
  if (audio.length < 4800) throw new Error('Window too short (<0.3s)');
  const r = await postDraft(audio, src, tgt);
  const pass = r.ms <= TARGET_DRAFT_MS && !!(r.source || r.translation);
  addResult({
    pair: pairLabel,
    stage: `draft ${windowSec}s`,
    ms: r.ms,
    asrMs: r.asr_ms ?? '—',
    mtMs: r.translate_ms ?? '—',
    source: r.source,
    translation: r.translation,
    pass,
  });
  log(`${pairLabel} draft@${windowSec}s → ${r.ms}ms | ${r.translation || r.source || '(empty)'}`, pass ? 'ok' : 'warn');
  return r;
}

async function runFullPipeline(sample) {
  const pairLabel = `${sample.src}→${sample.tgt}`;
  log(`--- Full pipeline: ${pairLabel} ---`);

  await loadSample(sample.id);
  await new Promise((r) => setTimeout(r, 300));

  // 1) Live draft windows (simulate refine loop)
  for (const w of [0.35, 0.5, 1.0, 2.0]) {
    if (pcmCache.length >= w * 16000) {
      await runDraftWindow(pairLabel, sample.src, sample.tgt, w);
    }
  }

  // 2) Final transcribe (full utterance)
  const full = pcmCache;
  const asr = await postTranscribe(full, sample.src);
  addResult({
    pair: pairLabel,
    stage: 'final ASR',
    ms: asr.ms,
    source: asr.text,
    translation: '',
    pass: !!asr.text,
  });

  // 3) Draft translate (fast) from known text
  const fastMt = await postTranslate(sample.text, sample.src, sample.tgt, true);
  addResult({
    pair: pairLabel,
    stage: 'fast MT',
    ms: fastMt.ms,
    source: sample.text,
    translation: fastMt.text,
    pass: fastMt.ms <= TARGET_DRAFT_MS * 2,
  });

  // 4) Final refine
  const refined = await postRefine(sample.text, fastMt.text, sample.src, sample.tgt);
  addResult({
    pair: pairLabel,
    stage: 'refine',
    ms: refined.ms,
    source: sample.text,
    translation: refined.text,
    pass: !!refined.text,
  });
  log(`Refine: ${refined.text}`, 'ok');
}

async function runAllTests() {
  $('btn-run-all').disabled = true;
  resultsBody.innerHTML = '';
  log('Starting full benchmark suite…');
  const h = await checkHealth();
  if (!h) {
    log('Start native helper: cd native && ./run.sh', 'bad');
    $('btn-run-all').disabled = false;
    return;
  }

  for (const sample of manifest.samples) {
    try {
      await runFullPipeline(sample);
    } catch (e) {
      log(`${sample.id} FAILED: ${e.message}`, 'bad');
      addResult({
        pair: `${sample.src}→${sample.tgt}`,
        stage: 'error',
        ms: 0,
        source: e.message,
        pass: false,
      });
    }
  }
  log('Benchmark suite complete.', 'ok');
  $('btn-run-all').disabled = false;
  exportResults();
}

function exportResults() {
  const rows = [...resultsBody.querySelectorAll('tr')].map((tr) => {
    const c = tr.querySelectorAll('td');
    return {
      pair: c[0]?.textContent,
      stage: c[1]?.textContent,
      ms: c[2]?.textContent,
      asrMs: c[3]?.textContent,
      mtMs: c[4]?.textContent,
      source: c[5]?.textContent,
      translation: c[6]?.textContent,
      pass: c[7]?.textContent,
    };
  });
  const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `transsub-lab-${Date.now()}.json`;
  a.click();
}

function stopLive() {
  liveRunning = false;
  clearTimeout(liveTimer);
  $('btn-live').textContent = '▶ Simulate live refine';
}

async function tickLive() {
  if (!liveRunning || !pcmCache?.length) return;
  const src = $('src-lang').value;
  const tgt = $('tgt-lang').value;
  const player = $('player');
  const pos = player.currentTime || 0;
  const windowSec = parseFloat($('live-window').value) || 0.5;
  const audio = slicePcm(Math.max(0, pos - windowSec), windowSec);
  if (audio.length >= 4800) {
    try {
      const r = await postDraft(audio, src, tgt);
      $('live-src').textContent = r.source || '…';
      $('live-tgt').textContent = r.translation || '…';
      $('live-ms').textContent = `${r.ms} ms (target ≤${TARGET_DRAFT_MS})`;
      $('live-ms').className = r.ms <= TARGET_DRAFT_MS ? 'ok' : 'warn';
    } catch (e) {
      $('live-src').textContent = `Error: ${e.message}`;
    }
  }
  liveTimer = setTimeout(tickLive, parseInt($('live-interval').value, 10) || 300);
}

function startLive() {
  if (liveRunning) {
    stopLive();
    return;
  }
  if (!pcmCache?.length) {
    log('Load audio first', 'bad');
    return;
  }
  liveRunning = true;
  $('btn-live').textContent = '⏹ Stop live refine';
  const player = $('player');
  player.play().catch(() => {});
  tickLive();
}

function wireEvents() {
  $('btn-health').addEventListener('click', checkHealth);
  $('btn-run-all').addEventListener('click', runAllTests);
  $('btn-upload-cookies').addEventListener('click', () => {
    const f = $('cookies-input').files?.[0];
    if (f) uploadCookies(f).catch((err) => log(err.message, 'bad'));
  });
  $('cookies-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) uploadCookies(f).catch((err) => log(err.message, 'bad'));
  });
  $('btn-draft-once').addEventListener('click', async () => {
    const src = $('src-lang').value;
    const tgt = $('tgt-lang').value;
    const w = parseFloat($('live-window').value) || 0.5;
    const player = $('player');
    await runDraftWindow(`${src}→${tgt}`, src, tgt, w, Math.max(0, (player.currentTime || pcmCache.length / 16000) - w));
  });
  $('btn-live').addEventListener('click', startLive);
  $('btn-export').addEventListener('click', exportResults);
  $('sample-select').addEventListener('change', (e) => loadSample(e.target.value));
  $('file-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadFromFile(f).catch((err) => log(err.message, 'bad'));
  });
  $('btn-load-url').addEventListener('click', () => {
    const url = $('media-url').value.trim();
    if (url) loadFromUrl(url).catch((err) => log(err.message, 'bad'));
  });
  $('player').addEventListener('play', () => {
    if (liveRunning) tickLive();
  });
}

async function refreshYouTubeAuth() {
  const el = $('cookies-status');
  if (!el) return;
  try {
    const j = await fetch('/api/youtube-auth').then((r) => r.json());
    if (j.cookies_file) {
      el.textContent = '✅ cookies.txt loaded — retry YouTube Load';
      el.className = 'ok';
    } else if (j.browser_profiles?.length) {
      el.textContent = `No cookies file yet. Found browser profiles: ${j.browser_profiles.slice(0, 3).join(', ')}… (may need Full Disk Access)`;
      el.className = 'warn';
    } else {
      el.textContent = 'No cookies — upload cookies.txt or use extension tab capture';
      el.className = 'warn';
    }
  } catch {
    el.textContent = 'Could not reach lab server';
    el.className = 'bad';
  }
}

async function uploadCookies(file) {
  const text = await file.text();
  const r = await fetch('/api/youtube-cookies', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Upload failed ${r.status}`);
  log('cookies.txt uploaded — retry YouTube Load', 'ok');
  await refreshYouTubeAuth();
}

async function init() {
  wireEvents();
  await loadManifest();
  await checkHealth();
  await refreshYouTubeAuth();
  if (manifest.samples[0]) await loadSample(manifest.samples[0].id);
}

init().catch((e) => log(`Init failed: ${e.message}`, 'bad'));
