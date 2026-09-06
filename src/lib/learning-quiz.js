/**
 * Pembangkit kuis deterministik dari objek Meeting (notes-schema.js):
 * siapa pemilik aksi, tipe item, tenggat aksi, jumlah aksi terbuka, dan
 * butir agenda dari sebuah ref. Pengacak diseed sehingga urutan pertanyaan
 * dan pilihan stabil untuk seed yang sama. Modul murni tanpa DOM.
 */

const QUIZ_KINDS = Object.freeze(['who-owns', 'what-type', 'due-when', 'how-many', 'which-agenda']);
export { QUIZ_KINDS };

const TYPE_LABEL = {
  decision: { en: 'Decision', id: 'Keputusan' },
  action: { en: 'Action', id: 'Aksi' },
  info: { en: 'Info', id: 'Info' },
  question: { en: 'Question', id: 'Pertanyaan' },
  risk: { en: 'Risk', id: 'Risiko' },
  metric: { en: 'Metric', id: 'Metrik' },
};
const TYPES = Object.keys(TYPE_LABEL);

// ---------------------------------------------------------------- seeded rng

function hashSeed(seed) {
  const s = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 */
function rng(seed) {
  let a = hashSeed(seed) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const uniq = (arr) => [...new Set(arr.filter((v) => v !== null && v !== undefined && v !== ''))];
const itemText = (it) => (it?.text && (it.text.en || it.text.id || Object.values(it.text)[0])) || it?.ref || '';

function shiftDay(iso, days) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Builds a 4-choice question; returns null when fewer than 3 distinct distractors exist. */
function makeQuestion(kind, ref, prompt, answer, distractors, rand, choiceCount = 4) {
  const pool = uniq(distractors).filter((d) => d !== answer);
  if (pool.length < choiceCount - 1) return null;
  const chosen = shuffle(pool, rand).slice(0, choiceCount - 1);
  const choices = shuffle([answer, ...chosen], rand);
  return { id: `${kind}:${ref}`, kind, ref, prompt, choices, answerIndex: choices.indexOf(answer) };
}

// ---------------------------------------------------------------- generators

function genWhoOwns(m, items, rand) {
  const owners = uniq([...items.map((i) => i.owner), ...(m.participants || []).map((p) => p?.name)]);
  return items.filter((i) => i.type === 'action' && i.owner).map((it) => () => makeQuestion(
    'who-owns', it.ref,
    { en: `Who owns action ${it.ref}: "${itemText(it)}"?`, id: `Siapa pemilik aksi ${it.ref}: "${itemText(it)}"?` },
    it.owner, owners, rand,
  ));
}

function genWhatType(m, items, rand) {
  const present = uniq(items.map((i) => i.type));
  return items.filter((i) => TYPES.includes(i.type)).map((it) => () => {
    const others = [...present.filter((t) => t !== it.type), ...TYPES.filter((t) => t !== it.type)];
    const q = makeQuestion('what-type', it.ref,
      { en: `What type of item is ${it.ref}: "${itemText(it)}"?`, id: `Apa tipe item ${it.ref}: "${itemText(it)}"?` },
      it.type, uniq(others), rand);
    if (!q) return null;
    q.choiceLabels = q.choices.map((t) => TYPE_LABEL[t]);
    return q;
  });
}

function genDueWhen(m, items, rand) {
  const dues = uniq(items.map((i) => i.due));
  return items.filter((i) => i.type === 'action' && i.due).map((it) => () => {
    const extra = [7, -7, 14, 3, -3, 21].map((d) => shiftDay(it.due, d));
    return makeQuestion('due-when', it.ref,
      { en: `When is action ${it.ref} due: "${itemText(it)}"?`, id: `Kapan tenggat aksi ${it.ref}: "${itemText(it)}"?` },
      it.due, [...dues, ...extra], rand);
  });
}

function genHowMany(m, items, rand) {
  const actions = items.filter((i) => i.type === 'action');
  if (!actions.length) return [];
  const n = actions.filter((i) => i.status !== 'closed').length;
  return [() => {
    const cands = uniq([n + 1, n + 2, n - 1, n + 3, n - 2, n + 4].filter((v) => v >= 0)).map(String);
    const q = makeQuestion('how-many', m.id || 'meeting',
      { en: 'How many actions are still open in this meeting?', id: 'Berapa aksi yang masih terbuka di rapat ini?' },
      String(n), cands, rand);
    if (q) q.choices = q.choices.map(Number);
    return q;
  }];
}

function genWhichAgenda(m, items, rand) {
  const agenda = (m.agenda || []).filter((a) => a && a.ref);
  const label = (a) => `${a.ref} — ${(a.title && (a.title.en || a.title.id || Object.values(a.title)[0])) || ''}`.trim();
  const byRef = new Map(agenda.map((a) => [a.ref, label(a)]));
  return items.filter((i) => i.agenda && byRef.has(i.agenda)).map((it) => () => makeQuestion(
    'which-agenda', it.ref,
    { en: `Which agenda item does ${it.ref} belong to: "${itemText(it)}"?`, id: `Butir agenda mana yang memuat ${it.ref}: "${itemText(it)}"?` },
    byRef.get(it.agenda), [...byRef.values()], rand,
  ));
}

// ---------------------------------------------------------------- public API

/**
 * @param {import('./notes-schema.js').Meeting} meeting
 * @param {{count?:number, seed?:string|number, kinds?:string[]}} [opts]
 */
export function buildQuiz(meeting, { count = 5, seed = meeting?.id || 'quiz', kinds = QUIZ_KINDS } = {}) {
  if (!meeting || typeof meeting !== 'object') return [];
  const items = Array.isArray(meeting.items) ? meeting.items.filter((i) => i && i.ref) : [];
  if (!items.length || count <= 0) return [];
  const rand = rng(seed);
  const gens = {
    'who-owns': genWhoOwns, 'what-type': genWhatType, 'due-when': genDueWhen,
    'how-many': genHowMany, 'which-agenda': genWhichAgenda,
  };
  // one shuffled queue of thunks per kind, then round-robin so kinds mix
  const queues = kinds.filter((k) => gens[k]).map((k) => shuffle(gens[k](meeting, items, rand), rand));
  const out = [];
  const seen = new Set();
  let progressed = true;
  while (out.length < count && progressed) {
    progressed = false;
    for (const q of queues) {
      while (q.length && out.length < count) {
        const made = q.shift()();
        progressed = true;
        if (made && made.answerIndex >= 0 && !seen.has(made.id)) { seen.add(made.id); out.push(made); break; }
      }
    }
  }
  return out;
}

export function gradeAnswer(question, choiceIndex) {
  return Boolean(question) && Number.isInteger(choiceIndex) && choiceIndex === question.answerIndex;
}
