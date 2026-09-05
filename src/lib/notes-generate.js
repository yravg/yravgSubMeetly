/**
 * Generator notulen lokal dari baris transkrip → Meeting (skema v2).
 *
 * Versi sebelumnya masih memakai API v1 (createMeetingNote/createActionItem)
 * yang sudah dihapus saat migrasi ke register v2, sehingga modul ini bahkan
 * tidak bisa di-import. Ditulis ulang ke createMeeting/createMinuteItem.
 *
 * Ekstraksi bersifat heuristik dan berjalan lokal — tidak ada panggilan cloud.
 * Setiap butir membawa `src` (provenance) sehingga bisa ditelusuri balik ke
 * ucapan aslinya, dan ditandai review 'ai' agar manusia tetap memverifikasi.
 */
import { createMeeting, createMinuteItem } from './notes-schema.js';

/** Penanda kalimat yang biasanya menyatakan keputusan. */
const DECISION_RE =
  /\b(?:keputusan|diputuskan|kita putuskan|we (?:decided|agreed)|it was agreed|decision|agreed to|sepakat)\b/i;
/** Penanda tindak lanjut / penugasan. */
// Notulen teknis jarang menulis "action item:". Yang muncul adalah kalimat
// direktif: "to be established", "to review ...", "please take ...", "shall".
const ACTION_RE = new RegExp(
  [
    '\\baction item\\b', '\\btindak lanjut\\b', '\\bfollow up\\b',
    '\\bto be (?:established|reviewed|inspected|completed|submitted|removed|secured|checked)\\b',
    '\\bto (?:review|check|carry out|inspect|prepare|submit|update|ensure|establish|remove|secure|add)\\b',
    '\\bwill (?:send|share|prepare|check|update|review|submit|provide)\\b',
    '\\bplease \\w+',
    '\\b(?:shall|must|need to|required to)\\b',
    '\\bakan (?:mengirim|menyiapkan|mengecek|memperbarui|meninjau)\\b',
    '\\b(?:harus|mohon|segera)\\b',
    '\\brecommendation\\b',
  ].join('|'),
  'i',
);
/** Penanda risiko / masalah terbuka. */
const RISK_RE =
  /\b(?:risk|risiko|issue|kendala|delay|terlambat|blocker|incident|insiden|concern)\b/i;
/** Penanda pertanyaan terbuka. */
const QUESTION_RE = /\?\s*$/;
/**
 * Basa-basi rapat: sapaan, cek audio, penutup. Tanpa saringan ini "Can you
 * hear me?" ikut jadi butir register dan notulennya penuh sampah.
 */
const PLEASANTRY_RE =
  /^(?:hi\b|hello\b|good (?:morning|afternoon|evening)|thank you|thanks|bye|okay[.! ]*$|ok[.! ]*$|yeah|selamat (?:pagi|siang|sore)|terima kasih)/i;
const CHECKIN_RE =
  /\b(?:can you hear me|are you there|is it clear|do you hear me|sound ok|bisa dengar)\b/i;
/** Pertanyaan pendek jarang bermakna sebagai butir notulen. */
const MIN_QUESTION_CHARS = 40;

/**
 * Kata sambung berhuruf besar di awal kalimat ("So please take …") mudah
 * tertukar dengan nama orang; daftar ini mencegah pemilik palsu.
 */
const NOT_A_NAME = new Set([
  'So', 'Then', 'And', 'But', 'We', 'You', 'They', 'It', 'This', 'That', 'Please',
  'Now', 'Okay', 'Ok', 'After', 'Before', 'Also', 'However', 'Jadi', 'Lalu',
  'Kemudian', 'Mohon', 'Kami', 'Kita', 'Saya', 'Anda',
]);

/** Nama pemilik dari kalimat penugasan, bila terlihat jelas. */
function guessOwner(text, speaker) {
  const m = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:will|to|akan|please)\b/.exec(text);
  const cand = m && m[1];
  if (cand && !NOT_A_NAME.has(cand.split(/\s+/)[0])) return cand;
  // Kalau tak ada nama eksplisit, penuturlah pemilik yang paling masuk akal.
  return speaker || null;
}

function classify(text) {
  // Basa-basi disingkirkan lebih dulu: ia sering mengandung kata pemicu
  // ("please", "need to") tanpa membawa isi rapat.
  if (PLEASANTRY_RE.test(text) || CHECKIN_RE.test(text)) return null;
  if (DECISION_RE.test(text)) return 'decision';
  if (ACTION_RE.test(text)) return 'action';
  if (RISK_RE.test(text)) return 'risk';
  if (QUESTION_RE.test(text) && text.length >= MIN_QUESTION_CHARS) return 'question';
  return null;
}

/**
 * @param {{ text?: string, src?: string, tgt?: string, speaker?: string, t0?: number, t1?: number }[]} lines
 * @param {{ title?: string, date?: string, locale?: string, seriesId?: string, source?: string }} [meta]
 */
export function generateNotesFromTranscript(lines, meta = {}) {
  const locale = meta.locale || 'en';
  const rows = (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      text: String(l?.text ?? l?.tgt ?? l?.src ?? '').trim(),
      speaker: l?.speaker ? String(l.speaker) : null,
      t0: Number(l?.t0) || 0,
      t1: Number(l?.t1 ?? l?.t0) || 0,
    }))
    .filter((r) => r.text);

  const items = [];
  let n = 0;
  for (const r of rows) {
    const type = classify(r.text);
    // Ucapan basa-basi (sapaan, terima kasih) tidak layak jadi butir register.
    if (!type || r.text.length < 12) continue;
    n += 1;
    items.push(
      createMinuteItem(
        {
          ref: `AI-${String(n).padStart(3, '0')}`,
          type,
          text: r.text,
          owner: type === 'action' ? guessOwner(r.text, r.speaker) : null,
          // Heuristik lokal tidak pernah seyakin manusia; tandai agar ditelaah.
          review: 'ai',
          confidence: 0.6,
          src: { t0: r.t0, t1: r.t1, speaker: r.speaker, orig: r.text, lang: locale },
        },
        { locale },
      ),
    );
  }

  const speakers = [...new Set(rows.map((r) => r.speaker).filter(Boolean))];
  const summary = rows.length
    ? `${rows.length} segmen transkrip dari ${speakers.length || 1} pembicara; ${items.length} butir terdeteksi otomatis.`
    : 'Transkrip kosong — tidak ada yang bisa diringkas.';

  return createMeeting({
    title: meta.title || 'Untitled meeting',
    date: meta.date,
    seriesId: meta.seriesId,
    locale,
    attendees: speakers.map((name) => ({ name, speakerLabel: name })),
    summary,
    items,
    engine: {
      asr: meta.source || 'pasted-transcript',
      extractor: 'heuristic-v2',
      segments: rows.length,
      durationSec: rows.length ? rows[rows.length - 1].t1 || rows[rows.length - 1].t0 : 0,
    },
  });
}
