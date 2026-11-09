/**
 * Pustaka contoh transkrip rapat — yraverageSubMin.
 *
 * ~200 transkrip rapat deterministik dari 13 bidang (EPC, HSE, design review,
 * klien, stand-up, sprint, sales, finance, legal, training, riset, klinis,
 * sekolah). Sebagian besar berupa seri mingguan yang saling menyambung: action
 * yang diangkat minggu N disebut lagi, ditutup, atau dibawa pada minggu N+1.
 *
 * Murni data + fungsi murni (tanpa DOM, tanpa Date.now/Math.random). Transkrip
 * dibangun malas (lazy) dari PRNG berbiji sehingga indeksnya ringan dan hasil
 * `buildTranscript(id)` selalu identik. Impor seri berjalan lewat jalur yang
 * sama dengan UI: generateNotesFromTranscript → startNextMeeting/carryForward.
 *
 * Kontrak generateNotesFromTranscript: baris dibaca dari `text ?? tgt ?? src`
 * (BUKAN source/translation), jadi setiap baris di sini membawa `text` = ucapan
 * dalam bahasa transkrip, plus `source`/`translation` seperti keluaran pipeline.
 */
import { createMeeting, PROJECT_TYPES } from './notes-schema.js';
import { generateNotesFromTranscript } from './notes-generate.js';
import { startNextMeeting, setStatus } from './notes-actions.js';
import { saveMeeting } from './notes-store.js';

export const LIBRARY_VERSION = 1;

/* ------------------------------------------------------------------ PRNG */

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let a = hash32(String(seed)) || 1;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
  };
}

/* ------------------------------------------------------------------ dates */

const DAY = 86400000;
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}
const pad2 = (n) => String(n).padStart(2, '0');
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + mins;
  return `${pad2(Math.floor(t / 60) % 24)}:${pad2(t % 60)}`;
}

/* ------------------------------------------------------------------ people */

/** Nama pertama ASCII berhuruf kapital — cocok dengan penebak pemilik ekstraktor. */
const PEOPLE = [
  ['Riza', 'Pratama'], ['Dadang', 'Purwanto'], ['Ricky', 'Gunawan'], ['Sari', 'Wulandari'],
  ['Budi', 'Santoso'], ['Ayu', 'Lestari'], ['Fikri', 'Ramadhan'], ['Nadia', 'Hapsari'],
  ['Yusuf', 'Hidayat'], ['Intan', 'Permata'], ['Bayu', 'Nugroho'], ['Dewi', 'Anggraini'],
  ['Effendi', 'Zulkifli'], ['Farah', 'Aziz'], ['Hafiz', 'Rahman'], ['Nurul', 'Izzah'],
  ['Azlan', 'Ibrahim'], ['Janewut', 'Chan'], ['Somchai', 'Prasert'], ['Kanya', 'Wong'],
  ['James', 'Miller'], ['Priya', 'Nair'], ['Marco', 'Rossi'], ['Elena', 'Petrova'],
  ['Tom', 'Becker'], ['Aisha', 'Khan'], ['Daniel', 'Reed'], ['Mei', 'Lin'],
  ['Rahul', 'Verma'], ['Sofia', 'Alvarez'], ['Lars', 'Nilsen'], ['Grace', 'Okafor'],
];

/* ------------------------------------------------------------------ vocab */

/** Kata kerja penugasan — hanya bentuk yang dikenali ACTION_RE ekstraktor. */
const VERBS = [
  { en: 'prepare', id: 'menyiapkan' },
  { en: 'check', id: 'mengecek' },
  { en: 'update', id: 'memperbarui' },
  { en: 'review', id: 'meninjau' },
  { en: 'submit', id: 'mengirim' },
];
const DUE = [
  { en: 'by Wednesday', id: 'sebelum Rabu' },
  { en: 'by Thursday', id: 'sebelum Kamis' },
  { en: 'by Friday', id: 'sebelum Jumat' },
  { en: 'before next week’s meeting', id: 'sebelum rapat minggu depan' },
  { en: 'by end of this week', id: 'sebelum akhir minggu ini' },
];
const DECIDE = [
  { en: 'proceed with', id: 'melanjutkan' },
  { en: 'approve', id: 'menyetujui' },
  { en: 'defer', id: 'menunda' },
  { en: 're-baseline', id: 'menyusun ulang jadwal' },
  { en: 'freeze the scope of', id: 'membekukan lingkup' },
  { en: 'escalate', id: 'mengeskalasi' },
];
const CAUSES = [
  { en: 'late vendor delivery', id: 'keterlambatan vendor' },
  { en: 'resource availability', id: 'ketersediaan sumber daya' },
  { en: 'pending approvals', id: 'persetujuan yang tertunda' },
  { en: 'scope creep', id: 'pembengkakan lingkup' },
  { en: 'data quality', id: 'kualitas data' },
  { en: 'weather and access', id: 'cuaca dan akses' },
  { en: 'budget pressure', id: 'tekanan anggaran' },
  { en: 'staff turnover', id: 'pergantian staf' },
];

/**
 * Setiap bidang: label, projectType, organisasi, topik agenda, dokumen/objek
 * penugasan, dan metrik. Istilah teknis dibiarkan berbahasa Inggris pada
 * transkrip Indonesia — begitulah rapat kerja di lapangan terdengar.
 */
export const DOMAINS = [
  {
    id: 'epc', code: 'EPC', projectType: 'weekly-progress',
    label: { en: 'EPC / offshore construction', id: 'Konstruksi EPC / lepas pantai' },
    orgs: ['CPOC', 'GZS', 'PTSC', 'MWS'],
    topics: ['jacket fabrication', 'topside piping', 'pipeline coating', 'MDR submission status', 'load-out and sea fastening', 'HUC readiness', 'blasting and painting', 'manpower ramp-up', 'procurement of long-lead items'],
    objects: ['revised MDR', 'weekly progress report', 'three-week lookahead', 'recovery schedule', 'NCR close-out register', 'lifting plan', 'welding summary', 'vendor document register'],
    metrics: [['cumulative progress', '%', 5, 95], ['manhours this week', 'k', 8, 40], ['open NCRs', '', 2, 30]],
    series: [
      { code: '', weeks: 10, locale: 'en', title: 'CPOC Phase 7 - GZS Weekly Progress Meeting', start: '2026-01-14', time: '09:00' },
      { code: '2', weeks: 6, locale: 'id', bilingual: true, title: 'Rapat Progres Mingguan Fabrikasi Jacket Tangguh', start: '2026-03-04', time: '08:30' },
    ],
    standalone: ['Sail-away readiness review', 'Pipeline coating kick-off', 'Rapat koordinasi mobilisasi barge', 'HUC contractor alignment'],
  },
  {
    id: 'hse', code: 'HSE', projectType: 'hse',
    label: { en: 'HSE committee / toolbox', id: 'Komite HSE / toolbox' },
    orgs: ['Yard HSE', 'Contractor HSE', 'Client HSE', 'Medic'],
    topics: ['working at height', 'permit to work compliance', 'heat stress control', 'dropped objects', 'toolbox talk attendance', 'PPE inspection', 'emergency drill', 'near-miss reporting', 'housekeeping audit'],
    objects: ['JSA for lifting', 'drill report', 'incident investigation report', 'PPE matrix', 'near-miss log', 'scaffold inspection tags', 'toolbox topic sheet'],
    metrics: [['LTI-free days', '', 30, 900], ['near-miss reports', '', 2, 25], ['toolbox attendance', '%', 70, 100]],
    series: [
      { code: '', weeks: 8, locale: 'en', title: 'Yard HSE Committee Weekly', start: '2026-01-13', time: '07:30' },
      { code: '2', weeks: 5, locale: 'id', title: 'Rapat Komite K3 Mingguan Site B', start: '2026-02-17', time: '07:00' },
    ],
    standalone: ['Post-incident review: dropped grating', 'Monsoon season safety briefing', 'Toolbox: hot work controls', 'Audit K3 triwulan'],
  },
  {
    id: 'design', code: 'DES', projectType: 'design-review',
    label: { en: 'Engineering design review', id: 'Tinjauan desain rekayasa' },
    orgs: ['Structural', 'Process', 'Piping', 'Electrical'],
    topics: ['structural analysis results', 'P&ID revision', 'piping stress review', 'electrical load list', 'HAZOP action close-out', 'vendor data incorporation', '3D model review comments', 'interface register'],
    objects: ['P&ID rev C', 'stress calc note', 'load list rev B', 'HAZOP action register', 'model review comment sheet', 'interface register', 'design basis memo'],
    metrics: [['model review comments closed', '%', 20, 100], ['deliverables issued', '', 3, 60], ['HAZOP actions open', '', 0, 40]],
    series: [
      { code: '', weeks: 6, locale: 'en', title: 'Topside Detailed Design Review', start: '2026-01-15', time: '14:00' },
      { code: '2', weeks: 4, locale: 'en', title: 'Water Treatment Plant FEED Review', start: '2026-04-02', time: '10:00' },
    ],
    standalone: ['60% model review', 'Constructability workshop', 'Tinjauan desain pondasi', 'Vendor package review: compressors'],
  },
  {
    id: 'client', code: 'CLI', projectType: 'client-review',
    label: { en: 'Client / stakeholder review', id: 'Tinjauan klien / pemangku kepentingan' },
    orgs: ['COMPANY', 'CONTRACTOR', 'PMC', 'Authority'],
    topics: ['schedule status against baseline', 'change order register', 'invoice and payment status', 'quality findings', 'permit status', 'stakeholder communication', 'milestone certificates'],
    objects: ['change order log', 'monthly report draft', 'invoice backup', 'quality summary', 'permit tracker', 'milestone certificate pack'],
    metrics: [['schedule variance', 'days', -20, 10], ['invoiced to date', '%', 10, 90], ['open change orders', '', 1, 15]],
    series: [
      { code: '', weeks: 6, locale: 'en', title: 'COMPANY-CONTRACTOR Weekly Review', start: '2026-01-16', time: '15:00' },
      { code: '2', weeks: 5, locale: 'en', title: 'Terminal Expansion Stakeholder Review', start: '2026-03-06', time: '11:00' },
    ],
    standalone: ['Steering committee Q1', 'Change order negotiation', 'Rapat klien: klaim perpanjangan waktu', 'Handover planning with operations'],
  },
  {
    id: 'standup', code: 'STD', projectType: 'standup',
    label: { en: 'Software stand-up', id: 'Stand-up tim perangkat lunak' },
    orgs: ['Platform', 'Mobile', 'QA', 'DevOps'],
    topics: ['login flow bug', 'payment service latency', 'CI pipeline flakiness', 'release branch cut', 'database migration', 'feature flag rollout', 'crash-free rate', 'API rate limiting'],
    objects: ['hotfix PR', 'migration script', 'flaky test list', 'release notes draft', 'load test results', 'rollback runbook', 'API contract doc'],
    metrics: [['crash-free sessions', '%', 95, 100], ['open P1 bugs', '', 0, 8], ['p95 latency', 'ms', 120, 900]],
    series: [
      { code: '', weeks: 12, locale: 'en', title: 'Payments Squad Weekly Stand-up', start: '2026-01-12', time: '09:15' },
      { code: '2', weeks: 6, locale: 'id', title: 'Stand-up Mingguan Tim Mobile', start: '2026-02-09', time: '09:30' },
    ],
    standalone: ['Incident post-mortem: checkout outage', 'Release readiness check', 'Onboarding sync for new joiners', 'Stand-up gabungan platform-mobile'],
  },
  {
    id: 'sprint', code: 'SPR', projectType: 'sprint',
    label: { en: 'Sprint planning / retro', id: 'Perencanaan sprint / retro' },
    orgs: ['Product', 'Engineering', 'Design', 'QA'],
    topics: ['sprint goal', 'velocity trend', 'carry-over stories', 'tech debt allocation', 'retro action items', 'definition of done', 'dependency on data team', 'demo preparation'],
    objects: ['sprint backlog', 'retro board summary', 'story point estimates', 'tech debt list', 'demo script', 'DoD checklist'],
    metrics: [['velocity', 'pts', 18, 60], ['carry-over', 'stories', 0, 8], ['sprint goal confidence', '%', 40, 100]],
    series: [
      { code: '', weeks: 8, locale: 'en', title: 'Sprint Planning - Team Nusantara', start: '2026-01-19', time: '13:00' },
      { code: '2', weeks: 4, locale: 'en', title: 'Sprint Retro - Growth Team', start: '2026-03-16', time: '16:00' },
    ],
    standalone: ['Quarterly planning kick-off', 'Retro: release 4.2', 'Refinement: notifications epic', 'Perencanaan sprint tim data'],
  },
  {
    id: 'sales', code: 'SAL', projectType: 'sales',
    label: { en: 'Sales pipeline', id: 'Pipeline penjualan' },
    orgs: ['Enterprise Sales', 'SMB Sales', 'Presales', 'Customer Success'],
    topics: ['enterprise pipeline review', 'renewal risk accounts', 'pricing exception requests', 'partner channel leads', 'forecast accuracy', 'demo conversion', 'quarter close plan'],
    objects: ['forecast sheet', 'proposal for the bank account', 'pricing exception form', 'renewal risk list', 'partner lead tracker', 'battlecard update'],
    metrics: [['pipeline coverage', 'x', 1, 5], ['weighted forecast', 'k USD', 200, 2500], ['win rate', '%', 15, 50]],
    series: [
      { code: '', weeks: 8, locale: 'en', title: 'APAC Sales Pipeline Weekly', start: '2026-01-13', time: '08:00' },
      { code: '2', weeks: 6, locale: 'id', title: 'Review Pipeline Mingguan Tim Jakarta', start: '2026-02-24', time: '08:30' },
    ],
    standalone: ['Q1 forecast call', 'Deal review: logistics account', 'Kickoff kampanye Q2', 'Renewal strategy session'],
  },
  {
    id: 'finance', code: 'FIN', projectType: 'finance',
    label: { en: 'Finance / budget', id: 'Keuangan / anggaran' },
    orgs: ['Finance', 'Procurement', 'Operations', 'Audit'],
    topics: ['month-end close', 'budget variance', 'cash flow forecast', 'accruals review', 'capex approvals', 'vendor payment backlog', 'audit findings', 'FX exposure'],
    objects: ['variance report', 'cash flow model', 'accrual schedule', 'capex request pack', 'aging report', 'audit response memo'],
    metrics: [['opex variance', '%', -12, 8], ['cash runway', 'months', 4, 24], ['overdue payables', 'k USD', 20, 600]],
    series: [
      { code: '', weeks: 6, locale: 'en', title: 'Monthly Close Working Group', start: '2026-01-20', time: '10:30' },
      { code: '2', weeks: 4, locale: 'id', bilingual: true, title: 'Rapat Anggaran Mingguan Divisi Operasi', start: '2026-03-10', time: '09:00' },
    ],
    standalone: ['Budget kick-off FY27', 'Audit close-out meeting', 'Tinjauan arus kas triwulan', 'Capex prioritisation'],
  },
  {
    id: 'legal', code: 'LEG', projectType: 'legal',
    label: { en: 'Legal / contract negotiation', id: 'Hukum / negosiasi kontrak' },
    orgs: ['Legal', 'Commercial', 'Counterparty', 'Insurance'],
    topics: ['liability cap wording', 'liquidated damages clause', 'IP ownership', 'termination for convenience', 'governing law', 'insurance requirements', 'payment terms', 'confidentiality carve-outs'],
    objects: ['redline of clause 14', 'term sheet', 'insurance certificate list', 'issues list', 'signature pack', 'board approval memo'],
    metrics: [['open clauses', '', 1, 20], ['days to signing target', 'days', 3, 60], ['redline rounds', '', 1, 8]],
    series: [
      { code: '', weeks: 6, locale: 'en', title: 'Master Services Agreement Negotiation', start: '2026-01-21', time: '14:30' },
      { code: '2', weeks: 5, locale: 'id', bilingual: true, title: 'Negosiasi Kontrak EPC Blok Timur', start: '2026-03-11', time: '13:30' },
    ],
    standalone: ['NDA triage session', 'Claim strategy meeting', 'Tinjauan kepatuhan kontrak', 'Subcontract flow-down review'],
  },
  {
    id: 'training', code: 'TRN', projectType: 'training',
    label: { en: 'Corporate training', id: 'Pelatihan korporat' },
    orgs: ['L&D', 'HR', 'Operations', 'External trainer'],
    topics: ['onboarding curriculum', 'trainer availability', 'e-learning completion', 'competency matrix', 'certification renewals', 'feedback scores', 'training budget'],
    objects: ['course outline', 'attendance sheet', 'competency matrix', 'feedback summary', 'certification tracker', 'LMS upload'],
    metrics: [['completion rate', '%', 40, 100], ['sessions delivered', '', 1, 12], ['average feedback', '/5', 3, 5]],
    series: [
      { code: '', weeks: 5, locale: 'en', title: 'Leadership Programme Weekly Sync', start: '2026-01-22', time: '11:00' },
      { code: '2', weeks: 4, locale: 'id', title: 'Koordinasi Pelatihan Induksi Karyawan Baru', start: '2026-02-19', time: '10:00' },
    ],
    standalone: ['Train-the-trainer debrief', 'Annual training needs analysis', 'Evaluasi pelatihan K3 dasar', 'LMS vendor review'],
  },
  {
    id: 'research', code: 'RES', projectType: 'research',
    label: { en: 'Academic research group', id: 'Kelompok riset akademik' },
    orgs: ['Lab A', 'Lab B', 'Stats core', 'Grants office'],
    topics: ['experiment replication', 'manuscript revision', 'grant proposal timeline', 'data pipeline bugs', 'conference abstract', 'ethics amendment', 'student progress', 'equipment downtime'],
    objects: ['manuscript draft', 'figure 3 revision', 'grant budget justification', 'analysis notebook', 'ethics amendment form', 'abstract for the conference'],
    metrics: [['samples processed', '', 20, 400], ['manuscript comments open', '', 0, 30], ['grant deadline', 'days', 5, 90]],
    series: [
      { code: '', weeks: 8, locale: 'en', title: 'Microbiome Lab Weekly Group Meeting', start: '2026-01-14', time: '10:00' },
      { code: '2', weeks: 6, locale: 'en', title: 'Coastal Erosion Project Weekly', start: '2026-03-04', time: '15:00' },
    ],
    standalone: ['Paper sprint planning', 'Reviewer response meeting', 'Rapat evaluasi progres mahasiswa', 'Grant kick-off'],
  },
  {
    id: 'healthcare', code: 'HCR', projectType: 'healthcare',
    label: { en: 'Hospital ward / clinical governance', id: 'Bangsal rumah sakit / tata kelola klinis' },
    orgs: ['Nursing', 'Medical', 'Pharmacy', 'Quality'],
    topics: ['bed occupancy', 'medication error review', 'infection control audit', 'discharge planning', 'staffing gaps', 'patient complaint trends', 'falls prevention', 'hand hygiene compliance'],
    objects: ['medication error report', 'hand hygiene audit', 'discharge checklist', 'roster gap plan', 'incident summary', 'falls risk protocol'],
    metrics: [['bed occupancy', '%', 60, 100], ['hand hygiene compliance', '%', 60, 100], ['average length of stay', 'days', 2, 12]],
    series: [
      { code: '', weeks: 8, locale: 'en', title: 'Ward 5 Clinical Governance Weekly', start: '2026-01-15', time: '08:00' },
      { code: '2', weeks: 6, locale: 'id', title: 'Rapat Mingguan Mutu dan Keselamatan Pasien', start: '2026-02-26', time: '07:30' },
    ],
    standalone: ['Sepsis pathway review', 'Mortality and morbidity meeting', 'Audit kepatuhan cuci tangan', 'Winter surge planning'],
  },
  {
    id: 'education', code: 'EDU', projectType: 'education',
    label: { en: 'School / faculty meeting', id: 'Rapat sekolah / fakultas' },
    orgs: ['Faculty', 'Admin', 'Student affairs', 'Parents council'],
    topics: ['exam timetable', 'curriculum revision', 'student attendance', 'parent-teacher conference', 'lab equipment budget', 'accreditation preparation', 'extracurricular schedule', 'teacher workload'],
    objects: ['exam timetable draft', 'curriculum map', 'attendance report', 'accreditation evidence folder', 'equipment request', 'PTC schedule'],
    metrics: [['attendance rate', '%', 80, 100], ['accreditation evidence complete', '%', 10, 100], ['classes uncovered this week', '', 0, 10]],
    series: [
      { code: '', weeks: 6, locale: 'en', title: 'Science Faculty Weekly Meeting', start: '2026-01-16', time: '15:30' },
      { code: '2', weeks: 4, locale: 'id', title: 'Rapat Dewan Guru Mingguan', start: '2026-03-13', time: '14:00' },
    ],
    standalone: ['Accreditation readiness review', 'Exam board meeting', 'Rapat persiapan ujian akhir', 'Curriculum review day'],
  },
];

for (const d of DOMAINS) {
  if (!PROJECT_TYPES.includes(d.projectType)) throw new Error(`sample-library: projectType ${d.projectType} unknown`);
}

/* ------------------------------------------------------------------ catalogue */

function seriesIdOf(domain, s) {
  return `LIB-${domain.code}${s.code}`;
}
function weekId(seriesId, seq) {
  return `${seriesId}-W${pad2(seq)}`;
}
function standaloneId(domain, i) {
  return `LIB-${domain.code}-S${pad2(i + 1)}`;
}

/** Semua entri (ringan) dalam urutan tetap. */
function catalogue() {
  const out = [];
  for (const d of DOMAINS) {
    for (const s of d.series) {
      const seriesId = seriesIdOf(d, s);
      for (let seq = 1; seq <= s.weeks; seq++) {
        out.push({ id: weekId(seriesId, seq), domain: d, series: s, seriesId, seq, date: addDays(s.start, (seq - 1) * 7) });
      }
    }
    d.standalone.forEach((title, i) => {
      const locale = /^(Rapat|Audit|Tinjauan|Evaluasi|Kickoff|Perencanaan|Stand-up gabungan)/.test(title) ? 'id' : 'en';
      out.push({
        id: standaloneId(d, i), domain: d, series: null, seriesId: null, seq: 1,
        title, locale, bilingual: locale === 'id' && i % 2 === 0,
        date: addDays('2026-01-26', i * 9 + DOMAINS.indexOf(d) * 3),
        time: ['09:00', '10:30', '13:00', '15:00'][i % 4],
      });
    });
  }
  return out;
}

let catalogueCache = null;
function cat() {
  if (!catalogueCache) catalogueCache = catalogue();
  return catalogueCache;
}

export function listTranscriptIds() {
  return cat().map((e) => e.id);
}

/** Indeks ringan untuk navigasi — tanpa baris transkrip. */
export function buildLibraryIndex() {
  const domains = DOMAINS.map((d) => {
    const series = d.series.map((s) => {
      const seriesId = seriesIdOf(d, s);
      const weeks = [];
      for (let seq = 1; seq <= s.weeks; seq++) {
        weeks.push({
          id: weekId(seriesId, seq), seq, weekLabel: `W${pad2(seq)}`,
          date: addDays(s.start, (seq - 1) * 7), title: `${s.title} — Week ${seq}`,
        });
      }
      return { seriesId, title: s.title, projectType: d.projectType, locale: s.locale, bilingual: !!s.bilingual, weeks };
    });
    const standalone = cat()
      .filter((e) => e.domain === d && !e.series)
      .map((e) => ({ id: e.id, date: e.date, title: e.title, locale: e.locale }));
    const count = series.reduce((n, s) => n + s.weeks.length, 0) + standalone.length;
    return { id: d.id, label: d.label, projectType: d.projectType, count, series, standalone };
  });
  return { version: LIBRARY_VERSION, total: cat().length, domains };
}

/* ------------------------------------------------------------------ people per meeting */

function castFor(seedKey, domain) {
  const rng = makeRng(`cast:${seedKey}`);
  const people = rng.shuffle(PEOPLE).slice(0, rng.int(5, 7));
  const attendees = people.map((p, i) => ({
    name: `${p[0]} ${p[1]}`, first: p[0], org: domain.orgs[i % domain.orgs.length],
  }));
  return { chair: attendees[0], attendees };
}

/**
 * Action item yang DIANGKAT pada suatu pertemuan — diturunkan dari biji
 * (seriesId, seq) supaya minggu berikutnya bisa menyebutnya kembali tanpa
 * membangun transkrip minggu sebelumnya.
 */
function actionsRaised(seedKey, seq, domain, cast) {
  const rng = makeRng(`actions:${seedKey}:${seq}`);
  const n = rng.int(2, 3);
  const objs = rng.shuffle(domain.objects);
  const out = [];
  for (let i = 0; i < n; i++) {
    const owner = rng.pick(cast.attendees.slice(1));
    out.push({ owner: owner.first, ownerFull: owner.name, org: owner.org, verb: rng.pick(VERBS), obj: objs[i % objs.length], due: rng.pick(DUE) });
  }
  return out;
}

const actionText = (a, lang) =>
  lang === 'id'
    ? `${a.owner} akan ${a.verb.id} ${a.obj} ${a.due.id}.`
    : `${a.owner} to ${a.verb.en} the ${a.obj} ${a.due.en}.`;

/* ------------------------------------------------------------------ line builder */

/**
 * Bangun baris transkrip. Setiap templat ditulis dalam en + id; bahasa
 * transkrip memilih `text`, dan mode dwibahasa menambahkan `translation`.
 */
function buildLines({ seedKey, seq, weeks, domain, cast, locale, bilingual, title, prevActions, actions }) {
  const rng = makeRng(`lines:${seedKey}:${seq}`);
  const other = locale === 'id' ? 'en' : 'id';
  const lines = [];
  let t = rng.int(3, 40);
  const say = (speaker, pair, kind = 'talk') => {
    const words = pair[locale].split(/\s+/).length;
    const dur = Math.max(2, Math.round(words * 0.45 + rng.next() * 3));
    const line = { t0: t, t1: t + dur, speaker: speaker.name, source: pair[locale], text: pair[locale], lang: locale, kind };
    if (bilingual) line.translation = pair[other];
    lines.push(line);
    t += dur + rng.int(0, 3);
  };
  const chair = cast.chair;
  const team = cast.attendees.slice(1);
  const who = () => rng.pick(team);
  const weekLabel = seq;
  const recap = [];

  // Pembukaan
  say(chair, {
    en: weeks ? `Good morning everyone, welcome to week ${weekLabel} of the ${title}. Let’s get started.` : `Good morning everyone, thanks for joining the ${title}. Let’s get started.`,
    id: weeks ? `Selamat pagi semua, selamat datang di minggu ke-${weekLabel} ${title}. Kita mulai.` : `Selamat pagi semua, terima kasih sudah bergabung di ${title}. Kita mulai.`,
  });
  say(who(), { en: 'Morning. Can you hear me okay? Good.', id: 'Pagi. Bisa dengar suara saya? Oke.' });
  say(chair, {
    en: `We have ${cast.attendees.length} people on the call today, ${team[0].first} from ${team[0].org} and ${team[1].first} from ${team[1].org} among them.`,
    id: `Hari ini ada ${cast.attendees.length} orang di panggilan, termasuk ${team[0].first} dari ${team[0].org} dan ${team[1].first} dari ${team[1].org}.`,
  });

  // Tinjauan action minggu lalu — kesinambungan seri
  if (prevActions && prevActions.length) {
    say(chair, {
      en: `First, the open items from last week. There were ${prevActions.length} of them.`,
      id: `Pertama, butir terbuka dari minggu lalu. Ada ${prevActions.length} butir.`,
    });
    prevActions.forEach((a, i) => {
      const closed = rng.next() < 0.6;
      const owner = cast.attendees.find((p) => p.first === a.owner) || who();
      say(chair, {
        en: `${a.owner}, last week your item was the ${a.obj}. Where are we on that?`,
        id: `${a.owner}, minggu lalu butir kamu adalah ${a.obj}. Sampai mana sekarang?`,
      });
      if (closed) {
        say(owner, {
          en: `Done. I ${['sent', 'circulated', 'uploaded', 'finished'][i % 4]} the ${a.obj} on ${['Tuesday', 'Wednesday', 'Thursday'][i % 3]}, so that one can be closed.`,
          id: `Sudah selesai. ${a.obj} saya ${['kirim', 'edarkan', 'unggah', 'rampungkan'][i % 4]} hari ${['Selasa', 'Rabu', 'Kamis'][i % 3]}, jadi butir itu bisa ditutup.`,
        }, 'recap-closed');
      } else {
        say(owner, {
          en: `Still open. The ${a.obj} is about ${rng.int(40, 85)} percent there; I need one more week because of ${rng.pick(CAUSES).en}.`,
          id: `Masih terbuka. ${a.obj} sudah sekitar ${rng.int(40, 85)} persen; saya butuh satu minggu lagi karena ${rng.pick(CAUSES).id}.`,
        }, 'recap-open');
        say(chair, {
          en: `Okay, we carry the ${a.obj} to next week, ${a.owner}.`,
          id: `Baik, ${a.obj} kita bawa ke minggu depan, ${a.owner}.`,
        });
      }
      recap.push({ owner: a.owner, obj: a.obj, status: closed ? 'closed' : 'open' });
    });
  }

  // Agenda per topik
  const topics = rng.shuffle(domain.topics).slice(0, rng.int(4, 5));
  const agenda = [];
  let aIdx = 0;
  const pendingActions = actions.slice();
  const nDecisions = rng.int(1, 3);
  let decisionsLeft = nDecisions;
  topics.forEach((topic, ti) => {
    const ref = `A${ti + 1}`;
    agenda.push({ ref, title: { en: topic, id: topic }, covered: true });
    say(chair, { en: `Next item, ${topic}. ${team[ti % team.length].first}, over to you.`, id: `Berikutnya, ${topic}. ${team[ti % team.length].first}, silakan.` });
    const lead = team[ti % team.length];
    say(lead, {
      en: `Thanks. On ${topic} we had a ${rng.pick(['busy', 'steady', 'difficult', 'productive'])} week; let me run through the numbers.`,
      id: `Terima kasih. Untuk ${topic} minggu ini ${rng.pick(['padat', 'stabil', 'cukup berat', 'produktif'])}; saya bacakan angkanya.`,
    });
    const dLines = rng.int(3, 4);
    for (let k = 0; k < dLines; k++) {
      const m = domain.metrics[(ti + k) % domain.metrics.length];
      const v = rng.int(m[2], m[3]);
      const plan = Math.min(m[3], v + rng.int(-5, 8));
      const pick = rng.int(0, 2);
      if (pick === 0) {
        say(lead, {
          en: `On ${topic}, ${m[0]} stands at ${v}${m[1] ? ' ' + m[1] : ''} this week against a plan of ${plan}${m[1] ? ' ' + m[1] : ''}.`,
          id: `Untuk ${topic}, ${m[0]} minggu ini ${v}${m[1] ? ' ' + m[1] : ''} dibanding rencana ${plan}${m[1] ? ' ' + m[1] : ''}.`,
        }, 'metric');
      } else if (pick === 1) {
        say(lead, {
          en: `Quick update on ${topic}: the team finished the ${rng.pick(domain.objects)} and started on the next batch.`,
          id: `Update singkat ${topic}: tim sudah menyelesaikan ${rng.pick(domain.objects)} dan mulai batch berikutnya.`,
        });
      } else {
        say(rng.pick(team.filter((p) => p !== lead)) || chair, {
          en: `Do we have confirmation from ${rng.pick(domain.orgs)} on the ${rng.pick(domain.objects)} for ${topic}?`,
          id: `Apakah sudah ada konfirmasi dari ${rng.pick(domain.orgs)} soal ${rng.pick(domain.objects)} untuk ${topic}?`,
        }, 'question');
        say(lead, { en: 'Not yet, I’m chasing them this afternoon.', id: 'Belum, saya kejar siang ini.' });
      }
    }
    say(chair, { en: `Okay, thanks ${lead.first}. Anything else on ${topic}?`, id: `Baik, terima kasih ${lead.first}. Ada lagi soal ${topic}?` });
    if (rng.next() < 0.5) {
      const c = rng.pick(CAUSES);
      say(who(), {
        en: `The main risk on ${topic} is ${c.en}; if it slips we lose roughly ${rng.int(2, 15)} days.`,
        id: `Risiko utama pada ${topic} adalah ${c.id}; kalau meleset kita kehilangan sekitar ${rng.int(2, 15)} hari.`,
      }, 'risk');
    }
    if (decisionsLeft > 0 && (ti === topics.length - 1 || rng.next() < 0.6)) {
      const d = rng.pick(DECIDE);
      const form = rng.int(0, 1);
      say(chair, form
        ? { en: `Decision: we ${d.en} the ${topic} as presented.`, id: `Keputusan: kita ${d.id} ${topic} seperti yang dipaparkan.` }
        : { en: `Okay, so we agreed to ${d.en} the ${topic}. Noted.`, id: `Baik, jadi kita sepakat untuk ${d.id} ${topic}. Dicatat.` }, 'decision');
      decisionsLeft--;
    }
    if (pendingActions.length && (ti === topics.length - 1 || rng.next() < 0.7)) {
      const a = pendingActions.shift();
      const owner = cast.attendees.find((p) => p.first === a.owner) || who();
      say(chair, { en: actionText(a, 'en'), id: actionText(a, 'id') }, 'action');
      say(owner, { en: 'Noted, will do.', id: 'Baik, saya kerjakan.' });
      aIdx++;
    }
  });
  // Action tersisa jatuh ke AOB
  if (pendingActions.length) {
    agenda.push({ ref: `A${topics.length + 1}`, title: { en: 'Any other business', id: 'Lain-lain' }, covered: true });
    say(chair, { en: 'Any other business before we close?', id: 'Ada hal lain sebelum kita tutup?' });
    for (const a of pendingActions) {
      say(chair, { en: actionText(a, 'en'), id: actionText(a, 'id') }, 'action');
    }
  }
  say(chair, {
    en: 'Thanks everyone, minutes will go out today. Same time next week.',
    id: 'Terima kasih semua, notulen dikirim hari ini. Minggu depan jam yang sama.',
  });
  return { lines, agenda, recap, durationSec: t };
}

/* ------------------------------------------------------------------ transcript */

/** Transkrip lengkap untuk satu id — dibangun malas dan deterministik. */
export function buildTranscript(id) {
  const e = cat().find((x) => x.id === id);
  if (!e) throw new Error(`sample-library: unknown transcript id ${id}`);
  const d = e.domain;
  const seedKey = e.seriesId || e.id;
  const cast = castFor(seedKey, d);
  const locale = e.series ? e.series.locale : e.locale;
  const bilingual = e.series ? !!e.series.bilingual : !!e.bilingual;
  const baseTitle = e.series ? e.series.title : e.title;
  const title = e.series ? `${baseTitle} — Week ${e.seq}` : baseTitle;
  const actions = actionsRaised(seedKey, e.seq, d, cast);
  const prevActions = e.series && e.seq > 1 ? actionsRaised(seedKey, e.seq - 1, d, cast) : null;
  const built = buildLines({
    seedKey, seq: e.seq, weeks: e.series ? e.series.weeks : 0, domain: d, cast, locale, bilingual, title: baseTitle, prevActions, actions,
  });
  const start = e.series ? e.series.time : e.time;
  return {
    id: e.id,
    domain: d.id,
    projectType: d.projectType,
    seriesId: e.seriesId || e.id,
    seq: e.seq,
    weekLabel: `W${pad2(e.seq)}`,
    title,
    date: e.date,
    start,
    end: addMinutes(start, Math.max(30, Math.ceil(built.durationSec / 60) + 5)),
    tz: 'Asia/Jakarta',
    chair: cast.chair.name,
    attendees: cast.attendees.map((a) => ({ name: a.name, org: a.org, speakerLabel: a.name, email: demoEmail(a.name) })),
    agenda: built.agenda,
    locale,
    bilingual,
    engine: { asr: 'sample-library', mt: bilingual ? 'sample-library' : null, extractor: null, segments: built.lines.length, durationSec: built.durationSec },
    actions: actions.map((a) => ({ owner: a.owner, ownerFull: a.ownerFull, org: a.org, obj: a.obj, text: actionText(a, locale) })),
    recap: built.recap,
    lines: built.lines,
  };
}

/* ------------------------------------------------------------------ import */

// Demo data for the Recap email / Due dates to calendar add-ins: example.com addresses, and a due date a
// few days after the meeting on each open action (the generator only writes "by Friday" into the text).
const demoEmail = (name) => `${name.normalize('NFD').replace(/[^A-Za-z ]/g, '').trim().toLowerCase().replace(/\s+/g, '.')}@example.com`;
function withDemoDue(m) {
  let k = 0;
  return { ...m, items: m.items.map((it) => (it.type === 'action' && it.status !== 'closed' && !it.due ? { ...it, due: addDays(m.date, 3 + 2 * (k++ % 4)) } : it)) };
}

function meetingFromTranscript(tr, prev) {
  return withDemoDue(buildMeeting(tr, prev));
}

function buildMeeting(tr, prev) {
  const meta = { title: tr.title, date: tr.date, locale: tr.locale, seriesId: tr.seriesId, source: 'sample-library' };
  const gen = generateNotesFromTranscript(tr.lines, meta);
  const generatedAt = `${tr.date}T${tr.end}:00.000Z`;
  const common = {
    id: tr.id, seriesId: tr.seriesId, seq: tr.seq, projectType: tr.projectType, title: tr.title,
    date: tr.date, start: tr.start, end: tr.end, tz: tr.tz, chair: tr.chair, attendees: tr.attendees,
    agenda: tr.agenda, locale: tr.locale, generatedAt,
    engine: { ...gen.engine, asr: 'sample-library', mt: tr.bilingual ? 'sample-library' : null },
    summary: gen.summary,
  };
  if (!prev) return createMeeting({ ...gen, ...common });
  // Jalur yang sama dengan UI: rapat berikutnya lahir dengan item bawaan.
  let m = startNextMeeting(prev, { ...common });
  m = createMeeting({ ...m, items: [...m.items, ...gen.items], engine: common.engine, summary: common.summary });
  // Butir bawaan yang dilaporkan selesai dalam transkrip ditutup lewat setStatus.
  for (const r of tr.recap) {
    if (r.status !== 'closed') continue;
    for (const it of m.items) {
      if (!it.carriedFrom || it.status === 'closed') continue;
      const txt = Object.values(it.text || {}).join(' ');
      if (txt.includes(r.obj) && txt.includes(r.owner)) m = setStatus(m, it.ref, 'closed', { by: 'sample-library' });
    }
  }
  return m;
}

async function persist(save, meeting) {
  const saved = await save(meeting);
  return saved && typeof saved === 'object' ? saved : meeting;
}

/** Impor satu seri utuh, minggu demi minggu, dengan carry-forward antar minggu. */
export async function importSeries(seriesId, { save = saveMeeting } = {}) {
  const entries = cat().filter((e) => e.seriesId === seriesId).sort((a, b) => a.seq - b.seq);
  if (!entries.length) throw new Error(`sample-library: unknown series ${seriesId}`);
  const meetings = [];
  let prev = null;
  for (const e of entries) {
    const m = meetingFromTranscript(buildTranscript(e.id), prev);
    meetings.push(await persist(save, m));
    prev = m;
  }
  return meetings;
}

/** Impor satu transkrip sebagai rapat tunggal. */
export async function importTranscript(id, { save = saveMeeting } = {}) {
  const m = meetingFromTranscript(buildTranscript(id), null);
  return persist(save, m);
}
