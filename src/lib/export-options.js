/**
 * Opsi ekspor subtitel lintas OS (SRT / VTT / TXT) — Windows / Linux / macOS.
 *
 * Yang berbeda antar OS bukan formatnya, tapi detail berkasnya:
 *  - Windows: Notepad/Media Player Classic/VLC lama paling aman dengan CRLF + BOM UTF-8.
 *  - Linux/macOS: LF tanpa BOM (BOM justru mengganggu `cat`/`ffmpeg -i sub.srt` di beberapa versi).
 *  - Nama berkas: tanpa karakter terlarang Windows (\\ / : * ? " < > |) — lihat exportBasename.
 *
 * Murni fungsi; diuji di test/export-options.test.mjs.
 */
import { exportBasename } from './helper-status.js';

export const EXPORT_FORMATS = /** @type {const} */ ([
  { kind: 'srt', label: 'SRT', mime: 'application/x-subrip', desc: { en: 'SubRip — every player, Premiere, YouTube', id: 'SubRip — semua pemutar, Premiere, YouTube' } },
  { kind: 'vtt', label: 'VTT', mime: 'text/vtt', desc: { en: 'WebVTT — browsers, <track>, Teams/Zoom upload', id: 'WebVTT — browser, <track>, unggah Teams/Zoom' } },
  { kind: 'txt', label: 'TXT', mime: 'text/plain', desc: { en: 'Plain transcript with timestamps — notes, search', id: 'Transkrip polos bertanda waktu — catatan, pencarian' } },
  { kind: 'md', label: 'MD', mime: 'text/markdown', desc: { en: 'Markdown transcript — docs, minutes, sharing', id: 'Transkrip Markdown — dokumen, notulen, dibagikan' } },
  { kind: 'csv', label: 'CSV', mime: 'text/csv', desc: { en: 'Spreadsheet rows with durations — analysis', id: 'Baris spreadsheet dengan durasi — analisis' } },
  { kind: 'json', label: 'JSON', mime: 'application/json', desc: { en: 'Lossless data — re-import, tooling', id: 'Data lossless — impor ulang, alat lain' } },
]);

export const EXPORT_KINDS = EXPORT_FORMATS.map((f) => f.kind);

/** Default per OS: Windows → CRLF + BOM; lainnya LF tanpa BOM. */
export function defaultExportOptions(os) {
  const win = os === 'windows';
  return { crlf: win, bom: win, langSuffix: true };
}

/** Gabungkan opsi tersimpan dengan default OS (kunci tak dikenal dibuang). */
export function normalizeExportOptions(saved, os) {
  const d = defaultExportOptions(os);
  const o = saved && typeof saved === 'object' ? saved : {};
  return {
    crlf: typeof o.crlf === 'boolean' ? o.crlf : d.crlf,
    bom: typeof o.bom === 'boolean' ? o.bom : d.bom,
    langSuffix: typeof o.langSuffix === 'boolean' ? o.langSuffix : d.langSuffix,
  };
}

const BOM = '\uFEFF';

/** Terapkan akhir baris + BOM pada teks yang sudah diformat (idempoten). */
export function applyExportOptions(text, { crlf = false, bom = false } = {}) {
  let out = String(text ?? '');
  if (out.startsWith(BOM)) out = out.slice(1);
  out = out.replace(/\r\n/g, '\n');
  if (crlf) out = out.replace(/\n/g, '\r\n');
  if (bom) out = BOM + out;
  return out;
}

/**
 * Nama berkas ekspor: <judul-aman>[.<src>-<tgt>|.<src>].<kind>
 * Judul dibersihkan lewat exportBasename (aman untuk Windows/Linux/macOS).
 */
export function exportFilename(title, kind, { srcLang, tgtLang, langSuffix = true } = {}) {
  const k = EXPORT_KINDS.includes(kind) ? kind : 'srt';
  const base = exportBasename(String(title || 'subtitles').replace(/\.[a-z0-9]{1,5}$/i, ''), k).replace(/\.(srt|vtt|txt)$/i, '');
  let suffix = '';
  if (langSuffix && srcLang) {
    suffix = tgtLang && tgtLang !== srcLang ? `.${srcLang}-${tgtLang}` : `.${srcLang}`;
    suffix = suffix.replace(/[^a-z0-9.\-]/gi, '');
  }
  return `${base}${suffix}.${k}`;
}

/** Label MIME untuk Blob unduhan. */
export function exportMime(kind) {
  return EXPORT_FORMATS.find((f) => f.kind === kind)?.mime || 'text/plain';
}

/** Ringkasan opsi untuk ditampilkan: "CRLF · BOM" / "LF". */
export function describeExportOptions(o) {
  const parts = [o.crlf ? 'CRLF' : 'LF'];
  if (o.bom) parts.push('BOM');
  return parts.join(' · ');
}
