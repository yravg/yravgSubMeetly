/**
 * HIGHLIGHTS — pure summary of one meeting for Minutes > Meeting > Highlights (board T04).
 *
 * Contract
 *   in : meeting, { now: Date }
 *   out: { counts:{decisions,actions,questions,risks}, needsYou:[{ref,reason}],
 *          last:[item x5, newest ref first], source:{total,withSource},
 *          files:[{name}], links:[{url}], changes:[{ref,field,from,to,at}] }
 *   - Needs you (closed items never): review 'ai' + confidence < LOW_CONFIDENCE -> 'low';
 *     review 'ai' -> 'review'; an open action past its due date -> 'overdue'.
 *     Accepting or editing an item takes it out of the first two.
 *   - Files and links are read from the item and summary text, nothing is invented.
 *   - Changes come from item history (the review stamp itself is not a change).
 */
import { LOW_CONFIDENCE } from './notes-schema.js';

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;
const FILE_RE = /\b[\w][\w.-]*\.(?:pdf|xlsx?|docx?|pptx?|csv|png|jpe?g|zip|txt|md)\b/gi;

const dayStart = (d) => {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

const textsOf = (meeting) => [
  ...(meeting.items || []).flatMap((i) => Object.values(i.text || {})),
  ...Object.values(meeting.summary || {}),
];

export function highlightsFor(meeting, { now = new Date() } = {}) {
  const items = meeting.items || [];
  const count = (t) => items.filter((i) => i.type === t).length;

  const needsYou = [];
  for (const i of items) {
    if (i.status === 'closed') continue;
    if (i.review === 'ai') {
      needsYou.push({ ref: i.ref, reason: i.confidence < LOW_CONFIDENCE ? 'low' : 'review' });
    } else if (i.type === 'action' && i.due && Date.parse(`${i.due}T00:00:00Z`) < dayStart(now)) {
      needsYou.push({ ref: i.ref, reason: 'overdue' });
    }
  }
  // An AI draft that is also overdue is listed once, as the draft.
  const seen = new Set();
  const unique = needsYou.filter((n) => !seen.has(n.ref) && seen.add(n.ref));

  const last = [...items]
    .sort((a, b) => b.ref.localeCompare(a.ref, undefined, { numeric: true }))
    .slice(0, 5);

  const files = new Map();
  const links = new Map();
  for (const t of textsOf(meeting)) {
    for (const u of t.match(URL_RE) || []) links.set(u.replace(/[.,;:!?]+$/, ''), true);
    for (const f of t.replace(URL_RE, ' ').match(FILE_RE) || []) files.set(f, true);
  }

  const changes = [];
  for (const i of items) {
    for (const r of i.history || []) {
      if (r.field === 'review' || r.field === 'carriedFrom') continue;
      changes.push({ ref: i.ref, field: r.field, from: r.from, to: r.to, at: r.at });
    }
  }
  changes.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    counts: { decisions: count('decision'), actions: count('action'), questions: count('question'), risks: count('risk') },
    needsYou: unique,
    last,
    source: { total: items.length, withSource: items.filter((i) => i.src).length },
    files: [...files.keys()].map((name) => ({ name })),
    links: [...links.keys()].map((url) => ({ url })),
    changes,
  };
}
