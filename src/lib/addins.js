/**
 * ADD-INS — Add-in API v0 (board T05, PRD ADD-001, roadmap threadbear-mapping step 5).
 *
 * CONTRACT
 *  An add-in is a DECLARATIVE manifest: JSON data, no code. Chrome MV3 forbids remote and
 *  eval'd code, so the mapping's "default export" is read here as "a manifest object".
 *  Manifests are bundled with the extension (src/addins/<id>/manifest.json, inlined by
 *  esbuild). Nothing is loaded from a transcript, a meeting payload or the network, and no
 *  add-in can run a shell command or fetch: the only things a manifest can ask for are the
 *  fixed calls in CALLS below.
 *
 *  Manifest v0 (unknown fields are an error):
 *    { manifest: 0, id, name, version, description?,
 *      appliesTo: 'always' | { projectType?: [..], seriesId?: [..] },   // either key matching = applies
 *      actions?: [{ id, label, when?, badge?, do }],                    // chips in the Notes panel
 *      panels?:  [{ id, title, source: 'seriesSummary', when?, badge? }],
 *      hooks?:   [{ on, do }] }     // on = 'meeting.end' (validated and shown, not fired) | 'caption.final' | 'meeting.draft'
 *    do = { call: 'addItem', type: 'info'|'decision', text }  |  { call: 'openUrl', url: 'https://…' }
 *       | { call: 'recapEmail' }   build a plain-text recap + mailto: draft of the open meeting (nothing is sent)
 *       | { call: 'exportIcs' }    one .ics file with the series' open actions that have a due date
 *       | { call: 'applyGlossary' }  only as the action of a caption.final / meeting.draft hook (and those hooks take
 *                                    nothing else): rewrites caption / draft text with the series glossary
 *    panels source 'glossary' = the per-series term editor (lib/glossary.js); 'seriesSummary' = open actions.
 *    when  = 'always' | '<counter> <op> <int>', op in > >= == <
 *    badge = a counter name.  Counters read the open meeting: see COUNTERS.
 *
 *  validateManifest(json)      -> { ok:true, value } | { ok:false, error, code }
 *  manifestHash(json)          -> 16 hex chars, stable under key order
 *  trustState(json, trusted, removed=[]) -> 'needs-trust'|'enabled'|'changed'|'broken'|'removed'
 *  appliesTo / evalWhen / badge / mayCall / visibleActions / panelRows / runAction / listAddins
 *
 *  Trust: chrome.storage.local `ysmAddinTrust` = { id: hash }, `ysmAddinRemoved` = [id]. Trust
 *  records the hash; a manifest whose hash differs is 'changed' and never runs until trusted again.
 *  This module is pure; storage and DOM live in addins-ui.js.
 */
import { PROJECT_TYPES, pickText } from './notes-schema.js';
import { addItem, seriesSummary } from './notes-actions.js';
import { buildRecap, mailtoUrl } from './recap-email.js';
import { buildIcs, dueActionRows } from './ics-export.js';

export const TRUST_KEY = 'ysmAddinTrust';
export const REMOVED_KEY = 'ysmAddinRemoved';

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const TOP = ['manifest', 'id', 'name', 'version', 'description', 'appliesTo', 'actions', 'panels', 'hooks'];
const ADD_TYPES = ['info', 'decision'];
const PANEL_SOURCES = ['seriesSummary', 'glossary'];
const HOOK_EVENTS = ['meeting.end', 'caption.final', 'meeting.draft'];
const GLOSSARY_EVENTS = ['caption.final', 'meeting.draft'];
const NO_ARG_CALLS = ['recapEmail', 'exportIcs', 'applyGlossary'];
const OPS = ['>', '>=', '==', '<'];

const COUNTERS = {
  items: (m) => m.items.length,
  decisions: (m) => m.items.filter((i) => i.type === 'decision').length,
  actions: (m) => m.items.filter((i) => i.type === 'action').length,
  openActions: (m) => m.items.filter((i) => i.type === 'action' && i.status !== 'closed').length,
  questions: (m) => m.items.filter((i) => i.type === 'question').length,
  risks: (m) => m.items.filter((i) => i.type === 'risk').length,
  unreviewed: (m) => m.items.filter((i) => i.review === 'ai').length,
};
const COUNTER_NAMES = Object.keys(COUNTERS);

const fail = (code, error) => ({ ok: false, code, error });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function checkExpr(e, kind) {
  if (e === undefined || e === 'always') return null;
  if (kind === 'badge') return COUNTER_NAMES.includes(e) ? null : `badge must be one of ${COUNTER_NAMES.join(', ')}`;
  const p = typeof e === 'string' ? e.split(' ') : [];
  if (p.length === 3 && COUNTER_NAMES.includes(p[0]) && OPS.includes(p[1]) && /^\d{1,6}$/.test(p[2])) return null;
  return `when must be "always" or "<counter> <op> <number>" (counters: ${COUNTER_NAMES.join(', ')})`;
}

function checkDo(d) {
  if (!isObj(d)) return fail('bad-action', 'do must be an object');
  if (d.call === 'addItem') {
    if (!ADD_TYPES.includes(d.type)) return fail('bad-action', `addItem type must be ${ADD_TYPES.join(' or ')}`);
    if (!isStr(d.text, 280)) return fail('bad-action', 'addItem needs text (1-280 characters)');
    if (Object.keys(d).some((k) => !['call', 'type', 'text'].includes(k))) return fail('bad-action', 'addItem takes call, type, text only');
    return null;
  }
  if (d.call === 'openUrl') {
    if (typeof d.url !== 'string' || !d.url.startsWith('https://') || /\s/.test(d.url)) return fail('not-https', 'openUrl accepts https:// addresses only');
    try {
      if (new URL(d.url).protocol !== 'https:') throw new Error();
    } catch {
      return fail('not-https', 'openUrl accepts https:// addresses only');
    }
    if (Object.keys(d).some((k) => !['call', 'url'].includes(k))) return fail('bad-action', 'openUrl takes call, url only');
    return null;
  }
  if (NO_ARG_CALLS.includes(d.call)) {
    return Object.keys(d).length === 1 ? null : fail('bad-action', `${d.call} takes no arguments`);
  }
  return fail('unknown-call', `"${String(d.call)}" is not an allowed call; v0 allows addItem, openUrl, recapEmail, exportIcs and applyGlossary. Add-ins cannot run shell commands.`);
}

export function validateManifest(json) {
  if (!isObj(json)) return fail('not-object', 'The manifest must be a JSON object');
  if (json.manifest !== 0) return fail('bad-version', 'manifest must be 0 (Add-in API v0)');
  if (typeof json.id !== 'string' || !ID_RE.test(json.id)) return fail('bad-id', 'id must be 1-40 lowercase letters, digits or dashes');
  if (!isStr(json.name, 60)) return fail('bad-name', 'name is required (max 60 characters)');
  if (!isStr(json.version, 20)) return fail('bad-version', 'version is required');
  const extra = Object.keys(json).find((k) => !TOP.includes(k));
  if (extra) return fail('unknown-field', `Unknown field "${extra}"`);
  const a = json.appliesTo;
  if (a !== 'always') {
    const okObj = isObj(a) && Object.keys(a).length > 0 && Object.keys(a).every((k) => k === 'projectType' || k === 'seriesId');
    const okLists = okObj && (a.projectType === undefined || (Array.isArray(a.projectType) && a.projectType.length > 0 && a.projectType.every((t) => PROJECT_TYPES.includes(t))))
      && (a.seriesId === undefined || (Array.isArray(a.seriesId) && a.seriesId.length > 0 && a.seriesId.every((s) => isStr(s))));
    if (!okLists) return fail('bad-applies-to', 'appliesTo must be "always" or name projectType / seriesId lists');
  }
  for (const key of ['actions', 'panels', 'hooks']) {
    if (json[key] !== undefined && !Array.isArray(json[key])) return fail(`bad-${key}`, `${key} must be a list`);
  }
  for (const x of json.actions || []) {
    if (!isObj(x) || !ID_RE.test(x.id || '') || !isStr(x.label, 40)) return fail('bad-action', 'each action needs id and label');
    if (Object.keys(x).some((k) => !['id', 'label', 'when', 'badge', 'do'].includes(k))) return fail('bad-action', 'action takes id, label, when, badge, do only');
    const bad = checkExpr(x.when, 'when') || checkExpr(x.badge, 'badge');
    if (bad) return fail('bad-expr', bad);
    const d = checkDo(x.do);
    if (d) return d;
    if (x.do.call === 'applyGlossary') return fail('bad-action', 'applyGlossary runs from a caption.final or meeting.draft hook, not from a button');
  }
  for (const p of json.panels || []) {
    if (!isObj(p) || !ID_RE.test(p.id || '') || !isStr(p.title, 40) || !PANEL_SOURCES.includes(p.source)) return fail('bad-panel', `each panel needs id, title and source (${PANEL_SOURCES.join(', ')})`);
    if (Object.keys(p).some((k) => !['id', 'title', 'source', 'when', 'badge'].includes(k))) return fail('bad-panel', 'panel takes id, title, source, when, badge only');
    const bad = checkExpr(p.when, 'when') || checkExpr(p.badge, 'badge');
    if (bad) return fail('bad-expr', bad);
  }
  for (const h of json.hooks || []) {
    if (!isObj(h) || !HOOK_EVENTS.includes(h.on)) return fail('bad-hook', `hook "on" must be ${HOOK_EVENTS.join(' or ')}`);
    if (Object.keys(h).some((k) => !['on', 'do'].includes(k))) return fail('bad-hook', 'hook takes on, do only');
    const d = checkDo(h.do);
    if (d) return d;
    if (GLOSSARY_EVENTS.includes(h.on) !== (h.do.call === 'applyGlossary')) return fail('bad-hook', `${GLOSSARY_EVENTS.join(' and ')} hooks run applyGlossary, and applyGlossary runs from nothing else`);
  }
  return { ok: true, value: JSON.parse(JSON.stringify(json)) };
}

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));

/** shortcut: 2x32-bit FNV-1a, catches edits not forgery; the files ship inside the signed package, upgrade to SHA-256 if manifests ever come from outside. */
export function manifestHash(json) {
  const s = canon(json);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function trustState(json, trusted = {}, removed = []) {
  if (isObj(json) && removed.includes(json.id)) return 'removed';
  const v = validateManifest(json);
  if (!v.ok) return 'broken';
  const h = Object.hasOwn(trusted, v.value.id) ? trusted[v.value.id] : undefined;
  if (h === undefined) return 'needs-trust';
  return h === manifestHash(v.value) ? 'enabled' : 'changed';
}

export function appliesTo(manifest, meeting) {
  if (!meeting) return false;
  const a = manifest.appliesTo;
  if (a === 'always') return true;
  return !!((a.projectType && a.projectType.includes(meeting.projectType)) || (a.seriesId && a.seriesId.includes(meeting.seriesId)));
}

export function badge(name, meeting) {
  return COUNTER_NAMES.includes(name) && meeting ? COUNTERS[name](meeting) : 0;
}

export function evalWhen(expr, meeting) {
  if (expr === undefined || expr === 'always') return true;
  if (checkExpr(expr, 'when') || !meeting) return false;
  const [name, op, n] = expr.split(' ');
  const v = COUNTERS[name](meeting);
  const k = Number(n);
  return op === '>' ? v > k : op === '>=' ? v >= k : op === '==' ? v === k : v < k;
}

/** What the trust gate shows: every call the manifest asks for, then what stays refused. */
export function mayCall(manifest) {
  const rows = [];
  const calls = [...(manifest.actions || []).map((x) => x.do), ...(manifest.hooks || []).map((h) => h.do)];
  const seen = new Set();
  const add = (label) => seen.has(label) || (seen.add(label), rows.push({ ok: true, label }));
  for (const d of calls) {
    if (d.call === 'addItem') add(`Register: add item (${d.type})`);
    else if (d.call === 'recapEmail') add('Mail: open a draft in your mail app (mailto:, nothing is sent)');
    else if (d.call === 'exportIcs') add('Calendar: save one .ics file of open actions with a due date');
    else if (d.call === 'applyGlossary') add('Captions and draft: rewrite terms with the series glossary');
    else add(`Open ${new URL(d.url).origin} (https:// only)`);
  }
  for (const p of manifest.panels || []) add(p.source === 'glossary' ? 'Glossary: keep this series’ terms on this device' : 'Register: read open actions (seriesSummary)');
  if ((manifest.actions || []).some((x) => x.do.call === 'recapEmail' || x.do.call === 'exportIcs')) add('Register: read this meeting and the series (no changes)');
  rows.push({ ok: false, label: 'Shell commands' }, { ok: false, label: 'Network, except open https://' });
  return rows;
}

/** Chips for the Notes panel: enabled manifests only, scoped and `when`-gated. */
export function visibleActions(enabled, meeting) {
  const out = [];
  for (const m of enabled) {
    if (!appliesTo(m, meeting)) continue;
    for (const x of m.actions || []) {
      if (!evalWhen(x.when, meeting)) continue;
      out.push({ addinId: m.id, actionId: x.id, label: x.label, call: x.do.call, mutates: x.do.call === 'addItem', badge: x.badge ? badge(x.badge, meeting) : null });
    }
  }
  return out;
}

export function visiblePanels(enabled, meeting) {
  const out = [];
  for (const m of enabled) {
    if (!appliesTo(m, meeting)) continue;
    for (const p of m.panels || []) {
      if (evalWhen(p.when, meeting)) out.push({ addinId: m.id, panelId: p.id, title: p.title, source: p.source, badge: p.badge ? badge(p.badge, meeting) : null });
    }
  }
  return out;
}

/** Open actions across the series, oldest first, through the engine's own seriesSummary. */
export function panelRows(manifest, panelId, meetings, { lang = 'en', now = new Date() } = {}) {
  const p = (manifest.panels || []).find((x) => x.id === panelId);
  if (!p) throw new Error(`panel ${panelId} not found in ${manifest.id}`);
  return seriesSummary(meetings, now).rows
    .filter((r) => r.item.type === 'action')
    .map((r) => ({ ref: r.item.ref, text: pickText(r.item.text, lang), owner: r.item.owner || '', due: r.item.due || '', age: r.age, meetingId: r.meeting.id }));
}

/**
 * Run one action of an enabled add-in. addItem returns the new meeting (caller saves it);
 * openUrl returns the address (caller opens it). The engine's own errors (issued meeting) pass through.
 */
export function runAction(manifest, actionId, meeting, { lang = 'en', meetings = [], now = new Date(), labels } = {}) {
  const x = (manifest.actions || []).find((a) => a.id === actionId);
  if (!x) throw new Error(`action ${actionId} not found in ${manifest.id}`);
  const plural = (n) => (n === 1 ? '' : 's');
  if (x.do.call === 'recapEmail') {
    const recap = buildRecap(meeting, { lang, labels });
    return { kind: 'recap', recap: { ...recap, ...mailtoUrl(recap) }, log: recap.empty ? `${x.label}: nothing to send yet` : `${x.label}: ${recap.to.length} recipient${plural(recap.to.length)}` };
  }
  if (x.do.call === 'exportIcs') {
    const series = (meetings.length ? meetings : [meeting]).filter((m) => m.seriesId === meeting.seriesId);
    const { rows, skipped } = dueActionRows(series, { lang, now });
    const text = buildIcs(rows, { now });
    const filename = `actions-${String(meeting.seriesId).replace(/[^A-Za-z0-9._-]/g, '-')}.ics`;
    return { kind: 'ics', ics: { text, count: rows.length, skipped, filename }, log: text ? `${x.label}: ${rows.length} action${plural(rows.length)} saved` : `${x.label}: nothing with a due date` };
  }
  if (x.do.call === 'openUrl') return { kind: 'open', url: x.do.url, log: `opened ${new URL(x.do.url).origin}` };
  const next = addItem(meeting, { type: x.do.type, text: { [lang]: x.do.text } }, { by: `addin:${manifest.id}` });
  return { kind: 'meeting', meeting: next, log: `${x.label}: added ${next.items.at(-1).ref}` };
}

/** Raw bundled manifests -> list entries. A broken one keeps its error and has no usable manifest. */
export function listAddins(raws, trusted = {}, removed = []) {
  return raws.map((raw, i) => {
    const v = validateManifest(raw);
    const id = (isObj(raw) && typeof raw.id === 'string' && raw.id) || `unknown-${i}`;
    const state = trustState(raw, trusted, removed);
    return {
      id,
      state,
      manifest: v.ok ? v.value : null,
      raw,
      hash: v.ok ? manifestHash(v.value) : null,
      error: v.ok ? null : v.error,
    };
  });
}

/** True when running this action changes the meeting (the caller then refuses on an issued meeting). */
export function actionMutates(manifest, actionId) {
  return (manifest.actions || []).find((a) => a.id === actionId)?.do.call === 'addItem';
}

/** Does any enabled add-in hook `event` (caption.final / meeting.draft) for this meeting? Needs an open meeting: the glossary is per series. */
export function hookActive(enabled, event, meeting) {
  return !!meeting && enabled.some((m) => appliesTo(m, meeting) && (m.hooks || []).some((h) => h.on === event));
}
