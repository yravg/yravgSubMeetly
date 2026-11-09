// A03b (Ask Tide: model and credits) and A10 (Plans). Sample data only; credits and prices are proposals from the PRD (TIDE-018..022).
import { ic, tile, MARK, NEW } from './kit.mjs';
import { shell, homeMain, topbar } from './boards.mjs';

export const PLAN_CSS = `
.tide .plk{margin-left:auto;font-size:12.5px;font-weight:700;color:var(--gi);padding:4px 10px;border-radius:999px}.tide .plk.on{background:var(--mint)}
.tide .mpill{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:999px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);color:var(--text);font-size:13.5px;font-weight:600;white-space:nowrap}
.tide .pk{position:absolute;left:18px;bottom:84px;width:440px;background:var(--surface);border-radius:var(--r);box-shadow:0 20px 50px -16px var(--shadow-dlg),inset 0 0 0 1px var(--line);padding:8px;display:flex;flex-direction:column;gap:2px;z-index:5}
.tide .pk .g{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 12px 2px}
.tide .pk .o{display:flex;gap:12px;padding:9px 12px;border-radius:12px;align-items:flex-start}.tide .pk .o.on{background:var(--mint)}.tide .pk .o b{display:block;font-size:14.5px}.tide .pk .o small{display:block;font-size:12.5px;color:var(--muted)}.tide .pk .o .r{margin-left:auto;font-size:12.5px;color:var(--muted);white-space:nowrap;padding-top:2px}
.tide .pk .o .rd{width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--line);flex:none;margin-top:2px}.tide .pk .o.on .rd{box-shadow:inset 0 0 0 5px var(--gi)}
.tide .plan{display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:var(--r-lg);background:var(--surface);box-shadow:var(--shadow),inset 0 0 0 1px var(--line)}
.tide .plan .pn{font-size:18px;font-weight:800}.tide .plan .pr{display:flex;align-items:baseline;gap:6px}.tide .plan .pr b{font:600 52px/1 var(--disp)}.tide .plan .pr span{font-size:14px;color:var(--muted)}
.tide .plan .tg{font-size:14.5px;color:var(--muted);min-height:42px}.tide .plan .lb{font-size:13px;font-weight:700;color:var(--muted)}
.tide .plan ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.tide .plan li{display:flex;gap:10px;font-size:14.5px;line-height:1.35}.tide .plan li .ic{color:var(--gi);margin-top:1px}
.tide .pack{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:var(--r);background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}.tide .pack b{font-size:20px;font-weight:800}.tide .pack .cr{font-size:14px;color:var(--muted)}.tide .pack .chip{width:fit-content}
`;

const credits = (n, cls = 'ok') => `<span class="chip sm ${cls}">${ic('bolt', 16)}Credits ${n}</span>`;
const opt = (t, d, on, r = '') => `<div class="o ${on ? 'on' : ''}"><span class="rd"></span><span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span>${r ? `<span class="r">${r}</span>` : ''}</div>`;
const picker = () => `<div class="pk"><div class="g">On this computer</div>${opt('Local', 'Default. Runs on this computer, 0 credits.', true)}${opt('Register only', 'No model. Answers from your register, 0 credits.', false)}<div class="g">Cloud · OpenRouter</div>${opt('Claude Sonnet 5', '', false, '~1–3 credits / answer')}${opt('Gemini 3.1 Flash Lite', '', false, '~1–3 credits / answer')}${opt('GPT-5.5', '', false, '~1–3 credits / answer')}</div>`;
const src = (t) => `<div class="mut" style="font-size:12px;margin-top:-6px">${t}</div>`;

export const askModel = (state) => {
  const q = '<div class="ub">What did I promise this week?</div>';
  const step = `<div class="step">${ic('eye', 16)}<span>Looked at 3 meetings, 2–9 Nov</span><span class="grow"></span>${ic('down', 16)}</div>`;
  const recapQ = '<div class="ub">Draft a two-line recap for Client HSE</div>';
  const model = { local: 'Local · Qwen 2.5', reg: 'Register only', consent: 'Cloud · Claude Sonnet 5', cloud: 'Cloud · Claude Sonnet 5', out: 'Cloud · Claude Sonnet 5' }[state];
  const cr = { local: credits(46), reg: credits(46), consent: credits(46), cloud: credits(8, 'warn'), out: credits(0, 'bad') }[state];
  let body = ''; let h = 560;
  if (state === 'local') { h = 700; body = `${q}${step}<div class="ans">You own <b>4 open actions</b> this week. <b>1 is overdue</b>.</div>${src('Local model · Qwen · 0 credits')}`; }
  else if (state === 'reg') body = `${q}${step}<div class="ans">You own <b>4 open actions</b> this week. <b>1 is overdue</b>.</div>${src('From your register · 0 credits')}<div class="callout"><span class="tl">${ic('info', 18)}</span><span>Register only answers from counts and lists. For wording help, switch to Local or Cloud.</span></div>`;
  else if (state === 'consent') body = `${recapQ}<div class="acard"><div class="h">${tile('lock')}Turn on cloud answers?</div><div class="mut" style="font-size:14px">Cloud answers send the question and the meeting text it needs to OpenRouter. Your audio never leaves.</div><div class="row"><span class="btn">Cancel</span><span class="btn dark">Turn on cloud</span></div></div>`;
  else if (state === 'cloud') body = `<div class="callout warn"><span class="tl amb">${ic('info', 18)}</span><span><b>8 credits left.</b> A cloud answer costs about 1–3. Top up, or switch to Local.</span></div>${recapQ}${step}<div class="ans">The evacuation drill moves to Friday 07:30 and all contractors attend. Lars sends the incident report to Client HSE on Wednesday.</div>${src('Cloud model · Claude Sonnet 5 · 2 credits')}`;
  else body = `${recapQ}<div class="callout warn"><span class="tl amb">${ic('bolt', 18)}</span><div><b>Out of credits.</b> Local answers still work.<div class="row"><span class="btn dark sm">Top up</span><span class="btn sm">Use Local</span></div></div></div>`;
  const send = state === 'out' || state === 'consent' ? 'send off' : 'send';
  const head = `<div class="dh">${ic('sparkle', 20)}Ask Tide<span class="grow"></span>${cr}<span class="btn sm">Top up</span><span class="ib">${ic('plus', 20)}</span><span class="ib">${ic('x', 20)}</span></div>`;
  const comp = `<div class="comp"><span>Ask about your meetings…</span><span class="grow"></span><span class="mpill">Model: ${model} ${ic('down', 14)}</span><span class="${send}">${ic('send', 20)}</span></div>`;
  const dlg = `<div class="scrim"></div><div class="dlg" style="height:${h}px">${head}<div class="db" style="flex:1">${body}</div>${state === 'local' ? picker() : ''}${comp}</div>`;
  return shell('today', homeMain(), { h: 960, over: dlg });
};

/* ---------- A10 Plans ---------- */
const li = (t) => `<li>${ic('check', 16)}<span>${t}</span></li>`;
const plan = (n, price, tg, btn, lb, items) => `<div class="plan"><span class="pn">${n}</span><div class="pr"><b>${price}</b><span>/month</span></div><div class="tg">${tg}</div>${btn}<span class="lb">${lb}</span><ul>${items.map(li).join('')}</ul></div>`;
const pack = (rp, cr, bonus, btn) => `<div class="pack"><b>Rp${rp}</b><span class="cr">${cr} credits</span>${bonus ? `<span class="chip sm ok">${bonus}</span>` : '<span class="chip sm" style="visibility:hidden">.</span>'}${btn}</div>`;

export const plans = (state) => {
  const soon = '<span class="btn off" style="width:100%;height:48px">Coming soon</span>';
  const free = state === 'out' ? '<span class="pillb sm" style="width:100%">Sign in</span>' : state === 'noserver' ? soon : '<span class="pillb sm" style="width:100%">Start free</span>';
  const cards = `<div class="rg3" style="align-items:stretch">${plan('Free', '$0.00', 'To start capturing', free, 'Included:', ['Live captions and translation on this computer', 'Minutes register and exports', 'Unlimited Ask Tide with the local model', '50 starter credits for cloud answers (14 days)', 'Island and add-ins'])}${plan('Pro', '$4.99', 'Let the cloud help when you want it', soon, 'Everything in Free, plus:', ['400 credits every month for cloud answers', 'Unlimited file transcription jobs', 'Shared register across your devices'])}${plan('Agent', '$9.99', 'Just ask, and Tide does the follow-up', soon, 'Everything in Pro, plus:', ['1,000 credits a month', 'Weekly recap emails and series reports', 'Action follow-ups with due dates (Beta)'])}</div>`;
  const pbtn = state === 'out' ? '<span class="btn sm off">Sign in to top up</span>' : '<span class="btn sm">Top up</span>';
  const top = `<div class="cd"><div style="display:flex;align-items:center;gap:10px"><h3>Top up credits</h3><span class="grow"></span><span class="mut" style="font-size:14px">1 credit = Rp100. Cloud answers cost what the model costs plus a margin; local answers are free.</span></div><div class="rg4">${pack('25.000', '250', '', pbtn)}${pack('50.000', '525', '+5%', pbtn)}${pack('100.000', '1.100', '+10%', pbtn)}${pack('250.000', '2.750', '+10%', pbtn)}</div></div>`;
  const nos = '<div class="callout warn"><span class="tl amb">' + ic('info', 18) + '</span><span><b>No account server yet.</b> Credits and plans need one. Local and Register-only answers keep working.</span></div>';
  const extra = '';
  const main = `${topbar('Plans', extra)}<div class="mut" style="font-size:16px;margin-top:-6px">Free covers everything on this computer. Pay only when you want cloud answers.</div>${state === 'noserver' ? nos : ''}${NEW(cards)}${state === 'noserver' ? '' : top}`;
  return shell('plans', main, { h: 1000 });
};
