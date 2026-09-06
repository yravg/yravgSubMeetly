/**
 * Library + Training di Minutes Register (src/minutes-extras.js), dijalankan
 * pada halaman sungguhan lewat Puppeteer.
 *   node --test test/register-extras.test.mjs
 *
 * Yang dijaga:
 *  - Pustaka bisa dibuka dari keadaan KOSONG (paint() register berhenti dini
 *    saat belum ada rapat — panel ini sengaja tidak bergantung padanya).
 *  - Navigasi bidang → seri → minggu, lalu impor seri menghasilkan N rapat
 *    dengan projectType seri itu dan register langsung menampilkannya.
 *  - Kuis dibangun dari rapat aktif; menjawab mencatat asked/correct dan XP
 *    lewat recordQuizAnswer (dulu salah tanda tangan → melempar diam-diam).
 *  - Tur Watch menyorot target data-tour dan berpindah langkah.
 *  - Semua tersimpan (learningProgress) dan bertahan setelah muat ulang.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const PORT = 8882;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server;
let browser;
let page;
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
  assert.ok(existsSync('dist/minutes.js'), 'dist/ belum dibangun — jalankan `npm run build`');
  server = spawn('python3', ['scripts/lab-server.py'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LAB_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(`${ORIGIN}/src/minutes.html`);
  browser = await puppeteer.launch({ headless: true, args: ['--window-size=1280,900'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${ORIGIN}/src/minutes.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    localStorage.removeItem('minutesRegister');
    localStorage.removeItem('learningProgress');
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-library');
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('pustaka terbuka dari keadaan kosong dan menawarkan 200+ transkrip dalam banyak bidang', async () => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    const emptyShown = !document.getElementById('empty-state').hidden;
    document.getElementById('btn-library').click();
    await w(250);
    return {
      emptyShown,
      overlayOpen: !document.querySelector('.lt-overlay').hidden,
      domains: document.querySelectorAll('[data-domain]').length,
      sub: document.querySelector('.lt-sub')?.textContent || '',
      pill: document.getElementById('learn-pill')?.textContent,
    };
  });
  assert.equal(r.emptyShown, true, 'tes ini harus mulai dari register kosong');
  assert.equal(r.overlayOpen, true);
  assert.ok(r.domains >= 12, `bidang terlalu sedikit: ${r.domains}`);
  assert.match(r.sub, /\b2\d\d\b/, 'ringkasan harus menyebut 200+ transkrip');
  assert.match(r.pill, /Lv 1 · 0 XP/);
});

test('navigasi bidang → seri → minggu, lalu impor seri mengisi register dengan tipe proyeknya', async () => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    document.querySelector('[data-domain="hse"]').click();
    await w(150);
    const series = [...document.querySelectorAll('[data-series]')].map((b) => b.dataset.series);
    document.querySelector('[data-series="LIB-HSE2"]').click();
    await w(250);
    const weeks = document.querySelectorAll('.lt-week').length;
    const preview1 = document.querySelectorAll('.lt-line').length;
    const w1 = document.querySelector('.lt-weeknav .mono')?.textContent;
    document.getElementById('lib-week-next').click();
    await w(200);
    const w2 = document.querySelector('.lt-weeknav .mono')?.textContent;
    document.getElementById('lib-import').click();
    await w(3000);
    const ms = JSON.parse(localStorage.getItem('minutesRegister') || '{}').meetings || [];
    return {
      series, weeks, preview1, w1, w2,
      imported: ms.length,
      types: [...new Set(ms.map((m) => m.projectType))],
      seqs: ms.map((m) => m.seq).sort((a, b) => a - b),
      itemsWk1: ms[0]?.items.length || 0,
      workspaceShown: !document.getElementById('workspace').hidden,
      title: document.getElementById('m-title')?.textContent || '',
      pill: document.getElementById('learn-pill')?.textContent,
      importBtn: document.getElementById('lib-import')?.textContent,
    };
  });
  assert.ok(r.series.includes('LIB-HSE2'));
  assert.equal(r.weeks, 5, 'seri LIB-HSE2 punya 5 minggu');
  assert.ok(r.preview1 > 0, 'pratinjau transkrip kosong');
  assert.notEqual(r.w1, r.w2, 'tombol minggu berikutnya tidak berpindah');
  assert.equal(r.imported, 5, 'seluruh seri harus terimpor');
  assert.deepEqual(r.types, ['hse'], 'tipe proyek seri harus ikut ke tiap rapat');
  assert.deepEqual(r.seqs, [1, 2, 3, 4, 5]);
  assert.ok(r.itemsWk1 > 0, 'pipeline notulen tidak menghasilkan butir');
  assert.equal(r.workspaceShown, true, 'register harus langsung menampilkan rapat yang diimpor');
  assert.match(r.title, /K3|HSE|Safety/i);
  // series-imported (20) + daily-streak (10)
  assert.match(r.pill, /30 XP/);
  assert.match(r.importBtn, /Already|Sudah/, 'tombol impor harus terkunci setelah seri masuk');
});

test('kuis dari rapat aktif: menjawab mencatat asked/correct dan XP, bertahan setelah muat ulang', async () => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    document.getElementById('lt-close').click();
    await w(150);
    document.getElementById('btn-training').click();
    await w(300);
    const tabs = [...document.querySelectorAll('[data-lt-tab]')].map((b) => b.dataset.ltTab);
    document.querySelector('[data-lt-tab="quiz"]').click();
    await w(300);
    const qs = [...document.querySelectorAll('.lt-q')];
    qs[0].querySelector('[data-choice="0"]').click();
    await w(600);
    const verdict = document.querySelector('.lt-q .sub')?.textContent || '';
    const disabledAfter = document.querySelectorAll('.lt-q')[0].querySelectorAll('[data-choice]:disabled').length;
    const st = JSON.parse(localStorage.getItem('learningProgress') || '{}');
    return {
      tabs, questions: qs.length, verdict, disabledAfter,
      asked: st.quiz?.asked, xp: st.xp,
      quizEvents: Object.keys(st.events || {}).filter((k) => k.startsWith('quiz-')).length,
    };
  });
  assert.deepEqual(r.tabs, ['progress', 'tours', 'quiz', 'achievements']);
  assert.equal(r.questions, 5);
  assert.match(r.verdict, /✅|❌/, 'verdict tidak tampil — jawaban tidak diproses');
  assert.equal(r.disabledAfter, 4, 'pilihan harus terkunci setelah dijawab');
  assert.equal(r.asked, 1);
  assert.equal(r.quizEvents, 1, 'satu event kuis harus tercatat (benar atau salah)');
  assert.ok(r.xp >= 30, `XP hilang: ${r.xp}`);

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#learn-pill');
  const after = await page.evaluate(() => ({
    pill: document.getElementById('learn-pill')?.textContent,
    asked: JSON.parse(localStorage.getItem('learningProgress') || '{}').quiz?.asked,
  }));
  assert.equal(after.asked, 1, 'kemajuan tidak bertahan setelah muat ulang');
  assert.match(after.pill, /\d+ XP/);
});

test('tur Watch menyorot target data-tour dan berpindah langkah; tour-start diberi XP sekali', async () => {
  const r = await page.evaluate(async () => {
    const w = (ms) => new Promise((res) => setTimeout(res, ms));
    document.getElementById('btn-training').click();
    await w(300);
    document.querySelector('[data-lt-tab="tours"]').click();
    await w(250);
    const cards = document.querySelectorAll('.lt-tours .card').length;
    document.querySelector('[data-tour-start="register"][data-mode="watch"]').click();
    await w(500);
    const spot = document.querySelector('.lt-spot');
    const step1 = spot.querySelector('h3')?.textContent;
    const target1 = document.querySelector('.lt-target')?.dataset.tour;
    document.getElementById('lt-next').click();
    await w(300);
    const step2 = spot.querySelector('h3')?.textContent;
    const target2 = document.querySelector('.lt-target')?.dataset.tour;
    document.getElementById('lt-stop').click();
    await w(300);
    const st = JSON.parse(localStorage.getItem('learningProgress') || '{}');
    return {
      cards, step1, target1, step2, target2, spotHidden: spot.hidden,
      tourStart: Object.keys(st.events || {}).filter((k) => k === 'tour-start:register').length,
      overlayBack: !document.querySelector('.lt-overlay').hidden,
    };
  });
  assert.equal(r.cards, 3, 'tiga tur: record, register, library');
  assert.equal(r.target1, 'm-switch');
  assert.equal(r.target2, 'chips');
  assert.notEqual(r.step1, r.step2);
  assert.equal(r.spotHidden, true, 'sorotan harus hilang setelah Stop');
  assert.equal(r.tourStart, 1);
  assert.equal(r.overlayBack, true, 'panel Training harus kembali setelah tur dihentikan');
});

test('tidak ada galat runtime di halaman selama seluruh alur', () => {
  assert.deepEqual(pageErrors, [], `galat halaman: ${pageErrors.join(' | ')}`);
});
