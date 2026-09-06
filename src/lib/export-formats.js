/**
 * Generator berkas ekspor format tambahan: Markdown, CSV, dan JSON.
 *
 * SRT/VTT/TXT sudah ditangani transcript-cache.js dan ditujukan untuk pemutar
 * video. Ketiga format di sini untuk kebutuhan lain:
 *   - md   : transkrip yang enak dibaca / ditempel ke dokumen & notulen
 *   - csv  : dianalisis di spreadsheet (durasi, jumlah kata, per pembicara)
 *   - json : dibaca mesin, dan satu-satunya format yang bisa dimuat kembali
 *            tanpa kehilangan apa pun (lossless round-trip)
 *
 * Fungsi murni; diuji di test/export-formats.test.mjs.
 */

/** Detik → HH:MM:SS.mmm */
function ts(sec) {
  const ms = Math.max(0, Math.round(Number(sec) * 1000) || 0);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
}

function normLines(lines) {
  return (Array.isArray(lines) ? lines : []).map((l) => {
    const t0 = Number(l?.t0 ?? (l?.t ?? 0) / 1000) || 0;
    const t1raw = l?.t1 != null ? Number(l.t1) : t0 + 3;
    return {
      t0,
      t1: t1raw > 1000 ? t1raw / 1000 : t1raw, // entri lama menyimpan ms
      src: String(l?.src ?? l?.source ?? ''),
      tgt: String(l?.tgt ?? l?.translation ?? ''),
    };
  });
}

/** Transkrip Markdown dengan tabel waktu; dualLine menampilkan teks asli juga. */
export function formatMarkdown(lines, { title, url, dualLine = false } = {}) {
  const out = [`# ${title || 'Transcript'}`, ''];
  if (url) out.push(`Source: <${url}>`, '');
  for (const l of normLines(lines)) {
    const primary = l.tgt || l.src;
    if (!primary) continue;
    out.push(`**${ts(l.t0)}** — ${primary}`);
    if (dualLine && l.src && l.tgt && l.src !== l.tgt) out.push(`> ${l.src}`);
    out.push('');
  }
  return out.join('\n');
}

/** Satu sel CSV: kutip bila perlu, gandakan tanda kutip di dalamnya. */
function cell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV dengan header; kolom durasi memudahkan analisis di spreadsheet. */
export function formatCsv(lines, { title, url } = {}) {
  const rows = [['start', 'end', 'duration', 'source', 'translation'].join(',')];
  for (const l of normLines(lines)) {
    rows.push([
      cell(ts(l.t0)), cell(ts(l.t1)), cell((l.t1 - l.t0).toFixed(2)),
      cell(l.src), cell(l.tgt),
    ].join(','));
  }
  // Judul/URL sengaja TIDAK ditaruh sebagai baris di atas header: itu akan
  // merusak pembacaan otomatis. Metadata milik JSON.
  void title; void url;
  return rows.join('\n');
}

/** JSON lossless — satu-satunya format yang bisa dimuat kembali utuh. */
export function formatJson(lines, { title, url, srcLang, tgtLang } = {}) {
  return JSON.stringify(
    {
      kind: 'yraverage-transcript',
      version: 1,
      title: title || '',
      url: url || '',
      srcLang: srcLang || '',
      tgtLang: tgtLang || '',
      lines: normLines(lines),
    },
    null,
    2,
  );
}
