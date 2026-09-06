/**
 * Chart SVG murni untuk tab Performance — tanpa pustaka, aman untuk CSP MV3.
 *
 * Mengikuti spesifikasi dataviz repo ini: bar ≤ 24px dengan ujung data membulat
 * 4px dan pangkal rata di garis dasar; garis 2px; penanda ≥ 8px dengan cincin
 * 2px warna permukaan; grid/axis hairline solid dan resesif; teks memakai token
 * teks (bukan warna seri); legenda selalu ada untuk ≥ 2 seri; nilai tidak
 * ditulis di setiap titik — tooltip (data-tip) dan tabel yang membawanya.
 * Warna seri lewat CSS var `--viz-1..3` (didefinisikan terang & gelap terpisah).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtMs = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
function ticks(max, count = 4) {
  const out = [];
  for (let i = 0; i <= count; i++) out.push((max * i) / count);
  return out;
}

/**
 * Bar horizontal: p50 per pasangan bahasa. Satu hue (sequential = besaran).
 * @param {{rows:{label:string,value:number|null,n?:number}[], width?:number, unit?:string, target?:number}} o
 */
export function barChart({ rows, width = 560, unit = 'ms', target = null, lang = 'en' }) {
  const rowH = 30, barH = 18, padL = 84, padR = 64, padT = 8, padB = 26;
  const data = rows.filter((r) => r.value != null);
  const height = padT + padB + Math.max(1, data.length) * rowH;
  const max = niceMax(Math.max(...data.map((r) => r.value), target || 0));
  const plotW = width - padL - padR;
  const x = (v) => padL + (v / max) * plotW;
  let g = '';
  for (const t of ticks(max)) {
    g += `<line x1="${x(t)}" y1="${padT}" x2="${x(t)}" y2="${height - padB}" class="viz-grid"/>`;
    g += `<text x="${x(t)}" y="${height - 8}" class="viz-tick" text-anchor="middle">${Math.round(t)}</text>`;
  }
  let bars = '';
  data.forEach((r, i) => {
    const y = padT + i * rowH + (rowH - barH) / 2;
    const w = Math.max(2, x(r.value) - padL);
    const rr = Math.min(4, w / 2);
    // Pangkal rata di garis dasar, ujung data membulat 4px.
    const path = `M${padL},${y} h${w - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${barH - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${w - rr} z`;
    bars += `<g class="viz-hit" data-tip="${esc(r.label)}: ${fmtMs(r.value)} (n=${r.n ?? '?'})">
      <rect x="${padL}" y="${padT + i * rowH}" width="${plotW}" height="${rowH}" fill="transparent"/>
      <path d="${path}" class="viz-bar${r.other ? ' viz-bar-other' : ''}"/>
      <text x="${padL - 8}" y="${y + barH / 2 + 4}" class="viz-label" text-anchor="end">${esc(r.label)}</text>
      <text x="${x(r.value) + 6}" y="${y + barH / 2 + 4}" class="viz-value">${Math.round(r.value)}</text>
    </g>`;
  });
  const tgt = target ? `<line x1="${x(target)}" y1="${padT}" x2="${x(target)}" y2="${height - padB}" class="viz-target"/><text x="${x(target) + 4}" y="${padT + 10}" class="viz-tick">${lang === 'id' ? 'target' : 'target'} ${target}</text>` : '';
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" class="viz" aria-label="p50 ${unit} per language pair">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" class="viz-axis"/>${g}${tgt}${bars}
    ${data.length ? '' : `<text x="${width / 2}" y="${height / 2}" class="viz-empty" text-anchor="middle">—</text>`}
  </svg>`;
}

/**
 * Scatter: durasi audio (x) vs waktu (y), warna per seri (≤ 3), penanda 8px + cincin permukaan.
 * @param {{points:{x:number,y:number,series:string,label?:string}[], series:{id:string,label:any}[], width?:number, height?:number, lang?:string}} o
 */
export function scatterChart({ points, series, width = 560, height = 260, lang = 'en' }) {
  const padL = 52, padR = 16, padT = 12, padB = 34;
  const maxX = niceMax(Math.max(...points.map((p) => p.x), 1));
  const maxY = niceMax(Math.max(...points.map((p) => p.y), 1));
  const x = (v) => padL + (v / maxX) * (width - padL - padR);
  const y = (v) => height - padB - (v / maxY) * (height - padT - padB);
  let g = '';
  for (const t of ticks(maxY)) g += `<line x1="${padL}" y1="${y(t)}" x2="${width - padR}" y2="${y(t)}" class="viz-grid"/><text x="${padL - 6}" y="${y(t) + 4}" class="viz-tick" text-anchor="end">${Math.round(t)}</text>`;
  for (const t of ticks(maxX)) g += `<text x="${x(t)}" y="${height - 12}" class="viz-tick" text-anchor="middle">${+t.toFixed(1)}</text>`;
  const idx = new Map(series.map((s, i) => [s.id, i + 1]));
  let dots = '';
  for (const p of points) {
    const k = idx.get(p.series) || 1;
    dots += `<g class="viz-hit" data-tip="${esc(p.label || p.series)}: ${fmtMs(p.y)} · ${+p.x.toFixed(2)} s">
      <circle cx="${x(p.x)}" cy="${y(p.y)}" r="12" fill="transparent"/>
      <circle cx="${x(p.x)}" cy="${y(p.y)}" r="4" class="viz-dot viz-s${k}"/>
    </g>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" class="viz" aria-label="latency vs audio length">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" class="viz-axis"/>
    <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" class="viz-axis"/>
    ${g}${dots}
    <text x="${width - padR}" y="${height - 12}" class="viz-tick" text-anchor="end">${lang === 'id' ? 'audio (dtk)' : 'audio (s)'}</text>
    <text x="${padL}" y="${padT}" class="viz-tick">ms</text>
  </svg>`;
}

/**
 * Garis: ms per sampel berurutan, satu garis per seri (2px, penanda ujung 8px).
 * @param {{series:{id:string,label:any,points:{x:number,y:number}[]}[], order:{id:string}[], width?:number, height?:number}} o
 */
export function lineChart({ series, order, width = 560, height = 220 }) {
  const padL = 52, padR = 16, padT = 12, padB = 26;
  const all = series.flatMap((s) => s.points);
  const maxX = Math.max(...all.map((p) => p.x), 1);
  const maxY = niceMax(Math.max(...all.map((p) => p.y), 1));
  const x = (v) => padL + ((v - 1) / Math.max(1, maxX - 1)) * (width - padL - padR);
  const y = (v) => height - padB - (v / maxY) * (height - padT - padB);
  const idx = new Map(order.map((s, i) => [s.id, i + 1]));
  let g = '';
  for (const t of ticks(maxY)) g += `<line x1="${padL}" y1="${y(t)}" x2="${width - padR}" y2="${y(t)}" class="viz-grid"/><text x="${padL - 6}" y="${y(t) + 4}" class="viz-tick" text-anchor="end">${Math.round(t)}</text>`;
  let lines = '';
  for (const s of series) {
    if (!s.points.length) continue;
    const k = idx.get(s.id) || 1;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`).join(' ');
    const last = s.points[s.points.length - 1];
    lines += `<path d="${d}" class="viz-line viz-s${k}"/>
      <g class="viz-hit" data-tip="${esc(typeof s.label === 'object' ? s.label.en : s.label)}: ${fmtMs(last.y)} (#${last.x})"><circle cx="${x(last.x)}" cy="${y(last.y)}" r="12" fill="transparent"/><circle cx="${x(last.x)}" cy="${y(last.y)}" r="4" class="viz-dot viz-s${k}"/></g>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" class="viz" aria-label="latency over samples">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" class="viz-axis"/>
    <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" class="viz-axis"/>
    ${g}${lines}<text x="${padL}" y="${padT}" class="viz-tick">ms</text>
  </svg>`;
}

/** Legenda dengan kunci garis pendek (bukan kotak); teks memakai token teks. */
export function legend(series, order, lang = 'en') {
  const idx = new Map(order.map((s, i) => [s.id, i + 1]));
  return `<div class="viz-legend">${series.map((s) => `<span class="viz-key"><i class="viz-s${idx.get(s.id) || 1}"></i>${esc(typeof s.label === 'object' ? s.label[lang] || s.label.en : s.label)}</span>`).join('')}</div>`;
}
