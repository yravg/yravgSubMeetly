/**
 * Parser transkrip Microsoft Teams hasil salin-tempel.
 *
 * Panel transkrip Teams menyalin banyak derau: label aksesibilitas, tombol
 * Search, peringatan AI, inisial avatar, nama pembicara yang berdiri sendiri,
 * dan stempel waktu yang tercetak DUA KALI ("2 minutes 52 seconds2:52").
 * Yang membawa makna hanyalah baris berisi NAMA + WAKTU, lalu ucapannya di
 * baris-baris berikutnya sampai kepala berikutnya.
 *
 * Keluarannya sengaja berbentuk { speaker, t0, text } — bentuk yang sudah
 * diterima generateNotesFromTranscript(), supaya notulen langsung bisa dibuat
 * tanpa lapisan penyesuai.
 *
 * Fungsi murni; diuji di test/teams-transcript.test.mjs.
 */

/** Baris antarmuka Teams yang tidak pernah membawa isi rapat. */
const NOISE = [
  /^transcript\b/i,
  /^search$/i,
  /^ai-generated content may be incorrect$/i,
  /\bstarted transcription$/i,
  /\bstopped transcription$/i,
  /^use arrow keys/i,
];

/** "2 minutes 52 seconds2:52", "2:52", "41:52" — stempel waktu berdiri sendiri. */
const BARE_TIME = /^(?:\d+\s+minutes?\s*(?:\d+\s+seconds?)?)?\s*\d{1,2}:\d{2}$/i;
/** Inisial avatar: "JC", "M", "RG". */
const AVATAR = /^[A-Z]{1,3}$/;

/** "Nama 2 minutes 52 seconds" / "Nama 8 minutes" / "Nama 41 seconds" */
const HEADER =
  /^(.+?)\s+(?:(\d+)\s+minutes?)?(?:\s*(\d+)\s+seconds?)?$/i;

function isNoise(line) {
  return NOISE.some((re) => re.test(line));
}

/** Kepala entri → { speaker, t0 } atau null. */
function parseHeader(line) {
  // Harus memuat satuan waktu; kalau tidak, ini kalimat biasa.
  if (!/\d+\s+(minutes?|seconds?)\s*$/i.test(line)) return null;
  const m = HEADER.exec(line);
  if (!m) return null;
  const speaker = (m[1] || '').trim().replace(/[,\s]+$/, '');
  if (!speaker || BARE_TIME.test(speaker) || AVATAR.test(speaker)) return null;
  const mins = Number(m[2] || 0);
  const secs = Number(m[3] || 0);
  if (!m[2] && !m[3]) return null;
  return { speaker, t0: mins * 60 + secs };
}

/**
 * @param {string} raw teks hasil salin dari panel transkrip Teams
 * @returns {{ lines: {speaker: string, t0: number, text: string}[], speakers: string[], durationSec: number }}
 */
export function parseTeamsTranscript(raw) {
  const rows = String(raw ?? '').split(/\r?\n/).map((l) => l.trim());

  // Lintasan pertama: kumpulkan nama pembicara dari baris kepala. Teams juga
  // mencetak nama itu SENDIRIAN tepat sebelum kepalanya; tanpa daftar ini nama
  // tersebut akan tersambung ke ucapan pembicara sebelumnya.
  const known = new Set();
  for (const row of rows) {
    const h = parseHeader(row);
    if (h) known.add(h.speaker);
  }

  /** @type {{speaker: string, t0: number, text: string}[]} */
  const lines = [];
  let current = null;

  const flush = () => {
    if (current && current.text.trim()) {
      lines.push({ speaker: current.speaker, t0: current.t0, text: current.text.trim() });
    }
    current = null;
  };

  for (const row of rows) {
    if (!row || isNoise(row) || BARE_TIME.test(row) || AVATAR.test(row)) continue;
    const head = parseHeader(row);
    if (head) {
      flush();
      current = { ...head, text: '' };
      continue;
    }
    // Nama pembicara yang berdiri sendiri (Teams mencetaknya sebelum kepala).
    if (known.has(row)) continue;
    if (!current) continue;
    current.text += (current.text ? ' ' : '') + row;
  }
  flush();

  const speakers = [...new Set(lines.map((l) => l.speaker))];
  const durationSec = lines.length ? lines[lines.length - 1].t0 : 0;
  return { lines, speakers, durationSec };
}

/** True bila teks tertempel tampak seperti transkrip Teams. */
export function looksLikeTeamsTranscript(raw) {
  const s = String(raw ?? '');
  if (!s.trim()) return false;
  if (/\bstarted transcription\b/i.test(s)) return true;
  // minimal dua kepala "Nama N minutes M seconds"
  const heads = s.split(/\r?\n/).filter((l) => parseHeader(l.trim()));
  return heads.length >= 2;
}
