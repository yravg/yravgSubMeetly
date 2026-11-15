/*
 * Kasi showcase: the macOS and Windows 11 desktops the island sits in.
 *
 *   const d = SMDesktop.mount(el, { os: 'mac' | 'win', scene: 'call' | 'video' | 'empty', lang: 'en' | 'id' });
 *   d.setOS('win'); d.setScene('video'); d.showOverlay(true); d.destroy();
 *   d.islandSlot   // mount the island here
 *   d.overlaySlot  // where the subtitle overlay sits (holds the .dsk-overlay replica)
 *
 * Extra options: frame (true: a laptop around the screen, false: the bare
 * screen), overlay (bool), menu (bool: the Kasi menu open), clock ('HH:MM' to
 * freeze the clock; live otherwise), version (the About line).
 * Extras on the returned object: setLang(lang), showMenu(bool),
 * setCaptions([[spoken, translation], ...] | null), root, state().
 * The root element fires 'dsk:change' (detail { os, scene, lang }) after a
 * change; the island slot carries data-os, data-top, data-gap, data-notch.
 *
 * Where the app sits, from the code (island/crates/poni):
 *  - Island, Mac: the panel hangs from the top of the screen, centred on the
 *    notch (mac/window.rs place(), screen_info() cx). In the default Paper
 *    theme whatever shows floats pill::TOP_GAP (8) under the notch's menu bar,
 *    i.e. notch height + 8 = 40 DIPs from the top (mac/notch.rs pill_gap); at
 *    rest it hides inside the notch (Fit::Inside). Notch 185 x 32
 *    (notch.rs Notch::MACBOOK).
 *  - Island, Windows: centred on the monitor (window.rs MonitorInfo::center_x),
 *    hanging from the monitor's top edge (MonitorInfo::top, unless the
 *    taskbar is docked at the top); Paper floats it 8 DIPs below (app.rs
 *    set_floating(TOP_GAP)).
 *  - Subtitle overlay: bottom centre of the screen, 56 DIPs above its bottom
 *    edge, 80 % of the screen's width up to 1400 (poni-core overlay.rs
 *    place(), strip_width(), BOTTOM_GAP).
 */
(function () {
  'use strict';

  var GEO = {
    mac: { sw: 1512, sh: 945, notch: { w: 185, h: 32 }, gap: 8, top: 40, win: { x: 216, y: 104, w: 1080, h: 588 } },
    win: { sw: 1536, sh: 960, notch: null, gap: 8, top: 8, win: { x: 228, y: 84, w: 1080, h: 584 } }
  };

  // ---------------------------------------------------------------- strings

  var STR = {
    en: {
      app: { empty: 'Finder', call: 'Meetings', video: 'Browser' },
      menus: {
        empty: ['File', 'Edit', 'View', 'Go', 'Window', 'Help'],
        call: ['File', 'Edit', 'View', 'Meeting', 'Window', 'Help'],
        video: ['File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help']
      },
      callTitle: 'Weekly release sync',
      people: ['Alya', 'Wei Jie', 'Dimas', 'You'],
      leave: 'Leave',
      tab2: 'Course notes · Week 4',
      views: '18K views · 2 days ago',
      subs: '48K subscribers',
      upNext: 'Up next',
      files: ['Agenda.pdf', 'Release notes.txt'],
      bin: 'Recycle Bin',
      search: 'Search',
      weather: 'Partly sunny',
      aria: { mac: 'Kasi on a Mac', win: 'Kasi on Windows 11' },
      days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      listening: 'Listening …'
    },
    id: {
      app: { empty: 'Finder', call: 'Rapat', video: 'Peramban' },
      menus: {
        empty: ['Arsip', 'Edit', 'Tampilan', 'Pergi', 'Jendela', 'Bantuan'],
        call: ['Arsip', 'Edit', 'Tampilan', 'Rapat', 'Jendela', 'Bantuan'],
        video: ['Arsip', 'Edit', 'Tampilan', 'Riwayat', 'Penanda', 'Jendela', 'Bantuan']
      },
      callTitle: 'Sinkronisasi rilis mingguan',
      people: ['Alya', 'Wei Jie', 'Dimas', 'Anda'],
      leave: 'Keluar',
      tab2: 'Catatan kuliah · Minggu 4',
      views: '18 rb x ditonton · 2 hari lalu',
      subs: '48 rb pelanggan',
      upNext: 'Berikutnya',
      files: ['Agenda.pdf', 'Catatan rilis.txt'],
      bin: 'Keranjang Sampah',
      search: 'Cari',
      weather: 'Cerah berawan',
      aria: { mac: 'Kasi di Mac', win: 'Kasi di Windows 11' },
      days: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
      listening: 'Listening …'
    }
  };

  // The talk and the next videos keep their own (English) titles in both languages.
  var VIDEO = {
    title: 'Designing for small screens · Lecture 4',
    channel: 'Open Design School',
    host: 'lectures.example.com',
    path: '/small-screens/4',
    time: '14:32 / 41:08',
    next: [
      ['Lecture 5 · Touch targets that fit a thumb', 'Open Design School', '38:12', 'linear-gradient(135deg,#f0b46a,#c4613f)'],
      ['Reading a layout on one hand', 'Field Notes', '12:05', 'linear-gradient(135deg,#5b84e6,#2b3a7a)'],
      ['Type that survives a small screen', 'Open Design School', '27:40', 'linear-gradient(135deg,#2c8a8b,#173d4c)']
    ]
  };

  // What the overlay shows: [spoken line, translation] per sentence (two
  // sentences up, the app's default). The Indonesian call is the snapshot in
  // island/docs/overlay-mac.png word for word.
  var CAPTIONS = {
    call: {
      en: [
        ['Selamat pagi semuanya. Kita mulai dari agenda, ya.', "Good morning, everyone. Let's start with the agenda."],
        ['Butir pertama adalah rencana rilis.', 'The first item is the release plan.']
      ],
      id: [
        ["Welcome, everyone. Let's start with the agenda.", 'Selamat datang semuanya. Mari kita mulai dengan agenda.'],
        ['The first item is the release plan.', 'Butir pertama adalah rencana rilis.']
      ]
    },
    video: {
      en: [
        ['On a small screen, every pixel has to earn its place.', 'Di layar kecil, setiap piksel harus layak mendapat tempatnya.'],
        ['So we start with the one thing people came to do.', 'Jadi kita mulai dari satu hal yang ingin dilakukan orang.']
      ]
    }
  };
  CAPTIONS.video.id = CAPTIONS.video.en;

  // The Kasi menu, item for item as the app builds it (mac/menubar.rs
  // menu_items, tray.rs menu_items), with the new name. The app's menus are
  // English only.
  function kasiMenu(os, st) {
    var about = 'About Kasi ' + st.version;
    if (os === 'mac') {
      return [
        { info: 'Kasi' }, { label: 'Open Kasi', hot: true }, 'Open Minutes register', 'Live captions', 'Meeting', 'Minutes', 'Inbox', 'Copy caption', '-',
        { label: 'Subtitle overlay', check: st.overlay }, 'Pause or resume the overlay', 'Copy the current caption', '-',
        { label: 'Advanced settings…', key: '⌘,' }, '-',
        'Keep island open', { label: 'Theme', sub: true }, { label: 'Idle look', sub: true },
        { label: 'Synced lyrics', check: true }, { label: 'Lyrics pronunciation (romaji, pinyin, Korean)', check: true },
        { label: 'Apple Music lyrics', sub: true }, { label: 'Sounds', check: true }, { label: 'In full-screen apps', sub: true },
        { label: 'Start at login', check: true }, '-',
        'Open settings file', 'Reload settings', 'Open data folder', 'Lyrics by LRCLIB', about, '-',
        { label: 'Quit Kasi', key: '⌘Q' }
      ];
    }
    var capturing = st.scene !== 'empty';
    var items = [
      { info: 'Kasi' }, { label: 'Open Kasi', hot: true }, 'Open Minutes register', 'Live captions', 'Meeting', 'Minutes', 'Inbox', '-',
      { label: 'Subtitle overlay', check: st.overlay }, 'Pause or resume the overlay', 'Copy the current caption', '-',
      { info: 'Engine: running (Rust) on 17865' },
      capturing ? 'Stop live captions' : 'Start live captions (what this PC plays)',
      'Restart engine', 'Set up Chrome extension…', 'Check for updates…', 'Copy caption'
    ];
    if (capturing) items.push('Pause translation');
    return items.concat([
      '-', 'Advanced settings…', 'Keep island open', { label: 'Theme', sub: true }, { label: 'Idle look', sub: true },
      { label: 'Start with Windows', check: true }, '-', { label: 'More', sub: true }, '-', about, 'Quit Kasi'
    ]);
  }

  // ---------------------------------------------------------------- helpers

  var uid = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clockParts(lang, freeze) {
    var d = new Date();
    if (freeze && /^\d{1,2}:\d{2}$/.test(freeze)) {
      var hm = freeze.split(':');
      d.setHours(+hm[0], +hm[1], 0, 0);
    }
    var S = STR[lang], h = d.getHours(), m = pad2(d.getMinutes());
    var h12 = h % 12 || 12, ap = h < 12 ? 'AM' : 'PM';
    if (lang === 'id') {
      return {
        mac: S.days[d.getDay()] + ' ' + d.getDate() + ' ' + S.months[d.getMonth()] + ' ' + pad2(h) + '.' + m,
        winTime: pad2(h) + '.' + m,
        winDate: pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(),
        day: d.getDate(), month: S.months[d.getMonth()].toUpperCase()
      };
    }
    return {
      mac: S.days[d.getDay()] + ' ' + S.months[d.getMonth()] + ' ' + d.getDate() + ' ' + h12 + ':' + m + ' ' + ap,
      winTime: h12 + ':' + m + ' ' + ap,
      winDate: (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(),
      day: d.getDate(), month: S.months[d.getMonth()].toUpperCase()
    };
  }

  // ---------------------------------------------------------------- icons
  // All drawn here; recognisable, not copies of anyone's artwork. `p` keeps
  // gradient and clip ids unique per desktop.

  function sv(vb, inner, attrs) {
    return '<svg viewBox="' + vb + '" aria-hidden="true" focusable="false"' + (attrs ? ' ' + attrs : '') + '>' + inner + '</svg>';
  }
  var STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

  var MARK_BOX = 'M4.5 3 H13.5 Q17 3 17 6.5 V11.5 Q17 15 13.5 15 H4.5 Q1 15 1 11.5 V6.5 Q1 3 4.5 3 Z';
  var MARK_LINES = 'M4 6.6 H8.4 V8.2 H4 Z M9.8 6.6 H14 V8.2 H9.8 Z M4 9.8 H7 V11.4 H4 Z M8.4 9.8 H14 V11.4 H8.4 Z';

  var ICON = {
    apple: sv('0 0 16 17', '<path fill="currentColor" d="M8 5.3C6.8 4.5 4.3 4.4 3.3 6.7 2.4 9 3.4 12.4 5 13.9c.9.8 1.7.4 3 0 1.3.4 2.1.8 3 0 .9-.8 1.6-2 1.9-3-1.3-.5-1.9-1.7-1.8-2.7.1-.9.6-1.6 1.2-2C11.4 4.7 9.3 4.5 8 5.3Z"/><path fill="currentColor" d="M8.1 4.6C8 3.3 9 2.1 10.4 2c.1 1.4-.9 2.5-2.3 2.6Z"/>'),
    // The app's own menu bar mark (mac/menubar.rs mark_image): a caption
    // bubble with two lines of text cut out of it.
    kasiMark: sv('0 0 18 18', '<path fill="currentColor" fill-rule="evenodd" d="' + MARK_BOX + ' ' + MARK_LINES + '"/>', 'class="dsk-i-kasi"'),
    macBatt: sv('0 0 27 13', '<rect x=".75" y=".75" width="22.5" height="11.5" rx="3.3" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.2"/><rect x="2.4" y="2.4" width="15.6" height="8.2" rx="1.8" fill="currentColor"/><path d="M24.7 4.6v3.8c.8-.3 1.3-1 1.3-1.9s-.5-1.6-1.3-1.9Z" fill="currentColor" fill-opacity=".5"/>', 'class="dsk-i-batt"'),
    macWifi: sv('0 0 20 15', '<path ' + STROKE + ' stroke-width="2" d="M2.4 5.6a11 11 0 0 1 15.2 0"/><path ' + STROKE + ' stroke-width="2" d="M5.6 8.9a6.4 6.4 0 0 1 8.8 0"/><circle cx="10" cy="12.3" r="1.75" fill="currentColor"/>'),
    search: sv('0 0 16 16', '<circle cx="6.7" cy="6.7" r="4.9" ' + STROKE + ' stroke-width="1.8"/><path d="m10.4 10.4 4 4" ' + STROKE + ' stroke-width="1.8"/>'),
    control: sv('0 0 18 16', '<rect x="1" y="1.5" width="16" height="5.6" rx="2.8" ' + STROKE + ' stroke-width="1.4"/><rect x="1" y="8.9" width="16" height="5.6" rx="2.8" ' + STROKE + ' stroke-width="1.4"/><circle cx="4" cy="4.3" r="1.9" fill="currentColor"/><circle cx="14" cy="11.7" r="1.9" fill="currentColor"/>'),
    notch: sv('0 0 197 32', '<path fill="#000" d="M0 0H197C193.7 0 191 2.7 191 6V21C191 27.1 186.1 32 180 32H17C10.9 32 6 27.1 6 21V6C6 2.7 3.3 0 0 0Z"/><circle cx="98.5" cy="16" r="3.4" fill="#0a0c14"/><circle cx="98.5" cy="16" r="1.6" fill="#18203a"/><circle cx="97.9" cy="15.4" r=".5" fill="#3a4a7a"/>', 'preserveAspectRatio="none"'),
    check: sv('0 0 12 12', '<path ' + STROKE + ' stroke-width="1.7" d="M2 6.4l2.6 2.6L10 3.2"/>'),
    chev: sv('0 0 8 8', '<path ' + STROKE + ' stroke-width="1.3" d="M2.5 1l3 3-3 3"/>'),
    // Windows tray and taskbar
    up: sv('0 0 16 16', '<path ' + STROKE + ' stroke-width="1.3" d="M4 10l4-4 4 4"/>'),
    winWifi: sv('0 0 16 16', '<path ' + STROKE + ' stroke-width="1.3" d="M1.5 6.2a9.5 9.5 0 0 1 13 0M3.8 8.6a6.2 6.2 0 0 1 8.4 0M6.1 11a3 3 0 0 1 3.8 0"/><circle cx="8" cy="13.2" r=".95" fill="currentColor"/>'),
    vol: sv('0 0 16 16', '<path ' + STROKE + ' stroke-width="1.3" d="M2 6h2.5L8 3v10L4.5 10H2zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9"/>'),
    winBatt: sv('0 0 16 16', '<rect x="1" y="4.5" width="12.5" height="7" rx="1.6" ' + STROKE + ' stroke-width="1.2"/><rect x="2.6" y="6.1" width="7.8" height="3.8" rx=".6" fill="currentColor"/><path d="M14.7 6.6v2.8" ' + STROKE + ' stroke-width="1.2"/>'),
    bell: sv('0 0 16 16', '<path ' + STROKE + ' stroke-width="1.2" d="M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.4H2.8zM6.6 13.6a1.5 1.5 0 0 0 2.8 0"/>'),
    weather: sv('0 0 26 26', '<circle cx="10" cy="10" r="5" fill="#ffc83d"/><path d="M8 21h11a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.4 1.5A3.3 3.3 0 0 0 8 21z" fill="#e8eef8"/>'),
    taskview: sv('0 0 24 24', '<rect x="3" y="5" width="12" height="10" rx="2" fill="#8e9bb5"/><rect x="9" y="9" width="12" height="10" rx="2" fill="#e9eef7" stroke="#222838" stroke-width="1"/>'),
    explorer: sv('0 0 24 24', '<path d="M2.5 6.5a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v1h-19z" fill="#e3a21a"/><path d="M2.5 9h19v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#ffc93c"/><path d="M2.5 9h19v1.6h-19z" fill="#fde39a"/>'),
    winMail: sv('0 0 24 24', '<rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="#2f8cf2"/><path d="M3.8 7.2l8.2 6 8.2-6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>'),
    winGear: sv('0 0 24 24', '<circle cx="12" cy="12" r="7.6" fill="none" stroke="#c9d3e6" stroke-width="3.4" stroke-dasharray="2.98 2.99"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="#c9d3e6" stroke-width="2.4"/>'),
    // window caption buttons
    capMin: sv('0 0 10 10', '<path d="M0 5.5h10" stroke="currentColor" stroke-width="1"/>'),
    capMax: sv('0 0 10 10', '<rect x=".5" y=".5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/>'),
    capClose: sv('0 0 10 10', '<path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" stroke-width="1"/>'),
    // call controls
    mic: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></g>'),
    micOff: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M4 4l16 16"/></g>'),
    camOff: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5zM3 4l17 17"/></g>'),
    share: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M12 13.5V8M9.2 10.6 12 7.8l2.8 2.8M8 20.5h8"/></g>'),
    react: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.2a4.4 4.4 0 0 0 7 0"/></g><circle cx="9.2" cy="9.8" r="1.1" fill="currentColor"/><circle cx="14.8" cy="9.8" r="1.1" fill="currentColor"/>'),
    more: sv('0 0 24 24', '<circle cx="5.5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor"/>'),
    people: sv('0 0 24 24', '<g ' + STROKE + ' stroke-width="1.8"><circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="16.8" cy="9.3" r="2.6"/><path d="M15.8 14.2c2.6.1 4.6 1.6 5.2 4.3"/></g>'),
    chat: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.8" d="M4 5.5h16A1.5 1.5 0 0 1 21.5 7v9a1.5 1.5 0 0 1-1.5 1.5h-10l-4.5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z"/>'),
    phone: sv('0 0 24 24', '<path fill="currentColor" d="M2.6 13.4c5-4.6 13.8-4.6 18.8 0 .4.4.4 1 .1 1.4l-1.5 2c-.3.4-.8.5-1.2.3l-3-1.3c-.4-.2-.6-.6-.6-1v-2.1c-2.1-.7-4.3-.7-6.4 0v2.1c0 .4-.2.8-.6 1l-3 1.3c-.4.2-.9.1-1.2-.3l-1.5-2c-.3-.4-.3-1 .1-1.4z"/>'),
    person: sv('0 0 100 100', '<circle cx="50" cy="38" r="17" fill="rgba(255,255,255,.92)"/><path d="M19 84c3-17 15-27 31-27s28 10 31 27z" fill="rgba(255,255,255,.92)"/>'),
    // player and browser
    pause: sv('0 0 24 24', '<rect x="6" y="5" width="4.2" height="14" rx="1" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1" fill="currentColor"/>'),
    next: sv('0 0 24 24', '<path d="M6 5.5l9.5 6.5L6 18.5z" fill="currentColor"/><rect x="16.2" y="5.5" width="2.6" height="13" rx=".8" fill="currentColor"/>'),
    pvol: sv('0 0 24 24', '<path d="M3.5 9h3.8L12 5v14l-4.7-4H3.5z" fill="currentColor"/><path ' + STROKE + ' stroke-width="1.8" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.6 8.6 0 0 1 0 12"/>'),
    cc: sv('0 0 24 24', '<rect x="2.5" y="5" width="19" height="14" rx="2.5" ' + STROKE + ' stroke-width="1.8"/><path ' + STROKE + ' stroke-width="1.8" d="M10.4 10.1a2.4 2.4 0 1 0 0 3.8M16.8 10.1a2.4 2.4 0 1 0 0 3.8"/>'),
    gear: sv('0 0 24 24', '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="2.75 2.75"/><circle cx="12" cy="12" r="4.4" ' + STROKE + ' stroke-width="1.9"/>'),
    full: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.9" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    back: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.9" d="M15 5l-7 7 7 7"/>'),
    fwd: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.9" d="M9 5l7 7-7 7"/>'),
    reload: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.9" d="M19 12a7 7 0 1 1-2.1-5M19 4.5v4h-4"/>'),
    lock: sv('0 0 16 16', '<rect x="3.5" y="7" width="9" height="7" rx="1.6" fill="currentColor"/><path ' + STROKE + ' stroke-width="1.6" d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>'),
    star: sv('0 0 24 24', '<path ' + STROKE + ' stroke-width="1.7" d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>'),
    kebab: sv('0 0 24 24', '<circle cx="12" cy="5.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18.5" r="1.7" fill="currentColor"/>'),
    plus: sv('0 0 12 12', '<path ' + STROKE + ' stroke-width="1.6" d="M6 1.5v9M1.5 6h9"/>'),
    x: sv('0 0 10 10', '<path ' + STROKE + ' stroke-width="1.4" d="M2 2l6 6M8 2l-6 6"/>'),
    favLecture: sv('0 0 16 16', '<rect width="16" height="16" rx="4" fill="#2c7a7b"/><path d="M6.2 4.6l5.4 3.4-5.4 3.4z" fill="#fff"/>', 'class="dsk-fav"'),
    favDoc: sv('0 0 16 16', '<rect x="2" y="1" width="12" height="14" rx="2.5" fill="#5b84e6"/><path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>', 'class="dsk-fav"'),
    // desktop items
    pdf: sv('0 0 52 52', '<path d="M11 3h21l12 12v31a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#fff"/><path d="M32 3v9a3 3 0 0 0 3 3h9z" fill="#d6dae2"/><path d="M13 21h24M13 25.5h19" stroke="#c4c9d2" stroke-width="1.6"/><rect x="12" y="32" width="22" height="10" rx="2" fill="#e5484d"/><text x="23" y="39.6" font-size="7.4" font-weight="700" text-anchor="middle" fill="#fff" font-family="-apple-system,system-ui,sans-serif">PDF</text>'),
    txt: sv('0 0 52 52', '<path d="M11 3h21l12 12v31a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" fill="#fff"/><path d="M32 3v9a3 3 0 0 0 3 3h9z" fill="#d6dae2"/><path d="M13 21h24M13 26h24M13 31h24M13 36h16" stroke="#aeb4bf" stroke-width="1.6"/>'),
    bin: sv('0 0 44 44', '<path d="M10 12h24l-2.2 26a3 3 0 0 1-3 2.7H15.2a3 3 0 0 1-3-2.7z" fill="rgba(220,235,255,.5)" stroke="rgba(255,255,255,.85)" stroke-width="1"/><rect x="8" y="8.5" width="28" height="4" rx="1.5" fill="rgba(235,243,255,.9)"/><path d="M17 17l.8 18M22 17v18M27 17l-.8 18" stroke="rgba(255,255,255,.6)" stroke-width="1.2"/>')
  };

  function squircle(p, id, c1, c2) {
    return '<defs><linearGradient id="' + p + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
      '<rect x="3" y="3" width="94" height="94" rx="22" fill="url(#' + p + id + ')"/>';
  }

  function dockIcons(p, clock) {
    var body = '<rect x="3" y="3" width="94" height="94" rx="22"';
    return {
      files: sv('0 0 100 100', squircle(p, 'fi', '#86d3ff', '#1f7fe6') +
        '<path d="M22 33a5 5 0 0 1 5-5h14l6 6h26a5 5 0 0 1 5 5v28a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5Z" fill="#cfe9ff"/><path d="M22 42h56v25a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5Z" fill="#fff"/>'),
      browser: sv('0 0 100 100', '<defs><linearGradient id="' + p + 'gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ad0ff"/><stop offset="1" stop-color="#1b5fe0"/></linearGradient></defs>' +
        body + ' fill="#f7f8fb"/><circle cx="50" cy="50" r="33" fill="url(#' + p + 'gl)"/><g fill="none" stroke="#fff" stroke-width="3" opacity=".92"><ellipse cx="50" cy="50" rx="14" ry="33"/><path d="M17 50h66M21.5 35h57M21.5 65h57"/></g>'),
      mail: sv('0 0 100 100', squircle(p, 'ml', '#6bbcff', '#1667de') +
        '<rect x="20" y="30" width="60" height="42" rx="6" fill="#fff"/><path d="M23 34l27 20 27-20" fill="none" stroke="#2a74e4" stroke-width="4" stroke-linejoin="round"/>'),
      messages: sv('0 0 100 100', squircle(p, 'ms', '#7ee57f', '#22b03b') +
        '<path d="M50 23c-17 0-30 11-30 25.5 0 8 4.2 15 11 19.5-1 4-3.2 7.8-6.2 10 6.3 0 11.3-2 15.2-5 3.1.8 6.4 1.2 10 1.2 17 0 30-11 30-25.7S67 23 50 23Z" fill="#fff"/>'),
      calendar: sv('0 0 100 100', body + ' fill="#fff"/><text x="50" y="31" text-anchor="middle" font-size="15" font-weight="600" fill="#ff3b30" font-family="-apple-system,system-ui,sans-serif">' + clock.month + '</text><text class="dsk-cal-day" x="50" y="78" text-anchor="middle" font-size="47" font-weight="300" fill="#1d1d1f" font-family="-apple-system,system-ui,sans-serif">' + clock.day + '</text>'),
      notes: sv('0 0 100 100', body + ' fill="#fffdf6"/><path d="M3 25a22 22 0 0 1 22-22h50a22 22 0 0 1 22 22v4H3Z" fill="#ffd23f"/><path d="M16 45h68M16 59h68M16 73h68" stroke="#dcd6c8" stroke-width="2"/>'),
      music: sv('0 0 100 100', squircle(p, 'mu', '#ff7d97', '#f2385a') +
        '<path d="M38 31l25-7v8l-25 7z" fill="#fff"/><rect x="38" y="31" width="5" height="36" fill="#fff"/><rect x="58" y="24" width="5" height="36" fill="#fff"/><ellipse cx="34" cy="67" rx="9" ry="7" fill="#fff"/><ellipse cx="54" cy="60" rx="9" ry="7" fill="#fff"/>'),
      meet: sv('0 0 100 100', squircle(p, 'mt', '#7884ff', '#3b3fd6') +
        '<rect x="19" y="33" width="43" height="34" rx="9" fill="#fff"/><path d="M65 45.5l16-9.5v28l-16-9.5z" fill="#fff"/>'),
      settings: sv('0 0 100 100', squircle(p, 'st', '#b8bdc5', '#6b7079') +
        '<circle cx="50" cy="50" r="24" fill="none" stroke="#eef0f3" stroke-width="12" stroke-dasharray="8.4 4.17"/><circle cx="50" cy="50" r="17" fill="#eef0f3"/><circle cx="50" cy="50" r="7" fill="#7f848d"/>'),
      trash: sv('0 0 100 100', '<path d="M24 30h52l-5.5 57a6 6 0 0 1-6 5.4H35.5a6 6 0 0 1-6-5.4Z" fill="rgba(240,244,250,.7)" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/><rect x="20" y="22" width="60" height="9" rx="3" fill="rgba(246,248,252,.92)"/><path d="M40 40l2 44M50 40v44M60 40l-2 44" stroke="rgba(160,170,185,.65)" stroke-width="2"/>')
    };
  }

  function winIcons(p) {
    return {
      start: sv('0 0 24 24', '<defs><linearGradient id="' + p + 'wst" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#74dbff"/><stop offset="1" stop-color="#0f72e6"/></linearGradient></defs><g fill="url(#' + p + 'wst)"><rect x="2" y="2" width="9.6" height="9.6" rx="1.2"/><rect x="12.4" y="2" width="9.6" height="9.6" rx="1.2"/><rect x="2" y="12.4" width="9.6" height="9.6" rx="1.2"/><rect x="12.4" y="12.4" width="9.6" height="9.6" rx="1.2"/></g>'),
      browser: sv('0 0 24 24', '<defs><linearGradient id="' + p + 'wbr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fd6c6"/><stop offset="1" stop-color="#1a62d6"/></linearGradient></defs><circle cx="12" cy="12" r="9.5" fill="url(#' + p + 'wbr)"/><g fill="none" stroke="#fff" stroke-width="1.3" opacity=".92"><ellipse cx="12" cy="12" rx="4" ry="9.5"/><path d="M2.5 12h19M3.8 7.3h16.4M3.8 16.7h16.4"/></g>'),
      meet: sv('0 0 24 24', '<defs><linearGradient id="' + p + 'wmt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7884ff"/><stop offset="1" stop-color="#3b3fd6"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="5" fill="url(#' + p + 'wmt)"/><rect x="5.6" y="8.4" width="8.6" height="7.2" rx="2" fill="#fff"/><path d="M14.8 11l3.6-2.2v6.4l-3.6-2.2z" fill="#fff"/>')
    };
  }

  // Kasi's small-size app icon (site/brand/icons/svg/icon-small-16.svg), for
  // the Windows tray.
  function kasiIcon(p) {
    var ear = '<path d="M-22.32 4 C-36 -21 -37.44 -46.8 -23.4 -58.2 Q0 -62.4 23.4 -58.2 C37.44 -46.8 36 -21 22.32 4 Q0 14.4 -22.32 4Z" fill="#C7864E"/><path d="M-13.39 4 C-21.6 -15.54 -22.46 -34.63 -15.12 -43.07 Q0 -46.18 15.12 -43.07 C22.46 -34.63 21.6 -15.54 13.39 4 Q0 8.64 -13.39 4Z" transform="translate(0 -8)" fill="#E2AE7F"/>';
    var eye = function (cx, id) {
      return '<clipPath id="' + p + id + '"><ellipse cx="' + cx + '" cy="2" rx="28" ry="28"/></clipPath><g clip-path="url(#' + p + id + ')"><ellipse cx="' + cx + '" cy="2" rx="28" ry="28" fill="#1B120B"/><ellipse cx="' + (cx - 10.56) + '" cy="-9.52" rx="12.53" ry="11.14" fill="#FFFFFF"/></g>';
    };
    return sv('0 0 1024 1024',
      '<path d="M512 0C860 0 1024 164 1024 512S860 1024 512 1024 0 860 0 512 164 0 512 0Z" fill="#4A3526"/>' +
      '<path d="M512 0C860 0 1024 164 1024 512S860 1024 512 1024 0 860 0 512 164 0 512 0Z" transform="translate(512 512) scale(0.88) translate(-512 -512)" fill="#1B120B"/>' +
      '<g transform="translate(512 595.1) scale(4.6)">' +
      '<g transform="translate(-34 -42) rotate(-36)">' + ear + '</g><g transform="translate(34 -42) rotate(36)">' + ear + '</g>' +
      '<ellipse cx="0" cy="0" rx="70" ry="61" fill="#C7864E"/>' +
      '<path d="M-6 -58 C-12 -84 4 -104 20 -92 C11 -93 3 -86 6 -74 C8 -66 7 -61 6 -58Z" fill="#C7864E"/>' +
      '<path d="M-63 -2 C-64 -30 -44 -38 -24 -32 Q0 -22 24 -32 C44 -38 64 -30 63 -2 C62 30 36 50 0 50 C-36 50 -62 30 -63 -2Z" fill="#FFF0D9"/>' +
      eye(-35, 'kl') + eye(35, 'kr') +
      '<path d="M-5 27 Q0 24 5 27 Q3 32 0 32.5 Q-3 32 -5 27Z" fill="#1B120B"/></g>' +
      '<rect x="128" y="704" width="768" height="192" rx="96" fill="#FFD23F"/>');
  }

  // ---------------------------------------------------------------- wallpapers

  function macWall(p) {
    return sv('0 0 1512 945',
      '<defs>' +
      '<linearGradient id="' + p + 'w1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7bff" stop-opacity=".0"/><stop offset="1" stop-color="#8f7bff" stop-opacity=".5"/></linearGradient>' +
      '<linearGradient id="' + p + 'w2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb48f" stop-opacity=".0"/><stop offset="1" stop-color="#ff9a7c" stop-opacity=".7"/></linearGradient>' +
      '<linearGradient id="' + p + 'w3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".0"/><stop offset=".45" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity=".0"/></linearGradient>' +
      '<filter id="' + p + 'wb" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>' +
      '</defs><g filter="url(#' + p + 'wb)">' +
      '<path d="M-60 300 C 240 210 560 390 860 300 S 1380 170 1580 230 L 1580 262 C 1380 214 1150 330 860 352 S 260 270 -60 350 Z" fill="url(#' + p + 'w3)"/>' +
      '<path d="M-60 560 C 250 430 520 650 820 525 S 1350 385 1580 470 V 1010 H -60 Z" fill="url(#' + p + 'w1)"/>' +
      '<path d="M-60 720 C 300 610 600 790 950 670 S 1400 610 1580 660 V 1010 H -60 Z" fill="url(#' + p + 'w2)"/>' +
      '</g>', 'preserveAspectRatio="none"');
  }

  function winWall(p) {
    var petals = '';
    [-76, -38, 0, 38, 76].forEach(function (a, i) {
      petals += '<ellipse rx="172" ry="400" transform="rotate(' + a + ') translate(0 -240)" fill="url(#' + p + (i % 2 ? 'b2' : 'b1') + ')"/>';
    });
    return sv('0 0 1536 960',
      '<defs>' +
      '<linearGradient id="' + p + 'b1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fa9f5" stop-opacity=".45"/><stop offset=".5" stop-color="#8cc6ff" stop-opacity=".85"/><stop offset="1" stop-color="#1b4fd1" stop-opacity=".05"/></linearGradient>' +
      '<linearGradient id="' + p + 'b2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b97ee" stop-opacity=".4"/><stop offset=".55" stop-color="#5aa4ff" stop-opacity=".75"/><stop offset="1" stop-color="#173f9e" stop-opacity=".05"/></linearGradient>' +
      '<radialGradient id="' + p + 'bg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#6fb3ff" stop-opacity=".55"/><stop offset="1" stop-color="#6fb3ff" stop-opacity="0"/></radialGradient>' +
      '<filter id="' + p + 'bb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '</defs>' +
      '<ellipse cx="768" cy="540" rx="700" ry="460" fill="url(#' + p + 'bg)"/>' +
      '<g transform="translate(768 660)" filter="url(#' + p + 'bb)" style="mix-blend-mode:screen">' + petals + '</g>',
      'preserveAspectRatio="xMidYMid slice"');
  }

  // ---------------------------------------------------------------- scenes

  function lights() {
    return '<div class="dsk-lights"><i class="dsk-light"></i><i class="dsk-light"></i><i class="dsk-light"></i></div>';
  }
  function caps() {
    return '<div class="dsk-caps"><span class="dsk-cap">' + ICON.capMin + '</span><span class="dsk-cap">' + ICON.capMax + '</span><span class="dsk-cap">' + ICON.capClose + '</span></div>';
  }
  function frameStyle(os) {
    var f = GEO[os].win;
    return '--x:' + f.x + ';--y:' + f.y + ';--w:' + f.w + ';--h:' + f.h;
  }

  function callScene(os, S, W) {
    var ppl = [
      { n: S.people[0], i: 'A', c: '#e0803a', t1: '#3d3540', t2: '#232229', speaking: true },
      { n: S.people[1], i: 'WJ', c: '#3d8bfd', t1: '#2c3447', t2: '#1d212b' },
      { n: S.people[2], i: 'D', c: '#2fa36b', t1: '#2a3a35', t2: '#1c2321' },
      { n: S.people[3], c: '#8e5bd6', t1: '#352e45', t2: '#211f29', you: true }
    ];
    var tiles = ppl.map(function (q) {
      return '<div class="dsk-tile' + (q.speaking ? ' is-speaking' : '') + '" style="--t1:' + q.t1 + ';--t2:' + q.t2 + '">' +
        '<div class="dsk-avatar" style="--c:' + q.c + '">' + (q.you ? ICON.person : esc(q.i)) + '</div>' +
        (q.speaking ? '<div class="dsk-wave"><i></i><i></i><i></i></div>' : '') +
        '<div class="dsk-tile-name">' + (q.you ? '<span class="is-muted">' + ICON.micOff + '</span>' : ICON.mic) + esc(q.n) + '</div></div>';
    }).join('');
    var title = os === 'mac'
      ? '<div class="dsk-titlebar">' + lights() + '<span>' + esc(S.callTitle) + '</span></div>'
      : '<div class="dsk-titlebar"><span class="dsk-app-ico">' + W.meet + '</span><span>' + esc(S.callTitle) + ' | ' + esc(S.app.call) + '</span>' + caps() + '</div>';
    return '<div class="dsk-window dsk-call" style="' + frameStyle(os) + '">' + title +
      '<div class="dsk-call-grid">' + tiles + '</div>' +
      '<div class="dsk-call-bar">' +
      '<div class="dsk-call-info"><b>12:41</b><i class="dsk-dot"></i><span>' + esc(S.callTitle) + '</span></div>' +
      '<div class="dsk-call-ctl"><span class="dsk-cbtn is-off">' + ICON.micOff + '</span><span class="dsk-cbtn is-off">' + ICON.camOff + '</span>' +
      '<span class="dsk-cbtn">' + ICON.share + '</span><span class="dsk-cbtn">' + ICON.react + '</span><span class="dsk-cbtn">' + ICON.more + '</span></div>' +
      '<div class="dsk-call-end"><span class="dsk-cbtn is-plain">' + ICON.people + '</span><span class="dsk-badge">4</span><span class="dsk-cbtn is-plain">' + ICON.chat + '</span>' +
      '<span class="dsk-leave">' + ICON.phone + esc(S.leave) + '</span></div>' +
      '</div></div>';
  }

  function lectureFrame(p) {
    return sv('0 0 1600 900',
      '<defs><linearGradient id="' + p + 'v1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3452"/><stop offset="1" stop-color="#121625"/></linearGradient>' +
      '<radialGradient id="' + p + 'v2" cx=".74" cy=".42" r=".45"><stop offset="0" stop-color="#ffdcae" stop-opacity=".24"/><stop offset="1" stop-color="#ffdcae" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="1600" height="900" fill="url(#' + p + 'v1)"/><rect width="1600" height="900" fill="url(#' + p + 'v2)"/>' +
      '<rect y="770" width="1600" height="130" fill="#0c0f18"/>' +
      '<rect x="120" y="110" width="820" height="470" rx="12" fill="#f5f2ea"/>' +
      '<text x="180" y="214" font-size="60" font-weight="700" fill="#1f2638" font-family="-apple-system,system-ui,Segoe UI,sans-serif">Small screens</text>' +
      '<text x="182" y="264" font-size="27" fill="#5b6275" font-family="-apple-system,system-ui,Segoe UI,sans-serif">Lecture 4 · One task per view</text>' +
      '<rect x="182" y="318" width="380" height="16" rx="8" fill="#d8d3c6"/><rect x="182" y="354" width="330" height="16" rx="8" fill="#d8d3c6"/><rect x="182" y="390" width="352" height="16" rx="8" fill="#d8d3c6"/>' +
      '<rect x="182" y="462" width="150" height="54" rx="27" fill="#2c7a7b"/>' +
      '<rect x="700" y="186" width="160" height="324" rx="28" fill="#fff" stroke="#1f2638" stroke-width="8"/>' +
      '<rect x="722" y="232" width="116" height="72" rx="10" fill="#f0b46a"/><rect x="722" y="320" width="116" height="12" rx="6" fill="#d8d3c6"/><rect x="722" y="344" width="88" height="12" rx="6" fill="#d8d3c6"/>' +
      '<rect x="722" y="446" width="116" height="40" rx="20" fill="#2c7a7b"/>' +
      '<path d="M1058 900V612Q1058 474 1190 458Q1322 474 1322 612V900Z" fill="#2f4a7a"/>' +
      '<path d="M1160 461L1190 528L1220 461Z" fill="#e9e4da"/>' +
      '<rect x="1168" y="398" width="44" height="70" rx="18" fill="#bf8763"/>' +
      '<ellipse cx="1190" cy="348" rx="62" ry="72" fill="#d39c76"/>' +
      '<path d="M1128 340Q1124 270 1192 266Q1260 270 1254 336Q1238 298 1192 298Q1150 300 1128 340Z" fill="#2b1f1a"/>' +
      '<path d="M1080 548Q1012 566 968 504" stroke="#2f4a7a" stroke-width="54" stroke-linecap="round" fill="none"/>' +
      '<circle cx="960" cy="494" r="24" fill="#d39c76"/>',
      'preserveAspectRatio="xMidYMid slice"');
  }

  function videoScene(os, S, p) {
    var tabs = os === 'mac' ? lights() : '';
    tabs += '<div class="dsk-tab is-active">' + ICON.favLecture + '<span>' + esc(VIDEO.title) + '</span><span class="dsk-x">' + ICON.x + '</span></div>' +
      '<div class="dsk-tab">' + ICON.favDoc + '<span>' + esc(S.tab2) + '</span><span class="dsk-x">' + ICON.x + '</span></div>' +
      '<div class="dsk-tab-new">' + ICON.plus + '</div>' + (os === 'win' ? caps() : '');
    var next = VIDEO.next.map(function (n) {
      return '<div class="dsk-next"><div class="dsk-thumb" data-len="' + n[2] + '" style="--g:' + n[3] + '"></div><div><p>' + esc(n[0]) + '</p><span>' + esc(n[1]) + '</span></div></div>';
    }).join('');
    return '<div class="dsk-window dsk-br" style="' + frameStyle(os) + '">' +
      '<div class="dsk-br-tabs">' + tabs + '</div>' +
      '<div class="dsk-br-tool">' + ICON.back + ICON.fwd + ICON.reload +
      '<div class="dsk-url">' + ICON.lock + '<span>' + esc(VIDEO.host) + '<em>' + esc(VIDEO.path) + '</em></span></div>' +
      ICON.star + ICON.kebab + '<i class="dsk-avatar-sm"></i></div>' +
      '<div class="dsk-page"><div class="dsk-main">' +
      '<div class="dsk-player">' + lectureFrame(p) +
      '<div class="dsk-player-ctl"><div class="dsk-progress"><i></i><b></b><u></u></div>' +
      '<div class="dsk-player-row">' + ICON.pause + ICON.next + ICON.pvol + '<span>' + VIDEO.time + '</span><span class="dsk-grow"></span>' +
      '<span class="is-on">' + ICON.cc + '</span>' + ICON.gear + ICON.full + '</div></div></div>' +
      '<div class="dsk-vid-title">' + esc(VIDEO.title) + '</div>' +
      '<div class="dsk-vid-meta"><i class="dsk-chan"></i><span><b>' + esc(VIDEO.channel) + '</b><br>' + esc(S.subs) + '</span><span>·</span><span>' + esc(S.views) + '</span></div>' +
      '</div><div class="dsk-side"><h4>' + esc(S.upNext) + '</h4>' + next + '</div></div></div>';
  }

  // ---------------------------------------------------------------- chrome

  function macMenubar(st, S) {
    var menus = S.menus[st.scene].map(function (m) { return '<span class="dsk-mb-item">' + esc(m) + '</span>'; }).join('');
    return '<div class="dsk-mb" aria-hidden="true">' +
      '<div class="dsk-mb-side dsk-mb-left"><span class="dsk-mb-item dsk-mb-apple">' + ICON.apple + '</span>' +
      '<span class="dsk-mb-item dsk-mb-app">' + esc(S.app[st.scene]) + '</span>' + menus + '</div>' +
      '<div class="dsk-mb-side dsk-mb-right">' +
      '<span class="dsk-mb-item dsk-mb-icon dsk-mb-kasi' + (st.menu ? ' is-open' : '') + '">' + ICON.kasiMark + '</span>' +
      '<span class="dsk-mb-item dsk-mb-icon">' + ICON.macBatt + '</span>' +
      '<span class="dsk-mb-item dsk-mb-icon">' + ICON.macWifi + '</span>' +
      '<span class="dsk-mb-item dsk-mb-icon">' + ICON.search + '</span>' +
      '<span class="dsk-mb-item dsk-mb-icon">' + ICON.control + '</span>' +
      '<span class="dsk-mb-item dsk-mb-clock" data-clock="mac"></span>' +
      '</div></div>';
  }

  function macDock(st, D) {
    var apps = [
      ['files', true], ['browser', st.scene === 'video'], ['mail', true], ['messages', false], ['calendar', false],
      ['notes', false], ['music', false], ['meet', st.scene === 'call'], ['settings', false]
    ];
    return '<div class="dsk-dock" aria-hidden="true">' + apps.map(function (a) {
      return '<span class="dsk-dock-app' + (a[1] ? ' is-running' : '') + '">' + D[a[0]] + '</span>';
    }).join('') + '<span class="dsk-dock-sep"></span><span class="dsk-dock-app">' + D.trash + '</span></div>';
  }

  function winTaskbar(st, S, W, p) {
    var btn = function (svg, cls) { return '<span class="dsk-tb-btn' + (cls ? ' ' + cls : '') + '">' + svg + '</span>'; };
    var call = st.scene === 'call', video = st.scene === 'video';
    return '<div class="dsk-tb" aria-hidden="true">' +
      '<div class="dsk-tb-left"><div class="dsk-tb-weather">' + ICON.weather + '<div><b>29°C</b><span>' + esc(S.weather) + '</span></div></div></div>' +
      '<div class="dsk-tb-mid">' + btn(W.start) +
      '<span class="dsk-tb-search">' + ICON.search + '<span>' + esc(S.search) + '</span></span>' +
      btn(ICON.taskview) + btn(ICON.explorer) + btn(W.browser, video ? 'is-running is-active' : '') +
      btn(ICON.winMail, 'is-running') + btn(W.meet, call ? 'is-running is-active' : '') + btn(ICON.winGear) + '</div>' +
      '<div class="dsk-tb-right"><span class="dsk-tb-tray">' + ICON.up + '</span>' +
      '<span class="dsk-tb-tray dsk-tb-kasi' + (st.menu ? ' is-open' : '') + '">' + kasiIcon(p) + '</span>' +
      '<span class="dsk-tb-qs">' + ICON.winWifi + ICON.vol + ICON.winBatt + '</span>' +
      '<span class="dsk-tb-clock" data-clock="win"></span>' +
      '<span class="dsk-tb-tray dsk-tb-bell">' + ICON.bell + '</span></div></div>';
  }

  function menuHTML(os, st) {
    return '<ul>' + kasiMenu(os, st).map(function (it) {
      if (it === '-') return '<li class="dsk-mi-sep"></li>';
      if (typeof it === 'string') it = { label: it };
      if (it.info) return '<li><span class="dsk-mi-check"></span><span class="dsk-mi-label dsk-mi-info">' + esc(it.info) + '</span></li>';
      return '<li' + (it.hot ? ' class="is-hot"' : '') + '><span class="dsk-mi-check">' + (it.check ? ICON.check : '') + '</span>' +
        '<span class="dsk-mi-label">' + esc(it.label) + '</span>' +
        (it.key ? '<span class="dsk-mi-key">' + esc(it.key) + '</span>' : '') +
        (it.sub ? '<span class="dsk-mi-sub">' + ICON.chev + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  // ---------------------------------------------------------------- mount

  function mount(el, opts) {
    if (!el) throw new Error('SMDesktop.mount: no element');
    opts = opts || {};
    var st = {
      os: opts.os === 'win' ? 'win' : 'mac',
      scene: /^(call|video|empty)$/.test(opts.scene) ? opts.scene : 'call',
      lang: opts.lang === 'id' ? 'id' : 'en',
      frame: !(opts.frame === false || opts.frame === 'none'),
      overlay: !!opts.overlay,
      menu: !!opts.menu,
      clock: opts.clock || null,
      version: opts.version || '1.4.5',
      captions: null
    };
    var p = 'dsk' + (++uid) + '-';

    var root = document.createElement('div');
    root.className = 'dsk';
    root.setAttribute('role', 'img');

    var islandSlot = document.createElement('div');
    islandSlot.className = 'dsk-island-slot';
    var overlaySlot = document.createElement('div');
    overlaySlot.className = 'dsk-overlay-slot';
    var overlay = document.createElement('div');
    overlay.className = 'dsk-overlay';
    overlay.setAttribute('aria-live', 'off');
    overlaySlot.appendChild(overlay);

    var timer = null, dead = false;

    function paintClock() {
      var c = clockParts(st.lang, st.clock);
      var mac = root.querySelector('[data-clock="mac"]');
      if (mac) mac.textContent = c.mac;
      var win = root.querySelector('[data-clock="win"]');
      if (win) win.innerHTML = esc(c.winTime) + '<br>' + esc(c.winDate);
      var day = root.querySelector('.dsk-cal-day');
      if (day) day.textContent = c.day;
    }

    function paintOverlay() {
      overlay.hidden = !st.overlay;
      var lines = st.captions || (CAPTIONS[st.scene] ? CAPTIONS[st.scene][st.lang] : null);
      if (!lines || !lines.length) {
        // Nothing said yet: the app shows a quiet "Listening …" (mac/overlay.rs).
        overlay.innerHTML = '<span class="dsk-ov-line dsk-ov-wait" style="font-size:calc(var(--dsk-pt) * ' + (st.os === 'win' ? 24.27 : 18.2) + ');line-height:1.4;color:#b4b4b4">' + esc(STR[st.lang].listening) + '</span>';
        return;
      }
      overlay.innerHTML = lines.map(function (l) {
        return '<span class="dsk-ov-line dsk-ov-src">' + esc(l[0]) + '</span>' + (l[1] ? '<span class="dsk-ov-line dsk-ov-tr">' + esc(l[1]) + '</span>' : '');
      }).join('');
    }

    function placeMenu() {
      var menu = root.querySelector('.dsk-menu');
      if (!menu || menu.hidden) return;
      var screen = root.querySelector('.dsk-screen');
      var g = GEO[st.os];
      var sr = screen.getBoundingClientRect();
      if (!sr.width) return;
      var pt = sr.width / g.sw;
      var anchor = root.querySelector(st.os === 'mac' ? '.dsk-mb-kasi' : '.dsk-tb-kasi');
      if (!anchor) return;
      var ar = anchor.getBoundingClientRect(), mr = menu.getBoundingClientRect();
      var mw = mr.width / pt;
      if (st.os === 'mac') {
        // Under the item, its left edge with the item's, kept on the screen.
        var left = Math.min((ar.left - sr.left) / pt, g.sw - mw - 6);
        menu.style.left = 'calc(var(--dsk-pt) * ' + left.toFixed(1) + ')';
        menu.style.right = 'auto';
      } else {
        // TrackPopupMenu at the pointer on the icon: right edge there when the
        // menu would run off the screen.
        var cx = (ar.left + ar.width / 2 - sr.left) / pt;
        var right = cx + mw > g.sw ? g.sw - cx : g.sw - cx - mw;
        menu.style.right = 'calc(var(--dsk-pt) * ' + right.toFixed(1) + ')';
      }
    }

    function render() {
      var S = STR[st.lang], g = GEO[st.os];
      var D = dockIcons(p, clockParts(st.lang, st.clock)), W = winIcons(p);
      root.setAttribute('data-os', st.os);
      root.setAttribute('data-scene', st.scene);
      root.setAttribute('data-frame', st.frame ? 'laptop' : 'none');
      root.setAttribute('aria-label', S.aria[st.os]);
      root.setAttribute('lang', st.lang);

      var desk = '';
      if (st.os === 'mac') {
        desk = '<div class="dsk-file" style="--x:1412;--y:46">' + ICON.pdf + '<span>' + esc(S.files[0]) + '</span></div>' +
          '<div class="dsk-file" style="--x:1412;--y:134">' + ICON.txt + '<span>' + esc(S.files[1]) + '</span></div>';
      } else {
        desk = '<div class="dsk-file" style="--x:10;--y:10">' + ICON.bin + '<span>' + esc(S.bin) + '</span></div>';
      }
      var scene = st.scene === 'call' ? callScene(st.os, S, W) : st.scene === 'video' ? videoScene(st.os, S, p) : '';

      var screen = '<div class="dsk-wall" aria-hidden="true">' + (st.os === 'mac' ? macWall(p) : winWall(p)) + '</div>' +
        '<div class="dsk-desk" aria-hidden="true">' + desk + '</div>' +
        '<div class="dsk-windows" aria-hidden="true">' + scene + '</div>' +
        (st.os === 'mac' ? macDock(st, D) + macMenubar(st, S) : winTaskbar(st, S, W, p)) +
        '<div class="dsk-menu" aria-hidden="true"' + (st.menu ? '' : ' hidden') + '>' + menuHTML(st.os, st) + '</div>' +
        (st.os === 'mac' ? '<div class="dsk-notch" aria-hidden="true">' + ICON.notch + '</div>' : '');

      root.innerHTML = '<div class="dsk-device"><div class="dsk-lid">' +
        (st.os === 'win' ? '<i class="dsk-cam" aria-hidden="true"></i>' : '') +
        '<div class="dsk-screen">' + screen + '</div></div>' +
        '<div class="dsk-base" aria-hidden="true"></div></div>';

      var scr = root.querySelector('.dsk-screen');
      var menuEl = scr.querySelector('.dsk-menu');
      scr.insertBefore(overlaySlot, menuEl);
      scr.insertBefore(islandSlot, menuEl);

      // What the island needs to know about where it is.
      islandSlot.setAttribute('data-os', st.os);
      islandSlot.setAttribute('data-screen', g.sw + 'x' + g.sh);
      islandSlot.setAttribute('data-top', String(g.top));
      islandSlot.setAttribute('data-gap', String(g.gap));
      islandSlot.setAttribute('data-notch', g.notch ? g.notch.w + 'x' + g.notch.h : '');
      islandSlot.style.setProperty('--dsk-island-gap', String(g.gap));
      islandSlot.style.setProperty('--dsk-notch-w', String(g.notch ? g.notch.w : 0));
      islandSlot.style.setProperty('--dsk-notch-h', String(g.notch ? g.notch.h : 0));
      overlaySlot.setAttribute('data-os', st.os);

      paintOverlay();
      paintClock();
      placeMenu();
    }

    function changed() {
      if (dead) return;
      root.dispatchEvent(new CustomEvent('dsk:change', { bubbles: true, detail: { os: st.os, scene: st.scene, lang: st.lang } }));
    }

    function startClock() {
      if (timer) clearInterval(timer);
      timer = st.clock ? null : setInterval(paintClock, 10000);
    }

    render();
    el.appendChild(root);
    placeMenu();
    startClock();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!dead) placeMenu(); });

    return {
      islandSlot: islandSlot,
      overlaySlot: overlaySlot,
      root: root,
      setOS: function (os) {
        os = os === 'win' ? 'win' : 'mac';
        if (os === st.os) return;
        st.os = os; render(); changed();
      },
      setScene: function (scene) {
        if (!/^(call|video|empty)$/.test(scene) || scene === st.scene) return;
        st.scene = scene; render(); changed();
      },
      setLang: function (lang) {
        lang = lang === 'id' ? 'id' : 'en';
        if (lang === st.lang) return;
        st.lang = lang; render(); changed();
      },
      showOverlay: function (on) {
        st.overlay = !!on;
        paintOverlay();
        var menu = root.querySelector('.dsk-menu');
        if (menu) menu.innerHTML = menuHTML(st.os, st);
      },
      showMenu: function (on) {
        st.menu = !!on;
        var menu = root.querySelector('.dsk-menu');
        if (menu) menu.hidden = !st.menu;
        var a = root.querySelector('.dsk-mb-kasi, .dsk-tb-kasi');
        if (a) a.classList.toggle('is-open', st.menu);
        placeMenu();
      },
      setCaptions: function (lines) {
        st.captions = Array.isArray(lines) ? lines : null;
        paintOverlay();
      },
      state: function () {
        return { os: st.os, scene: st.scene, lang: st.lang, overlay: st.overlay, menu: st.menu, frame: st.frame };
      },
      destroy: function () {
        dead = true;
        if (timer) clearInterval(timer);
        timer = null;
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.SMDesktop = { mount: mount, GEO: GEO };
})();
