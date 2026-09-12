/**
 * Register notulen yang dibawa ke dokumen bersama (dan dibaca aplikasi macOS).
 *   node --test test/shared-register.test.mjs
 *
 * Rantainya: Minutes Register (ekstensi) → meetingToDoc → POST /notes →
 * _normalize_note_doc (helper) → ~/.yraveragesubmin/notes.json → HelperSharedNotes.swift.
 *
 * Yang dijaga:
 *  - Dokumen bersama benar-benar membawa register, bukan hanya keputusan dan
 *    tindak lanjut. Sebelum ini pertanyaan, risiko, metrik, dan info hilang
 *    seluruhnya, dan keputusan kehilangan nomor ref serta jejak waktunya.
 *  - Field v1 tetap ada. Berkas ini tersimpan di disk pengguna; build macOS
 *    lama bisa membacanya kapan saja setelah build baru menulisnya.
 *  - Nama field persis seperti yang didekode Swift. Dekodernya sengaja
 *    toleran (semua `try?`), jadi field yang diganti nama TIDAK akan melempar
 *    galat — ia hanya diam-diam menjadi kosong. Tes inilah yang menangkapnya.
 *  - Helper menjinakkan masukan ngawur: endpoint-nya loopback, tapi apa pun
 *    di mesin itu bisa mengirim POST.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { meetingToDoc, docToSummary } from '../src/lib/notes-sync.js';
import {
  createMeeting,
  createMinuteItem,
  createProvenance,
  createMetric,
  LOW_CONFIDENCE,
} from '../src/lib/notes-schema.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PY = existsSync(`${ROOT}native/.venv/bin/python`) ? 'native/.venv/bin/python' : 'python3';

/** Rapat contoh dengan keenam tipe butir dan metadata yang lengkap. */
function sampleMeeting() {
  const m = createMeeting({
    id: 'MOM-DEMO-W36',
    seriesId: 'DEMO-WEEKLY',
    seq: 36,
    projectType: 'weekly-progress',
    title: 'Rapat mingguan contoh',
    date: '2026-09-02',
    chair: 'Alya',
    locale: 'en',
  });
  m.attendees = [
    { name: 'Alya', org: 'PMO', speakerLabel: null },
    { name: 'Bima', org: null, speakerLabel: null },
  ];
  m.agenda = [
    { ref: 'A1', title: { en: 'Progress' }, covered: true },
    { ref: 'A2', title: { en: 'Risks' }, covered: true },
    { ref: 'A3', title: { en: 'AOB' }, covered: false },
  ];
  m.engine = { asr: 'whisper-large-v3-turbo', mt: 'qwen2.5', extractor: null, segments: 50, durationSec: 1800 };
  m.summary = { en: 'Ringkasan rapat.' };
  m.items = [
    createMinuteItem({
      ref: 'W36-001', type: 'decision', topic: 'Rilis',
      text: { en: 'Ship on Friday' }, owner: 'Alya', org: 'PMO', status: 'closed',
      review: 'accepted', confidence: 0.95,
      src: createProvenance({ t0: 545, t1: 552, tc: '00:09:05', speaker: 'Alya' }),
    }),
    createMinuteItem({
      ref: 'W36-002', type: 'action', topic: 'QA',
      text: { en: 'Run cross-OS smoke' }, owner: 'Bima', due: '2026-09-15', status: 'open',
    }),
    createMinuteItem({
      ref: 'W36-003', type: 'question', text: { en: 'Who signs off?' }, confidence: 0.42,
    }),
    createMinuteItem({
      ref: 'W36-004', type: 'risk', text: { en: 'Weather may delay' },
      priority: 'high', likelihood: 'possible',
    }),
    createMinuteItem({
      ref: 'W36-005', type: 'metric', text: { en: 'Cumulative progress' },
      metric: createMetric({ measure: 'cumulative_progress', value: 1.11, unit: '%', baseline: 0.9 }),
    }),
    createMinuteItem({
      ref: 'W36-006', type: 'info', text: { en: 'Carried from last week' }, carriedFrom: 'W35-009',
    }),
  ];
  return m;
}

/** Jalankan _normalize_note_doc helper pada dokumen, kembalikan hasilnya. */
function normalizeViaHelper(doc) {
  const home = mkdtempSync(`${tmpdir()}/ysm-notes-`);
  const out = execFileSync(
    PY,
    ['-c', [
      'import sys, json',
      'sys.path.insert(0, "native")',
      'import server',
      'doc, err = server._normalize_note_doc(json.load(sys.stdin))',
      'print(json.dumps({"doc": doc, "err": err}))',
    ].join('\n')],
    { cwd: ROOT, input: JSON.stringify(doc), env: { ...process.env, HOME: home }, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').at(-1));
}

test('dokumen bersama membawa keenam tipe butir, bukan hanya keputusan dan tindak lanjut', () => {
  const doc = meetingToDoc(sampleMeeting());
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.items.length, 6, 'register tidak terbawa utuh');
  assert.deepEqual(
    doc.items.map((i) => i.type),
    ['decision', 'action', 'question', 'risk', 'metric', 'info'],
  );
  // Justru keempat tipe inilah yang dulu hilang sama sekali.
  for (const t of ['question', 'risk', 'metric', 'info']) {
    assert.ok(doc.items.some((i) => i.type === t), `tipe ${t} hilang`);
  }
});

test('detail per butir ikut: ref, pemilik, tenggat, status, jejak waktu, risiko, metrik', () => {
  const doc = meetingToDoc(sampleMeeting());
  const by = (ref) => doc.items.find((i) => i.ref === ref);

  const keputusan = by('W36-001');
  assert.equal(keputusan.topic, 'Rilis');
  assert.equal(keputusan.owner, 'Alya');
  assert.equal(keputusan.org, 'PMO');
  assert.equal(keputusan.status, 'closed');
  assert.equal(keputusan.review, 'accepted');
  assert.equal(keputusan.tc, '00:09:05', 'jejak waktu ke transkrip hilang');
  assert.equal(keputusan.speaker, 'Alya');

  assert.equal(by('W36-002').due, '2026-09-15');

  const risiko = by('W36-004');
  assert.equal(risiko.priority, 'high');
  assert.equal(risiko.likelihood, 'possible', 'sumbu kedua matriks risiko hilang');

  const metrik = by('W36-005').metric;
  assert.equal(metrik.value, 1.11);
  assert.equal(metrik.unit, '%');
  assert.equal(metrik.baseline, 0.9);

  assert.equal(by('W36-006').carriedFrom, 'W35-009');
});

test('butir berkeyakinan rendah ditandai perlu dicek memakai ambang yang sama', () => {
  const doc = meetingToDoc(sampleMeeting());
  const rendah = doc.items.find((i) => i.ref === 'W36-003');
  assert.ok(rendah.confidence < LOW_CONFIDENCE);
  assert.equal(rendah.needsReview, true, 'butir berkeyakinan rendah tidak ditandai');
  assert.equal(doc.items.find((i) => i.ref === 'W36-001').needsReview, false);
});

test('metadata rapat ikut: seri, tipe proyek, ketua, peserta, cakupan agenda, mesin', () => {
  const meta = meetingToDoc(sampleMeeting()).meeting;
  assert.equal(meta.seriesId, 'DEMO-WEEKLY');
  assert.equal(meta.seq, 36);
  assert.equal(meta.projectType, 'weekly-progress');
  assert.equal(meta.chair, 'Alya');
  assert.deepEqual(meta.attendees, ['Alya (PMO)', 'Bima'], 'organisasi peserta ikut bila ada');
  assert.deepEqual(meta.agenda, { total: 3, covered: 2 });
  assert.equal(meta.engine.asr, 'whisper-large-v3-turbo');
  assert.equal(meta.engine.segments, 50);
});

test('field v1 tetap ditulis supaya build macOS lama tidak kehilangan isinya', () => {
  // Dokumen ini tinggal di disk pengguna. Build lama bisa membacanya kapan
  // saja setelah build baru menulisnya, jadi decisions/actions tidak boleh
  // digantikan oleh items.
  const doc = meetingToDoc(sampleMeeting());
  assert.deepEqual(doc.decisions, ['Ship on Friday']);
  assert.equal(doc.actions.length, 1);
  assert.deepEqual(doc.actions[0], {
    id: 'W36-002', text: 'Run cross-OS smoke', owner: 'Bima', due: '2026-09-15', status: 'open',
  });
  assert.equal(doc.summary, 'Ringkasan rapat.');
  assert.equal(doc.status, 'ready');

  const ringkas = docToSummary(doc);
  assert.equal(ringkas.decisions, 1);
  assert.equal(ringkas.actions, 1);
  assert.equal(ringkas.items, 6);
});

test('nama field persis seperti yang didekode HelperSharedNotes.swift', () => {
  // Dekoder Swift memakai `try?` di setiap field: field yang diganti nama
  // tidak melempar galat, ia hanya menjadi kosong di layar. Daftar ini
  // disalin dari CodingKeys-nya.
  const doc = meetingToDoc(sampleMeeting());
  const has = (obj, keys, where) => {
    for (const k of keys) assert.ok(k in obj, `${where}: field "${k}" hilang dari dokumen`);
  };
  has(doc, ['id', 'title', 'date', 'source', 'status', 'summary', 'decisions',
    'actions', 'schemaVersion', 'meeting', 'items'], 'SharedNoteDoc');
  has(doc.items[0], ['ref', 'type', 'topic', 'text', 'owner', 'org', 'due', 'status',
    'priority', 'likelihood', 'review', 'confidence', 'needsReview', 'tc', 'speaker',
    'carriedFrom', 'links', 'metric'], 'SharedNoteItem');
  has(doc.meeting, ['seriesId', 'seq', 'projectType', 'locale', 'tz', 'start', 'end',
    'chair', 'attendees', 'agenda', 'issuedAt', 'generatedAt', 'engine'], 'SharedMeetingMeta');
  has(doc.meeting.agenda, ['total', 'covered'], 'SharedAgendaCount');
  has(doc.meeting.engine, ['asr', 'mt', 'segments', 'durationSec'], 'SharedEngineStamp');
  has(doc.items.find((i) => i.metric).metric,
    ['measure', 'value', 'unit', 'baseline', 'variance', 'asOf'], 'SharedNoteMetric');

  // Tipe butir yang dikenal enum Swift.
  const swift = new Set(['decision', 'action', 'question', 'risk', 'metric', 'info']);
  for (const i of doc.items) assert.ok(swift.has(i.type), `tipe "${i.type}" tidak dikenal Swift`);
});

test('helper menyimpan register apa adanya setelah dinormalkan', () => {
  const { doc, err } = normalizeViaHelper(meetingToDoc(sampleMeeting()));
  assert.equal(err, null);
  assert.equal(doc.schemaVersion, 2);
  assert.equal(doc.items.length, 6, 'helper membuang butir register');
  assert.equal(doc.meeting.seq, 36);
  assert.deepEqual(doc.meeting.agenda, { total: 3, covered: 2 });
  const risiko = doc.items.find((i) => i.ref === 'W36-004');
  assert.equal(risiko.priority, 'high');
  assert.equal(risiko.likelihood, 'possible');
  assert.equal(doc.items.find((i) => i.ref === 'W36-001').tc, '00:09:05');
  // Jalur v1 tetap utuh melewati helper.
  assert.deepEqual(doc.decisions, ['Ship on Friday']);
  assert.equal(doc.actions.length, 1);
});

test('helper menjinakkan masukan ngawur alih-alih meneruskannya', () => {
  const { doc, err } = normalizeViaHelper({
    id: 'X', title: 'T',
    items: [
      { ref: 'a', type: 'bukan-tipe', text: 'x', status: 'ngawur', confidence: 'abc' },
      { ref: 'b', type: 'info' },                       // tanpa teks
      { ref: 'c', type: 'risk', text: 'y', confidence: 0.3 },
      'bukan objek',
      { ref: 'd', type: 'metric', text: 'z', metric: { measure: 'm', value: 'bukan angka' } },
    ],
    meeting: { seriesId: 'S', seq: '36', agenda: { total: '8', covered: '6' }, attendees: 'bukan daftar' },
  });
  assert.equal(err, null);

  const by = (ref) => doc.items.find((i) => i.ref === ref);
  assert.equal(doc.items.length, 3, 'butir tanpa teks dan yang bukan objek harus dibuang');
  assert.equal(by('a').type, 'info', 'tipe tak dikenal jatuh ke info');
  assert.equal(by('a').status, 'open', 'status tak dikenal jatuh ke open');
  assert.equal(by('a').confidence, 1, 'keyakinan non-numerik jatuh ke 1');
  assert.equal(by('c').needsReview, true, 'ambang ditegakkan helper, bukan dipercaya dari pengirim');
  assert.equal(by('d').metric, null, 'metrik tanpa nilai numerik dibuang');
  assert.equal(doc.meeting.seq, 36, 'angka dalam string dikoersi');
  assert.deepEqual(doc.meeting.agenda, { total: 8, covered: 6 });
  assert.deepEqual(doc.meeting.attendees, [], 'peserta yang bukan daftar tidak boleh lolos');
});

test('dokumen v1 tanpa items tetap sah melewati helper', () => {
  // Aplikasi macOS menyusun ulang registernya dari decisions/actions
  // (SharedNoteDoc.register), jadi dokumen lama tidak boleh ditolak.
  const { doc, err } = normalizeViaHelper({
    id: 'lama', title: 'Dokumen lama', summary: 'S',
    decisions: ['Keputusan lama'],
    actions: [{ id: 'act-1', text: 'Tindak lanjut lama', owner: 'Citra', status: 'open' }],
  });
  assert.equal(err, null);
  assert.deepEqual(doc.items, []);
  assert.equal(doc.meeting, null);
  assert.deepEqual(doc.decisions, ['Keputusan lama']);
  assert.equal(doc.actions[0].owner, 'Citra');
});

/* ---------------------------------------------------------------------------
 * Sisi macOS. Aplikasi ini tidak punya target tes Swift, jadi dekodernya
 * diuji lewat `--register-probe` pada binari yang benar-benar dibangun.
 * Dilewati (bukan digagalkan) bila `swift build` belum pernah dijalankan —
 * mesin non-macOS tidak boleh membuat suite ini merah.
 * -------------------------------------------------------------------------*/

const MAC_BIN = `${ROOT}mac/.build/out/Products/Debug/yraverageSubMin`;
const macSkip = existsSync(MAC_BIN) ? false : 'binari macOS belum dibangun (cd mac && swift build)';

/** Tulis dokumen ke direktori state sekali pakai, lalu baca lewat probe. */
function probeRegister(doc) {
  const dir = mkdtempSync(`${tmpdir()}/ysm-state-`);
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ updatedAt: '2026-09-12T10:00:00', notes: [doc] }));
  const out = execFileSync(MAC_BIN, ['--register-probe'], {
    env: { ...process.env, YSM_STATE_DIR: dir },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').at(-1));
}

test('aplikasi macOS mendekode register v2 yang ditulis helper', { skip: macSkip }, () => {
  const { doc } = normalizeViaHelper(meetingToDoc(sampleMeeting()));
  const seen = probeRegister(doc).docs[0];

  assert.equal(seen.schemaVersion, 2);
  assert.equal(seen.rebuiltFromV1, false, 'seharusnya memakai items, bukan menyusun ulang dari v1');
  assert.equal(seen.registerCount, 6);
  assert.deepEqual(seen.counts, { decision: 1, action: 1, question: 1, risk: 1, metric: 1, info: 1 });
  assert.equal(seen.openActions, 1);
  assert.equal(seen.needsReview, 1);

  const by = (ref) => seen.items.find((i) => i.ref === ref);
  // Justru detail inilah yang dulu tidak pernah sampai ke aplikasi ini.
  assert.equal(by('W36-001').ownerLabel, 'Alya · PMO');
  assert.equal(by('W36-001').tc, '00:09:05');
  assert.equal(by('W36-002').due, '2026-09-15');
  assert.equal(by('W36-003').needsReview, true);
  assert.equal(by('W36-004').riskLabel, 'High × Possible');
  assert.equal(by('W36-005').metric, '1.11% (baseline 0.90%)');
  assert.equal(by('W36-006').carriedFrom, 'W35-009');

  assert.equal(seen.meeting.seriesLabel, 'DEMO-WEEKLY · #36');
  assert.equal(seen.meeting.chair, 'Alya');
  assert.equal(seen.meeting.attendees, 2);
  assert.equal(seen.meeting.agendaCovered, 2);
  assert.equal(seen.meeting.agendaTotal, 3);
  assert.equal(seen.meeting.asr, 'whisper-large-v3-turbo');
});

test('aplikasi macOS menyusun register dari dokumen v1 lama', { skip: macSkip }, () => {
  // Berkas v1 tidak ditulis ulang saat helper diperbarui, jadi dokumen lama
  // harus tetap terbaca — dengan ref buatan dan ditandai apa adanya.
  const { doc } = normalizeViaHelper({
    id: 'lama', title: 'Dokumen lama',
    decisions: ['Keputusan lama'],
    actions: [{ id: 'act-1', text: 'Tindak lanjut lama', owner: 'Citra', status: 'open' }],
  });
  const seen = probeRegister(doc).docs[0];

  assert.equal(seen.rebuiltFromV1, true);
  assert.equal(seen.registerCount, 2);
  assert.deepEqual(seen.counts.decision, 1);
  assert.deepEqual(seen.counts.action, 1);
  assert.equal(seen.items[0].ref, 'D-1', 'ref disintesis karena v1 tidak menyimpannya');
  assert.equal(seen.items[1].ownerLabel, 'Citra');
});

test('aplikasi macOS mundur ke berkas nama lama bila yang baru belum ada', { skip: macSkip }, () => {
  // Pengguna bisa membuka aplikasi ini sebelum helper pernah dijalankan,
  // jadi sebelum direktori state lama dipindah.
  const home = mkdtempSync(`${tmpdir()}/ysm-home-`);
  const legacyDir = join(home, '.localtranssub');
  execFileSync('mkdir', ['-p', legacyDir]);
  writeFileSync(join(legacyDir, 'notes.json'), JSON.stringify({
    notes: [{ id: 'lama-1', title: 'Dari direktori lama', decisions: ['Tetap terbaca'] }],
  }));

  const out = execFileSync(MAC_BIN, ['--register-probe'], {
    // YSM_STATE_DIR menunjuk direktori BARU yang sengaja dibiarkan kosong.
    env: { ...process.env, HOME: home, YSM_STATE_DIR: join(home, '.yraveragesubmin') },
    encoding: 'utf8',
  });
  const seen = JSON.parse(out.trim().split('\n').at(-1));
  assert.equal(seen.docs.length, 1, 'notulen di direktori lama tidak terbaca');
  assert.equal(seen.docs[0].title, 'Dari direktori lama');
});
