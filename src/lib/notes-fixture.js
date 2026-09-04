/**
 * Data contoh — satu seri dua rapat (W35 -> W36) dipakai tombol "Muat data
 * contoh" di workspace kosong. Dibangun LEWAT notes-actions.js (addItem,
 * startNextMeeting, carryForward) supaya jalur yang sama dipakai UI nanti
 * juga yang menghasilkan data contoh — bukan objek tulisan tangan yang bisa
 * diam-diam menyimpang dari skema.
 *
 * Sample data — one two-meeting series (W35 -> W36) behind the empty
 * workspace's "Load sample data" button. Built THROUGH notes-actions.js so
 * the same pipeline the UI exercises produces the demo, instead of a
 * hand-written object that can silently drift from the schema. The transcript
 * lines are illustrative, not a real recording.
 */
import { createMeeting } from './notes-schema.js';
import { addItem, startNextMeeting } from './notes-actions.js';

export const SAMPLE_SERIES_ID = 'CPOC7-WEEKLY';

const ATTENDEES = [
  { name: 'Nasmee Samang', org: 'GZS' },
  { name: 'Lai Kong Teng', org: 'COMPANY' },
  { name: 'Riza', org: 'GZS' },
  { name: 'Jagdeep', org: 'MWS' },
  { name: 'Huimin', org: 'GZS' },
  { name: 'QA/QC', org: 'GZS' },
  { name: 'CVL', org: 'SUBCON' },
];

function buildW35() {
  let m = createMeeting({
    id: 'MOM-CPOC7-W35', seriesId: SAMPLE_SERIES_ID, seq: 35,
    title: 'CPOC Phase 7 — GZS Weekly Progress Meeting', date: '2026-08-19',
    start: '10:00', end: '12:00', tz: 'GMT+8', chair: 'Nasmee Samang',
    attendees: ATTENDEES, locale: 'en',
    agenda: [
      { ref: 'A2', title: { en: 'Dropped-object controls', id: 'Kendali dropped object' }, covered: true },
      { ref: 'A3', title: { en: 'Document review status (MDR/GMDR)', id: 'Status tinjauan dokumen (MDR/GMDR)' }, covered: true },
      { ref: 'A5', title: { en: 'HSE performance & yard audits', id: 'Kinerja K3 & audit yard' }, covered: true },
      { ref: 'A6', title: { en: 'Vessel selection (C900)', id: 'Pemilihan kapal (C900)' }, covered: false },
    ],
    engine: { asr: 'Whisper large-v3-turbo (MLX)', mt: 'local NMT', extractor: 'heuristic v1', segments: 196, durationSec: 6900 },
  });

  const items = [
    { type: 'decision', topic: 'controls', agenda: 'A2', owner: 'Lai Kong Teng', org: 'COMPANY',
      text: { en: 'Cranes are to be inspected and secured before operation and before transport — not operation alone.',
               id: 'Crane wajib diperiksa dan diamankan sebelum operasi dan sebelum transportasi — bukan hanya saat operasi.' },
      status: 'closed', review: 'accepted', confidence: 0.91,
      src: { t0: 698, speaker: 'Lai Kong Teng', lang: 'zh',
             orig: '起重机的护栏和潜在坠物不仅要在作业时检查，港口动员和运输到现场时也要检查。',
             tr: 'Crane handrails and potential dropped objects need inspection not only during operation but also during port-side mobilisation and transport to field.' } },
    { type: 'decision', topic: 'perf', agenda: 'A5', owner: 'QA/QC', org: 'GZS',
      text: { en: 'CUL onshore fabrication yard prefabrication audits confirmed for 21–22 September, run jointly with QA/QC.',
               id: 'Audit prefabrikasi di yard fabrikasi onshore CUL dikonfirmasi 21–22 September, dijalankan bersama QA/QC.' },
      status: 'closed', review: 'accepted', confidence: 0.92,
      src: { t0: 2332, speaker: 'Nasmee Samang', lang: 'zh',
             orig: 'CUL 陆上预制场的预制审核安排在 9 月 21 到 22 日，与 QAQC 一起进行。',
             tr: 'Prefabrication audits at the CUL onshore fabrication yard were planned for September 21–22 in conjunction with QAQC.' } },
    { type: 'info', topic: 'perf', agenda: 'A5',
      text: { en: '35,000+ accumulated man-hours; lagging KPI indicators positive; zero HSE incidents recorded this period.',
               id: 'Lebih dari 35.000 jam kerja terakumulasi; indikator KPI lagging positif; nol insiden K3 pada periode ini.' },
      status: 'closed', review: 'accepted', confidence: 0.95 },
    { type: 'metric', topic: 'progress', agenda: 'A5',
      text: { en: 'Cumulative actual progress, week 35' },
      status: 'closed', review: 'accepted', confidence: 0.93,
      metric: { measure: 'cumulative_progress', value: 9.78, baseline: 9.0, unit: '%', asOf: '2026-08-21' } },
    { type: 'action', topic: 'marine', agenda: 'A6', owner: 'Nasmee Samang', org: 'GZS', due: '2026-08-29',
      text: { en: 'Obtain written C900 availability window from the vessel owner.',
               id: 'Peroleh jendela ketersediaan C900 tertulis dari pemilik kapal.' },
      status: 'open', review: 'accepted', confidence: 0.90, openedAt: '2026-08-19',
      src: { t0: 2642, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '需要船东书面确认 C900 的可用窗口。',
             tr: 'Written confirmation of the C900 availability window is needed from the vessel owner.' } },
    { type: 'action', topic: 'docs', agenda: 'A3', owner: 'Riza', org: 'GZS', due: '2026-08-26',
      text: { en: 'Issue GMDR rev.3 to COMPANY with the revised submission priority list.',
               id: 'Terbitkan GMDR rev.3 ke COMPANY dengan daftar prioritas penyerahan yang direvisi.' },
      status: 'open', review: 'accepted', confidence: 0.88, openedAt: '2026-08-12',
      src: { t0: 1795, speaker: 'Riza', lang: 'zh',
             orig: 'GMDR 第三版要连同修订后的提交优先级清单一起发给公司。',
             tr: 'GMDR rev.3 to be issued to COMPANY together with the revised submission priority list.' } },
    { type: 'risk', topic: 'mob', agenda: 'A6', owner: 'Nasmee Samang', org: 'GZS', due: '2026-09-15',
      text: { en: 'OSP approval slipping into the mobilisation window would delay sail-away; no float remains on the marine spread.',
               id: 'Persetujuan OSP yang bergeser ke jendela mobilisasi akan menunda sail-away; tidak ada float tersisa pada marine spread.' },
      status: 'open', review: 'edited', confidence: 0.84, openedAt: '2026-08-19',
      src: { t0: 2020, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '如果 OSP 批准拖到动员窗口，起航会被推迟。',
             tr: 'If OSP approval slips into the mobilisation window, sail-away will be delayed.' } },
  ];
  for (const it of items) m = addItem(m, it, { by: 'seed' });
  return m;
}

function buildW36(w35) {
  let m = startNextMeeting(w35, {
    id: 'MOM-CPOC7-W36', date: '2026-09-02',
    agenda: [
      { ref: 'A1', title: { en: 'Safety moment & incident review', id: 'Momen keselamatan & tinjauan insiden' }, covered: true },
      { ref: 'A2', title: { en: 'Dropped-object controls', id: 'Kendali dropped object' }, covered: true },
      { ref: 'A3', title: { en: 'Document review status (MDR/GMDR)', id: 'Status tinjauan dokumen (MDR/GMDR)' }, covered: true },
      { ref: 'A5', title: { en: 'HSE performance & yard audits', id: 'Kinerja K3 & audit yard' }, covered: true },
      { ref: 'A6', title: { en: 'Vessel selection (C900)', id: 'Pemilihan kapal (C900)' }, covered: true },
      { ref: 'A7', title: { en: 'Marine budget & pipeline cargo', id: 'Anggaran marine & kargo pipa' }, covered: false },
      { ref: 'A8', title: { en: 'Look-ahead: 3-week plan', id: 'Look-ahead: rencana 3 minggu' }, covered: false },
    ],
    engine: { asr: 'Whisper large-v3-turbo (MLX)', mt: 'local NMT', extractor: 'heuristic v1', segments: 214, durationSec: 7320 },
  });

  const items = [
    { type: 'info', topic: 'hse', agenda: 'A1',
      text: { en: 'Grating fell from the HLV main-boom walkway onto the jacket sea deck and struck a portable fire extinguisher; a second object later fell from the main crane into the sea. Personnel on the sea deck were evacuated to the barge — no injuries.',
               id: 'Grating jatuh dari walkway main-boom HLV ke sea deck jacket dan menghantam APAR portabel; benda kedua kemudian jatuh dari main crane ke laut. Personel di sea deck dievakuasi ke barge — tidak ada cedera.' },
      status: 'closed', review: 'accepted', confidence: 0.94,
      src: { t0: 252, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '吊臂走道上的格栅掉落到导管架甲板上，砸到一个手提灭火器。人员已撤到驳船，之后又有物件掉入海中，无人受伤。',
             tr: 'A grating from the boom walkway fell onto the jacket deck and hit a portable extinguisher. Personnel were moved to the barge; another object then fell into the sea. No injuries.' } },
    { type: 'action', topic: 'controls', agenda: 'A2', owner: 'Lai Kong Teng', org: 'COMPANY', due: '2026-09-08',
      text: { en: 'Issue a crane inspection checklist covering greasing, fast-line block inspection and a boom-walkway sweep for loose items.',
               id: 'Terbitkan checklist inspeksi crane mencakup greasing, inspeksi fast-line block, dan penyisiran walkway boom untuk barang lepas.' },
      status: 'open', review: 'ai', confidence: 0.88, openedAt: '2026-09-02',
      src: { t0: 545, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '事故复盘建议建立起重机检查清单，包括润滑、快绳滑车检查，以及检查吊臂走道有无松散物件。',
             tr: 'The incident review recommended establishing a crane inspection checklist, including greasing, fast-line block inspection, and checking the crane-boom walkway for loose items.' } },
    { type: 'action', topic: 'docs', agenda: 'A3', owner: 'Riza', org: 'GZS', due: '2026-09-05',
      text: { en: "Obtain Mr. Huimin's signature on the SCI MWS draft before submission to COMPANY.",
               id: 'Peroleh tanda tangan Bapak Huimin pada draf SCI MWS sebelum penyerahan ke COMPANY.' },
      status: 'progress', review: 'ai', confidence: 0.85, openedAt: '2026-09-02',
      src: { t0: 1541, speaker: 'Riza', lang: 'zh',
             orig: 'SCI 的 MWS 草稿已经发给公司，正在等惠民先生签字后再正式提交。',
             tr: 'The SCI MWS draft had been shared with the company and was awaiting Mr. Huimin’s signature before submission.' } },
    { type: 'question', topic: 'marine', agenda: 'A6', owner: 'Nasmee Samang', org: 'GZS', due: '2026-09-09',
      text: { en: 'Which vessel is selected? Pending evaluation of C900 capability and availability window.',
               id: 'Kapal mana yang dipilih? Menunggu evaluasi kapabilitas dan jendela ketersediaan C900.' },
      status: 'open', review: 'ai', confidence: 0.81, openedAt: '2026-09-02',
      src: { t0: 2842, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '船的选择要等评估完 C900 的能力和可用性再定。',
             tr: 'Vessel selection to be resolved after evaluating C900 capability and availability.' } },
    { type: 'risk', topic: 'schedule', agenda: 'A8', owner: 'Nasmee Samang', org: 'GZS', due: '2026-09-09',
      text: { en: 'Delay risk on Ben and Coding activities for DNS shipment.',
               id: 'Risiko keterlambatan pada aktivitas Ben and Coding untuk pengiriman DNS.' },
      status: 'open', review: 'ai', confidence: 0.61, openedAt: '2026-09-02',
      correction: { from: 'Ben and Coding', to: 'bending and coating' },
      src: { t0: 3738, t1: 3761, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '弯管和涂敷的活动有明显的延误风险', tr: 'delay risk on the bending and coating activities',
             segmentIds: ['s1284'] } },
    { type: 'decision', topic: 'perf', agenda: 'A5', owner: 'QA/QC', org: 'GZS',
      text: { en: 'Adopt the prefab audit checklist as the standing template for future GZS yard audits.',
               id: 'Jadikan checklist audit prefab sebagai templat tetap untuk audit yard GZS berikutnya.' },
      status: 'closed', review: 'accepted', confidence: 0.90,
      src: { t0: 2410, speaker: 'Nasmee Samang', lang: 'zh',
             orig: '检查清单已经发给 CVL，效果不错，以后就用这份模板。',
             tr: 'The checklist had already been shared with CVL and worked well — use this template going forward.' } },
    { type: 'metric', topic: 'progress', agenda: 'A8',
      text: { en: 'Cumulative actual progress, week 36' },
      status: 'closed', review: 'accepted', confidence: 0.94,
      metric: { measure: 'cumulative_progress', value: 10.89, baseline: 9.78, unit: '%', asOf: '2026-08-28' } },
  ];
  for (const it of items) m = addItem(m, it, { by: 'seed' });
  return m;
}

/** Bangun [W35, W36] murni di memori — tanpa efek samping penyimpanan. */
export function buildSampleSeries() {
  const w35 = buildW35();
  const w36 = buildW36(w35);
  return [w35, w36];
}

/** Bangun lalu simpan lewat notes-store.js — dipakai tombol "Muat data contoh". */
export async function seedSampleData() {
  const { saveMeeting } = await import('./notes-store.js');
  const [w35, w36] = buildSampleSeries();
  await saveMeeting(w35);
  await saveMeeting(w36);
  return [w35, w36];
}
