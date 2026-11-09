/**
 * Library + Training untuk Minutes Register.
 *
 * Dua panel overlay yang TIDAK bergantung pada paint() register — paint()
 * berhenti dini saat belum ada rapat, sedangkan pustaka justru paling berguna
 * di keadaan kosong itu. Panel ini dipasang sekali dari minutes.js lewat
 * mountExtras(ctx) dan menggambar dirinya sendiri.
 *
 *  - Library : 200+ transkrip contoh (src/lib/sample-library.js), dinavigasi
 *              bidang → seri → minggu, diimpor per seri lewat pipeline notulen
 *              yang sama dengan rekaman sungguhan.
 *  - Training: XP/level/achievement/streak (learning-progress.js), tur
 *              Watch/Practise (learning-tours.js), kuis dari rapat aktif
 *              (learning-quiz.js). Meniru "Learning progress" DCS_DocConSystem,
 *              disesuaikan untuk satu pengguna lokal.
 *
 * Teks antarmuka lewat tabel {en,id} lokal (tx) supaya notes-i18n.js tidak
 * membengkak dengan string yang hanya dipakai di sini.
 */
import { buildLibraryIndex, buildTranscript, importSeries, importTranscript } from './lib/sample-library.js';
import {
  createLearningStore,
  awardEvent,
  recordTourStep,
  completeTour,
  recordQuizAnswer,
  touchStreak,
  summary as learnSummary,
  tourRows,
} from './lib/learning-progress.js';
import { TOURS, tourById, tourProgressPercent } from './lib/learning-tours.js';
import { buildQuiz, gradeAnswer } from './lib/learning-quiz.js';

const STR = {
  learn: { en: 'Learn', id: 'Belajar' },
  learnTitle: { en: 'Library and Training', id: 'Pustaka dan Latihan' },
  library: { en: 'Library', id: 'Pustaka' },
  training: { en: 'Training', id: 'Latihan' },
  close: { en: 'Close', id: 'Tutup' },
  libTitle: { en: 'Sample library', id: 'Pustaka contoh' },
  libSub: { en: (n, s) => `${n} transcripts across many fields — ${s} series continue week by week. Import a series to study how open items carry forward.`, id: (n, s) => `${n} transkrip dari berbagai bidang — ${s} seri berlanjut minggu demi minggu. Impor satu seri untuk melihat bagaimana butir terbuka dibawa ke minggu berikutnya.` },
  domains: { en: 'Fields', id: 'Bidang' },
  series: { en: 'Series', id: 'Seri' },
  standalone: { en: 'Single meetings', id: 'Rapat tunggal' },
  weeks: { en: 'weeks', id: 'minggu' },
  importSeries: { en: 'Import whole series', id: 'Impor seluruh seri' },
  importWeek: { en: 'Import this week only', id: 'Impor minggu ini saja' },
  imported: { en: (n) => `${n} meeting(s) imported into the register`, id: (n) => `${n} rapat diimpor ke register` },
  alreadyIn: { en: 'Already in register', id: 'Sudah ada di register' },
  prev: { en: '← Prev week', id: '← Minggu sebelumnya' },
  next: { en: 'Next week →', id: 'Minggu berikutnya →' },
  pickSeries: { en: 'Pick a field, then a series.', id: 'Pilih bidang, lalu satu seri.' },
  lines: { en: (n) => `${n} lines`, id: (n) => `${n} baris` },
  progress: { en: 'Progress', id: 'Kemajuan' },
  tours: { en: 'Tours', id: 'Tur' },
  quiz: { en: 'Quiz', id: 'Kuis' },
  achievements: { en: 'Achievements', id: 'Pencapaian' },
  level: { en: 'Level', id: 'Level' },
  xpToNext: { en: (a, b) => `${a} / ${b} XP to next level`, id: (a, b) => `${a} / ${b} XP ke level berikutnya` },
  maxLevel: { en: 'Max level', id: 'Level maksimum' },
  understanding: { en: 'Understanding', id: 'Pemahaman' },
  streak: { en: 'Streak', id: 'Rentetan' },
  days: { en: (n) => `${n} day(s)`, id: (n) => `${n} hari` },
  best: { en: 'best', id: 'terbaik' },
  watch: { en: 'Watch', id: 'Tonton' },
  practise: { en: 'Practise', id: 'Praktik' },
  steps: { en: (n) => `${n} steps`, id: (n) => `${n} langkah` },
  stepOf: { en: (a, b) => `Step ${a} of ${b}`, id: (a, b) => `Langkah ${a} dari ${b}` },
  nextStep: { en: 'Next', id: 'Lanjut' },
  finish: { en: 'Finish', id: 'Selesai' },
  skip: { en: 'Skip step', id: 'Lewati langkah' },
  stop: { en: 'Stop tour', id: 'Hentikan tur' },
  clickTarget: { en: 'Click the highlighted control to continue.', id: 'Klik kontrol yang disorot untuk melanjutkan.' },
  targetMissing: { en: 'This control lives in the side panel. Open it there, or skip.', id: 'Kontrol ini ada di side panel. Buka di sana, atau lewati.' },
  tourDone: { en: (xp) => `Tour complete — +${xp} XP`, id: (xp) => `Tur selesai — +${xp} XP` },
  quizIntro: { en: 'Questions are built from the meeting open in the register.', id: 'Pertanyaan dibangun dari rapat yang terbuka di register.' },
  quizNoMeeting: { en: 'Open or import a meeting first — the quiz reads its items.', id: 'Buka atau impor rapat dulu — kuis membaca butir-butirnya.' },
  newQuiz: { en: 'New questions', id: 'Pertanyaan baru' },
  correct: { en: 'Correct', id: 'Benar' },
  wrong: { en: 'Not quite', id: 'Belum tepat' },
  score: { en: (a, b) => `${a} / ${b} correct so far`, id: (a, b) => `${a} / ${b} benar sejauh ini` },
  locked: { en: 'Locked', id: 'Terkunci' },
  unlocked: { en: 'Unlocked', id: 'Terbuka' },
  toursTaken: { en: 'Tours taken', id: 'Tur diambil' },
  itemsAccepted: { en: 'Items accepted', id: 'Butir diterima' },
  momIssued: { en: 'MoM issued', id: 'MoM diterbitkan' },
  quizzes: { en: 'Quiz answers', id: 'Jawaban kuis' },
};

const pick = (v, lang) => (v && typeof v === 'object' ? v[lang] ?? v.en ?? '' : v ?? '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Backend penyimpanan dengan pola yang sama seperti notes-store: chrome.storage.local → localStorage. */
export function learningBackend() {
  if (globalThis.chrome?.storage?.local) {
    return {
      async get(key) { const o = await chrome.storage.local.get(key); return o?.[key]; },
      async set(key, value) { await chrome.storage.local.set({ [key]: value }); },
    };
  }
  return {
    async get(key) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : undefined; } catch { return undefined; } },
    async set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* kuota */ } },
  };
}

/**
 * @param {object} ctx
 * @param {() => string} ctx.lang            'en' | 'id' (dibaca ulang tiap gambar)
 * @param {() => any[]} ctx.meetings
 * @param {() => any} ctx.activeMeeting
 * @param {() => Promise<void>} ctx.reload    muat ulang daftar rapat register
 * @param {(id:string)=>void} ctx.setActive
 * @param {() => void} ctx.paint
 * @param {(msg:string, bad?:boolean)=>void} ctx.toast
 */
export function mountExtras(ctx) {
  const tx = (k, ...a) => { const v = pick(STR[k], ctx.lang()); return typeof v === 'function' ? v(...a) : v; };
  const rawStore = createLearningStore(learningBackend());
  // update() = load → mutasi → save. Dua panggilan dalam tick yang sama (mis.
  // tour-start + langkah pertama) saling menimpa; antrean ini menyerialkannya.
  let updQueue = Promise.resolve();
  const store = {
    load: () => rawStore.load(),
    update(fn) {
      const run = updQueue.then(() => rawStore.update(fn));
      updQueue = run.catch(() => {});
      return run;
    },
  };
  const index = buildLibraryIndex();
  const seriesCount = index.domains.reduce((n, d) => n + d.series.length, 0);

  /* ---------------- kerangka DOM ---------------- */
  const appbar = document.querySelector('.appbar');
  const btns = document.createElement('div');
  btns.className = 'lt-appbar-btns';
  btns.innerHTML = `
      <div class="menuwrap">
        <button type="button" class="btn sm collapsible" id="btn-learn" aria-haspopup="menu" aria-expanded="false" aria-controls="learn-menu" title="${esc(tx('learnTitle'))}" aria-label="${esc(tx('learnTitle'))}">🎓 <span>${esc(tx('learn'))} ▾</span></button>
        <div class="export-menu" id="learn-menu" role="menu" hidden>
          <button type="button" role="menuitem" id="btn-library" data-tour="view-library" aria-label="${esc(tx('library'))}">📚 ${esc(tx('library'))}</button>
          <button type="button" role="menuitem" id="btn-training" aria-label="${esc(tx('training'))}">🎓 ${esc(tx('training'))} <span class="lt-lvl" id="learn-pill"></span></button>
        </div>
      </div>`;
  // Sebelum pengalih rapat: tetap terlihat di keadaan kosong.
  (appbar?.querySelector('#m-switch') || appbar?.lastElementChild)?.insertAdjacentElement('beforebegin', btns);

  const overlay = document.createElement('div');
  overlay.className = 'lt-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<div class="lt-panel" role="dialog" aria-modal="true">
      <div class="lt-head"><h2 id="lt-title"></h2><div class="lt-tabs" id="lt-tabs"></div><span class="spacer"></span><button type="button" class="btn sm" id="lt-close">✕ ${esc(tx('close'))}</button></div>
      <div class="lt-body" id="lt-body"></div>
    </div>`;
  (document.querySelector('.app') || document.body).appendChild(overlay);

  const spot = document.createElement('div');
  spot.className = 'lt-spot';
  spot.hidden = true;
  document.body.appendChild(spot);

  const ui = { view: null, tab: 'progress', domain: index.domains[0]?.id || null, seriesId: null, weekIdx: 0, quiz: null, quizAnswers: {}, tour: null, learn: null };

  const refreshPill = async () => {
    ui.learn = await store.load();
    const s = learnSummary(ui.learn);
    const pill = document.getElementById('learn-pill');
    if (pill) pill.textContent = `Lv ${s.level} · ${s.xp} XP`;
  };

  /** Jalankan satu mutasi pembelajaran + rentetan harian, simpan, segarkan pil, umumkan achievement baru. */
  const applyLearning = async (fn) => {
    const now = new Date();
    const { result } = await store.update((st) => {
      touchStreak(st, now);
      awardEvent(st, `daily-streak:${now.toISOString().slice(0, 10)}`, 'daily-streak', { now });
      return fn(st, now);
    });
    await refreshPill();
    if (result?.newly?.length) {
      const s = learnSummary(ui.learn);
      ctx.toast(`🏅 ${result.newly.map((id) => pick(s.achievements.find((a) => a.id === id)?.title, ctx.lang())).join(', ')}`);
    }
    return result;
  };
  const award = (kind, key) => applyLearning((st, now) => awardEvent(st, key, kind, { now }));
  // Register memanggil ini saat menerima butir / menerbitkan MoM.
  globalThis.__learn = { award };

  const open = (view) => { ui.view = view; overlay.hidden = false; draw(); };
  const close = () => { overlay.hidden = true; ui.view = null; stopTour(); };
  const learnBtn = btns.querySelector('#btn-learn');
  const learnMenu = btns.querySelector('#learn-menu');
  const setLearnMenu = (on) => { learnMenu.hidden = !on; learnBtn.setAttribute('aria-expanded', String(on)); };
  learnBtn.addEventListener('click', () => setLearnMenu(learnMenu.hidden));
  document.addEventListener('click', (e) => { if (!btns.contains(e.target)) setLearnMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !learnMenu.hidden) { setLearnMenu(false); learnBtn.focus(); } });
  btns.querySelector('#btn-library').addEventListener('click', () => { setLearnMenu(false); open('library'); });
  btns.querySelector('#btn-training').addEventListener('click', () => { setLearnMenu(false); open('training'); });
  overlay.querySelector('#lt-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden && !ui.tour) close(); });

  /* ---------------- Library ---------------- */
  const inRegister = new Set();
  const refreshInRegister = () => { inRegister.clear(); for (const m of ctx.meetings()) inRegister.add(m.id); };

  function currentSeries() {
    const d = index.domains.find((x) => x.id === ui.domain);
    return d?.series.find((s) => s.seriesId === ui.seriesId) || null;
  }

  function drawLibrary(body) {
    const lang = ctx.lang();
    const d = index.domains.find((x) => x.id === ui.domain) || index.domains[0];
    const s = currentSeries();
    const wi = s ? Math.min(ui.weekIdx, s.weeks.length - 1) : 0;
    const week = s?.weeks[wi] || null;
    const t = week ? buildTranscript(week.id) : null;
    const allIn = s ? s.weeks.every((w) => inRegister.has(w.id)) : false;
    body.innerHTML = `
      <p class="lt-sub">${esc(tx('libSub', index.total, seriesCount))}</p>
      <div class="lt-cols">
        <div class="lt-col">
          <h3>${esc(tx('domains'))}</h3>
          <div class="lt-list" data-tour="lib-domain">${index.domains.map((x) => `<button type="button" class="lt-row${x.id === d.id ? ' on' : ''}" data-domain="${esc(x.id)}"><span>${esc(pick(x.label, lang))}</span><b>${x.count}</b></button>`).join('')}</div>
        </div>
        <div class="lt-col">
          <h3>${esc(tx('series'))}</h3>
          <div class="lt-list" data-tour="lib-series">${d.series.map((x) => `<button type="button" class="lt-row${x.seriesId === ui.seriesId ? ' on' : ''}" data-series="${esc(x.seriesId)}"><span>${esc(x.title)}</span><b>${x.weeks.length} ${esc(tx('weeks'))}</b></button>`).join('')}</div>
          ${d.standalone?.length ? `<h3>${esc(tx('standalone'))}</h3><div class="lt-list">${d.standalone.map((x) => `<button type="button" class="lt-row" data-single="${esc(x.id)}"${inRegister.has(x.id) ? ' disabled' : ''}><span>${esc(x.title)}</span><b class="mono">${esc(x.date)}</b></button>`).join('')}</div>` : ''}
        </div>
        <div class="lt-col lt-detail">
          ${!s ? `<p class="lt-empty">${esc(tx('pickSeries'))}</p>` : `
            <h3>${esc(s.title)} <span class="pill">${esc(s.projectType)}</span></h3>
            <div class="lt-weeks">${s.weeks.map((w, i) => `<button type="button" class="lt-week${i === wi ? ' on' : ''}${inRegister.has(w.id) ? ' in' : ''}" data-week="${i}" title="${esc(w.date)}">W${String(w.seq).padStart(2, '0')}</button>`).join('')}</div>
            <div class="lt-weeknav">
              <button type="button" class="btn sm" id="lib-week-prev"${wi <= 0 ? ' disabled' : ''}>${esc(tx('prev'))}</button>
              <span class="mono">${esc(week.date)} · ${esc(tx('lines', t.lines.length))}</span>
              <button type="button" class="btn sm" id="lib-week-next" data-tour="lib-week-next"${wi >= s.weeks.length - 1 ? ' disabled' : ''}>${esc(tx('next'))}</button>
            </div>
            <h4>${esc(week.title)}</h4>
            <div class="lt-preview">${t.lines.slice(0, 14).map((l) => `<div class="lt-line"><span class="mono">${esc(tc(l.t0))}</span><b>${esc(l.speaker || '')}</b><span>${esc(l.source ?? l.text ?? l.translation ?? '')}</span></div>`).join('')}${t.lines.length > 14 ? `<div class="lt-more">… +${t.lines.length - 14}</div>` : ''}</div>
            <div class="lt-actions">
              <button type="button" class="btn primary" id="lib-import" data-tour="lib-import"${allIn ? ' disabled' : ''}>${esc(allIn ? tx('alreadyIn') : tx('importSeries'))}</button>
              <button type="button" class="btn" id="lib-import-week"${inRegister.has(week.id) ? ' disabled' : ''}>${esc(tx('importWeek'))}</button>
            </div>`}
        </div>
      </div>`;

    body.querySelectorAll('[data-domain]').forEach((b) => b.addEventListener('click', () => { ui.domain = b.dataset.domain; ui.seriesId = null; ui.weekIdx = 0; draw(); }));
    body.querySelectorAll('[data-series]').forEach((b) => b.addEventListener('click', () => { ui.seriesId = b.dataset.series; ui.weekIdx = 0; draw(); }));
    body.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => { ui.weekIdx = Number(b.dataset.week); draw(); }));
    body.querySelector('#lib-week-prev')?.addEventListener('click', () => { ui.weekIdx = Math.max(0, wi - 1); draw(); });
    body.querySelector('#lib-week-next')?.addEventListener('click', () => { ui.weekIdx = Math.min((s?.weeks.length || 1) - 1, wi + 1); draw(); });
    body.querySelector('#lib-import')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const ms = await importSeries(s.seriesId);
      await afterImport(ms, `series-imported:${s.seriesId}`);
    });
    body.querySelector('#lib-import-week')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const m = await importTranscript(week.id);
      await afterImport([m], `series-imported:${week.id}`);
    });
    body.querySelectorAll('[data-single]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const m = await importTranscript(b.dataset.single);
      await afterImport([m], `series-imported:${b.dataset.single}`);
    }));
  }

  async function afterImport(meetings, key) {
    await ctx.reload();
    refreshInRegister();
    const first = meetings[0];
    if (first) ctx.setActive(first.id);
    ctx.paint();
    ctx.toast(tx('imported', meetings.length));
    await award('series-imported', key);
    draw();
  }

  /* ---------------- Training ---------------- */
  function drawTraining(body) {
    const lang = ctx.lang();
    const s = learnSummary(ui.learn);
    const tabs = ['progress', 'tours', 'quiz', 'achievements'];
    overlay.querySelector('#lt-tabs').innerHTML = tabs.map((t) => `<button type="button" role="tab" aria-selected="${ui.tab === t}" data-lt-tab="${t}">${esc(tx(t))}</button>`).join('');
    overlay.querySelectorAll('[data-lt-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.ltTab; draw(); }));

    if (ui.tab === 'progress') {
      const c = s.counters || {};
      body.innerHTML = `
        <div class="lt-grid">
          <div class="card"><h3>${esc(tx('level'))} ${s.level} · ${esc(pick(s.title, lang))}</h3><div class="sub">${s.xp} XP</div>
            <div class="lt-bar" title="${s.xpPercent}%"><i style="width:${s.xpPercent}%"></i></div>
            <div class="sub">${s.xpForNext > 0 ? esc(tx('xpToNext', s.xpIntoLevel, s.xpForNext)) : esc(tx('maxLevel'))}</div></div>
          <div class="card"><h3>${esc(tx('understanding'))}</h3><div class="lt-big">${s.understanding.score}%</div><div class="sub">${esc(pick(s.understanding.label, lang))}</div></div>
          <div class="card"><h3>${esc(tx('streak'))}</h3><div class="lt-big">🔥 ${s.streak.current}</div><div class="sub">${esc(tx('days', s.streak.current))} · ${esc(tx('best'))} ${s.streak.best}</div></div>
          <div class="card"><h3>${esc(tx('achievements'))}</h3><div class="lt-big">${s.achievementsUnlocked} / ${s.achievements.length}</div></div>
        </div>
        <div class="lt-grid lt-grid-4">
          <div class="stat"><span class="n">${c['tour-watch'] ?? 0}+${c['tour-try'] ?? 0}</span><span class="l">${esc(tx('toursTaken'))}</span></div>
          <div class="stat"><span class="n">${c['item-accepted'] ?? 0}</span><span class="l">${esc(tx('itemsAccepted'))}</span></div>
          <div class="stat"><span class="n">${c['mom-issued'] ?? 0}</span><span class="l">${esc(tx('momIssued'))}</span></div>
          <div class="stat"><span class="n">${s.quiz?.correct ?? 0}/${s.quiz?.asked ?? 0}</span><span class="l">${esc(tx('quizzes'))}</span></div>
        </div>`;
      return;
    }

    if (ui.tab === 'tours') {
      const rows = tourRows(ui.learn);
      body.innerHTML = `<div class="lt-tours">${TOURS.map((t) => {
        const r = rows.find((x) => x.tourId === t.id || x.id === t.id) || {};
        const pw = r.watch ? tourProgressPercent(r.watch.maxStep ?? -1, t.steps.length, !!r.watch.completed) : 0;
        const pt = r.try ? tourProgressPercent(r.try.maxStep ?? -1, t.steps.length, !!r.try.completed) : 0;
        return `<div class="card"><h3>${esc(pick(t.title, lang))}</h3><div class="sub">${esc(tx('steps', t.steps.length))} · ${esc(pick(t.steps[0]?.body, lang)).slice(0, 110)}…</div>
          <div class="lt-tour-row"><span>${esc(tx('watch'))} · ${pw}%</span><div class="lt-bar"><i style="width:${pw}%"></i></div><button type="button" class="btn sm" data-tour-start="${t.id}" data-mode="watch">▶ ${esc(tx('watch'))}</button></div>
          <div class="lt-tour-row"><span>${esc(tx('practise'))} · ${pt}%</span><div class="lt-bar"><i style="width:${pt}%"></i></div><button type="button" class="btn sm primary" data-tour-start="${t.id}" data-mode="try">✋ ${esc(tx('practise'))}</button></div></div>`;
      }).join('')}</div>`;
      body.querySelectorAll('[data-tour-start]').forEach((b) => b.addEventListener('click', () => startTour(b.dataset.tourStart, b.dataset.mode)));
      return;
    }

    if (ui.tab === 'quiz') {
      const m = ctx.activeMeeting();
      if (!m || !m.items?.length) { body.innerHTML = `<p class="lt-empty">${esc(tx('quizNoMeeting'))}</p>`; return; }
      if (!ui.quiz || ui.quiz.meetingId !== m.id) {
        const seed = `${m.id}:${Date.now()}`;
        ui.quiz = { meetingId: m.id, seed, qs: buildQuiz(m, { count: 5, seed }) };
        ui.quizAnswers = {};
      }
      const qs = ui.quiz.qs;
      const answered = Object.keys(ui.quizAnswers).length;
      const correct = qs.filter((q) => ui.quizAnswers[q.id] != null && gradeAnswer(q, ui.quizAnswers[q.id])).length;
      body.innerHTML = `<p class="lt-sub">${esc(tx('quizIntro'))} · <b>${esc(m.title)}</b> · ${esc(tx('score', correct, answered))}</p>
        ${qs.map((q, i) => `<div class="card lt-q" data-q="${esc(q.id)}"><h3>${i + 1}. ${esc(pick(q.prompt, lang))}</h3>
          <div class="lt-choices">${q.choices.map((c, ci) => { const a = ui.quizAnswers[q.id]; const cls = a == null ? '' : ci === q.answerIndex ? ' ok' : ci === a ? ' bad' : ''; return `<button type="button" class="btn${cls}" data-choice="${ci}"${a != null ? ' disabled' : ''}>${esc(c)}</button>`; }).join('')}</div>
          ${ui.quizAnswers[q.id] != null ? `<div class="sub">${gradeAnswer(q, ui.quizAnswers[q.id]) ? '✅ ' + esc(tx('correct')) : '❌ ' + esc(tx('wrong'))}</div>` : ''}</div>`).join('')}
        <button type="button" class="btn" id="lt-new-quiz">🔄 ${esc(tx('newQuiz'))}</button>`;
      body.querySelectorAll('.lt-q').forEach((card) => card.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', async () => {
        const q = qs.find((x) => x.id === card.dataset.q);
        const ci = Number(b.dataset.choice);
        ui.quizAnswers[q.id] = ci;
        const ok = gradeAnswer(q, ci);
        // recordQuizAnswer menghitung asked/correct DAN memberi XP-nya sendiri.
        await applyLearning((st, now) => recordQuizAnswer(st, `${ui.quiz.seed}:${q.id}`, ok, { now }));
        draw();
      })));
      body.querySelector('#lt-new-quiz')?.addEventListener('click', () => { ui.quiz = null; draw(); });
      return;
    }

    body.innerHTML = `<div class="lt-grid lt-grid-3">${s.achievements.map((a) => `<div class="card${a.unlockedAt ? ' lt-unlocked' : ' lt-locked'}"><h3>${a.unlockedAt ? '🏅' : '🔒'} ${esc(pick(a.title, lang))}</h3><div class="sub">${esc(pick(a.description, lang))}</div><div class="sub mono">${a.unlockedAt ? `${esc(tx('unlocked'))} · ${esc(String(a.unlockedAt).slice(0, 10))}` : esc(tx('locked'))}</div></div>`).join('')}</div>`;
  }

  /* ---------------- Tour runner (spotlight) ---------------- */
  let tourTimer = null;
  let tourClickHandler = null;

  function startTour(tourId, mode) {
    const tour = tourById(tourId);
    if (!tour) return;
    ui.tour = { tour, mode, step: 0 };
    overlay.hidden = true; // halaman harus terlihat di bawah sorotan
    store.update((st) => awardEvent(st, `tour-start:${tourId}`, 'tour-start', { now: new Date() })).then(refreshPill);
    showStep();
  }

  function stopTour() {
    clearTimeout(tourTimer);
    tourTimer = null;
    if (tourClickHandler) { document.removeEventListener('click', tourClickHandler, true); tourClickHandler = null; }
    spot.hidden = true;
    document.querySelectorAll('.lt-target').forEach((el) => el.classList.remove('lt-target'));
    ui.tour = null;
  }

  function showStep() {
    const t = ui.tour;
    if (!t) return;
    const lang = ctx.lang();
    const step = t.tour.steps[t.step];
    const target = document.querySelector(`[data-tour="${step.target}"]`);
    document.querySelectorAll('.lt-target').forEach((el) => el.classList.remove('lt-target'));
    if (target) { target.classList.add('lt-target'); target.scrollIntoView?.({ block: 'center', inline: 'nearest' }); }
    const r = target?.getBoundingClientRect();
    spot.hidden = false;
    spot.style.setProperty('--sx', `${r ? r.left + r.width / 2 : window.innerWidth / 2}px`);
    spot.style.setProperty('--sy', `${r ? r.top + r.height / 2 : window.innerHeight / 2}px`);
    spot.style.setProperty('--sr', `${r ? Math.max(r.width, r.height) / 2 + 14 : 0}px`);
    const last = t.step === t.tour.steps.length - 1;
    const needClick = t.mode === 'try' && step.requireClick !== false && !!target;
    spot.innerHTML = `<div class="lt-card" style="top:${r ? Math.min(window.innerHeight - 230, r.bottom + 12) : 80}px;left:${r ? Math.max(12, Math.min(window.innerWidth - 372, r.left)) : 40}px">
        <div class="sub">${esc(pick(t.tour.title, lang))} · ${esc(tx('stepOf', t.step + 1, t.tour.steps.length))}</div>
        <h3>${esc(pick(step.title, lang))}</h3><p>${esc(pick(step.body, lang))}</p>
        <p class="sub">${!target ? esc(tx('targetMissing')) : needClick ? esc(tx('clickTarget')) : ''}</p>
        <div class="lt-actions"><button type="button" class="btn sm" id="lt-stop">${esc(tx('stop'))}</button><span class="spacer"></span>
          ${needClick ? `<button type="button" class="btn sm" id="lt-skip">${esc(tx('skip'))}</button>` : `<button type="button" class="btn sm primary" id="lt-next">${esc(last ? tx('finish') : tx('nextStep'))}</button>`}</div></div>`;
    spot.querySelector('#lt-stop').addEventListener('click', () => { stopTour(); overlay.hidden = false; draw(); });
    spot.querySelector('#lt-next')?.addEventListener('click', advance);
    spot.querySelector('#lt-skip')?.addEventListener('click', advance);

    store.update((st) => recordTourStep(st, t.tour.id, t.mode, t.step, t.tour.steps.length, { now: new Date() }));

    clearTimeout(tourTimer);
    if (tourClickHandler) { document.removeEventListener('click', tourClickHandler, true); tourClickHandler = null; }
    if (t.mode === 'watch' && !needClick) tourTimer = setTimeout(advance, step.waitMs || 4000);
    if (needClick) {
      tourClickHandler = (e) => { if (target.contains(e.target)) setTimeout(advance, 250); };
      document.addEventListener('click', tourClickHandler, true);
    }
  }

  async function advance() {
    const t = ui.tour;
    if (!t) return;
    if (t.step >= t.tour.steps.length - 1) {
      const kind = t.mode === 'try' ? 'tour-try' : 'tour-watch';
      const { result } = await store.update((st) => { completeTour(st, t.tour.id, t.mode, { now: new Date() }); return awardEvent(st, `${kind}:${t.tour.id}`, kind, { now: new Date() }); });
      stopTour();
      await refreshPill();
      ctx.toast(tx('tourDone', result?.xp ?? 0));
      ui.view = 'training'; ui.tab = 'tours'; overlay.hidden = false; draw();
      return;
    }
    t.step += 1;
    showStep();
  }

  /* ---------------- gambar ---------------- */
  async function draw() {
    if (overlay.hidden) return;
    ui.learn = await store.load();
    refreshInRegister();
    overlay.querySelector('#lt-title').textContent = ui.view === 'library' ? tx('libTitle') : tx('training');
    overlay.querySelector('#lt-tabs').innerHTML = '';
    const body = overlay.querySelector('#lt-body');
    if (ui.view === 'library') drawLibrary(body); else drawTraining(body);
  }

  refreshPill();
  return { open, close, award, draw };
}

function tc(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
