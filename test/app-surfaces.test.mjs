/**
 * Permukaan app.html — halaman yang dipakai untuk melihat panel produksi di
 * http://127.0.0.1:8799/app.html.
 *   node --test test/app-surfaces.test.mjs
 *
 * Dua cacat nyata yang dijaga di sini, keduanya lolos lama karena tidak ada
 * yang memeriksanya:
 *
 *  1. `#settings-modal` punya 17 anak langsung — satu `</div>` berlebih di
 *     sidepanel.html menutup `.modal-card` terlalu awal, sehingga 16 baris
 *     pengaturan terlempar keluar kartu. `.modal` adalah flex-row, jadi
 *     baris-baris itu berjajar dan meluber ke koordinat negatif: modal
 *     Pengaturan tidak terpakai, di ekstensi maupun di app.html.
 *  2. `transition: max-width` pada shell membuat max-width terkunci di nilai
 *     lama setelah panel notulen me-render ulang, sehingga tombol
 *     Auto/Compact/Wide/Full berhenti bekerja.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8881;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
/** Galat runtime apa pun di halaman berarti permukaannya tidak benar-benar jalan. */
const pageErrors = [];

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

before(async () => {
  assert.ok(existsSync('dist/sidepanel.html'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/app.html`);

  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,800'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#app-mount .bottom-nav-item');
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

const openView = async (view) => {
  await page.evaluate((v) => document.querySelector(`.bottom-nav-item[data-view="${v}"]`)?.click(), view);
  await page.waitForFunction(
    (v) => {
      const el = document.getElementById(`view-${v}`);
      return !!el && !el.classList.contains('hidden');
    },
    { timeout: 10_000 },
    view,
  );
};

const setWidth = async (w) => {
  await page.evaluate((v) => document.querySelector(`#width-seg button[data-width="${v}"]`).click(), w);
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => Math.round(document.body.getBoundingClientRect().width));
};

test('app.html memuat panel produksi dan kedua view bisa dibuka', async () => {
  for (const view of ['captions', 'notes', 'captions']) {
    await openView(view);
    assert.equal(
      await page.evaluate((v) => document.getElementById(`view-${v}`).classList.contains('hidden'), view),
      false,
      `view-${view} tidak terbuka`,
    );
  }
});

test('layout Side Panel transkripsi lengkap: sumber, bahasa, aksi, riwayat, helper', async () => {
  await openView('captions');
  const layout = await page.evaluate(() => {
    const v = document.getElementById('view-captions');
    const has = (sel) => !!v.querySelector(sel);
    return {
      kartu: [...v.querySelectorAll('.card')].map((c) => c.querySelector('h2,h3,.card-title')?.textContent?.trim() || ''),
      sumber: has('#mode-toggle') && has('#rt-target'),
      tugasBahasa: has('#task-toggle') && has('#src-lang') && has('#tgt-lang'),
      aksi: has('#btn-start') && has('#status-line'),
      // Baris transkrip punya wadah terpisah untuk sumber dan terjemahan
      // supaya mode dual-line bisa menampilkan keduanya sejajar.
      transkrip: has('#live-src-lines') && has('#live-tgt-lines') && has('#off-lines'),
      ekspor: has('#helper-export') && has('#helper-export-name-hint'),
    };
  });

  assert.equal(layout.sumber, true, 'kartu Source tidak lengkap');
  assert.equal(layout.tugasBahasa, true, 'Task & Languages tidak lengkap');
  assert.equal(layout.aksi, true, 'Actions & Preview tidak lengkap');
  assert.equal(layout.transkrip, true, 'wadah baris transkrip tidak lengkap');
  assert.equal(layout.ekspor, true, 'kartu Export tidak lengkap');
  // Kelima kartu itulah kerangka panel; kehilangan salah satunya berarti
  // ada bagian panel yang tidak terpasang.
  assert.equal(layout.kartu.length, 5, `harus 5 kartu, dapat ${layout.kartu.length}: ${layout.kartu}`);
});

test('penerima segmen: interim sementara, final permanen, arah dua arah, status pipeline', async () => {
  await openView('captions');
  const r = await page.evaluate(async () => {
    const send = (type, data) => chrome.runtime.sendMessage({ target: 'panel', type, data });
    const tgt = document.getElementById('live-tgt-lines');
    const status = () => document.getElementById('status-line')?.textContent?.trim() || '';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    send('pipeline-status', { state: 'listening', device: 'wasm' });
    await wait(200);
    const statusListening = status();

    // Bidangnya `source`/`translation` — BUKAN `src`/`tgt`. Payload yang salah
    // nama diterima diam-diam lalu tidak menghasilkan apa pun.
    send('subtitle', { source: 'Sedang bicara…', translation: 'Speaking…', interim: true, partial: true });
    await wait(250);
    const interimTampil = tgt.textContent.includes('Speaking…');

    // Beri jeda antar segmen seperti kedatangan sungguhan; dua pesan dalam satu
    // tick saling mendahului di jembatan pesan harness.
    send('subtitle', { source: 'Selamat pagi', translation: 'Good morning', t0: 10, t1: 12, dir: { src: 'id', tgt: 'en' } });
    await wait(250);
    send('subtitle', { source: 'Thank you', translation: 'Terima kasih', t0: 12, t1: 14, dir: { src: 'en', tgt: 'id' } });
    await wait(400);
    const baris = [...tgt.children].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    const interimTersisa = tgt.textContent.includes('Speaking…');

    send('error', { message: 'Uji galat' });
    await wait(200);
    return { statusListening, interimTampil, interimTersisa, baris, statusGalat: status() };
  });

  assert.match(r.statusListening, /wasm/, 'status pipeline tidak memuat perangkat');
  assert.equal(r.interimTampil, true, 'baris interim tidak muncul saat masih berbicara');
  // Interim harus digantikan hasil final, bukan menumpuk sebagai baris tersendiri.
  assert.equal(r.interimTersisa, false, 'baris interim tidak dibersihkan setelah hasil final');
  // Mode dua arah menandai arah tiap ucapan; tanpa ini ekspor kehilangan konteks.
  const semua = r.baris.join(' | ');
  assert.match(semua, /ID → EN.*Good morning/, `baris ID→EN hilang — isi: ${semua}`);
  assert.match(semua, /EN → ID.*Terima kasih/, `baris EN→ID hilang — isi: ${semua}`);
  assert.match(r.statusGalat, /Uji galat/, 'galat pipeline tidak sampai ke baris status');
});

test('overlay subtitel di-host app.html: sesi membangun panel, final merender baris, sesi selesai membongkar', async () => {
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const emit = (type, data) => window.__mockEmit({ target: 'content', type, data });
    const host = () => document.getElementById('__local_transsub_overlay');
    const rowsOf = () => [...(host()?.shadowRoot?.querySelectorAll('.block.tgt') || [])].map((e) => e.textContent.trim());

    const before = !!host();
    emit('session', { active: true, config: { dualLine: true, srcLang: 'ja', tgtLang: 'en' }, cacheCues: [] });
    await wait(350);
    const panel = !!host()?.shadowRoot?.querySelector('.panel');

    // Bentuk final PERSIS seperti offscreen.js: tanpa bidang `interim`.
    // (`interim:false` adalah sinyal "hapus draf" dan sengaja tidak merender.)
    emit('subtitle', { final: true, t0: 1, t1: 3, source: 'こんにちは', translation: 'Hello from lab', rawSource: 'こんにちは', rawTranslation: 'Hello from lab' });
    await wait(350);
    const afterEmit = rowsOf();

    // Jalur background sungguhan: chrome.tabs.sendMessage → overlay.
    await chrome.tabs.sendMessage(1, {
      target: 'content',
      type: 'subtitle',
      data: { final: true, t0: 3, t1: 5, source: 'ありがとう', translation: 'Thanks via tabs', rawSource: 'ありがとう', rawTranslation: 'Thanks via tabs' },
    });
    await wait(300);
    const afterTabs = rowsOf();

    emit('session', { active: false });
    await wait(350);
    return { before, panel, afterEmit, afterTabs, hostAfterOff: !!host() };
  });

  assert.equal(r.before, false, 'overlay tidak boleh ada sebelum sesi');
  assert.equal(r.panel, true, 'panel overlay tidak dibangun saat sesi mulai');
  assert.ok(r.afterEmit.some((t) => t.includes('Hello from lab')), `baris final tidak terender: ${r.afterEmit}`);
  assert.ok(r.afterTabs.some((t) => t.includes('Thanks via tabs')), 'jalur chrome.tabs.sendMessage tidak sampai ke overlay');
  assert.equal(r.hostAfterOff, false, 'overlay harus dibongkar saat sesi selesai');
});

test('kait skenario mock: helper offline gagal, fixture menjawab, reset kembali passthrough', async () => {
  const r = await page.evaluate(async () => {
    const m = window.__labMock;
    m.helper.mode = 'offline';
    let offline;
    try {
      await fetch('http://127.0.0.1:17865/health');
      offline = 'terjawab';
    } catch (e) {
      offline = e.name;
    }
    m.helper.mode = 'fixture';
    const health = await (await fetch('http://127.0.0.1:17865/health')).json();
    const dev = await (await fetch('http://127.0.0.1:17865/engine/device', { method: 'POST', body: JSON.stringify({ device: 'cpu' }) })).json();
    m.helper.failNext = 1;
    let recovered;
    try {
      await fetch('http://127.0.0.1:17865/health');
      recovered = 'tidak gagal';
    } catch {
      recovered = (await (await fetch('http://127.0.0.1:17865/health')).json()).ok;
    }
    const log = m.helper.log.map((x) => `${x.method} ${x.path}`);
    m.reset();
    return { offline, health: health.engine, dev, recovered, log, modeAfterReset: m.helper.mode };
  });
  assert.equal(r.offline, 'TypeError', 'mode offline harus gagal seperti helper mati');
  assert.equal(r.health, 'faster-whisper');
  assert.deepEqual({ ok: r.dev.ok, device: r.dev.device, restart: r.dev.restart_required }, { ok: true, device: 'cpu', restart: true });
  assert.equal(r.recovered, true, 'failNext harus gagal sekali lalu pulih');
  assert.ok(r.log.includes('POST /engine/device'), 'log permintaan harus tercatat');
  assert.equal(r.modeAfterReset, 'passthrough');
});

test('pemilihan Native Helper: kartu muncul saat mesin native, status/perangkat dari helper, fallback saat mati, mode manual', async () => {
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const m = window.__labMock;
    const $ = (id) => document.getElementById(id);
    const setEngine = async (v) => {
      const sel = $('engine-toggle');
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
      await wait(500);
    };
    const recheck = async () => {
      $('btn-native-check').click();
      await wait(700);
    };
    const out = {};

    $('btn-settings').click();
    await wait(300);
    out.blockHiddenBrowser = $('native-block').classList.contains('hidden');

    // 1) Helper hidup (fixture Linux + CUDA) — status dan perangkat dari helper.
    m.helper.mode = 'fixture';
    await setEngine('native');
    await recheck();
    out.blockVisibleNative = !$('native-block').classList.contains('hidden');
    out.status = $('native-status').textContent;
    out.statusClass = $('native-status').className;
    out.pill = $('native-device-active').textContent;
    out.warningWithHelper = $('model-warning').textContent;

    // 2) Ganti prioritas perangkat ke CPU → POST /engine/device dan petunjuk restart.
    m.helper.log.length = 0;
    document.querySelector('#native-device-toggle [data-hdevice="cpu"]').click();
    await wait(700);
    out.devicePosts = m.helper.log.filter((x) => x.method === 'POST' && x.path === '/engine/device').length;
    out.deviceHint = $('native-device-hint').textContent;

    // 3) Helper mati → indikator cadangan: status offline + peringatan model.
    m.helper.mode = 'offline';
    await recheck();
    out.statusOffline = $('native-status').textContent;
    out.statusOfflineClass = $('native-status').className;
    out.warningOffline = $('model-warning').textContent;
    out.pillOffline = $('native-device-active').textContent;

    // 4) Helper Apple/MLX (tanpa pengaturan perangkat) → tombol perangkat dikunci.
    m.helper.mode = 'fixture';
    m.helper.health = { ...m.helper.health, engine: 'mlx-whisper', model: 'whisper-large-v3-turbo', device: 'apple-silicon', platform: 'Darwin' };
    m.helper.device = { ...m.helper.device, supported: false, active: 'apple-silicon' };
    await recheck();
    out.appleDisabled = [...document.querySelectorAll('#native-device-toggle button')].every((b) => b.disabled);
    out.applePill = $('native-device-active').textContent;

    // Kembali ke browser → kartu helper hilang.
    await setEngine('browser');
    out.blockHiddenAgain = $('native-block').classList.contains('hidden');
    $('btn-close-settings').click();
    m.reset();
    m.helper.health.engine = 'faster-whisper';
    m.helper.health.device = 'cuda';
    m.helper.device.supported = true;
    m.helper.device.active = 'cuda';
    return out;
  });

  assert.equal(r.blockHiddenBrowser, true, 'kartu helper harus tersembunyi saat mesin Browser');
  assert.equal(r.blockVisibleNative, true, 'memilih mesin Native harus menampilkan kartu helper');
  assert.match(r.status, /faster-whisper · large-v3-turbo/, `status helper tidak dari /health: ${r.status}`);
  assert.match(r.statusClass, /\bon\b/);
  assert.match(r.pill, /cuda/i, `pil perangkat harus menunjukkan perangkat aktif helper: ${r.pill}`);
  assert.doesNotMatch(r.warningWithHelper, /not running/, 'tidak boleh ada peringatan saat helper hidup');

  assert.equal(r.devicePosts, 1, 'memilih CPU harus mengirim tepat satu POST /engine/device');
  assert.match(r.deviceHint, /Restart/, `petunjuk perangkat harus meminta restart: ${r.deviceHint}`);

  // Indikator cadangan: pengguna memilih native tapi helper mati.
  assert.match(r.statusOffline, /not running/);
  assert.match(r.statusOfflineClass, /\boff\b/);
  assert.match(r.warningOffline, /not running/, 'peringatan model harus menandai helper mati');
  assert.doesNotMatch(r.pillOffline, /cuda/i, 'pil perangkat tidak boleh menyisakan data helper lama');

  assert.equal(r.appleDisabled, true, 'helper MLX tidak punya pilihan perangkat — tombol harus dikunci');
  assert.match(r.applePill, /Apple Silicon/);
  assert.equal(r.blockHiddenAgain, true);
});

/* --------------------------------------------------------------------------
 * Pemrosesan berkas audio/video (mode Offline). Whisper sungguhan tidak
 * dijalankan — terlalu berat untuk tes — tapi jalur berkasnya nyata: File
 * dipilih lewat <input>, di-stage ke OPFS secara chunked, lalu pesan yang
 * dikirim offscreen (offline-progress / offline-line / offline-done) dipakai
 * apa adanya untuk memverifikasi UI status, batal, hasil, dan ekspor.
 */
const FAKE_MEDIA_BYTES = 20 * 1024 * 1024;

test('halaman pemrosesan berkas: pilih berkas → staging chunked ke OPFS → siap diproses', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mediaPath = join(mkdtempSync(join(tmpdir(), 'lts-media-')), 'rapat-mingguan.wav');
  writeFileSync(mediaPath, Buffer.alloc(FAKE_MEDIA_BYTES, 7));

  await openView('captions');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#mode-toggle button')].find((b) => /offline/i.test(b.textContent));
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  const input = await page.$('#off-file');
  assert.ok(input, '#off-file (input berkas) tidak ada');
  await input.uploadFile(mediaPath);

  // Staging selesai saat teks nama berkas tidak lagi menyebut proses staging.
  await page.waitForFunction(
    () => {
      const t = document.getElementById('off-filename')?.textContent || '';
      return /rapat-mingguan\.wav \(20\.0 MB\)$/.test(t.trim());
    },
    { timeout: 20_000 },
  );

  const staged = await page.evaluate(async () => {
    const io = await import('/src/lib/offline-io.js');
    const f = await io.getOfflineInputFile();
    // Bukti chunked: progres dipanggil berkali-kali dengan `loaded` yang naik,
    // bukan sekali di akhir — berkas tidak pernah dimuat utuh ke RAM.
    const calls = [];
    await io.stageFileToOpfs(new File([new Uint8Array(6 * 1024 * 1024)], 'probe.bin'), (loaded, total) => calls.push([loaded, total]));
    const monotonic = calls.every(([l], i) => i === 0 || l > calls[i - 1][0]);
    return { size: f.size, name: document.getElementById('off-filename').textContent, calls: calls.length, monotonic, last: calls.at(-1), startEnabled: !document.getElementById('btn-start').disabled };
  });

  assert.equal(staged.size, FAKE_MEDIA_BYTES, 'berkas di OPFS harus berukuran sama dengan yang dipilih');
  assert.match(staged.name, /rapat-mingguan\.wav \(20\.0 MB\)/);
  assert.ok(staged.calls > 1, `staging harus berlangsung per potongan, dapat ${staged.calls} panggilan progres`);
  assert.equal(staged.monotonic, true, 'progres staging harus naik monoton');
  assert.deepEqual(staged.last, [6 * 1024 * 1024, 6 * 1024 * 1024]);
  assert.equal(staged.startEnabled, true, 'Start harus aktif setelah berkas siap');
});

test('UI status pemrosesan dan tombol batal: progres tampil, batal mengirim offline-cancel, status "cancelled"', async () => {
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const send = (type, data) => chrome.runtime.sendMessage({ target: 'panel', type, data });
    const toOffscreen = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.target === 'offscreen') toOffscreen.push(m.type);
    });
    const out = {};

    // Progres biasa (per segmen) dan progres job berkas besar (per tahap).
    // Bentuk yang dikirim offscreen per segmen: stage 'transcribe' + idx/total.
    send('offline-progress', { stage: 'transcribe', idx: 2, total: 10 });
    await wait(200);
    out.progressText = document.getElementById('off-progress-text').textContent;
    send('offline-progress', { large: true, stage: 'upload', pct: 37, name: 'besar.mp4', sizeBytes: 3e9, loaded: 1.1e9, total: 3e9 });
    await wait(400);
    out.statusUpload = document.getElementById('status-line').textContent;
    out.cancelBtn = !!document.getElementById('btn-helper-lf-cancel');
    out.pct = document.getElementById('helper-lf-pct')?.textContent || '';

    // Tombol batal → offline-cancel ke offscreen (yang lalu menjawab offline-error cancelled).
    document.getElementById('btn-helper-lf-cancel')?.click();
    await wait(200);
    out.cancelSent = toOffscreen.includes('offline-cancel');
    send('offline-error', { cancelled: true });
    await wait(300);
    out.statusAfterCancel = document.getElementById('status-line').textContent;
    out.jobState = document.getElementById('helper-lf-state')?.textContent || '';
    return out;
  });

  assert.match(r.progressText, /2 \/ 10/, `progres per segmen tidak tampil: ${r.progressText}`);
  assert.match(r.statusUpload, /37%/, `progres tahap unggah tidak tampil: ${r.statusUpload}`);
  assert.equal(r.cancelBtn, true, 'job berkas besar harus menampilkan tombol Batalkan');
  assert.match(r.pct, /37%/);
  assert.equal(r.cancelSent, true, 'klik Batalkan harus mengirim offline-cancel ke offscreen');
  assert.match(r.statusAfterCancel, /cancel/i, `status harus menyebut dibatalkan: ${r.statusAfterCancel}`);
  assert.match(r.jobState, /cancel/i, `kartu job harus menandai dibatalkan: ${r.jobState}`);
});

test('hasil dan ekspor TXT/SRT/VTT: baris hasil tampil, ekspor lewat normalizer (VTT sah untuk ffmpeg)', async () => {
  const r = await page.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const send = (type, data) => chrome.runtime.sendMessage({ target: 'panel', type, data });
    const lines = [
      { t0: 0, t1: 2.5, src: 'こんにちは', tgt: 'Hello everyone' },
      { t0: 2.5, t1: 6, src: '今日の議題を始めます', tgt: "Let's start today's agenda" },
      { t0: 6, t1: 9.2, src: 'ありがとう', tgt: 'Thank you' },
    ];
    // Yang dilakukan tombol Start sebelum menyerahkan ke offscreen — tanpa
    // menjalankan Whisper: kosongkan hasil lama dan buka wadah hasil.
    document.getElementById('off-lines').innerHTML = '';
    document.getElementById('off-results').classList.remove('hidden');
    lines.forEach((line, i) => send('offline-line', { line, idx: i + 1, total: lines.length }));
    send('offline-done', {});
    await wait(400);
    const statusDone = document.getElementById('status-line').textContent;

    // Tangkap isi berkas ekspor lewat createObjectURL — unduhan tidak bisa
    // dibaca headless, tapi Blob-nya bisa.
    const captured = {};
    const orig = URL.createObjectURL;
    let pendingKind = '';
    URL.createObjectURL = (blob) => {
      captured[pendingKind] = blob.text();
      return 'blob:lab';
    };
    for (const kind of ['srt', 'vtt', 'txt']) {
      pendingKind = kind;
      document.getElementById(`btn-${kind}`).click();
      await wait(250);
    }
    URL.createObjectURL = orig;
    const text = {};
    for (const [k, p] of Object.entries(captured)) text[k] = await p;

    return {
      statusDone,
      rows: document.querySelectorAll('#off-lines > div').length,
      progress: document.getElementById('off-progress-text').textContent,
      firstRow: document.querySelector('#off-lines .l-tgt')?.textContent,
      text,
      status: document.getElementById('status-line').textContent,
    };
  });

  assert.match(r.statusDone, /done|selesai/i, `offline-done harus menandai selesai: ${r.statusDone}`);
  assert.equal(r.rows, 3, 'tiga baris hasil harus tampil');
  assert.match(r.progress, /3 \/ 3/);
  assert.equal(r.firstRow, 'Hello everyone');
  assert.match(r.status, /Downloaded|Terunduh|downloaded/i, `ekspor harus memberi kabar unduhan: ${r.status}`);

  const { srt, vtt, txt } = r.text;
  assert.ok(srt && vtt && txt, `ketiga format harus menghasilkan berkas: ${Object.keys(r.text)}`);
  // SRT: indeks berurut dari 1, panah, koma milidetik, baris kosong antar cue.
  // Cue pertama adalah metadata 1 ms ("Local TransSub / Title: …") — penanda
  // asal berkas yang disengaja; cue ucapan menyusul dengan waktu aslinya.
  assert.match(srt, /^1\r?\n00:00:00,000 --> 00:00:00,001\r?\nLocal TransSub\r?\nTitle: /, 'cue metadata SRT harus di indeks 1');
  assert.match(srt, /\n\r?\n2\r?\n00:00:00,000 --> 00:00:02,500\r?\n/, 'cue ucapan pertama harus di indeks 2 dengan waktu aslinya');
  const indices = [...srt.matchAll(/(?:^|\n\r?\n)(\d+)\r?\n\d\d:/g)].map((m) => Number(m[1]));
  assert.deepEqual(indices, [1, 2, 3, 4], `penomoran SRT harus berurut: ${indices}`);
  // VTT: baris kosong sesudah header — tanpa itu ffmpeg membuang cue pertama.
  assert.match(vtt, /^WEBVTT\r?\n(NOTE[^\n]*\r?\n)*\r?\n00:00:00\.000 --> /, 'VTT harus punya baris kosong sebelum cue pertama');
  assert.match(vtt, /Thank you/);
  // TXT: stempel waktu + teks; sumber ikut bila ada.
  assert.match(txt, /\[00:00:00\.000\]/);
  assert.match(txt, /Hello everyone/);
  // Bawaan non-Windows: LF tanpa BOM.
  assert.equal(vtt.charCodeAt(0) === 0xfeff, false, 'tidak boleh ada BOM di bawaan macOS/Linux');
  assert.doesNotMatch(srt, /\r\n/, 'tidak boleh CRLF di bawaan macOS/Linux');
});

test('modal Pengaturan berisi tepat satu kartu, dan kartunya terpusat di layar', async () => {
  await page.evaluate(() => document.getElementById('btn-settings').click());
  await page.waitForFunction(() => {
    const m = document.getElementById('settings-modal');
    return !!m && !m.classList.contains('hidden');
  });

  const m = await page.evaluate(() => {
    const modal = document.getElementById('settings-modal');
    const card = modal.querySelector('.modal-card');
    const r = card.getBoundingClientRect();
    return {
      children: modal.children.length,
      cardX: Math.round(r.x),
      centerOffset: Math.abs(r.x + r.width / 2 - window.innerWidth / 2),
      // Kontrol yang harus benar-benar berada DI DALAM kartu.
      insideCard: ['engine-toggle', 'ui-lang-toggle', 'theme-toggle'].filter((id) =>
        card.contains(document.getElementById(id)),
      ),
    };
  });

  assert.equal(m.children, 1, `#settings-modal harus punya 1 anak (.modal-card), dapat ${m.children}`);
  assert.ok(m.cardX >= 0, `kartu keluar layar di x=${m.cardX}`);
  assert.ok(m.centerOffset < 3, `kartu tidak terpusat (meleset ${Math.round(m.centerOffset)}px)`);
  assert.deepEqual(m.insideCard.sort(), ['engine-toggle', 'theme-toggle', 'ui-lang-toggle']);

  await page.evaluate(() => document.getElementById('btn-close-settings').click());
});

test('tombol lebar tetap bekerja setelah panel notulen me-render ulang', async () => {
  // Urutan inilah yang dulu membekukan max-width: render ulang notulen lalu
  // ganti preset lebar.
  await setWidth('compact');
  await openView('notes');
  await page.evaluate(() => document.getElementById('btn-notes-sample')?.click());
  await new Promise((r) => setTimeout(r, 1200));

  assert.equal(await setWidth('wide'), 880, 'preset "wide" tidak diterapkan setelah render ulang');
  assert.equal(await setWidth('compact'), 480);
  assert.equal(await setWidth('full'), 1280);
  assert.equal(await setWidth('wide'), 880);
});

test('tidak ada galat runtime di halaman selama seluruh alur di atas', () => {
  assert.deepEqual(pageErrors, [], `galat halaman: ${pageErrors.join(' | ')}`);
});
