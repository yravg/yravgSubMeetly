/**
 * Daftar cacat rilis Fase 1.
 *
 * Frontend-first: data tiruan yang merangkum kendala terdokumentasi (README),
 * hasil lab (last-bench), dan celah uji. Nanti GET /api/release-defects.
 */

/** @typedef {'blocker' | 'high' | 'medium' | 'low'} Severity */
/** @typedef {'open' | 'accepted' | 'fixed'} DefectStatus */

/**
 * @typedef {object} Defect
 * @property {string} id
 * @property {string} title
 * @property {Severity} severity
 * @property {DefectStatus} status
 * @property {boolean} mustFix
 * @property {string} area
 * @property {string} featureId
 * @property {string} summary
 * @property {string} evidence
 */

/** @type {Defect[]} */
export const STUB_DEFECTS = [
  {
    id: 'REL-01',
    title: 'Draft native sering di atas target 500 ms',
    severity: 'high',
    status: 'open',
    mustFix: true,
    area: 'Native Helper',
    featureId: 'ext-refine',
    summary:
      'last-bench.json: 0/16 panggilan draft ≤500 ms (terbaik 520 ms). Bottleneck MT cepat 500–1700 ms.',
    evidence: 'test/last-bench.json · test/BENCH-LATEST.md',
  },
  {
    id: 'REL-02',
    title: 'E2E jalur pemilih tab (--pick) belum dijalankan di dasbor',
    severity: 'high',
    status: 'open',
    mustFix: true,
    area: 'Ekstensi Chrome',
    featureId: 'ext-tab-picker',
    summary:
      'scripts/e2e.mjs --pick ada, tetapi laporan QA menandai suite belum diuji. Wajib sebelum rilis karena tabCapture sering ditolak Chrome.',
    evidence: 'scripts/e2e.mjs --pick · test/qa-report.html',
  },
  {
    id: 'REL-03',
    title: 'E2E mesin native (--native) belum diverifikasi',
    severity: 'high',
    status: 'open',
    mustFix: true,
    area: 'Native Helper',
    featureId: 'helper-asr',
    summary: 'Jalur engine=native di Puppeteer belum punya hasil tersimpan di laporan QA.',
    evidence: 'scripts/e2e.mjs --native',
  },
  {
    id: 'REL-04',
    title: 'Tidak ada E2E transkripsi berkas offline',
    severity: 'high',
    status: 'open',
    mustFix: true,
    area: 'Ekstensi Chrome',
    featureId: 'ext-offline-file',
    summary: 'Drop berkas + OPFS + transcribeLong hanya teruji manual. PRD menuntut bukti ujung-ke-ujung berkas.',
    evidence: 'scripts/e2e.mjs (hanya realtime tab)',
  },
  {
    id: 'REL-05',
    title: 'Ekspor TXT tanpa unit test',
    severity: 'medium',
    status: 'open',
    mustFix: true,
    area: 'Ekspor',
    featureId: 'export-txt',
    summary: 'formatSrt/formatVtt tertutup test/subtitle-export.test.js; formatTxt belum.',
    evidence: 'src/lib/transcript-cache.js formatTxt',
  },
  {
    id: 'REL-06',
    title: 'Transkripsi berkas besar via helper belum diuji',
    severity: 'medium',
    status: 'open',
    mustFix: false,
    area: 'Native Helper',
    featureId: 'helper-large-file',
    summary: 'Berkas >1.5 GB tidak bisa decodeAudioData di browser; jalur /transcribe_file belum ada harness.',
    evidence: 'README · src/lib/i18n.js fileTooLarge',
  },
  {
    id: 'REL-07',
    title: 'Satu tab sekaligus; capture putus saat navigasi',
    severity: 'medium',
    status: 'accepted',
    mustFix: false,
    area: 'Ekstensi Chrome',
    featureId: 'ext-tab-capture',
    summary: 'Keterbatasan MV3 tabCapture. Didokumentasikan; bukan regresi yang harus ditutup di Fase 1.',
    evidence: 'README Dev notes',
  },
  {
    id: 'REL-08',
    title: 'Situs DRM dapat memblokir tabCapture',
    severity: 'low',
    status: 'accepted',
    mustFix: false,
    area: 'Ekstensi Chrome',
    featureId: 'ext-tab-capture',
    summary: 'Widevine/Fairplay sering menolak capture. Pengguna perlu sumber non-DRM atau app macOS.',
    evidence: 'README Known constraints',
  },
  {
    id: 'REL-09',
    title: 'Berkas MKV tidak didekode Chrome decodeAudioData',
    severity: 'low',
    status: 'accepted',
    mustFix: false,
    area: 'Ekstensi Chrome',
    featureId: 'ext-offline-file',
    summary: 'Format tidak didukung pipeline browser. Native helper + ffmpeg adalah jalan keluar.',
    evidence: 'README Known constraints',
  },
  {
    id: 'REL-10',
    title: 'Chrome menolak tabCapture jika ekstensi belum “invoked”',
    severity: 'medium',
    status: 'accepted',
    mustFix: false,
    area: 'Ekstensi Chrome',
    featureId: 'ext-tab-picker',
    summary: 'Mitigasi sudah ada: context menu + pemilih manual. Tetap mengganggu UX first-run.',
    evidence: 'src/lib/i18n.js needInvoke · scripts/e2e.mjs --allowlisted-extension-id',
  },
  {
    id: 'REL-11',
    title: 'Picker window/screen tidak membawa audio sistem di macOS',
    severity: 'medium',
    status: 'accepted',
    mustFix: false,
    area: 'Ekstensi Chrome',
    featureId: 'ext-tab-picker',
    summary: 'Harus pilih Chrome Tab + “Also share tab audio”. Audio sistem adalah wilayah app macOS.',
    evidence: 'src/lib/i18n.js pickHint',
  },
  {
    id: 'REL-12',
    title: 'Chrome Translator API hanya Chrome 138+',
    severity: 'low',
    status: 'accepted',
    mustFix: false,
    area: 'Terjemahan berjenjang',
    featureId: 'mt-chrome',
    summary: 'Fallback Opus-MT sudah ada. Bukan blocker rilis; perlu dicatat di catatan rilis.',
    evidence: 'README · src/lib/translate.js',
  },
];

export const STUB_DEFECT_LIST = {
  source: 'stub',
  generatedAt: '2026-09-03T00:00:00Z',
  defects: STUB_DEFECTS,
};

export async function loadDefectList() {
  try {
    const r = await fetch('last-defects.json');
    if (r.ok) {
      const j = await r.json();
      return {
        source: j.source || 'last-defects.json',
        generatedAt: j.generatedAt || new Date().toISOString(),
        defects: j.defects || [],
      };
    }
  } catch {
    /* file tidak ada */
  }
  return STUB_DEFECT_LIST;
}

export function summarizeDefects(defects) {
  const byStatus = { open: 0, accepted: 0, fixed: 0 };
  const bySev = { blocker: 0, high: 0, medium: 0, low: 0 };
  let mustFixOpen = 0;
  for (const d of defects) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
    if (d.mustFix && d.status === 'open') mustFixOpen += 1;
  }
  return {
    total: defects.length,
    mustFixOpen,
    releaseBlocked: mustFixOpen > 0,
    ...byStatus,
    ...bySev,
  };
}
