/**
 * Data tiruan Notulen Rapat Cerdas (Fase 2) — frontend-first.
 * Bentuk kontrak yang nanti diisi LLM lokal / native helper.
 */

/** @typedef {'idle' | 'generating' | 'ready' | 'error' | 'saved'} NotesLocalStatus */

/**
 * @typedef {object} ActionItem
 * @property {string} id
 * @property {string} text
 * @property {string | null} owner
 * @property {string | null} due
 * @property {'open' | 'done'} status
 */

/**
 * @typedef {object} MeetingNote
 * @property {string} id
 * @property {string} title
 * @property {string} source
 * @property {NotesLocalStatus} status
 * @property {string} generatedAt
 * @property {string} summary
 * @property {string[]} decisions
 * @property {ActionItem[]} actions
 * @property {string} transcriptPreview
 * @property {boolean} savedLocally
 */

/** Cuplikan transkrip contoh untuk aksi "Buat Notulen". */
export const STUB_TRANSCRIPT = [
  {
    t0: 0,
    t1: 12,
    speaker: 'Alya',
    text: 'Mari kita mulai. Agenda hari ini: status rilis yravgSubMeetly dan pembagian tindak lanjut.',
  },
  {
    t0: 12,
    t1: 28,
    speaker: 'Bima',
    text: 'Smoke 26 sub-fitur sudah hijau. Yang masih menahan gerbang: E2E --pick, --native, dan berkas offline.',
  },
  {
    t0: 28,
    t1: 45,
    speaker: 'Citra',
    text: 'Saya usul kita anggap draft native 500 ms sebagai target yang harus digeser ke Fase 2.1 jika belum tercapai minggu ini.',
  },
  {
    t0: 45,
    t1: 62,
    speaker: 'Alya',
    text: 'Keputusan: rilis internal boleh jalan setelah E2E pick dan file lulus; draft latency tetap dilacak tapi tidak memblokir soft-launch.',
  },
  {
    t0: 62,
    t1: 80,
    speaker: 'Bima',
    text: 'Action: Citra kerjakan e2e --pick besok; Bima siapkan --native; Alya update catatan rilis Jumat.',
  },
];

/** @type {MeetingNote} */
export const STUB_NOTE = {
  id: 'note-demo-001',
  title: 'Standup rilis Fase 1 — contoh',
  source: 'transkrip contoh (lokal)',
  status: 'ready',
  generatedAt: '2026-09-03T04:00:00Z',
  summary:
    'Tim meninjau gerbang rilis Fase 1. Smoke katalog 26 sub-fitur sudah lulus; fokus sisa adalah E2E pemilih tab, helper native, dan berkas offline. Soft-launch internal boleh setelah dua E2E itu hijau; target draft 500 ms dilacak terpisah.',
  decisions: [
    'Soft-launch internal setelah E2E --pick dan e2e-file --browser lulus.',
    'Target draft native ≤500 ms tidak memblokir soft-launch; masuk backlog Fase 2.1.',
  ],
  actions: [
    {
      id: 'act-1',
      text: 'Jalankan dan arsipkan hasil e2e.mjs --pick',
      owner: 'Citra',
      due: '2026-09-04',
      status: 'open',
    },
    {
      id: 'act-2',
      text: 'Verifikasi e2e.mjs --native dengan helper hidup',
      owner: 'Bima',
      due: '2026-09-04',
      status: 'open',
    },
    {
      id: 'act-3',
      text: 'Perbarui catatan rilis + gerbang mustFix',
      owner: 'Alya',
      due: '2026-09-05',
      status: 'open',
    },
  ],
  transcriptPreview: STUB_TRANSCRIPT.map((l) => `${l.speaker}: ${l.text}`).join('\n'),
  savedLocally: true,
};

/** Daftar notulen tersimpan (local-only stub). */
export const STUB_SAVED_NOTES = [
  STUB_NOTE,
  {
    id: 'note-demo-000',
    title: 'Retro lab benchmark',
    source: 'riwayat sesi · 2026-08-22',
    status: 'saved',
    generatedAt: '2026-08-22T22:10:00Z',
    summary: 'Bottleneck utama di jalur fast MT; draft ASR relatif cepat di MLX.',
    decisions: ['Pertahankan mlx-whisper Large v3 Turbo sebagai default native.'],
    actions: [
      {
        id: 'act-r1',
        text: 'Profilkan translate_refine vs fast MT',
        owner: 'Bima',
        due: null,
        status: 'done',
      },
    ],
    transcriptPreview: '(arsip singkat)',
    savedLocally: true,
  },
];

export const STUB_NOTES_STATE = {
  source: 'stub',
  localStatus: /** @type {NotesLocalStatus} */ ('ready'),
  activeNoteId: STUB_NOTE.id,
  note: STUB_NOTE,
  saved: STUB_SAVED_NOTES,
  emptyDecisionsMessage: 'Belum ada poin keputusan pada notulen ini.',
  emptyActionsMessage: 'Belum ada tindak lanjut. Tambahkan setelah notulen dibuat.',
};

/**
 * Kontrak yang nanti diganti fetch/LLM lokal.
 * @returns {Promise<typeof STUB_NOTES_STATE>}
 */
export async function loadNotesState() {
  return {
    ...STUB_NOTES_STATE,
    note: { ...STUB_NOTE },
    saved: STUB_SAVED_NOTES.map((n) => ({ ...n, actions: n.actions.map((a) => ({ ...a })) })),
  };
}

export function statusLabel(status) {
  switch (status) {
    case 'idle':
      return 'Siaga';
    case 'generating':
      return 'Menyusun…';
    case 'ready':
      return 'Siap (lokal)';
    case 'saved':
      return 'Tersimpan lokal';
    case 'error':
      return 'Gagal';
    default:
      return status;
  }
}
