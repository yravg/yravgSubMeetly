/**
 * Animasi dok tampilan di Minutes Register (src/minutes-dock.js + minutes.css),
 * dijalankan pada halaman sungguhan lewat Puppeteer.
 *   node --test test/dock-motion.test.mjs
 *
 * Yang dijaga:
 *  - Hover di tombol mini mengisi cincin SVG dari 0 sampai penuh selama
 *    dockArmMs, lalu dok membuka. Cincin harus benar-benar bergerak — dulu
 *    animasinya hanya berputar tanpa memberi tahu sisa waktu.
 *  - Menutup dok tidak langsung berpindah: menu diberi waktu keluar, lalu
 *    outline menelusuri keliling ikon sekali.
 *  - Lama tunggu bisa diubah di panel Pengaturan dan bertahan setelah muat ulang;
 *    "Off" mematikan hover tanpa mematikan klik.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8884;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await wait(120);
  }
  throw new Error(`lab server tidak menyala di ${url}`);
}

/** Titik tengah tombol mini, dalam koordinat viewport. */
async function miniCenter() {
  return page.$eval('#dock-mini', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
}

/** Berapa persen cincin sudah terisi (0–100). */
function filledPct() {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.viewdock-arm .arm-fill'));
    return 100 - (parseFloat(cs.strokeDashoffset) / parseFloat(cs.strokeDasharray)) * 100;
  });
}

const shrink = () => page.evaluate(() => document.getElementById('btn-dock-mini').click());
const dockCls = (name) => page.evaluate((n) => document.getElementById('viewdock').classList.contains(n), name);

before(async () => {
  assert.ok(existsSync('dist/minutes.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/dist/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1400,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.removeItem('ltsMinutesLayout');
    localStorage.removeItem('minutesRegister');
    localStorage.removeItem('learningProgress');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  // Dok hidup di dalam #workspace, yang tersembunyi selama register kosong.
  await page.waitForSelector('#btn-library');
  await page.evaluate(() => document.getElementById('btn-library').click());
  await wait(300);
  await page.evaluate(() => document.querySelector('[data-domain="hse"]').click());
  await wait(200);
  await page.evaluate(() => document.querySelector('[data-series="LIB-HSE2"]').click());
  await wait(300);
  await page.evaluate(() => document.getElementById('lib-import').click());
  await wait(3500);
  await page.evaluate(() => document.getElementById('lt-close').click());
  await wait(300);
  const width = await page.$eval('#viewdock', (el) => el.getBoundingClientRect().width);
  assert.ok(width > 100, `dok tidak terlihat (lebar ${width}) — sisa tes tak berarti`);
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('menutup dok dianimasikan: menu keluar dulu, lalu outline menelusuri ikon', async () => {
  await shrink();
  await wait(90);
  const mid = await page.evaluate(() => ({
    collapsing: document.getElementById('viewdock').classList.contains('dock-collapsing'),
    fullStillShown: !document.getElementById('dock-full').hidden,
    anim: getComputedStyle(document.querySelector('#viewdock .viewdock-inner')).animationName,
    clip: getComputedStyle(document.querySelector('#viewdock .viewdock-inner')).clipPath,
  }));
  assert.equal(mid.collapsing, true);
  assert.equal(mid.fullStillShown, true, 'menu tidak boleh hilang sebelum animasinya selesai');
  // Sapuan menutup berjalan kanan → kiri: sisi kanan yang terpotong lebih dulu.
  assert.match(mid.clip, /^inset\(0px [\d.]+px 0px 0px\)$|^inset\(0px [\d.]+% 0px 0px\)$/, `arah sapuan salah: ${mid.clip}`);
  assert.ok(parseFloat(mid.clip.replace('inset(0px ', '')) > 0, 'sapuan belum memotong dari kanan');
  assert.equal(mid.anim, 'dock-wipe-out');

  await wait(400);
  assert.equal(await dockCls('mini'), true);
  assert.equal(await dockCls('dock-traced'), true, 'outline penanda tidak berjalan');
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector('.viewdock-arm .arm-fill')).animationName),
    'dock-arm-trace',
  );
  // Cermin membalik arah tempuh; determinan matriks transform jadi negatif.
  const det = await page.evaluate(() => {
    const m = getComputedStyle(document.querySelector('.viewdock-arm')).transform.match(/-?[\d.]+/g).map(Number);
    return m[0] * m[3] - m[1] * m[2];
  });
  assert.ok(det < 0, `jejak outline tidak dicerminkan (determinan ${det}) — arahnya masih kiri → kanan`);
  await wait(650);
  assert.equal(await dockCls('dock-traced'), false, 'jejak outline harus berhenti sendiri');
});

test('hover mengisi cincin sampai penuh selama 1,5 detik lalu dok membuka', async () => {
  const c = await miniCenter();
  await page.mouse.move(c.x - 60, c.y - 60);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await wait(200);
  assert.equal(await dockCls('hover-arming'), true, 'hover tidak memulai hitungan');
  const early = await filledPct();
  assert.ok(early > 2 && early < 35, `cincin harus baru mulai terisi, dapat ${early.toFixed(0)}%`);

  await wait(700);
  const mid = await filledPct();
  assert.ok(mid > early + 20, `cincin tidak maju: ${early.toFixed(0)}% → ${mid.toFixed(0)}%`);
  assert.equal(await dockCls('mini'), true, 'dok membuka terlalu cepat');

  await wait(800);
  assert.equal(await dockCls('mini'), false, 'dok tidak membuka setelah cincin penuh');
  assert.equal(await dockCls('hover-arming'), false);
});

test('kursor pergi sebelum cincin penuh membatalkan pembukaan', async () => {
  await shrink();
  await wait(450);
  const c = await miniCenter();
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await wait(500);
  assert.equal(await dockCls('hover-arming'), true);
  await page.mouse.move(c.x - 250, c.y - 250, { steps: 3 });
  await wait(1400);
  assert.equal(await dockCls('hover-arming'), false);
  assert.equal(await dockCls('mini'), true, 'dok membuka padahal kursor sudah pergi');
});

test('lama tunggu diatur di panel Pengaturan dan bertahan setelah muat ulang', async () => {
  await page.evaluate(() => document.getElementById('btn-settings').click());
  await wait(250);
  const seg = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('[data-armms]')];
    return {
      labels: bs.map((x) => x.textContent.trim()),
      pressed: bs.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.armms),
    };
  });
  assert.deepEqual(seg.labels, ['Off', '1s', '1.5s', '2s', '3s']);
  assert.deepEqual(seg.pressed, ['1500'], 'bawaan harus 1,5 detik');

  await page.evaluate(() => document.querySelector('[data-armms="3000"]').click());
  await wait(150);
  const changed = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('[data-armms]')].filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.armms),
    cssVar: document.getElementById('viewdock').style.getPropertyValue('--dock-arm-ms'),
    saved: JSON.parse(localStorage.getItem('ltsMinutesLayout') || '{}').dockArmMs,
  }));
  assert.deepEqual(changed.pressed, ['3000']);
  assert.equal(changed.cssVar, '3000ms', 'animasi cincin tidak ikut berubah');
  assert.equal(changed.saved, 3000);

  await page.reload({ waitUntil: 'networkidle0' });
  await wait(400);
  assert.equal(
    await page.evaluate(() => document.getElementById('viewdock').style.getPropertyValue('--dock-arm-ms')),
    '3000ms',
    'pilihan tidak bertahan setelah muat ulang',
  );
});

test('"Off" mematikan hover tetapi klik tetap membuka dok', async () => {
  await page.evaluate(() => document.getElementById('btn-settings').click());
  await wait(250);
  await page.evaluate(() => document.querySelector('[data-armms="0"]').click());
  await wait(150);
  await page.evaluate(() => { document.body.click(); });
  await shrink();
  await wait(500);
  const c = await miniCenter();
  await page.mouse.move(c.x - 100, c.y - 100);
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await wait(1500);
  assert.equal(await dockCls('hover-arming'), false, 'hover masih aktif padahal dimatikan');
  assert.equal(await dockCls('mini'), true);

  await page.evaluate(() => document.getElementById('dock-mini').click());
  await wait(400);
  assert.equal(await dockCls('mini'), false, 'klik harus tetap membuka dok');
});

test('gaya dan kecepatan animasi bisa dipilih di Pengaturan', async () => {
  for (const [style, speedAttr, expectOut, expectMs] of [
    ['slide', '1', 'dock-slide-out', '0.2s'],
    ['fade', '0.6', 'dock-fade-out', '0.12s'],
    ['scale', '1.6', 'dock-scale-out', '0.32s'],
    ['wipe', '1', 'dock-wipe-out', '0.2s'],
  ]) {
    await page.evaluate(() => document.getElementById('btn-settings').click());
    await wait(200);
    await page.evaluate((st, sp) => {
      document.querySelector(`[data-anim="${st}"]`).click();
      document.querySelector(`[data-animspeed="${sp}"]`).click();
    }, style, speedAttr);
    await wait(150);
    const pressed = await page.evaluate(() => ({
      anim: [...document.querySelectorAll('[data-anim]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.anim),
      speed: [...document.querySelectorAll('[data-animspeed]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.animspeed),
    }));
    assert.deepEqual(pressed.anim, [style]);
    assert.deepEqual(pressed.speed, [speedAttr]);
    await page.evaluate(() => { document.body.click(); });

    if (await dockCls('mini')) {
      await page.evaluate(() => document.getElementById('dock-mini').click());
      await wait(600);
    }
    await shrink();
    await wait(70);
    const out = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#viewdock .viewdock-inner'));
      return { anim: cs.animationName, dur: cs.animationDuration };
    });
    assert.equal(out.anim, expectOut, `gaya "${style}" tidak dipakai saat menutup`);
    assert.equal(out.dur, expectMs, `kecepatan x${speedAttr} tidak mengubah durasi`);
    await wait(700);
    assert.equal(await dockCls('mini'), true, `dok tidak mengecil dengan gaya "${style}"`);

    await page.evaluate(() => document.getElementById('dock-mini').click());
    await wait(70);
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector('#viewdock .viewdock-inner')).animationName),
      expectOut.replace('-out', '-in'),
      `gaya "${style}" tidak dipakai saat membuka`,
    );
    await wait(700);
    assert.equal(await dockCls('mini'), false, `dok tidak membuka lagi dengan gaya "${style}"`);
  }
});

test('panel Pengaturan tetap muat di layar pendek dan isi terbawahnya bisa diraih', async () => {
  // Panel ini tumbuh tiap kali ada pilihan baru; tanpa batas tinggi, baris
  // terakhir jatuh di luar jendela dan tidak bisa diklik sama sekali.
  for (const height of [950, 800, 700, 650]) {
    await page.setViewport({ width: 1400, height });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-settings');
    await page.evaluate(() => document.getElementById('btn-settings').click());
    await wait(350);
    const r = await page.evaluate(async () => {
      const el = document.getElementById('settings-pop');
      const box = el.getBoundingClientRect();
      const muat = box.bottom <= window.innerHeight && box.top >= 0;
      el.scrollTop = el.scrollHeight;
      await new Promise((res) => requestAnimationFrame(res));
      const btn = document.getElementById('btn-layout-reset');
      const rb = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2);
      return { muat, terjangkau: !!hit && (hit === btn || btn.contains(hit)) };
    });
    assert.equal(r.muat, true, `panel Pengaturan meluber keluar layar pada tinggi ${height}`);
    assert.equal(r.terjangkau, true, `tombol Reset layout tidak bisa diklik pada tinggi ${height}`);
    await page.evaluate(() => { document.body.click(); });
  }
  await page.setViewport({ width: 1400, height: 900 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-settings');
});

test('halaman tidak meluber mendatar di jendela sempit; appbar dan dok tetap terjangkau', async () => {
  // Appbar butuh ~1070 px penuh. Sebelum dilipat, di bawah lebar itu halaman
  // menggulir mendatar dan popover yang ditambatkan `right: 0` — termasuk
  // panel Pengaturan — berakhir di luar jendela.
  for (const width of [1400, 1100, 1000, 900, 800, 700, 640]) {
    await page.setViewport({ width, height: 700 });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#btn-settings');
    await wait(500);
    const r = await page.evaluate(() => {
      const gear = document.getElementById('btn-settings').getBoundingClientRect();
      const dock = document.getElementById('viewdock').getBoundingClientRect();
      const grip = document.querySelector('#viewdock .dgrip').getBoundingClientRect();
      return {
        meluber: document.documentElement.scrollWidth > window.innerWidth,
        gearDalam: gear.right <= window.innerWidth + 1 && gear.left >= -1,
        dokDalam: dock.left >= -1 && dock.right <= window.innerWidth + 1,
        gripDalam: grip.left >= -1,
      };
    });
    assert.equal(r.meluber, false, `halaman menggulir mendatar pada lebar ${width}`);
    assert.equal(r.gearDalam, true, `tombol Pengaturan di luar layar pada lebar ${width}`);
    assert.equal(r.dokDalam, true, `dok tampilan di luar layar pada lebar ${width}`);
    assert.equal(r.gripDalam, true, `grip dok terpotong pada lebar ${width}`);
  }

  // Label yang dilipat harus tetap punya tooltip, dan tombolnya tetap berfungsi.
  const collapsed = await page.evaluate(() => {
    const el = document.getElementById('btn-export');
    return { labelTersembunyi: getComputedStyle(el.querySelector('span')).display === 'none', title: el.title };
  });
  assert.equal(collapsed.labelTersembunyi, true, 'label tombol tidak dilipat di layar sempit');
  assert.ok(collapsed.title, 'tombol yang labelnya dilipat harus punya tooltip');
  await page.evaluate(() => document.getElementById('btn-export').click());
  await wait(250);
  assert.equal(await page.evaluate(() => !document.getElementById('export-menu').hidden), true,
    'tombol yang dilipat berhenti berfungsi');
  await page.evaluate(() => { document.body.click(); });

  // Deretan tab dok menyusut dengan menggulir, bukan dengan terpotong.
  const tab = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
    const last = tabs[tabs.length - 1];
    last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await new Promise((res) => requestAnimationFrame(res));
    const b = last.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { terjangkau: !!hit && (hit === last || last.contains(hit)) };
  });
  assert.equal(tab.terjangkau, true, 'tab terakhir di dok tidak bisa diraih di layar sempit');

  await page.setViewport({ width: 1400, height: 900 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-settings');
});

test('appbar memakai wordmark yraverageSubMin dan "Minutes" membawa kembali ke halaman utama', async () => {
  const brand = await page.evaluate(() => {
    const el = document.querySelector('.brand');
    return { teks: el.textContent.replace(/\s+/g, ''), adaPil: !!el.querySelector('.brand-pill'),
      adaIkonLama: !!el.querySelector('svg') };
  });
  assert.equal(brand.teks, 'yraverageSubMin');
  assert.equal(brand.adaPil, true, 'pil SubMin tidak terbentuk');
  assert.equal(brand.adaIkonLama, false, 'ikon generik lama masih ada di sebelah wordmark');

  // Jejak remah ditulis ulang tiap render; tautan pulang tidak boleh ikut hilang.
  const crumb = await page.evaluate(() => {
    const home = document.getElementById('crumb-home');
    return { ada: !!home, teks: home?.textContent.trim(), href: home?.getAttribute('href'),
      title: home?.title, adaJejak: (document.getElementById('crumb-trail')?.textContent || '').length > 0 };
  });
  assert.equal(crumb.ada, true, 'tautan Minutes hilang setelah rapat aktif dirender');
  assert.equal(crumb.teks, 'Minutes');
  assert.equal(crumb.href, '/app.html');
  assert.ok(crumb.title, 'tautan pulang harus punya tooltip');
  assert.equal(crumb.adaJejak, true, 'jejak remah rapat tidak ikut tampil');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.click('#crumb-home'),
  ]);
  assert.equal(await page.evaluate(() => location.pathname), '/app.html', 'klik Minutes tidak membuka halaman utama');

  await page.goto(`${ORIGIN}/dist/minutes.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-settings');
  await wait(500);
});

test('tidak ada galat runtime di halaman selama seluruh alur', () => {
  assert.deepEqual(pageErrors, [], `galat halaman: ${pageErrors.join(' | ')}`);
});
