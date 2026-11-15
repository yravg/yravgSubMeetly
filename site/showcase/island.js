/* The app's top-of-screen pill, replicated for the web: plain JavaScript,
   no build step, no libraries. window.SMIsland.mount(el, opts) draws it
   into `el` (with island.css loaded) and returns a controller:

     const c = SMIsland.mount(el, { os: 'mac' | 'win', lang: 'en' | 'id',
                                    idle: 'clock' | 'kasi', reducedMotion });
     c.play(); c.pause(); c.go('minutes'); c.setOS('mac'); c.setLang('id'); c.destroy();

   Everything is laid out in DIPs, the unit the desktop app draws in, and the
   values come from its Rust code (island/crates/poni/src): pill/idle.rs,
   pill/live.rs, pill/expanded.rs, pill/motion.rs, island.rs, pages/*.rs,
   ui.rs, icons.rs. --isl-scale on the root maps DIPs to CSS px. Where the
   reviewed demo (docs/design/island-demo) and the app differ, the app wins;
   the demo's hover ring is still there as an option (opts.ring). */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var W = window;
  var D = document;

  // ------------------------------------------------------------ geometry
  var TOP_GAP = 8; //            pill/mod.rs TOP_GAP
  var PILL_H = 32; //            pill/idle.rs H
  var CAP_W = 300; //            pill/live.rs CAPTION_W
  var CAP_H2 = 52; //            ... CAPTION_TWO_H, radius 22
  var CAP_R2 = 22;
  var CARD_W = 620; //           Settings::expanded_width
  var CARD_R = 40; //            pill/expanded.rs RADIUS
  var HEADER_H = 50; //          pages/mod.rs
  var PAD = 18;
  var TAB_H = 28;
  var TAB_W = 30;
  var MIN_TAB_W = 22;
  var TAB_GAP = 2;
  var TAB_ICON = 16;
  var TAB_LABEL_X = 28;
  var TAB_LABEL_END = 12;
  var DATE_GAP = 12;
  var PIN_GAP = 10;
  var PIN = 28;
  var MENU_SLOT = 32; //         pages/menu.rs SLOT
  var TAB_INSET = 4; //          pill/expanded.rs
  var TIP_H = 22;
  var PILL_SMALL = 28; //        ui.rs
  var PILL_GAP = 8;
  var GUIDE_H = 26; //           pages/hkit.rs
  var HOVER_OUTSET = 3; //       pill/motion.rs
  var HOVER_SINK = 1;
  var HIT_MARGIN = 11; //        island.rs
  var OUTGOING_FADE = 0.14; //   app.rs
  var PAGE_SWITCH = 0.26;
  var CONTENT_SCALE_FROM = 0.94;
  var CONTENT_DROP = 2; //       pill/motion.rs CONTENT_DROP
  var GHOST_MIN_SCALE = 0.6;
  var FADE_DELAY_GROW = 0.03; // island.rs
  var FADE_DELAY_SHRINK = 0.05;
  // Springs (stiffness, damping) while the island floats: pill/motion.rs.
  var SP = {
    GROW_W: [500, 32.5],
    GROW_H: [250, 23],
    SHRINK_W: [400, 36],
    SHRINK_H: [560, 43],
    R_GROW: [1200, 69.3],
    R_SHRINK: [150, 24.5],
    TOP: [300, 34.6],
    CONTENT: [700, 52.9]
  };

  // Page heights (content only; the card adds HEADER_H + PAD).
  var LIVE_BASE = 168; //        pages/live.rs HEIGHT
  var LIVE_CARD = 23; //         CARD_H 20 + CARD_GAP 3
  var MINUTES_H = 30 + 4 + 5 * 36 + 28 + GUIDE_H; // pages/meeting.rs
  var INBOX_H = 26 + 4 + 5 * 36 + 28 + GUIDE_H; //   pages/inbox.rs
  var TODAY_H = 250; //          pages/calendar.rs
  var MEDIA_H = 148; //          pill/music.rs H_SESSION

  // ------------------------------------------------------------ icons
  // icons.rs: 24 x 24 grid, 2-unit round stroke (s) or solid fill (f).
  var C9 = 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0';
  var ICONS = {
    menu: [['s', 'M4 7h16'], ['s', 'M4 12h16'], ['s', 'M4 17h16']],
    lyrics: [['s', 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V17h-.5A1.5 1.5 0 0 1 4 15.5v-10A1.5 1.5 0 0 1 5.5 4z'], ['s', 'M8 8.5h8'], ['s', 'M8 12h5']],
    call: [['s', 'M21 16.4v2.8a1.9 1.9 0 0 1-2 1.9 18.8 18.8 0 0 1-8.2-2.9 18.5 18.5 0 0 1-5.7-5.7A18.8 18.8 0 0 1 2.2 4.3 1.9 1.9 0 0 1 4.1 2.2h2.8a1.9 1.9 0 0 1 1.9 1.6c.1.9.4 1.8.7 2.7a1.9 1.9 0 0 1-.4 2L7.9 9.7a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.4c.9.3 1.8.6 2.7.7a1.9 1.9 0 0 1 1.6 1.9z']],
    clipboard: [['s', 'M9 3.5h6a1 1 0 0 1 1 1V6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z'], ['s', 'M16 5h1.5A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H8']],
    checkCircle: [['s', C9], ['s', 'M8 12.3l2.8 2.8L16.3 9.5']],
    calendar: [['s', 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5z'], ['s', 'M4 10h16'], ['s', 'M8.5 3v4'], ['s', 'M15.5 3v4']],
    music: [['s', 'M9 18V5.5l11-2V16'], ['s', 'M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0'], ['s', 'M14 16a3 3 0 1 0 6 0a3 3 0 1 0-6 0']],
    tray: [['s', 'M4 13l2.4-7.2a1.6 1.6 0 0 1 1.5-1.1h8.2a1.6 1.6 0 0 1 1.5 1.1L20 13'], ['s', 'M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'], ['s', 'M4 13h4.5l1.5 2.5h4l1.5-2.5H20']],
    listChecks: [['s', 'M11 6h9'], ['s', 'M11 12h9'], ['s', 'M11 18h9'], ['s', 'M3.5 6l1.6 1.6L8 4.7'], ['s', 'M3.5 12l1.6 1.6L8 10.7'], ['s', 'M4 18h3']],
    timer: [['s', 'M4 13a8 8 0 1 0 16 0a8 8 0 1 0-16 0'], ['s', 'M12 9v4l2.5 2.5'], ['s', 'M10 2.5h4'], ['s', 'M19 5.5l1.5 1.5']],
    addons: [['s', 'M5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4z'], ['s', 'M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3A1.5 1.5 0 0 1 15.5 4z'], ['s', 'M5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14z'], ['s', 'M17 13.5v7'], ['s', 'M13.5 17h7']],
    gear: [['s', 'M10.25 5.22L10.43 2.63A9.5 9.5 0 0 1 13.57 2.63L13.75 5.22A7 7 0 0 1 15.55 5.97L17.52 4.27A9.5 9.5 0 0 1 19.73 6.48L18.03 8.45A7 7 0 0 1 18.78 10.25L21.37 10.43A9.5 9.5 0 0 1 21.37 13.57L18.78 13.75A7 7 0 0 1 18.03 15.55L19.73 17.52A9.5 9.5 0 0 1 17.52 19.73L15.55 18.03A7 7 0 0 1 13.75 18.78L13.57 21.37A9.5 9.5 0 0 1 10.43 21.37L10.25 18.78A7 7 0 0 1 8.45 18.03L6.48 19.73A9.5 9.5 0 0 1 4.27 17.52L5.97 15.55A7 7 0 0 1 5.22 13.75L2.63 13.57A9.5 9.5 0 0 1 2.63 10.43L5.22 10.25A7 7 0 0 1 5.97 8.45L4.27 6.48A9.5 9.5 0 0 1 6.48 4.27L8.45 5.97A7 7 0 0 1 10.25 5.22Z'], ['s', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0']],
    pin: [['s', 'M9 4h6l-1 5.5 3 3V14H7v-1.5l3-3z'], ['s', 'M12 14v6']],
    pinFill: [['f', 'M9 4h6l-1 5.5 3 3V14H7v-1.5l3-3z'], ['s', 'M12 14v6']],
    check: [['s', 'M5 12.5l4.5 4.5L19 7.5']]
  };

  function iconHtml(name, size) {
    var parts = ICONS[name] || [];
    var s = '<svg class="isl-ico" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">';
    for (var i = 0; i < parts.length; i++) {
      s += parts[i][0] === 'f' ? '<path class="isl-f" d="' + parts[i][1] + '"/>' : '<path d="' + parts[i][1] + '"/>';
    }
    return s + '</svg>';
  }

  // ------------------------------------------------------------ strings
  // The app's own UI is English only (the Rust code has no other language),
  // so its words stay English in both; `lang` changes the sample meeting.
  // opts.translateUI: true puts the Indonesian words below on the chrome too.
  var UI_ID = {
    'Live': 'Langsung', 'Meeting': 'Rapat', 'Minutes': 'Notulen', 'Inbox': 'Kotak masuk', 'Today': 'Hari ini',
    'Media': 'Media', 'Shelf': 'Rak', 'Tasks': 'Tugas', 'Focus': 'Fokus', 'Add-ons': 'Pengaya', 'Settings': 'Pengaturan',
    'Keep open': 'Biarkan terbuka', 'Unpin': 'Lepas sematan', 'Menu': 'Menu',
    'Stop captions': 'Hentikan teks', 'Unfollow': 'Berhenti ikuti', 'Hold': 'Tahan', 'Release': 'Lepas',
    'Pause translation': 'Jeda terjemahan', 'Copy': 'Salin', 'History': 'Riwayat', 'Following': 'Mengikuti',
    'Accept': 'Terima', 'Answered': 'Terjawab', 'Carry': 'Bawa', 'Assign': 'Tugaskan', 'Done': 'Selesai',
    'Accepted': 'Diterima', 'Closed': 'Ditutup', 'Carried': 'Dibawa', 'Assigned': 'Ditugaskan',
    'Decision': 'Keputusan', 'Action': 'Tindakan', 'Question': 'Pertanyaan', 'Risk': 'Risiko',
    'Open Minutes app': 'Buka aplikasi Notulen', 'Transcript': 'Transkrip', 'Paste transcript': 'Tempel transkrip',
    'All records': 'Semua catatan', 'Export CSV': 'Ekspor CSV', 'Word': 'Word', 'PDF': 'PDF',
    'wait on you': 'menunggu Anda', 'All settled': 'Semua beres', 'open': 'terbuka',
    'Join': 'Gabung', 'Captions': 'Teks', 'Notes': 'Catatan', 'Refresh': 'Muat ulang', 'Calendars': 'Kalender', 'Earlier': 'Sebelumnya',
    'Now': 'Sekarang', 'Tomorrow': 'Besok', 'repeats': 'berulang', 'CC On': 'CC Aktif',
    'Live captions of the meeting now, line by line.': 'Teks langsung rapat saat ini, baris demi baris.',
    'Decisions, actions and questions of any meeting. Paste reads a copied transcript.': 'Keputusan, tindakan, dan pertanyaan setiap rapat. Tempel membaca transkrip yang disalin.',
    'Open actions and questions from all your meetings.': 'Tindakan dan pertanyaan terbuka dari semua rapat Anda.',
    'Your meetings. Pick a day, then join, caption or take notes.': 'Rapat Anda. Pilih hari, lalu gabung, beri teks, atau catat.',
    'Saved when you stop: a meeting as a meeting, a video as a transcript.': 'Disimpan saat berhenti: rapat sebagai rapat, video sebagai transkrip.',
    'Tap an item to open its meeting': 'Ketuk butir untuk membuka rapatnya',
    'Agenda': 'Agenda'
  };

  // The sample meeting. Made up, nobody's real data.
  var LINES = [
    ['Morning, everyone. A quick weekly sync today.', 'Pagi, semuanya. Rapat mingguan singkat hari ini.'],
    ['QA finished the regression run last night.', 'QA menyelesaikan uji regresi tadi malam.'],
    ['Let us review the launch plan.', 'Mari kita tinjau rencana peluncuran.'],
    // Short enough for the 300 DIP caption pill, which cuts a longer line with an ellipsis.
    ['We ship on Friday if QA passes.', 'Kita rilis hari Jumat jika QA lulus.']
  ];
  var CONTENT = {
    en: {
      meeting: 'Weekly sync',
      items: [
        { kind: 'Decision', rf: 'D-1', text: 'Ship the new build on Friday' },
        { kind: 'Question', rf: 'Q-1', text: 'Who owns the store listing?' },
        { kind: 'Action', rf: 'A-1', text: 'Book the demo room' },
        { kind: 'Action', rf: 'A-2', text: 'Send the deck to the board', owner: 'Alya', review: 'Accepted' },
        { kind: 'Decision', rf: 'D-2', text: 'Keep the classic look as an option', status: 'Closed' }
      ],
      inbox: [
        { kind: 'Question', text: 'Who owns the store listing?', from: '' },
        { kind: 'Action', text: 'Book the demo room', from: 'Budi' },
        { kind: 'Action', text: 'Send the release notes to support', from: 'Alya', due: 'Fri' },
        { kind: 'Risk', text: 'Store review may take two days', from: '' }
      ],
      events: [
        { day: 0, s: '10:00', e: '10:45', title: 'Weekly sync', loc: 'Microsoft Teams', org: 'Alya Rahman', rec: true, join: true },
        { day: 0, s: '13:30', e: '14:15', title: 'Design review', loc: 'Google Meet', org: 'Budi Santoso', join: true },
        { day: 1, s: '09:00', e: '09:30', title: 'Customer call: onboarding', loc: 'Zoom', org: 'Alya Rahman', join: true },
        { day: 1, s: '15:00', e: '15:30', title: 'Release check-in', loc: 'Room 4', org: 'Budi Santoso' },
        { day: 3, s: '11:00', e: '12:00', title: 'Planning', loc: 'Microsoft Teams', join: true }
      ],
      video: { title: 'Planning a launch week, start to finish', channel: 'Studio Notes' }
    },
    id: {
      meeting: 'Rapat mingguan',
      items: [
        { kind: 'Decision', rf: 'D-1', text: 'Rilis build baru hari Jumat' },
        { kind: 'Question', rf: 'Q-1', text: 'Siapa yang memegang listing toko?' },
        { kind: 'Action', rf: 'A-1', text: 'Pesan ruang demo' },
        { kind: 'Action', rf: 'A-2', text: 'Kirim deck ke direksi', owner: 'Alya', review: 'Accepted' },
        { kind: 'Decision', rf: 'D-2', text: 'Tetap sediakan tampilan klasik', status: 'Closed' }
      ],
      inbox: [
        { kind: 'Question', text: 'Siapa yang memegang listing toko?', from: '' },
        { kind: 'Action', text: 'Pesan ruang demo', from: 'Budi' },
        { kind: 'Action', text: 'Kirim catatan rilis ke tim dukungan', from: 'Alya', due: 'Jum' },
        { kind: 'Risk', text: 'Tinjauan toko bisa makan dua hari', from: '' }
      ],
      events: [
        { day: 0, s: '10:00', e: '10:45', title: 'Rapat mingguan', loc: 'Microsoft Teams', org: 'Alya Rahman', rec: true, join: true },
        { day: 0, s: '13:30', e: '14:15', title: 'Tinjauan desain', loc: 'Google Meet', org: 'Budi Santoso', join: true },
        { day: 1, s: '09:00', e: '09:30', title: 'Panggilan pelanggan: orientasi', loc: 'Zoom', org: 'Alya Rahman', join: true },
        { day: 1, s: '15:00', e: '15:30', title: 'Cek rilis', loc: 'Ruang 4', org: 'Budi Santoso' },
        { day: 3, s: '11:00', e: '12:00', title: 'Perencanaan', loc: 'Microsoft Teams', join: true }
      ],
      video: { title: 'Merencanakan minggu peluncuran dari awal', channel: 'Studio Notes' }
    }
  };
  // The video's own captions (YouTube CC), each translated ahead of time.
  var CC = [
    ['first, we lock the scope', 'pertama, kita kunci cakupannya'],
    ['each team gets one owner', 'tiap tim punya satu pemilik'],
    ['the date goes on the calendar', 'tanggalnya masuk kalender'],
    ['before any code is written', 'sebelum kode apa pun ditulis'],
    ['that saves us a week later', 'itu menghemat seminggu nanti'],
    ['then we plan the review days', 'lalu kita rencanakan hari tinjauan'],
    ['and leave time for the store', 'dan sisakan waktu untuk toko']
  ];

  var TABS = [
    { k: 'live', t: 'Live', i: 'lyrics', page: true },
    { k: 'call', t: 'Meeting', i: 'call' },
    { k: 'minutes', t: 'Minutes', i: 'clipboard', page: true },
    { k: 'inbox', t: 'Inbox', i: 'checkCircle', page: true },
    { k: 'today', t: 'Today', i: 'calendar', page: true },
    { k: 'media', t: 'Media', i: 'music', page: true },
    { k: 'shelf', t: 'Shelf', i: 'tray' },
    { k: 'tasks', t: 'Tasks', i: 'listChecks' },
    { k: 'focus', t: 'Focus', i: 'timer' },
    { k: 'addons', t: 'Add-ons', i: 'addons' }
  ];
  var GUIDE = [['today', 'Today'], ['live', 'Live'], ['call', 'Meeting'], ['minutes', 'Minutes'], ['inbox', 'Inbox']];
  var KIND = {
    Decision: ['--isl-blue', '--isl-blue-t'],
    Action: ['--isl-green', '--isl-green-t'],
    Question: ['--isl-purple', '--isl-purple-t'],
    Risk: ['--isl-orange', '--isl-orange-t']
  };
  var FAM = {
    mac: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    win: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
  };
  // The system accent the app paints its primary buttons in (st.accent):
  // macOS controlAccentColor by default; on Windows the owner's accent, as
  // the S7 screenshots show it (AccentLight2, adjusted for the island).
  var ACCENT = { mac: '#007AFF', win: '#F58264' };
  var WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WEEK_LONG = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ------------------------------------------------------------ helpers
  var MC = D.createElement('canvas').getContext('2d');
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function easeOut3(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function ink(a) { return 'rgba(var(--isl-ink),' + a + ')'; }
  function hexRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function el(tag, cls, parent) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function pos(e, x, y, w, h) {
    var s = e.style;
    s.left = x + 'px';
    s.top = y + 'px';
    if (w != null) s.width = Math.max(0, w) + 'px';
    if (h != null) s.height = Math.max(0, h) + 'px';
    return e;
  }

  // ------------------------------------------------------------ springs
  // poni-core/src/spring.rs: semi-implicit Euler at 240 Hz, settles at 0.05.
  function Spring(v, p) {
    this.v = v; this.t = v; this.vel = 0; this.k = p[0]; this.c = p[1];
  }
  Spring.prototype.tune = function (p) { this.k = p[0]; this.c = p[1]; };
  Spring.prototype.snap = function (v) { this.v = this.t = v; this.vel = 0; };
  Spring.prototype.settled = function (eps) {
    eps = eps || 0.05;
    return Math.abs(this.v - this.t) < eps && Math.abs(this.vel) < eps * 4;
  };
  Spring.prototype.step = function (dt) {
    if (this.settled()) { this.v = this.t; this.vel = 0; return; }
    var rem = clamp(dt, 0, 0.1);
    while (rem > 0) {
      var h = Math.min(rem, 1 / 240);
      var f = -this.k * (this.v - this.t) - this.c * this.vel;
      this.vel += f * h;
      this.v += this.vel * h;
      rem -= h;
    }
  };

  var DEFAULTS = {
    os: 'win', // 'mac' | 'win'
    lang: 'en', // 'en' | 'id'
    idle: 'clock', // 'clock' | 'kasi' | 'minimal'
    theme: 'paper', // 'paper' (the app's default, white) | 'pill' (dark)
    reducedMotion: null, // null follows prefers-reduced-motion
    scale: 'auto', // number (CSS px per DIP), 'auto' (container width / screen), 'css' (read --isl-scale)
    screen: 1440, // DIPs across the pretend screen, for scale 'auto'
    height: 380, // DIPs of room under the top edge
    top: TOP_GAP, // the gap above the pill (DIPs)
    hoverMs: 1500, // Settings > Opens after: 0.22 s (the app's default), 1.5 s or 3 s
    ring: false, // the reviewed demo's hover ring (the app has none)
    accent: null, // the system accent; null = the OS default above
    time: '10:24', // the clock shown; 'live' for the visitor's own
    battery: 100, // percent; null = a PC without a battery (the time alone)
    charging: true,
    notch: false, // mac only: true (or {w, h} in DIPs) for a notched MacBook (mac/notch.rs)
    interactive: true, // the visitor's own hover and clicks
    autoplay: false,
    translateUI: false,
    cursor: true // show the scripted pointer while playing
  };

  // ------------------------------------------------------------ mount
  function mount(host, opts) {
    var o = {};
    var k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts || {}) if (opts[k] !== undefined) o[k] = opts[k];
    var os = o.os === 'mac' ? 'mac' : 'win';
    var lang = o.lang === 'id' ? 'id' : 'en';
    var reduced = o.reducedMotion != null ? !!o.reducedMotion : !!(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var root = el('div', 'isl-root', host);
    var stage = el('div', 'isl-stage', root);
    var island = el('div', 'isl-island', stage);
    var hit = el('div', 'isl-hit', island);
    var shape = el('div', 'isl-shape', island);
    var notchEl = el('div', 'isl-notch', island);
    var cursor = el('div', 'isl-cursor', stage);
    root.setAttribute('role', 'img');

    // State of the pretend app.
    var S = {
      captions: false,
      line: -1, // index into LINES on the pill / Live page
      lineTr: true, // the line has its translation yet
      open: false,
      page: 'live',
      pinned: false,
      realHover: false,
      fakeHover: false,
      dwellFrozen: false,
      items: null,
      inbox: null,
      toast: null, // { text, until, bad }
      cc: true,
      media: { pos: 372, dur: 1104, playing: true, line: 2, p: 2, vel: 0, nextAt: 0 }
    };

    // Morph state: the floating island's springs.
    var M = {
      mode: 'idle',
      target: { w: 152, h: 32, r: 16, dy: 0 },
      w: new Spring(152, SP.GROW_W),
      h: new Spring(32, SP.GROW_H),
      r: new Spring(16, SP.R_GROW),
      top: new Spring(o.notch && o.os === 'mac' ? 0 : o.top, SP.TOP),
      content: new Spring(1, SP.CONTENT),
      fadeAt: null,
      floorW: null,
      floorH: null,
      layer: null, // incoming layer { mode, el, g }
      ghost: null, // outgoing layer { mode, el, g, t0, from }
      pageTr: null // { from, to, el0, el1, t0, dir, lay0, lay1 }
    };

    var raf = 0;
    var lastT = 0;
    var timers = [];
    var dwellTimer = 0;
    var resumeTimer = 0;
    var playing = false;
    var runId = 0;
    var destroyed = false;
    var stageW = 1440;
    var scale = 1;
    var cardParts = null; // header bits of the open card
    var capParts = null;
    var mediaParts = null;
    var targets = {}; // id -> {x, y, w, h} in card coordinates, for the scripted pointer
    var cursorAt = { x: 0, y: 0 };

    function fam() { return FAM[os]; }
    // A notched MacBook: the resting pill sits inside the notch (out of
    // sight) and everything else floats TOP_GAP under the menu bar's line.
    function notch() {
      if (os !== 'mac' || !o.notch) return null;
      return { w: o.notch.w || 186, h: o.notch.h || 32 };
    }
    function topGap(mode) {
      var n = notch();
      if (!n) return o.top;
      return mode === 'idle' ? 0 : n.h + o.top;
    }
    // Text width in DIPs, measured in the page's own fonts (as the app
    // measures with DirectWrite / Core Text before it lays a row out).
    var measurer = el('span', '', root);
    measurer.setAttribute('aria-hidden', 'true');
    measurer.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-family:var(--isl-font);font-variant-numeric:tabular-nums;pointer-events:none';
    var mcache = {};
    function mw(text, size, weight) {
      var key = os + '|' + size + '|' + (weight || 400) + '|' + text;
      if (mcache[key] != null) return mcache[key];
      measurer.style.fontSize = size + 'px';
      measurer.style.fontWeight = weight || 400;
      measurer.textContent = text;
      var w = measurer.getBoundingClientRect().width;
      if (!w) {
        MC.font = (weight || 400) + ' ' + size + 'px ' + fam();
        return MC.measureText(text).width;
      }
      mcache[key] = w;
      return w;
    }
    function L(s) { return o.translateUI && lang === 'id' && UI_ID[s] ? UI_ID[s] : s; }
    function C() { return CONTENT[lang]; }
    function accentHex() { return o.accent || ACCENT[os]; }

    function applyClasses() {
      root.className = 'isl-root isl-' + os + ' isl-' + (o.theme === 'pill' ? 'pill' : 'paper');
      var rgb = hexRgb(accentHex());
      root.style.setProperty('--isl-accent', rgb.join(','));
      root.style.setProperty('--isl-accent-c', 'rgb(' + rgb.join(',') + ')');
      root.style.setProperty('--isl-h', String(o.height));
      root.style.setProperty('--isl-on-accent', lum(rgb) > 0.6 ? 'rgba(0,0,0,.88)' : '#fff');
      cursor.innerHTML = os === 'mac'
        ? '<svg viewBox="0 0 22 22"><path d="M2 1.5v16.2l4.1-3.9 2.6 6.1 2.9-1.2-2.6-6h5.8z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 22 22"><path d="M2 1.5v15.6l3.7-3.6 2.4 5.7 2.6-1.1-2.4-5.6h5.2z" fill="#fff" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    }

    function resetData() {
      S.items = C().items.map(function (x) { var c = {}; for (var q in x) c[q] = x[q]; return c; });
      S.inbox = C().inbox.map(function (x) { var c = {}; for (var q in x) c[q] = x[q]; return c; });
      S.toast = null;
    }

    // -------------------------------------------------------- clock
    function demoNow() {
      var d = new Date();
      if (o.time && o.time !== 'live') {
        var p = String(o.time).split(':');
        d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
      }
      return d;
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    function fmtDateShort(d) { return WEEK[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
    function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    // -------------------------------------------------------- primitives
    // Text in a box, as the app's TextStyle draws it.
    function T(p, s, x, y, w, h, t) {
      t = t || {};
      var e = el('div', 'isl-t' + (t.wrap ? ' isl-wrap' : '') + (t.tab ? ' isl-tab-num' : ''), p);
      e.textContent = s;
      pos(e, x, y, w, h);
      var st = e.style;
      st.fontSize = (t.s || 13) + 'px';
      st.fontWeight = t.w || 400;
      st.color = t.c || ink(0.96);
      if (t.a) st.textAlign = t.a === 'c' ? 'center' : t.a === 'r' ? 'right' : 'left';
      st.lineHeight = t.wrap || t.top ? t.lh || 'normal' : h + 'px';
      if (t.ls) st.letterSpacing = t.ls + 'px';
      return e;
    }
    function dot(p, cx, cy, r, color) {
      var e = el('div', 'isl-dot', p);
      pos(e, cx - r, cy - r, 2 * r, 2 * r);
      e.style.background = color;
      return e;
    }
    function icon(p, name, x, y, size, color) {
      var w = el('div', 'isl-box', p);
      pos(w, x, y, size, size);
      w.innerHTML = iconHtml(name, size);
      if (color) w.style.color = color;
      return w;
    }
    function pillW(label) { return Math.ceil(24 + mw(label, 12, 600)); }
    // A small capsule button; `style` utility | neutral | primary:<var> (an rgb triplet var).
    function btn(p, label, x, cy, style, onClick, id) {
      var w = pillW(label);
      var b = el('div', 'isl-btn', p);
      pos(b, x, cy - PILL_SMALL / 2, w, null);
      b.textContent = label;
      if (style.indexOf('primary') === 0) {
        var v = style.split(':')[1] || 'accent';
        b.classList.add('isl-primary');
        b.style.setProperty('--isl-pf', 'var(--isl-' + v + ')');
        b.style.setProperty('--isl-pt', v === 'accent' ? 'var(--isl-accent-c)' : v === 'eq' ? 'var(--isl-eq-c)' : 'var(--isl-' + v + '-t)');
      } else {
        b.classList.add('isl-' + style);
      }
      hoverable(b);
      if (onClick && o.interactive) b.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
      if (id) targets[id] = { x: x, y: cy - PILL_SMALL / 2, w: w, h: PILL_SMALL, el: b };
      return w;
    }
    // Right-aligned: its right edge at `right`. Returns its left edge.
    function btnR(p, label, right, cy, style, onClick, id) {
      var w = pillW(label);
      btn(p, label, right - w, cy, style, onClick, id);
      return right - w;
    }
    function hoverable(e) {
      if (!o.interactive) return;
      e.addEventListener('pointerenter', function () { e.classList.add('isl-hot'); });
      e.addEventListener('pointerleave', function () { e.classList.remove('isl-hot', 'isl-down'); });
      e.addEventListener('pointerdown', function () { e.classList.add('isl-down'); });
      e.addEventListener('pointerup', function () { e.classList.remove('isl-down'); });
    }
    function chip(p, x, cy, label, kind) {
      var t = L(label);
      var w = Math.ceil(mw(t, 11, 600)) + 12;
      var c = el('div', 'isl-chip', p);
      pos(c, x, cy - 9, w, 18);
      c.textContent = t;
      var v = KIND[kind] || ['--isl-blue', '--isl-blue-t'];
      c.style.setProperty('--isl-cf', 'var(' + v[0] + ')');
      c.style.setProperty('--isl-ct', 'var(' + v[1] + ')');
      return w;
    }

    // ======================================================== resting pills
    function idleGeom() {
      if (o.idle === 'kasi' && W.Kasi && W.Kasi.svg) return { w: 84, h: PILL_H, r: 16 };
      if (o.idle === 'minimal') return { w: 96, h: 24, r: 12 };
      if (o.battery == null) return { w: 84, h: PILL_H, r: 16 };
      // SIDE + TIME_SLOT + MID_GAP + PCT_SLOT + PCT_GAP + BATTERY_W + SIDE
      return { w: Math.round(16 + 40 + 16 + 35 + 6 + 22.5 + 16), h: PILL_H, r: 16 };
    }

    function batteryHtml(pct, charging) {
      // pill/idle.rs battery_glyph at its own size: 20 x 10 body, nub 0.75 away and 1.75 wide.
      var line = 1.25;
      var body = '<rect x="' + line / 2 + '" y="' + line / 2 + '" width="' + (20 - line) + '" height="' + (10 - line) + '" rx="' + (3 - line / 2) + '" fill="none" stroke="' + ink(0.42) + '" stroke-width="' + line + '"/>';
      var nub = '<rect x="20.75" y="3" width="1.75" height="4" rx="0.75" fill="' + ink(0.42) + '"/>';
      var lvl = clamp(pct, 0, 100) / 100;
      var fillC = !charging && pct <= 20 ? 'rgb(var(--isl-red))' : 'rgb(var(--isl-green))';
      var fw = Math.min(Math.max(16 * lvl, 2), 16);
      var fill = lvl > 0 ? '<rect x="2" y="2" width="' + fw + '" height="6" rx="1.5" fill="' + fillC + '"/>' : '';
      var bolt = '';
      if (charging) {
        var pts = [[0.6, -4], [-3, 0.674], [-0.343, 0.674], [-0.9, 4], [3, -0.674], [0.3, -0.674]];
        var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + (10 + q[0]).toFixed(3) + ' ' + (5 + q[1]).toFixed(3); }).join('') + 'Z';
        bolt = '<path d="' + d + '" fill="var(--isl-ground)" stroke="var(--isl-ground)" stroke-width="2" stroke-linejoin="round"/><path d="' + d + '" fill="' + ink(1) + '"/>';
      }
      return '<svg viewBox="0 0 22.5 10" width="22.5" height="10" style="position:absolute;display:block;overflow:visible">' + body + nub + fill + bolt + '</svg>';
    }

    function buildIdle() {
      var L0 = el('div', 'isl-layer isl-fill');
      if (o.idle === 'kasi' && W.Kasi && W.Kasi.svg) {
        var k = el('div', 'isl-box', L0);
        k.style.left = '50%';
        k.style.top = '4px';
        k.style.width = '30px';
        k.style.height = '24px';
        k.style.marginLeft = '-15px';
        k.innerHTML = W.Kasi.svg({ pose: 'mark', mouth: 'small' });
        var sv = k.querySelector('svg');
        if (sv) { sv.setAttribute('width', '100%'); sv.setAttribute('height', '100%'); sv.style.display = 'block'; }
        return L0;
      }
      if (o.idle === 'minimal') return L0;
      var time = fmtClock(demoNow());
      var ts = { s: 15, w: 600, c: ink(1), tab: true };
      if (o.battery == null) {
        T(L0, time, 0, 0, 0, PILL_H, ts).style.cssText += ';left:0;right:0;width:auto;text-align:center';
        return L0;
      }
      var tw = mw(time, 15, 600);
      T(L0, time, 16, 0, tw + 2, PILL_H, ts);
      // The battery at the right end, its percentage 6 before it.
      var g = el('div', 'isl-box', L0);
      g.style.right = '16px';
      g.style.top = (PILL_H - 10) / 2 + 'px';
      g.style.width = '22.5px';
      g.style.height = '10px';
      g.innerHTML = batteryHtml(o.battery, o.charging);
      var pct = o.battery + '%';
      var pw = mw(pct, 13, 500);
      var pe = T(L0, pct, 0, 0, pw + 2, PILL_H, { s: 13, w: 500, c: ink(0.55), tab: true, a: 'r' });
      pe.style.left = 'auto';
      pe.style.right = 16 + 22.5 + 6 - 1 + 'px';
      return L0;
    }

    // The caption pill (pill/live.rs draw_caption + pill/lyric.rs).
    function capGeom() {
      return S.lineTr && LINES[S.line] ? { w: CAP_W, h: CAP_H2, r: CAP_R2 } : { w: CAP_W, h: PILL_H, r: 16 };
    }
    function buildCaption() {
      var L0 = el('div', 'isl-layer isl-fill');
      var d = el('div', 'isl-dot', L0);
      d.style.left = 12 + 'px';
      d.style.top = 'calc(50% - 3px)';
      d.style.width = d.style.height = '6px';
      d.style.background = 'rgb(var(--isl-green))';
      var area = el('div', 'isl-box', L0);
      area.style.left = 24 - 1 + 'px';
      area.style.right = 16 - 1 + 'px';
      area.style.top = '0';
      area.style.bottom = '0';
      capParts = { layer: L0, area: area, shown: null, leaving: null, since: -1 };
      if (o.ring) {
        var ring = D.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ring.setAttribute('viewBox', '0 0 14 14');
        ring.setAttribute('class', 'isl-ring');
        ring.innerHTML = '<circle cx="7" cy="7" r="5.75" fill="none" stroke="' + ink(0.22) + '" stroke-width="2.5"/><circle class="isl-ring-arc" cx="7" cy="7" r="5.75" fill="none" stroke="var(--isl-accent-c)" stroke-width="2.5" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>';
        ring.style.right = '12px';
        ring.style.top = 'calc(50% - 7px)';
        ring.style.opacity = '0';
        L0.appendChild(ring);
        capParts.ring = ring;
      }
      capSync(true);
      return L0;
    }
    function capWords(src, tr) {
      var w = el('div', 'isl-box');
      w.style.left = '0';
      w.style.right = '0';
      w.style.top = '0';
      w.style.bottom = '0';
      if (tr) {
        // LINE_DY -7.5 in a 20 box, READING_DY 8.5 in a 16 box, about the middle.
        var a = el('div', 'isl-t', w);
        a.style.cssText += ';left:0;right:0;top:calc(50% - 17.5px);height:20px;line-height:20px;text-align:center;font-size:13px;font-weight:600;color:' + ink(0.96);
        a.textContent = src;
        var b = el('div', 'isl-t', w);
        b.style.cssText += ';left:0;right:0;top:calc(50% + 0.5px);height:16px;line-height:16px;text-align:center;font-size:11px;font-weight:500;color:' + ink(0.96 * 0.78);
        b.textContent = tr;
      } else {
        var c = el('div', 'isl-t', w);
        c.style.cssText += ';left:0;right:0;top:0;bottom:0;line-height:' + PILL_H + 'px;text-align:center;font-size:13px;font-weight:600;color:' + ink(0.96);
        c.textContent = src;
      }
      return w;
    }
    // Show the current line; a new one rises in as the old one rises away (0.2 s).
    function capSync(instant) {
      if (!capParts) return;
      var ln = LINES[S.line];
      if (!ln) return;
      var key = S.line + ':' + (S.lineTr ? 1 : 0);
      if (capParts.key === key) return;
      var sameLine = capParts.key && capParts.key.split(':')[0] === String(S.line);
      capParts.key = key;
      var words = capWords(ln[0], S.lineTr ? ln[1] : '');
      capParts.area.appendChild(words);
      if (capParts.leaving) capParts.leaving.remove();
      capParts.leaving = sameLine || instant || reduced ? null : capParts.shown;
      if (capParts.shown && !capParts.leaving) capParts.shown.remove();
      capParts.shown = words;
      capParts.since = instant || reduced || sameLine ? -1 : performance.now() / 1000;
      if (capParts.since < 0) words.style.opacity = '1';
      kick();
    }
    function capFrame(now) {
      if (!capParts || capParts.since < 0) return false;
      var k = (now - capParts.since) / 0.2;
      if (k >= 1) {
        if (capParts.leaving) capParts.leaving.remove();
        capParts.leaving = null;
        capParts.shown.style.opacity = '';
        capParts.shown.style.transform = '';
        capParts.since = -1;
        return false;
      }
      var ease = function (x) { return 1 - Math.pow(1 - x, 3); };
      var come = ease(clamp((k - 0.25) / 0.75, 0, 1));
      var gone = Math.min(k / 0.5, 1);
      capParts.shown.style.opacity = String(come);
      capParts.shown.style.transform = 'translateY(' + 4 * (1 - come) + 'px)';
      if (capParts.leaving) {
        capParts.leaving.style.opacity = String((1 - gone) * (1 - gone));
        capParts.leaving.style.transform = 'translateY(' + -4 * ease(gone) + 'px)';
      }
      return true;
    }

    // ======================================================== the open card
    function pageH(p) {
      if (p === 'minutes') return MINUTES_H;
      if (p === 'inbox') return INBOX_H;
      if (p === 'today') return TODAY_H;
      if (p === 'media') return MEDIA_H;
      return LIVE_BASE + GUIDE_H + liveCards().length * LIVE_CARD;
    }
    function cardGeom(p) { return { w: CARD_W, h: Math.round(HEADER_H + pageH(p || S.page) + PAD), r: CARD_R }; }
    function liveCards() {
      // "Recent lines": the lines before the previous one, at most three (Settings > Log cards).
      var i = Math.max(S.line, 0);
      return LINES.slice(Math.max(0, i - 1 - 3), Math.max(0, i - 1));
    }

    // pages/mod.rs tab_layout: tab slots (x, w) with `active` showing its label.
    function headerLayout(active) {
      var hx = 12 + TAB_INSET; // header_rect: PAD - 6, then the Pill inset
      var hw = CARD_W - 2 * PAD + 12 - TAB_INSET;
      var right = hx + hw - 6;
      var clock = fmtClock(demoNow());
      var clockW = mw(clock, 13, 600);
      var x0 = hx + MENU_SLOT;
      var stop = right - clockW - DATE_GAP;
      var n = TABS.length;
      var slotW = Math.floor(clamp((stop - x0) / (n + 1) - TAB_GAP, MIN_TAB_W, TAB_W));
      var end = stop - slotW - TAB_GAP;
      var x = x0;
      var slots = TABS.map(function (t, i) {
        var w = t.k === active && t.k !== 'call' ? Math.round(TAB_LABEL_X + mw(L(t.t), 13, 600) + TAB_LABEL_END) : slotW;
        var room = end - x - (n - 1 - i) * (slotW + TAB_GAP);
        w = Math.min(w, Math.max(room, slotW));
        var s = [Math.round(x), w];
        x += w + TAB_GAP;
        return s;
      });
      var tabsEnd = slots[n - 1][0] + slots[n - 1][1];
      var date = fmtDateShort(demoNow());
      var dw = mw(date, 12, 400);
      var left = right - clockW;
      var dateLeft = left - DATE_GAP - dw;
      var showDate = dateLeft > tabsEnd + 40;
      if (showDate) left = dateLeft;
      var gearX = Math.round(tabsEnd + TAB_GAP);
      var pinX = Math.round(left - PIN_GAP - PIN);
      return {
        hx: hx, hw: hw, right: right, clock: clock, clockW: clockW, slotW: slotW, slots: slots,
        tabsEnd: tabsEnd, date: date, dw: dw, dateLeft: dateLeft, showDate: showDate,
        gearX: gearX, pinX: pinX, showPin: pinX > gearX + slotW + 8
      };
    }

    function buildCard() {
      var g = cardGeom();
      var L0 = el('div', 'isl-layer');
      pos(L0, 0, 0, CARD_W, g.h);
      var head = el('div', 'isl-box', L0);
      pos(head, 0, 0, CARD_W, HEADER_H);
      var cy = 6 + 18;
      var lay = headerLayout(S.page);
      // The Menu button, left of the tabs.
      var menu = el('div', 'isl-ibtn', head);
      pos(menu, lay.hx, cy - TAB_H / 2, TAB_W, TAB_H);
      icon(menu, 'menu', (TAB_W - TAB_ICON) / 2, (TAB_H - TAB_ICON) / 2, TAB_ICON);
      // Selection pill.
      var sel = el('div', 'isl-tabsel', head);
      var tabs = TABS.map(function (t, i) {
        var e = el('div', 'isl-tab', head);
        e.style.top = cy - TAB_H / 2 + 'px';
        icon(e, t.i, (lay.slotW - TAB_ICON) / 2, (TAB_H - TAB_ICON) / 2, TAB_ICON);
        var lab = el('div', 'isl-tablab', e);
        lab.textContent = L(t.t);
        lab.style.right = TAB_LABEL_END - 2 + 'px';
        if (o.interactive) {
          e.addEventListener('pointerenter', function () { tabHover(i, true); });
          e.addEventListener('pointerleave', function () { tabHover(i, false); });
          e.addEventListener('click', function (ev) { ev.stopPropagation(); if (t.page) selectPage(t.k); });
        }
        return { el: e, lab: lab, t: t };
      });
      // Settings, right after the last tab; the pin; the date; the clock.
      var gear = el('div', 'isl-ibtn', head);
      icon(gear, 'gear', (lay.slotW - 16) / 2, (TAB_H - 16) / 2, 16);
      var pin = el('div', 'isl-ibtn', head);
      pos(pin, lay.pinX, cy - PIN / 2, PIN, PIN);
      var pinIco = icon(pin, S.pinned ? 'pinFill' : 'pin', (PIN - 15) / 2, (PIN - 15) / 2, 15);
      if (S.pinned) pinIco.style.color = 'var(--isl-accent-c)';
      var date = T(head, lay.date, lay.dateLeft - 2, 6, lay.dw + 2, 36, { s: 12, c: ink(0.62), a: 'r' });
      T(head, lay.clock, lay.right - lay.clockW - 4, 6, lay.clockW + 4, 36, { s: 13, w: 600, a: 'r', tab: true });
      var tip = el('div', 'isl-tip', L0);
      if (o.interactive) {
        [[menu, 'Menu'], [gear, 'Settings']].forEach(function (q) {
          hoverable(q[0]);
          q[0].addEventListener('pointerenter', function () { showTip(q[0], q[1]); });
          q[0].addEventListener('pointerleave', function () { showTip(null); });
        });
        hoverable(pin);
        pin.addEventListener('pointerenter', function () { showTip(pin, S.pinned ? 'Unpin' : 'Keep open'); });
        pin.addEventListener('pointerleave', function () { showTip(null); });
        pin.addEventListener('click', function (ev) {
          ev.stopPropagation();
          S.pinned = !S.pinned;
          pinIco.innerHTML = iconHtml(S.pinned ? 'pinFill' : 'pin', 15);
          pinIco.style.color = S.pinned ? 'var(--isl-accent-c)' : '';
          showTip(pin, S.pinned ? 'Unpin' : 'Keep open');
        });
      }
      var pages = el('div', 'isl-pages', L0);
      pos(pages, 0, 44, CARD_W, g.h - 44);
      cardParts = { layer: L0, head: head, sel: sel, tabs: tabs, gear: gear, pin: pin, date: date, tip: tip, pages: pages, lay: lay, page: S.page, pageEl: null };
      placeHeader(lay, lay, 1, S.page, S.page);
      cardParts.pageEl = buildPage(S.page);
      pages.appendChild(cardParts.pageEl);
      return L0;
    }

    // Header at e of the way from layout `a` (page `pa`) to `b` (page `pb`).
    function placeHeader(a, b, e, pa, pb) {
      var cp = cardParts;
      var cy = 24;
      var idx = function (k) { for (var i = 0; i < TABS.length; i++) if (TABS[i].k === k) return i; return 0; };
      var fi = idx(pa);
      var pi = idx(pb);
      cp.tabs.forEach(function (t, i) {
        var x = lerp(a.slots[i][0], b.slots[i][0], e);
        var w = lerp(a.slots[i][1], b.slots[i][1], e);
        pos(t.el, x, cy - TAB_H / 2, w, TAB_H);
        var on = i === pi;
        t.el.classList.toggle('isl-on', on);
        var la = on ? e : i === fi && fi !== pi ? 1 - e : 0;
        t.lab.style.opacity = String(la);
        t.lab.style.display = la > 0.01 ? '' : 'none';
      });
      var sx = lerp(a.slots[fi][0], b.slots[pi][0], e);
      var sw = lerp(a.slots[fi][1], b.slots[pi][1], e);
      pos(cp.sel, sx, cy - TAB_H / 2, sw, TAB_H);
      var tabsEnd = lerp(a.tabsEnd, b.tabsEnd, e);
      pos(cp.gear, Math.round(tabsEnd + TAB_GAP), cy - TAB_H / 2, b.slotW, TAB_H);
      cp.pin.style.display = b.showPin ? '' : 'none';
      cp.date.style.display = b.showDate ? '' : 'none';
    }

    function tabHover(i, on) {
      var t = cardParts && cardParts.tabs[i];
      if (!t) return;
      var active = t.t.k === S.page;
      t.el.classList.toggle('isl-hot', on && !active);
      showTip(on && !active ? t.el : null, t.t.t);
    }
    // A hover label: a capsule centred under the tab, 4 below the header row.
    function showTip(anchor, text) {
      if (!cardParts) return;
      var tip = cardParts.tip;
      if (!anchor) { tip.classList.remove('isl-show'); return; }
      var label = L(text);
      var w = Math.ceil(mw(label, 12, 400) + TIP_H);
      var ax = parseFloat(anchor.style.left) + parseFloat(anchor.style.width) / 2;
      var lo = 16;
      var hi = 16 + 592;
      var x = clamp(ax - w / 2, lo, Math.max(hi - w, lo));
      pos(tip, Math.round(x), 6 + 36 + 4, w, TIP_H);
      tip.textContent = label;
      tip.classList.add('isl-show');
    }

    function buildPage(p) {
      targets = {};
      var pg = el('div', 'isl-page');
      pg.style.height = cardGeom(p).h + 'px';
      mediaParts = null;
      if (p === 'minutes') pageMinutes(pg);
      else if (p === 'inbox') pageInbox(pg);
      else if (p === 'today') pageToday(pg);
      else if (p === 'media') pageMedia(pg);
      else pageLive(pg);
      return pg;
    }
    function contentArea(p) { return { x: PAD, y: HEADER_H, w: CARD_W - 2 * PAD, h: pageH(p) }; }

    // hkit::guide: what the page is for, and the way to the other meeting pages.
    function guide(pg, a, key, purpose) {
      var steps = GUIDE.filter(function (s) { return TABS.some(function (t) { return t.k === s[0]; }); });
      var on = function (s) { return s[0] === key; };
      var widths = steps.map(function (s) { return Math.ceil(mw(L(s[1]), 11, on(s) ? 600 : 400)); });
      var navW = widths.reduce(function (x, y) { return x + y; }, 0) + 14 * (steps.length - 1);
      var show = steps.length > 1 && a.w - navW - 12 >= 260;
      T(pg, L(purpose), a.x, a.y, show ? a.w - navW - 12 : a.w, 20, { s: 11, c: ink(0.62) });
      if (show) {
        var x = a.x + a.w - navW;
        steps.forEach(function (s, i) {
          var e = T(pg, L(s[1]), x, a.y, widths[i] + 1, 20, { s: 11, w: on(s) ? 600 : 400, c: on(s) ? 'var(--isl-accent-c)' : ink(0.62) });
          var tab = TABS.filter(function (t) { return t.k === s[0]; })[0];
          if (o.interactive && !on(s) && tab && tab.page) {
            e.addEventListener('pointerenter', function () { e.style.color = ink(0.96); });
            e.addEventListener('pointerleave', function () { e.style.color = ink(0.62); });
            e.addEventListener('click', function (ev) { ev.stopPropagation(); selectPage(s[0]); });
          }
          x += widths[i] + 14;
        });
      }
      return { x: a.x, y: a.y + GUIDE_H, w: a.w, h: a.h - GUIDE_H };
    }

    // ---------------------------------------------------- Live (pages/live.rs)
    function pageLive(pg) {
      var a = guide(pg, contentArea('live'), 'live', 'Live captions of the meeting now, line by line.');
      var cy = a.y + 17;
      // Right to left: Stop captions, Unfollow, Hold, Pause translation, Copy, Aa, History.
      var r = a.x + a.w;
      r = btnR(pg, L('Stop captions'), r, cy, 'neutral') - PILL_GAP;
      r = btnR(pg, L('Unfollow'), r, cy, 'utility') - PILL_GAP;
      r = btnR(pg, L('Hold'), r, cy, 'neutral') - PILL_GAP;
      r = btnR(pg, L('Pause translation'), r, cy, 'neutral') - PILL_GAP;
      r = btnR(pg, L('Copy'), r, cy, 'utility') - PILL_GAP;
      r = btnR(pg, 'Aa', r, cy, 'neutral') - PILL_GAP;
      r = btnR(pg, L('History'), r, cy, 'utility') - PILL_GAP;
      dot(pg, a.x + 5, cy, 4, 'rgb(var(--isl-green))');
      T(pg, L('Following') + '  ' + C().meeting, a.x + 16, cy - 10, Math.max(0, r - a.x - 18), 20, { s: 12, w: 600, c: ink(0.62) });
      var top = a.y + 34 + 6;
      liveCards().forEach(function (c) {
        var box = el('div', 'isl-box', pg);
        pos(box, a.x, top, a.w, 20);
        box.style.borderRadius = '8px';
        box.style.background = ink(0.06);
        T(pg, c[0] + '  ·  ' + c[1], a.x + 8, top + 2, a.w - 16, 16, { s: 11, c: ink(0.5) });
        top += LIVE_CARD;
      });
      // caption_lines: the previous line dim, the current one large, its translation under it.
      var ln = LINES[Math.max(S.line, 0)];
      var prev = LINES[Math.max(S.line, 0) - 1];
      var y = top;
      if (prev) T(pg, prev[0], a.x, y, a.w, 18, { s: 12, c: ink(0.5) });
      y += 22;
      T(pg, ln[0], a.x, y, a.w, 46, { s: 15, w: 600, wrap: true });
      y += 50;
      if (S.lineTr) T(pg, ln[1], a.x, y, a.w, 40, { s: 13, wrap: true, c: 'var(--isl-tr)' });
      T(pg, L('Saved when you stop: a meeting as a meeting, a video as a transcript.'), a.x, a.y + a.h - 14, a.w - 70, 14, { s: 11, c: ink(0.5) });
    }

    // ---------------------------------------------------- Minutes (pages/meeting.rs)
    function waits(i) { return !i.status && !i.review; }
    function settled(i) {
      if (i.status) return L(i.status);
      if (i.review) return L(i.review);
      return '';
    }
    function pageMinutes(pg) {
      var a = guide(pg, contentArea('minutes'), 'minutes', 'Decisions, actions and questions of any meeting. Paste reads a copied transcript.');
      var cy = a.y + 15;
      // Head: the pager, Open Minutes app, Transcript.
      var r = a.x + a.w;
      var nextW = pillW('›');
      btn(pg, '›', r - nextW, cy, 'utility');
      var x = r - nextW - PILL_GAP;
      var ptxt = L('Meeting') + ' 1 / 3';
      var pw = Math.ceil(mw(ptxt, 12, 400));
      T(pg, ptxt, x - pw, cy - 9, pw, 18, { s: 12, c: ink(0.62) });
      x -= pw + PILL_GAP;
      var px = x - pillW('‹');
      var oa = L('Open Minutes app');
      var ow = pillW(oa);
      btn(pg, oa, px - PILL_GAP * 2 - ow, cy, 'utility');
      px = px - PILL_GAP * 2 - ow;
      var tl = L('Transcript') + ' 38';
      px = btnR(pg, tl, px - PILL_GAP, cy, 'utility');
      T(pg, C().meeting + ' · ' + isoDate(demoNow()), a.x, cy - 11, Math.max(0, px - a.x - 10), 22, { s: 15, w: 600 });
      // Foot: what waits (or the last press), then the buttons.
      var fy = a.y + a.h - 14;
      var fr = a.x + a.w;
      fr = btnR(pg, L('Paste transcript'), fr, fy, 'utility');
      fr = btnR(pg, L('All records'), fr - PILL_GAP, fy, 'utility');
      fr = btnR(pg, L('Word'), fr - PILL_GAP, fy, 'utility');
      fr = btnR(pg, L('PDF'), fr - PILL_GAP, fy, 'utility');
      fr = btnR(pg, L('Export CSV'), fr - PILL_GAP, fy, 'utility');
      var waiting = S.items.filter(waits).length;
      var toast = S.toast && S.toast.until > Date.now() ? S.toast : null;
      var status = toast ? toast.text : waiting ? waiting + ' ' + L('wait on you') : L('All settled');
      var tone = toast ? toast.bad ? 'var(--isl-orange-t)' : 'var(--isl-green-t)' : waiting ? 'var(--isl-orange-t)' : ink(0.62);
      T(pg, status, a.x, fy - 9, Math.max(0, fr - a.x - 10), 18, { s: 12, w: 600, c: tone });
      // Rows: waiting items first, then the rest, in the register's order.
      var order = S.items.map(function (it, i) { return i; }).sort(function (p, q) { return (waits(S.items[p]) ? 0 : 1) - (waits(S.items[q]) ? 0 : 1) || p - q; });
      order.slice(0, 5).forEach(function (idx, slot) {
        var it = S.items[idx];
        var ry = a.y + 30 + 4 + slot * 36;
        var rcy = ry + 18;
        var right = a.x + a.w;
        if (waits(it)) {
          var labels = [[it.kind === 'Question' ? 'Answered' : 'Accept', it.kind === 'Question' ? 'Answered' : 'Accepted'], ['Carry', 'Carried'], ['Assign', 'Assigned']];
          for (var n = 2; n >= 0; n--) {
            (function (n) {
              var lab = L(labels[n][0]);
              var w = pillW(lab);
              btn(pg, lab, right - w, rcy, n === 0 ? 'primary:accent' : 'utility', function () { decide(it.rf, n); }, n === 0 ? 'accept-' + it.rf : null);
              right = right - w - PILL_GAP;
            })(n);
          }
        } else {
          var said = it.owner && settled(it) ? it.owner + ' · ' + settled(it) : it.owner || settled(it);
          var sw = Math.ceil(mw(said, 12, 400));
          T(pg, said, right - sw, rcy - 9, sw, 18, { s: 12, c: ink(0.62), a: 'r' });
          right -= sw + 10;
        }
        var cw = chip(pg, a.x, rcy, it.kind, it.kind);
        var tx = a.x + cw + 8;
        T(pg, it.text, tx, rcy - 10, Math.max(0, right - tx - 6), 20, { s: 13, c: waits(it) ? ink(0.96) : ink(0.62) });
      });
    }
    function decide(rf, n) {
      var it = S.items.filter(function (x) { return x.rf === rf; })[0];
      if (!it || !waits(it)) return;
      var verb;
      if (n === 0 && it.kind === 'Question') { it.status = 'Closed'; verb = 'Answered'; }
      else if (n === 0) { it.review = 'Accepted'; verb = 'Accepted'; }
      else if (n === 1) { it.status = 'Carried'; verb = 'Carried'; }
      else { it.owner = 'Budi'; it.review = 'Accepted'; verb = 'Assigned'; }
      S.toast = { text: L(verb) + ' ' + rf, until: Date.now() + 3000, bad: false };
      refreshPage();
      later(function () { if (S.open && S.page === 'minutes') refreshPage(); }, 3050);
    }

    // ---------------------------------------------------- Inbox (pages/inbox.rs)
    function pageInbox(pg) {
      var a = guide(pg, contentArea('inbox'), 'inbox', 'Open actions and questions from all your meetings.');
      T(pg, S.inbox.length + ' ' + L('open'), a.x, a.y, a.w, 26, { s: 15, w: 600 });
      S.inbox.slice(0, 5).forEach(function (it, slot) {
        var ry = a.y + 26 + 4 + slot * 36;
        var cy = ry + 18;
        var right = a.x + a.w;
        for (var n = 1; n >= 0; n--) {
          (function (n) {
            var lab = L(n === 0 ? 'Done' : 'Carry');
            var w = pillW(lab);
            btn(pg, lab, right - w, cy, n === 0 ? 'primary:accent' : 'utility', function () {
              S.inbox.splice(S.inbox.indexOf(it), 1);
              refreshPage();
            });
            right = right - w - PILL_GAP;
          })(n);
        }
        var cw = chip(pg, a.x, cy - 8, it.kind, it.kind);
        var tx = a.x + cw + 8;
        var w = Math.max(0, right - tx - 6);
        T(pg, it.text, tx, cy - 16, w, 20, { s: 13 });
        var from = C().meeting + (it.from ? ' · ' + it.from : '') + (it.due ? ' · due ' + it.due : '');
        T(pg, from, tx, cy + 2, w, 16, { s: 11, c: ink(0.62) });
      });
      T(pg, L('Tap an item to open its meeting'), a.x, a.y + a.h - 14 - 8, a.w - 8, 16, { s: 11, c: ink(0.5) });
    }

    // ---------------------------------------------------- Today (pages/calendar.rs)
    function pageToday(pg) {
      var a = guide(pg, contentArea('today'), 'today', 'Your meetings. Pick a day, then join, caption or take notes.');
      var now = demoNow();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var dayMs = 86400000;
      // The month grid (Oyenza Studio's draw_weeks_grid): 5 weeks from this Monday.
      T(pg, WEEK_LONG[today.getDay()], a.x, a.y, 161, 16, { s: 11, w: 700, c: 'var(--isl-accent-c)' });
      T(pg, today.getDate() + ' ' + MON_LONG[today.getMonth()], a.x, a.y + 16, 161, 24, { s: 18, w: 600 });
      'MTWTFSS'.split('').forEach(function (s, col) {
        T(pg, s, a.x + col * 23, a.y + 48, 23, 16, { s: 11, w: 600, c: ink(0.5), a: 'c' });
      });
      var top = a.y + 48 + 16;
      var start = new Date(today.getTime() - ((today.getDay() + 6) % 7) * dayMs);
      var busy = {};
      C().events.forEach(function (e) { busy[e.day] = 1; });
      busy[-2] = busy[-5] = busy[7] = busy[8] = busy[14] = 1;
      for (var i = 0; i < 35; i++) {
        var day = new Date(start.getTime() + i * dayMs + 3600000);
        var off = Math.round((day - today) / dayMs);
        var row = Math.floor(i / 7);
        var col = i % 7;
        var cx = a.x + col * 23 + 11.5;
        var cyy = top + row * 26 + 10;
        var d = day.getDate();
        var ts = { s: 12, a: 'c', tab: true };
        if (off === 0) {
          dot(pg, cx, cyy, 9.5, 'var(--isl-accent-c)');
          ts.w = 700;
          ts.c = 'var(--isl-on-accent)';
        } else {
          ts.c = off < 0 ? ink(0.32) : col >= 5 ? ink(0.62) : ink(0.9);
          if (d === 1) ts.w = 700;
        }
        T(pg, String(d), a.x + col * 23, top + row * 26, 23, 20, ts);
        if (busy[off]) dot(pg, cx, top + row * 26 + 22, 1.5, 'var(--isl-accent-c)');
        if (d === 1 && i > 0) {
          var ly = top + row * 26 - 1.5;
          var line = function (x0, y0, w, h) { var b = el('div', 'isl-box', pg); pos(b, x0, y0 - 0.5, w, h); b.style.background = ink(0.2); };
          if (row > 0) line(a.x + col * 23, ly, 161 - col * 23, 1);
          if (col > 0) {
            var v = el('div', 'isl-box', pg);
            pos(v, a.x + col * 23 - 0.5, ly, 1, 26);
            v.style.background = ink(0.2);
            if (row < 4) line(a.x, ly + 26, col * 23, 1);
          }
        }
      }
      // The meetings of the next days, grouped by day.
      var mx = a.x + 161 + 20;
      var mwid = a.x + a.w - mx;
      var foot = a.y + a.h - 28;
      var fr = a.x + a.w;
      ['Refresh', 'Calendars', 'Earlier'].forEach(function (l) { fr = btnR(pg, L(l), fr, foot + 14, 'utility') - PILL_GAP; });
      var room = a.h - 28 - 4;
      var used = 0;
      var lastDay = null;
      var y = a.y;
      var shown = 0;
      var evs = C().events;
      for (var j = 0; j < evs.length; j++) {
        var e = evs[j];
        var need = 40 + (e.day !== lastDay ? 18 : 0);
        if (used + need > room) break;
        if (e.day !== lastDay) {
          var lbl = e.day === 0 ? L('Today') : e.day === 1 ? L('Tomorrow') : fmtDateShort(new Date(today.getTime() + e.day * dayMs + 3600000));
          T(pg, lbl, mx, y, mwid, 18, { s: 11, w: 600, c: ink(0.5) });
          y += 18;
          lastDay = e.day;
        }
        meetingRow(pg, mx, y, mwid, e, now);
        y += 40;
        used += need;
        shown++;
      }
      if (shown < evs.length) {
        // hkit::pager "1 / 2 ›" before the foot's buttons.
        var right = fr;
        var nw = pillW('›');
        btn(pg, '›', right - nw, foot + 14, 'utility');
        var t = '1 / 2';
        var tw = Math.ceil(mw(t, 12, 400));
        T(pg, t, right - nw - PILL_GAP - tw, foot + 14 - 9, tw, 18, { s: 12, c: ink(0.62) });
      }
    }
    function meetingRow(pg, x, y, w, e, now) {
      var mins = now.getHours() * 60 + now.getMinutes();
      var hm = function (s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; };
      var on = e.day === 0 && mins >= hm(e.s) && mins < hm(e.e);
      var past = e.day < 0 || (e.day === 0 && mins >= hm(e.e));
      if (on) {
        var bg = el('div', 'isl-box', pg);
        pos(bg, x, y, w, 40);
        bg.style.borderRadius = '8px';
        bg.style.background = 'rgba(var(--isl-accent),0.12)';
      }
      var cy = y + 20;
      var right = x + w - 4;
      [['Notes', 2], ['Captions', 1], ['Join', 0]].forEach(function (q) {
        if ((q[1] === 0 && !e.join) || (past && q[1] !== 2)) return;
        var lab = L(q[0]);
        var bw = pillW(lab);
        btn(pg, lab, right - bw, cy, q[1] === 0 ? 'primary:accent' : 'utility', null, q[1] === 0 ? 'join-' + e.title : null);
        right -= bw + PILL_GAP;
      });
      var tx = x + 8;
      var sub = [];
      if (e.loc) sub.push(e.loc);
      if (e.org) sub.push(e.org);
      if (e.rec) sub.push(L('repeats'));
      sub.unshift(e.s + ' – ' + e.e); // rows under 520 DIPs lead with the time
      if (on) sub.unshift(L('Now'));
      var tw = Math.max(0, right - tx - 4);
      T(pg, e.title, tx, cy - 18, tw, 20, { s: 13 });
      T(pg, sub.join(' · '), tx, cy + 2, tw, 16, { s: 11, c: ink(0.62) });
    }

    // ---------------------------------------------------- Media (pill/music.rs)
    function eqHex() { return '#EA7A53'; }
    function fmtDur(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + pad2(s % 60); }
    function pageMedia(pg) {
      var a = contentArea('media');
      var x0 = a.x;
      var y0 = a.y;
      var lyrW = Math.round(Math.min(a.w * 0.42, a.w - 20 - 296));
      var blockW = Math.round(a.w - lyrW - 20);
      var blockR = x0 + blockW;
      var eqRgb = hexRgb(eqHex());
      root.style.setProperty('--isl-eq', eqRgb.join(','));
      root.style.setProperty('--isl-eq-c', eqHex());
      // The video's thumbnail where the album art goes (72, radius 14).
      var art = el('div', 'isl-box', pg);
      pos(art, x0, y0, 72, 72);
      art.style.borderRadius = '14px';
      art.style.overflow = 'hidden';
      art.innerHTML = '<svg viewBox="0 0 72 72" width="72" height="72" style="display:block"><defs><linearGradient id="isl-th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22305A"/><stop offset="1" stop-color="#E8734A"/></linearGradient></defs><rect width="72" height="72" fill="url(#isl-th)"/><rect x="12" y="16" width="48" height="34" rx="5" fill="#fff" opacity=".92"/><rect x="18" y="23" width="22" height="4" rx="2" fill="#22305A"/><rect x="18" y="31" width="30" height="3" rx="1.5" fill="#22305A" opacity=".45"/><rect x="18" y="37" width="26" height="3" rx="1.5" fill="#22305A" opacity=".45"/><circle cx="50" cy="40" r="5" fill="#E8734A"/><rect x="12" y="56" width="30" height="4" rx="2" fill="#fff" opacity=".7"/></svg>';
      var tx = x0 + 72 + 14;
      var ccLab = L('CC On');
      var ccW = pillW(ccLab);
      var ccX = blockR - 22 - 12 - ccW;
      btn(pg, ccLab, ccX, y0 + 3 + 14, 'primary:eq', function () { S.cc = !S.cc; refreshPage(); });
      var tw = Math.max(0, ccX - 12 - tx);
      var row = function (cap, size) { return cap - (1.079 - 0.7) * size; };
      T(pg, os === 'mac' ? 'SAFARI' : 'CHROME', tx, row(y0 + 8, 11), tw, 1.33 * 11, { s: 11, w: 600, c: ink(0.5), ls: 0.5 });
      T(pg, C().video.title, tx, row(y0 + 24, 18), tw, 1.33 * 18, { s: 18, w: 600 });
      T(pg, C().video.channel, tx, row(y0 + 49, 15), tw, 1.33 * 15, { s: 15, c: ink(0.62) });
      // The equalizer, top right in the thumbnail's colour.
      var bars = [];
      for (var i = 0; i < 4; i++) {
        var b = el('div', 'isl-eq', pg);
        b.style.left = blockR - 22 + i * 6 + 'px';
        b.style.background = eqHex();
        bars.push(b);
      }
      // The progress row: elapsed, the bar, time left.
      var rowCy = y0 + 90;
      var md = S.media;
      var slot = Math.max(34, Math.ceil(mw('−' + fmtDur(md.dur), 12, 500)));
      var barX = Math.round(x0 + slot + 14);
      var barW = Math.round(blockR - slot - 14) - barX;
      var track = el('div', 'isl-box', pg);
      pos(track, barX, Math.round(rowCy - 2.5), barW, 5);
      track.style.borderRadius = '2.5px';
      track.style.background = ink(0.16);
      var fill = el('div', 'isl-box', track);
      pos(fill, 0, 0, 0, 5);
      fill.style.borderRadius = '2.5px';
      fill.style.background = ink(0.96);
      var cap = rowCy - 0.7 * 12 / 2;
      var tA = T(pg, '', x0, row(cap, 12), slot, 16, { s: 12, w: 500, c: ink(0.62), tab: true });
      var tB = T(pg, '', blockR - slot, row(cap, 12), slot, 16, { s: 12, w: 500, c: ink(0.62), tab: true, a: 'r' });
      // The controls: back and forward (YouTube in a browser offers neither), pause.
      var ccx = x0 + blockW / 2;
      var ccy = y0 + 126;
      var gl = el('div', 'isl-box', pg);
      pos(gl, ccx - 100, ccy - 20, 200, 40);
      var skip = function (cx, fwd) {
        var half = 11;
        var x = cx - half - (ccx - 100);
        var t1 = fwd ? [[x, 12.5], [x + half, 20], [x, 27.5]] : [[x + half, 12.5], [x, 20], [x + half, 27.5]];
        var t2 = t1.map(function (p) { return [p[0] + half, p[1]]; });
        var poly = function (t) { return '<path d="M' + t.map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z" fill="' + ink(0.3) + '" stroke="' + ink(0.3) + '" stroke-width="1.5" stroke-linejoin="round"/>'; };
        return poly(t1) + poly(t2);
      };
      var pause = '<rect x="' + (100 - 2.5 - 7) + '" y="8" width="7" height="24" rx="1.5" fill="' + ink(0.96) + '"/><rect x="' + (100 + 2.5) + '" y="8" width="7" height="24" rx="1.5" fill="' + ink(0.96) + '"/>';
      gl.innerHTML = '<svg viewBox="0 0 200 40" width="200" height="40" style="display:block;overflow:visible">' + skip(ccx - 69, false) + pause + skip(ccx + 69, true) + '</svg>';
      // The captions column: the video's CC as synced lines, each with its translation.
      var col = { x: x0 + a.w - lyrW, y: y0, w: lyrW, h: MEDIA_H };
      var vp = { x: col.x, y: col.y, w: col.w, h: col.h - 14 - 4 };
      var clip = el('div', 'isl-box', pg);
      pos(clip, vp.x - 10, vp.y, vp.w + 20, vp.h);
      clip.style.overflow = 'hidden';
      var rows = CC.map(function (c) {
        var r = el('div', 'isl-lyr', clip);
        r.style.width = vp.w + 'px';
        r.style.fontSize = '16px';
        r.style.left = '10px';
        var s0 = D.createElement('span');
        s0.textContent = c[0];
        r.appendChild(s0);
        var tr = D.createElement('i');
        tr.textContent = c[1];
        tr.style.fontSize = 16 * 0.72 + 'px';
        r.appendChild(tr);
        return { el: r, tr: tr, h16: 0 };
      });
      mediaParts = { bars: bars, fill: fill, barW: barW, tA: tA, tB: tB, rows: rows, vp: vp };
      mediaFrame(performance.now() / 1000, 0, true);
    }
    function mediaFrame(now, dt, first) {
      var mp = mediaParts;
      if (!mp) return false;
      var md = S.media;
      if (md.playing && !reduced) md.pos = Math.min(md.dur, md.pos + dt);
      // Equalizer: each bar at its own pace.
      mp.bars.forEach(function (b, i) {
        var k = reduced ? [0.55, 0.9, 0.4, 0.7][i] : 0.5 + 0.5 * Math.sin(now * (5 + i * 1.3) + i * 1.7);
        var h = lerp(4, 13, k);
        b.style.height = h + 'px';
        b.style.top = HEADER_H + 14 - h / 2 + 'px';
      });
      mp.fill.style.width = Math.max(5, mp.barW * md.pos / md.dur) + 'px';
      mp.tA.textContent = fmtDur(md.pos);
      mp.tB.textContent = '−' + fmtDur(Math.floor(md.dur) - Math.floor(md.pos));
      // A new caption every few seconds; the column follows it, critically damped.
      if (!md.nextAt || first) md.nextAt = now + 3.2;
      if (now >= md.nextAt && !reduced) {
        md.line = (md.line + 1) % CC.length;
        if (md.line === 0) md.p = 0;
        md.nextAt = now + 3.2;
      }
      var target = md.line;
      if (reduced || first) { md.p = target; md.vel = 0; }
      else {
        var w = 12;
        var steps = Math.max(1, Math.ceil(dt * 240));
        var h = dt / steps;
        for (var s = 0; s < steps; s++) {
          var acc = w * w * (target - md.p) - 2 * w * md.vel;
          md.vel += acc * h;
          md.p += md.vel * h;
        }
        if (Math.abs(md.p - target) < 0.006 && Math.abs(md.vel) < 0.03) { md.p = target; md.vel = 0; }
      }
      layoutLyrics(mp, md.p);
      return true;
    }
    function layoutLyrics(mp, p) {
      var vp = mp.vp;
      var n = mp.rows.length;
      p = clamp(p, 0, n - 1);
      var k = Math.floor(p);
      var f = p - k;
      if (!mp.rows[0].el.isConnected) return;
      // Rows are laid out at 16 and drawn scaled; a translation is never
      // under 11 (roman_style), so measure each row at both ends once.
      var trBase = function (size) { return Math.max(size * 0.72, 11) * 16 / size; };
      mp.rows.forEach(function (r) {
        if (r.h16) return;
        r.tr.style.fontSize = trBase(13) + 'px';
        r.h13 = r.el.offsetHeight * 13 / 16;
        r.tr.style.fontSize = trBase(16) + 'px';
        r.h16 = r.el.offsetHeight;
      });
      var info = mp.rows.map(function (r, i) {
        var d = Math.abs(i - p);
        var size = 13 + 3 * clamp(1 - d, 0, 1);
        return { r: r, d: d, size: size, h: lerp(r.h13, r.h16, (size - 13) / 3) };
      });
      var c = [];
      c[k] = 0;
      for (var i = k + 1; i < n; i++) c[i] = c[i - 1] + info[i - 1].h / 2 + 12 + info[i].h / 2;
      for (i = k - 1; i >= 0; i--) c[i] = c[i + 1] - info[i + 1].h / 2 - 12 - info[i].h / 2;
      var anchorC = k + 1 < n ? lerp(c[k], c[k + 1], f) : c[k];
      var anchorY = vp.h / 2;
      info.forEach(function (q, i) {
        var y = anchorY + c[i] - anchorC - q.h / 2;
        var cy = y + q.h / 2;
        var fade = smooth(Math.min(cy, vp.h - cy) / 26);
        var base = q.d <= 1 ? lerp(1, 0.4, q.d) : lerp(0.4, 0.24, Math.min(q.d - 1, 1));
        var al = base * fade;
        var e = q.r.el;
        if (fade <= 0.01 || y > vp.h || y + q.h < 0) { e.style.visibility = 'hidden'; return; }
        e.style.visibility = '';
        e.style.top = y + 'px';
        e.style.transform = 'scale(' + q.size / 16 + ')';
        q.r.tr.style.fontSize = trBase(q.size) + 'px';
        e.style.color = ink(al);
        q.r.tr.style.color = ink(al * 0.72);
      });
    }

    function refreshPage() {
      if (!cardParts || M.pageTr) return;
      var nel = buildPage(S.page);
      cardParts.pages.replaceChild(nel, cardParts.pageEl);
      cardParts.pageEl = nel;
    }

    // ======================================================== morph
    function restingMode() { return S.captions && LINES[S.line] ? 'caption' : 'idle'; }
    function targetMode() { return S.open ? 'card' : restingMode(); }
    function baseGeom(mode) {
      if (mode === 'card') return cardGeom();
      if (mode === 'caption') return capGeom();
      return idleGeom();
    }
    function geomFor(mode) {
      var n = notch();
      if (n && mode === 'idle') {
        // Fit::Inside: a hair smaller than the notch, and not drawn.
        return { w: n.w - 2, h: n.h - 1, r: n.h / 2, dy: 0, top: 0 };
      }
      var g = baseGeom(mode);
      g = { w: g.w, h: g.h, r: g.r, dy: 0, top: topGap(mode) };
      if (mode !== 'card' && hovering()) {
        // motion::hover_lift: swells 3 on every side and sinks 1.
        g = { w: g.w + 2 * HOVER_OUTSET, h: g.h + 2 * HOVER_OUTSET, r: g.r + HOVER_OUTSET, dy: -HOVER_OUTSET + HOVER_SINK, top: g.top };
      }
      return g;
    }
    function buildLayer(mode) {
      if (mode === 'card') return buildCard();
      if (mode === 'caption') return buildCaption();
      return buildIdle();
    }

    // Aim the springs at what the state asks for; a new mode cross-fades.
    function sync(snapNow) {
      var mode = targetMode();
      var g = geomFor(mode);
      var newContent = mode !== M.mode || !M.layer;
      if (newContent) {
        var old = M.layer;
        if (M.ghost && M.ghost.el.parentNode) M.ghost.el.remove();
        M.ghost = null;
        if (old && !snapNow && !reduced) {
          M.ghost = { mode: old.mode, el: old.el, g: old.g, t0: performance.now() / 1000, from: M.content.v };
          old.el.classList.remove('isl-fill');
          pos(old.el, 0, 0, old.g.w, old.g.h);
        } else if (old) {
          old.el.remove();
        }
        if (mode !== 'card') cardParts = null;
        if (mode !== 'caption') capParts = null;
        var layerEl = buildLayer(mode);
        shape.appendChild(layerEl);
        M.layer = { mode: mode, el: layerEl, g: baseGeom(mode) };
        M.mode = mode;
      } else {
        M.layer.g = baseGeom(mode);
        if (mode === 'card') pos(M.layer.el, 0, 0, CARD_W, M.layer.g.h);
      }
      setTarget(g, newContent, snapNow || reduced);
    }

    function setTarget(g, newContent, snapNow) {
      M.target = g;
      if (snapNow) {
        M.w.snap(g.w); M.h.snap(g.h); M.r.snap(Math.min(g.r, g.h / 2)); M.top.snap(Math.max(0, g.top + g.dy));
        M.content.snap(1); M.fadeAt = null; M.floorW = M.floorH = null;
        if (M.ghost) { M.ghost.el.remove(); M.ghost = null; }
        kick();
        return;
      }
      var tw = g.w >= M.w.v ? SP.GROW_W : SP.SHRINK_W;
      var th = g.h >= M.h.v ? SP.GROW_H : SP.SHRINK_H;
      var tr = g.r >= M.r.v ? SP.R_GROW : SP.R_SHRINK;
      M.w.tune(tw); M.h.tune(th); M.r.tune(tr);
      M.floorW = floorOf(M.w, g.w, M.floorW);
      M.floorH = floorOf(M.h, g.h, M.floorH);
      M.w.t = g.w; M.h.t = g.h; M.r.t = Math.min(g.r, g.h / 2);
      M.top.tune(SP.TOP);
      M.top.t = Math.max(0, g.top + g.dy);
      if (newContent) {
        var growing = g.w * g.h > M.w.v * M.h.v;
        M.content.snap(0);
        M.fadeAt = performance.now() / 1000 + (growing ? FADE_DELAY_GROW : FADE_DELAY_SHRINK);
      }
      kick();
    }
    function floorOf(s, to, was) {
      if (to < s.v) return to;
      if (s.vel < 0) return was;
      return null;
    }

    function kick() {
      if (!raf && !destroyed) { lastT = 0; raf = W.requestAnimationFrame(frame); }
    }

    function frame(ts) {
      raf = 0;
      if (destroyed) return;
      var now = ts / 1000;
      var dt = lastT ? Math.min(now - lastT, 0.1) : 1 / 60;
      lastT = now;
      M.w.step(dt); M.h.step(dt); M.r.step(dt);
      if (M.floorW != null && M.w.v < M.floorW) { M.w.v = M.floorW; M.w.vel = 0; }
      if (M.floorH != null && M.h.v < M.floorH) { M.h.v = M.floorH; M.h.vel = 0; }
      if (M.h.settled() && M.r.t >= M.h.t / 2 && M.r.v >= M.h.v / 2) M.r.snap(M.r.t);
      M.top.step(dt);
      if (M.fadeAt != null && now * 1000 >= M.fadeAt * 1000) { M.content.t = 1; M.fadeAt = null; }
      M.content.step(dt);
      var anim = !(M.w.settled() && M.h.settled() && M.r.settled() && M.top.settled() && M.fadeAt == null && M.content.settled(0.002));
      paint(now);
      if (M.ghost) anim = true;
      if (pageTrFrame(now)) anim = true;
      if (capFrame(now)) anim = true;
      if (S.open && S.page === 'media' && mediaParts && M.mode === 'card') {
        mediaFrame(now, dt, false);
        if (!reduced) anim = true;
      }
      if (ringFrame(now)) anim = true;
      if (anim) raf = W.requestAnimationFrame(frame);
    }

    function paint(now) {
      var w = Math.max(20, M.w.v);
      var h = Math.max(8, M.h.v);
      var r = Math.max(0, Math.min(M.r.v, h / 2));
      var cx = stageW / 2;
      var top = M.top.v;
      var s = shape.style;
      s.left = cx - w / 2 + 'px';
      s.top = top + 'px';
      s.width = w + 'px';
      s.height = h + 'px';
      s.borderRadius = r + 'px';
      // Where the pointer counts as on it.
      if (M.mode === 'card') pos(hit, cx - w / 2 - HIT_MARGIN, top - HIT_MARGIN, w + 2 * HIT_MARGIN, h + 2 * HIT_MARGIN);
      else pos(hit, cx - w / 2, 0, w, top + h);
      var n = notch();
      notchEl.style.display = n ? '' : 'none';
      if (n) pos(notchEl, cx - n.w / 2, 0, n.w, n.h);
      // Tucked into the notch, the resting island casts no shadow either.
      shape.classList.toggle('isl-tucked', !!n && M.mode === 'idle');
      // Content scales about the middle of the morph's small end (motion::pivot).
      var pv = { x: w / 2, y: Math.min(h, M.target.h) / 2 };
      var a = clamp(M.content.v, 0, 1);
      if (M.layer) {
        var e = M.layer.el;
        var lx = 0;
        if (M.layer.mode === 'card') { lx = (w - CARD_W) / 2; e.style.left = lx + 'px'; }
        if (a < 1) {
          var sc = CONTENT_SCALE_FROM + (1 - CONTENT_SCALE_FROM) * a;
          e.style.transformOrigin = pv.x - lx + 'px ' + pv.y + 'px';
          e.style.transform = 'translateY(' + -CONTENT_DROP * (1 - a) + 'px) scale(' + sc + ')';
          e.style.opacity = String(a);
        } else {
          e.style.transform = '';
          e.style.opacity = '';
        }
      }
      if (M.ghost) {
        var gh = M.ghost;
        var age = now - gh.t0;
        if (age >= OUTGOING_FADE) {
          gh.el.remove();
          M.ghost = null;
        } else {
          var left = 1 - smooth(age / OUTGOING_FADE);
          var shrink = clamp(Math.min(w / Math.max(gh.g.w, 1), h / Math.max(gh.g.h, 1)), GHOST_MIN_SCALE, 1);
          var gx = (w - gh.g.w) / 2;
          gh.el.style.left = gx + 'px';
          gh.el.style.transformOrigin = pv.x - gx + 'px ' + pv.y + 'px';
          gh.el.style.transform = 'scale(' + shrink + ')';
          gh.el.style.opacity = String(gh.from * left);
        }
      }
    }

    // A page switch: the old page fades out sliding away, the new one in;
    // the tabs re-flow and the selection pill glides (pages/mod.rs).
    function selectPage(p) {
      if (!S.open || p === S.page || !cardParts) {
        if (!S.open) S.page = p;
        return;
      }
      var from = S.page;
      var idx = function (k) { for (var i = 0; i < TABS.length; i++) if (TABS[i].k === k) return i; return 0; };
      var dir = idx(p) > idx(from) ? 1 : -1;
      if (M.pageTr) finishPageTr();
      S.page = p;
      if (p === 'minutes') S.toast = S.toast && S.toast.until > Date.now() ? S.toast : null;
      showTip(null);
      cardParts.tabs.forEach(function (t) { t.el.classList.remove('isl-hot'); });
      var el1 = buildPage(p);
      cardParts.pages.appendChild(el1);
      var lay1 = headerLayout(p);
      M.pageTr = { from: from, to: p, el0: cardParts.pageEl, el1: el1, t0: performance.now() / 1000, dir: dir, lay0: cardParts.lay, lay1: lay1 };
      cardParts.pageEl = el1;
      cardParts.lay = lay1;
      // The card springs to the new page's height; the header stays.
      var g = geomFor('card');
      M.layer.g = baseGeom('card');
      pos(M.layer.el, (M.w.v - CARD_W) / 2, 0, CARD_W, M.layer.g.h);
      pos(cardParts.pages, 0, 44, CARD_W, Math.max(M.layer.g.h, cardGeom(from).h) - 44);
      if (reduced) { finishPageTr(); setTarget(g, false, true); return; }
      setTarget(g, false, false);
    }
    function pageTrFrame(now) {
      var tr = M.pageTr;
      if (!tr) return false;
      var t = (now - tr.t0) / PAGE_SWITCH;
      if (t >= 1) { finishPageTr(); return false; }
      var outA = 1 - smooth(t / 0.4);
      var inA = smooth((t - 0.1) / 0.5);
      tr.el0.style.opacity = String(outA);
      tr.el0.style.transform = 'translateX(' + -tr.dir * 20 * (1 - outA) + 'px)';
      tr.el1.style.opacity = String(inA);
      tr.el1.style.transform = 'translateX(' + tr.dir * 20 * (1 - inA) + 'px)';
      placeHeader(tr.lay0, tr.lay1, easeOut3(t / 0.6), tr.from, tr.to);
      return true;
    }
    function finishPageTr() {
      var tr = M.pageTr;
      if (!tr) return;
      M.pageTr = null;
      if (tr.el0.parentNode) tr.el0.remove();
      tr.el1.style.opacity = '';
      tr.el1.style.transform = '';
      if (cardParts) {
        placeHeader(tr.lay1, tr.lay1, 1, tr.to, tr.to);
        pos(cardParts.pages, 0, 44, CARD_W, cardGeom(tr.to).h - 44);
      }
    }

    // ======================================================== hover and open
    function hovering() { return S.realHover || S.fakeHover; }
    function onHoverChange() {
      if (hovering() && !S.open) {
        clearTimeout(dwellTimer);
        if (!S.dwellFrozen) dwellTimer = setTimeout(openCard, o.hoverMs);
        ringStart();
      } else if (!hovering()) {
        clearTimeout(dwellTimer);
        ringStop();
        if (S.open && !S.pinned) closeCard();
      }
      sync(false);
    }
    function openCard() {
      clearTimeout(dwellTimer);
      ringStop();
      if (S.open) return;
      S.open = true;
      sync(false);
    }
    function closeCard() {
      if (!S.open) return;
      if (M.pageTr) finishPageTr();
      S.open = false;
      sync(false);
    }

    // The demo's ring (opts.ring only): fills for the dwell, on the caption pill.
    var ringT0 = 0;
    function ringStart() {
      if (!o.ring || !capParts || !capParts.ring || S.dwellFrozen) return;
      ringT0 = performance.now() / 1000;
      capParts.ring.style.opacity = '1';
      kick();
    }
    function ringStop() {
      ringT0 = 0;
      if (capParts && capParts.ring) {
        capParts.ring.style.opacity = '0';
        capParts.ring.querySelector('.isl-ring-arc').setAttribute('stroke-dashoffset', '1');
      }
    }
    function ringFrame(now) {
      if (!ringT0 || !capParts || !capParts.ring) return false;
      var k = clamp((now - ringT0) / (o.hoverMs / 1000), 0, 1);
      capParts.ring.querySelector('.isl-ring-arc').setAttribute('stroke-dashoffset', String(1 - k));
      return k < 1;
    }

    // The visitor's own pointer.
    if (o.interactive) {
      island.addEventListener('pointerenter', function (ev) {
        if (ev.pointerType === 'touch') return;
        S.realHover = true;
        if (playing) { pauseScript(true); }
        clearTimeout(resumeTimer);
        onHoverChange();
      });
      island.addEventListener('pointerleave', function () {
        S.realHover = false;
        onHoverChange();
        if (resumeWanted) {
          clearTimeout(resumeTimer);
          resumeTimer = setTimeout(function () { if (!S.realHover && resumeWanted) controller.play(); }, 3500);
        }
      });
      // A tap (touch) opens and closes, as a click on the pill does.
      island.addEventListener('click', function () {
        if (!S.open) { if (playing) pauseScript(true); openCard(); }
      });
    }

    // ======================================================== scripted pointer
    function islandOrigin() { return { x: stageW / 2 - CARD_W / 2, y: topGap('card') }; }
    function cursorTo(x, y, ms) {
      cursorAt = { x: x, y: y };
      var st = cursor.style;
      st.transition = reduced || !ms ? 'opacity .25s ease' : 'opacity .25s ease, transform ' + ms + 'ms cubic-bezier(.45,.05,.3,1)';
      st.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)';
    }
    function cursorShow(on) { cursor.classList.toggle('isl-show', !!on && o.cursor); }
    function cursorPress() {
      cursor.classList.add('isl-press');
      later(function () { cursor.classList.remove('isl-press'); }, 140);
    }
    function restPoint() { return { x: stageW / 2 + 250, y: Math.min(o.height - 40, 330) }; }
    function targetPoint(id) {
      var t = targets[id];
      var org = islandOrigin();
      if (!t) return null;
      return { x: org.x + t.x + t.w / 2, y: org.y + t.y + t.h / 2 };
    }
    function tabPoint(k) {
      var lay = cardParts ? cardParts.lay : headerLayout(S.page);
      var org = islandOrigin();
      for (var i = 0; i < TABS.length; i++) if (TABS[i].k === k) return { x: org.x + lay.slots[i][0] + lay.slots[i][1] / 2, y: org.y + 24 };
      return restPoint();
    }

    // ======================================================== the loop
    function later(fn, ms) {
      var id = setTimeout(function () { timers = timers.filter(function (x) { return x !== id; }); fn(); }, ms);
      timers.push(id);
      return id;
    }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function wait(ms, id) {
      return new Promise(function (res, rej) {
        later(function () { if (id === runId) res(); else rej(new Error('stopped')); }, ms);
      });
    }
    function setLine(i, tr) {
      S.line = i;
      S.lineTr = tr;
      capSync(false);
      sync(false);
    }
    function resetScene(snap) {
      clearTimeout(dwellTimer);
      if (M.pageTr) finishPageTr();
      S.captions = false;
      S.open = false;
      S.page = 'live';
      S.pinned = false;
      S.fakeHover = false;
      S.dwellFrozen = false;
      resetData();
      sync(!!snap);
    }

    // REHEARSAL.md, about 16 s: idle; captions start; the pointer rests on
    // the pill (it swells; Opens after 1.5 s); Live; Minutes; Accept; the
    // pointer leaves and it folds; the captions stop and it draws in to idle.
    function runLoop(id) {
      var rp = restPoint();
      resetScene(false);
      cursorTo(rp.x, rp.y, 0);
      cursorShow(true);
      return wait(1100, id)
        .then(function () {
          S.captions = true;
          setLine(2, false); // the first line arrives before its translation
          return wait(800, id);
        })
        .then(function () { setLine(2, true); return wait(1000, id); })
        .then(function () { setLine(3, true); return wait(700, id); })
        .then(function () {
          cursorTo(stageW / 2 + 40, topGap('caption') + 26, 800);
          return wait(800, id);
        })
        .then(function () {
          S.fakeHover = true;
          onHoverChange(); // swells; opens after the dwell
          return wait(o.hoverMs + 100 + 2000, id);
        })
        .then(function () {
          var p = tabPoint('minutes');
          cursorTo(p.x, p.y, 600);
          return wait(600, id);
        })
        .then(function () {
          var i = TABS.map(function (t) { return t.k; }).indexOf('minutes');
          tabHover(i, true);
          return wait(250, id);
        })
        .then(function () {
          cursorPress();
          tabHover(TABS.map(function (t) { return t.k; }).indexOf('minutes'), false);
          selectPage('minutes');
          return wait(900, id);
        })
        .then(function () {
          var p = targetPoint('accept-D-1') || restPoint();
          cursorTo(p.x, p.y, 650);
          return wait(700, id);
        })
        .then(function () {
          var t = targets['accept-D-1'];
          if (t && t.el) t.el.classList.add('isl-hot');
          return wait(250, id);
        })
        .then(function () {
          cursorPress();
          decide('D-1', 0);
          return wait(2200, id);
        })
        .then(function () {
          var rp2 = restPoint();
          cursorTo(rp2.x, rp2.y, 700);
          return wait(250, id);
        })
        .then(function () {
          S.fakeHover = false;
          onHoverChange(); // the pointer is off it: it folds back to the caption pill
          return wait(1700, id);
        })
        .then(function () {
          S.captions = false; // captions stop: the pill draws in to idle
          sync(false);
          return wait(1500, id);
        });
    }

    function startScript() {
      var id = ++runId;
      playing = true;
      resumeWanted = true;
      var go = function () {
        if (id !== runId) return;
        runLoop(id).then(go, function () { /* stopped */ });
      };
      go();
    }
    var resumeWanted = false;
    function pauseScript(keepResume) {
      runId++;
      playing = false;
      clearTimers();
      cursorShow(false);
      S.fakeHover = false;
      S.dwellFrozen = false;
      if (!keepResume) resumeWanted = false;
    }

    // ======================================================== beats
    var BEATS = {
      idle: function () { S.captions = false; S.open = false; },
      captions: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = false; },
      hover: function () {
        S.captions = true; S.line = 3; S.lineTr = true; S.open = false;
        S.fakeHover = true; S.dwellFrozen = true;
        cursorTo(stageW / 2 + 40, topGap('caption') + 26, 0);
        cursorShow(true);
      },
      live: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = true; S.page = 'live'; },
      minutes: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = true; S.page = 'minutes'; },
      accept: function () {
        S.captions = true; S.line = 3; S.lineTr = true; S.open = true; S.page = 'minutes';
        S.items.forEach(function (x) { if (x.rf === 'D-1') x.review = 'Accepted'; });
        S.toast = { text: L('Accepted') + ' D-1', until: Date.now() + 3000, bad: false };
        later(function () { if (S.open && S.page === 'minutes') refreshPage(); }, 3050);
      },
      inbox: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = true; S.page = 'inbox'; },
      media: function () { S.captions = false; S.open = true; S.page = 'media'; },
      today: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = true; S.page = 'today'; },
      fold: function () { S.captions = true; S.line = 3; S.lineTr = true; S.open = false; }
    };

    function go(beat, how) {
      var f = BEATS[beat];
      if (!f) return;
      pauseScript(false);
      clearTimeout(dwellTimer);
      var snap = !!(how && how.snap);
      var wasOpen = S.open;
      var wasPage = S.page;
      S.fakeHover = false;
      S.dwellFrozen = false;
      if (M.pageTr) finishPageTr();
      resetData();
      f();
      if (beat === 'fold' && !wasOpen && !snap) {
        // Fold from the open card, so the fold is seen.
        S.open = true;
        sync(true);
        S.open = false;
      }
      if (S.open && wasOpen && M.mode === 'card' && wasPage !== S.page && !snap) {
        var p = S.page;
        S.page = wasPage;
        refreshPage();
        selectPage(p);
        return;
      }
      if (S.open && M.mode === 'card') { refreshPage(); if (cardParts) { cardParts.lay = headerLayout(S.page); placeHeader(cardParts.lay, cardParts.lay, 1, S.page, S.page); } }
      if (capParts) capSync(true);
      sync(snap);
    }

    // ======================================================== size
    function readScale() {
      if (typeof o.scale === 'number') return o.scale;
      if (o.scale === 'css') {
        var v = parseFloat(getComputedStyle(root).getPropertyValue('--isl-scale'));
        return v > 0 ? v : 1;
      }
      return Math.max(0.05, root.clientWidth / o.screen);
    }
    function layout() {
      var s = readScale();
      if (o.scale !== 'css') root.style.setProperty('--isl-scale', String(s));
      scale = s;
      stageW = root.clientWidth / s;
      stage.style.width = stageW + 'px';
      stage.style.height = o.height + 'px';
      paint(performance.now() / 1000);
    }
    var ro = W.ResizeObserver ? new W.ResizeObserver(layout) : null;
    if (ro) ro.observe(root);
    else W.addEventListener('resize', layout);

    // The live clock, if asked for, ticks on the minute.
    var clockTimer = 0;
    function scheduleClock() {
      if (o.time !== 'live') return;
      var d = new Date();
      clockTimer = setTimeout(function () {
        if (M.layer && M.mode === 'idle') { M.layer.el.remove(); M.layer = null; sync(true); }
        if (cardParts) { var g = cardParts.head.querySelector('.isl-tab-num:last-child'); if (g) g.textContent = fmtClock(demoNow()); }
        scheduleClock();
      }, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 20);
    }

    function rebuild() {
      var wasOpen = S.open;
      if (M.pageTr) finishPageTr();
      if (M.layer) M.layer.el.remove();
      if (M.ghost) M.ghost.el.remove();
      M.layer = null;
      M.ghost = null;
      cardParts = capParts = mediaParts = null;
      applyClasses();
      resetData();
      S.open = wasOpen;
      sync(true);
      layout();
    }

    // ======================================================== controller
    var controller = {
      play: function () {
        clearTimeout(resumeTimer);
        if (playing) return;
        pauseScript(false);
        startScript();
      },
      pause: function () { pauseScript(false); },
      go: go,
      setOS: function (v) { os = v === 'mac' ? 'mac' : 'win'; rebuild(); },
      setLang: function (v) { lang = v === 'id' ? 'id' : 'en'; rebuild(); },
      destroy: function () {
        destroyed = true;
        pauseScript(false);
        clearTimeout(dwellTimer);
        clearTimeout(resumeTimer);
        clearTimeout(clockTimer);
        if (raf) W.cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        else W.removeEventListener('resize', layout);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      // Extras for the host page and for checking.
      open: function (page) { if (page) S.page = page; openCard(); },
      close: closeCard,
      resize: layout, // after the host changes --isl-scale itself (scale 'css')
      get state() { return { mode: M.mode, page: S.page, open: S.open, captions: S.captions, playing: playing }; },
      root: root
    };

    applyClasses();
    resetData();
    layout();
    sync(true);
    scheduleClock();
    root.setAttribute('aria-label', 'The app at the top of the screen: captions, then the open panel with Live and Minutes');
    if (o.autoplay) controller.play();
    return controller;
  }

  W.SMIsland = { mount: mount, version: '1.0.0' };
})();
