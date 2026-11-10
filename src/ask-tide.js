/**
 * Dialog Ask Tide (TIDE-007, 018, 019, 020 tampilan; papan A03, A03b).
 *
 * mountAskTide({ lang, getMeetings, onSaved, storage }) → { open(question?), close() }
 *  - Penyedia: Local (helper Qwen, bawaan) · Register only · Cloud (OpenRouter lewat
 *    helper, harus diizinkan sekali lewat kartu persetujuan; `ysmAskCloudConsent`).
 *  - Jawaban Local/Cloud dialirkan dari helper POST /ask; bila helper mati atau belum
 *    punya rute itu, dialog mengatakannya dan menawarkan jawaban dari register.
 *  - Satu-satunya jalan menulis: kartu aksi → Confirm → applyProposal + saveMeeting.
 *  - "Export …" tidak menulis register: berkas Markdown disimpan di sini (ask-export.js) dan
 *    kartu menampilkan "Done · N rows" + Open (ekstensi) atau nama berkas (lab / jendela engine).
 *  - Sesi (maks 20 giliran) di localStorage `ysmAskSession`; 6 terakhir dikirim ke model.
 *  - Kredit: belum ada server akun (TIDE-022), jadi chip menyatakan "No server yet";
 *    jawaban Local dan Register only gratis. `getCredits() → {balance, sample?} | null` bisa
 *    disuntik; bawaannya hanya membaca contoh berlabel `ysmCreditsSample` (lab). <10 → banner,
 *    0 → kartu Out of credits, Kirim mati, Use Local (hanya saat Awan dipilih).
 */
import {
  PROVIDERS, CLOUD_MODELS, chatRequest, buildGrounding, registerAnswer, applyProposal, exportAnswer,
} from './lib/ask-tide.js';
import { saveExport, openExport } from './lib/ask-export.js';
import { saveMeeting } from './lib/notes-store.js';

const STR = {
  en: {
    title: 'Ask Tide', newChat: 'New chat', close: 'Close', placeholder: 'Ask Tide about your meetings…', send: 'Send',
    model: 'Model', local: 'Local', localD: 'Default. Runs on this computer, 0 credits.', register: 'Register only', registerD: 'No model. Answers from your register, 0 credits.',
    cloud: 'Cloud · OpenRouter', credits: 'Credits', noServer: 'No server yet', topUp: 'Top up', onThisComputer: 'On this computer', sample: 'sample', modelPrefix: 'Model',
    lowTitle: (n) => `${n} credits left.`, lowBody: 'A cloud answer costs about 1–3. Top up, or switch to Local.', outTitle: 'Out of credits.', outBody: 'Local answers still work.',
    markDone: 'Mark as done', more: (n) => `+${n} more`, listFoot: (n, m) => `${n} ${n === 1 ? 'item' : 'items'} in ${m} ${m === 1 ? 'meeting' : 'meetings'}`,
    consentTitle: 'Turn on cloud answers?', consentBody: (m) => `Your question and the register lines Tide needs are sent to OpenRouter (${m}). Audio never leaves this device. Cloud answers cost credits once the account server exists.`, cancel: 'Cancel', turnOn: 'Turn on cloud',
    srcRegister: 'From your register', srcLocal: 'Local model · Qwen', srcCloud: (m) => `Cloud model · ${m} · text was sent to OpenRouter`,
    looked: 'Steps', thinking: 'Tide is thinking…',
    errOffline: 'The Native Helper is not running, so the local model cannot answer.', errNoAsk: 'This helper has no Ask route yet. Update the helper to use the local model.',
    errCloud: 'Cloud is not connected: the helper has no OpenRouter key.', errHttp: (s) => `The helper answered with an error (${s}).`, errModel: (m) => `The model stopped: ${m}`,
    useRegister: 'Answer from the register', useLocal: 'Use Local',
    exportTitle: 'Export to Markdown', exportDone: (n) => `Done · ${n} ${n === 1 ? 'row' : 'rows'}`, open: 'Open', exportFailed: (m) => `Could not save the file: ${m}`,
    confirm: 'Confirm', done: 'Done. The register is updated.', cancelled: 'Cancelled. Nothing changed.', failed: (m) => `Could not save: ${m}`,
    empty: 'Ask about decisions, promises and open actions. Answers come from your register on this device.',
    chips: ['Recap last meeting', 'What did I promise?', 'Open actions', 'Translate a file'],
  },
  id: {
    title: 'Tanya Tide', newChat: 'Obrolan baru', close: 'Tutup', placeholder: 'Tanyakan rapat Anda ke Tide…', send: 'Kirim',
    model: 'Model', local: 'Lokal', localD: 'Bawaan. Berjalan di komputer ini, 0 kredit.', register: 'Hanya register', registerD: 'Tanpa model. Menjawab dari register, 0 kredit.',
    cloud: 'Awan · OpenRouter', credits: 'Kredit', noServer: 'Belum ada server', topUp: 'Isi ulang', onThisComputer: 'Di komputer ini', sample: 'contoh', modelPrefix: 'Model',
    lowTitle: (n) => `Sisa ${n} kredit.`, lowBody: 'Satu jawaban awan sekitar 1–3 kredit. Isi ulang, atau pindah ke Lokal.', outTitle: 'Kredit habis.', outBody: 'Jawaban Lokal tetap jalan.',
    markDone: 'Tandai selesai', more: (n) => `+${n} lagi`, listFoot: (n, m) => `${n} butir di ${m} rapat`,
    consentTitle: 'Nyalakan jawaban awan?', consentBody: (m) => `Pertanyaan dan baris register yang diperlukan dikirim ke OpenRouter (${m}). Audio tidak pernah keluar dari perangkat ini. Jawaban awan memakai kredit setelah server akun tersedia.`, cancel: 'Batal', turnOn: 'Nyalakan awan',
    srcRegister: 'Dari register Anda', srcLocal: 'Model lokal · Qwen', srcCloud: (m) => `Model awan · ${m} · teks dikirim ke OpenRouter`,
    looked: 'Langkah', thinking: 'Tide sedang berpikir…',
    errOffline: 'Native Helper tidak berjalan, jadi model lokal tidak bisa menjawab.', errNoAsk: 'Helper ini belum punya rute Ask. Perbarui helper untuk memakai model lokal.',
    errCloud: 'Awan belum tersambung: helper tidak punya kunci OpenRouter.', errHttp: (s) => `Helper menjawab dengan galat (${s}).`, errModel: (m) => `Model berhenti: ${m}`,
    useRegister: 'Jawab dari register', useLocal: 'Pakai Lokal',
    exportTitle: 'Ekspor ke Markdown', exportDone: (n) => `Selesai · ${n} baris`, open: 'Buka', exportFailed: (m) => `Berkas tidak bisa disimpan: ${m}`,
    confirm: 'Konfirmasi', done: 'Selesai. Register diperbarui.', cancelled: 'Dibatalkan. Tidak ada yang berubah.', failed: (m) => `Gagal menyimpan: ${m}`,
    empty: 'Tanyakan keputusan, janji dan tindak lanjut terbuka. Jawaban berasal dari register di perangkat ini.',
    chips: ['Ringkas rapat terakhir', 'Apa yang saya janjikan?', 'Tindak lanjut terbuka', 'Terjemahkan berkas'],
  },
};
const CHIP_Q = ['Recap last meeting', 'What did I promise?', 'Open actions', 'Translate a file'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
};

/** Saldo: belum ada server akun (TIDE-022), jadi tidak ada. Hanya contoh berlabel "sample" dari ysmCreditsSample (lab). */
const sampleCredits = () => { const v = store.get('ysmCreditsSample', null); return Number.isFinite(v) ? { balance: Math.max(0, Math.floor(v)), sample: true } : null; };
const SPARK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z"/></svg>';
const svg = (d, n = 18, w = 1.9) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', chat: '<path d="M5 5h14v10H10l-5 4z"/>', risk: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>', dot: '<circle cx="12" cy="12" r="3"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', down: '<path d="M6 9l6 6 6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
};
const TYPE_ICON = { action: 'flag', decision: 'check', question: 'chat', risk: 'risk' };

export function mountAskTide({ lang = 'en', showCredits = false, getCredits = sampleCredits, getMeetings, onSaved = () => {}, chrome = globalThis.chrome, fetch: f = globalThis.fetch } = {}) {
  const T = (k, ...a) => { const v = STR[lang]?.[k] ?? STR.en[k]; return typeof v === 'function' ? v(...a) : v; };
  const ov = document.createElement('div');
  ov.className = 'ask-ov';
  ov.hidden = true;
  ov.innerHTML = `<div class="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
    <header class="ask-h">${SPARK}<h2 id="ask-title">${esc(T('title'))}</h2>
      <span class="grow"></span>
      <span class="ask-credits"></span>
      <button type="button" class="icon-b" data-ask="new" aria-label="${esc(T('newChat'))}" title="${esc(T('newChat'))}">${svg(ICON.plus, 20)}</button>
      <button type="button" class="icon-b" data-ask="close" aria-label="${esc(T('close'))}" title="${esc(T('close'))}">${svg(ICON.x, 20)}</button></header>
    <div class="ask-body" aria-live="polite"></div>
    <form class="ask-comp">
      <textarea rows="1" placeholder="${esc(T('placeholder'))}" aria-label="${esc(T('placeholder'))}"></textarea>
      <button type="button" class="mpill ask-model" data-ask="pick" aria-haspopup="listbox" aria-expanded="false"></button>
      <div class="ask-pick" role="listbox" hidden></div>
      <button type="submit" class="send" aria-label="${esc(T('send'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
    </form></div>`;
  document.body.append(ov);
  const $ = (s) => ov.querySelector(s);
  const body = $('.ask-body'); const ta = $('textarea'); const send = $('.send'); const pick = $('.ask-pick');

  const state = {
    provider: store.get('ysmAskProvider', 'local'),
    model: store.get('ysmAskModel', CLOUD_MODELS[0].id),
    consent: false,
    turns: store.get('ysmAskSession', []),
    busy: false,
    pending: null, // pertanyaan yang menunggu persetujuan awan
  };
  const modelLabel = () => (state.provider === 'cloud' ? `${T('cloud').split(' · ')[0]} · ${CLOUD_MODELS.find((m) => m.id === state.model)?.label}` : state.provider === 'register' ? T('register') : `${T('local')} · Qwen 2.5`);
  const save = () => store.set('ysmAskSession', state.turns.slice(-20));
  const credits = () => { try { const c = showCredits ? getCredits() : null; return c && Number.isFinite(c.balance) ? c : null; } catch { return null; } };
  const outOfCredits = () => state.provider === 'cloud' && credits()?.balance === 0;
  const srcOf = (t) => (showCredits && t.free ? `${t.source} · 0 ${T('credits').toLowerCase()}` : t.source);

  function paintHeader() {
    const c = credits();
    const cls = !c ? '' : c.balance === 0 ? 'bad' : c.balance < 10 ? 'warn' : 'ok';
    $('.ask-credits').innerHTML = !showCredits ? '' : `<a class="chip sm credits ${cls}" href="#plans" data-ask="plans">${c ? `${svg(ICON.bolt, 16)}${esc(T('credits'))} ${c.balance}${c.sample ? ` · ${esc(T('sample'))}` : ''}` : `${esc(T('credits'))}<span class="cr-detail"> · ${esc(T('noServer'))}</span>`}</a><a class="btn sm" href="#plans" data-ask="plans">${esc(T('topUp'))}</a>`;
  }

  function paintModel() {
    $('.ask-model').innerHTML = `<span class="mp-prefix">${esc(T('modelPrefix'))}:</span> ${esc(modelLabel())} ${svg(ICON.down, 14, 2)}`;
    const off = !ta.value.trim() || state.busy || outOfCredits();
    send.classList.toggle('off', off);
    send.disabled = off;
  }

  const tile = (icon, cls = '') => `<span class="tl2 ${cls}" aria-hidden="true">${svg(ICON[icon], 18)}</span>`;

  function cardHtml(c, ti, ci) {
    if (c.kind === 'list') {
      const shown = c.rows.slice(0, 6);
      return `<div class="ask-card list"><div class="lh"><b>${esc(c.title || '')}</b><strong>${c.rows.length}</strong></div>${shown.map((r) => `<div class="lrow">${tile(TYPE_ICON[r.type] || 'dot', r.late ? 'late' : '')}<span class="tx"><b>${esc(r.text)}</b><small>${esc([r.type[0].toUpperCase() + r.type.slice(1), r.meeting, r.due && `due ${r.due}`, r.owner].filter(Boolean).join(' · '))}</small></span><span class="r${r.late ? ' late' : ''}">${esc(r.label || '')}</span></div>`).join('')}<div class="ft">${esc(T('listFoot', c.rows.length, c.meetings || 1))}${c.rows.length > shown.length ? ` · ${esc(T('more', c.rows.length - shown.length))}` : ''}</div></div>`;
    }
    if (c.kind === 'bars') { const max = Math.max(1, ...c.rows.map((r) => r.n)); return `<div class="ask-card bars">${c.rows.map((r) => `<div class="br"><span>${esc(r.type)}</span><i style="width:${Math.round((r.n / max) * 100)}%"></i><b>${r.n}</b></div>`).join('')}</div>`; }
    if (c.kind === 'export') {
      const end = c.error ? `<span class="bad">${esc(T('exportFailed', c.error))}</span>`
        : `<span class="ok">${esc(T('exportDone', c.count))}</span>${c.id != null ? `<button type="button" class="op" data-act="open-file" data-t="${ti}" data-c="${ci}">${esc(T('open'))} ${svg('<path d="M9 6l6 6-6 6"/>', 14, 2)}</button>` : `<span class="fn" title="${esc(c.filename)}">${esc(c.filename)}</span>`}`;
      return `<div class="ask-card export"><span class="etile" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></span><span class="et"><b>${esc(T('exportTitle'))}</b><small>${esc(c.sub)}</small></span>${end}</div>`;
    }
    if (c.kind === 'link') return `<div class="ask-card link"><a class="btn" href="${esc(c.href)}" data-ask="link">${esc(c.label)} →</a></div>`;
    if (c.kind === 'action') {
      const st = c.result ? `<p class="${c.result === 'done' ? 'ok' : c.result === 'cancelled' ? 'mut' : 'bad'}">${esc(c.result === 'done' ? T('done') : c.result === 'cancelled' ? T('cancelled') : T('failed', c.error))}</p>` : `<div class="row"><button type="button" class="btn" data-act="cancel" data-t="${ti}" data-c="${ci}">${esc(T('cancel'))}</button><button type="button" class="pill-b sm" data-act="confirm" data-t="${ti}" data-c="${ci}">${esc(T('confirm'))}</button></div>`;
      return `<div class="ask-card action"><div class="h">${tile('cal')}${esc(T('markDone'))}</div><small>${esc(c.label)}</small>${st}</div>`;
    }
    if (c.kind === 'consent') {
      return c.result ? '' : `<div class="ask-card consent"><div class="h">${tile('lock')}${esc(T('consentTitle'))}</div><p>${esc(T('consentBody', CLOUD_MODELS.find((m) => m.id === state.model)?.label))}</p><div class="row"><button type="button" class="btn" data-act="consent-no" data-t="${ti}" data-c="${ci}">${esc(T('cancel'))}</button><button type="button" class="pill-b sm" data-act="consent-yes" data-t="${ti}" data-c="${ci}">${esc(T('turnOn'))}</button></div></div>`;
    }
    if (c.kind === 'fallback') return `<div class="ask-card link"><button type="button" class="btn" data-act="${c.to}" data-t="${ti}">${esc(c.to === 'use-register' ? T('useRegister') : T('useLocal'))}</button></div>`;
    return '';
  }

  const step = (t) => (t.steps.length > 1
    ? `<details class="steps"><summary>${svg(ICON.eye, 16)}<span>${esc(t.steps[0])}</span><span class="grow"></span>${svg(ICON.down, 16)}</summary>${t.steps.slice(1).map((s) => `<div>${esc(s)}</div>`).join('')}</details>`
    : `<div class="steps one">${svg(ICON.eye, 16)}<span>${esc(t.steps[0])}</span></div>`);

  function paint() {
    paintHeader();
    const c = credits();
    const banner = state.provider === 'cloud' && c ? (c.balance === 0
      ? `<div class="callout warn" role="status">${svg(ICON.bolt, 18)}<div><b>${esc(T('outTitle'))}</b> ${esc(T('outBody'))}<div class="row"><a class="btn sm dark" href="#plans" data-ask="plans">${esc(T('topUp'))}</a><button type="button" class="btn sm" data-act="use-local-banner">${esc(T('useLocal'))}</button></div></div></div>`
      : c.balance < 10 ? `<div class="callout warn" role="status">${svg(ICON.bolt, 18)}<span><b>${esc(T('lowTitle', c.balance))}</b> ${esc(T('lowBody'))}</span></div>` : '') : '';
    if (!state.turns.length) {
      body.innerHTML = `${banner}<div class="ask-empty"><p>${esc(T('empty'))}</p><div class="chips">${T('chips').map((x, i) => `<button type="button" class="chip" data-chip="${i}">${esc(x)}</button>`).join('')}</div></div>`;
    } else {
      body.innerHTML = (c?.balance > 0 ? banner : '') + state.turns.map((t, ti) => (t.role === 'user'
        ? `<div class="u-bub">${esc(t.content)}</div>`
        : `<div class="a-turn">${t.steps?.length ? step(t) : ''}
            ${t.typing ? `<div class="typing" role="status" aria-label="${esc(T('thinking'))}"><span class="avm"><img src="tide/01-tide-mark-green.svg" alt="" /></span><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>` : ''}
            ${t.error ? `<div class="callout danger" role="alert"><p>${esc(t.error)}</p></div>` : ''}
            ${t.content ? `<div class="a-txt">${md(t.content)}</div>` : ''}
            ${t.source && !t.typing && !t.error ? `<div class="src">${esc(srcOf(t))}</div>` : ''}
            ${(t.cards || []).map((x, ci) => cardHtml(x, ti, ci)).join('')}</div>`)).join('') + (c?.balance === 0 ? banner : '');
    }
    body.scrollTop = body.scrollHeight;
    paintModel();
  }

  const lastUserQ = (ti) => { for (let i = ti; i >= 0; i--) if (state.turns[i].role === 'user') return state.turns[i].content; return ''; };

  async function answer(q, provider = state.provider) {
    const meetings = await getMeetings();
    const ex = exportAnswer(q, meetings, { now: new Date() });
    if (ex) { // un export is not a model question: same answer whichever provider is picked
      // The card is the answer, as drawn on A03: no text, steps or source line above or below it.
      state.turns.push(ex.card ? { role: 'assistant', content: '', cards: [ex.card] } : { role: 'assistant', content: ex.text, steps: ex.steps, source: T('srcRegister'), free: true });
      if (ex.file) {
        const r = await saveExport(ex.file, { chrome });
        Object.assign(ex.card, r.ok ? { id: r.id, via: r.via } : { error: r.error });
      }
      save(); paint();
      return;
    }
    if (provider === 'register') {
      const r = registerAnswer(q, meetings, { now: new Date(), me: store.get('ysmMinutesMe', null) || localStorage.getItem('ysmMinutesMe') });
      state.turns.push({ role: 'assistant', content: r.text, steps: r.steps, cards: r.cards, source: T('srcRegister'), free: true });
      save(); paint();
      return;
    }
    if (provider === 'cloud' && !state.consent) {
      state.turns.push({ role: 'assistant', content: '', cards: [{ kind: 'consent' }], source: '' });
      save(); paint();
      return;
    }
    const turn = { role: 'assistant', content: '', typing: true, steps: [`Looked at ${meetings[0]?.title || 'the register'}`], source: provider === 'cloud' ? T('srcCloud', CLOUD_MODELS.find((m) => m.id === state.model)?.label) : T('srcLocal'), free: provider !== 'cloud' };
    state.turns.push(turn);
    state.busy = true; paint();
    const history = state.turns.filter((t) => !t.typing && t.content).slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
    for await (const ev of chatRequest({ provider, model: provider === 'cloud' ? state.model : null, system: buildGrounding(meetings), history, question: q, fetch: f, origin: globalThis.__ysmWebHost ? location.origin : undefined })) {
      if (ev.delta) { turn.content += ev.delta; paint(); }
      if (ev.error) {
        turn.error = ev.error === 'helper-offline' ? T('errOffline') : ev.error === 'not-connected' ? (provider === 'cloud' ? T('errCloud') : T('errNoAsk')) : ev.error === 'http' ? T('errHttp', ev.status) : T('errModel', ev.error);
        turn.cards = [{ kind: 'fallback', to: 'use-register' }].concat(provider === 'cloud' ? [{ kind: 'fallback', to: 'use-local' }] : []);
        turn.source = '';
      }
    }
    turn.typing = false; state.busy = false;
    save(); paint();
  }

  async function ask(q) {
    q = q.trim();
    if (!q || state.busy) return;
    state.turns.push({ role: 'user', content: q });
    ta.value = ''; ta.style.height = 'auto';
    paint();
    await answer(q);
  }

  ov.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-ask]')?.dataset.ask;
    if (e.target === ov || a === 'close' || a === 'plans' || a === 'link') close();
    if (a === 'new') { state.turns = []; save(); paint(); ta.focus(); }
    if (a === 'pick') {
      const open = pick.hidden;
      pick.hidden = !open;
      $('.ask-model').setAttribute('aria-expanded', String(open));
      if (open) {
        const opt = (prov, id, name, desc, hint = '') => `<button type="button" role="option" aria-selected="${state.provider === prov && (prov !== 'cloud' || state.model === id)}" data-prov="${prov}" data-model="${id || ''}"><span class="rd" aria-hidden="true"></span><span class="ot"><b>${esc(name)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</button>`;
        pick.innerHTML = `<div class="g">${esc(T('onThisComputer'))}</div>` + opt('local', '', T('local'), T('localD')) + opt('register', '', T('register'), T('registerD')) + `<div class="g">${esc(T('cloud'))}</div>` + CLOUD_MODELS.map((m) => opt('cloud', m.id, m.label, '', m.hint)).join('');
      }
    }
    const o = e.target.closest('[data-prov]');
    if (o) {
      state.provider = o.dataset.prov;
      if (o.dataset.model) state.model = o.dataset.model;
      store.set('ysmAskProvider', state.provider); store.set('ysmAskModel', state.model);
      pick.hidden = true; $('.ask-model').setAttribute('aria-expanded', 'false');
      paint();
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) ask(CHIP_Q[Number(chip.dataset.chip)]);
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const ti = Number(act.dataset.t); const ci = Number(act.dataset.c);
    const card = state.turns[ti]?.cards?.[ci];
    if (act.dataset.act === 'use-local-banner') { state.provider = 'local'; store.set('ysmAskProvider', 'local'); paint(); return; }
    if (act.dataset.act === 'open-file') { openExport(card?.id, { chrome }); return; }
    if (act.dataset.act === 'confirm' && card && !card.result) {
      try {
        const m = (await getMeetings()).find((x) => x.id === card.meetingId);
        await saveMeeting(applyProposal(m, card));
        card.result = 'done';
        onSaved();
      } catch (err) { card.result = 'failed'; card.error = String(err?.message || err); }
      save(); paint();
    } else if (act.dataset.act === 'cancel' && card) { card.result = 'cancelled'; save(); paint(); }
    else if (act.dataset.act === 'consent-yes' && card) {
      state.consent = true; card.result = 'yes';
      await chrome?.storage?.local.set({ ysmAskCloudConsent: true });
      state.turns.splice(ti, 1); await answer(lastUserQ(ti - 1), 'cloud');
    } else if (act.dataset.act === 'consent-no' && card) { state.turns.splice(ti, 1); state.provider = 'local'; store.set('ysmAskProvider', 'local'); save(); paint(); }
    else if (act.dataset.act === 'use-register') { await answer(lastUserQ(ti), 'register'); }
    else if (act.dataset.act === 'use-local') { state.provider = 'local'; store.set('ysmAskProvider', 'local'); await answer(lastUserQ(ti), 'local'); }
  });
  $('.ask-comp').addEventListener('submit', (e) => { e.preventDefault(); ask(ta.value); });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; paintModel(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(ta.value); } });
  // Pada dokumen: setelah gambar ulang fokus bisa jatuh ke body, di luar dialog.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || ov.hidden) return;
    e.stopPropagation();
    if (!pick.hidden) pick.hidden = true; else close();
  }, true);

  let lastFocus = null;
  function open(q) {
    lastFocus = document.activeElement;
    ov.hidden = false;
    paint();
    ta.focus();
    if (q) ask(q);
  }
  function close() { ov.hidden = true; pick.hidden = true; lastFocus?.focus?.(); }
  chrome?.storage?.local.get('ysmAskCloudConsent').then((r) => { state.consent = !!r?.ysmAskCloudConsent; }).catch(() => {});
  return { open, close, get state() { return state; } };
}
