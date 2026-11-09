/**
 * Inti Ask Tide (TIDE-007, 018, 019; papan A03, A03b) — murni kecuali fetch yang disuntik.
 *
 * Kontrak:
 *  PROVIDERS        local (helper Qwen, bawaan) · register (tanpa model, dari register) ·
 *                   cloud (OpenRouter lewat helper; needsConsent: harus dinyalakan pengguna).
 *  CLOUD_MODELS     tiga preset dari papan A03b; id OpenRouter dipetakan helper.
 *  trimHistory(h)   6 giliran terakhir.
 *  chatRequest({ provider, model, system, history, question, fetch, origin, signal })
 *                   → async iterable event SSE dari helper POST /ask:
 *                     { delta } … { done, model? } atau tepat satu { error }:
 *                     'helper-offline' (fetch gagal), 'not-connected' (404/501: helper tanpa
 *                     /ask, atau cloud tanpa kunci), 'http' + status untuk lainnya.
 *                   Kunci OpenRouter tinggal di helper, tidak pernah di ekstensi.
 *  readStream(res)  pengurai SSE (`data: {json}`; baris `:` diabaikan; tahan potongan).
 *  buildGrounding(meetings, { meetingId }) → prompt sistem "You are Tide…" dengan bagian
 *                   MEETING, REGISTER, EARLIER IN THIS SERIES, APP FEATURES.
 *  registerAnswer(question, meetings, { now, me }) → { intent, text, steps, cards }
 *                   intent: recap | promises | open | translate-file | unknown.
 *                   Teks memakai **tebal** untuk angka kunci. Kartu: list | bars | action | link.
 *  proposeStatus(meetings, meetingId, refs, status) → kartu aksi; TIDAK mengubah apa pun.
 *  applyProposal(meeting, proposal) → rapat baru (salinan); melempar bila rapat lain
 *                   atau sudah terbit. Hanya dipanggil setelah pengguna menekan Confirm.
 */

export const HELPER_ORIGIN = 'http://127.0.0.1:17865';

export const PROVIDERS = [
  { id: 'local', label: 'Local · Qwen 2.5', needsConsent: false },
  { id: 'register', label: 'Register only', needsConsent: false },
  { id: 'cloud', label: 'Cloud · OpenRouter', needsConsent: true },
];
export const CLOUD_MODELS = [
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', hint: '~1–3 credits / answer' },
  { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', hint: '~1–3 credits / answer' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', hint: '~1–3 credits / answer' },
];

export const trimHistory = (h = [], n = 6) => h.slice(-n);

export async function* readStream(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = function* (block) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    try { yield JSON.parse(data); } catch { /* blok rusak dilewati */ }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      yield* parse(block);
    }
  }
  if (buf.trim()) yield* parse(buf);
}

export async function* chatRequest({ provider, model = null, system, history = [], question, fetch: f = globalThis.fetch, origin = HELPER_ORIGIN, signal } = {}) {
  let res;
  try {
    res = await f(`${origin}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, stream: true, messages: [{ role: 'system', content: system }, ...trimHistory(history), { role: 'user', content: question }] }),
      signal,
    });
  } catch {
    yield { error: 'helper-offline' };
    return;
  }
  if (!res.ok || !res.body) {
    yield res.status === 404 || res.status === 501 ? { error: 'not-connected', status: res.status } : { error: 'http', status: res.status };
    return;
  }
  yield* readStream(res);
}

/* ---------- register ---------- */
const textOf = (t) => (typeof t === 'string' ? t : t?.en || Object.values(t || {}).find(Boolean) || '');
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0);
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Salinan terbaru tiap (seri, ref): status rapat terbaru menang. */
function latestItems(meetings) {
  const map = new Map();
  for (const m of [...meetings].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const i of m.items || []) map.set(`${m.seriesId}\u0000${i.ref}`, { ...i, meetingId: m.id });
  }
  return [...map.values()];
}
const row = (i) => ({ ref: i.ref, type: i.type, text: textOf(i.text), owner: i.owner || null, due: i.due || null, status: i.status, meetingId: i.meetingId });
const itemLine = (i) => {
  const parts = [i.owner && `owner ${i.owner}`, i.due && `due ${i.due}`, i.status].filter(Boolean);
  return `${i.ref} [${i.type}] ${textOf(i.text)} — ${parts.join(', ')}`;
};

export function buildGrounding(meetings = [], { meetingId = null } = {}) {
  const sorted = [...meetings].sort(byNewest);
  const m = sorted.find((x) => x.id === meetingId) || sorted[0];
  const lines = ['You are Tide, the assistant inside yravgSubMeetly. Answer from the register below and say so when it does not cover the question. Keep answers short and put the key figure in bold. You cannot change anything yourself: changes are proposed and the user confirms them.'];
  lines.push('MEETING');
  lines.push(m ? `${m.title} (${m.date}) · series ${m.seriesId} · meeting ${m.seq || 1}${m.issuedAt ? ' · issued' : ' · draft'}` : 'No meeting in the register yet.');
  if (m && textOf(m.summary)) lines.push(`Summary: ${textOf(m.summary)}`);
  lines.push('REGISTER');
  if (m) for (const i of (m.items || []).slice(0, 200)) lines.push(itemLine(i));
  lines.push('EARLIER IN THIS SERIES');
  for (const e of sorted.filter((x) => m && x.seriesId === m.seriesId && x.id !== m.id).slice(0, 8)) {
    lines.push(`${e.title} (${e.date}): ${e.items.length} items, ${e.items.filter((i) => i.status !== 'closed').length} open`);
  }
  lines.push('APP FEATURES');
  lines.push('Live captions and translation, Minutes register (Classic and Modern), History, Files (offline transcription and TXT/SRT/VTT export), Add-ins (Recap email, Glossary, Due dates to calendar), Island, Performance, Library, Training.');
  return lines.join('\n');
}

const INTENTS = [
  ['recap', /recap|summar|last meeting|ringkas|rapat terakhir/i],
  ['promises', /promise|i owe|my action|janji|tugas saya/i],
  ['open', /open action|open item|tindak lanjut terbuka|outstanding/i],
  ['translate-file', /translat\w* (a |the )?file|terjemah\w* berkas/i],
];
const TYPES = ['decision', 'action', 'question', 'risk', 'metric', 'info'];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function proposeStatus(meetings, meetingId, refs, status) {
  return { kind: 'action', op: 'status', meetingId, refs: [...refs], status };
}

export function applyProposal(meeting, p) {
  if (!meeting || meeting.id !== p.meetingId) throw new Error('Proposal is for another meeting');
  if (meeting.issuedAt) throw new Error('Meeting is issued; amend it instead');
  return { ...meeting, items: meeting.items.map((i) => (p.refs.includes(i.ref) ? { ...i, status: p.status } : i)) };
}

export function registerAnswer(question, meetings = [], { now = new Date(), me = null } = {}) {
  const intent = (INTENTS.find(([, re]) => re.test(question)) || ['unknown'])[0];
  const today = isoDay(now);
  const sorted = [...meetings].sort(byNewest);
  if (intent === 'recap') {
    const m = sorted[0];
    if (!m) return { intent, text: 'There is no meeting in the register yet.', steps: ['Looked at the register'], cards: [] };
    const counts = TYPES.map((t) => ({ type: t, n: m.items.filter((i) => i.type === t).length })).filter((c) => c.n);
    const words = counts.map((c) => plural(c.n, c.type)).join(', ');
    return {
      intent,
      text: `**${plural(m.items.length, 'item')}** in ${m.title} (${m.date})${words ? `: ${words}` : ''}.${m.issuedAt ? '' : ' The minutes are not issued yet.'}`,
      steps: [`Looked at ${m.title}`],
      cards: [{ kind: 'bars', rows: counts }, { kind: 'list', rows: m.items.slice(0, 8).map((i) => row({ ...i, meetingId: m.id })) }],
    };
  }
  if (intent === 'promises') {
    if (!me) return { intent, text: 'Tell me your name first: set it in the Minutes register (Mine filter), then ask again.', steps: [], cards: [] };
    const mine = latestItems(meetings).filter((i) => i.type === 'action' && i.status !== 'closed' && i.owner === me)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    return { intent, text: `**${plural(mine.length, 'open action')}** owned by ${me}.`, steps: [`Looked at ${plural(meetings.length, 'meeting')}`], cards: mine.length ? [{ kind: 'list', rows: mine.map(row) }] : [] };
  }
  if (intent === 'open') {
    const open = latestItems(meetings).filter((i) => i.type === 'action' && i.status !== 'closed')
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const overdue = open.filter((i) => i.due && i.due < today);
    const cards = open.length ? [{ kind: 'list', rows: open.map(row) }] : [];
    if (overdue.length) {
      const first = overdue[0].meetingId;
      const refs = overdue.filter((i) => i.meetingId === first).map((i) => i.ref);
      const m = meetings.find((x) => x.id === first);
      if (m && !m.issuedAt) cards.push({ ...proposeStatus(meetings, first, refs, 'closed'), label: `Mark ${refs.join(', ')} done in ${m.title}?` });
    }
    return { intent, text: `**${plural(open.length, 'open action')}**, **${overdue.length} overdue**.`, steps: [`Looked at ${plural(meetings.length, 'meeting')}`], cards };
  }
  if (intent === 'translate-file') {
    return { intent, text: 'Drop the file on the **Files** page; it is transcribed and translated on this device, then exported as TXT, SRT or VTT.', steps: [], cards: [{ kind: 'link', href: '#files', label: 'Open Files' }] };
  }
  return { intent, text: 'Register only answers recaps, promises and open actions. Switch to the Local model for other questions.', steps: [], cards: [] };
}
