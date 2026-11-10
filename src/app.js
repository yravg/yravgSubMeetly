/**
 * App shell yravgSubMeetly (TIDE-002..005, 008, 014 — papan A01, A04, A09).
 *
 * Halaman (hash): today · live · minutes · notes · history · files · addins ·
 * island · perf · settings · helper. Today dan Minutes digambar di sini; halaman
 * lain memasang tampilan panel samping yang sudah ada (sidepanel.html?view=…),
 * jadi setiap kendali lama tetap ada sampai halaman barunya dibangun (T6).
 *
 * Data: register (notes-store, sama dengan minutes.html), helper /health,
 * chrome.storage.local `captionSurface`. Tidak ada data contoh di sini.
 * Teks UI: en + id (STR).
 */
import { listMeetings } from './lib/notes-store.js';
import { computeToday, greetingKey } from './lib/today.js';
import { nativeHealth, nativeGetModels } from './lib/native.js';
import { LOCAL_HELPER_ORIGIN } from './lib/native-protocol.js';
import { TYPE_COLOR } from './lib/notes-schema.js';
import { openMinutesWindow, isMinutesWindowOpen, WIN_ID_KEY } from './lib/minutes-window.js';
import { mountAskTide } from './ask-tide.js';
import { heroHtml, heroPose } from './app-pages/home.js';
import { minutesHtml, mountMinutes } from './app-pages/minutes.js';
import { migrateUiDefaults } from './lib/ui-defaults.js';

const IS_EXT = location.protocol === 'chrome-extension:';
// Engine-hosted (Windows app window): src/web-host.js installed a chrome stand-in, panels are sidepanel.html.
const WEB = !!globalThis.__ysmWebHost;
const HOSTED = IS_EXT || WEB;

/* ---------- strings ---------- */
const STR = {
  en: {
    meetings: 'Meetings', features: 'Features', today: 'Today', live: 'Live captions', minutes: 'Minutes', history: 'History', notes: 'Notes and glossary', glossary: 'Glossary', all: 'All features', files: 'Files',
    addins: 'Add-ins', island: 'Island', perf: 'Performance', settings: 'Settings', helper: 'Helper',
    startCaptions: 'Start captions', thisDevice: 'This device', allSeries: 'All series', series: 'Meeting series',
    notices: 'Notices', noNotices: 'Nothing needs you right now.', openMenu: 'Open menu', closeMenu: 'Close menu',
    morning: 'Good morning.', afternoon: 'Good afternoon.', evening: 'Good evening.',
    todayLine: (d) => `Today · ${d}`, hideNumbers: 'Hide numbers', showNumbers: 'Show numbers',
    captured: 'captured today', hm: (h, m) => (h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`),
    nMeetings: (n) => `${n} meeting${n === 1 ? '' : 's'} today`,
    itemsWeek: 'Items this week', moreThan: (n) => `${n} more than last week`, fewerThan: (n) => `${n} fewer than last week`, sameAs: 'Same as last week',
    whereWent: 'Where it went', owner: 'Owner', everyone: 'Everyone',
    decision: 'Decisions', action: 'Actions', question: 'Open questions', risk: 'Risks', ofItems: (n, t) => `${n} of ${t} items`,
    overdue: (n) => `${n} overdue`, overdueFirst: (ref, due, more) => `${ref} was due ${due}${more ? ` · ${more} more` : ''}`, noOverdue: 'Nothing overdue',
    ydayTitle: 'Yesterday’s minutes are still open', ydayBody: 'Issue them so owners get their actions.', issueMinutes: 'Issue minutes',
    todayCard: (n, hm) => `${n} meeting${n === 1 ? '' : 's'} · ${hm}`, todayNone: 'No meetings yet today.', checkIssue: 'Check them, then issue the minutes.',
    issued: 'Done', draft: 'Draft',
    helperLive: 'Live', helperOff: 'Offline', engine: 'Engine', device: 'Device', model: 'Model', nativeHelper: 'Native helper',
    helperPill: (d) => `Helper · ${d}`, helperPillOff: 'Helper offline', helperChecking: 'Checking helper…',
    lockedHelper: 'Needs the helper', lockedHelperBody: 'Start the Native Helper to see the engine, device and model here.', openHelper: 'Open Helper',
    lockedExt: 'Needs the extension', lockedExtBody: 'Tab capture and the page overlay only run inside the Chrome extension. In the lab the panel plays a CC0 sample instead.',
    noOverlay: 'No page overlay in this window', noOverlayBody: 'Press Start and share a tab, window or screen with audio. Captions appear here and in the island pill; the overlay on a web page needs the Chrome extension.',
    loading: 'Reading your register…', errTitle: 'The register could not be read.', errBody: (m) => `${m} Reload the page; if it keeps failing, export your minutes from the Minutes page.`, reload: 'Reload',
    emptyTitle: 'No meetings yet', emptyBody: 'Start captions in a meeting, or import a sample series from the Library on the Minutes page.', openMinutes: 'Open Minutes',
    welcomeTitle: 'Welcome to yravgSubMeetly', welcomeBody: 'Captions, translation and minutes stay on this device. Start captions when your meeting begins; the minutes build themselves.', gotIt: 'Got it', setupTitle: 'Set up in three steps', setupEngine: 'Engine running', setupEngineFix: 'Start the engine', setupAsr: 'Speech model on this device', setupAsrFix: 'Download one', setupTest: 'Try a test caption', setupTestGo: 'Start captions', setupDone: 'Ready', setupTodo: 'To do', setupChecking: 'Checking…',
    caughtUp: 'All caught up: nothing overdue and yesterday is issued.',
    registerStyle: 'Style', openRegister: 'Open register', classic: 'Classic ↗', openWindow: 'Open Minutes window ↗', windowOpen: 'Minutes window is open · Focus',
    minutesHint: 'Classic and Modern are the same register; edits show in both.', modern: 'Modern ↗',
    dev: 'Developer', devBanner: 'On in the lab. Off in the extension unless Settings › Developer is on.', devArea: 'Developer area', devAreaBody: 'Lab tools: test pages, mock helper, guides, CC0 samples. Off unless you build or test the extension.',
    lockedLab: 'Needs the lab server', lockedLabBody: 'The Developer area shows the local lab. Start it with ./scripts/start-lab.sh, then reload.',
    installed: 'Installed add-ins', builtIn: 'Built in', open: 'Open',
    fRecap: 'Recap email', fRecapD: 'Draft a recap after each meeting.',
    fGlossary: 'Glossary', fGlossaryD: 'Keep names and terms spelled right.',
    fDue: 'Due dates to calendar', fDueD: 'Send due dates to your calendar.',
    islandOn: 'On', islandOff: 'Off', needsTrust: 'Review first', featSwitch: (n) => `${n} on or off`, fIsland: 'Island', fIslandD: 'Captions in a pill under the notch.',
    fPerf: 'Performance', fPerfD: 'Speed and quality of each engine.',
    fLibrary: 'Library', fLibraryD: 'Sample transcripts to try things on.',
    fTraining: 'Training', fTrainingD: 'Short tours of the register.',
    fExport: 'Export', fExportD: 'SRT, VTT, TXT, MD, CSV, JSON.',
    addinNote: 'Add-ins turn on in the list below after you review and trust them.',
    lastSynced: (t) => `last synced ${t}`, yours: (n) => `${n} yours`, yourName: 'Your name', nameHint: 'Shown in the greeting and the sidebar. Stays on this device.', save: 'Save', clear: 'Clear', setName: 'Set your name', seriesSub: (n, chair) => `${n} meeting${n === 1 ? '' : 's'}${chair ? ` · chair ${chair}` : ''}`, noMeetings: 'No meetings yet',
    askTide: 'Ask Tide…', askBar: 'Ask Tide about your meetings…', send: 'Send', chips: ['Recap last meeting', 'What did I promise?', 'Open actions', 'Translate a file'],
    plansSub: 'Free covers everything on this computer. Pay only when you want cloud answers.', tagFree: 'To start capturing', tagPro: 'Let the cloud help when you want it', tagAgent: 'Just ask, and Tide does the follow-up', topUp: 'Top up', nCredits: (n) => `${n} credits`, bonus: (n) => `+${n}%`,
    plans: 'Plans', planFree: 'Free', planPro: 'Pro', planAgent: 'Agent', perMonth: '/ month', comingSoon: 'Coming soon', current: 'What you have now', beta: 'Beta',
    freeList: ['Unlimited Ask Tide with the local model', 'Register-only answers', '50 starter credits for cloud answers (14 days)', 'Captions, minutes, Island and add-ins'],
    proList: ['Everything in Free', '400 credits every month for cloud answers', 'Unlimited file transcription', 'Shared register'],
    agentList: ['Everything in Pro', '1,000 credits every month', 'Weekly recap emails', 'Series reports', 'Action follow-ups'],
    topUpTitle: 'Top up credits', creditRate: '1 credit = Rp100. Cloud answers cost what the model costs plus a margin; Local and Register-only answers cost 0.',
    noServerTitle: 'No server yet', noServerBody: 'Plans and credits need the account server, which is not built yet. Local and Register-only answers are free and work now.',
  },
  id: {
    meetings: 'Rapat', features: 'Fitur', today: 'Hari ini', live: 'Teks langsung', minutes: 'Notulen', history: 'Riwayat', notes: 'Catatan dan glosarium', glossary: 'Glosarium', all: 'Semua fitur', files: 'Berkas',
    addins: 'Add-in', island: 'Island', perf: 'Kinerja', settings: 'Pengaturan', helper: 'Helper',
    startCaptions: 'Mulai teks', thisDevice: 'Perangkat ini', allSeries: 'Semua seri', series: 'Seri rapat',
    notices: 'Pemberitahuan', noNotices: 'Tidak ada yang menunggu Anda.', openMenu: 'Buka menu', closeMenu: 'Tutup menu',
    morning: 'Selamat pagi.', afternoon: 'Selamat siang.', evening: 'Selamat malam.',
    todayLine: (d) => `Hari ini · ${d}`, hideNumbers: 'Sembunyikan angka', showNumbers: 'Tampilkan angka',
    captured: 'terekam hari ini', hm: (h, m) => (h ? `${h} j ${String(m).padStart(2, '0')} m` : `${m} m`),
    nMeetings: (n) => `${n} rapat hari ini`,
    itemsWeek: 'Butir minggu ini', moreThan: (n) => `${n} lebih banyak dari minggu lalu`, fewerThan: (n) => `${n} lebih sedikit dari minggu lalu`, sameAs: 'Sama dengan minggu lalu',
    whereWent: 'Sebarannya', owner: 'Pemilik', everyone: 'Semua orang',
    decision: 'Keputusan', action: 'Tindak lanjut', question: 'Pertanyaan terbuka', risk: 'Risiko', ofItems: (n, t) => `${n} dari ${t} butir`,
    overdue: (n) => `${n} lewat tenggat`, overdueFirst: (ref, due, more) => `${ref} jatuh tempo ${due}${more ? ` · ${more} lagi` : ''}`, noOverdue: 'Tidak ada yang lewat tenggat',
    ydayTitle: 'Notulen kemarin belum diterbitkan', ydayBody: 'Terbitkan supaya pemilik menerima tindak lanjutnya.', issueMinutes: 'Terbitkan notulen',
    todayCard: (n, hm) => `${n} rapat · ${hm}`, todayNone: 'Belum ada rapat hari ini.', checkIssue: 'Periksa, lalu terbitkan notulennya.',
    issued: 'Selesai', draft: 'Draf',
    helperLive: 'Aktif', helperOff: 'Mati', engine: 'Mesin', device: 'Perangkat', model: 'Model', nativeHelper: 'Native helper',
    helperPill: (d) => `Helper · ${d}`, helperPillOff: 'Helper mati', helperChecking: 'Memeriksa helper…',
    lockedHelper: 'Perlu helper', lockedHelperBody: 'Jalankan Native Helper untuk melihat mesin, perangkat dan model di sini.', openHelper: 'Buka Helper',
    lockedExt: 'Perlu ekstensi', lockedExtBody: 'Tangkap tab dan overlay halaman hanya berjalan di ekstensi Chrome. Di lab panel memutar sampel CC0.',
    noOverlay: 'Tidak ada overlay halaman di jendela ini', noOverlayBody: 'Tekan Mulai lalu bagikan tab, jendela, atau layar beserta audionya. Teks muncul di sini dan di pil island; overlay di halaman web butuh ekstensi Chrome.',
    loading: 'Membaca register…', errTitle: 'Register tidak terbaca.', errBody: (m) => `${m} Muat ulang halaman; bila tetap gagal, ekspor notulen dari halaman Notulen.`, reload: 'Muat ulang',
    emptyTitle: 'Belum ada rapat', emptyBody: 'Mulai teks di rapat, atau impor seri contoh dari Library di halaman Notulen.', openMinutes: 'Buka Notulen',
    welcomeTitle: 'Selamat datang di yravgSubMeetly', welcomeBody: 'Teks, terjemahan dan notulen tetap di perangkat ini. Mulai teks saat rapat dimulai; notulennya tersusun sendiri.', gotIt: 'Mengerti', setupTitle: 'Siapkan dalam tiga langkah', setupEngine: 'Engine berjalan', setupEngineFix: 'Nyalakan engine', setupAsr: 'Model suara di perangkat ini', setupAsrFix: 'Unduh satu', setupTest: 'Coba teks uji', setupTestGo: 'Mulai teks', setupDone: 'Siap', setupTodo: 'Belum', setupChecking: 'Memeriksa…',
    caughtUp: 'Semua beres: tidak ada yang lewat tenggat dan notulen kemarin sudah terbit.',
    registerStyle: 'Gaya', openRegister: 'Buka register', classic: 'Klasik ↗', openWindow: 'Buka jendela Notulen ↗', windowOpen: 'Jendela Notulen terbuka · Fokus',
    minutesHint: 'Klasik dan Modern adalah register yang sama; suntingan tampil di keduanya.', modern: 'Modern ↗',
    dev: 'Developer', devBanner: 'Nyala di lab. Mati di ekstensi kecuali Pengaturan › Developer dinyalakan.', devArea: 'Area developer', devAreaBody: 'Alat lab: halaman uji, mock helper, panduan, sampel CC0. Mati kecuali Anda membangun atau menguji ekstensi.',
    lockedLab: 'Perlu server lab', lockedLabBody: 'Area developer menampilkan lab lokal. Jalankan ./scripts/start-lab.sh, lalu muat ulang.',
    installed: 'Add-in terpasang', builtIn: 'Bawaan', open: 'Buka',
    fRecap: 'Email rekap', fRecapD: 'Susun rekap setelah tiap rapat.',
    fGlossary: 'Glosarium', fGlossaryD: 'Jaga nama dan istilah tetap benar.',
    fDue: 'Tenggat ke kalender', fDueD: 'Kirim tenggat ke kalender Anda.',
    islandOn: 'Nyala', islandOff: 'Mati', needsTrust: 'Tinjau dulu', featSwitch: (n) => `${n} nyala atau mati`, fIsland: 'Island', fIslandD: 'Teks dalam pil di bawah notch.',
    fPerf: 'Kinerja', fPerfD: 'Kecepatan dan mutu tiap mesin.',
    fLibrary: 'Library', fLibraryD: 'Transkrip contoh untuk mencoba.',
    fTraining: 'Training', fTrainingD: 'Tur singkat register.',
    fExport: 'Ekspor', fExportD: 'SRT, VTT, TXT, MD, CSV, JSON.',
    addinNote: 'Add-in menyala di daftar bawah setelah Anda meninjau dan mempercayainya.',
    lastSynced: (t) => `sinkron terakhir ${t}`, yours: (n) => `${n} milik Anda`, yourName: 'Nama Anda', nameHint: 'Tampil di sapaan dan sidebar. Tetap di perangkat ini.', save: 'Simpan', clear: 'Hapus', setName: 'Isi nama Anda', seriesSub: (n, chair) => `${n} rapat${chair ? ` · ketua ${chair}` : ''}`, noMeetings: 'Belum ada rapat',
    askTide: 'Tanya Tide…', askBar: 'Tanyakan rapat Anda ke Tide…', send: 'Kirim', chips: ['Ringkas rapat terakhir', 'Apa yang saya janjikan?', 'Tindak lanjut terbuka', 'Terjemahkan berkas'],
    plansSub: 'Gratis mencakup semuanya di komputer ini. Bayar hanya bila Anda ingin jawaban awan.', tagFree: 'Untuk mulai merekam', tagPro: 'Biarkan awan membantu saat Anda mau', tagAgent: 'Cukup minta, Tide menindaklanjuti', topUp: 'Isi ulang', nCredits: (n) => `${n} kredit`, bonus: (n) => `+${n}%`,
    plans: 'Paket', planFree: 'Gratis', planPro: 'Pro', planAgent: 'Agent', perMonth: '/ bulan', comingSoon: 'Segera hadir', current: 'Yang Anda pakai sekarang', beta: 'Beta',
    freeList: ['Tanya Tide tanpa batas dengan model lokal', 'Jawaban dari register', '50 kredit awal untuk jawaban awan (14 hari)', 'Teks, notulen, Island dan add-in'],
    proList: ['Semua di Gratis', '400 kredit tiap bulan untuk jawaban awan', 'Transkripsi berkas tanpa batas', 'Register bersama'],
    agentList: ['Semua di Pro', '1.000 kredit tiap bulan', 'Email rekap mingguan', 'Laporan seri', 'Tindak lanjut otomatis'],
    topUpTitle: 'Isi ulang kredit', creditRate: '1 kredit = Rp100. Jawaban awan dikenai biaya model ditambah margin; jawaban Lokal dan Hanya register 0 kredit.',
    noServerTitle: 'Belum ada server', noServerBody: 'Paket dan kredit butuh server akun, yang belum dibangun. Jawaban Lokal dan Hanya register gratis dan sudah berjalan.',
  },
};
const LANG = (new URLSearchParams(location.search).get('lang') || navigator.language || 'en').toLowerCase().startsWith('id') ? 'id' : 'en';
document.documentElement.lang = LANG;
const T = (k, ...a) => { const v = STR[LANG][k] ?? STR.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };

/* ---------- icons (garis 1,7, kisi 24) ---------- */
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  live: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7.5 11h3M13.5 11h3M7.5 14.5h5"/>',
  minutes: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9.5 12.5h6M9.5 16h6"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  files: '<path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  addins: '<path d="M10 4.5a2 2 0 1 1 4 0V7h3.5v3.5H20a2 2 0 1 1 0 4h-2.5V18H14v-2.5a2 2 0 1 0-4 0V18H6.5v-3.5H4a2 2 0 1 1 0-4h2.5V7H10z"/>',
  notes: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  island: '<rect x="3" y="8.5" width="18" height="7" rx="3.5"/><circle cx="8" cy="12" r="1.2"/>',
  perf: '<path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3 3.6M6.4 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>', up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>', flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 3.5 2 3.5h-11"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/>',
  bolt: '<path d="M13 3 5.5 14H11l-1 7 7.5-11H12z"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ext: '<path d="M8 16 16 8"/><path d="M9.5 8H16v6.5"/>', lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  dev: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5.5l-3 13"/>', mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4M5 14v5.5h14V14"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>', globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/>', list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
};
P.glossary = P.book;
P.updown = '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>';
const ic = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s) => document.querySelector(s);

/* ---------- routes ---------- */
const MEETING_ROUTES = ['today', 'live', 'minutes', 'history', 'files'];
const FEATURE_ROUTES = ['addins', 'glossary', 'island', 'perf', 'all', 'settings'];
const TILE_COUNT = 8; // tiles on All features (A06)
// Old links keep working. #glossary used to open meeting notes, where the Glossary add-in panel lives once trusted.
const ALIAS = { glossary: 'notes' }; // the notes panel (where the Glossary add-in lives) opens from the Glossary entry
// Halaman yang masih memasang panel samping: view (+ tab Pengaturan).
const PANEL = { live: ['captions'], history: ['history'], files: ['files'], addins: ['settings', 'addins'], notes: ['notes'], island: ['settings', 'output'], perf: ['perf'], settings: ['settings'], helper: ['helper'] };
const panelUrl = ([view, stab]) => `${HOSTED ? 'sidepanel.html' : '/panel-test.html'}?view=${view}${stab ? `&stab=${stab}` : ''}&lang=${LANG}`;

const state = { trusted: {}, removed: [], userName: '', syncedAt: '', setup: null, meetings: null, error: null, series: '', owner: '', health: undefined, hideNumbers: false, welcomed: true, minutesWin: false, register: 'modern', showPlans: false, developer: !HOSTED };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
};

/* ---------- formatters ---------- */
const fmtDate = (d) => new Intl.DateTimeFormat(LANG === 'id' ? 'id-ID' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
// Date (local) or 'YYYY-MM-DD'; never toISOString() — that is UTC and shows yesterday late in the evening east of Greenwich.
const fmtShort = (v) => new Intl.DateTimeFormat(LANG === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'short' }).format(typeof v === 'string' ? new Date(`${v}T00:00:00`) : v);
const hm = (min) => T('hm', Math.floor(min / 60), min % 60);
const num = (v) => `<span class="num" data-num>${esc(v)}</span>`;

/* ---------- Tide states (A09) ---------- */
const tide = (pose, cls = '') => `<img class="tide-art ${cls}" src="tide/tide-${pose}.webp" alt="" />`;
const stateCard = ({ pose, title, body, actions = '', cls = '' }) => `<div class="st ${cls}">${pose ? tide(pose, 'st-art') : ''}<h3>${esc(title)}</h3><p>${esc(body)}</p>${actions ? `<div class="st-act">${actions}</div>` : ''}</div>`;
const errorCard = (msg) => `<div class="callout danger" role="alert">${ic('info', 20)}<div><b>${esc(T('errTitle'))}</b><p>${esc(T('errBody', msg))}</p><button type="button" class="btn" data-act="reload">${esc(T('reload'))}</button></div></div>`;
const lockedCard = (title, body, action = '') => `<div class="callout locked">${ic('lock', 20)}<div><b>${esc(title)}</b><p>${esc(body)}</p>${action}</div></div>`;

/* ---------- sidebar ---------- */
function paintNav(route) {
  const item = (r) => { const on = r === route || (r === 'glossary' && route === 'notes'); const count = r === 'minutes' ? seriesMeetings()[0]?.items.length : r === 'all' ? TILE_COUNT : 0; return `<a href="#${r}" class="${on ? 'on' : ''}${r === 'dev' ? ' dv' : ''}"${on ? ' aria-current="page"' : ''} data-route="${r}" aria-label="${esc(T(r))}" title="${esc(T(r))}">${ic(r, 20)}<span class="hide-rail">${esc(T(r))}</span>${count ? `<span class="n hide-rail">${count}</span>` : r === 'dev' ? `<span class="n hide-rail">lab</span>` : ''}</a>`; };
  $('#nav-meetings').innerHTML = MEETING_ROUTES.map(item).join('');
  $('#nav-features').innerHTML = FEATURE_ROUTES.map(item).join('') + (state.developer ? item('dev') : '');
}

function paintSeries() {
  const sel = $('#series-select');
  const seen = new Map();
  for (const m of state.meetings || []) if (!seen.has(m.seriesId)) seen.set(m.seriesId, m.title);
  sel.innerHTML = `<option value="">${esc(T('allSeries'))}</option>${[...seen].map(([id, t]) => `<option value="${esc(id)}"${id === state.series ? ' selected' : ''}>${esc(t)}</option>`).join('')}`;
  sel.setAttribute('aria-label', T('series'));
  const label = state.series ? seen.get(state.series) || '' : T('allSeries');
  $('#series-av').textContent = label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // Baris kedua: jumlah rapat dan ketua rapat terbaru di seri itu (data register, bukan contoh).
  const inSeries = (state.series ? (state.meetings || []).filter((m) => m.seriesId === state.series) : state.meetings || []);
  const chair = [...inSeries].sort((a, b) => String(b.date).localeCompare(String(a.date))).find((m) => m.chair)?.chair || '';
  $('#series-name').textContent = label;
  $('#series-sub').textContent = inSeries.length ? T('seriesSub', inSeries.length, state.series ? chair : '') : T('noMeetings');
}

function paintHelper() {
  const h = state.health;
  const on = !!h;
  const dev = h?.device ? String(h.device).toUpperCase() : 'CPU';
  for (const el of [$('#helper-dot'), $('#foot-dot')]) el.className = `dot ${h === undefined ? 'wait' : on ? 'ok' : 'off'}`;
  $('#helper-pill-text').textContent = h === undefined ? T('helperChecking') : on ? T('helperPill', dev) : T('helperPillOff');
  $('#foot-helper').textContent = h === undefined ? T('helperChecking') : on ? `${T('helperPill', dev)} · ${T('lastSynced', state.syncedAt)}` : T('helperPillOff');
  paintUser();
}

/* ---------- theme (terang bawaan) + nama pengguna ---------- */
// Tema dibaca dari pengaturan yang sama dengan panel samping (chrome.storage.local.settings.theme):
// terang bawaan, gelap bila dipilih gelap, ikut sistem hanya bila "Auto" dipilih sendiri.
function applyTheme(settings) {
  const theme = migrateUiDefaults(settings).theme;
  const cl = document.documentElement.classList;
  cl.remove('theme-light', 'theme-dark');
  if (theme === 'light') cl.add('theme-light'); else if (theme === 'dark') cl.add('theme-dark');
}
const initials = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function paintUser() {
  const n = state.userName;
  $('#foot-av').textContent = n ? initials(n) : '?';
  $('#foot-av').setAttribute('aria-label', n || T('setName'));
  $('#foot-name').textContent = n || T('setName');
}
function toggleNamePop(force) {
  const pop = $('#name-pop');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  $('#foot-av').setAttribute('aria-expanded', String(open));
  if (!open) return;
  pop.setAttribute('aria-label', T('yourName'));
  pop.innerHTML = `<h3>${esc(T('yourName'))}</h3><input type="text" data-act="name-input" maxlength="40" value="${esc(state.userName)}" aria-label="${esc(T('yourName'))}" /><p class="mut">${esc(T('nameHint'))}</p><div class="row"><button type="button" class="btn sm" data-act="name-clear">${esc(T('clear'))}</button><button type="button" class="pill-b sm" data-act="name-save">${esc(T('save'))}</button></div>`;
  const r = $('#foot-av').getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 296))}px`;
  pop.style.bottom = `${innerHeight - r.top + 8}px`;
  pop.style.top = 'auto';
  pop.querySelector('input').focus();
}
function saveName(v) {
  state.userName = String(v || '').trim().slice(0, 40);
  globalThis.chrome?.storage?.local.set({ ysmUserName: state.userName });
  paintUser();
  toggleNamePop(false);
  if (parseHash().route === 'today') { lastRoute = null; render(); }
}

/* ---------- notices (bell) ---------- */
function notices() {
  const out = [];
  if (!state.meetings) return out;
  const t = computeToday(seriesMeetings());
  if (t.yesterdayOpen) out.push({ icon: 'minutes', text: T('ydayTitle'), href: `#minutes?meeting=${encodeURIComponent(t.yesterdayOpen.id)}` });
  if (t.overdue.count) out.push({ icon: 'cal', text: T('overdue', t.overdue.count), href: '#minutes', danger: true });
  if (state.health === null) out.push({ icon: 'bolt', text: T('helperPillOff'), href: '#helper' });
  return out;
}
function paintBell() {
  const n = notices().length;
  $('#btn-bell').innerHTML = `${ic('bell', 20)}${n ? `<span class="badge">${n}</span>` : ''}`;
  $('#btn-bell').setAttribute('aria-label', `${T('notices')}${n ? ` (${n})` : ''}`);
}
function toggleBell(force) {
  const pop = $('#bell-pop');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  $('#btn-bell').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const list = notices();
  pop.setAttribute('aria-label', T('notices'));
  pop.innerHTML = `<h3>${esc(T('notices'))}</h3>${list.length ? list.map((x) => `<a class="nt${x.danger ? ' danger' : ''}" href="${x.href}">${ic(x.icon, 18)}<span>${esc(x.text)}</span></a>`).join('') : `<p class="mut">${esc(T('noNotices'))}</p>`}`;
  const r = $('#btn-bell').getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, innerWidth - 300)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  pop.querySelector('a, p')?.focus?.();
}

/* ---------- Today (A01) ---------- */
// Seri tak punya judul sendiri: judul rapat terbarunya. Baris rapat hanya menyebutnya bila ada lebih dari satu seri.
const seriesLabel = (id) => ((state.meetings || []).filter((m) => m.seriesId === id).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.title) || '';
const multiSeries = () => new Set((state.meetings || []).map((m) => m.seriesId)).size > 1;
const seriesMeetings = () => (state.series ? state.meetings.filter((m) => m.seriesId === state.series) : state.meetings) || [];

// First-run checklist: engine and speech model are read from the engine (GET /models); the test caption is the one action left.
function setupList() {
  const h = state.health; const asr = state.setup?.asr;
  const row = (label, ok, fix, href) => `<li class="${ok ? 'ok' : ''}"><span class="dot ${ok ? 'ok' : ok === null ? 'wait' : 'off'}" aria-hidden="true"></span><span class="grow">${esc(label)}</span>${ok ? `<span class="mut small">${esc(T('setupDone'))}</span>` : ok === null ? `<span class="mut small">${esc(T('setupChecking'))}</span>` : `<a href="${href}">${esc(fix)}</a>`}</li>`;
  return `<ol class="setup" aria-label="${esc(T('setupTitle'))}">${row(T('setupEngine'), h === undefined ? null : !!h, T('setupEngineFix'), '#helper')}${state.setup && asr === null && h ? '' : row(T('setupAsr'), !h ? (h === undefined ? null : false) : asr === undefined ? null : asr, T('setupAsrFix'), '#settings?stab=models')}<li><span class="dot wait" aria-hidden="true"></span><span class="grow">${esc(T('setupTest'))}</span><a href="#live" data-start>${esc(T('setupTestGo'))}</a></li></ol>`;
}

function todayPage() {
  if (state.error) return errorCard(state.error);
  if (!state.meetings) return stateCard({ pose: 'compass', title: T('loading'), body: '', cls: 'loading' });
  const now = new Date();
  const t = computeToday(seriesMeetings(), { now, owner: state.owner || null, me: state.userName });
  const welcome = !state.welcomed;
  const caughtUp = !t.empty && !t.yesterdayOpen && !t.overdue.count;
  // Satu maskot per layar, di bilah tanya: sambutan (wave) > kosong (sleep) > beres (celebrate) > biasa (shell).
  const pose = heroPose({ welcome, empty: t.empty, caughtUp });
  const eye = `<button type="button" class="icon-b eye" data-act="eye" aria-pressed="${state.hideNumbers}" aria-label="${esc(T(state.hideNumbers ? 'showNumbers' : 'hideNumbers'))}" title="${esc(T(state.hideNumbers ? 'showNumbers' : 'hideNumbers'))}">${ic(state.hideNumbers ? 'eyeOff' : 'eye', 18)}</button>`;
  const hero = heroHtml({ T, ic, esc, tide, num, hm, fmtDate, now, t, state, greetKey: greetingKey(now), pose, caughtUp, eye, synced: state.syncedAt });
  // Sambutan dan kosong tidak menggantikan hero: kartu ringkas di bawahnya.
  const band = welcome ? stateCard({ title: T('welcomeTitle'), body: T('welcomeBody'), actions: `<button type="button" class="pill-b" data-act="welcomed">${esc(T('gotIt'))}</button>`, cls: 'band' }).replace('</p>', `</p>${setupList()}`)
    : t.empty ? stateCard({ title: T('emptyTitle'), body: T('emptyBody'), actions: `<a class="pill-b" href="#live" data-start>${ic('play', 16)}${esc(T('startCaptions'))}</a><a class="btn" href="#minutes">${esc(T('openMinutes'))}</a>`, cls: 'band' }) : '';

  const total = t.week.items;
  const types = [['decision', 'check'], ['action', 'flag'], ['question', 'chat'], ['risk', 'bolt']];
  const delta = t.week.delta > 0 ? `<div class="delta up">${ic('up', 16)}${esc(T('moreThan', t.week.delta))}</div>`
    : t.week.delta < 0 ? `<div class="delta down">${ic('down', 16)}${esc(T('fewerThan', -t.week.delta))}</div>` : `<div class="delta">${esc(T('sameAs'))}</div>`;
  const ownerSel = `<label class="sel">${esc(T('owner'))}: <select data-act="owner"><option value="">${esc(T('everyone'))}</option>${t.week.owners.map((o) => `<option${o === state.owner ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  const filtered = types.reduce((s, [k]) => s + t.week.byType[k], 0) || 1;
  const barColor = { decision: 'var(--tide-emerald)', action: 'var(--text)', question: TYPE_COLOR.question, risk: TYPE_COLOR.risk };
  const yours = state.userName ? t.week.yoursAction : 0;
  const bars = types.map(([k, icn]) => `<div class="brow"><span class="tl ${k}">${ic(icn, 18)}</span><span class="nm">${esc(T(k))}<small>${esc(T('ofItems', t.week.byType[k], total))}${k === 'action' && yours ? ` · ${esc(T('yours', yours))}` : ''}</small></span><span class="v">${num(t.week.byType[k])}</span><span class="bar"><i style="width:${Math.round((t.week.byType[k] / filtered) * 100)}%;--c:${barColor[k]}"></i></span></div>`).join('');
  const over = t.overdue.count
    ? `<a class="over" href="#minutes?meeting=${encodeURIComponent(t.overdue.first.meetingId)}">${ic('cal', 20)}<span class="o-main">${esc(T('overdue', t.overdue.count))}</span><small>${esc(T('overdueFirst', t.overdue.first.ref, fmtShort(t.overdue.first.due), t.overdue.count - 1))}</small></a>`
    : `<div class="over ok">${ic('check', 20)}<span class="o-main">${esc(T('noOverdue'))}</span></div>`;
  const week = `<section class="cd week"><div class="wih">${esc(T('itemsWeek'))}</div><div class="kpi">${num(total)}</div>${delta}
    <div class="wih row"><span>${esc(T('whereWent'))}</span><span class="grow"></span>${ownerSel}</div><div class="bars">${bars}</div>${over}</section>`;

  const ydayCard = t.yesterdayOpen ? `<section class="cd rail1"><span class="eyebrow">${esc(fmtShort(t.yesterdayOpen.date))} · ${esc(t.yesterdayOpen.title)}</span><h3>${esc(T('ydayTitle'))}</h3><p>${esc(T('ydayBody'))}</p><a class="pill-b full" href="#minutes?meeting=${encodeURIComponent(t.yesterdayOpen.id)}">${esc(T('issueMinutes'))}</a></section>` : '';
  const rows = t.meetingsToday.map((m) => `<a class="mrow" href="#minutes?meeting=${encodeURIComponent(m.id)}"><span class="t">${esc(m.start || '—')}</span><span><b>${esc(m.title)}</b><small>${esc([multiSeries() ? seriesLabel(m.seriesId) : '', hm(m.minutes)].filter(Boolean).join(' · '))}</small></span><span class="chip sm ${m.status === 'issued' ? 'ok' : 'warn'}">${esc(T(m.status))}</span></a>`).join('');
  const todayCard = `<section class="cd"><span class="eyebrow">${esc(T('today'))} · ${esc(fmtShort(now))}</span><h3>${t.meetingsToday.length ? esc(T('todayCard', t.meetingsToday.length, hm(t.minutesToday))) : esc(T('todayNone'))}</h3>${rows}${t.meetingsToday.some((m) => m.status === 'draft') ? `<small class="mut">${esc(T('checkIssue'))}</small>` : ''}</section>`;
  const h = state.health;
  const helperCard = h ? `<section class="cd"><div class="row"><h3>${esc(T('helper'))}</h3><span class="grow"></span><span class="chip sm ok"><span class="dot ok"></span>${esc(T('helperLive'))}</span></div>
      <div class="kv"><span>${esc(T('engine'))}</span><b>${esc(h.engine_label || h.engine || T('nativeHelper'))}</b></div><div class="kv"><span>${esc(T('device'))}</span><b>${esc(String(h.device || 'cpu').toUpperCase())}</b></div><div class="kv"><span>${esc(T('model'))}</span><b>${esc(h.model || '—')}</b></div></section>`
    : h === null ? `<section class="cd">${lockedCard(T('lockedHelper'), T('lockedHelperBody'), `<a class="btn" href="#helper">${esc(T('openHelper'))}</a>`)}</section>` : '';
  return `${hero}${band}<div class="cols">${week}<div class="rail">${ydayCard}${todayCard}${helperCard}</div></div>`;
}

/* ---------- Minutes (A04) ---------- */
// embed: the iframe follows the shell's light/dark scheme (minutes-dock.js reads follow=system); a window of its own keeps its stored theme.
const registerSrc = (kind, meeting, embed) => `minutes.html?lang=${LANG}${kind === 'modern' ? '&skin=tide' : ''}${embed ? '&follow=system' : ''}${meeting ? `&meeting=${encodeURIComponent(meeting)}` : ''}`;
function minutesPage(params) {
  if (state.error) return errorCard(state.error);
  return minutesHtml({ lang: LANG, esc, ic, tide, meetings: state.meetings, series: state.series, register: state.register, me: state.userName, meetingParam: params.get('meeting'), registerSrc: (kind, x = {}) => `${registerSrc(kind, x.meeting)}${x.do ? `&do=${x.do}` : ''}${x.view ? `&view=${x.view}` : ''}` });
}

/* ---------- Add-ins + all features (A06) ---------- */
function addinsPage() {
  const tile = (icn, name, desc, right) => `<div class="cd tile2"><span class="tl">${ic(icn, 20)}</span><b>${esc(name)}</b><p>${esc(desc)}</p><div class="ft">${right}</div></div>`;
  const open = (href) => `<span class="grow"></span><a class="btn sm" href="${href}">${esc(T('open'))}</a>`;
  const builtIn = (href) => `<span class="mut small">${esc(T('builtIn'))}</span>${open(href)}`;
  // Sakelar nyata: Island = captionSurface (sama dengan bilah atas); add-in = sudah dipercaya (ysmAddinTrust). Menyalakan add-in
  // yang belum dipercaya membuka tinjauan manifest; add-in tak boleh jalan sebelum ditinjau.
  const sw = (id, on, name, label) => `<label class="sw-chip bare"><input type="checkbox" role="switch" data-act="feat" data-feat="${id}"${on ? ' checked' : ''} aria-label="${esc(T('featSwitch', name))}" /></label><span class="mut small" data-feat-state="${id}">${esc(label ?? T(on ? 'islandOn' : 'islandOff'))}</span>`;
  const addin = (id, name) => { const on = !!state.trusted[id] && !state.removed.includes(id); return sw(id, on, name) + open('#addins'); };
  const islandOn = $('#island-switch').checked;
  return `<div class="tiles">
    ${tile('mail', T('fRecap'), T('fRecapD'), addin('recap-email', T('fRecap')))}
    ${tile('book', T('fGlossary'), T('fGlossaryD'), addin('glossary', T('fGlossary')))}
    ${tile('cal', T('fDue'), T('fDueD'), addin('due-to-calendar', T('fDue')))}
    ${tile('island', T('fIsland'), T('fIslandD'), sw('island', islandOn, T('fIsland')) + open('#island'))}
    ${tile('perf', T('fPerf'), T('fPerfD'), builtIn('#perf'))}
    ${tile('book', T('fLibrary'), T('fLibraryD'), builtIn('#minutes'))}
    ${tile('sparkle', T('fTraining'), T('fTrainingD'), builtIn('#minutes'))}
    ${tile('export', T('fExport'), T('fExportD'), builtIn('#history'))}
  </div>
  <section class="addins-sec" id="addins-pane"><h2>${esc(T('installed'))}</h2><p class="mut">${esc(T('addinNote'))}</p>
  <iframe class="frame panel" title="${esc(T('installed'))}" src="${esc(panelUrl(PANEL.addins))}"></iframe></section>`;
}

/* ---------- Developer (A08) ---------- */
function devPage() {
  // Lab: lab yang sudah ada (test/app.html) — setiap alat lab tetap di tempatnya.
  const src = HOSTED ? 'http://127.0.0.1:8799/app.html' : '/app.html';
  return `<div class="callout warn">${ic('dev', 20)}<div><b>${esc(T('devArea'))}.</b> ${esc(T('devBanner'))}</div></div>${HOSTED ? lockedCard(T('lockedLab'), T('lockedLabBody')) : ''}<iframe class="frame panel dev" title="${esc(T('devArea'))}" src="${src}"></iframe>`;
}

/* ---------- Plans (A10): belum ada server akun ---------- */
function plansPage() {
  const card = (name, price, tag, list, cur) => `<div class="cd plan${cur ? ' cur' : ''}"><b>${esc(name)}</b><div class="price"><span>${esc(price)}</span><small>${esc(T('perMonth'))}</small></div><p class="mut">${esc(tag)}</p>
    <ul>${list.map((x, i) => `<li>${ic('check', 16)}<span>${esc(x)}${name === T('planAgent') && i === list.length - 1 ? ` <em class="chip sm">${esc(T('beta'))}</em>` : ''}</span></li>`).join('')}</ul>
    <button type="button" class="${cur ? 'btn' : 'pill-b'} full" disabled>${esc(cur ? T('current') : T('comingSoon'))}</button></div>`;
  const packs = [[25000, 250], [50000, 525], [100000, 1100], [250000, 2750]];
  const rp = (n) => new Intl.NumberFormat('id-ID').format(n);
  // Bonus terhadap tarif dasar 1 kredit = Rp100; tombol mati sampai server akun ada.
  const pack = ([p, c]) => { const bonus = Math.round((c / (p / 100) - 1) * 100); return `<div class="pack"><b>Rp${rp(p)}</b><small>${esc(T('nCredits', rp(c)))}</small>${bonus ? `<em class="chip sm ok">${esc(T('bonus', bonus))}</em>` : '<em class="gap"></em>'}<button type="button" class="btn sm full" disabled>${esc(T('topUp'))}</button></div>`; };
  return `<p class="mut plans-sub">${esc(T('plansSub'))}</p>${lockedCard(T('noServerTitle'), T('noServerBody'))}
    <div class="plans">${card(T('planFree'), '$0.00', T('tagFree'), T('freeList'), true)}${card(T('planPro'), '$4.99', T('tagPro'), T('proList'))}${card(T('planAgent'), '$9.99', T('tagAgent'), T('agentList'))}</div>
    <section class="cd"><div class="row"><h3>${esc(T('topUpTitle'))}</h3><span class="grow"></span><small class="mut">${esc(T('creditRate'))}</small></div><div class="packs">${packs.map(pack).join('')}</div></section>`;
}

/* ---------- Settings: Developer switch (extension) ---------- */
function settingsPage(params) {
  const sw = HOSTED ? `<div class="cd devsw"><div><b>${esc(T('devArea'))}</b><p class="mut">${esc(T('devAreaBody'))}</p></div><label class="sw-chip bare"><input type="checkbox" role="switch" data-act="dev"${state.developer ? ' checked' : ''} aria-label="${esc(T('devArea'))}" /></label></div>` : '';
  return `${sw}<iframe class="frame panel" title="${esc(T('settings'))}" src="${esc(panelUrl(params?.get('stab') ? ['settings', params.get('stab').replace(/[^a-z]/g, '')] : PANEL.settings))}"></iframe>`;
}

/* ---------- panel-backed pages ---------- */
function panelPage(route) {
  const lock = route !== 'live' || IS_EXT ? '' : WEB ? lockedCard(T('noOverlay'), T('noOverlayBody')) : lockedCard(T('lockedExt'), T('lockedExtBody'));
  return `${lock}<iframe class="frame panel" title="${esc(T(route))}" src="${esc(panelUrl(PANEL[route]))}"></iframe>`;
}

/* ---------- router ---------- */
function parseHash() {
  const [r0, q] = location.hash.replace(/^#/, '').split('?');
  const r = ALIAS[r0] || r0;
  const route = [...MEETING_ROUTES, ...FEATURE_ROUTES, 'notes', 'helper', ...(state.showPlans ? ['plans'] : []), ...(state.developer ? ['dev'] : [])].includes(r) ? r : 'today';
  return { route, params: new URLSearchParams(q || '') };
}

let lastRoute = null;
function render() {
  const { route, params } = parseHash();
  document.title = `${T(route)} · yravgSubMeetly`;
  $('#page-title').textContent = T(route);
  paintNav(route);
  paintBell();
  const page = $('#page');
  page.dataset.route = route;
  // Bingkai panel tidak dimuat ulang saat hanya data beranda yang berubah.
  if (route === lastRoute && !['today', 'minutes', 'all', 'plans'].includes(route)) return;
  lastRoute = route;
  page.innerHTML = route === 'today' ? todayPage() : route === 'minutes' ? minutesPage(params) : route === 'all' ? addinsPage() : route === 'dev' ? devPage() : route === 'settings' ? settingsPage(params) : route === 'plans' ? plansPage() : panelPage(route);
  }

/* ---------- start captions (one action everywhere: sidebar, Today, ⇧S) ---------- */
// Opens Live, then presses the panel's own Start button (same origin, so its document is reachable).
// shortcut: a freshly loaded panel has no user activation, so tab/screen sharing may ask for a second press; keep Live mounted to remove that.
async function startCaptions() {
  if (parseHash().route !== 'live') location.hash = '#live';
  for (let i = 0; i < 60; i++) {
    const doc = document.querySelector('#page[data-route="live"] iframe.panel')?.contentDocument;
    const btn = doc?.getElementById('btn-start');
    if (btn && !btn.disabled && doc.readyState === 'complete') {
      const before = doc.getElementById('status-text')?.textContent || '';
      btn.click();
      await new Promise((r) => setTimeout(r, 700));
      // The panel may not have attached its handler yet; a click that changed nothing is repeated.
      // A changed status line (an error, a share prompt) means the click landed: never click again then.
      if (btn.disabled || (doc.getElementById('status-text')?.textContent || '') !== before) return;
      continue;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/* ---------- events ---------- */
function setSheet(open) {
  $('#app').classList.toggle('sheet-open', open);
  $('#scrim').hidden = !open;
  $('#btn-menu').setAttribute('aria-expanded', String(open));
}

async function onFeatureSwitch(box) {
  const id = box.dataset.feat;
  if (id === 'island') { $('#island-switch').click(); return; }
  if (box.checked) { box.checked = false; location.hash = '#addins'; return; } // enabling needs the manifest review
  const got = await globalThis.chrome?.storage?.local.get('ysmAddinTrust');
  const trusted = { ...(got?.ysmAddinTrust || {}) };
  delete trusted[id];
  await globalThis.chrome?.storage?.local.set({ ysmAddinTrust: trusted });
}

function wire() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t);
  for (const el of document.querySelectorAll('.ic-slot')) el.innerHTML = ic(el.dataset.ic, 18);
  $('#btn-menu').innerHTML = ic('menu', 22);
  $('#btn-menu').setAttribute('aria-label', T('openMenu'));
  $('#btn-sb-close').innerHTML = ic('x', 20);
  $('#btn-sb-close').setAttribute('aria-label', T('closeMenu'));
  $('#island-switch').setAttribute('aria-label', T('island'));
  $('#ask-field').innerHTML = `${ic('sparkle', 18)}<span class="hide-rail">${esc(T('askTide'))}</span><kbd class="hide-rail">/</kbd>`;
  $('#ask-field').setAttribute('aria-label', T('askTide'));
  $('#plans-link').textContent = T('plans');
  $('#plans-link').style.display = state.showPlans ? '' : 'none';
  $('#btn-start').setAttribute('aria-label', `${T('startCaptions')} (Shift+S)`);
  $('#btn-start').title = `${T('startCaptions')} (⇧S)`;

  window.addEventListener('hashchange', () => { setSheet(false); toggleBell(false); render(); $('#page').focus({ preventScroll: true }); });
  $('#btn-bell').addEventListener('click', (e) => { e.stopPropagation(); toggleBell(); });
  for (const id of ['#foot-av', '#foot-who']) $(id).addEventListener('click', (e) => { e.stopPropagation(); toggleNamePop(); });
  $('#name-pop').addEventListener('click', (e) => {
    e.stopPropagation();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'name-save') saveName($('#name-pop input').value); else if (act === 'name-clear') saveName('');
  });
  $('#name-pop').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveName($('#name-pop input').value); } });
  document.addEventListener('click', (e) => { if (!$('#name-pop').hidden && !e.target.closest('#name-pop')) toggleNamePop(false); });
  document.addEventListener('click', (e) => { if (!$('#bell-pop').hidden && !e.target.closest('#bell-pop')) toggleBell(false); });
  $('#btn-menu').addEventListener('click', () => setSheet(true));
  $('#btn-sb-close').addEventListener('click', () => setSheet(false));
  $('#scrim').addEventListener('click', () => setSheet(false));
  $('#series-select').addEventListener('change', (e) => { state.series = e.target.value; state.owner = ''; store.set('ysmShellSeries', state.series); paintSeries(); lastRoute = null; render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { toggleBell(false); toggleNamePop(false); setSheet(false); }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (!typing && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); startCaptions(); }
    if (!typing && e.key === '/' && !e.metaKey && !e.ctrlKey && $('.ask-ov')?.hidden !== false) { e.preventDefault(); ask.open(); }
  });
  $('#page').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'eye') { state.hideNumbers = !state.hideNumbers; store.set('ysmShellHideNumbers', state.hideNumbers); lastRoute = null; render(); }
    else if (act === 'welcomed') { state.welcomed = true; store.set('ysmShellWelcomed', true); lastRoute = null; render(); }
    else if (act === 'reload') location.reload();
    else if (act === 'chip') ask.open(T('chips')[Number(e.target.closest('[data-act]').dataset.i)]);
    else if (act === 'askgo') { const q = $('[data-act="askbar"]').value; ask.open(q.trim() || undefined); }
    else if (act === 'win') { await openMinutesWindow(globalThis.chrome, registerSrc(state.register)); refreshWin(); }
    else if (e.target.closest('[data-register]')) {
      state.register = e.target.closest('[data-register]').dataset.register; store.set('ysmShellRegister', state.register);
      // Classic opens as the Minutes window (A04c); Modern as its own tab.
      if (state.register === 'classic') { e.preventDefault(); await openMinutesWindow(globalThis.chrome, e.target.closest('a').getAttribute('href')); refreshWin(); }
      lastRoute = null; render();
    }
  });
  document.addEventListener('click', (e) => { for (const d of document.querySelectorAll('.reg-menu[open]')) if (!d.contains(e.target)) d.open = false; });
  $('#page').addEventListener('change', (e) => {
    if (e.target.matches('[data-act="owner"]')) { state.owner = e.target.value; lastRoute = null; render(); }
    else if (e.target.matches('[data-act="feat"]')) onFeatureSwitch(e.target);
    else if (e.target.matches('[data-act="dev"]')) { state.developer = e.target.checked; globalThis.chrome?.storage?.local.set({ ysmDeveloper: state.developer }); paintNav(parseHash().route); }
  });
  $('#page').addEventListener('keydown', (e) => {
    if (e.target.matches('[data-act="askbar"]') && e.key === 'Enter') { e.preventDefault(); ask.open(e.target.value.trim() || undefined); }
  });
  $('#ask-field').addEventListener('click', () => ask.open());
  document.addEventListener('click', (e) => { const a = e.target.closest('#btn-start, [data-start]'); if (a) { e.preventDefault(); startCaptions(); } });
  $('#island-switch').addEventListener('change', (e) => {
    // The Windows window has no page overlay, so on means the island alone; in the extension it means beside the overlay.
    globalThis.chrome?.storage?.local.set({ captionSurface: e.target.checked ? (WEB ? 'island' : 'both') : 'overlay' });
    paintIslandState();
  });
}

async function refreshWin() {
  const open = await isMinutesWindowOpen(globalThis.chrome).catch(() => false);
  if (open !== state.minutesWin) { state.minutesWin = open; render(); }
}

async function loadTrust() {
  const got = (await globalThis.chrome?.storage?.local.get(['ysmAddinTrust', 'ysmAddinRemoved'])) || {};
  state.trusted = got.ysmAddinTrust && typeof got.ysmAddinTrust === 'object' ? got.ysmAddinTrust : {};
  state.removed = Array.isArray(got.ysmAddinRemoved) ? got.ysmAddinRemoved : [];
}

async function loadRegister() {
  try {
    state.meetings = await listMeetings();
    state.error = null;
  } catch (err) {
    state.error = String(err?.message || err);
  }
  paintSeries();
  // Hanya Today yang digambar ulang dari data; halaman berbingkai (register, panel)
  // tidak boleh dimuat ulang saat register berubah dari dalam bingkainya sendiri.
  if (parseHash().route === 'today') lastRoute = null;
  render();
}

async function pollHelper() {
  // Windows window: the engine that served this page is the helper (it may not be on 17865).
  const origin = WEB ? location.origin : LOCAL_HELPER_ORIGIN;
  state.health = await nativeHealth(origin);
  if (state.health) state.syncedAt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  if (!state.welcomed) { const m = state.health ? await nativeGetModels(origin) : null; state.setup = { asr: Array.isArray(m?.catalog) ? m.catalog.some((x) => x.kind === 'asr' && x.downloaded) : null }; }
  paintHelper();
  paintBell();
  if (parseHash().route === 'today') { lastRoute = null; render(); }
}

function paintIslandState() {
  const on = $('#island-switch').checked;
  const box = document.querySelector('[data-feat="island"]');
  if (box) box.checked = on;
  const lab = document.querySelector('[data-feat-state="island"]');
  if (lab) lab.textContent = T(on ? 'islandOn' : 'islandOff');
}
async function syncIsland() {
  let { captionSurface } = (await globalThis.chrome?.storage?.local.get('captionSurface')) || {};
  // Windows window: no page overlay exists, so an unset surface starts on the island (the panel reads the same key).
  if (captionSurface == null && WEB) { captionSurface = 'island'; globalThis.chrome?.storage?.local.set({ captionSurface }); }
  $('#island-switch').checked = captionSurface === 'island' || captionSurface === 'both';
  paintIslandState();
}

let ask = null;
async function boot() {
  // Lab: chrome-mock.js (localStorage, nama kunci sama) memberi chrome.storage dan mock helper.
  if (!IS_EXT && !globalThis.chrome?.storage) {
    await new Promise((res) => { const s = document.createElement('script'); s.src = '/chrome-mock.js'; s.onload = res; s.onerror = res; document.head.append(s); });
  }
  state.series = store.get('ysmShellSeries', '');
  state.hideNumbers = store.get('ysmShellHideNumbers', false);
  state.welcomed = store.get('ysmShellWelcomed', false);
  // Plans have no server behind them yet: the page, the sidebar link and the Ask Tide credits chip stay in the code, off until this flag is set.
  state.showPlans = store.get('ysmShowPlans', false) === true;
  state.register = store.get('ysmShellRegister', 'modern') === 'classic' ? 'classic' : 'modern';
  if (HOSTED) state.developer = !!(await globalThis.chrome?.storage?.local.get('ysmDeveloper'))?.ysmDeveloper;
  const stored = (await globalThis.chrome?.storage?.local.get(['settings', 'ysmUserName'])) || {};
  state.userName = String(stored.ysmUserName || '').trim();
  await loadTrust();
  applyTheme(stored.settings);
  ask = mountAskTide({ lang: LANG, showCredits: state.showPlans, getMeetings: async () => state.meetings || listMeetings(), onSaved: () => loadRegister() });
  wire();
  mountMinutes($('#page'), { lang: LANG, getMe: () => state.userName, setMe: (n) => saveName(n), rerender: () => { lastRoute = null; render(); }, reload: () => loadRegister(), registerSrc: (kind, x = {}) => `${registerSrc(kind, x.meeting)}${x.do ? `&do=${x.do}` : ''}${x.view ? `&view=${x.view}` : ''}`, getRegister: () => state.register, openRegister: (url) => window.open(url, '_blank') });
  paintHelper();
  render();
  await syncIsland();
  globalThis.chrome?.storage?.onChanged?.addListener((ch) => {
    if ('captionSurface' in ch) syncIsland();
    if ('settings' in ch) applyTheme(ch.settings.newValue);
    if ('ysmAddinTrust' in ch || 'ysmAddinRemoved' in ch) loadTrust().then(() => { if (parseHash().route === 'all') { lastRoute = null; render(); } });
    if ('ysmUserName' in ch) { state.userName = String(ch.ysmUserName.newValue || ''); paintUser(); if (parseHash().route === 'today') { lastRoute = null; render(); } }
    if (WIN_ID_KEY in ch) refreshWin();
  });
  window.addEventListener('storage', (e) => { if (e.key === 'minutesRegister') loadRegister(); });
  await loadRegister();
  refreshWin();
  pollHelper();
  setInterval(pollHelper, 15000);
}

boot();
