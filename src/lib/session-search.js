/**
 * Pencarian riwayat sesi berdasarkan kata kunci.
 *
 * Yang dicari bukan hanya judul: transkriplah isi sesungguhnya sebuah sesi,
 * jadi kata kunci dicocokkan ke judul, URL, DAN teks sumber/terjemahan tiap
 * baris. Fungsi murni supaya bisa diuji tanpa DOM maupun chrome.storage.
 */

/** Normalisasi untuk pencocokan: casefold + rapikan spasi. */
function norm(s) {
  return String(s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** Pecah kueri jadi token; frasa dalam tanda kutip diperlakukan utuh. */
export function parseQuery(query) {
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(query ?? ''))) !== null) {
    const term = norm(m[1] ?? m[2]);
    if (term) out.push(term);
  }
  return out;
}

/** Semua teks yang bisa dicari dari satu sesi. */
function haystack(session) {
  const lines = Array.isArray(session?.lines) ? session.lines : [];
  const body = lines.map((l) => `${l.src ?? l.source ?? ''} ${l.tgt ?? l.translation ?? ''}`).join(' ');
  return norm(`${session?.title ?? ''} ${session?.url ?? ''} ${body}`);
}

/** Baris yang cocok, untuk ditampilkan sebagai cuplikan. */
export function matchingLines(session, query, limit = 3) {
  const terms = parseQuery(query);
  if (!terms.length) return [];
  const lines = Array.isArray(session?.lines) ? session.lines : [];
  const hits = [];
  for (const l of lines) {
    const text = norm(`${l.src ?? l.source ?? ''} ${l.tgt ?? l.translation ?? ''}`);
    if (terms.every((t) => text.includes(t))) hits.push(l);
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Saring daftar sesi. Semua token harus cocok (AND) — pencarian dua kata
 * seharusnya mempersempit, bukan memperluas. Kueri kosong = daftar apa adanya.
 */
export function searchSessions(sessions, query) {
  const terms = parseQuery(query);
  const list = Array.isArray(sessions) ? sessions : [];
  if (!terms.length) return list;
  return list.filter((s) => {
    const hay = haystack(s);
    return terms.every((t) => hay.includes(t));
  });
}
