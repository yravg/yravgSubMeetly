/**
 * String panel Notulen / Minutes Register. Dipisah dari i18n.js supaya berkas itu
 * tidak membengkak; `NOTES_I18N` diekspor ulang dari sana.
 *
 * Aturan: TIDAK ADA teks antarmuka yang ditulis langsung di markup. Semua lewat T().
 * Locale selain en/id mundur ke en, sama seperti I18N utama.
 */
const en = {
  /* chrome */
  minutes: 'Minutes',
  register: 'Minutes register',
  openRegister: 'Open minutes register',
  registerHint: 'The register opens in a full tab — a table does not belong in a 400px rail.',
  onDevice: 'On-device',
  export: 'Export',
  issue: 'Issue MoM',
  issued: 'Issued',
  startNext: 'Start next meeting',
  exportStanding: 'Export standing register',

  /* meeting facts */
  date: 'Date', time: 'Time', chair: 'Chair', present: 'Present', mom: 'MoM',
  series: 'Series', nth: (n) => `meeting ${n}`, cadence: 'Cadence', span: 'Span',
  meetings: 'Meetings', next: 'Next', preparedBy: 'Prepared by', distribution: 'Distribution',

  /* provenance band */
  draftedOnDevice: 'Drafted on this Mac',
  pipeline: (asr, seg, items) => `${asr} → ${seg} segments → ${items} register items`,
  needReview: 'need review',
  lowConfFlag: 'low-confidence flag',
  nothingLeft: 'No audio, transcript or text left this device.',
  noSource: 'No source — imported from v1',

  /* views */
  vRegister: 'Register', vTopic: 'By topic', vDoc: 'Minutes',
  vCarry: 'Carry-forward', vSeries: 'Series',

  /* columns */
  cRef: 'Ref', cType: 'Type', cTopic: 'Topic', cItem: 'Item', cOwner: 'Owner',
  cDue: 'Due', cStatus: 'Status', cSource: 'Source', cAge: 'Age', cRaised: 'Raised',

  /* types */
  decision: 'Decision', action: 'Action', question: 'Open question',
  risk: 'Risk', metric: 'Metric', info: 'Note',

  /* statuses */
  open: 'Open', progress: 'In progress', closed: 'Closed', carried: 'Carried',

  /* review states */
  ai: 'AI draft', accepted: 'Accepted', edited: 'Edited',

  /* stats */
  sItems: 'Register items', sActions: 'Actions open', sOverdue: 'Overdue',
  sQuestions: 'Open questions', sUnreviewed: 'Unreviewed', sCoverage: 'Agenda covered',
  sVariance: 'Progress vs baseline', sMeanAge: 'Mean age, open', sOldest: 'Oldest open item',

  /* fields / drawer */
  dText: 'Item text', dOwner: 'Owner', dDue: 'Due date', dStatus: 'Status',
  dTopic: 'Topic', dAgenda: 'Agenda ref', dProvenance: 'Where this came from',
  dLinked: 'Linked in this register', dHistory: 'History',
  asSpoken: 'As spoken', machineTranslation: 'Machine translation',
  citedSpan: 'cited span', lowConfWords: 'low-confidence words',

  /* actions */
  accept: 'Accept', saveEdit: 'Save edit', discard: 'Discard',
  playFrom: 'Play from here', addItem: 'Add item', carryIn: 'Carry in', close: 'Close',
  applyCorrection: 'Apply correction', keepAsHeard: 'Keep as heard', addToGlossary: 'Add to glossary',

  /* toolbar */
  search: 'Search items, owners, quotes…', mine: 'Mine', dual: 'Dual text',
  groupBy: 'Group', groupNone: 'none', needsReviewOnly: 'Needs review only',
  showing: (n, total) => `Showing ${n} of ${total}`,

  /* low confidence banner */
  asrUnsure: (pct) => `Speech recognition was unsure here — ${pct}%`,
  extractorWrote: 'The extractor wrote',
  audioSays: 'The audio says',

  /* carry-forward */
  carryIntro:
    'Open items inherited from the previous meeting. Anything still open is re-numbered into this register and keeps its original age.',
  openFor: 'open for', days: 'd', today: 'today', overdue: 'overdue', dueIn: 'in',
  noOwner: 'Unassigned', noDue: 'No date', noneYet: 'Nothing here yet',
  raisedAgain: 'Raised again this week',
  consecutive: (n) => `open question in ${n} consecutive meetings`,

  /* doc view */
  docSummary: 'Summary', docDecisions: 'Decisions', docActions: 'Action register',
  docQuestions: 'Open questions', docRisks: 'Risks', docMetrics: 'Progress',
  docNotes: 'Discussion notes',

  /* messages */
  msgAccepted: 'Item accepted — locked into the MoM',
  msgCarried: 'Carried into this register',
  msgIssued: 'MoM issued',
  msgBlocked: (n) => `${n} items still need review — issue anyway?`,
  msgIssuedFrozen: 'This MoM is issued and read-only. Create an amendment to correct it.',
  msgMigrated: (n) => `${n} meeting(s) upgraded from the old notes format`,
  msgSeeking: 'Seeking transcript to',
  msgEmpty: 'No items match the current filters.',
  msgNoMeeting: 'No meeting selected.',
};

const id = {
  minutes: 'Notulen',
  register: 'Register notulen',
  openRegister: 'Buka register notulen',
  registerHint: 'Register terbuka di tab penuh — tabel tidak muat di rel 400px.',
  onDevice: 'Di perangkat',
  export: 'Ekspor',
  issue: 'Terbitkan Notulen',
  issued: 'Terbit',
  startNext: 'Mulai rapat berikutnya',
  exportStanding: 'Ekspor register berjalan',

  date: 'Tanggal', time: 'Waktu', chair: 'Pimpinan', present: 'Hadir', mom: 'Notulen',
  series: 'Seri', nth: (n) => `rapat ke-${n}`, cadence: 'Irama', span: 'Rentang',
  meetings: 'Rapat', next: 'Berikutnya', preparedBy: 'Disusun oleh', distribution: 'Distribusi',

  draftedOnDevice: 'Disusun di perangkat ini',
  pipeline: (asr, seg, items) => `${asr} → ${seg} segmen → ${items} butir register`,
  needReview: 'perlu ditinjau',
  lowConfFlag: 'tanda keyakinan rendah',
  nothingLeft: 'Tidak ada audio, transkrip, atau teks yang keluar dari perangkat ini.',
  noSource: 'Tanpa sumber — impor dari v1',

  vRegister: 'Register', vTopic: 'Per topik', vDoc: 'Notulen',
  vCarry: 'Bawaan', vSeries: 'Seri',

  cRef: 'Ref', cType: 'Jenis', cTopic: 'Topik', cItem: 'Butir', cOwner: 'Penanggung jawab',
  cDue: 'Tenggat', cStatus: 'Status', cSource: 'Sumber', cAge: 'Umur', cRaised: 'Diangkat',

  decision: 'Keputusan', action: 'Tindak lanjut', question: 'Pertanyaan terbuka',
  risk: 'Risiko', metric: 'Metrik', info: 'Catatan',

  open: 'Terbuka', progress: 'Berjalan', closed: 'Selesai', carried: 'Dibawa',

  ai: 'Draf AI', accepted: 'Disetujui', edited: 'Disunting',

  sItems: 'Butir register', sActions: 'Tindak lanjut terbuka', sOverdue: 'Lewat tenggat',
  sQuestions: 'Pertanyaan terbuka', sUnreviewed: 'Belum ditinjau', sCoverage: 'Agenda terbahas',
  sVariance: 'Progres vs baseline', sMeanAge: 'Umur rata-rata', sOldest: 'Butir tertua',

  dText: 'Teks butir', dOwner: 'Penanggung jawab', dDue: 'Tenggat', dStatus: 'Status',
  dTopic: 'Topik', dAgenda: 'Ref agenda', dProvenance: 'Asal butir ini',
  dLinked: 'Terkait di register ini', dHistory: 'Riwayat',
  asSpoken: 'Sesuai ucapan', machineTranslation: 'Terjemahan mesin',
  citedSpan: 'rentang dikutip', lowConfWords: 'kata keyakinan rendah',

  accept: 'Setujui', saveEdit: 'Simpan suntingan', discard: 'Buang',
  playFrom: 'Putar dari sini', addItem: 'Tambah butir', carryIn: 'Bawa masuk', close: 'Tutup',
  applyCorrection: 'Terapkan koreksi', keepAsHeard: 'Biarkan sesuai terdengar',
  addToGlossary: 'Tambah ke glosarium',

  search: 'Cari butir, penanggung jawab, kutipan…', mine: 'Milik saya', dual: 'Dua bahasa',
  groupBy: 'Kelompok', groupNone: 'tidak', needsReviewOnly: 'Hanya yang perlu ditinjau',
  showing: (n, total) => `Menampilkan ${n} dari ${total}`,

  asrUnsure: (pct) => `Pengenalan suara ragu di sini — ${pct}%`,
  extractorWrote: 'Ekstraktor menulis',
  audioSays: 'Audionya berbunyi',

  carryIntro:
    'Butir terbuka warisan rapat sebelumnya. Yang masih terbuka dinomori ulang ke register ini dan mempertahankan umurnya.',
  openFor: 'terbuka', days: 'h', today: 'hari ini', overdue: 'lewat', dueIn: 'dalam',
  noOwner: 'Belum ditugaskan', noDue: 'Tanpa tenggat', noneYet: 'Belum ada apa-apa',
  raisedAgain: 'Diangkat lagi minggu ini',
  consecutive: (n) => `pertanyaan terbuka di ${n} rapat berturut-turut`,

  docSummary: 'Ringkasan', docDecisions: 'Poin keputusan', docActions: 'Register tindak lanjut',
  docQuestions: 'Pertanyaan terbuka', docRisks: 'Risiko', docMetrics: 'Progres',
  docNotes: 'Catatan pembahasan',

  msgAccepted: 'Butir disetujui — terkunci di notulen',
  msgCarried: 'Dibawa ke register ini',
  msgIssued: 'Notulen diterbitkan',
  msgBlocked: (n) => `${n} butir belum ditinjau — tetap terbitkan?`,
  msgIssuedFrozen: 'Notulen ini sudah terbit dan hanya-baca. Buat amandemen untuk mengoreksi.',
  msgMigrated: (n) => `${n} rapat dinaikkan dari format notulen lama`,
  msgSeeking: 'Menggeser transkrip ke',
  msgEmpty: 'Tidak ada butir yang cocok dengan filter.',
  msgNoMeeting: 'Belum ada rapat yang dipilih.',
};

export const NOTES_I18N = { en, id: { ...en, ...id } };

/** Locale mana pun yang bukan `id` memakai string Inggris — sama seperti I18N utama. */
export function notesStrings(lang) {
  return NOTES_I18N[lang] || NOTES_I18N.en;
}

/**
 * Pabrik penerjemah. `T('accept')` → string; `T('showing', 3, 18)` untuk entri
 * yang berupa fungsi.
 */
export function makeT(lang) {
  const dict = notesStrings(lang);
  return function T(key, ...args) {
    const v = dict[key] ?? NOTES_I18N.en[key] ?? key;
    return typeof v === 'function' ? v(...args) : v;
  };
}
