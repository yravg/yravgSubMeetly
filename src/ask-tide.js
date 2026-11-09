/**
 * Dialog Ask Tide (TIDE-007, 018, 019, 020 tampilan; papan A03, A03b).
 *
 * mountAskTide({ lang, getMeetings, onSaved, storage }) → { open(question?), close() }
 *  - Penyedia: Local (helper Qwen, bawaan) · Register only · Cloud (OpenRouter lewat
 *    helper, harus diizinkan sekali lewat kartu persetujuan; `ysmAskCloudConsent`).
 *  - Jawaban Local/Cloud dialirkan dari helper POST /ask; bila helper mati atau belum
 *    punya rute itu, dialog mengatakannya dan menawarkan jawaban dari register.
 *  - Satu-satunya jalan menulis: kartu aksi → Confirm → applyProposal + saveMeeting.
 *  - Sesi (maks 20 giliran) di localStorage `ysmAskSession`; 6 terakhir dikirim ke model.
 *  - Kredit: belum ada server akun (TIDE-022), jadi chip menyatakan "No server yet";
 *    jawaban Local dan Register only gratis.
 */
import {
  PROVIDERS, CLOUD_MODELS, chatRequest, buildGrounding, registerAnswer, applyProposal,
} from './lib/ask-tide.js';
import { saveMeeting } from './lib/notes-store.js';

const STR = {
  en: {
    title: 'Ask Tide', newChat: 'New chat', close: 'Close', placeholder: 'Ask Tide about your meetings…', send: 'Send',
    model: 'Model', local: 'Local', localD: 'Default. Runs on this computer, 0 credits.', register: 'Register only', registerD: 'No model. Answers from your register, 0 credits.',
    cloud: 'Cloud · OpenRouter', credits: 'Credits', noServer: 'No server yet', topUp: 'Plans',
    consentTitle: 'Turn on cloud answers?', consentBody: (m) => `Your question and the register lines Tide needs are sent to OpenRouter (${m}). Audio never leaves this device. Cloud answers cost credits once the account server exists.`, cancel: 'Cancel', turnOn: 'Turn on cloud',
    srcRegister: 'From your register · 0 credits', srcLocal: 'Local model · Qwen 2.5 · 0 credits', srcCloud: (m) => `Cloud model · ${m} · text was sent to OpenRouter`,
    looked: 'Steps', thinking: 'Tide is thinking…',
    errOffline: 'The Native Helper is not running, so the local model cannot answer.', errNoAsk: 'This helper has no Ask route yet. Update the helper to use the local model.',
    errCloud: 'Cloud is not connected: the helper has no OpenRouter key.', errHttp: (s) => `The helper answered with an error (${s}).`, errModel: (m) => `The model stopped: ${m}`,
    useRegister: 'Answer from the register', useLocal: 'Use Local',
    confirm: 'Confirm', done: 'Done. The register is updated.', cancelled: 'Cancelled. Nothing changed.', failed: (m) => `Could not save: ${m}`,
    empty: 'Ask about decisions, promises and open actions. Answers come from your register on this device.',
    chips: ['Recap last meeting', 'What did I promise?', 'Open actions', 'Translate a file'],
  },
  id: {
    title: 'Tanya Tide', newChat: 'Obrolan baru', close: 'Tutup', placeholder: 'Tanyakan rapat Anda ke Tide…', send: 'Kirim',
    model: 'Model', local: 'Lokal', localD: 'Bawaan. Berjalan di komputer ini, 0 kredit.', register: 'Hanya register', registerD: 'Tanpa model. Menjawab dari register, 0 kredit.',
    cloud: 'Awan · OpenRouter', credits: 'Kredit', noServer: 'Belum ada server', topUp: 'Paket',
    consentTitle: 'Nyalakan jawaban awan?', consentBody: (m) => `Pertanyaan dan baris register yang diperlukan dikirim ke OpenRouter (${m}). Audio tidak pernah keluar dari perangkat ini. Jawaban awan memakai kredit setelah server akun tersedia.`, cancel: 'Batal', turnOn: 'Nyalakan awan',
    srcRegister: 'Dari register Anda · 0 kredit', srcLocal: 'Model lokal · Qwen 2.5 · 0 kredit', srcCloud: (m) => `Model awan · ${m} · teks dikirim ke OpenRouter`,
    looked: 'Langkah', thinking: 'Tide sedang berpikir…',
    errOffline: 'Native Helper tidak berjalan, jadi model lokal tidak bisa menjawab.', errNoAsk: 'Helper ini belum punya rute Ask. Perbarui helper untuk memakai model lokal.',
    errCloud: 'Awan belum tersambung: helper tidak punya kunci OpenRouter.', errHttp: (s) => `Helper menjawab dengan galat (${s}).`, errModel: (m) => `Model berhenti: ${m}`,
    useRegister: 'Jawab dari register', useLocal: 'Pakai Lokal',
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

export function mountAskTide({ lang = 'en', showCredits = false, getMeetings, onSaved = () => {}, chrome = globalThis.chrome, fetch: f = globalThis.fetch } = {}) {
  const T = (k, ...a) => { const v = STR[lang]?.[k] ?? STR.en[k]; return typeof v === 'function' ? v(...a) : v; };
  const ov = document.createElement('div');
  ov.className = 'ask-ov';
  ov.hidden = true;
  ov.innerHTML = `<div class="ask" role="dialog" aria-modal="true" aria-labelledby="ask-title">
    <header class="ask-h"><img src="tide/01-tide-mark-green.svg" alt="" width="26" height="26" /><h2 id="ask-title">${esc(T('title'))}</h2>
      <span class="grow"></span>
      ${showCredits ? `<a class="chip sm credits" href="#plans" data-ask="plans" title="${esc(T('topUp'))}">${esc(T('credits'))} · ${esc(T('noServer'))}</a>` : ''}
      <button type="button" class="btn sm" data-ask="new">${esc(T('newChat'))}</button>
      <button type="button" class="icon-b" data-ask="close" aria-label="${esc(T('close'))}">✕</button></header>
    <div class="ask-body" aria-live="polite"></div>
    <form class="ask-comp">
      <div class="ask-pick-wrap"><button type="button" class="chip sm ask-model" data-ask="pick" aria-haspopup="listbox" aria-expanded="false"></button>
        <div class="ask-pick" role="listbox" hidden></div></div>
      <textarea rows="1" placeholder="${esc(T('placeholder'))}" aria-label="${esc(T('placeholder'))}"></textarea>
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

  function paintModel() {
    $('.ask-model').textContent = modelLabel();
    send.classList.toggle('off', !ta.value.trim() || state.busy);
    send.disabled = !ta.value.trim() || state.busy;
  }

  function cardHtml(c, ti, ci) {
    if (c.kind === 'list') return `<div class="ask-card list">${c.rows.map((r) => `<div class="lrow"><span class="ref">${esc(r.ref)}</span><span class="tx">${esc(r.text)}<small>${esc([r.owner, r.due, r.status].filter(Boolean).join(' · '))}</small></span></div>`).join('')}</div>`;
    if (c.kind === 'bars') { const max = Math.max(1, ...c.rows.map((r) => r.n)); return `<div class="ask-card bars">${c.rows.map((r) => `<div class="br"><span>${esc(r.type)}</span><i style="width:${Math.round((r.n / max) * 100)}%"></i><b>${r.n}</b></div>`).join('')}</div>`; }
    if (c.kind === 'link') return `<div class="ask-card link"><a class="btn" href="${esc(c.href)}" data-ask="link">${esc(c.label)} →</a></div>`;
    if (c.kind === 'action') {
      const st = c.result ? `<p class="${c.result === 'done' ? 'ok' : c.result === 'cancelled' ? 'mut' : 'bad'}">${esc(c.result === 'done' ? T('done') : c.result === 'cancelled' ? T('cancelled') : T('failed', c.error))}</p>` : `<div class="row"><button type="button" class="btn" data-act="cancel" data-t="${ti}" data-c="${ci}">${esc(T('cancel'))}</button><button type="button" class="pill-b sm" data-act="confirm" data-t="${ti}" data-c="${ci}">${esc(T('confirm'))}</button></div>`;
      return `<div class="ask-card action"><b>${esc(c.label)}</b>${st}</div>`;
    }
    if (c.kind === 'consent') {
      return c.result ? '' : `<div class="ask-card consent"><b>${esc(T('consentTitle'))}</b><p>${esc(T('consentBody', CLOUD_MODELS.find((m) => m.id === state.model)?.label))}</p><div class="row"><button type="button" class="btn" data-act="consent-no" data-t="${ti}" data-c="${ci}">${esc(T('cancel'))}</button><button type="button" class="pill-b sm" data-act="consent-yes" data-t="${ti}" data-c="${ci}">${esc(T('turnOn'))}</button></div></div>`;
    }
    if (c.kind === 'fallback') return `<div class="ask-card link"><button type="button" class="btn" data-act="${c.to}" data-t="${ti}">${esc(c.to === 'use-register' ? T('useRegister') : T('useLocal'))}</button></div>`;
    return '';
  }

  function paint() {
    if (!state.turns.length) {
      body.innerHTML = `<div class="ask-empty"><p>${esc(T('empty'))}</p><div class="chips">${T('chips').map((c, i) => `<button type="button" class="chip" data-chip="${i}">${esc(c)}</button>`).join('')}</div></div>`;
    } else {
      body.innerHTML = state.turns.map((t, ti) => (t.role === 'user'
        ? `<div class="u-bub">${esc(t.content)}</div>`
        : `<div class="a-turn">${t.steps?.length ? `<details class="steps"><summary>${esc(T('looked'))}: ${esc(t.steps[0])}</summary>${t.steps.slice(1).map((s) => `<div>${esc(s)}</div>`).join('')}</details>` : ''}
            ${t.typing ? `<div class="typing"><img src="tide/tide-compass.webp" alt="" /><span>${esc(T('thinking'))}</span></div>` : ''}
            ${t.error ? `<div class="callout danger" role="alert"><p>${esc(t.error)}</p></div>` : ''}
            ${t.content ? `<div class="a-txt">${md(t.content)}</div>` : ''}
            ${(t.cards || []).map((c, ci) => cardHtml(c, ti, ci)).join('')}
            ${t.source && !t.typing ? `<div class="src">${esc(t.source)}</div>` : ''}</div>`)).join('');
    }
    body.scrollTop = body.scrollHeight;
    paintModel();
  }

  const lastUserQ = (ti) => { for (let i = ti; i >= 0; i--) if (state.turns[i].role === 'user') return state.turns[i].content; return ''; };

  async function answer(q, provider = state.provider) {
    const meetings = await getMeetings();
    if (provider === 'register') {
      const r = registerAnswer(q, meetings, { now: new Date(), me: store.get('ysmMinutesMe', null) || localStorage.getItem('ysmMinutesMe') });
      state.turns.push({ role: 'assistant', content: r.text, steps: r.steps, cards: r.cards, source: T('srcRegister') });
      save(); paint();
      return;
    }
    if (provider === 'cloud' && !state.consent) {
      state.turns.push({ role: 'assistant', content: '', cards: [{ kind: 'consent' }], source: '' });
      save(); paint();
      return;
    }
    const turn = { role: 'assistant', content: '', typing: true, steps: [`Looked at ${meetings[0]?.title || 'the register'}`], source: provider === 'cloud' ? T('srcCloud', CLOUD_MODELS.find((m) => m.id === state.model)?.label) : T('srcLocal') };
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
    ta.value = '';
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
        const opt = (prov, id, name, desc) => `<button type="button" role="option" aria-selected="${state.provider === prov && (prov !== 'cloud' || state.model === id)}" data-prov="${prov}" data-model="${id || ''}"><b>${esc(name)}</b><small>${esc(desc)}</small></button>`;
        pick.innerHTML = opt('local', '', T('local'), T('localD')) + opt('register', '', T('register'), T('registerD')) + `<div class="sep">${esc(T('cloud'))}</div>` + CLOUD_MODELS.map((m) => opt('cloud', m.id, m.label, m.hint)).join('');
      }
    }
    const o = e.target.closest('[data-prov]');
    if (o) {
      state.provider = o.dataset.prov;
      if (o.dataset.model) state.model = o.dataset.model;
      store.set('ysmAskProvider', state.provider); store.set('ysmAskModel', state.model);
      pick.hidden = true; $('.ask-model').setAttribute('aria-expanded', 'false');
      paintModel();
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) ask(CHIP_Q[Number(chip.dataset.chip)]);
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const ti = Number(act.dataset.t); const ci = Number(act.dataset.c);
    const card = state.turns[ti]?.cards?.[ci];
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
  ta.addEventListener('input', paintModel);
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
