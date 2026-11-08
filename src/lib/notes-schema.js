/**
 * Skema Minutes Register v2 — yraverageSubMin.
 *
 * Ganti model v1 (summary + decisions:string[] + actions[]) dengan SATU register
 * berisi item bertipe. Setiap item menyimpan teks multi-bahasa, status telaah
 * manusia, dan penunjuk balik ke segmen transkrip (provenance).
 *
 * Minutes Register v2 schema. Replaces the v1 shape with one register of typed
 * items. Every item carries multilingual text, a human-review state, and a
 * pointer back to the transcript segment it came from.
 */

export const NOTE_SCHEMA_VERSION = 2;

/** @typedef {'decision'|'action'|'question'|'risk'|'metric'|'info'} ItemType */
/** @typedef {'open'|'progress'|'closed'|'carried'} ItemStatus */
/** @typedef {'ai'|'accepted'|'edited'} ReviewState */
/** @typedef {'high'|'med'|'low'} Priority */
/** @typedef {'certain'|'likely'|'possible'|'unlikely'} Likelihood */

export const ITEM_TYPES = /** @type {const} */ ([
  'decision', 'action', 'question', 'risk', 'metric', 'info',
]);
/**
 * Tipe proyek/rapat — dipilih saat mulai merekam, dipakai register untuk
 * memfilter dan mengelompokkan, serta oleh pustaka contoh dan modul latihan.
 * Nilai tak dikenal jatuh ke 'general' supaya data lama tetap terbaca.
 */
export const PROJECT_TYPES = /** @type {const} */ ([
  'general',
  'weekly-progress',
  'hse',
  'design-review',
  'client-review',
  'standup',
  'sprint',
  'sales',
  'finance',
  'legal',
  'training',
  'research',
  'healthcare',
  'education',
]);

export function normalizeProjectType(v) {
  const t = String(v || '').trim().toLowerCase();
  return PROJECT_TYPES.includes(t) ? t : 'general';
}

export const ITEM_STATUSES = /** @type {const} */ (['open', 'progress', 'closed', 'carried']);
export const REVIEW_STATES = /** @type {const} */ (['ai', 'accepted', 'edited']);
/** Sumbu kedua matriks risiko: severity (`priority`) × likelihood. */
export const LIKELIHOODS = /** @type {const} */ (['certain', 'likely', 'possible', 'unlikely']);

/** Warna per tipe — dipakai UI. Emerald (--accent) TIDAK dipakai sebagai warna tipe. */
export const TYPE_COLOR = {
  decision: '#7fb3d5',
  action: '#e0b05c',
  question: '#b79ce0',
  risk: '#e06c75',
  metric: '#4fb8c9',
  info: '#9a9a9a',
};

/** Ambang batas: di bawah ini item ditandai perlu diperiksa manusia. */
export const LOW_CONFIDENCE = 0.7;

/**
 * @typedef {object} Provenance
 * @property {number}  t0         detik ke dalam rekaman
 * @property {number}  t1
 * @property {string}  tc         "00:09:05" bentuk tampilan
 * @property {string|null} speaker
 * @property {string}  lang       bahasa sumber terdeteksi
 * @property {string}  orig       kata-kata persis yang diucapkan
 * @property {string}  tr         keluaran MT yang dibaca ekstraktor
 * @property {string[]} segmentIds
 * @property {string|null} meetingId  rapat ASAL (penting untuk item bawaan)
 */

/**
 * @typedef {object} MetricPayload
 * @property {string}  measure    kunci stabil, mis. "cumulative_progress"
 * @property {number}  value
 * @property {number|null} baseline
 * @property {number|null} variance
 * @property {string}  unit
 * @property {string|null} asOf   TANGGAL LAPORAN, bukan tanggal rapat
 * @property {string|null} sourceDoc
 */

/**
 * @typedef {object} Revision
 * @property {string} at
 * @property {string} by
 * @property {string} field
 * @property {*} from
 * @property {*} to
 */

/**
 * @typedef {object} MinuteItem
 * @property {string} ref              "W36-003" — nomor register yang diucapkan orang
 * @property {ItemType} type
 * @property {string} topic
 * @property {string|null} agenda
 * @property {Record<string,string>} text   { en: "...", id: "...", zh: "..." }
 * @property {string|null} owner
 * @property {string|null} org
 * @property {string|null} due        YYYY-MM-DD
 * @property {ItemStatus} status
 * @property {Priority} priority   severity — sumbu pertama matriks risiko
 * @property {Likelihood} likelihood  sumbu kedua; risiko dibaca "High × Possible"
 * @property {ReviewState} review
 * @property {number} confidence      0..1
 * @property {Provenance|null} src
 * @property {MetricPayload|null} metric
 * @property {{from:string,to:string,origPhrase:string|null}|null} correction  saran koreksi dari ekstraktor bila
 *   teks butir dan terjemahan mesin berbeda pada rentang berkeyakinan rendah
 *   (mis. "Ben and Coding" → "bending and coating"); null bila tidak ada
 * @property {string|null} carriedFrom
 * @property {string|null} openedAt   umur bertahan melewati carry-forward
 * @property {string[]} links         ref item terkait
 * @property {Revision[]} history
 */

/**
 * @typedef {object} AgendaItem
 * @property {string} ref
 * @property {Record<string,string>} title
 * @property {boolean} covered
 */

/**
 * @typedef {object} Participant
 * @property {string} name
 * @property {string|null} org
 * @property {string|null} speakerLabel
 */

/**
 * @typedef {object} EngineStamp
 * @property {string} asr
 * @property {string|null} mt
 * @property {string|null} extractor
 * @property {number} segments
 * @property {number|null} durationSec
 */

/**
 * @typedef {object} Meeting
 * @property {string} id              "MOM-CPOC7-W36"
 * @property {string} seriesId        "CPOC7-WEEKLY" — kunci carry-forward
 * @property {number} seq
 * @property {string} title
 * @property {string} date            YYYY-MM-DD (berbeda dari generatedAt)
 * @property {string|null} start
 * @property {string|null} end
 * @property {string} tz
 * @property {string|null} chair
 * @property {Participant[]} attendees
 * @property {AgendaItem[]} agenda
 * @property {Record<string,Record<string,string>>} topics
 * @property {MinuteItem[]} items
 * @property {EngineStamp|null} engine
 * @property {string} generatedAt
 * @property {string|null} issuedAt   diisi saat MoM diterbitkan — membekukan dokumen
 * @property {Record<string,string>} summary  ringkasan notulen yang ditulis manusia,
 *   per bahasa; kosong berarti dokumen memakai kalimat statistik yang dihasilkan
 * @property {string} locale          bahasa kerja rapat
 * @property {number} schemaVersion
 */

function rnd() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const str = (v) => (v == null ? '' : String(v));
const strOrNull = (v) => (v == null || v === '' ? null : String(v));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Detik → "HH:MM:SS". */
export function toTimecode(sec) {
  const s = Math.max(0, Math.floor(num(sec, 0)));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${r}`;
}

/** Normalisasi peta teks multi-bahasa. Menerima string polos (dianggap `locale`). */
export function normalizeText(value, locale = 'en') {
  if (value == null) return {};
  if (typeof value === 'string') return value.trim() ? { [locale]: value.trim() } : {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const t = str(v).trim();
    if (t) out[k] = t;
  }
  return out;
}

/** Ambil teks pada bahasa `lang`, mundur ke bahasa kerja lalu ke apa pun yang ada. */
export function pickText(text, lang, fallbackLocale = 'en') {
  if (!text) return '';
  return text[lang] || text[fallbackLocale] || text.en || Object.values(text)[0] || '';
}

/** @returns {Provenance|null} */
export function createProvenance(partial) {
  if (!partial) return null;
  const t0 = num(partial.t0, 0);
  return {
    t0,
    t1: num(partial.t1, t0),
    tc: partial.tc ? str(partial.tc) : toTimecode(t0),
    speaker: strOrNull(partial.speaker),
    lang: str(partial.lang || 'auto'),
    orig: str(partial.orig),
    tr: str(partial.tr),
    segmentIds: Array.isArray(partial.segmentIds) ? partial.segmentIds.map(String) : [],
    meetingId: strOrNull(partial.meetingId),
  };
}

/** @returns {MetricPayload|null} */
export function createMetric(partial) {
  if (!partial) return null;
  const value = num(partial.value, NaN);
  if (!Number.isFinite(value)) return null;
  const baseline = partial.baseline == null ? null : num(partial.baseline, NaN);
  const hasBaseline = baseline != null && Number.isFinite(baseline);
  return {
    measure: str(partial.measure || 'unnamed'),
    value,
    baseline: hasBaseline ? baseline : null,
    variance:
      partial.variance != null && Number.isFinite(Number(partial.variance))
        ? Number(partial.variance)
        : hasBaseline
          ? Number((value - baseline).toFixed(6))
          : null,
    unit: str(partial.unit || ''),
    asOf: strOrNull(partial.asOf),
    sourceDoc: strOrNull(partial.sourceDoc),
  };
}

/**
 * @returns {{from:string,to:string,origPhrase:string|null}|null}
 *
 * `origPhrase` adalah frasa BAHASA SUMBER yang bersangkutan (mis. 弯管和涂敷) —
 * dipakai untuk menyorotinya di baris "Sesuai ucapan". Opsional: ekstraktor
 * belum tentu bisa memetakan balik ke rentang aslinya.
 */
export function createCorrection(partial) {
  if (!partial || typeof partial !== 'object') return null;
  const from = str(partial.from).trim();
  const to = str(partial.to).trim();
  if (!from || !to || from === to) return null;
  return { from, to, origPhrase: strOrNull(partial.origPhrase) };
}

/** @returns {MinuteItem} */
export function createMinuteItem(partial = {}, { locale = 'en' } = {}) {
  const type = oneOf(partial.type, ITEM_TYPES, 'info');
  return {
    ref: str(partial.ref || `TMP-${rnd()}`),
    type,
    topic: str(partial.topic || 'general'),
    agenda: strOrNull(partial.agenda),
    text: normalizeText(partial.text, locale),
    owner: strOrNull(partial.owner),
    org: strOrNull(partial.org),
    due: strOrNull(partial.due),
    status: oneOf(partial.status, ITEM_STATUSES, type === 'info' ? 'closed' : 'open'),
    priority: oneOf(partial.priority, ['high', 'med', 'low'], 'med'),
    likelihood: oneOf(partial.likelihood, LIKELIHOODS, 'possible'),
    review: oneOf(partial.review, REVIEW_STATES, 'ai'),
    confidence: Math.min(1, Math.max(0, num(partial.confidence, 1))),
    src: createProvenance(partial.src),
    metric: type === 'metric' ? createMetric(partial.metric) : null,
    correction: createCorrection(partial.correction),
    carriedFrom: strOrNull(partial.carriedFrom),
    openedAt: strOrNull(partial.openedAt),
    links: Array.isArray(partial.links) ? partial.links.map(String) : [],
    history: Array.isArray(partial.history) ? partial.history.map(createRevision) : [],
  };
}

/** @returns {Revision} */
export function createRevision(partial = {}) {
  return {
    at: str(partial.at || new Date().toISOString()),
    by: str(partial.by || 'local'),
    field: str(partial.field || ''),
    from: partial.from ?? null,
    to: partial.to ?? null,
  };
}

/** Cap on stored transcript lines: a long session must not fill the store. */
export const TRANSCRIPT_CAP = 3000;

/**
 * One transcript line shape for a meeting: {t0,t1,speaker,source,translation}.
 * Accepts the side panel's {src,tgt} too. Lines with no source text are dropped.
 */
export function normalizeTranscript(lines) {
  const out = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const source = str(l?.source ?? l?.src ?? l?.text).trim();
    if (!source) continue;
    const t0 = num(l?.t0, 0);
    out.push({
      t0,
      t1: num(l?.t1, t0),
      speaker: str(l?.speaker),
      source,
      translation: str(l?.translation ?? l?.tgt).trim(),
    });
    if (out.length >= TRANSCRIPT_CAP) break;
  }
  return out;
}

/** Side panel session lines ({t0,t1,src,tgt}) -> meeting transcript. */
export const sessionLinesToTranscript = normalizeTranscript;

/** @returns {Meeting} */
export function createMeeting(partial = {}) {
  const locale = str(partial.locale || 'en');
  const date = str(partial.date || new Date().toISOString().slice(0, 10));
  return {
    id: str(partial.id || `MOM-${rnd()}`),
    seriesId: str(partial.seriesId || 'default'),
    seq: num(partial.seq, 1),
    projectType: normalizeProjectType(partial.projectType),
    title: str(partial.title || 'Untitled meeting').trim(),
    date,
    start: strOrNull(partial.start),
    end: strOrNull(partial.end),
    tz: str(partial.tz || 'local'),
    chair: strOrNull(partial.chair),
    attendees: (Array.isArray(partial.attendees) ? partial.attendees : []).map((a) => ({
      name: str(a?.name),
      org: strOrNull(a?.org),
      speakerLabel: strOrNull(a?.speakerLabel),
    })).filter((a) => a.name),
    agenda: (Array.isArray(partial.agenda) ? partial.agenda : []).map((a) => ({
      ref: str(a?.ref),
      title: normalizeText(a?.title, locale),
      covered: !!a?.covered,
    })).filter((a) => a.ref),
    topics: partial.topics && typeof partial.topics === 'object' ? partial.topics : {},
    summary: normalizeText(partial.summary, locale),
    items: (Array.isArray(partial.items) ? partial.items : []).map((i) =>
      createMinuteItem(i, { locale }),
    ),
    engine: partial.engine
      ? {
          asr: str(partial.engine.asr),
          mt: strOrNull(partial.engine.mt),
          extractor: strOrNull(partial.engine.extractor),
          segments: num(partial.engine.segments, 0),
          durationSec: partial.engine.durationSec == null ? null : num(partial.engine.durationSec, 0),
        }
      : null,
    transcript: normalizeTranscript(partial.transcript),
    generatedAt: str(partial.generatedAt || new Date().toISOString()),
    issuedAt: strOrNull(partial.issuedAt),
    locale,
    schemaVersion: NOTE_SCHEMA_VERSION,
  };
}

/** Nomor register berikutnya untuk sebuah rapat: "W36-004". */
export function nextRef(meeting, prefix) {
  const p = prefix || `W${String(meeting.seq).padStart(2, '0')}`;
  let max = 0;
  for (const it of meeting.items) {
    const m = /^(.+)-(\d+)$/.exec(it.ref);
    if (m && m[1] === p) max = Math.max(max, Number(m[2]));
  }
  return `${p}-${String(max + 1).padStart(3, '0')}`;
}

/** Validasi ringan — lempar Error jika bentuknya salah. */
export function assertMeeting(meeting) {
  if (!meeting || typeof meeting !== 'object') throw new Error('meeting harus objek');
  const m = /** @type {Record<string, unknown>} */ (meeting);
  if (typeof m.id !== 'string' || !m.id) throw new Error('meeting.id wajib string');
  if (typeof m.seriesId !== 'string' || !m.seriesId) throw new Error('meeting.seriesId wajib');
  if (!Array.isArray(m.items)) throw new Error('meeting.items wajib array');
  for (const it of m.items) {
    if (!it || typeof it !== 'object') throw new Error('item invalid');
    const i = /** @type {Record<string, unknown>} */ (it);
    if (typeof i.ref !== 'string' || !i.ref) throw new Error('item.ref wajib');
    if (!ITEM_TYPES.includes(/** @type {any} */ (i.type))) {
      throw new Error(`item.type tidak dikenal: ${String(i.type)}`);
    }
    if (!i.text || typeof i.text !== 'object') throw new Error(`item ${i.ref}: text wajib objek`);
  }
  return createMeeting(m);
}

/** Envelope penyimpanan lokal. */
export function wrapMeetingStore(meetings) {
  return {
    schemaVersion: NOTE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    meetings: meetings.map((m) => assertMeeting(m)),
  };
}

/** Ringkasan angka untuk header register. */
export function meetingStats(meeting, today = new Date()) {
  const items = meeting.items || [];
  const actions = items.filter((i) => i.type === 'action');
  const isOpen = (i) => i.status !== 'closed';
  const daysTo = (iso) =>
    iso ? Math.round((new Date(`${iso}T00:00:00Z`) - startOfDayUTC(today)) / 86400000) : null;
  const overdue = items.filter((i) => isOpen(i) && i.due && daysTo(i.due) < 0);
  const covered = (meeting.agenda || []).filter((a) => a.covered).length;
  const agendaTotal = (meeting.agenda || []).length;
  const progress = items.find(
    (i) => i.type === 'metric' && i.metric && i.metric.measure === 'cumulative_progress',
  );
  return {
    total: items.length,
    actionsOpen: actions.filter(isOpen).length,
    actionsTotal: actions.length,
    overdue: overdue.length,
    decisions: items.filter((i) => i.type === 'decision').length,
    questionsOpen: items.filter((i) => i.type === 'question' && isOpen(i)).length,
    unreviewed: items.filter((i) => i.review === 'ai').length,
    lowConfidence: items.filter((i) => i.confidence < LOW_CONFIDENCE).length,
    carried: items.filter((i) => i.carriedFrom).length,
    agendaCovered: covered,
    agendaTotal,
    agendaPct: agendaTotal ? Math.round((covered / agendaTotal) * 100) : 0,
    variance: progress?.metric?.variance ?? null,
    varianceUnit: progress?.metric?.unit ?? '',
  };
}

function startOfDayUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Umur item dalam hari sejak pertama dibuka (bertahan melewati carry-forward). */
export function itemAgeDays(item, today = new Date()) {
  if (!item.openedAt) return null;
  return Math.round((startOfDayUTC(today) - new Date(`${item.openedAt}T00:00:00Z`)) / 86400000);
}
