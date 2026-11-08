#!/usr/bin/env node
/**
 * Tangkap screenshot listing Chrome Web Store dari app.html — permukaan yang
 * sama dengan yang dipakai pengguna, bukan harness terpisah.
 *
 * app.html memuat side panel produksi (dist/) di dalam satu halaman, jadi apa
 * yang terlihat di screenshot memang UI yang dikirim. Versi sebelumnya memotret
 * panel-test.html / studio.html / notes-panel.html — halaman uji yang bisa
 * menyimpang dari produk tanpa ada yang menyadarinya.
 *
 * Chrome Web Store menerima 1280×800 atau 640×400; di sini selalu 1280×800.
 *
 *   npm run pack:store:screens
 *   LAB_URL=http://127.0.0.1:8799 node scripts/capture-store-screens.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'store', 'screenshots');
const LAB = process.env.LAB_URL || 'http://127.0.0.1:8799';
const WIDTH = 1280;
const HEIGHT = 800;

async function waitForLab(url, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url + '/app.html');
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function ensureLab() {
  if (await waitForLab(LAB, 2000)) return;
  const child = spawn('python3', [path.join(ROOT, 'scripts/lab-server.py')], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  if (!(await waitForLab(LAB, 20000))) throw new Error(`lab server tidak menyala di ${LAB}`);
}

/**
 * Rapikan halaman untuk listing: sembunyikan spanduk harness (bukan bagian
 * produk) dan kunci lebarnya supaya bingkai 1280×800 terisi.
 */
async function stageShot(page, { width = 'full' } = {}) {
  await page.evaluate((w) => {
    // Gaya inline, bukan atribut [hidden]: aturan `.app-banner { display:flex }`
    // punya spesifisitas yang sama dengan `[hidden]`, jadi spanduk tetap tampil.
    const banner = document.querySelector('.app-banner');
    if (banner) banner.style.display = 'none';
    // Lab chrome (board D03: lab bar, lab tabs, state notes, sample rails) is not the product: the listing shows the panel only.
    for (const el of document.querySelectorAll('.labbar, #ltabs, .lstate, #lab-rails')) el.style.display = 'none';
    document.body.setAttribute('data-width', w);
  }, width);
  await new Promise((r) => setTimeout(r, 600));

  // Jangan memotret diam-diam pada lebar yang salah: aset listing yang
  // menyimpang dari yang dimaksud persis seperti inilah yang membuat
  // screenshot lama tidak lagi mewakili produk.
  const got = await page.evaluate(() => ({
    attr: document.body.getAttribute('data-width'),
    px: Math.round(document.body.getBoundingClientRect().width),
  }));
  const expected = { compact: 480, wide: 880 }[width];
  if (got.attr !== width || (expected && Math.abs(got.px - expected) > 2)) {
    throw new Error(
      `lebar tidak sesuai untuk "${width}": data-width=${got.attr}, lebar nyata ${got.px}px` +
        (expected ? ` (diharapkan ${expected}px)` : ''),
    );
  }
}

/**
 * Buka satu permukaan panel lewat kontrol nyatanya.
 *
 * Board D02: "settings" kini tab biasa (#view-settings), jadi jalurnya sama
 * dengan permukaan lain: klik item nav bawah lalu tunggu panel terlihat.
 */
async function openSurface(page, surface) {
    await page.evaluate((v) => {
      document.querySelector(`.bottom-nav-item[data-view="${v}"]`)?.click();
    }, surface);
    await page.waitForFunction(
      (v) => {
        const el = document.getElementById(`view-${v}`);
        return !!el && !el.classList.contains('hidden');
      },
      { timeout: 10_000 },
      surface,
    );
  await new Promise((r) => setTimeout(r, 700));
}

const SHOTS = [
  {
    file: '01-sidepanel-realtime.png',
    surface: 'captions',
    width: 'compact',
    caption: 'Side Panel: subtitel langsung + pilihan bahasa',
  },
  {
    file: '02-notes-minutes.png',
    surface: 'notes',
    width: 'wide',
    caption: 'Notulen rapat dari transkrip sesi',
    // Tanpa ini panel notulen kosong, dan screenshot listing tidak menunjukkan
    // fiturnya sama sekali. Tombol ini milik aplikasi sendiri dan mengisi
    // contoh notulen yang benar-benar dihasilkan pipeline-nya.
    prepare: async (page) => {
      const clicked = await page.evaluate(() => {
        const b = document.getElementById('btn-notes-sample');
        if (!b) return false;
        b.click();
        return true;
      });
      if (clicked) await new Promise((r) => setTimeout(r, 1200));
      return clicked;
    },
  },
  {
    file: '03-settings-helper.png',
    surface: 'settings',
    // Modal lebarnya tetap; shell lebar hanya menyisakan ruang kosong.
    width: 'compact',
    caption: 'Pengaturan mesin + status Native Helper & ekspor',
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(path.join(ROOT, 'dist', 'sidepanel.js'))) {
    throw new Error('dist/ belum dibangun — jalankan `npm run build` dulu');
  }
  await ensureLab();

  const puppeteer = await import('puppeteer');
  const launchOpts = {
    headless: true,
    args: [`--window-size=${WIDTH},${HEIGHT}`, '--disable-dev-shm-usage'],
  };
  const exe =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].find((p) => fs.existsSync(p));
  if (exe) launchOpts.executablePath = exe;

  const browser = await puppeteer.default.launch(launchOpts);
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  await page.goto(`${LAB}/app.html`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.waitForSelector('#app-mount .bottom-nav-item', { timeout: 30_000 });

  const written = [];
  for (const shot of SHOTS) {
    await openSurface(page, shot.surface);
    if (shot.prepare) await shot.prepare(page);
    await stageShot(page, { width: shot.width });
    const out = path.join(OUT, shot.file);
    await page.screenshot({ path: out, fullPage: false });
    written.push({ file: shot.file, surface: shot.surface, caption: shot.caption });
    console.log(`[store-screens] ✓ ${shot.file} — ${shot.caption}`);
  }

  // Galat halaman berarti screenshot memotret UI yang rusak; jangan diam.
  if (errors.length) {
    console.error('[store-screens] galat halaman saat menangkap:');
    for (const e of errors.slice(0, 5)) console.error('  ', e);
    throw new Error(`${errors.length} galat halaman — screenshot tidak dapat dipercaya`);
  }

  // Buang screenshot lama yang tidak lagi ada di daftar, supaya folder listing
  // tidak menyimpan tangkapan UI yang sudah tidak dikirim.
  const keep = new Set(SHOTS.map((s) => s.file));
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') && !keep.has(f)) {
      fs.rmSync(path.join(OUT, f));
      console.log(`[store-screens] – ${f} (usang, dihapus)`);
    }
  }

  fs.writeFileSync(
    path.join(OUT, 'captions.json'),
    JSON.stringify(
      { source: 'app.html', size: `${WIDTH}x${HEIGHT}`, capturedAt: new Date().toISOString(), shots: written },
      null,
      2,
    ) + '\n',
  );

  await browser.close();
  console.log(`[store-screens] ${written.length} screenshot ${WIDTH}×${HEIGHT} siap di store/screenshots/`);
  setTimeout(() => process.exit(0), 250);
}

main().catch((e) => {
  console.error('[store-screens] GAGAL:', e.message);
  process.exit(1);
});
