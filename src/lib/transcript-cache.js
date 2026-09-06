// Per-URL transcript cache — keyed by page URL + language pair.
// Also owns SRT/VTT/TXT export, including readable cue splitting.

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url || '';
  }
}

export function cacheKey(url, srcLang, tgtLang, taskMode) {
  return `${normalizeUrl(url)}|${srcLang}|${tgtLang}|${taskMode}`;
}

export function maxCachedTime(lines) {
  if (!lines?.length) return 0;
  return Math.max(...lines.map((l) => l.t1 ?? l.t ?? 0));
}

// True when [t0,t1] is fully covered by an existing cached line.
export function isRangeCached(lines, t0, t1, slack = 0.4) {
  if (!lines?.length) return false;
  return lines.some((l) => {
    const a = l.t0 ?? 0;
    const b = l.t1 ?? a;
    return a - slack <= t0 && b + slack >= t1;
  });
}

export function mergeLine(lines, line) {
  const next = [...(lines || []), line];
  next.sort((a, b) => (a.t0 ?? 0) - (b.t0 ?? 0));
  return next;
}

/** Max characters per subtitle cue (≈2 lines × 42). Longer ASR dumps cover the screen. */
export const SUBTITLE_MAX_CHARS = 84;
/** Soft wrap within a cue. */
export const SUBTITLE_LINE_CHARS = 42;

/**
 * Split long ASR segments into short, timed subtitle cues so players don't
 * paint a wall of text (and lag) for 20–30s chunks.
 */
export function splitSubtitleCues(lines, { maxChars = SUBTITLE_MAX_CHARS } = {}) {
  const out = [];
  for (const l of lines || []) {
    const t0 = Number(l.t0 ?? (l.t ?? 0) / 1000) || 0;
    let t1 = Number(l.t1 ?? t0 + 3);
    if (!(t1 > t0)) t1 = t0 + 3;
    const src = (l.src || l.source || '').trim();
    const tgt = (l.tgt || l.translation || '').trim();
    const primary = tgt || src;
    if (!primary) continue;

    const chunks = chunkWords(primary, maxChars);
    const srcChunks = src && tgt && src !== tgt ? alignChunks(src, chunks.length) : null;
    const weights = chunks.map((c) => Math.max(1, c.replace(/\n/g, '').length));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const dur = t1 - t0;
    let acc = 0;
    for (let i = 0; i < chunks.length; i++) {
      const start = t0 + dur * (acc / totalW);
      acc += weights[i];
      const end = i === chunks.length - 1 ? t1 : t0 + dur * (acc / totalW);
      const cueTgt = tgt ? chunks[i] : '';
      const cueSrc = srcChunks ? srcChunks[i] : tgt ? '' : chunks[i];
      out.push({
        t0: round3(start),
        t1: round3(Math.max(end, start + 0.05)),
        src: cueSrc || (tgt ? '' : chunks[i]),
        tgt: cueTgt || (!tgt ? chunks[i] : ''),
      });
    }
  }
  return out;
}

function chunkWords(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [text];
  const chunks = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      chunks.push(wrapCueLines(cur));
      cur = w.length > maxChars ? w.slice(0, maxChars) : w;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(wrapCueLines(cur));
  return chunks;
}

/** Insert a soft line break near SUBTITLE_LINE_CHARS when the cue is long. */
function wrapCueLines(text) {
  if (text.length <= SUBTITLE_LINE_CHARS) return text;
  const words = text.split(/\s+/);
  let line1 = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = line1 ? `${line1} ${words[i]}` : words[i];
    if (next.length > SUBTITLE_LINE_CHARS && line1) break;
    line1 = next;
  }
  const line2 = words.slice(i).join(' ');
  return line2 ? `${line1}\n${line2}` : line1;
}

/** Split `text` into `n` chunks by word weight so dual-line cues stay aligned. */
function alignChunks(text, n) {
  const words = text.split(/\s+/).filter(Boolean);
  if (n <= 1) return [wrapCueLines(text)];
  if (!words.length) return Array(n).fill('');
  const chunks = [];
  const per = words.length / n;
  for (let i = 0; i < n; i++) {
    const a = Math.round(i * per);
    const b = Math.round((i + 1) * per);
    const part = words.slice(a, Math.max(b, a + (i === n - 1 ? 0 : 1))).join(' ');
    chunks.push(wrapCueLines(part || (i === n - 1 ? words.slice(a).join(' ') : '')));
  }
  // Ensure last chunk gets any leftover words.
  if (chunks.length === n) {
    const used = chunks.join(' ').split(/\s+/).filter(Boolean).length;
    if (used < words.length) {
      chunks[n - 1] = wrapCueLines(words.slice(Math.round((n - 1) * per)).join(' '));
    }
  }
  return chunks;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Rapikan daftar cue sebelum ditulis: waktu jadi angka berhingga, durasi
 * selalu positif, dan cue urut menaik menurut waktu mulai.
 *
 * Cue yang mundur membuat penomoran SRT tidak sesuai urutan waktu (indeks SRT
 * harus berurut). Sumbernya nyata: transkripsi streaming dan tangkapan langsung
 * bisa menyelesaikan jendela tidak berurutan.
 */
export function normalizeCues(cues) {
  const out = (cues || []).map((c) => {
    const t0raw = Number(c.t0);
    const t0 = Number.isFinite(t0raw) ? Math.max(0, t0raw) : 0;
    const t1raw = Number(c.t1);
    // Durasi nol/negatif = cue yang tak pernah tampil.
    const t1 = Number.isFinite(t1raw) && t1raw > t0 ? t1raw : t0 + 3;
    return { ...c, t0, t1 };
  });
  // Stabil: cue dengan waktu mulai sama mempertahankan urutan aslinya.
  return out
    .map((c, i) => [c, i])
    .sort((a, b) => a[0].t0 - b[0].t0 || a[1] - b[1])
    .map(([c]) => c);
}

function cueBody(l) {
  const src = (l.src || l.source || '').trim();
  const tgt = (l.tgt || l.translation || '').trim();
  // Keep both lines whenever the session produced both: an exported subtitle
  // file is an archive, and dropping the original is lossy and unrecoverable.
  // Source first, then translation — the same order formatTxt() already uses
  // and the order the design prototype (test/studio.js) renders.
  if (src && tgt && src !== tgt) return `${src}\n${tgt}`;
  return tgt || src;
}

export function formatSrt(lines, { url, title } = {}) {
  const cues = [];
  if (url || title) {
    const meta = [`yraverageSubMin`, title && `Title: ${title}`, url && `Source: ${url}`]
      .filter(Boolean)
      .join('\n');
    cues.push({ t0: 0, t1: 0.001, src: '', tgt: meta, _meta: true });
  }
  for (const l of normalizeCues(splitSubtitleCues(lines || []))) {
    cues.push(l);
  }
  return cues
    .map((l, i) => {
      const t0 = l.t0 ?? 0;
      const t1 = l.t1 ?? t0 + 3;
      const text = l._meta ? l.tgt : cueBody(l);
      return `${i + 1}\n${fmtSrt(t0)} --> ${fmtSrt(t1)}\n${text}\n`;
    })
    .join('\n');
}

export function formatVtt(lines, { url, title } = {}) {
  const hdr = ['WEBVTT'];
  if (url) hdr.push(`NOTE Source: ${url}`);
  if (title) hdr.push(`NOTE Title: ${title}`);
  // WebVTT mewajibkan BARIS KOSONG antara blok header dan cue pertama.
  // Tanpa itu ffmpeg membuang cue pertama, dan bila ada baris NOTE ia membuang
  // seluruh cue. Chrome memaafkannya, jadi cacat ini lama tidak terlihat.
  hdr.push('', '');
  const body = normalizeCues(splitSubtitleCues(lines || []))
    .map((l) => `${fmtVtt(l.t0)} --> ${fmtVtt(l.t1)}\n${cueBody(l)}\n`)
    .join('\n');
  return hdr.join('\n') + body;
}

export function formatTxt(lines, { url, title } = {}) {
  const hdr = [];
  if (title) hdr.push(`Title: ${title}`);
  if (url) hdr.push(`Source: ${url}`);
  if (hdr.length) hdr.push('', '---', '');
  const body = (lines || [])
    .map((l) => {
      const t0 = l.t0 ?? (l.t ?? 0) / 1000;
      const ts = fmtVtt(t0);
      const src = l.src || l.source || '';
      const tgt = l.tgt || l.translation || '';
      if (src && tgt) return `[${ts}]\n${src}\n${tgt}`;
      return `[${ts}] ${tgt || src}`;
    })
    .join('\n\n');
  return hdr.join('\n') + body;
}

/** Detik → milidetik yang selalu berupa bilangan bulat non-negatif. */
function safeMs(sec) {
  const n = Number(sec);
  // Nilai rusak (undefined, "x", Infinity) dulu menghasilkan "NaN:NaN:NaN,NaN"
  // — berkas yang tak bisa diurai pemutar mana pun. Lebih baik jatuh ke 0.
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000)) : 0;
}

function fmtSrt(sec) {
  const ms = safeMs(sec);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

function fmtVtt(sec) {
  const ms = safeMs(sec);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s}.${f}`;
}
