/**
 * Definisi tur terpandu (data saja) untuk Minutes/Notes, mengikuti bentuk
 * TourStep/GuidedTour dari DCS guidedTour.ts. `target` adalah nilai atribut
 * `data-tour` yang harus dipasang integrator UI pada kontrol terkait.
 *
 * Guided tour definitions — pure data, no DOM.
 * @typedef {{id:string, title:{en:string,id:string}, body:{en:string,id:string},
 *            target:string, waitMs:number, requireClick:boolean}} TourStep
 * @typedef {{id:string, title:{en:string,id:string}, surface:'sidepanel'|'minutes', steps:TourStep[]}} GuidedTour
 */

const step = (id, target, en, idText, bodyEn, bodyId, waitMs, requireClick) => ({
  id, target, title: { en, id: idText }, body: { en: bodyEn, id: bodyId }, waitMs, requireClick,
});

/** @type {GuidedTour} */
export const RECORD_TOUR = {
  id: 'record',
  surface: 'sidepanel',
  title: { en: 'Record a meeting', id: 'Merekam rapat' },
  steps: [
    step('project-type', 'notes-project-type',
      'Pick the project type', 'Pilih jenis proyek',
      'The project type decides which item types and register numbering the AI drafts with. Set it before you start capturing.',
      'Jenis proyek menentukan tipe item dan penomoran register yang dipakai AI saat membuat draf. Atur sebelum mulai menangkap.',
      4200, true),
    step('start', 'btn-start',
      'Start capture', 'Mulai tangkap',
      'Start listens to the tab or microphone and streams the transcript locally. Nothing leaves this machine.',
      'Mulai mendengarkan tab atau mikrofon dan mengalirkan transkrip secara lokal. Tidak ada yang keluar dari mesin ini.',
      4500, true),
    step('flag', 'notes-flag',
      'Flag a moment', 'Tandai momen',
      'Tap Flag when something important is said. The draft will anchor an item to this timecode.',
      'Ketuk Tandai saat ada hal penting diucapkan. Draf akan menautkan item ke stempel waktu ini.',
      3800, true),
    step('end-draft', 'notes-end-draft',
      'End and draft', 'Selesai dan buat draf',
      'End capture and let the engine turn the transcript into typed items: decisions, actions, risks, metrics.',
      'Akhiri tangkapan dan biarkan mesin mengubah transkrip menjadi item bertipe: keputusan, aksi, risiko, metrik.',
      5000, true),
    step('open-register', 'notes-open-register',
      'Open the register', 'Buka register',
      'The draft lands in the Minutes Register where you review, accept and issue it.',
      'Draf masuk ke Register Notulen tempat kamu menelaah, menerima, dan menerbitkannya.',
      4000, true),
  ],
};

/** @type {GuidedTour} */
export const REGISTER_TOUR = {
  id: 'register',
  surface: 'minutes',
  title: { en: 'Work the register', id: 'Mengelola register' },
  steps: [
    step('switch', 'm-switch',
      'Switch meetings', 'Ganti rapat',
      'The meeting switcher lists every meeting in the series. The newest draft opens first.',
      'Pemilih rapat menampilkan semua rapat dalam seri. Draf terbaru dibuka lebih dulu.',
      4200, true),
    step('chips', 'chips',
      'Filter by type', 'Saring per tipe',
      'Type chips narrow the register to decisions, actions, risks, questions, metrics or info.',
      'Chip tipe menyaring register ke keputusan, aksi, risiko, pertanyaan, metrik, atau info.',
      3800, true),
    step('accept', 'row-accept',
      'Accept an item', 'Terima item',
      'Press a on a row (or click the tick) to accept an AI-drafted item. Accepted items are what gets issued.',
      'Tekan a pada baris (atau klik centang) untuk menerima item draf AI. Item yang diterima itulah yang diterbitkan.',
      4500, true),
    step('drawer', 'drawer',
      'Check provenance', 'Periksa asal-usul',
      'The drawer shows the original speech, translation and timecode behind an item so you can verify it.',
      'Laci menampilkan ucapan asli, terjemahan, dan stempel waktu di balik sebuah item agar bisa kamu verifikasi.',
      4800, false),
    step('by-topic', 'view-topic',
      'Group by topic', 'Kelompokkan per topik',
      'By topic regroups the register under agenda items, the way the minutes will read.',
      'Per topik mengelompokkan ulang register di bawah butir agenda, seperti tampilan notulen nantinya.',
      3600, true),
    step('carry', 'view-carry',
      'Carry forward', 'Bawa ke rapat berikut',
      'Carry-forward lists open actions from earlier weeks so nothing is silently dropped.',
      'Bawa-lanjut menampilkan aksi terbuka dari minggu sebelumnya agar tidak ada yang hilang diam-diam.',
      4000, true),
    step('series', 'view-series',
      'Series view', 'Tampilan seri',
      'Series shows progress and decisions across the whole meeting series.',
      'Seri menampilkan kemajuan dan keputusan sepanjang seluruh rangkaian rapat.',
      3600, true),
    step('issue', 'btn-issue',
      'Issue the minutes', 'Terbitkan notulen',
      'Issue freezes the accepted items into a numbered Minutes of Meeting and exports it.',
      'Terbitkan membekukan item yang diterima menjadi notulen bernomor dan mengekspornya.',
      5000, true),
  ],
};

/** @type {GuidedTour} */
export const LIBRARY_TOUR = {
  id: 'library',
  surface: 'minutes',
  title: { en: 'Learn from the sample library', id: 'Belajar dari pustaka contoh' },
  steps: [
    step('open', 'view-library',
      'Open the Library', 'Buka Pustaka',
      'The Library holds sample meeting series you can study before running your own.',
      'Pustaka berisi contoh seri rapat yang bisa dipelajari sebelum menjalankan rapatmu sendiri.',
      4000, true),
    step('domain', 'lib-domain',
      'Pick a domain', 'Pilih domain',
      'Domains group series by industry, for example offshore construction or software delivery.',
      'Domain mengelompokkan seri per industri, misalnya konstruksi lepas pantai atau pengiriman perangkat lunak.',
      3800, true),
    step('series', 'lib-series',
      'Pick a series', 'Pilih seri',
      'Each series is several consecutive weeks of minutes with carried items between them.',
      'Setiap seri berisi beberapa minggu notulen berurutan dengan item yang dibawa antar-minggu.',
      3800, true),
    step('import', 'lib-import',
      'Import it', 'Impor',
      'Import copies the series into your register so you can practise accepting and issuing safely.',
      'Impor menyalin seri ke registermu agar kamu bisa berlatih menerima dan menerbitkan dengan aman.',
      4500, true),
    step('walk', 'lib-week-next',
      'Walk the weeks', 'Telusuri minggu',
      'Use previous/next to step through the weeks and watch how open actions carry forward.',
      'Gunakan sebelumnya/berikutnya untuk menelusuri minggu dan melihat bagaimana aksi terbuka dibawa lanjut.',
      4200, true),
  ],
};

export const TOURS = Object.freeze([RECORD_TOUR, REGISTER_TOUR, LIBRARY_TOUR]);
export const TOUR_IDS = Object.freeze(TOURS.map((t) => t.id));

export function tourById(id) {
  return TOURS.find((t) => t.id === id) || null;
}

/** Same semantics as learningProgress.ts: completed → 100, otherwise ≤ 99. */
export function tourProgressPercent(maxStep, stepCount, completed) {
  if (completed) return 100;
  if (!(stepCount > 0)) return 0;
  return Math.max(0, Math.min(99, Math.round(((maxStep + 1) / stepCount) * 100)));
}
