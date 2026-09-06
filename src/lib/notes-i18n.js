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

  /* project types */
  projectType: 'Project type',
  projectTypeHint: 'Pick before you record — the register groups and filters by it.',
  pt_general: 'General', pt_weekly_progress: 'Weekly progress', pt_hse: 'HSE / safety',
  pt_design_review: 'Design review', pt_client_review: 'Client review', pt_standup: 'Stand-up',
  pt_sprint: 'Sprint planning / retro', pt_sales: 'Sales pipeline', pt_finance: 'Finance / budget',
  pt_legal: 'Legal / contract', pt_training: 'Training', pt_research: 'Research',
  pt_healthcare: 'Healthcare', pt_education: 'Education / class',
  allTypes: 'All types',
  draftFromSession: (n) => `Draft built from the recording — ${n} items detected, review them`,

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
  sItems: 'Register items', sActions: 'Actions open', sOverdue: 'Overdue', sDecisions: 'Decisions',
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
  msgItemAdded: 'Item added to the register',
  msgAmended: (id) => `Amendment created — ${id}`,
  msgSeeking: 'Seeking transcript to',
  msgEmpty: 'No items match the current filters.',
  msgNoMeeting: 'No meeting selected.',

  /* app bar / header (design canvas: Main artboard) */
  presentN: (n) => `${n}`,
  seriesNth: (n) => `meeting ${n}`,
  lowAsr: 'Low ASR confidence',
  aiDraftPct: (pct) => `AI draft · ${pct}%`,
  reported: 'reported',
  ahead: 'ahead', behind: 'behind',
  vsBaseline: 'baseline',

  /* footer */
  kbdMove: 'move', kbdAccept: 'accept', kbdOwner: 'owner', kbdDate: 'date',
  kbdSearch: 'search', kbdClose: 'close',
  lastSaved: (t, backend) => `Last saved ${t} · ${backend}`,
  notSavedYet: (backend) => `Not saved yet · ${backend}`,

  /* drawer (Provenance artboard) */
  agendaRef: (a) => `agenda ${a}`,
  translationHint: (other) => `${other} text is kept separately — switch language to edit it`,
  dPriority: 'Priority', prHigh: 'High', prMed: 'Medium', prLow: 'Low',
  dSevLik: 'Severity × likelihood',
  lkCertain: 'Certain', lkLikely: 'Likely', lkPossible: 'Possible', lkUnlikely: 'Unlikely',
  segRange: (a, b) => (a === b ? `seg ${a}` : `seg ${a}–${b}`),
  asr: 'ASR',
  correctionApplied: 'Correction applied — item marked as edited',
  keptAsHeard: 'Kept as heard — item accepted',
  glossaryAdded: (t) => `“${t}” added to the local glossary`,
  extractedBy: (by) => `created by ${by}`,
  flaggedLow: (pct) => `flagged low confidence · ${pct}% < 70%`,

  /* metric detail (Progress artboard) */
  mActual: 'Actual', mBaseline: 'Baseline', mVariance: 'Variance',
  mAhead: 'ahead of baseline', mBehind: 'behind baseline', mOnBaseline: 'on baseline',
  mChart: 'Cumulative progress against baseline',
  mChartNote: 'Only figures stated in this series are plotted — nothing is interpolated',
  mWhereFrom: 'Where the figure came from',
  mAheadNotSafe: 'Ahead, but not safe',
  mAheadNotSafeBody: (n) => `${n} open risk item(s) share this agenda line — read them together.`,
  mSingle: 'One data point so far — the curve starts next meeting',
  mTypedNote:
    'Three numbers were extracted from one sentence and typed as a measure, not prose — so next week\'s figure lands on the same axis instead of in a new paragraph.',

  /* series (Series artboard) */
  seriesLabel: 'Meeting series',
  standingRegister: 'Standing action register',
  openAcross: (n, m) => `${n} open across ${m} meeting(s)`,
  sortedByAge: 'Sorted by age — the number that goes on the progress report',
  flowTitle: 'Items opened and closed, per meeting',
  flowNote: (up, total, net) => `Opened outpaced closed in ${up} of ${total} meeting(s) — net ${net >= 0 ? '+' : ''}${net} over the series.`,
  opened: 'Opened',
  byParty: 'Open items by party',
  showAll: 'Show all', showLess: 'Show less',
  moreOpen: (n) => `+ ${n} more open item(s)`,
  raisedAgainBody: (text, n) => `“${text}” has been open in ${n} consecutive meetings without an owner. Assign it or close it.`,
  raisedAgainOwned: (text, n, owner) => `“${text}” has been carried through ${n} consecutive meetings (owner: ${owner}). Close it or re-plan it.`,
  raisedAgainNone: 'Nothing has been carried more than once — the register is clean.',
  startW: (n) => `Start W${n}`,
  nOpen: (n) => `${n} open`,
  cadenceWeekly: 'Weekly', cadenceBiweekly: 'Every two weeks',
  cadenceDays: (d) => `Every ${d} days`, cadenceNA: '—',
  consecutivePill: (n) => `raised in ${n} consecutive meetings`,

  /* issued document (MoM artboard) */
  momTitle: 'MINUTES OF MEETING',
  rev: 'Rev',
  draftWatermark: 'DRAFT — not yet issued',
  docMeeting: 'Meeting', docProject: 'Project', docNo: (n) => `no. ${n}`,
  docAccountable: 'Accountable', docReferredTo: 'Referred to', docBy: 'By',
  docAction: 'Action', docQuestion: 'Question', docRisk: 'Risk', docDecision: 'Decision',
  docCarriedFrom: (id, d) => `Carried from ${id}, open ${d} days.`,
  docFootAi: (n) => `${n} item(s) marked ‡ were drafted by on-device speech recognition and accepted without amendment by the minute-taker.`,
  docFootAllReviewed: 'Every item was reviewed by a human before issue.',
  docFootCorrected: (ref, from, to, tc) => `${ref} was corrected against the recording before issue: “${from}” → “${to}”, verified at ${tc}.`,
  docFootEngine: (asr, seg) => `Transcribed and drafted on the minute-taker's own machine — ${asr}, ${seg} segments. No audio, transcript or minute text was sent to any external service.`,
  docFootTrace: 'Every entry above is traceable to a timestamped segment of the recording kept on this device.',
  minutedBy: 'Minuted by',
  docSevLik: 'Sev × Lik',
  docRaisedRepeatedly: (n) => `Raised in ${n} consecutive meetings; no owner assigned.`,
  docRaisedRepeatedlyOwned: (n) => `Raised in ${n} consecutive meetings.`,
  saveSummary: 'Save summary',
  msgSummarySaved: 'Summary saved — this is what §1 says from now on',
  summaryPlaceholder: 'Write the summary in your own words — what opened the meeting, what it turned on, what it closed with.',
  summaryGenerated: 'Until you write one, the document uses the figures below.',
  printPdf: 'Print / PDF',

  /* side panel (SidePanel artboard) */
  capturedSoFar: 'Captured so far',
  latest: 'Latest',
  secSummary: 'Summary',
  secDecisions: 'Decisions',
  secActions: 'Action items',
  autoSummary: 'Generate auto summary',
  draftCancel: 'Discard draft',
  saveShort: 'Save',
  ownerLabel: 'Owner',
  panelHint: 'The register opens in a full tab — a table does not belong in a 400px rail.',
  recording: 'Recording',
  idle: 'Idle',
  endAndDraft: 'End & draft',
  flagMoment: 'Flag this moment',
  flagNeedsRecording: 'Start a capture task first — a flag is a timecode, and there is no clock yet.',
  flagRefusedIssued: 'This MoM is issued — flags go to an amendment or the next meeting',
  flaggedAt: (tc) => `Flagged at ${tc} — review this moment`,
  untitledMeeting: 'Untitled meeting',
};

const id = {
  /* project types */
  projectType: 'Tipe proyek',
  projectTypeHint: 'Pilih sebelum merekam — register mengelompokkan dan memfilter berdasarkan ini.',
  pt_general: 'Umum', pt_weekly_progress: 'Progres mingguan', pt_hse: 'K3 / keselamatan',
  pt_design_review: 'Tinjauan desain', pt_client_review: 'Tinjauan klien', pt_standup: 'Stand-up',
  pt_sprint: 'Perencanaan / retro sprint', pt_sales: 'Pipeline penjualan', pt_finance: 'Keuangan / anggaran',
  pt_legal: 'Hukum / kontrak', pt_training: 'Pelatihan', pt_research: 'Riset',
  pt_healthcare: 'Kesehatan', pt_education: 'Pendidikan / kelas',
  allTypes: 'Semua tipe',
  draftFromSession: (n) => `Draf dibuat dari rekaman — ${n} butir terdeteksi, mohon ditelaah`,

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

  sItems: 'Butir register', sActions: 'Tindak lanjut terbuka', sOverdue: 'Lewat tenggat', sDecisions: 'Keputusan',
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
  msgItemAdded: 'Butir ditambahkan ke register',
  msgAmended: (id) => `Amandemen dibuat — ${id}`,
  msgSeeking: 'Menggeser transkrip ke',
  msgEmpty: 'Tidak ada butir yang cocok dengan filter.',
  msgNoMeeting: 'Belum ada rapat yang dipilih.',

  presentN: (n) => `${n}`,
  seriesNth: (n) => `rapat ke-${n}`,
  lowAsr: 'Keyakinan ASR rendah',
  aiDraftPct: (pct) => `Draf AI · ${pct}%`,
  reported: 'dilaporkan',
  ahead: 'di depan', behind: 'di belakang',
  vsBaseline: 'baseline',

  kbdMove: 'pindah', kbdAccept: 'setujui', kbdOwner: 'penanggung jawab', kbdDate: 'tenggat',
  kbdSearch: 'cari', kbdClose: 'tutup',
  lastSaved: (t, backend) => `Tersimpan ${t} · ${backend}`,
  notSavedYet: (backend) => `Belum tersimpan · ${backend}`,

  agendaRef: (a) => `agenda ${a}`,
  translationHint: (other) => `Teks ${other} disimpan terpisah — ganti bahasa untuk menyuntingnya`,
  dPriority: 'Prioritas', prHigh: 'Tinggi', prMed: 'Sedang', prLow: 'Rendah',
  dSevLik: 'Keparahan × kemungkinan',
  lkCertain: 'Pasti', lkLikely: 'Besar', lkPossible: 'Mungkin', lkUnlikely: 'Kecil',
  segRange: (a, b) => (a === b ? `seg ${a}` : `seg ${a}–${b}`),
  asr: 'ASR',
  correctionApplied: 'Koreksi diterapkan — butir ditandai disunting',
  keptAsHeard: 'Dibiarkan sesuai terdengar — butir disetujui',
  glossaryAdded: (t) => `“${t}” ditambahkan ke glosarium lokal`,
  extractedBy: (by) => `dibuat oleh ${by}`,
  flaggedLow: (pct) => `ditandai keyakinan rendah · ${pct}% < 70%`,

  mActual: 'Aktual', mBaseline: 'Baseline', mVariance: 'Selisih',
  mAhead: 'di depan baseline', mBehind: 'di belakang baseline', mOnBaseline: 'sesuai baseline',
  mChart: 'Progres kumulatif terhadap baseline',
  mChartNote: 'Hanya angka yang disebut dalam seri ini yang digambar — tidak ada interpolasi',
  mWhereFrom: 'Asal angka ini',
  mAheadNotSafe: 'Di depan, tapi belum aman',
  mAheadNotSafeBody: (n) => `${n} risiko terbuka ada di baris agenda yang sama — baca bersama.`,
  mSingle: 'Baru satu titik data — kurvanya mulai di rapat berikutnya',
  mTypedNote:
    'Tiga angka diambil dari satu kalimat dan dijadikan tipe ukuran, bukan prosa — sehingga angka minggu depan jatuh di sumbu yang sama, bukan di paragraf baru.',

  seriesLabel: 'Seri rapat',
  standingRegister: 'Register tindak lanjut berjalan',
  openAcross: (n, m) => `${n} terbuka dari ${m} rapat`,
  sortedByAge: 'Diurutkan berdasarkan umur — angka yang masuk laporan progres',
  flowTitle: 'Butir dibuka dan ditutup, per rapat',
  flowNote: (up, total, net) => `Yang dibuka melebihi yang ditutup di ${up} dari ${total} rapat — bersih ${net >= 0 ? '+' : ''}${net} sepanjang seri.`,
  opened: 'Dibuka',
  byParty: 'Butir terbuka per pihak',
  showAll: 'Tampilkan semua', showLess: 'Tampilkan lebih sedikit',
  moreOpen: (n) => `+ ${n} butir terbuka lainnya`,
  raisedAgainBody: (text, n) => `“${text}” sudah terbuka di ${n} rapat berturut-turut tanpa penanggung jawab. Tugaskan atau tutup.`,
  raisedAgainOwned: (text, n, owner) => `“${text}” sudah dibawa melewati ${n} rapat berturut-turut (penanggung jawab: ${owner}). Tutup atau rencanakan ulang.`,
  raisedAgainNone: 'Belum ada yang dibawa lebih dari sekali — register bersih.',
  startW: (n) => `Mulai W${n}`,
  nOpen: (n) => `${n} terbuka`,
  cadenceWeekly: 'Mingguan', cadenceBiweekly: 'Dua mingguan',
  cadenceDays: (d) => `Setiap ${d} hari`, cadenceNA: '—',
  consecutivePill: (n) => `diangkat di ${n} rapat berturut-turut`,

  momTitle: 'NOTULEN RAPAT',
  rev: 'Rev',
  draftWatermark: 'DRAF — belum diterbitkan',
  docMeeting: 'Rapat', docProject: 'Proyek', docNo: (n) => `ke-${n}`,
  docAccountable: 'Bertanggung jawab', docReferredTo: 'Dirujuk ke', docBy: 'Batas',
  docAction: 'Tindak lanjut', docQuestion: 'Pertanyaan', docRisk: 'Risiko', docDecision: 'Keputusan',
  docCarriedFrom: (id, d) => `Dibawa dari ${id}, terbuka ${d} hari.`,
  docFootAi: (n) => `${n} butir bertanda ‡ disusun oleh pengenalan suara di perangkat dan disetujui tanpa perubahan oleh notulis.`,
  docFootAllReviewed: 'Setiap butir ditinjau manusia sebelum diterbitkan.',
  docFootCorrected: (ref, from, to, tc) => `${ref} dikoreksi terhadap rekaman sebelum terbit: “${from}” → “${to}”, diverifikasi pada ${tc}.`,
  docFootEngine: (asr, seg) => `Ditranskripsi dan disusun di mesin notulis sendiri — ${asr}, ${seg} segmen. Tidak ada audio, transkrip, atau teks notulen yang dikirim ke layanan eksternal.`,
  docFootTrace: 'Setiap entri di atas dapat ditelusuri ke segmen rekaman bercap waktu yang tersimpan di perangkat ini.',
  minutedBy: 'Dicatat oleh',
  docSevLik: 'Parah × Kemungkinan',
  docRaisedRepeatedly: (n) => `Diangkat di ${n} rapat berturut-turut; belum ada penanggung jawab.`,
  docRaisedRepeatedlyOwned: (n) => `Diangkat di ${n} rapat berturut-turut.`,
  saveSummary: 'Simpan ringkasan',
  msgSummarySaved: 'Ringkasan tersimpan — inilah isi §1 mulai sekarang',
  summaryPlaceholder: 'Tulis ringkasan dengan kata-kata Anda sendiri — apa yang membuka rapat, apa yang menjadi pokoknya, dan apa penutupnya.',
  summaryGenerated: 'Selama belum ditulis, dokumen memakai angka-angka di bawah ini.',
  printPdf: 'Cetak / PDF',

  capturedSoFar: 'Tertangkap sejauh ini',
  latest: 'Terbaru',
  secSummary: 'Ringkasan',
  secDecisions: 'Keputusan',
  secActions: 'Tindak lanjut',
  autoSummary: 'Buat ringkasan otomatis',
  draftCancel: 'Buang draf',
  saveShort: 'Simpan',
  ownerLabel: 'Pemilik',
  panelHint: 'Register terbuka di tab penuh — tabel tidak muat di rel 400px.',
  recording: 'Merekam',
  idle: 'Siaga',
  endAndDraft: 'Akhiri & buat draf',
  flagMoment: 'Tandai momen ini',
  flagNeedsRecording: 'Mulai tugas perekaman dulu — tanda itu sebuah timecode, dan jamnya belum berjalan.',
  flagRefusedIssued: 'Notulen ini sudah terbit — tanda masuk lewat amandemen atau rapat berikutnya',
  flaggedAt: (tc) => `Ditandai pada ${tc} — tinjau momen ini`,
  untitledMeeting: 'Rapat tanpa judul',
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
