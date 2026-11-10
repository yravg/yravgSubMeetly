/**
 * Angka beranda Today (TIDE-003..005, papan A01) — murni, dari register saja.
 *
 * Kontrak:
 *  greetingKey(now) → 'morning' (05:00–11:59) | 'afternoon' (12:00–17:59) | 'evening'
 *  meetingMinutes(m) → menit bulat: engine.durationSec bila ada, kalau tidak start–end
 *    (HH:MM, boleh lewat tengah malam), kalau tidak 0.
 *  computeToday(meetings, { now, owner, me }) → {
 *    minutesToday, meetingsToday: [{ id, title, seriesId, start, minutes, status: 'issued'|'draft' }],
 *    week: { items, lastWeek, delta, byType: {decision, action, question, risk}, owners: [] },
 *    overdue: { count, first: { ref, due, meetingId } | null },
 *    yesterdayOpen: meeting | null, empty: boolean }
 *  - Hari dan minggu memakai tanggal lokal `now`; minggu = Senin–Minggu.
 *  - Minggu ini/lalu menghitung butir di rapat bertanggal minggu itu, tanpa butir
 *    bawaan (carriedFrom) supaya tindak lanjut lama tidak terhitung tiap minggu.
 *  - `me` (nama pengguna) → week.yoursAction: tindak lanjut minggu ini atas namanya (huruf besar/kecil diabaikan).
 *  - `owner` menyaring byType saja; owners = pemilik butir minggu ini, urut abjad.
 *  - Lewat tenggat: butir terbuka dengan due < hari ini; ref yang sama di seri yang
 *    sama dihitung sekali, memakai salinan di rapat terbaru (status terbaru menang).
 * Tidak ada data contoh di sini; register kosong menghasilkan nol.
 */

const WEEK_TYPES = ['decision', 'action', 'question', 'risk'];

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function greetingKey(now) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'evening';
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function meetingMinutes(m) {
  const sec = m?.engine?.durationSec;
  if (Number.isFinite(sec) && sec > 0) return Math.round(sec / 60);
  const a = toMin(m?.start); const b = toMin(m?.end);
  if (a == null || b == null) return 0;
  return b >= a ? b - a : b + 1440 - a;
}

export function computeToday(meetings = [], { now = new Date(), owner = null, me = null } = {}) {
  const today = isoDay(now);
  const yesterday = isoDay(addDays(now, -1));
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const weekStart = isoDay(monday);
  const weekEnd = isoDay(addDays(monday, 7));
  const lastStart = isoDay(addDays(monday, -7));

  const todays = meetings.filter((m) => m.date === today)
    .map((m) => ({ id: m.id, title: m.title, seriesId: m.seriesId, start: m.start || null, minutes: meetingMinutes(m), status: m.issuedAt ? 'issued' : 'draft' }))
    .sort((a, b) => (toMin(a.start) ?? 1e9) - (toMin(b.start) ?? 1e9) || a.id.localeCompare(b.id));

  const fresh = (m) => (m.items || []).filter((i) => !i.carriedFrom);
  const thisWeek = meetings.filter((m) => m.date >= weekStart && m.date < weekEnd).flatMap(fresh);
  const lastWeek = meetings.filter((m) => m.date >= lastStart && m.date < weekStart).flatMap(fresh);
  const byType = Object.fromEntries(WEEK_TYPES.map((t) => [t, thisWeek.filter((i) => i.type === t && (!owner || i.owner === owner)).length]));
  const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const yoursAction = me ? thisWeek.filter((i) => i.type === 'action' && same(i.owner, me)).length : 0;
  const owners = [...new Set(thisWeek.map((i) => i.owner).filter(Boolean))].sort();

  const latest = new Map();
  for (const m of [...meetings].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const i of m.items || []) latest.set(`${m.seriesId}\u0000${i.ref}`, { i, m });
  }
  const overdue = [...latest.values()]
    .filter(({ i }) => i.status !== 'closed' && i.due && i.due < today)
    .sort((a, b) => a.i.due.localeCompare(b.i.due));

  const yday = meetings.filter((m) => m.date === yesterday && !m.issuedAt).sort((a, b) => a.id.localeCompare(b.id));

  return {
    minutesToday: todays.reduce((s, m) => s + m.minutes, 0),
    meetingsToday: todays,
    week: { items: thisWeek.length, lastWeek: lastWeek.length, delta: thisWeek.length - lastWeek.length, byType, owners, yoursAction },
    overdue: { count: overdue.length, first: overdue[0] ? { ref: overdue[0].i.ref, due: overdue[0].i.due, meetingId: overdue[0].m.id } : null },
    yesterdayOpen: yday[0] || null,
    empty: meetings.length === 0,
  };
}
