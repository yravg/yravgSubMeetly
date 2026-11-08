/**
 * ICS EXPORT — open actions with a due date -> one .ics file (add-in `due-to-calendar`).
 *
 * CONTRACT
 *  dueActionRows(meetings, { lang, now }) -> { rows, skipped }
 *    rows    = open actions of the series (seriesSummary: carried copies counted once) whose `due`
 *              is a real YYYY-MM-DD date; each { ref, meetingId, meetingTitle, meetingDate, text, owner, due }
 *    skipped = open actions without a usable due date (the UI says how many were left out)
 *  buildIcs(rows, { now }) -> string | null   null when rows is empty (nothing to save)
 *    RFC 5545: CRLF line ends, lines folded at 75 octets (never inside a UTF-8 character),
 *    TEXT escaped. One all-day VEVENT per action (VTODO is ignored by Google Calendar).
 *    UID = <meetingId>-<ref>@submeetly: stable per item id, so importing twice updates, not duplicates.
 *  No I/O: the caller saves the string as a Blob download.
 *
 * shortcut: no VTIMEZONE and no reminders (all-day events need neither), upgrade when a time of day is stored on items.
 */
import { seriesSummary } from './notes-actions.js';
import { pickText } from './notes-schema.js';

const enc = new TextEncoder();
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD that is a real calendar day -> Date at UTC midnight, else null. */
function parseDay(s) {
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

/** "2026-12-31" -> "20270101" (the exclusive DTEND of an all-day event). */
export function nextDay(s) {
  const d = parseDay(s);
  if (!d) throw new Error(`not a date: ${s}`);
  return ymd(new Date(d.getTime() + 86400000));
}

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold one content line at 75 octets; continuation lines start with one space (which counts). */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function dueActionRows(meetings, { lang = 'en', now = new Date() } = {}) {
  const rows = [];
  let skipped = 0;
  for (const r of seriesSummary(meetings, now).rows) {
    if (r.item.type !== 'action') continue;
    if (!parseDay(r.item.due)) {
      skipped++;
      continue;
    }
    rows.push({
      ref: r.item.ref,
      meetingId: r.meeting.id,
      meetingTitle: r.meeting.title,
      meetingDate: r.meeting.date,
      text: pickText(r.item.text, lang),
      owner: r.item.owner || '',
      due: r.item.due,
    });
  }
  rows.sort((a, b) => a.due.localeCompare(b.due) || a.ref.localeCompare(b.ref));
  return { rows, skipped };
}

const uidPart = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '-');
const stamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function buildIcs(rows, { now = new Date() } = {}) {
  if (!rows.length) return null;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yraverageSubMeetly//Add-in due-to-calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const r of rows) {
    const desc = [`${r.meetingTitle} (${r.meetingDate})`, r.owner && `Owner: ${r.owner}`, `Ref: ${r.ref}`].filter(Boolean).map(escapeText).join('\\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uidPart(r.meetingId)}-${uidPart(r.ref)}@submeetly`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${r.due.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${nextDay(r.due)}`,
      `SUMMARY:${escapeText(r.text)}`,
      `DESCRIPTION:${desc}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
