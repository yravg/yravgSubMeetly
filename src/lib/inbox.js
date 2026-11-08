/**
 * INBOX — pure grouping for Minutes > Inbox (board T01, "Inbox zero").
 *
 * Contract
 *   in : meetings (Meeting[]), { now: Date, types?: Set<ItemType>, archived?: Set<"meetingId:ref"> }
 *   out: { open, groups:{overdue,week,nodate,later,doing,done}, counts, archived, next }
 *   - `open` is ALWAYS seriesSummary(meetings, now).open. The type filter narrows
 *     the rows shown, never the total, so the header number cannot drift.
 *   - Every open row lands in exactly one of overdue / week / nodate / later / doing.
 *   - `done` = closed action/question/risk/decision items that the INBOX or the
 *     register closed (a status -> closed revision exists) and that are not archived.
 *     Items that arrived closed (sample data) are never "Finished by you".
 *   - `next` = the newest meeting (date, then seq), or null when there is none.
 *   - No network, no clock (now is injected), no storage: archive state is passed in.
 */
import { seriesSummary } from './notes-actions.js';

const DAY = 86400000;
const dayStart = (d) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export const itemKey = (meetingId, ref) => `${meetingId}:${ref}`;

/** When the item was closed: `at` of the last status -> closed revision, else null. */
export function closedAt(item) {
  const revs = (item.history || []).filter((r) => r.field === 'status' && r.to === 'closed');
  return revs.length ? revs[revs.length - 1].at : null;
}

/** 'tomorrow' | 'week' | 'none' -> ISO due date (UTC) or null. */
export function snoozeDue(kind, now = new Date()) {
  const base = dayStart(now);
  if (kind === 'tomorrow') return iso(base + DAY);
  if (kind === 'week') return iso(base + 7 * DAY);
  return null;
}

function bucket(item, now) {
  if (item.status === 'progress') return 'doing';
  if (!item.due) return 'nodate';
  const days = Math.round((Date.parse(`${item.due}T00:00:00Z`) - dayStart(now)) / DAY);
  if (days < 0) return 'overdue';
  return days <= 7 ? 'week' : 'later';
}

const byDue = (a, b) => (a.item.due || '9999').localeCompare(b.item.due || '9999');

/** Closed rows the inbox may list under Finished (archived ones included). */
export function finishedRows(meetings, { now = new Date(), archived = new Set(), withArchived = false } = {}) {
  const superseded = new Set();
  for (const m of meetings) {
    for (const i of m.items) if (i.carriedFrom && i.links?.[0]) superseded.add(`${i.carriedFrom}:${i.links[0]}`);
  }
  const rows = [];
  for (const m of meetings) {
    for (const i of m.items) {
      if (i.status !== 'closed' || i.type === 'info' || i.type === 'metric') continue;
      if (superseded.has(itemKey(m.id, i.ref)) || !closedAt(i)) continue;
      if (!withArchived && archived.has(itemKey(m.id, i.ref))) continue;
      rows.push({ item: i, meeting: m, age: null, chain: [] });
    }
  }
  return rows.sort((a, b) => (closedAt(b.item) || '').localeCompare(closedAt(a.item) || ''));
}

export function groupInbox(meetings, { now = new Date(), types = null, archived = new Set() } = {}) {
  const summary = seriesSummary(meetings, now);
  const groups = { overdue: [], week: [], nodate: [], later: [], doing: [], done: [] };
  for (const r of summary.rows) {
    if (types && !types.has(r.item.type)) continue;
    groups[bucket(r.item, now)].push(r);
  }
  for (const k of ['overdue', 'week', 'later']) groups[k].sort(byDue);
  const all = finishedRows(meetings, { now, archived, withArchived: true });
  groups.done = all.filter((r) => !archived.has(itemKey(r.meeting.id, r.item.ref)) && (!types || types.has(r.item.type)));
  const archivedRows = all.filter((r) => archived.has(itemKey(r.meeting.id, r.item.ref)));
  const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]));
  const newest = [...meetings].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.seq || 0) - (b.seq || 0)).pop();
  return { open: summary.open, groups, counts, archived: archivedRows, next: newest || null };
}
