/* yravgSubMeetly landing page: language, downloads, the live pill demo, and Kasi. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const REPO = 'yravg/yravgSubMeetly';
  // The hero shows the live installer download count only once it is worth showing.
  const MIN_COUNT = 500;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  /* ---------------- language ---------------- */
  let lang = store.get('smLang') || ((navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en');
  const t = (k, vars) => {
    let s = (SM_I18N[lang] && SM_I18N[lang][k]) ?? SM_I18N.en[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
    return s;
  };
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('meta.title');
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-attr]').forEach((el) => el.dataset.i18nAttr.split(';').forEach((pair) => { const [a, k] = pair.split(':'); el.setAttribute(a, t(k)); }));
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    paintRelease();
    paintCta();
    karaoke();
    if (typeof paintBento === 'function') paintBento();
    if (demo) demo.repaint();
  }
  $$('.lang button').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; store.set('smLang', lang); applyLang(); }));

  /* ---------------- downloads ---------------- */
  const ua = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const isPhone = /iphone|ipad|android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /mac/i.test(ua) && !matchMedia('(hover: hover)').matches);
  const isMac = /mac/i.test(ua) && !isPhone;
  const rel = { v: '1.4.5', win: { url: `https://github.com/${REPO}/releases/latest`, size: 35053230 }, mac: { url: `https://github.com/${REPO}/releases/latest`, size: 67415940 }, count: null };
  const mb = (n) => (n / 1e6).toLocaleString(lang === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' MB';
  function paintCta() {
    const main = isMac ? 'mac' : 'win', alt = isMac ? 'win' : 'mac';
    $('#cta-main').href = isPhone ? '#download' : rel[main].url; $('#cta-alt').href = rel[alt].url;
    $('#cta-main-label').textContent = isPhone ? t('hero.phone') : t(main === 'mac' ? 'hero.mac' : 'hero.win');
    $('#cta-alt').hidden = isPhone;
    $('#cta-alt-label').textContent = t(alt === 'mac' ? 'hero.other.mac' : 'hero.other.win');
    $('#hero-meta').textContent = t('hero.meta', { v: rel.v, size: mb(rel[main].size) });
    $$('.dl').forEach((d) => { const b = $('.btn', d); const mine = !isPhone && d.dataset.os === main; b.classList.toggle('btn-primary', mine || isPhone); b.classList.toggle('btn-ghost', !mine && !isPhone); });
  }
  function paintRelease() {
    for (const os of ['win', 'mac']) {
      const s = $(`[data-size="${os}"]`); if (s) s.textContent = t('dl.size', { size: mb(rel[os].size), v: rel.v });
      const a = $(`[data-href="${os}"]`); if (a) a.href = rel[os].url;
      const h = $(`[data-sha="${os}"]`);
      if (h && rel[os].sha) { h.hidden = false; h.innerHTML = `${t('dl.sha')} <code title="${rel[os].sha}">${rel[os].sha}</code>`; }
    }
    const c = $('#hero-count');
    if (rel.count >= MIN_COUNT) { c.hidden = false; c.innerHTML = t('hero.count', { n: `<b>${rel.count.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US')}</b>` }); }
  }
  $('#cta-main').addEventListener('click', (e) => {
    if (!isPhone || !navigator.share) return;
    e.preventDefault();
    navigator.share({ title: 'yravgSubMeetly', url: location.href.split('#')[0] }).catch(() => { location.hash = 'download'; });
  });

  /* ---------------- the headline captions itself ---------------- */
  let karaokeT = 0;
  function karaoke() {
    const h = $('#h1'); if (!h) return;
    clearTimeout(karaokeT);
    $$('[data-i18n]', h).forEach((sp) => { sp.innerHTML = sp.textContent.split(' ').map((w) => `<span class="w">${w}</span>`).join(' '); });
    if (REDUCED) return;
    const words = $$('.w', h); let i = 0;
    h.classList.add('karaoke');
    const step = () => {
      words.forEach((w, n) => { w.classList.toggle('lit', n <= i); w.classList.toggle('now', n === i); });
      i++;
      if (i < words.length) karaokeT = setTimeout(step, 210);
      else karaokeT = setTimeout(() => { words.forEach((w) => w.classList.remove('now')); h.classList.remove('karaoke'); }, 500);
    };
    karaokeT = setTimeout(step, 350);
  }

  /* ---------------- the nav steps aside for the demo's own pill ---------------- */
  const navEl = $('#nav');
  addEventListener('scroll', () => {
    const r = $('#screen').getBoundingClientRect();
    navEl.classList.toggle('tuck', r.top < 150 && r.bottom > 160);
  }, { passive: true });

  fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((list) => {
      const stable = list.filter((r) => !r.draft && !r.prerelease);
      const latest = stable[0]; if (!latest) return;
      rel.v = latest.tag_name.replace(/^v/, '');
      for (const a of latest.assets) {
        const sha = (a.digest || '').startsWith('sha256:') ? a.digest.slice(7) : '';
        if (/\.exe$/i.test(a.name)) rel.win = { url: a.browser_download_url, size: a.size, sha };
        if (/-mac\.dmg$/i.test(a.name)) rel.mac = { url: a.browser_download_url, size: a.size, sha };
      }
      // installers only: the apps' own update checks fetch latest.json and are not downloads
      rel.count = stable.flatMap((r) => r.assets).filter((a) => /\.(exe|dmg)$/i.test(a.name)).reduce((n, a) => n + a.download_count, 0) || null;
      paintRelease(); paintCta();
    })
    .catch(() => { /* keep the built-in fallback: version, sizes, link to the releases page */ });

  /* ---------------- Kasi actors ---------------- */
  const actors = [];
  class Actor {
    constructor(el, base, { follow = false, blink = true } = {}) {
      this.el = el; this.base = base; this.extra = {}; this.follow = follow; this.gaze = [0, 0];
      this.render(); actors.push(this);
      if (blink && !REDUCED) this.blinkLoop();
    }
    set(extra) { this.extra = extra; this.render(); }
    render(tmp = {}) {
      const o = Object.assign({}, this.base, this.extra, tmp);
      this.el.innerHTML = Kasi.svg(o);
      this.applyGaze();
    }
    applyGaze() {
      const [x, y] = this.gaze;
      $$('.kasi-look', this.el).forEach((n) => { n.style.transform = `translate(${(x * 3.6).toFixed(2)}px,${(y * 3.6).toFixed(2)}px)`; });
    }
    blinkLoop() {
      const next = 2400 + Math.random() * 3600;
      setTimeout(() => {
        const o = Object.assign({}, this.base, this.extra);
        if ((o.eyes || 'open') === 'open' && !this.busy && this.el.isConnected && visible(this.el)) {
          const lids = o.lids || 0;
          [[0, 0.6], [40, 1], [100, 0.6], [150, lids]].forEach(([ms, l]) => setTimeout(() => { if (!this.busy) this.render({ lids: Math.max(l, lids) }); }, ms));
        }
        this.blinkLoop();
      }, next);
    }
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  let px = innerWidth / 2, py = innerHeight / 3, raf = 0;
  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; if (!raf) raf = requestAnimationFrame(look); }, { passive: true });
  function look() {
    raf = 0;
    for (const a of actors) {
      if (!a.follow) continue;
      const r = a.el.getBoundingClientRect(); if (!r.width) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height * (a.follow === 'hang' ? 0.32 : 0.5);
      const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      a.gaze = [dx / d * k, dy / d * k]; a.applyGaze();
    }
  }

  const nav = new Actor($('[data-kasi="nav"]'), { pose: 'mark', mouth: 'small' }, { follow: true });
  const big = new Actor($('[data-kasi="big"]'), { pose: 'head' }, { follow: true });
  new Actor($('[data-kasi="flow"]'), { pose: 'listen', small: true, mouth: 'small' }, { follow: true });
  new Actor($('[data-kasi="dl"]'), { pose: 'sit', eyes: 'happy', mouth: 'grin' }, { blink: false });
  new Actor($('[data-kasi="pill"]'), { pose: 'mark', mouth: 'small' }, { follow: true });
  new Actor($('[data-kasi="foot"]'), { pose: 'mark', mouth: 'small' }, { follow: true });
  const STATE_POSES = {
    listen: { pose: 'listen' }, write: { pose: 'scribe' },
    translate: { pose: 'head', yaw: 0.75, earAngle: 30 }, think: { pose: 'think' }, done: { pose: 'happy' }, rest: { pose: 'doze' }
  };
  const STATE_DEMO = { listen: 'listen', write: 'live', translate: 'translate', think: 'minutes', done: 'minutes', rest: 'rest' };
  $$('#states li').forEach((li) => {
    const a = new Actor($('.st-k', li), STATE_POSES[li.dataset.pose], { blink: li.dataset.pose !== 'rest' && li.dataset.pose !== 'done' });
    li.tabIndex = 0; li.setAttribute('role', 'button');
    const play = () => { if (li.dataset.pose === 'translate') swivel(a, 1); demo.go(STATE_DEMO[li.dataset.pose], true); $('#screen').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); };
    li.addEventListener('click', play);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
  });

  // Ears listen to the room on the big Kasi: a small twitch now and then.
  if (!REDUCED) setInterval(() => {
    if (!visible(big.el)) return;
    big.set({ earL: (Math.random() - 0.5) * 14, earR: (Math.random() - 0.5) * 14 });
  }, 1700);
  $('#kasi-stage').addEventListener('click', () => swivel(big, 1));

  // The signature move: a 180° head turn, front -> 3/4 -> back -> 3/4 -> front.
  function swivel(actor, dir = 1, ms = 900) {
    if (REDUCED || actor.busy) return Promise.resolve();
    actor.busy = true;
    return new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        let tmp;
        if (p < 0.3) tmp = { yaw: dir * (p / 0.3) * 0.95 };
        else if (p < 0.7) tmp = { back: true };
        else tmp = { yaw: -dir * (1 - (p - 0.7) / 0.3) * 0.95 };
        actor.render(tmp);
        if (p < 1) requestAnimationFrame(step); else { actor.busy = false; actor.render(); done(); }
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------------- icons ---------------- */
  const I = {
    cc: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.6 10.3a2.3 2.3 0 1 0 0 3.4M16.6 10.3a2.3 2.3 0 1 0 0 3.4"/>',
    tr: '<path d="M3 19 7.4 7.5 11.8 19M4.8 15.2h5.2M13.5 5.5h7.5M17.2 4v1.5M15 9c1.4 3.8 3.6 5.8 6 6.8M21 9c-1.1 3.6-3.4 6-6.4 7.4"/>',
    meet: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3 19.5c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9.2" r="2.5"/><path d="M16.2 13.6c2.8.2 4.8 2.4 4.8 5.4"/>',
    min: '<path d="M10 6.5h10M10 12h10M10 17.5h7"/><path d="m3.6 6.3 1.4 1.4 2.6-2.8M3.6 11.8l1.4 1.4 2.6-2.8"/><circle cx="5.2" cy="17.5" r="1.3"/>',
    yt: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10.2 9.3 4.6 2.7-4.6 2.7Z"/>',
    again: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.6 4.3v4.2h-4.2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.3"/>',
    who: '<circle cx="9" cy="8.3" r="3.4"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M17.6 6.4a4.2 4.2 0 0 1 0 5.8M20.2 3.9a7.8 7.8 0 0 1 0 10.8"/>',
    model: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    ask: '<path d="M4.5 5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 3.5V17h-.5A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5Z"/><path d="M12 8.2v4.6M9.7 10.5h4.6"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
    cloud: '<path d="M7 18.5h10.2a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.4 3.4 0 0 0 7 18.5Z"/>'
  };
  $$('[data-ico]').forEach((i) => { i.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[i.dataset.ico] || ''}</svg>`; });

  /* ---------------- palettes ---------------- */
  const PAL = [['Tide', '#22C55E'], ['Teal', 'hsl(163 82% 40%)'], ['Azure', 'hsl(214 80% 46%)'], ['Violet', 'hsl(262 70% 52%)'], ['Sunset', 'hsl(18 88% 50%)'], ['Rose', 'hsl(342 72% 48%)'], ['Sand', 'hsl(28 62% 40%)'], ['Slate', 'hsl(214 14% 34%)'], ['Citrus', 'hsl(80 70% 52%)']];
  $('#swatches').innerHTML = PAL.map(([n, c]) => `<span class="sw"><i style="--c:${c}"></i>${n}</span>`).join('');

  /* ---------------- tabs: drag to reorder ---------------- */
  (() => {
    const row = $('#tabs-row'); if (!row) return;
    const TABS = ['Live', 'Minutes', 'Media', 'Today', 'Captions', 'Tasks'];
    row.innerHTML = TABS.map((n) => `<li tabindex="0" aria-label="${n}">${n}</li>`).join('');
    let drag = null;
    let press = 0;
    row.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const start = () => { drag = li; li.classList.add('lift'); row.classList.add('dragging'); try { li.setPointerCapture(e.pointerId); } catch {} };
      if (e.pointerType === 'mouse') start(); else press = setTimeout(start, 260);
    });
    row.addEventListener('pointerleave', () => clearTimeout(press));
    row.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const over = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.parentNode === row && n !== drag);
      if (!over) return;
      const r = over.getBoundingClientRect();
      row.insertBefore(drag, e.clientX < r.left + r.width / 2 ? over : over.nextSibling);
    });
    const drop = () => { clearTimeout(press); if (drag) drag.classList.remove('lift'); row.classList.remove('dragging'); drag = null; };
    row.addEventListener('pointerup', drop); row.addEventListener('pointercancel', drop);
    row.addEventListener('keydown', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      if (e.key === 'ArrowLeft' && li.previousElementSibling) { row.insertBefore(li, li.previousElementSibling); li.focus(); }
      if (e.key === 'ArrowRight' && li.nextElementSibling) { row.insertBefore(li.nextElementSibling, li); li.focus(); }
    });
  })();

  let restStyle = 'kasi';
  $$('.rest').forEach((b) => b.addEventListener('click', () => {
    restStyle = b.dataset.rest;
    $$('.rest').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (demo.state() === 'rest') demo.go('rest', true);
  }));

  /* ---------------- feature cards: small pills with sample text ---------------- */
  function paintBento() {
    const s = SAMPLE[lang];
    const v = (k) => $(`[data-viz="${k}"]`);
    v('live').innerHTML = `<div class="mp"><div class="p-head"><span class="rec"></span>${esc(s.live)} · ${esc(s.call)}</div><div class="cap-lines" style="padding:6px 0 2px">` +
      s.lines.slice(0, 2).map(([w, x], n) => `<div class="cap-line ${n ? 'now' : ''}"><b>${esc(w)}</b>${esc(x)}</div>`).join('') + '</div></div>';
    v('tr').innerHTML = `<div class="mp"><div class="p-head">中文 → ${lang === 'id' ? 'Indonesia' : 'English'}</div><div class="cap-lines" style="padding:6px 0 2px">` +
      s.trLines.slice(0, 2).map(([a, b], n) => `<div class="cap-line ${n ? 'now' : ''}"><span class="src">${esc(a)}</span><span class="tr">${esc(b)}</span></div>`).join('') + '</div></div>';
    v('min').innerHTML = `<div class="mp"><div class="p-head">${esc(s.minutes)}<span class="sp"></span></div><div class="reg">` +
      s.reg.map(([k, tag, tx]) => `<div class="reg-row"><span class="tag ${k}">${esc(tag)}</span><span class="tx">${esc(tx)}</span></div>`).join('') + '</div></div>';
  }

  /* ---------------- the live pill demo ---------------- */
  const SAMPLE = {
    en: {
      call: 'Teams call', live: 'Live', you: 'You',
      lines: [['Alya', 'Okay, the new build is ready for review.'], ['Wei Jie', 'Can we ship it on Friday?'], ['Alya', 'Yes, if Dimas books the demo room today.'], ['Dimas', 'I’ll book it after this call.']],
      trLines: [['我们周五发布。', 'We ship on Friday.'], ['演示室还没订。', 'The demo room isn’t booked yet.'], ['谁负责应用商店页面？', 'Who owns the store listing?']],
      minutes: 'Weekly sync', wait: '3 to review',
      reg: [['d', 'Decision', 'Ship the new build on Friday', 'Accept'], ['a', 'Action', 'Book the demo room · Dimas', 'Assign'], ['q', 'Question', 'Who owns the store listing?', 'Carry']],
      yt: 'Designing for small screens · Lecture 4', ready: 'CC ready',
      ytLines: [['画面の端にあるピクセルは', 'Every pixel at the edge of the screen'], ['そこにいる理由が必要です。', 'has to earn its place.']], ytPair: '日本語 → English',
      today: [['09:00', 'Stand-up', 'done'], ['11:00', 'Weekly sync', 'join'], ['14:30', 'Vendor review', '']], join: 'Join', done: 'Done', todayH: 'Today'
    },
    id: {
      call: 'Rapat Teams', live: 'Langsung', you: 'Anda',
      lines: [['Alya', 'Oke, build baru sudah siap ditinjau.'], ['Wei Jie', 'Bisa kita rilis hari Jumat?'], ['Alya', 'Bisa, kalau Dimas pesan ruang demo hari ini.'], ['Dimas', 'Saya pesan setelah rapat ini.']],
      trLines: [['我们周五发布。', 'Kita rilis hari Jumat.'], ['演示室还没订。', 'Ruang demo belum dipesan.'], ['谁负责应用商店页面？', 'Siapa yang pegang halaman toko aplikasi?']],
      minutes: 'Rapat mingguan', wait: '3 perlu ditinjau',
      reg: [['d', 'Keputusan', 'Rilis build baru hari Jumat', 'Terima'], ['a', 'Tindak lanjut', 'Pesan ruang demo · Dimas', 'Tugaskan'], ['q', 'Pertanyaan', 'Siapa yang pegang halaman toko?', 'Bawa']],
      yt: 'Merancang untuk layar kecil · Kuliah 4', ready: 'CC siap',
      ytLines: [['Every pixel at the edge of the screen', 'Setiap piksel di tepi layar'], ['has to earn its place.', 'harus layak ada di sana.']], ytPair: 'English → Indonesia',
      today: [['09:00', 'Stand-up', 'done'], ['11:00', 'Rapat mingguan', 'join'], ['14:30', 'Tinjauan vendor', '']], join: 'Join', done: 'Selesai', todayH: 'Hari ini'
    }
  };
  const ORDER = ['rest', 'listen', 'live', 'translate', 'minutes', 'youtube', 'today'];
  const DUR = { rest: 3600, listen: 3400, live: 9000, translate: 8200, minutes: 6200, youtube: 6400, today: 5200 };
  const clock = () => new Date().toLocaleTimeString(lang === 'id' ? 'id-ID' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const demo = (() => {
    const island = $('#island'), pill = $('#pill'), inner = $('#pill-in'), screen = $('#screen');
    const hanger = new Actor($('#hanger'), { pose: 'hang' }, { follow: 'hang' });
    const mini = document.createElement('span'); mini.className = 'p-mk';
    let state = 'rest', timers = [], auto = true, autoT = 0, idleT = 0, lastW = innerWidth;
    const clear = () => { timers.forEach(clearTimeout); timers.forEach(clearInterval); timers = []; };
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const every = (fn, ms) => timers.push(setInterval(fn, ms));
    const S = () => SAMPLE[lang];
    const speaking = (who) => $$('.tile', screen).forEach((tl) => tl.classList.toggle('speaking', tl.querySelector('.nm').textContent === who));

    function size(w, html) {
      const max = screen.clientWidth - 28;
      const width = Math.min(w, max);
      const m = document.createElement('div');
      m.className = 'pill-in'; m.style.cssText = `position:absolute;visibility:hidden;inset:auto;width:${width}px;height:auto;`;
      m.innerHTML = html; screen.appendChild(m);
      const h = Math.max(38, m.offsetHeight); m.remove();
      pill.style.setProperty('--pw', width + 'px'); pill.style.setProperty('--ph', h + 'px');
      pill.style.borderRadius = h > 44 ? '26px' : '22px';
    }
    function paint(html, w) {
      size(w, html);
      inner.classList.remove('fade'); void inner.offsetWidth; inner.classList.add('fade');
      inner.innerHTML = html;
    }
    function kasiSize() {
      const k = Math.max(108, Math.min(190, screen.clientWidth * 0.18));
      $('#hanger').style.setProperty('--kw', k + 'px');
    }

    const SCENES = {
      rest() {
        hanger.set({ pose: 'hang', lids: 0.6, earAngle: 40 });
        const style = restStyle;
        if (style === 'min') { paint('', 110); pill.style.setProperty('--ph', '12px'); pill.style.borderRadius = '8px'; }
        else if (style === 'clock') paint(`<div class="p-row"><span class="p-time">${clock()}</span><span class="sp"></span><span class="p-dim">82%</span></div>`, 164);
        else if (style === 'status') paint(`<div class="p-row"><span class="rec" style="background:var(--yellow);box-shadow:none;animation:none"></span><span class="p-time">CC</span><span class="sp"></span><span class="p-dim">${clock()}</span></div>`, 164);
        else { paint(`<div class="p-row"><span class="p-mk" data-mk></span><span class="p-time">${clock()}</span><span class="sp"></span><span class="p-dim">82%</span></div>`, 196); $('[data-mk]', inner).innerHTML = Kasi.svg({ pose: 'doze', small: true }); }
        speaking('');
      },
      listen() {
        hanger.set({ pose: 'hang', earAngle: 22, mouth: 'o', pupil: 1.06, brow: { dip: -30, bump: -45, inner: 0 } });
        paint(`<div class="p-row"><span class="rec"></span><span>${esc(S().call)}</span><span class="sp"></span><span class="bars"><i></i><i></i><i></i><i></i><i></i></span></div>`, 300);
        speaking('Alya');
        every(() => hanger.set({ pose: 'hang', earAngle: 22 + (Math.random() - 0.5) * 10, earL: (Math.random() - .5) * 10, earR: (Math.random() - .5) * 10, mouth: 'o' }), 700);
      },
      live() {
        hanger.set({ pose: 'write' });
        const lines = S().lines; let i = 0, w = 0; const done = [];
        const draw = () => {
          const cur = lines[i], words = cur[1].split(' ');
          const rows = done.slice(-2).map(([who, s]) => `<div class="cap-line"><b>${esc(who)}</b>${esc(s)}</div>`).join('') +
            `<div class="cap-line now"><b>${esc(cur[0])}</b>${esc(words.slice(0, w).join(' '))}<span class="caret"></span></div>`;
          const html = `<div class="p-head"><span class="rec"></span>${esc(S().live)} · ${esc(S().call)}<span class="sp"></span></div><div class="cap-lines">${rows}</div>`;
          if (w === 0 && i === 0) paint(html, 540); else { size(540, html); inner.innerHTML = html; }
          speaking(cur[0]);
        };
        draw();
        every(() => {
          const words = lines[i][1].split(' ');
          if (w < words.length) { w++; draw(); return; }
          done.push(lines[i]); i = (i + 1) % lines.length; w = 0; draw();
        }, REDUCED ? 900 : 170);
      },
      translate() {
        hanger.set({ pose: 'hang', earAngle: 30 });
        const L = S().trLines; let i = 0;
        const draw = (first) => {
          const rows = L.slice(Math.max(0, i - 1), i + 1).map(([src, tr], n, arr) => `<div class="cap-line ${n === arr.length - 1 ? 'now' : ''}"><span class="src">${esc(src)}</span><span class="tr">${esc(tr)}</span></div>`).join('');
          const html = `<div class="p-head">中文 → ${lang === 'id' ? 'Indonesia' : 'English'}<span class="sp"></span><span class="bars"><i></i><i></i><i></i></span></div><div class="cap-lines">${rows}</div>`;
          if (first) paint(html, 540); else { size(540, html); inner.innerHTML = html; }
          speaking('Wei Jie');
        };
        draw(true);
        later(() => swivel(hanger, 1), 500);
        every(() => { i = (i + 1) % L.length; draw(false); swivel(hanger, i % 2 ? -1 : 1); }, 2600);
      },
      minutes() {
        hanger.set({ pose: 'hang', eyes: 'happy', mouth: 'grin', earAngle: 30 });
        const s = S();
        paint(`<div class="p-head">${esc(s.minutes)}<span class="sp"></span><span style="color:var(--yellow)">${esc(s.wait)}</span></div><div class="reg">` +
          s.reg.map(([k, tag, tx, b], n) => `<div class="reg-row"><span class="tag ${k}">${esc(tag)}</span><span class="tx">${esc(tx)}</span><span class="mbtn ${n === 0 ? 'y' : ''}">${esc(b)}</span></div>`).join('') + '</div>', 560);
        speaking('');
      },
      youtube() {
        hanger.set({ pose: 'hang', earAngle: 26, gaze: [0, -0.6] });
        const s = S(); let i = 0;
        const draw = (first) => {
          const [src, tr] = s.ytLines[i];
          const html = `<div class="yt-title"><span class="ytb"></span>${esc(s.yt)}<span class="ready">${esc(s.ready)}</span></div><div class="p-head" style="padding-top:8px">${esc(s.ytPair)}</div><div class="cap-lines"><div class="cap-line now"><span class="src">${esc(src)}</span><span class="tr">${esc(tr)}</span></div></div>`;
          if (first) paint(html, 520); else { size(520, html); inner.innerHTML = html; }
        };
        draw(true); speaking('');
        every(() => { i = (i + 1) % s.ytLines.length; draw(false); }, 2400);
      },
      today() {
        hanger.set({ pose: 'hang', pose2: 'think', gaze: [0.6, -0.8], earAngle: 30, mouth: 'small' });
        const s = S();
        paint(`<div class="p-head">${esc(s.todayH)}<span class="sp"></span>${clock()}</div><div class="reg" style="gap:0">` +
          s.today.map(([tm, tx, st]) => `<div class="today-row"><span class="tm">${tm}</span><span class="tx">${esc(tx)}</span>${st === 'join' ? `<span class="mbtn y">${esc(s.join)}</span>` : st === 'done' ? `<span class="p-dim">${esc(s.done)}</span>` : ''}</div>`).join('') + '</div>', 460);
        speaking('');
      }
    };

    function go(next, fromUser) {
      clear(); state = next;
      island.dataset.state = next;
      $('#hanger').classList.toggle('sway', next !== 'rest' && !REDUCED);
      $$('#chips button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.state === next)));
      $('#demo-cap').textContent = t('cap.' + next);
      if (fromUser) $('#demo-live').textContent = t('cap.' + next);
      kasiSize();
      SCENES[next]();
      clearTimeout(autoT);
      if (fromUser) { auto = false; clearTimeout(idleT); idleT = setTimeout(() => { auto = true; schedule(); }, 30000); }
      schedule();
    }
    function schedule() {
      clearTimeout(autoT);
      if (!auto || REDUCED) return;
      autoT = setTimeout(() => { if (visible(screen)) go(ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]); else schedule(); }, DUR[state]);
    }
    $$('#chips button').forEach((b) => b.addEventListener('click', () => go(b.dataset.state, true)));
    $('#chips').addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      const i = ORDER.indexOf(state) + (e.key === 'ArrowRight' ? 1 : -1);
      const n = ORDER[(i + ORDER.length) % ORDER.length]; go(n, true); $(`#chips [data-state="${n}"]`).focus();
    });
    addEventListener('resize', () => { if (innerWidth === lastW) return; lastW = innerWidth; kasiSize(); go(state); });
    return { start: () => go('rest'), repaint: () => go(state), go, state: () => state };
  })();

  applyLang();
  demo.start();
})();
