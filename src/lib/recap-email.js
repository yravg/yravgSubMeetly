/**
 * RECAP EMAIL — plain-text recap of one meeting + a mailto: draft (add-in `recap-email`).
 *
 * CONTRACT
 *  buildRecap(meeting, { lang, labels }) -> { subject, body, to, noEmail, empty }
 *    body    = title, date, attendees, then Decisions / Actions (open, with owner and due) /
 *              Open questions; a section with nothing in it is left out.
 *    to      = attendee emails that pass isEmail (known ones only; the rest are named in noEmail)
 *    empty   = true when the meeting has no decision, open action or open question to send
 *  mailtoUrl({ to, subject, body }) -> { url, tooLong }
 *    url is null when the link would pass MAILTO_MAX characters: mail clients cut or refuse long
 *    mailto: links, so the caller offers Copy instead. Nothing is sent by this module.
 *  isEmail(s)  strict on purpose: a "?", "&", "," or space in an address would inject mail headers.
 *
 * shortcut: MAILTO_MAX 1900 is the lowest limit seen in the wild (Outlook on Windows ~2000), not Chrome's own; upgrade if a client reports less.
 */
import { pickText } from './notes-schema.js';

export const MAILTO_MAX = 1900;
const EMAIL_RE = /^[A-Za-z0-9._+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const isEmail = (s) => typeof s === 'string' && s.length <= 120 && EMAIL_RE.test(s);

const DEFAULT_LABELS = {
  subject: 'Recap', date: 'Date', attendees: 'Attendees', decisions: 'Decisions', actions: 'Actions',
  questions: 'Open questions', due: 'due', noDue: 'no due date',
};

export function buildRecap(meeting, { lang = 'en', labels = {} } = {}) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const text = (i) => pickText(i.text, lang);
  const items = meeting.items || [];
  const decisions = items.filter((i) => i.type === 'decision');
  const actions = items.filter((i) => i.type === 'action' && i.status !== 'closed');
  const questions = items.filter((i) => i.type === 'question' && i.status !== 'closed');
  const people = meeting.attendees || [];
  const out = [meeting.title, `${L.date}: ${meeting.date}`];
  if (people.length) out.push(`${L.attendees}: ${people.map((a) => (a.org ? `${a.name} (${a.org})` : a.name)).join(', ')}`);
  const section = (title, rows) => rows.length && out.push('', title, ...rows);
  section(L.decisions, decisions.map((i) => `- ${i.ref} ${text(i)}`));
  section(L.actions, actions.map((i) => `- ${i.ref} ${text(i)} — ${[i.owner, i.due ? `${L.due} ${i.due}` : L.noDue].filter(Boolean).join(', ')}`));
  section(L.questions, questions.map((i) => `- ${i.ref} ${text(i)}`));
  out.push('');
  return {
    subject: `${L.subject}: ${meeting.title} (${meeting.date})`,
    body: out.join('\n'),
    to: people.map((a) => a.email).filter(isEmail),
    noEmail: people.filter((a) => !isEmail(a.email)).map((a) => a.name),
    empty: !decisions.length && !actions.length && !questions.length,
  };
}

export function mailtoUrl({ to = [], subject = '', body = '' }) {
  const url = `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
  return url.length > MAILTO_MAX ? { url: null, tooLong: true } : { url, tooLong: false };
}
