/**
 * Minutes Register — dock/layout layer.
 *
 * Lapisan tata letak untuk src/minutes.html: panel kiri (Navigator), kanan
 * (drawer detail), bawah (sumber segmen), header atas yang bisa dilipat, dok
 * tampilan mengambang, popover Pengaturan (tema, bahasa antarmuka, kepadatan),
 * serta persistensi ukuran/posisi di localStorage.
 *
 * Layout layer for src/minutes.html: left Navigator, right detail drawer,
 * bottom source-segments panel, collapsible top header, floating view dock,
 * Settings popover (theme, interface language, density) and localStorage
 * persistence of sizes/positions. Panels can be resized (splitters), collapsed
 * to rails, torn off into floating windows (drag the panel title) and snapped
 * back by dropping near an edge. Gestures write straight to the DOM and commit
 * to state on release, so dragging never re-renders the register.
 *
 * Visual source of truth: the "Minutes Workspace" Claude Design canvas.
 */
import { nativeHealth, nativeTranslate } from './lib/native.js';
import { pickText } from './lib/notes-schema.js';

const LS_LAYOUT = 'ysmMinutesLayout';
const NATIVE_URL = 'http://127.0.0.1:17865';

/** Target languages the on-device MT tier can produce. */
export const TARGET_LANGS = [
  ['en', 'English'], ['id', 'Bahasa Indonesia'], ['zh', '中文 (Chinese)'], ['ja', '日本語 (Japanese)'],
  ['ms', 'Bahasa Melayu'], ['ar', 'العربية (Arabic)'], ['es', 'Español'], ['de', 'Deutsch'], ['ko', '한국어 (Korean)'],
];

const PANEL_LIMITS = {
  left: { min: 180, max: 420 },
  right: { min: 320, max: 760 },
  bottom: { min: 120, max: 420 },
};

export function defaultLayout() {
  return {
    v: 1,
    theme: 'dark',
    dockArmMs: 1500,      // hover di dok mini selama ini → membuka sendiri (0 = mati)
    dockAnim: 'wipe',     // 'wipe' | 'slide' | 'fade' | 'scale'
    dockSpeed: 1,         // pengali durasi buka/tutup        // 'dark' | 'coretax'
    density: 'comfortable',
    motion: true,
    remember: true,
    top: true,
    left: { mode: 'docked', size: 232, x: 60, y: 80, w: 260, h: 440 },
    right: { mode: 'docked', size: 520, x: 700, y: 60, w: 520, h: 600 },
    bottom: { mode: 'docked', size: 190, x: 260, y: 300, w: 760, h: 260 },
    // Navigator terbuka secara bawaan, jadi dok mulai sebagai ikon (D01): satu-satunya
    // permukaan besar adalah register. Hover/klik tetap membukanya; yang sudah
    // menyimpan tata letak sendiri tidak berubah.
    dock: { pos: 'bottom', x: 300, y: 300, mini: true },
  };
}

export function loadLayout() {
  try {
    const raw = localStorage.getItem(LS_LAYOUT);
    if (!raw) return defaultLayout();
    const saved = JSON.parse(raw);
    const d = defaultLayout();
    return {
      ...d, ...saved,
      left: { ...d.left, ...(saved.left || {}) },
      right: { ...d.right, ...(saved.right || {}) },
      bottom: { ...d.bottom, ...(saved.bottom || {}) },
      dock: { ...d.dock, ...(saved.dock || {}) },
    };
  } catch {
    return defaultLayout();
  }
}

export function clampSize(panel, v) {
  const { min, max } = PANEL_LIMITS[panel];
  return Math.max(min, Math.min(max, Math.round(v)));
}

const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = {
  down: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  up: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
};

/**
 * @param {object} h hooks from minutes.js
 * @param {() => any} h.state          controller state (view, sel, q, tgt, lang, …)
 * @param {() => (k: string, ...a: any[]) => string} h.T
 * @param {() => void} h.paint
 * @param {(ref: string) => void} h.selectRef
 * @param {() => any} h.activeMeeting
 * @param {() => any} h.activeItem
 * @param {(msg: string, bad?: boolean) => void} h.toast
 * @param {(ref: string, patch: any) => Promise<void>} h.editItem
 * @param {(view: string) => void} h.setView
 */
export function mountDock(h) {
  const L = loadLayout();
  const body = $('#body');
  const center = $('#center');
  // Dicari saat dipakai, bukan ditangkap sekali saat mount: register menggambar
  // ulang isinya, jadi simpul yang ditangkap di awal bisa lepas dari dokumen
  // (atau belum ada) dan `el.classList` melempar di tengah paint().
  const panels = {
    get left() { return $('#nav-panel'); },
    get right() { return $('#drawer'); },
    get bottom() { return $('#src-panel'); },
  };
  const splits = {
    get left() { return $('[data-split="left"]'); },
    get right() { return $('[data-split="right"]'); },
    get bottom() { return $('[data-split="bottom"]'); },
  };
  const rails = {
    get left() { return $('#rail-left'); },
    get right() { return $('#rail-right'); },
    get bottom() { return $('#rail-bottom'); },
  };
  const dock = $('#viewdock');
  let T = h.T();
  let gesture = null;
  let translating = null;
  let dockMoved = false;
  let searchOpen = false;

  function save() {
    if (!L.remember) return;
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(L)); } catch { /* quota */ }
  }

  /* ---------------- theme / density / motion ---------------- */
  function applyAppearance() {
    document.documentElement.dataset.theme = L.theme;
    document.documentElement.dataset.density = L.density;
    document.documentElement.classList.toggle('no-motion', !L.motion);
    // Cincin tunggu dan timer harus sepanjang yang sama, jadi CSS membacanya dari sini.
    dock.style.setProperty('--dock-arm-ms', `${armMs()}ms`);
    dock.dataset.anim = ANIMS.includes(L.dockAnim) ? L.dockAnim : 'wipe';
    dock.style.setProperty('--dock-out-ms', `${outMs()}ms`);
    dock.style.setProperty('--dock-in-ms', `${inMs()}ms`);
    const foot = $('#foot-layout');
    if (foot) foot.textContent = T('layoutLine', layoutName(), L.remember ? T('layoutRemembered') : T('layoutNotRemembered'));
  }
  const ANIMS = ['wipe', 'slide', 'fade', 'scale'];
  const OUT_MS = 200;
  const IN_MS = 300;
  /** Pengali kecepatan dari Pengaturan, dibatasi supaya tidak jadi nol. */
  function speed() {
    const v = Number(L.dockSpeed);
    return Number.isFinite(v) && v >= 0.3 && v <= 3 ? v : 1;
  }
  const outMs = () => Math.round(OUT_MS * speed());
  const inMs = () => Math.round(IN_MS * speed());

  /** Lama hover sebelum dok membuka sendiri; 0 mematikan fiturnya. */
  function armMs() {
    const v = Number(L.dockArmMs);
    return Number.isFinite(v) && v >= 0 ? v : 1500;
  }

  /**
   * Ganti antara menu penuh dan ikon dengan animasi. Berpindah mendadak membuat
   * dok terasa hilang: saat mengecil menu diberi waktu keluar dulu, lalu outline
   * menelusuri keliling ikon sekali; saat membuka menu dipasang lalu masuk.
   */
  function setMini(next) {
    next = !!next;
    if (!!L.dock.mini === next) return;
    const commit = () => { L.dock.mini = next; placeDock(); save(); };
    if (!L.motion) return commit();
    if (next) {
      dock.classList.add('dock-collapsing');
      setTimeout(() => {
        dock.classList.remove('dock-collapsing');
        commit();
        dock.classList.add('dock-traced');
        setTimeout(() => dock.classList.remove('dock-traced'), 600);
      }, outMs());
    } else {
      commit();
      dock.classList.add('dock-expanding');
      setTimeout(() => dock.classList.remove('dock-expanding'), inMs() + 20);
    }
  }

  function layoutName() {
    const d = defaultLayout();
    const same = L.top === d.top && ['left', 'right', 'bottom'].every((k) => L[k].mode === d[k].mode && L[k].size === d[k].size);
    return same ? T('layoutDefault') : L.presetName || T('layoutCustom');
  }

  /* ---------------- panel placement ---------------- */
  function placePanel(key) {
    const el = panels[key], p = L[key], split = splits[key], rail = rails[key];
    if (!el || !split || !rail) return;
    el.classList.remove('float', 'dragging');
    el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = '';
    // Put the node back in its docked slot if it was floating.
    if (key === 'left' && el !== body.firstElementChild) body.insertBefore(el, body.firstElementChild);
    if (key === 'right' && el.nextElementSibling !== rails.right) body.insertBefore(el, rails.right);
    if (key === 'bottom' && el.parentNode !== center) center.insertBefore(el, rails.bottom);

    const hasContent = key !== 'right' || !!h.activeItem() || !!h.state().adding;
    if (p.mode === 'docked') {
      el.hidden = !hasContent;
      split.hidden = !hasContent;
      rail.hidden = true;
      el.style[key === 'bottom' ? 'height' : 'width'] = p.size + 'px';
    } else if (p.mode === 'rail') {
      el.hidden = true; split.hidden = true;
      rail.hidden = !hasContent;
    } else {
      el.hidden = !hasContent; split.hidden = true; rail.hidden = true;
      body.appendChild(el);
      el.classList.add('float');
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.width = p.w + 'px'; el.style.height = p.h + 'px';
    }
    const head = el.querySelector('.phead');
    if (head) {
      const bFloat = head.querySelector('[data-act="float"]');
      const bDock = head.querySelector('[data-act="dock"]');
      if (bFloat) bFloat.hidden = p.mode === 'float';
      if (bDock) bDock.hidden = p.mode !== 'float';
    }
  }
  function placeTop() {
    $('#top-panel').classList.toggle('collapsed', !L.top);
    const t = $('#top-toggle');
    t.innerHTML = L.top ? ICON.up : ICON.down;
    t.title = L.top ? T('collapseHeader') : T('expandHeader');
  }
  function placeDock() {
    dock.classList.remove('pos-top', 'pos-bottom', 'pos-free', 'dragging');
    dock.classList.add('pos-' + L.dock.pos);
    dock.classList.toggle('mini', !!L.dock.mini);
    dock.style.left = L.dock.pos === 'free' ? L.dock.x + 'px' : '';
    dock.style.top = L.dock.pos === 'free' ? L.dock.y + 'px' : '';
    dock.style.bottom = ''; dock.style.transform = '';
    $('#dock-full').hidden = !!L.dock.mini;
    $('#dock-mini').hidden = !L.dock.mini;
    dock.classList.toggle('opens-down', L.dock.pos === 'top' || (L.dock.pos === 'free' && L.dock.y < 220));
  }
  function placeAll() {
    placeTop();
    ['left', 'right', 'bottom'].forEach(placePanel);
    placeDock();
    applyAppearance();
  }
  function setMode(key, mode) {
    L[key].mode = mode;
    L.presetName = null;
    placePanel(key); applyAppearance(); save();
  }

  /* ---------------- gestures: direct DOM, commit on release ---------------- */
  function beginGesture(e, g) {
    e.preventDefault();
    try { body.setPointerCapture(e.pointerId); } catch { /* older engines */ }
    document.documentElement.classList.add('gesturing');
    gesture = { ...g, raf: null, last: null, moved: false, hint: null };
  }
  const bodyRect = () => body.getBoundingClientRect();

  body.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const split = e.target.closest('[data-split]');
    if (split) {
      const key = split.dataset.split;
      beginGesture(e, { kind: 'resize', key, el: panels[key], startX: e.clientX, startY: e.clientY, startSize: L[key].size });
      split.classList.add('active');
      return;
    }
    const grip = e.target.closest('.grip');
    if (grip) {
      const el = grip.closest('.panel'); const key = el.dataset.panel;
      beginGesture(e, { kind: 'floatresize', key, el, startX: e.clientX, startY: e.clientY, startW: L[key].w, startH: L[key].h });
      return;
    }
    if (e.target.closest('#viewdock .dgrip, #dock-mini')) {
      const r = dock.getBoundingClientRect();
      beginGesture(e, {
        kind: 'dockmove',
        offX: e.clientX - r.left,
        offY: e.clientY - r.top,
        startX: e.clientX,
        startY: e.clientY,
      });
      return;
    }
    const head = e.target.closest('.panel .phead');
    if (head && !e.target.closest('button, input, select, a')) {
      const el = head.closest('.panel'); const key = el.dataset.panel;
      if (L[key].mode === 'float') {
        const r = bodyRect(); const er = el.getBoundingClientRect();
        beginGesture(e, { kind: 'move', key, el, offX: e.clientX - er.left, offY: e.clientY - er.top, x: er.left - r.left, y: er.top - r.top });
      } else {
        beginGesture(e, { kind: 'undock', key, el, startX: e.clientX, startY: e.clientY });
      }
    }
  });

  body.addEventListener('pointermove', (e) => {
    const g = gesture; if (!g) return;
    g.last = { x: e.clientX, y: e.clientY };
    if (g.raf) return;
    g.raf = requestAnimationFrame(() => { g.raf = null; applyMove(); });
  });

  function setHint(name) {
    body.querySelectorAll('[data-hint]').forEach((el) => el.classList.toggle('show', el.dataset.hint === name));
    if (gesture) gesture.hint = name;
  }

  function applyMove() {
    const g = gesture; if (!g || !g.last) return;
    const r = bodyRect();
    const lx = g.last.x - r.left, ly = g.last.y - r.top;
    if (g.kind === 'resize') {
      const dx = g.last.x - g.startX, dy = g.last.y - g.startY;
      const v = g.key === 'left' ? g.startSize + dx : g.key === 'right' ? g.startSize - dx : g.startSize - dy;
      g.value = clampSize(g.key, v);
      g.el.style[g.key === 'bottom' ? 'height' : 'width'] = g.value + 'px';
    } else if (g.kind === 'undock') {
      if (Math.hypot(g.last.x - g.startX, g.last.y - g.startY) > 14) {
        const p = L[g.key];
        p.mode = 'float'; p.x = Math.max(0, lx - 120); p.y = Math.max(0, ly - 14);
        placePanel(g.key);
        gesture = { ...g, kind: 'move', offX: 120, offY: 14, moved: true };
      }
    } else if (g.kind === 'move') {
      g.moved = true;
      g.x = Math.max(-40, Math.min(r.width - 120, lx - g.offX));
      g.y = Math.max(0, Math.min(r.height - 60, ly - g.offY));
      g.el.style.left = g.x + 'px'; g.el.style.top = g.y + 'px';
      const hint = lx < 110 ? 'left' : lx > r.width - 150 ? 'right' : ly > r.height - 110 ? 'bottom' : null;
      if (hint !== g.hint) setHint(hint);
    } else if (g.kind === 'floatresize') {
      g.w = Math.max(280, g.startW + (g.last.x - g.startX));
      g.h = Math.max(160, g.startH + (g.last.y - g.startY));
      g.el.style.width = g.w + 'px'; g.el.style.height = g.h + 'px';
    } else if (g.kind === 'dockmove') {
      // Ambang seret: jitter beberapa piksel saat MENGKLIK tombol mini bukan niat
      // memindahkan dok. Tanpa ini satu klik biasa sudah menghitung sebagai geser,
      // dok terlepas dari tepinya, lalu mendarat di koordinat lama — mengambang di
      // tengah isi halaman. Ambangnya sama semangatnya dengan gestur `undock`.
      if (!g.moved && Math.hypot(g.last.x - g.startX, g.last.y - g.startY) < 6) return;
      g.moved = true;
      g.x = Math.max(0, Math.min(r.width - 80, lx - g.offX));
      g.y = Math.max(0, Math.min(r.height - 40, ly - g.offY));
      dock.classList.add('pos-free', 'dragging'); dock.classList.remove('pos-top', 'pos-bottom');
      dock.style.left = g.x + 'px'; dock.style.top = g.y + 'px'; dock.style.bottom = 'auto'; dock.style.transform = 'none';
      const snap = ly < 56 ? 'dock-top' : ly > r.height - 56 ? 'dock-bottom' : null;
      if (snap !== g.hint) setHint(snap);
    }
  }

  function endGesture() {
    const g = gesture; if (!g) return;
    if (g.raf) { cancelAnimationFrame(g.raf); g.raf = null; applyMove(); }
    gesture = null;
    document.documentElement.classList.remove('gesturing');
    body.querySelectorAll('[data-split].active').forEach((s) => s.classList.remove('active'));
    const hint = g.hint; setHint(null);
    if (g.kind === 'resize' && g.value != null) L[g.key].size = g.value;
    else if (g.kind === 'move') {
      if (g.x != null) { L[g.key].x = g.x; L[g.key].y = g.y; }
      if (hint && g.moved) { L[g.key].mode = 'docked'; h.toast(T('panelDocked', T('panel_' + g.key))); }
      placePanel(g.key);
    } else if (g.kind === 'floatresize' && g.w != null) { L[g.key].w = g.w; L[g.key].h = g.h; }
    else if (g.kind === 'dockmove') {
      // HANYA seretan nyata yang boleh memindahkan dok. Sebelum penjagaan ini,
      // klik diam pun jatuh ke cabang `: 'free'` — dok lepas dari tepi bawah dan
      // muncul mengambang di koordinat tersimpan yang sudah basi.
      if (g.moved) {
        L.dock.pos = hint === 'dock-top' ? 'top' : hint === 'dock-bottom' ? 'bottom' : 'free';
        if (g.x != null) { L.dock.x = g.x; L.dock.y = g.y; }
      }
      dockMoved = g.moved;
      placeDock();
    }
    L.presetName = null;
    applyAppearance(); save();
  }
  body.addEventListener('pointerup', endGesture);
  body.addEventListener('pointercancel', endGesture);

  /* ---------------- panel header buttons / rails / top ---------------- */
  body.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const key = act.closest('[data-panel]')?.dataset.panel || act.dataset.panel;
    const a = act.dataset.act;
    if (a === 'float') setMode(key, 'float');
    else if (a === 'dock') setMode(key, 'docked');
    else if (a === 'collapse') setMode(key, 'rail');
    else if (a === 'expand') setMode(key, 'docked');
  });
  $('#top-toggle').addEventListener('click', () => { L.top = !L.top; L.presetName = null; placeTop(); applyAppearance(); save(); });

  /* ---------------- presets ---------------- */
  const PRESETS = {
    review: (l) => { l.top = false; l.left.mode = 'rail'; l.right.mode = 'docked'; l.right.size = 560; l.bottom.mode = 'docked'; l.bottom.size = 220; },
    reading: (l) => { l.top = true; l.left.mode = 'rail'; l.right.mode = 'rail'; l.bottom.mode = 'rail'; },
    compact: (l) => { l.top = false; l.left.mode = 'rail'; l.right.mode = 'rail'; l.bottom.mode = 'rail'; l.density = 'compact'; },
  };
  function applyPreset(name) {
    PRESETS[name](L);
    L.presetName = T('preset_' + name);
    placeAll(); save();
  }
  function resetLayout() {
    Object.assign(L, defaultLayout());
    placeAll(); save();
    h.toast(T('layoutReset'));
  }
  $('#nav-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    if (b.dataset.preset === 'reset') resetLayout(); else applyPreset(b.dataset.preset);
  });

  /* ---------------- floating view dock ---------------- */
  function setSearch(open) {
    searchOpen = open;
    const box = $('#dock-search');
    if (box) box.hidden = !open;
    const btn = $('#btn-search-open');
    if (btn) btn.hidden = open;
    if (open) $('#q')?.focus();
  }
  $('#btn-search-open').addEventListener('click', () => { closePops(); setSearch(true); });
  $('#btn-search-close').addEventListener('click', () => {
    const q = $('#q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); setSearch(false);
  });
  // "/" from the controller focuses #q — make sure it is visible first (capture runs before its handler).
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target?.isContentEditable;
    if (e.key === '/' && !typing) { setMini(false); setSearch(true); }
    if (e.key === 'Escape') { if (e.target === $('#q') && !$('#q').value) setSearch(false); closePops(); }
  }, true);
  $('#btn-dock-mini').addEventListener('click', () => { closePops(); setMini(true); });
  $('#dock-mini').addEventListener('click', () => { if (dockMoved) { dockMoved = false; return; } setMini(false); });

  // Membuka dok tanpa klik: arahkan kursor ke tombol mini sampai cincin penuh
  // (lamanya diatur di panel Pengaturan). Sentuh dilewati (tidak punya hover),
  // begitu pula saat sedang menyeret — menahan jari di atas tombol bukan
  // permintaan membuka.
  let hoverTimer = null;
  function cancelHoverExpand() {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    dock.classList.remove('hover-arming');
  }
  $('#dock-mini').addEventListener('pointerenter', (e) => {
    const ms = armMs();
    if (!ms || e.pointerType === 'touch' || !L.dock.mini || gesture) return;
    // Jejak outline memakai lingkaran yang sama; kalau dibiarkan, isian cincin
    // ikut mengulang dari nol dan tidak lagi sejalan dengan timer.
    dock.classList.remove('dock-traced');
    dock.classList.add('hover-arming');
    hoverTimer = setTimeout(() => {
      cancelHoverExpand();
      setMini(false);
    }, ms);
  });
  $('#dock-mini').addEventListener('pointerleave', cancelHoverExpand);
  $('#dock-mini').addEventListener('pointerdown', cancelHoverExpand);

  /* ---------------- popovers (types, translate, settings) ---------------- */
  const POPS = [['#types-pop', '#btn-types'], ['#lang-pop', '#btn-lang'], ['#settings-pop', '#btn-settings']];
  function closePops() {
    POPS.forEach(([pop, btn]) => { $(pop).hidden = true; $(btn).setAttribute('aria-pressed', 'false'); });
  }
  function togglePop(pop, btn, onOpen) {
    const open = $(pop).hidden;
    closePops();
    if (open) { onOpen?.(); $(pop).hidden = false; $(btn).setAttribute('aria-pressed', 'true'); }
  }
  $('#btn-types').addEventListener('click', () => togglePop('#types-pop', '#btn-types'));
  $('#btn-lang').addEventListener('click', () => togglePop('#lang-pop', '#btn-lang', paintLang));
  $('#btn-settings').addEventListener('click', () => togglePop('#settings-pop', '#btn-settings', paintSettings));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#types-pop, #btn-types, #lang-pop, #btn-lang, #settings-pop, #btn-settings')) closePops();
  });

  /* ---------------- translate ---------------- */
  $('#lang-pop').addEventListener('click', (e) => {
    const row = e.target.closest('[data-tgt]');
    if (row) { h.state().tgt = row.dataset.tgt; try { localStorage.setItem('ysmMinutesTgt', row.dataset.tgt); } catch { /* quota */ } paintLang(); h.paint(); return; }
    if (e.target.closest('#btn-translate')) translateInto(h.state().tgt);
  });
  const translatedCount = (m, tgt) => (m ? m.items.filter((it) => it.text && it.text[tgt]).length : 0);
  function paintLang() {
    const s = h.state(); const m = h.activeMeeting();
    const tgt = s.tgt; const total = m ? m.items.length : 0; const done = translatedCount(m, tgt);
    const complete = total > 0 && done === total;
    const set = (sel, prop, val) => { const el = $(sel); if (el) el[prop] = val; };
    set('#lang-tgt', 'textContent', tgt.toUpperCase());
    set('#lang-tgt-name', 'textContent', (TARGET_LANGS.find((l) => l[0] === tgt) || [tgt, tgt])[1]);
    set('#lang-src', 'textContent', (m?.locale || 'auto').toUpperCase());
    set('#lang-done', 'hidden', !complete);
    set('#btn-lang .pend', 'hidden', complete || !m);
    set('#btn-lang', 'title', `${T('translateTitle')} · ${(m?.locale || 'auto').toUpperCase()} → ${tgt.toUpperCase()}`);
    const btn = $('#btn-translate');
    if (btn) {
      btn.disabled = complete || !m || translating != null;
      btn.textContent = translating != null ? T('translating', translating) : complete ? T('translated') : T('translateN', total - done);
    }
    const list = $('#lang-list');
    if (list) list.innerHTML = TARGET_LANGS.map(([code, name]) => {
      const n = translatedCount(m, code);
      const st = total && n === total ? ['done', T('langDone')] : n ? ['part', T('langPartial', n, total)] : ['', T('langReady')];
      return `<button type="button" class="lp-row" data-tgt="${code}" aria-pressed="${code === tgt}"><span class="mono lp-code">${code.toUpperCase()}</span><span class="lp-name">${esc(name)}</span><span class="lp-state ${st[0]}">${esc(st[1])}</span></button>`;
    }).join('');
  }
  async function translateInto(tgt) {
    const m = h.activeMeeting(); if (!m || translating != null) return;
    const src = m.locale || 'auto';
    const health = await nativeHealth(NATIVE_URL).catch(() => null);
    if (!health) { h.toast(T('translateOffline'), true); return; }
    const todo = m.items.filter((it) => it.text && !it.text[tgt]);
    let n = 0;
    translating = 0; paintLang();
    try {
      for (const it of todo) {
        const text = pickText(it.text, src === 'auto' ? 'en' : src);
        const out = await nativeTranslate(NATIVE_URL, text, src, tgt);
        if (out) await h.editItem(it.ref, { text: { ...it.text, [tgt]: out } });
        n += 1; translating = Math.round((n / todo.length) * 100); paintLang();
      }
      h.toast(T('translateDone', n, tgt.toUpperCase()));
    } catch (err) {
      h.toast(String(err?.message || err), true);
    } finally {
      translating = null; paintLang(); h.paint();
    }
  }

  /* ---------------- settings popover ---------------- */
  function paintSettings() {
    const pop = $('#settings-pop');
    pop.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === L.theme)));
    pop.querySelectorAll('[data-density]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.density === L.density)));
    pop.querySelectorAll('[data-armms]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.armms) === armMs())));
    pop.querySelectorAll('[data-anim]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.anim === dock.dataset.anim)));
    pop.querySelectorAll('[data-animspeed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.animspeed) === speed())));
    $('#sw-remember').setAttribute('aria-pressed', String(L.remember));
    $('#sw-motion').setAttribute('aria-pressed', String(!L.motion));
  }
  $('#settings-pop').addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme-pick]');
    if (th) { L.theme = th.dataset.themePick; applyAppearance(); paintSettings(); save(); return; }
    const an = e.target.closest('[data-anim]');
    if (an) { L.dockAnim = an.dataset.anim; applyAppearance(); paintSettings(); save(); return; }
    const sp = e.target.closest('[data-animspeed]');
    if (sp) { L.dockSpeed = Number(sp.dataset.animspeed); applyAppearance(); paintSettings(); save(); return; }
    const arm = e.target.closest('[data-armms]');
    if (arm) { L.dockArmMs = Number(arm.dataset.armms); applyAppearance(); paintSettings(); save(); return; }
    const dn = e.target.closest('[data-density]');
    if (dn) { L.density = dn.dataset.density; applyAppearance(); paintSettings(); save(); return; }
    if (e.target.closest('#sw-remember')) {
      L.remember = !L.remember; paintSettings(); applyAppearance();
      if (L.remember) save(); else { try { localStorage.removeItem(LS_LAYOUT); } catch { /* ignore */ } }
      return;
    }
    if (e.target.closest('#sw-motion')) { L.motion = !L.motion; applyAppearance(); paintSettings(); save(); return; }
    if (e.target.closest('#btn-layout-reset')) resetLayout();
  });

  /* ---------------- navigator: views ---------------- */
  $('#nav-views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    h.setView(b.dataset.view);
  });

  /* ---------------- bottom panel: source segments ---------------- */
  $('#src-body').addEventListener('click', (e) => {
    const row = e.target.closest('[data-ref]');
    if (row) h.selectRef(row.dataset.ref);
  });
  function paintSources() {
    const m = h.activeMeeting(); const s = h.state();
    const host = $('#src-body');
    const count = $('#src-count');
    if (!host) return;
    if (!m) { host.innerHTML = ''; if (count) count.textContent = ''; return; }
    const rows = m.items.filter((it) => it.src).slice().sort((a, b) => (a.src.t0 || 0) - (b.src.t0 || 0));
    if (count) count.textContent = rows.length ? T('srcCount', rows.length, m.items.length) : '';
    if (!rows.length) { host.innerHTML = `<div class="empty" style="padding:18px">${esc(T('noSourcesYet'))}</div>`; return; }
    host.innerHTML = rows.map((it) => {
      const conf = it.confidence == null ? null : Math.round(it.confidence * 100);
      const low = conf != null && conf < 70;
      return `<div class="seg${it.ref === s.sel ? ' cur' : ''}" data-ref="${esc(it.ref)}" role="button" tabindex="0">
        <span class="t mono">${esc(it.src.tc || '')}</span>
        <span class="s">${esc(it.src.speaker || '—')}</span>
        <span class="x">${esc(it.src.tr || it.src.orig || pickText(it.text, s.lang))}</span>
        <span class="r mono">${esc(it.ref)}</span>
        <span class="l mono${low ? ' bad' : ''}">${conf == null ? '' : `ASR ${conf}%`}</span>
      </div>`;
    }).join('');
    const cur = host.querySelector('.seg.cur');
    if (cur && typeof cur.scrollIntoView === 'function') cur.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------- per-paint sync ---------------- */
  function paint() {
    // Lapisan tata letak tidak boleh menggagalkan render register: register
    // menggambar ulang DOM-nya, jadi satu simpul yang belum/tidak ada di sini
    // dulu melempar di tengah paint() dan membatalkan sisa halaman.
    T = h.T();
    const s = h.state();
    $('#nav-views')?.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === s.view)));
    $('#btn-search-open')?.setAttribute('aria-pressed', String(!!s.q));
    if (s.q && !searchOpen) setSearch(true);
    $('#btn-types')?.setAttribute('aria-pressed', String(s.types.size > 0 || s.reviewOnly));
    placePanel('right');
    paintSources();
    paintLang();
    applyAppearance();
  }

  placeAll();
  paintLang();
  return { paint, layout: L, applyPreset, resetLayout };
}
