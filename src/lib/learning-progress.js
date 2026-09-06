/**
 * Lapisan pelatihan + gamifikasi untuk Minutes/Notes: XP, level, pencapaian,
 * skor pemahaman, log kejadian idempoten, streak harian, dan persistensi
 * lewat backend yang disuntikkan. Modul murni (tanpa DOM), meniru mekanika
 * "Learning progress" DCS_DocConSystem (learning.py / learningProgress.ts)
 * untuk satu pengguna lokal.
 *
 * Pure training/gamification layer. All mutators edit `state` in place and
 * return `{ xp, newly, duplicate? }` so a UI can toast what just happened.
 */

export const STORE_KEY = 'learningProgress';
export const STATE_VERSION = 1;

// DCS values (learning.py) + product-specific additions.
export const XP_BY_KIND = Object.freeze({
  'tour-start': 10,
  'tour-watch': 50,
  'tour-try': 100,
  'help-view': 8,
  'quiz-correct': 15,
  'quiz-wrong': 0,
  'item-accepted': 5,
  'mom-issued': 40,
  'flag-moment': 3,
  'series-imported': 20,
  'daily-streak': 10,
});
export const EVENT_KINDS = Object.freeze(Object.keys(XP_BY_KIND));

/** Our three training tours (DCS: weekly, dc, inspector). */
export const TRAINING_TOURS = Object.freeze(['record', 'register', 'library']);
export const TOUR_MODES = Object.freeze(['watch', 'try']);

/** Copied verbatim from DCS learning.py LEVELS (min_xp, level, title). */
export const LEVELS = Object.freeze([
  { minXp: 0, level: 1, title: { en: 'Newcomer', id: 'Pendatang baru' } },
  { minXp: 100, level: 2, title: { en: 'Trainee', id: 'Peserta latih' } },
  { minXp: 250, level: 3, title: { en: 'Operator', id: 'Operator' } },
  { minXp: 450, level: 4, title: { en: 'Controller', id: 'Pengendali' } },
  { minXp: 700, level: 5, title: { en: 'Specialist', id: 'Spesialis' } },
  { minXp: 1000, level: 6, title: { en: 'Expert', id: 'Ahli' } },
  { minXp: 1400, level: 7, title: { en: 'Master', id: 'Master' } },
]);

export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-steps', tier: 'bronze',
    title: { en: 'First steps', id: 'Langkah pertama' },
    description: { en: 'Start any guided tour.', id: 'Mulai tur terpandu apa pun.' } },
  { id: 'spectator', tier: 'bronze',
    title: { en: 'Spectator', id: 'Penonton' },
    description: { en: 'Finish a tour in Watch mode.', id: 'Selesaikan satu tur dalam mode Tonton.' } },
  { id: 'hands-on', tier: 'bronze',
    title: { en: 'Hands-on', id: 'Turun tangan' },
    description: { en: 'Finish a tour in Practise mode.', id: 'Selesaikan satu tur dalam mode Latihan.' } },
  { id: 'tour-record', tier: 'silver',
    title: { en: 'Recorder', id: 'Perekam' },
    description: { en: 'Complete the Record tour (Watch or Practise).', id: 'Selesaikan tur Rekam (Tonton atau Latihan).' } },
  { id: 'tour-register', tier: 'silver',
    title: { en: 'Register keeper', id: 'Penjaga register' },
    description: { en: 'Complete the Register tour (Watch or Practise).', id: 'Selesaikan tur Register (Tonton atau Latihan).' } },
  { id: 'tour-library', tier: 'silver',
    title: { en: 'Sample walker', id: 'Penjelajah pustaka' },
    description: { en: 'Complete the Library tour.', id: 'Selesaikan tur Pustaka.' } },
  { id: 'training-watch', tier: 'gold',
    title: { en: 'Training circuit', id: 'Sirkuit pelatihan' },
    description: { en: 'Complete all three training tours in any mode.', id: 'Selesaikan ketiga tur pelatihan dalam mode apa pun.' } },
  { id: 'training-try', tier: 'gold',
    title: { en: 'Certified practiser', id: 'Praktisi tersertifikasi' },
    description: { en: 'Complete all three training tours in Practise.', id: 'Selesaikan ketiga tur pelatihan dalam mode Latihan.' } },
  { id: 'both-modes', tier: 'gold',
    title: { en: 'Watch then try', id: 'Tonton lalu coba' },
    description: { en: 'Finish the same tour in Watch and Practise.', id: 'Selesaikan tur yang sama dalam Tonton dan Latihan.' } },
  { id: 'module-five', tier: 'silver',
    title: { en: 'Floor walker', id: 'Penjelajah lantai' },
    description: { en: 'Complete five distinct screen tours.', id: 'Selesaikan lima tur layar yang berbeda.' } },
  { id: 'help-5', tier: 'bronze',
    title: { en: 'Bookworm', id: 'Kutu buku' },
    description: { en: 'Open five Help topics.', id: 'Buka lima topik Bantuan.' } },
  { id: 'help-15', tier: 'silver',
    title: { en: 'Scholar', id: 'Cendekia' },
    description: { en: 'Open fifteen Help topics.', id: 'Buka lima belas topik Bantuan.' } },
  { id: 'help-40', tier: 'gold',
    title: { en: 'Librarian', id: 'Pustakawan' },
    description: { en: 'Open forty Help topics.', id: 'Buka empat puluh topik Bantuan.' } },
  { id: 'xp-500', tier: 'silver',
    title: { en: 'Dedicated', id: 'Berdedikasi' },
    description: { en: 'Reach 500 experience.', id: 'Capai 500 poin pengalaman.' } },
  { id: 'xp-1000', tier: 'gold',
    title: { en: 'Veteran', id: 'Veteran' },
    description: { en: 'Reach 1,000 experience.', id: 'Capai 1.000 poin pengalaman.' } },
  { id: 'understanding-60', tier: 'gold',
    title: { en: 'Gets it', id: 'Sudah paham' },
    description: { en: 'Reach 60% understanding.', id: 'Capai pemahaman 60%.' } },
  { id: 'understanding-90', tier: 'platinum',
    title: { en: 'Hall ready', id: 'Siap tampil' },
    description: { en: 'Reach 90% understanding.', id: 'Capai pemahaman 90%.' } },
  // Product-specific additions.
  { id: 'first-minutes', tier: 'bronze',
    title: { en: 'First minutes', id: 'Notulen pertama' },
    description: { en: 'Issue your first Minutes of Meeting.', id: 'Terbitkan notulen rapat pertamamu.' } },
  { id: 'reviewer', tier: 'silver',
    title: { en: 'Reviewer', id: 'Penelaah' },
    description: { en: 'Accept 25 AI-drafted items.', id: 'Terima 25 item hasil draf AI.' } },
  { id: 'quiz-10', tier: 'silver',
    title: { en: 'Quiz whiz', id: 'Jago kuis' },
    description: { en: 'Answer 10 quiz questions correctly.', id: 'Jawab 10 pertanyaan kuis dengan benar.' } },
  { id: 'streak-7', tier: 'gold',
    title: { en: 'Seven days', id: 'Tujuh hari' },
    description: { en: 'Keep a 7-day activity streak.', id: 'Pertahankan aktivitas 7 hari berturut-turut.' } },
]);

// ---------------------------------------------------------------- helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const nat = (v) => Math.max(0, int(v, 0));
const toIso = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();

/** Calendar day (UTC) as YYYY-MM-DD. */
export function dayKey(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dayDiff(fromDay, toDay) {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------- state

function emptyModeEntry() {
  return { started: false, maxStep: 0, stepCount: 0, completed: false, completedAt: null };
}

function normalizeModeEntry(raw) {
  const e = emptyModeEntry();
  if (!isObj(raw)) return e;
  e.completed = Boolean(raw.completed);
  e.started = Boolean(raw.started) || e.completed;
  e.maxStep = nat(raw.maxStep);
  e.stepCount = nat(raw.stepCount);
  e.completedAt = typeof raw.completedAt === 'string' ? raw.completedAt : null;
  if (e.completed && e.stepCount > 0) e.maxStep = Math.max(e.maxStep, e.stepCount - 1);
  return e;
}

export function createState() {
  return {
    version: STATE_VERSION,
    xp: 0,
    events: {},
    tours: {},
    help: {},
    achievements: {},
    quiz: { asked: 0, correct: 0 },
    streak: { current: 0, best: 0, lastDay: null },
  };
}

/** Tolerates missing fields and garbage; never throws. */
export function normalizeState(raw) {
  const s = createState();
  if (!isObj(raw)) return s;
  s.xp = nat(raw.xp);
  if (isObj(raw.events)) {
    for (const [key, ev] of Object.entries(raw.events)) {
      if (!key || !isObj(ev)) continue;
      s.events[key] = {
        at: typeof ev.at === 'string' ? ev.at : null,
        kind: typeof ev.kind === 'string' ? ev.kind : 'unknown',
        xp: nat(ev.xp),
      };
    }
  }
  if (isObj(raw.tours)) {
    for (const [tourId, modes] of Object.entries(raw.tours)) {
      if (!tourId || !isObj(modes)) continue;
      s.tours[tourId] = { watch: normalizeModeEntry(modes.watch), try: normalizeModeEntry(modes.try) };
    }
  }
  if (isObj(raw.help)) {
    for (const [topic, at] of Object.entries(raw.help)) {
      if (topic) s.help[topic] = typeof at === 'string' ? at : null;
    }
  }
  if (isObj(raw.achievements)) {
    for (const [id, at] of Object.entries(raw.achievements)) {
      if (id && (typeof at === 'string' || at === true)) s.achievements[id] = typeof at === 'string' ? at : null;
    }
  }
  if (isObj(raw.quiz)) {
    s.quiz.asked = nat(raw.quiz.asked);
    s.quiz.correct = Math.min(nat(raw.quiz.correct), s.quiz.asked);
  }
  if (isObj(raw.streak)) {
    s.streak.current = nat(raw.streak.current);
    s.streak.best = Math.max(nat(raw.streak.best), s.streak.current);
    s.streak.lastDay = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.streak.lastDay)) ? raw.streak.lastDay : null;
  }
  return s;
}

// ---------------------------------------------------------------- levels

/** Port of learning.py level_from_xp. */
export function levelFromXp(xp) {
  const x = nat(xp);
  let current = LEVELS[0];
  let next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (x >= LEVELS[i].minXp) {
      current = LEVELS[i];
      next = i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
    } else break;
  }
  if (next) {
    return {
      level: current.level, title: current.title,
      xpIntoLevel: x - current.minXp, xpForNext: next.minXp - current.minXp, nextLevelXp: next.minXp,
    };
  }
  return { level: current.level, title: current.title, xpIntoLevel: x - current.minXp, xpForNext: 0, nextLevelXp: current.minXp };
}

/** Same semantics as learningProgress.ts xpBarPercent. */
export function xpBarPercent(xpInto, xpForNext) {
  if (xpForNext <= 0) return 100;
  if (xpInto <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((xpInto / xpForNext) * 100)));
}

// ---------------------------------------------------------------- understanding

export function understandingLabel(score) {
  if (score >= 80) return { en: 'Expert', id: 'Ahli' };
  if (score >= 60) return { en: 'Proficient', id: 'Cakap' };
  if (score >= 40) return { en: 'Competent', id: 'Kompeten' };
  if (score >= 20) return { en: 'Familiar', id: 'Akrab' };
  return { en: 'Getting started', id: 'Baru mulai' };
}

const modeDone = (tours, tourId, mode) => Boolean(tours?.[tourId]?.[mode]?.completed);
const anyModeDone = (tours, tourId) => modeDone(tours, tourId, 'watch') || modeDone(tours, tourId, 'try');

/** Port of learning.py understanding_from_state. */
export function understandingFromState(tours, help) {
  const t = isObj(tours) ? tours : {};
  const ids = Object.keys(t);
  const watchN = ids.filter((id) => modeDone(t, id, 'watch')).length;
  const tryN = ids.filter((id) => modeDone(t, id, 'try')).length;
  const helpN = isObj(help) ? Object.keys(help).length : 0;
  const trainingTry = TRAINING_TOURS.filter((id) => modeDone(t, id, 'try')).length;
  const raw = tryN * 8 + watchN * 3 + Math.min(helpN, 40) * 0.8 + trainingTry * 8;
  const score = Math.min(100, Math.round(raw));
  return { score, label: understandingLabel(score), watchTours: watchN, tryTours: tryN, helpTopics: helpN, trainingTry };
}

// ---------------------------------------------------------------- events

export function countEvents(state, kind) {
  return Object.values(state?.events || {}).filter((e) => e && e.kind === kind).length;
}

/**
 * Awards XP for `key` once. A second call with the same key is a no-op.
 * @returns {{xp:number, duplicate:boolean, newly:string[]}}
 */
export function awardEvent(state, key, kind, { now } = {}) {
  if (!key || typeof key !== 'string') throw new Error('awardEvent: key wajib string');
  if (!Object.hasOwn(XP_BY_KIND, kind)) throw new Error(`awardEvent: kind tidak dikenal: ${String(kind)}`);
  if (state.events[key]) return { xp: 0, duplicate: true, newly: [] };
  const xp = XP_BY_KIND[kind];
  state.events[key] = { at: toIso(now), kind, xp };
  state.xp += xp;
  return { xp, duplicate: false, newly: evaluateAchievements(state, { now }) };
}

function tourEntry(state, tourId, mode) {
  if (!TOUR_MODES.includes(mode)) throw new Error(`mode harus watch|try, dapat ${String(mode)}`);
  if (!tourId || typeof tourId !== 'string') throw new Error('tourId wajib');
  if (!state.tours[tourId]) state.tours[tourId] = { watch: emptyModeEntry(), try: emptyModeEntry() };
  return state.tours[tourId][mode];
}

/** tour.progress in DCS: marks started (awards tour-start once) and lifts maxStep. */
export function recordTourStep(state, tourId, mode, stepIndex, stepCount, { now } = {}) {
  const e = tourEntry(state, tourId, mode);
  e.started = true;
  if (Number.isFinite(stepCount) && stepCount > 0) e.stepCount = Math.max(e.stepCount, int(stepCount));
  if (Number.isFinite(stepIndex) && stepIndex >= 0) e.maxStep = Math.max(e.maxStep, int(stepIndex));
  const r = awardEvent(state, `tour-start:${tourId}:${mode}`, 'tour-start', { now });
  return { xp: r.xp, newly: r.newly };
}

/** tour.complete in DCS: start XP if missing, then watch (50) or try (100) once. */
export function completeTour(state, tourId, mode, { stepCount, now } = {}) {
  const e = tourEntry(state, tourId, mode);
  let xp = 0;
  const newly = [];
  const start = awardEvent(state, `tour-start:${tourId}:${mode}`, 'tour-start', { now });
  xp += start.xp; newly.push(...start.newly);
  e.started = true;
  if (Number.isFinite(stepCount) && stepCount > 0) e.stepCount = Math.max(e.stepCount, int(stepCount));
  e.completed = true;
  e.completedAt = e.completedAt || toIso(now);
  if (e.stepCount > 0) e.maxStep = Math.max(e.maxStep, e.stepCount - 1);
  const kind = mode === 'try' ? 'tour-try' : 'tour-watch';
  const done = awardEvent(state, `${kind}:${tourId}`, kind, { now });
  xp += done.xp; newly.push(...done.newly);
  // completion itself can unlock tour achievements even when XP was already granted
  newly.push(...evaluateAchievements(state, { now }));
  return { xp, newly: [...new Set(newly)] };
}

export function recordHelpView(state, topicId, { now } = {}) {
  if (!topicId || typeof topicId !== 'string') throw new Error('topicId wajib');
  if (!state.help[topicId]) state.help[topicId] = toIso(now);
  const r = awardEvent(state, `help-view:${topicId}`, 'help-view', { now });
  return { xp: r.xp, newly: [...new Set([...r.newly, ...evaluateAchievements(state, { now })])] };
}

/** XP is granted once per question id; counters move on every answer. */
export function recordQuizAnswer(state, questionId, correct, { now } = {}) {
  if (!questionId || typeof questionId !== 'string') throw new Error('questionId wajib');
  state.quiz.asked += 1;
  if (correct) state.quiz.correct += 1;
  const r = awardEvent(state, `${correct ? 'quiz-correct' : 'quiz-wrong'}:${questionId}`,
    correct ? 'quiz-correct' : 'quiz-wrong', { now });
  return { xp: r.xp, newly: [...new Set([...r.newly, ...evaluateAchievements(state, { now })])] };
}

/**
 * Registers activity on the calendar day of `now`: extends the streak when the
 * previous activity was yesterday, keeps it on the same day, resets otherwise.
 * Awards `daily-streak:<day>` once per day.
 */
export function touchStreak(state, now) {
  const today = dayKey(now);
  if (!today) return { xp: 0, newly: [], day: null };
  const st = state.streak;
  if (st.lastDay !== today) {
    const diff = st.lastDay ? dayDiff(st.lastDay, today) : null;
    if (diff === 1) st.current += 1;
    else if (diff !== null && diff <= 0) { /* clock went backwards: keep streak */ }
    else st.current = 1;
    if (diff === null || diff >= 1) st.lastDay = today;
    st.best = Math.max(st.best, st.current);
  }
  const r = awardEvent(state, `daily-streak:${today}`, 'daily-streak', { now });
  return { xp: r.xp, newly: [...new Set([...r.newly, ...evaluateAchievements(state, { now })])], day: today };
}

// ---------------------------------------------------------------- achievements

/** Port of learning.py evaluate_achievements (+ product additions). Idempotent. */
export function evaluateAchievements(state, { now } = {}) {
  const tours = state.tours || {};
  const ids = Object.keys(tours);
  const und = understandingFromState(tours, state.help);
  const startedAny = ids.some((id) => TOUR_MODES.some((m) => tours[id][m]?.started || tours[id][m]?.completed));
  const watchAny = ids.some((id) => modeDone(tours, id, 'watch'));
  const tryAny = ids.some((id) => modeDone(tours, id, 'try'));
  const both = ids.some((id) => modeDone(tours, id, 'watch') && modeDone(tours, id, 'try'));
  const distinct = ids.filter((id) => anyModeDone(tours, id)).length;
  const trainingAny = TRAINING_TOURS.every((id) => anyModeDone(tours, id));
  const trainingTry = TRAINING_TOURS.every((id) => modeDone(tours, id, 'try'));
  const helpN = Object.keys(state.help || {}).length;
  const xp = nat(state.xp);

  const checks = [
    ['first-steps', startedAny],
    ['spectator', watchAny],
    ['hands-on', tryAny],
    ['tour-record', anyModeDone(tours, 'record')],
    ['tour-register', anyModeDone(tours, 'register')],
    ['tour-library', anyModeDone(tours, 'library')],
    ['training-watch', trainingAny],
    ['training-try', trainingTry],
    ['both-modes', both],
    ['module-five', distinct >= 5],
    ['help-5', helpN >= 5],
    ['help-15', helpN >= 15],
    ['help-40', helpN >= 40],
    ['xp-500', xp >= 500],
    ['xp-1000', xp >= 1000],
    ['understanding-60', und.score >= 60],
    ['understanding-90', und.score >= 90],
    ['first-minutes', countEvents(state, 'mom-issued') >= 1],
    ['reviewer', countEvents(state, 'item-accepted') >= 25],
    ['quiz-10', nat(state.quiz?.correct) >= 10],
    ['streak-7', Math.max(nat(state.streak?.current), nat(state.streak?.best)) >= 7],
  ];
  const newly = [];
  const at = toIso(now);
  for (const [id, ok] of checks) {
    if (!ok || Object.hasOwn(state.achievements, id)) continue;
    state.achievements[id] = at;
    newly.push(id);
  }
  return newly;
}

// ---------------------------------------------------------------- summary

export function tourRows(state) {
  const out = [];
  for (const tourId of Object.keys(state.tours || {}).sort()) {
    for (const mode of TOUR_MODES) {
      const e = state.tours[tourId][mode];
      if (!e || (!e.started && !e.completed)) continue;
      const percent = e.completed ? 100
        : e.stepCount <= 0 ? 0 : Math.max(0, Math.min(99, Math.round(((e.maxStep + 1) / e.stepCount) * 100)));
      out.push({ id: tourId, mode, started: e.started || e.completed, completed: e.completed,
        maxStep: e.maxStep, stepCount: e.stepCount, percent, completedAt: e.completedAt });
    }
  }
  return out;
}

/** Personal history: recent events newest first (replaces the DCS hall of fame). */
export function eventHistory(state, { limit = 50 } = {}) {
  return Object.entries(state.events || {})
    .map(([key, e]) => ({ key, kind: e.kind, xp: e.xp, at: e.at }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);
}

export function summary(state) {
  const lvl = levelFromXp(state.xp);
  const und = understandingFromState(state.tours, state.help);
  return {
    level: lvl.level,
    title: lvl.title,
    xp: nat(state.xp),
    xpIntoLevel: lvl.xpIntoLevel,
    xpForNext: lvl.xpForNext,
    nextLevelXp: lvl.nextLevelXp,
    xpPercent: xpBarPercent(lvl.xpIntoLevel, lvl.xpForNext),
    understanding: { score: und.score, label: und.label },
    achievements: ACHIEVEMENTS.map((a) => ({
      id: a.id, tier: a.tier, title: a.title, description: a.description,
      unlockedAt: Object.hasOwn(state.achievements, a.id) ? state.achievements[a.id] : null,
    })),
    achievementsUnlocked: Object.keys(state.achievements).length,
    tours: tourRows(state),
    quiz: { ...state.quiz },
    streak: { ...state.streak },
    counters: {
      momIssued: countEvents(state, 'mom-issued'),
      itemsAccepted: countEvents(state, 'item-accepted'),
      flags: countEvents(state, 'flag-moment'),
      seriesImported: countEvents(state, 'series-imported'),
      helpTopics: Object.keys(state.help).length,
    },
  };
}

// ---------------------------------------------------------------- persistence

/** In-memory backend with the same async {get,set} contract as chrome.storage.local wrappers. */
export function memoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : undefined; },
    async set(key, value) { data.set(key, structuredClone(value)); },
    _dump() { return Object.fromEntries(data); },
  };
}

/**
 * @param {{get(key:string):Promise<any>, set(key:string, value:any):Promise<void>}} backend
 */
export function createLearningStore(backend, { key = STORE_KEY } = {}) {
  if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') {
    throw new Error('createLearningStore: backend butuh get/set');
  }
  return {
    key,
    async load() { return normalizeState(await backend.get(key)); },
    async save(state) { const s = normalizeState(state); await backend.set(key, s); return s; },
    /** Loads, applies `fn(state)` (may return a result), saves, returns `{state, result}`. */
    async update(fn) {
      const state = normalizeState(await backend.get(key));
      const result = await fn(state);
      await backend.set(key, state);
      return { state, result };
    },
    async reset() { const s = createState(); await backend.set(key, s); return s; },
  };
}
