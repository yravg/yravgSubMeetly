/**
 * ACTIONS — aturan domain register notulen. Lapisan ini memutuskan "kapan/mengapa";
 * mekanika penyimpanan ada di notes-store.js, bentuk data di notes-schema.js.
 *
 * Semua fungsi murni terhadap objek Meeting yang diberikan (mengembalikan salinan
 * baru) supaya UI bisa memakainya tanpa menyentuh penyimpanan, dan varian `*AndSave`
 * yang menuliskannya.
 */
import {
  createMinuteItem,
  createRevision,
  createMeeting,
  nextRef,
  itemAgeDays,
  LOW_CONFIDENCE,
} from './notes-schema.js';
import { saveMeeting } from './notes-store.js';

const clone = (m) => JSON.parse(JSON.stringify(m));
const today = () => new Date().toISOString().slice(0, 10);

class RegisterError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'RegisterError';
  }
}
export { RegisterError };

/** Notulen yang sudah diterbitkan itu beku — koreksi memakai amandemen. */
function assertEditable(meeting) {
  if (meeting.issuedAt) {
    throw new RegisterError(
      'issued',
      `${meeting.id} sudah diterbitkan ${meeting.issuedAt}. Buat amandemen, jangan ubah catatannya.`,
    );
  }
}

function findIndex(meeting, ref) {
  const i = meeting.items.findIndex((x) => x.ref === ref);
  if (i < 0) throw new RegisterError('not_found', `item ${ref} tidak ada di ${meeting.id}`);
  return i;
}

function withHistory(item, changes, by = 'local') {
  const at = new Date().toISOString();
  const history = [...(item.history || [])];
  for (const [field, [from, to]] of Object.entries(changes)) {
    history.push(createRevision({ at, by, field, from, to }));
  }
  return history;
}

/** Terima item apa adanya: draf AI → disetujui. */
export function acceptItem(meeting, ref, { by = 'local' } = {}) {
  assertEditable(meeting);
  const next = clone(meeting);
  const i = findIndex(next, ref);
  const item = next.items[i];
  if (item.review === 'accepted') return next;
  next.items[i] = {
    ...item,
    review: 'accepted',
    history: withHistory(item, { review: [item.review, 'accepted'] }, by),
  };
  return next;
}

/**
 * Sunting field item. Setiap perubahan menandai item sebagai `edited` — bukan
 * `accepted` — supaya jejaknya jelas: manusia mengubah kata-katanya, bukan sekadar
 * menyetujui yang ditulis mesin.
 */
export function editItem(meeting, ref, patch = {}, { by = 'local' } = {}) {
  assertEditable(meeting);
  const next = clone(meeting);
  const i = findIndex(next, ref);
  const item = next.items[i];
  const changes = {};
  const merged = { ...item };

  for (const [k, v] of Object.entries(patch)) {
    if (k === 'ref' || k === 'history' || k === 'src') continue; // identitas & asal tidak bisa disunting
    if (k === 'text') {
      const before = { ...(item.text || {}) };
      const after = { ...before, ...(v || {}) };
      for (const lang of Object.keys(after)) {
        if (before[lang] !== after[lang]) changes[`text.${lang}`] = [before[lang] ?? null, after[lang]];
      }
      merged.text = after;
      continue;
    }
    if (JSON.stringify(item[k]) !== JSON.stringify(v)) {
      changes[k] = [item[k], v];
      merged[k] = v;
    }
  }

  if (!Object.keys(changes).length) return next;
  merged.review = 'edited';
  if (item.review !== 'edited') changes.review = [item.review, 'edited'];
  merged.history = withHistory(item, changes, by);
  next.items[i] = createMinuteItem(merged, { locale: next.locale });
  return next;
}

/** Tambah item baru; nomor register dialokasikan dari urutan rapat. */
export function addItem(meeting, partial = {}, { by = 'local' } = {}) {
  assertEditable(meeting);
  const next = clone(meeting);
  const item = createMinuteItem(
    {
      openedAt: partial.status && partial.status !== 'closed' ? today() : null,
      ...partial,
      ref: partial.ref || nextRef(next),
      review: partial.review || 'edited', // ditulis manusia
      confidence: partial.confidence ?? 1,
    },
    { locale: next.locale },
  );
  item.history = [createRevision({ by, field: 'created', to: item.ref })];
  next.items.push(item);
  return next;
}

export function setStatus(meeting, ref, status, opts = {}) {
  return editItem(meeting, ref, { status }, opts);
}

export function removeItem(meeting, ref) {
  assertEditable(meeting);
  const next = clone(meeting);
  findIndex(next, ref);
  next.items = next.items.filter((x) => x.ref !== ref);
  return next;
}

/**
 * Item yang layak dibawa ke rapat berikutnya: terbuka, dan bukan catatan/metrik.
 * @returns {Array<object>}
 */
export function carryCandidates(source) {
  return (source.items || []).filter(
    (i) => i.status !== 'closed' && i.type !== 'info' && i.type !== 'metric',
  );
}

/**
 * Bawa item terbuka dari `source` ke `target`.
 *
 * Aturan yang penting: UMUR TIDAK DIRESET. `openedAt` ikut terbawa, `carriedFrom`
 * menunjuk rapat sebelumnya, dan `src.meetingId` tetap menunjuk rapat ASAL supaya
 * pemutaran audio masih menemukan kalimat aslinya.
 */
export function carryForward(target, source, { refs = null, by = 'local' } = {}) {
  assertEditable(target);
  const next = clone(target);
  const wanted = carryCandidates(source).filter((i) => !refs || refs.includes(i.ref));
  const already = new Set(next.items.map((i) => i.carriedFrom && i.links[0]).filter(Boolean));

  for (const item of wanted) {
    if (already.has(item.ref)) continue;
    const carried = createMinuteItem(
      {
        ...item,
        ref: nextRef(next),
        status: item.status === 'carried' ? 'open' : item.status,
        carriedFrom: source.id,
        openedAt: item.openedAt || source.date,
        links: [item.ref, ...(item.links || [])],
        src: item.src ? { ...item.src, meetingId: item.src.meetingId || source.id } : null,
      },
      { locale: next.locale },
    );
    carried.history = [
      ...(item.history || []),
      createRevision({ by, field: 'carriedFrom', from: item.ref, to: carried.ref }),
    ];
    next.items.push(carried);
  }
  return next;
}

/** Buat rapat berikutnya dalam seri, sudah berisi item bawaan. */
export function startNextMeeting(source, partial = {}) {
  const seq = Number(source.seq || 0) + 1;
  const blank = createMeeting({
    seriesId: source.seriesId,
    seq,
    title: source.title,
    tz: source.tz,
    chair: source.chair,
    attendees: source.attendees,
    topics: source.topics,
    locale: source.locale,
    date: partial.date || today(),
    id: partial.id || `${source.seriesId}-W${String(seq).padStart(2, '0')}`,
    ...partial,
  });
  return carryForward(blank, source);
}

/** Item yang menahan penerbitan: masih draf AI, atau keyakinan ASR rendah. */
export function blockingItems(meeting) {
  return (meeting.items || []).filter(
    (i) => i.review === 'ai' || i.confidence < LOW_CONFIDENCE,
  );
}

/**
 * Terbitkan MoM. Menolak selama masih ada item draf AI / keyakinan rendah,
 * kecuali dipaksa — dan pemaksaan itu tercatat di riwayat rapat.
 */
export function issueMeeting(meeting, { force = false, by = 'local' } = {}) {
  if (meeting.issuedAt) throw new RegisterError('issued', `${meeting.id} sudah diterbitkan.`);
  const blocking = blockingItems(meeting);
  if (blocking.length && !force) {
    throw new RegisterError(
      'unreviewed',
      `${blocking.length} butir belum ditelaah: ${blocking.map((i) => i.ref).join(', ')}`,
    );
  }
  const next = clone(meeting);
  next.issuedAt = new Date().toISOString();
  next.issuedBy = by;
  next.issuedWithUnreviewed = blocking.map((i) => i.ref);
  return next;
}

/** Amandemen atas notulen yang sudah terbit — catatan asli tidak pernah diubah. */
export function createAmendment(issued, { by = 'local' } = {}) {
  if (!issued.issuedAt) throw new RegisterError('not_issued', `${issued.id} belum diterbitkan.`);
  const n = Number(/-A(\d+)$/.exec(issued.id)?.[1] || 0) + 1;
  const baseId = issued.id.replace(/-A\d+$/, '');
  const next = createMeeting({ ...clone(issued), id: `${baseId}-A${n}`, issuedAt: null });
  next.amends = baseId;
  next.amendedBy = by;
  return next;
}

/** Ringkasan seri untuk tampilan register berjalan. */
export function seriesSummary(meetings, now = new Date()) {
  const open = [];
  for (const m of meetings) {
    for (const i of m.items) {
      if (i.status === 'closed' || i.type === 'info' || i.type === 'metric') continue;
      open.push({ item: i, meeting: m, age: itemAgeDays(i, now) });
    }
  }
  open.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  const ages = open.map((r) => r.age).filter((a) => a != null);
  const byOrg = {};
  for (const r of open) {
    const k = r.item.org || 'unassigned';
    byOrg[k] = (byOrg[k] || 0) + 1;
  }
  return {
    meetings: meetings.length,
    open: open.length,
    oldest: ages.length ? Math.max(...ages) : null,
    meanAge: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    byOrg,
    rows: open,
  };
}

/** Deret satu ukuran sepanjang seri — inilah gunanya tipe `metric`. */
export function metricSeries(meetings, measure) {
  const points = [];
  for (const m of meetings) {
    for (const i of m.items) {
      if (i.type !== 'metric' || !i.metric || i.metric.measure !== measure) continue;
      points.push({
        meetingId: m.id,
        seq: m.seq,
        asOf: i.metric.asOf || m.date,
        value: i.metric.value,
        baseline: i.metric.baseline,
        variance: i.metric.variance,
        unit: i.metric.unit,
        ref: i.ref,
      });
    }
  }
  return points.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : a.seq - b.seq));
}

/* ---------- varian yang menuliskan ke penyimpanan ---------- */
const persist = (fn) => async (meeting, ...args) => saveMeeting(fn(meeting, ...args));
export const acceptItemAndSave = persist(acceptItem);
export const editItemAndSave = persist(editItem);
export const addItemAndSave = persist(addItem);
export const setStatusAndSave = persist(setStatus);
export const removeItemAndSave = persist(removeItem);
export const carryForwardAndSave = persist(carryForward);
export const issueMeetingAndSave = persist(issueMeeting);
