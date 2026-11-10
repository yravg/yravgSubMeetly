/**
 * Beranda Today — hero (papan A01): pemandangan pelabuhan, sapaan dengan nama, angka kunci,
 * bilah Tanya Tide dengan Tide mengintip, dan empat chip. Selalu tampil utuh: keadaan sambutan
 * dan kosong menjadi kartu ringkas DI BAWAH hero, tidak menggantikannya.
 *
 * Murni: menerima konteks dari app.js (T, ic, esc, tide, num) dan mengembalikan HTML.
 * Satu maskot per layar: pose di bilah = sambutan (wave) > kosong (sleep) > beres (celebrate) > biasa (shell).
 */

/** Pelabuhan: matahari, mercusuar, dermaga, ombak. Warna dari token Tide, jadi gelap ikut sendiri. */
export function harbourSvg() {
  return `<svg class="harbour" viewBox="0 0 1000 470" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tide-sky-1)"/><stop offset=".62" style="stop-color:var(--tide-sky-2)"/><stop offset="1" style="stop-color:var(--tide-mint)"/></linearGradient></defs><rect width="1000" height="470" fill="url(#hg)"/><circle class="sun" cx="800" cy="120" r="46" style="fill:var(--tide-lime);opacity:.7"/><path d="M0 300 H1000 V470 H0Z" style="fill:var(--tide-sea-1);opacity:.55"/><g style="fill:var(--text2);opacity:.78"><rect x="860" y="198" width="22" height="104"/><path d="M856 198 L871 176 L886 198Z"/><rect x="864" y="168" width="14" height="10"/></g><g style="fill:var(--text2);opacity:.55"><rect x="640" y="288" width="120" height="8"/><rect x="650" y="288" width="4" height="22"/><rect x="700" y="288" width="4" height="22"/><rect x="745" y="288" width="4" height="22"/></g><path d="M0 330 C120 308 230 346 350 326 S580 304 720 332 S910 350 1000 326 V470 H0Z" style="fill:var(--tide-emerald);opacity:.22"/><path d="M0 372 C150 350 270 392 410 372 S660 350 810 380 S950 384 1000 366 V470 H0Z" style="fill:var(--accent-soft);opacity:.2"/><path d="M0 418 C130 400 260 436 400 418 S680 402 820 428 S950 430 1000 414 V470 H0Z" style="fill:var(--tide-mint);opacity:.9"/></svg>`;
}

/** "Good morning." + nama → "Good morning, Enrico." (titik akhir dipindah ke belakang nama). */
export function greeting(base, name) {
  const n = String(name || '').trim();
  return n ? `${String(base).replace(/[.!]$/, '')}, ${n}.` : base;
}

/** Pose maskot di bilah tanya. */
export function heroPose({ welcome, empty, caughtUp }) {
  return welcome ? 'wave' : empty ? 'sleep' : caughtUp ? 'celebrate' : 'shell';
}

/**
 * @param c konteks: { T, ic, esc, tide, num, hm, fmtDate, now, t (computeToday), state, greetKey, pose, caughtUp, eye, synced }
 */
export function heroHtml(c) {
  const { T, ic, esc, tide, num, state, t, now, pose, caughtUp, eye } = c;
  const chipIcons = ['chat', 'flag', 'list', 'globe'];
  const sub = [num(T('nMeetings', t.meetingsToday.length)), c.synced ? esc(T('lastSynced', c.synced)) : '', caughtUp ? esc(T('caughtUp')) : ''].filter(Boolean).join(' · ');
  return `<section class="hero${state.hideNumbers ? ' masked' : ''}">
    <div class="hero-bg" aria-hidden="true">${harbourSvg()}</div>
    <h2>${esc(greeting(T(c.greetKey), state.userName))}</h2>
    <div class="dateline">${esc(T('todayLine', c.fmtDate(now)))} ${eye}</div>
    <div class="bignum"><b>${num(c.hm(t.minutesToday))}</b><span>${esc(T('captured'))}</span></div>
    <div class="sub">${sub}</div>
    <div class="askbar"><span class="peek">${tide(pose, 'peek-art')}</span>${ic('sparkle', 20)}<input type="text" data-act="askbar" placeholder="${esc(T('askBar'))}" aria-label="${esc(T('askBar'))}" /><button type="button" class="send" data-act="askgo" aria-label="${esc(T('send'))}">${ic('send', 20)}</button></div>
    <div class="chips">${T('chips').map((x, i) => `<button type="button" class="chip" data-act="chip" data-i="${i}">${ic(chipIcons[i], 18)}${esc(x)}</button>`).join('')}</div>
  </section>`;
}
