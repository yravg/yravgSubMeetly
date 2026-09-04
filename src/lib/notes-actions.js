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
  if (item.review === 'accepted' && !item.correction) return next;
  const changes = {};
  if (item.review !== 'accepted') changes.review = [item.review, 'accepted'];
  // Menerima apa adanya juga menolak saran koreksi ("keep as heard") —
  // saran itu tercatat di riwayat, bukan dihapus diam-diam.
  if (item.correction) changes.correction = [item.correction, null];
  next.items[i] = {
    ...item,
    review: 'accepted',
    correction: null,
    history: withHistory(item, changes, by),
  };
  return next;
}

/**
 * Terapkan saran koreksi ekstraktor: ganti `correction.from` dengan
 * `correction.to` di SEMUA bahasa teks butir, lalu bersihkan sarannya.
 * Lewat editItem, jadi item menjadi `edited` dan kata yang salah dengar tetap
 * ada di jejak audit.
 */
export function applyCorrection(meeting, ref, { by = 'local' } = {}) {
  const item = meeting.items[findIndex(meeting, ref)];
  if (!item.correction) throw new RegisterError('no_correction', `${ref} tidak punya saran koreksi`);
  const { from, to } = item.correction;
  const text = {};
  const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  for (const [lang, t] of Object.entries(item.text || {})) {
    text[lang] = t.replace(pattern, (hit) => (hit[0] === hit[0].toUpperCase() && hit.slice(1) === hit.slice(1).toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
  }
  return editItem(meeting, ref, { text, correction: null }, { by });
}

/**
 * Berapa rapat berturut-turut sebuah butir sudah terbuka: mengikuti rantai
 * `carriedFrom` + `links[0]` mundur ke rapat asal. 1 = baru diangkat.
 */
export function carryChain(meetings, meeting, item) {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  let n = 1;
  let cur = item;
  let m = meeting;
  const seen = new Set();
  while (cur && cur.carriedFrom && cur.links?.[0] && !seen.has(`${m.id}:${cur.ref}`)) {
    seen.add(`${m.id}:${cur.ref}`);
    const prev = byId.get(cur.carriedFrom);
    if (!prev) break;
    const prevItem = prev.items.find((x) => x.ref === cur.links[0]);
    if (!prevItem) break;
    n += 1;
    cur = prevItem;
    m = prev;
  }
  return n;
}

/** Butir terkait (`links`) diselesaikan lintas seri — [{item, meeting}]. */
export function linkedItems(meetings, meeting, item) {
  const out = [];
  const candidates = [meeting, ...meetings.filter((m) => m.id !== meeting.id)];
  for (const ref of item.links || []) {
    for (const m of candidates) {
      const hit = m.items.find((x) => x.ref === ref);
      if (hit) { out.push({ item: hit, meeting: m }); break; }
    }
  }
  // Butir lain di rapat yang sama yang menunjuk balik ke butir ini.
  for (const other of meeting.items) {
    if (other.ref !== item.ref && (other.links || []).includes(item.ref) && !out.some((o) => o.item.ref === other.ref)) {
      out.push({ item: other, meeting });
    }
  }
  return out;
}

/** Butir dibuka vs ditutup per rapat — bahan grafik alur seri. */
export function seriesFlow(meetings) {
  const tracked = (i) => i.type === 'action' || i.type === 'question' || i.type === 'risk';
  return [...meetings]
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({
      meetingId: m.id,
      seq: m.seq,
      date: m.date,
      opened: m.items.filter((i) => tracked(i) && !i.carriedFrom).length,
      closed: m.items.filter((i) => tracked(i) && i.status === 'closed').length,
      open: m.items.filter((i) => tracked(i) && i.status !== 'closed').length,
    }));
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
  // Salinan bawaan menggantikan aslinya: W35-018 yang dibawa jadi W36-001
  // dihitung SEKALI (yang terbaru), bukan dua kali.
  const superseded = new Set();
  for (const m of meetings) {
    for (const i of m.items) {
      if (i.carriedFrom && i.links?.[0]) superseded.add(`${i.carriedFrom}:${i.links[0]}`);
    }
  }
  const open = [];
  for (const m of meetings) {
    for (const i of m.items) {
      if (i.status === 'closed' || i.type === 'info' || i.type === 'metric') continue;
      if (superseded.has(`${m.id}:${i.ref}`)) continue;
      open.push({ item: i, meeting: m, age: itemAgeDays(i, now), chain: carryChain(meetings, m, i) });
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
export const applyCorrectionAndSave = persist(applyCorrection);
export const editItemAndSave = persist(editItem);
export const addItemAndSave = persist(addItem);
export const setStatusAndSave = persist(setStatus);
export const removeItemAndSave = persist(removeItem);
export const carryForwardAndSave = persist(carryForward);
export const issueMeetingAndSave = persist(issueMeeting);
