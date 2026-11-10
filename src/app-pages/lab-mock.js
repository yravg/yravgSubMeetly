/**
 * Pembantu murni untuk kendali Helper mock (window.__labMock dari test/chrome-mock.js),
 * dipakai lab lama dan halaman Developer di app shell.
 *
 * Kontrak:
 *  esc(s) → HTML-escape (& < > ").
 *  logTableHtml(rows, esc) → tabel 50 permintaan terakhir (Time, Method, Path, Result, Delay);
 *    baris gagal (hasil bukan 2xx dan bukan '…') berkelas `bad`; kosong → "No requests yet."
 *  parseFixture(text) → { ok: true, value } | { ok: false, error: 'must be a JSON object' | pesan JSON }
 *    Hanya objek JSON yang diterima (bukan array, bukan null).
 *  overlayLogHtml(log, esc) → enam pesan overlay terakhir, atau "No overlay messages yet."
 */
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function logTableHtml(rows, escape = esc) {
  if (!rows.length) return '<div class="lempty">No requests yet.</div>';
  return `<table class="ltbl"><tr><th>Time</th><th>Method</th><th>Path</th><th>Result</th><th>Delay</th></tr>${rows
    .slice(-50)
    .map((r) => {
      const ok = String(r.result).startsWith('2') || r.result === '…';
      const t = r.time ? new Date(r.time).toLocaleTimeString('en-GB') : '';
      return `<tr class="${ok ? '' : 'bad'}"><td class="dim">${escape(t)}</td><td>${escape(r.method)}</td><td>${escape(r.path)}</td><td>${escape(r.result ?? '')}</td><td>${escape(r.delayMs ?? 0)} ms</td></tr>`;
    })
    .join('')}</table>`;
}

export function parseFixture(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object');
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

export function overlayLogHtml(log, escape = esc) {
  const last = log.slice(-6);
  return last.length
    ? last.map((m) => `<span>${escape(m.type)}: ${escape(m.data?.source || m.data?.text || m.data?.translation || '')}</span>`).join('')
    : '<span>No overlay messages yet.</span>';
}
