// Boards P08-P12 (owner request 2, PMM-019 to PMM-027). Same sample data: fictional "Weekly site coordination" Teams meeting,
// Alya / Budi / Chen, one in-room standup, one sample video. Reuses the pill pieces exported by boards.mjs.
import { ic, esc, NEW, PART, dp } from './kit.mjs';
import { header, pill, AA, GUIDE, notesCol, liveHead, todayLive, note, grp, grpR, kk, before, st } from './boards.mjs';

export const PRD2 = {
  'PMM-019': ['P0', 'Live = the room around the laptop', 'missing'],
  'PMM-020': ['P0', 'Live works like Meeting, offline', 'missing'],
  'PMM-021': ['P1', 'Hybrid meeting', 'missing'],
  'PMM-022': ['P1', 'Captions tab (all caption settings on the pill)', 'missing'],
  'PMM-023': ['P0', 'Minutes compiles every tab\'s records', 'missing'],
  'PMM-024': ['P0', 'Minutes register page shows real records', 'missing'],
  'PMM-025': ['P0', 'Faster live captions', 'missing'],
  'PMM-026': ['P1', 'Caption engine options', 'missing'],
  'PMM-027': ['P1', 'Engine study and benchmark', 'missing'],
};

/* ---------- shared bits ---------- */
const sgm = (items, on) => `<span class="sgm">${items.map((x) => `<span${x === on ? ' class="on"' : ''}>${x}</span>`).join('')}</span>`;
const meter = '<span class="mtr"><i style="height:4px"></i><i style="height:9px"></i><i style="height:6px"></i><i style="height:12px"></i><i style="height:5px"></i></span>';
const mic = (bad) => `<span class="mic${bad ? ' bad' : ''}">${ic('Mic', 13)}${bad ? 'No access' : `Microphone array${meter}`}</span>`;
const tgl = (on = true) => `<span class="tgl${on ? ' on' : ''}"></span>`;
const stp2 = (v) => `<span class="stp2"><i>${ic('Minus', 11)}</i>${v}<i>${ic('Plus', 11)}</i></span>`;
const rad = (on) => `<span class="rad${on ? ' on' : ''}"></span>`;
const crow = (t, s, ctl) => `<div class="cr"><div class="tx"><b>${t}</b>${s ? `<small>${s}</small>` : ''}</div>${ctl}</div>`;

/* ================= P08 Live = the room ================= */
const srow = (on, bad) => NEW(`<div class="srow"><span class="cap" style="color:var(--dim)">Source</span>${sgm(['Room', 'This PC', 'Both'], on)}${mic(bad)}</div>`, 'display:block', 'sr');
const roomHead = ({ title = 'In-room standup', src = 'Room', time = '09:12', un = false, rec = true, mark = false } = {}) => (mark ? PART : (h) => h)(`<div class="mh"><span class="t">${title}</span><span class="ed">${ic('Edit', 11)}</span><span class="src">${src}</span>${rec ? `<span class="tm"><span class="dot r"></span>${time}</span>` : ''}<span class="r">${AA(false)}<span class="btn">Hold</span>${un ? '<span class="btn util">Unfollow</span>' : ''}<span class="btn">Stop captions</span></span></div>`, 'display:block', 'phd');
const ln = (e, z, tag = '') => `<div class="p">${tag}${e}</div><div class="pt">${z}</div>`;
const tgR = '<span class="tg r">Room</span>';
const tgO = '<span class="tg o">Online</span>';
const ROOM_L = ln('Morning. Quick standup, three items.', '早上好。简短站会，三件事。') + ln('Budi, how is the rebar drawing?', '布迪，钢筋图进展如何？') + ln('Done by Wednesday, I will send it.', '周三完成，我会发出。') + '<div class="c">Alya takes the site photos before noon.</div><div class="tr">阿莉亚中午前拍现场照片。</div>';
const HYB_L = ln('Can everyone online hear me?', '在线的各位能听到我吗？', tgR) + ln('Yes, loud and clear from here.', '听得很清楚。', tgO) + ln('The tower crane is booked until noon.', '塔吊中午前已被占用。', tgR) + `<div class="c">${tgO}So move the crane slot to Thursday morning.</div><div class="tr">所以把吊车时段改到周四上午。</div>`;
const ROOM_N = { sum: 'Standup covers the rebar drawing, the permit check and the site photos.', dec: 'Rebar drawing goes out on Wednesday', keep: 'Standup stays at ten minutes', act: [['Send the rebar drawing', 'Budi · Wed'], ['Take the site photos', 'Alya · Noon']], q: 'Does the permit check move the lift date?' };
const cols = (cl, nt) => `<div class="cols" style="height:296px"><div class="cl">${cl}</div>${nt}</div>`;
const roomPill = (state) => {
  let inner;
  if (state === 'room') inner = `${roomHead({ mark: true })}${srow('Room')}${cols(ROOM_L, notesCol({ mode: 'ok', selected: false, txt: ROOM_N }))}`;
  else if (state === 'hybrid') inner = `${roomHead({ title: 'Site coordination', src: 'Both', time: '12:41', un: true })}${srow('Both')}${cols(HYB_L, notesCol({ mode: 'ok', selected: false }))}`;
  else if (state === 'blocked') inner = `${roomHead({ rec: false })}${srow('Room', true)}<div style="height:296px"><div class="emp">${ic('Lock', 28)}<b>Windows is blocking the microphone</b><span>Allow desktop apps to use the microphone, then try again. Nothing was recorded.</span><span class="lk2">Windows Settings &rsaquo; Privacy &amp; security &rsaquo; Microphone</span><div class="r"><span class="btn pri">Open Windows privacy settings</span><span class="btn">Use This PC instead</span></div></div></div>`;
  else inner = `<div class="sv" style="height:366px"><span class="ok">${ic('Check', 22)}</span><b>Saved &middot; In-room standup, 12 min</b><span class="m">1 summary, 1 decision, 2 actions, 1 question. Type: In-room. 2 items kept, 1 note typed by you.</span><div class="r"><span class="btn pri">Open in Minutes</span><span class="btn">Dismiss</span></div></div>`;
  return pill(header({ active: 'live', meeting: 'hidden', skip: ['shelf'] }), `<div class="mt3">${inner}</div>`);
};

const P08 = () => {
  const mk = (s) => grpR({ room: 'In the room: microphone, captions left, notes so far right', hybrid: 'Room + online: lines tagged Room / Online', blocked: 'Microphone blocked by Windows', saved: 'Stop: saved as an In-room record' }[s], roomPill(s), {
    room: [
      ['<b>Live opens on Room</b> (default for Live). The laptop mic hears people around it; captions and the translation line follow, offline.'],
      ['<b>Same layout as Meeting (P03):</b> rolling lines left, Notes so far right (AI draft, Keep / Edit / Remove, + Note), elapsed time, title.'],
      ['<b>Press the title</b> to rename it. It starts as "In-room meeting"; a calendar meeting without a join link names it.'],
      ['<b>Exists:</b> the Live header with Hold, Unfollow and Stop captions, and the caption lines. <b>Missing:</b> title, timer, source row, notes column.', true],
    ],
    hybrid: [
      ['<b>Both</b> mixes the mic and what this PC plays into one stream for the engine (PMM-021).'],
      ['<b>Each line is tagged</b> Room or Online by which side had more energy in that window, so the minutes can tell them apart.'],
      ['<b>Unfollow</b> shows when the source includes This PC (a followed app); in Room alone there is nothing to unfollow.'],
    ],
    blocked: [
      ['<b>Windows says no</b> the source row shows "No access"; the page explains it and links to Windows privacy settings. Nothing is recorded.'],
      ['<b>Use This PC instead</b> switches the source and starts captions of what the PC plays.'],
    ],
    saved: [
      ['<b>Stop</b> saves an "In-room" record like P04: summary, kept items, typed notes and the last draft; it opens in Minutes (P10).'],
      ['<b>Hold / Release</b> still pauses new text without ending the record.'],
    ],
  }[s]);
  const states = [['room', 'In the room'], ['hybrid', 'Room + online'], ['blocked', 'Mic blocked'], ['saved', 'Stop: saved']];
  return {
    id: 'P08', slug: 'live-room', title: 'Live is the room: mic, captions and notes', tier: 'PILL', ext: 'the Live tab (Hold, Unfollow, states, captions of this PC) and the Meeting tab layout (P03)',
    lives: 'island/crates/poni/src/pages/live.rs, new mic capture in island/crates/poni/src/services/capture.rs, engine POST /notes/generate',
    states, after: states.map(([k]) => dp(`st:${k}`, mk(k))).join('') + kk(['Following / Held / Issued dot + title', 'Hold / Release', 'Unfollow', 'Start / Stop captions', 'N wait on you', 'Listening to this PC', 'Nothing to follow', 'Unfollowed', 'Speech model needed', 'Captions need attention', 'Offline message + Try again', 'Translation hints + Download', 'Previous line, current line, translation line', 'n / total counter', 'Captions saved when you stop', 'Aa quick strip (P05)']),
    before: before('', 'Not capturable (the island window is excluded from screen capture); drawn from today\'s code: Live only captions what this PC plays; no microphone, no notes, no title.', todayLive()),
    must: ['A source picker on Live: Room (mic), This PC, Both; default Room; a microphone chip with level and a "No access" state.', 'Same layout as Meeting: captions with translation left, Notes so far right, + Note, timer and editable title.', 'Both tags each line Room or Online.', 'Mic blocked: plain words and a link to Windows privacy settings; nothing is recorded.', 'Stop saves an In-room record; every Live control and state of today stays.'],
    motion: [['Source switch', 'row cross-fades 150 ms; capture restarts without closing the page'], ['Mic level', 'five bars follow the input, 100 ms; steady when reduced motion is on'], ['New line', 'slides up 120 ms, tag included']],
    stories: [st('PMM-019', 'Room', 'new', 'Live transcribes and translates what the laptop microphone hears. Source picker: Room, This PC, Both (default Room). Mic from Windows input devices; in use / blocked states with the privacy link.'), st('PMM-020', 'Live', 'partial', 'Live has the Meeting layout, offline: captions with translation, Notes so far, + Note, elapsed time, editable title; Stop saves an In-room record. Hold, Unfollow and today\'s states stay.', 'Exists: Live captions, Hold, Unfollow, Stop captions, every state, save on stop. Missing: title, timer, source row, notes column, In-room type.'), st('PMM-021', 'Both', 'new', 'Both mixes mic and loopback into one stream; lines are tagged Room / Online from which side had more energy in the window.'), st('PMM-010', 'Live', 'built', 'Superseded by PMM-019 / 020: Live keeps every current state and control (listed under the boards) and gains the room source and the notes column.')],
    where: ['<code>pages/live.rs</code>: header, source row, notes column (shared with <code>meeting_live.rs</code>)', '<code>services/capture.rs</code>: mic stream next to the loopback, mixer for Both', '<code>poni_core::capture</code>: Room / Online energy tag per window', '<code>settings.rs</code>: <code>live_source</code>, <code>mic_device</code>', '<code>app.rs end_session</code>: type "In-room"'],
  };
};

/* ================= P09 Captions tab ================= */
const SUBS = ['Sources', 'Speed', 'Translation', 'Display', 'Apps'];
const subTabs = (on) => `<div class="sub">${SUBS.map((x) => `<span${x === on ? ' class="on"' : ''}>${x}</span>`).join('')}<span class="ab">Aa strip = the quick subset</span></div>`;
const CAP_ROWS = {
  Sources: () => crow('Live', 'What Live listens to', sgm(['Room', 'This PC', 'Both'], 'Room')) + crow('Meeting', 'The call audio; add the room when people sit around the laptop', sgm(['App audio', 'This PC', 'Room + app'], 'App audio')) + crow('Media', 'Media is always what this PC plays', sgm(['This PC'], 'This PC')) + crow('Microphone', 'Used by Room and Both', `<span style="display:flex;gap:8px;align-items:center">${mic(false).replace('margin-left:auto', '')}<span class="btn">Test</span></span>`) + crow('Spoken language', 'What the sound is in; Auto-detect works it out', stp2('Auto-detect')),
  Speed: () => crow('Fast (Windows captions)', 'Reads Windows Live Captions: first words in under a second. Windows 11 only.', rad(false)) + crow('Balanced', 'Our engine, short windows; interim text grows every second.', rad(true)) + crow('Accurate (Whisper)', 'Whole sentences, best spelling, about 3 s behind.', rad(false)) + crow('Interim text', 'Show words while people still speak; the final line replaces them', tgl(true)) + crow('Speech model', 'Whisper base on this PC', '<span class="btn util">Change in Models</span>'),
  Translation: () => crow('Translate captions', 'A second line under each caption', tgl(true)) + crow('Translate into', 'Captions and synced lyrics', stp2('Chinese')) + crow('Context: previous sentences', 'Sent with each line so names and terms stay right', sgm(['0', '1', '2'], '1')) + crow('Engine', 'Translation runs on this PC, offline', sgm(['On this PC', 'OpenAI-compatible'], 'On this PC')) + NEW(crow('OpenAI-compatible address<span class="bdg">not offline</span>', 'Opt-in. Caption text is sent to this address.', '<span class="fld2">https://&hellip; (off)</span>'), 'display:block', 'oa') + crow('Translate synced lyrics', 'A second row under the sung line', tgl(true)),
  Display: () => crow('Show', 'What the pill prints for each line', sgm(['Original', 'Translation', 'Both'], 'Both')) + crow('Font size', 'Caption text on the pill', stp2('15 px')) + crow('Sentences shown', 'Lines kept on screen', stp2('3')) + crow('Latency readout', 'Adds <b style="display:inline;font-weight:600">[ 820 ms ]</b> after each line', `<span style="display:flex;gap:8px;align-items:center"><span class="lat">[ 820 ms ]</span>${tgl(true)}</span>`),
  Apps: () => crow('Start captions by themselves', 'When a call, a video or a meeting plays sound', tgl(true)) + crow('Meeting apps', '5 built in, 2 added by you (same list as P07)', '<span class="btn">Edit list &rsaquo;</span>') + crow('Open the Meeting tab when a meeting starts', 'Otherwise captions start on Live', tgl(true)) + crow('Show the quick strip', 'Aa on Live, Meeting and Media; remembered', tgl(true)),
};
const capPage = (sub) => pill(header({ active: 'captions', captions: true, markCaptions: true, skip: ['shelf', 'tasks', 'focus', 'system', 'script', 'addons'] }), `<div class="mt3">${subTabs(sub)}<div>${CAP_ROWS[sub]()}</div></div>`);
const P09 = () => {
  const mk = (s) => grpR({ Sources: 'Sources: what each tab listens to', Speed: 'Speed: Fast, Balanced, Accurate', Translation: 'Translation: language, context, engine', Display: 'Display: what the pill prints', Apps: 'Apps: meeting apps and automatic start' }[s], capPage(s), {
    Sources: [['<b>One place for every source:</b> Live (Room / This PC / Both), Meeting (app audio, This PC, Room + app), Media (always This PC). The mic is picked once.'], ['<b>The Aa strip stays</b> as the quick subset: Captions, Auto, Translate, Spoken, Translate into. Each strip control writes the same key as its row here.'], ['<b>Tab is hidden by default</b> (switch in Settings › Tabs, below the boards); the row drops its last icons first when it runs long.']],
    Speed: [['<b>Fast (Windows captions)</b> reads the Windows 11 Live Captions window (study row B); it never closes the user\'s own window and turns loopback off in this mode.'], ['<b>Balanced and Accurate</b> use our Whisper engine; Balanced re-posts the growing sentence for interim text (P12).'], ['<b>Windows captions missing</b> on this Windows build: the Fast row is greyed with the reason; nothing else changes.']],
    Translation: [['<b>Context</b> sends the previous 0 to 2 sentence pairs with each line (study row D); 0.5B models may copy it, so it is off by default for them.'], ['<b>OpenAI-compatible</b> is opt-in and labelled "not offline": caption text leaves the PC for the address you enter. Default stays On this PC.']],
    Display: [['<b>Show</b> Original, Translation or Both; font size and sentences shown apply to Live, Meeting and the Media caption column at once.'], ['<b>Latency readout</b> prints the measured milliseconds after a line (study row E); off by default.']],
    Apps: [['<b>Meeting apps</b> opens the list with Add (P07); this page only summarises it so the list has one home.']],
  }[s]);
  const tabsRow = (n, on, newRow) => { const r = `<div class="rw"><div class="tx"><b>${n}</b><small>${newRow ? 'Every caption and translation setting in one place; off until you switch it on' : 'Show this tab in the island'}</small></div><span class="sw${on ? ' on' : ''}"></span></div>`; return newRow ? NEW(r, 'border-radius:10px', 'rw1') : r; };
  const tabs = `<div class="sw2" style="width:640px"><div class="ct" style="padding:16px 20px"><h4>Tabs shown on the island</h4><div class="gp">${tabsRow('Media', true)}${tabsRow('Meeting', true)}${tabsRow('Captions', false, true)}${tabsRow('Shelf', true)}</div></div></div>`;
  const states = SUBS.map((x) => [x, x]);
  const g = grp('Settings › Tabs (dark, as today): Captions is off by default', tabs, [['<b>Switch Captions on</b> and the sliders icon appears after Media; its label shows while the page is open.'], ['<b>Exists:</b> the Tabs section with its switches. <b>Missing:</b> the Captions row.', true]]);
  return {
    id: 'P09', slug: 'captions-tab', title: 'Captions tab: every caption setting on the pill', tier: 'PILL', ext: 'Advanced settings › Captions and languages (real capture as Before) and the Aa strip (P05)',
    lives: 'new island/crates/poni/src/pages/captions.rs, settings.rs, Settings › Tabs row',
    states, after: states.map(([k]) => dp(`st:${k}`, mk(k))).join('') + `<div style="margin-top:34px">${g}</div>`,
    before: { cap: 'Real capture of today (1.2.9): every caption setting lives in Advanced settings; the pill has none.', html: '<img class="ixi" src="shots/before-settings-captions.png" style="width:840px" alt="Before: Advanced settings, Captions and languages">' },
    must: ['An optional Captions tab (sliders icon), off until switched on in Settings › Tabs.', 'Five groups: Sources, Speed, Translation, Display, Apps; every setting of today\'s Captions and languages page is reachable.', 'Sources per tab (Live, Meeting, Media) and one microphone choice.', 'Speed: Fast (Windows captions), Balanced, Accurate (Whisper).', 'Translation: on, language, context 0 to 2, engine On this PC or OpenAI-compatible labelled "not offline".', 'Display: original / translation / both, font size, sentences shown, latency readout.'],
    motion: [['Sub tab', 'content cross-fades 120 ms; the page keeps its height'], ['Radio', 'dot fills 100 ms'], ['Switch', 'thumb slides 120 ms']],
    stories: [st('PMM-022', 'Tab', 'new', 'An optional Captions tab holds every caption and translation setting of Advanced settings plus the new ones; the Aa strip stays the quick subset.'), st('PMM-026', 'Engine', 'new', 'Latency mode (Fast / Balanced / Accurate), ASR source (our Whisper or Windows Live Captions), translation context, original / translation / both, font size on the pill.')],
    where: ['<code>pages/captions.rs</code> (new) and <code>pages/mod.rs</code>: <code>PageKind::Captions</code>, hideable', '<code>settings.rs</code>: <code>latency_mode</code>, <code>asr_source</code>, <code>translate_context</code>, <code>caption_display</code>, <code>caption_font</code>', '<code>engine translate.rs</code>: engine choice, context turns', '<code>services/livecaptions.rs</code> (new, study row B)'],
  };
};

/* ================= P10 Minutes compiles all records ================= */
const hrow = (cls, label, title, when, btn = 'Open') => `<div class="hr"><span class="ty ${cls}">${label}</span><span class="tx">${title}</span><span class="when">${when}</span><span class="btn">${btn}</span></div>`;
const chips = (on, counts) => NEW(`<div class="fl">${[['All', counts[0]], ['Meeting', counts[1]], ['Live', counts[2]], ['Media', counts[3]], ['Pasted', counts[4]]].map(([n, c]) => `<span${n === on ? ' class="on"' : ''}>${n} <b>${c}</b></span>`).join('')}</div>`, 'display:block', 'flw');
const minutesPill = (rows, on, counts) => pill(header({ active: 'minutes' }), `${GUIDE('Every saved record')}${chips(on, counts)}<div class="hist" style="height:${rows.length * 36}px">${rows.join('')}</div>`);
const histPill = (active, title, rows, over = {}) => pill(header({ active, meeting: active === 'meeting' ? 'idle' : 'hidden', skip: ['shelf'], ...over }), `<div class="mt3" style="height:${34 + rows.length * 36 + 30}px">${NEW(`<div class="hh"><span>History &middot; ${title}</span><span class="btn">Back to ${active === 'meeting' ? 'meeting' : active === 'media' ? 'media' : 'live'}</span></div>`, 'display:block', 'hhw')}<div class="hist">${rows.join('')}</div></div>`);
const P10 = () => {
  const all = [hrow('m', 'Meeting &middot; Teams', 'Weekly site coordination', 'Today &middot; 38 min'), hrow('l', 'Live &middot; Room', 'In-room standup', 'Today &middot; 12 min'), hrow('v', 'Media &middot; Video', 'macOS 27.2.1 is out', 'Yesterday &middot; 21 min', 'Save as meeting'), hrow('p', 'Pasted', 'Design review (Teams transcript)', 'Mon &middot; 45 min'), hrow('m', 'Meeting &middot; Zoom', 'Supplier call', 'Mon &middot; 30 min')];
  const a = grp('a. Minutes: all records, newest first', pill(header({ active: 'minutes' }), `${GUIDE('Every saved record')}${chips('All', [9, 4, 2, 2, 1])}${PART(`<div class="hist" style="height:${all.length * 36}px">${all.join('')}</div>`, 'display:block', 'hl')}`), [
    ['<b>Open Minutes</b> every saved record sits in one list with a source chip: Meeting &middot; Teams, Live &middot; Room, Media &middot; Video, Pasted.'],
    ['<b>Exists:</b> the Minutes tab with the meeting register and Paste transcript; History for transcripts (P04). <b>Missing:</b> records of Live and Media, source chips, the filter.', true],
  ]);
  const b = grp('b. Filter: Live only', minutesPill([hrow('l', 'Live &middot; Room', 'In-room standup', 'Today &middot; 12 min'), hrow('l', 'Live &middot; Both', 'Weekly site coordination (room)', 'Mon &middot; 41 min')], 'Live', [9, 4, 2, 2, 1]), [
    ['<b>Press a chip</b> the list narrows; counts show how many records each source holds. Press All to clear.'],
  ]);
  const c = grp('c. Meeting tab: its own History', histPill('meeting', 'Meeting', [hrow('m', 'Teams', 'Weekly site coordination', 'Today &middot; 38 min'), hrow('m', 'Zoom', 'Supplier call', 'Mon &middot; 30 min'), hrow('m', 'Link', 'meeting.tencent.com', 'Fri &middot; 22 min')]), [
    ['<b>History</b> in each tab\'s header shows only that tab\'s records; Back returns to the live page. Same store, filtered.'],
  ]);
  const d = grp('d. Live tab: its own History', histPill('live', 'Live', [hrow('l', 'Room', 'In-room standup', 'Today &middot; 12 min'), hrow('l', 'Both', 'Weekly site coordination (room)', 'Mon &middot; 41 min'), hrow('l', 'This PC', 'Safety briefing video', 'Fri &middot; 18 min')]), [
    ['<b>Open</b> goes to the record in Minutes (P11); Live never keeps a second copy.'],
  ]);
  const e = grp('e. Media tab: its own History', histPill('media', 'Media', [hrow('v', 'Video', 'macOS 27.2.1 is out', 'Yesterday &middot; 21 min', 'Save as meeting'), hrow('v', 'Video', 'Site safety talk', 'Fri &middot; 16 min', 'Save as meeting')], { media: 'Media' }), [
    ['<b>Save as meeting</b> turns a transcript into a register record (PMM-015, P04).'],
  ]);
  const fb = (t, s, w) => `<div class="fb" style="width:${w}px"><b>${t}</b><small>${s}</small></div>`;
  const f = `<div class="grp" style="grid-column:1/-1"><div class="gl">f. One store: every tab writes to the engine, every list reads from it</div><div class="flow">
<div class="flow col" style="width:250px">${fb('Meeting tab', 'Teams, Zoom, Meet, Webex, Slack, links', 250)}${fb('Live tab', 'Room, This PC, Both', 250)}${fb('Media tab', 'Video transcripts', 250)}${fb('Pasted transcript', 'Teams copy, Paste transcript', 250)}</div><span class="fa">&rarr;</span>
${NEW('<div class="fb" style="width:290px"><b>Engine notes store</b><small>~/.yraveragesubmin/notes.json, written by <code>POST /notes</code>; record id <code>MOM-WIN-*</code> with a source type</small></div>', 'display:flex;align-self:center', 'fw')}<span class="fa">&rarr;</span>
<div class="flow col" style="flex:1">${fb('Minutes tab: all records, filter by source', 'This page, frames a and b', 520)}${fb('History in Meeting, Live, Media', 'Frames c to e: same store, filtered by source', 520)}${fb('Minutes register page', 'minutes.html in the browser and in the app window (P11)', 520)}</div>
</div></div>`;
  const minutesToday = pill(header({ active: 'minutes' }), `${GUIDE('Meetings and transcripts')}<div class="hist" style="height:160px"><div class="hr"><span class="tx">Weekly site coordination</span><span class="when">1 decision &middot; 2 actions</span><span class="btn">Accept</span><span class="btn">Carry</span></div><div class="hr"><span class="tx">Design review</span><span class="when">2 decisions &middot; 1 action</span><span class="btn">Accept</span><span class="btn">Carry</span></div><div class="hr"><span class="tx">Meeting 1 / 14</span><span class="when">pager</span><span class="btn">Paste transcript</span></div></div>`);
  return {
    id: 'P10', slug: 'minutes-all-records', title: 'Minutes compiles every record; each tab has its History', tier: 'PILL', ext: 'the Minutes tab (register, pager, Paste transcript) and History for video transcripts (P04)',
    lives: 'island/crates/poni/src/pages/meeting.rs (Minutes), History in live.rs, meeting_live.rs, media.rs; engine /notes',
    states: null, after: `<div class="gr2">${a}${b}${c}${d}${e}${f}</div>`,
    before: before('', 'Not capturable (island window excluded from screen capture); drawn from today\'s code: Minutes lists register meetings only; transcripts of Live and Media have no list; no tab has a History.', minutesToday),
    must: ['Minutes lists every saved record from Meeting, Live, Media and pasted transcripts, newest first.', 'Each row carries a source chip: Meeting · Teams, Live · Room, Media · Video, Pasted; a filter row with counts.', 'Meeting, Live and Media each have a History list of their own records.', 'One store: the engine\'s notes.'],
    motion: [['Filter', 'rows cross-fade 120 ms; counts stay'], ['History', 'list slides in 150 ms; Back reverses it'], ['Save as meeting', 'row moves to the register with a 150 ms highlight']],
    stories: [st('PMM-023', 'Minutes', 'partial', 'Minutes lists every saved record from Meeting, Live (in-room), Media transcripts and pasted transcripts with a source chip and a filter; each tab shows its own History. One store: the engine\'s notes.', 'Exists: the Minutes tab with the register and Paste transcript. Missing: records of Live and Media, source chips, filter, per-tab History.')],
    where: ['<code>pages/meeting.rs</code>: list, chips, filter', '<code>live.rs</code>, <code>meeting_live.rs</code>, <code>media.rs</code>: History header button and list', '<code>engine</code>: <code>/notes</code> list with <code>source</code> type', '<code>app.rs end_session</code>: writes the type (Meeting, Live, Media, Pasted)'],
  };
};

/* ================= P11 Register shows real records ================= */
const MOMID = `MOM-WIN-${Date.UTC(2026, 10, 10, 14) / 1000}`;
const regRows = (items) => `<div class="tbl"><div class="th"><span>Ref</span><span>Type</span><span>Item</span><span>Owner</span><span>Due</span><span>Status</span></div>${items.map(([r, t, k, i, o, d, s]) => `<div class="tr3"><span class="rf">${r}</span><span class="tp ${k}">${t}</span><span>${i}</span><span>${o}</span><span>${d}</span><span class="st2">${s}</span></div>`).join('')}</div>`;
const regHead = (title, facts, smp) => `<div class="hd2"><h1>${title}${smp ? '<span class="smp">Sample</span>' : ''}</h1><div class="fc">${facts.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('')}</div></div>`;
const regBar = ({ sel, sync = '', sampleMenu = false }) => `<div class="ab"><span class="br">yravg<i>SubMeetly</i></span><span class="cm">Minutes</span><span class="gw"></span>${sync}<span class="od">On-device</span><span class="sel">${sel} &#9662;</span><span class="bt">Export</span><span class="bt p">Issue MoM</span></div>`;
const REAL_ITEMS = [['D1', 'Decision', 'd', 'Move the crane slot to Thursday 08:00', '&mdash;', '&mdash;', 'Agreed'], ['A1', 'Action', 'a', 'Confirm the lift permit with the yard', 'Chen', 'Fri', 'Open'], ['A2', 'Action', 'a', 'Send the revised plan', 'Alya', 'Wed', 'Open'], ['Q1', 'Question', 'q', 'Who covers the night watch on Friday?', '&mdash;', '&mdash;', 'Open']];
const SYNC = NEW('<span class="sy"><i></i>Synced with island &middot; just now</span>', 'display:inline-flex', 'sy1');
const regAfter = (kind) => {
  if (kind === 'empty') return `<div class="rgw" style="min-height:300px">${regBar({ sel: 'No meetings', sync: NEW('<span class="sy"><i></i>Synced with island &middot; nothing saved yet</span>', 'display:inline-flex', 'sy1') })}<div style="padding:70px 0;text-align:center"><h2 style="font-size:16px;font-weight:600;margin:0 0 8px">No meeting selected.</h2><p style="color:#b4b4b4;margin:0 0 16px;font-size:13px">Record a meeting on the island, or load demo meetings to explore the register.</p><span class="bt p" style="display:inline-flex">Load demo meetings (removable)</span></div></div>`;
  const dd = kind === 'menu' ? `<div class="dd" style="position:absolute;right:190px;top:40px;z-index:6;width:340px"><div class="gh">From the island</div><div class="oi on">Weekly site coordination<span class="sc">Meeting &middot; Teams</span></div><div class="oi">In-room standup<span class="sc">Live &middot; Room</span></div><div class="oi">Design review<span class="sc">Pasted</span></div><div class="gh">Demo</div><div class="oi">CPOC Phase 7 &mdash; W36<span class="sc s">Sample</span></div><div class="oi">CPOC Phase 7 &mdash; W35<span class="sc s">Sample</span></div>${NEW('<div class="rd">Remove demo meetings</div>', 'display:block', 'rdw')}</div>` : '';
  const sel = kind === 'main' ? PART('Weekly site coordination', 'display:inline-block', 'ms') : 'Weekly site coordination';
  return `<div class="rgw" style="min-height:${kind === 'menu' ? 360 : 300}px">${regBar({ sel, sync: SYNC })}${dd}${regHead('Weekly site coordination', [['Date', '2026-11-10'], ['Chair', 'Alya'], ['Present', '3'], ['MoM', MOMID], ['Source', 'Meeting &middot; Teams']], false)}${regRows(REAL_ITEMS)}</div>`;
};
const P11 = () => {
  const a = grpR('a. After: the meetings the island saved', regAfter('main'), [
    ['<b>Open minutes.html from the island</b> the register lists the island\'s meetings (MOM-WIN-*): Weekly site coordination, In-room standup, pasted transcripts.'],
    ['<b>"Synced with island · just now"</b> shows the last pull; it refreshes when the page regains focus and every 30 s while open.'],
    ['<b>Exists:</b> the register page, the meeting switch, items, export. <b>Missing:</b> meetings from the engine; the switch lists only this browser\'s storage.', true],
  ], 924);
  const b = grpR('b. After: meeting switch open, demo rows tagged Sample', regAfter('menu'), [
    ['<b>Engine wins for ids it holds;</b> a local-only meeting stays and is never overwritten by a missing engine copy.'],
    ['<b>Demo meetings</b> (CPOC W35 / W36) appear only after "Load demo meetings", carry a Sample tag, and "Remove demo meetings" deletes them.'],
    ['<b>Edits write back:</b> accepting, assigning or editing an item posts the document to <code>POST /notes</code> so the island sees it.'],
  ], 924);
  const c = grpR('c. After: nothing saved yet', regAfter('empty'), [
    ['<b>First run</b> the register is empty on purpose and says what is synced; Load demo meetings is the only way demo data appears.'],
  ], 924);
  const dI = [['D1', 'Decision', 'd', 'Crane inspection and securement are standing requirements', '&mdash;', '&mdash;', 'Agreed'], ['A1', 'Action', 'a', 'Close the outstanding MWS signature', '&mdash;', '&mdash;', 'Open'], ['Q1', 'Question', 'q', 'Vessel selection (C900) still open', '&mdash;', '&mdash;', 'Open']];
  const bef = `<div class="rgw" style="min-height:300px">${regBar({ sel: 'CPOC Phase 7 &mdash; W36' })}${regHead('CPOC Phase 7 &mdash; GZS Weekly Progress Meeting', [['Date', '2026-09-02'], ['Series', 'W35 &rarr; W36'], ['Source', 'Demo meetings from an earlier click']], false)}${regRows(dI)}</div>`;
  return {
    id: 'P11', slug: 'register-real-records', title: 'Register shows the real records', tier: 'REGISTER', ext: 'minutes.html (island Minutes › Open register, and the app window\'s Minutes page); dark window as today',
    lives: 'src/lib/engine-sync.js (startEngineSync), src/lib/notes-sync.js (docToMeeting), src/lib/notes-store.js, src/minutes.js',
    states: null, after: `${a}<div style="height:34px"></div>${b}<div style="height:34px"></div>${c}`,
    before: before('', 'Not capturable as a live window; drawn from the code and fixture (src/lib/notes-fixture.js): the register reads only its own origin\'s browser storage, which still holds the two CPOC demo meetings from an earlier "Load demo meetings" click on http://127.0.0.1:17865/app/minutes.html.', `<div style="display:flex;justify-content:center">${bef}</div>`),
    must: ['The register lists meetings the island saved (MOM-WIN-*), newest first, with their source.', 'A "Synced with island · just now" indicator; it refreshes on focus and every 30 s.', 'Demo meetings appear only after "Load demo meetings", tagged Sample, with "Remove demo meetings".', 'Engine wins for ids it holds; edits write back to the engine.', 'Empty register says what is synced and offers the demo load.'],
    motion: [['Sync', 'indicator dot pulses once, 300 ms, on each pull; steady with reduced motion'], ['New meeting', 'row slides into the switch list 150 ms'], ['Remove demo', 'Sample rows fade 150 ms']],
    stories: [st('PMM-024', 'Register', 'partial', 'The register main page shows the meetings the island saved, not demo minutes. Demo appears only after "Load demo meetings", labelled Sample, and can be removed. Register edits write back to the engine.', 'Exists: the register page and meeting switch reading browser storage only (key minutesRegister). Missing: engine pull-and-merge, docToMeeting, Sample tag, Remove demo, indicator, write back.')],
    where: ['<code>src/lib/engine-sync.js</code>: <code>startEngineSync</code> pull-and-merge (today it only primes ids)', '<code>src/lib/notes-sync.js</code>: add <code>docToMeeting</code> next to <code>meetingToDoc</code>', '<code>src/lib/notes-store.js</code>: <code>storage</code> event / poll refresh, Sample flag', '<code>src/lib/notes-fixture.js</code>: <code>isDemoMeeting</code>', 'round-trip test against the island\'s <code>meeting_doc</code> shape'],
  };
};

/* ================= P12 Faster captions ================= */
const X = 170;
const L = (t) => Math.round(t * X);
const gridl = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => `<i class="gridl" style="left:${L(t)}px"></i>`).join('');
const blk = (cls, a, b, txt) => `<span class="b2 ${cls}" style="left:${L(a)}px;width:${L(b - a)}px">${txt}</span>`;
const lane = (label, inner) => `<div class="ln"><span class="lb">${label}</span><div class="tk">${gridl}${inner}</div></div>`;
const axis = `<div class="ax"><span class="lb"></span><div class="tk">${[0, 1, 2, 3, 4, 5, 6, 7].map((t) => `<span class="t" style="left:${L(t)}px">${t} s</span>`).join('')}</div></div>`;
const timeline = `<div class="tlw"><h4>Today (1.2.9): a fixed 4 s window, then Whisper, then translation</h4>${axis}
${lane('SPEECH', blk('sp', 0, 3.4, 'One sentence, 3.4 s'))}
${lane('WINDOW', blk('wn', 0, 4, 'Window fills: nothing is sent until it closes'))}
${lane('ENGINE', blk('as', 4, 4.9, 'Whisper') + blk('tr', 4.9, 5.6, 'Translate'))}
${lane('ON THE PILL', blk('fn', 4.9, 5.6, 'text') + blk('tr', 5.6, 6.2, '+ line'))}
${lane('FIRST TEXT', `<span class="fg" style="left:${L(4.9)}px"></span><span class="fgl" style="left:${L(4.9) + 8}px">first text 4.9 s</span>`)}
<div class="sep2"></div>
<h4>After A + C: the growing sentence is re-posted every second; translation per sentence</h4>
${lane('SPEECH', blk('sp', 0, 3.4, 'One sentence, 3.4 s'))}
${lane('ENGINE', blk('as', 1, 1.3, 'ASR') + blk('as', 2, 2.35, 'ASR') + blk('as', 3, 3.4, 'ASR') + blk('as', 3.5, 3.85, 'final') + blk('tr', 3.85, 4.4, 'Translate'))}
${lane('ON THE PILL', blk('in', 1.3, 2.4, 'interim grows') + blk('in', 2.4, 3.5, 'interim grows') + blk('fn', 3.5, 4.4, 'final line') + blk('tr', 4.4, 4.9, '+ line'))}
${lane('FIRST TEXT', `<span class="fgl" style="left:${L(1.3) - 112}px;width:104px;text-align:right">first text 1.3 s</span><span class="fg" style="left:${L(1.3)}px"></span><span class="tgt" style="left:${L(1.5)}px"></span><span class="tgtl" style="left:${L(1.5) + 8}px">target 1.5 s</span>`)}
</div>`;
const liveFrame = (lines, mark = false) => pill(header({ active: 'live', meeting: 'hidden', skip: ['shelf'] }), `${GUIDE('Captions of what this PC plays')}<div class="lv">${liveHead('', 'Weekly site coordination')}${mark ? PART(`<div class="lines">${lines}</div>`, 'display:block;margin-top:2px', 'ln2') : `<div class="lines">${lines}</div>`}<div class="ft"><span>Captions are saved as a meeting when you stop.</span><span>24 / 24</span></div></div>`);
const prevL = '<div class="pp">&hellip;the permit is still pending.</div><div class="pt2">五层的许可证还在审批中。</div>';
const intr = (t) => NEW(`<div class="i">${t}<span class="crt"></span></div>`, 'display:block', 'iw');
const P12 = () => {
  const a = grp('a. Today: one line after about 5 s', liveFrame(`<div class="pp">&hellip;the permit is still pending.</div><div class="c">So move the crane slot to Thursday morning.</div><div class="tr">所以把吊车时段改到周四上午。</div>`), [['<b>Today (1.2.9)</b> windows are 4 s with no overlap, one /draft in flight, newest wins: first words at about 4.9 s, translation about 5.6 s; sentences are cut at window edges.']]);
  const b = grp('b. t = 1.3 s: first words, lighter, with a caret', liveFrame(prevL + intr('So move the crane')), [['<b>Row A: utterance buffer.</b> The growing utterance is re-posted every 1 to 1.5 s as an interim line; it is lighter and has a caret so nobody reads it as final.'], ['<b>Row B</b> (Fast, Windows captions) shows the same interim look from the Windows 11 caption text; chosen on P09.']]);
  const c = grp('c. t = 2.4 s: the line grows', liveFrame(prevL + intr('So move the crane slot to Thursday')), [['<b>Row C: sentence-end translation.</b> The interim line gets no translation (or the fast prompt); the sentence is translated at its end or after 1.25 s idle, and a newer sentence cancels an older request.']]);
  const d = grp('d. t = 3.8 s: final line, translation, latency readout', liveFrame(`${prevL}<div class="c">So move the crane slot to Thursday morning.<span class="lat">[ 820 ms ]</span></div><div class="tr">所以把吊车时段改到周四上午。</div>`, true), [
    ['<b>The final line replaces the interim line</b> when the sentence ends; the translation follows for that sentence only.'],
    ['<b>Row E: latency readout</b> "[ 820 ms ]" after a line is an option on P09 (Display); <b>row D</b> sends the previous 1 to 2 sentence pairs as context.'],
    ['<b>Exists:</b> previous, current and translation lines, newest-wins requests. <b>Missing:</b> the interim line, per-sentence finals, the readout.', true],
  ]);
  const bench = `<div class="bench"><div class="lbl" style="margin-bottom:8px">Benchmark to fill at build: same recording, same laptop, Whisper base + Qwen 0.5B (docs/roadmap/caption-speed.md)</div><table class="stt"><thead><tr><th>METRIC</th><th>1.2.9</th><th>AFTER A + C</th><th>WINDOWS CAPTIONS (B)</th><th>TARGET</th></tr></thead><tbody>
<tr><td>Speech start to first text on the pill</td><td>to measure</td><td>to measure</td><td>to measure</td><td>under 1.5 s</td></tr>
<tr><td>Sentence end to final line</td><td>to measure</td><td>to measure</td><td>to measure</td><td>under 1 s</td></tr>
<tr><td>Final line to translation</td><td>to measure</td><td>to measure</td><td>to measure</td><td>under 1 s</td></tr>
<tr><td>CPU, average</td><td>to measure</td><td>to measure</td><td>to measure</td><td>report only</td></tr></tbody></table></div>`;
  return {
    id: 'P12', slug: 'faster-captions', title: 'Faster captions: interim text and a timeline', tier: 'PILL', ext: 'the Live caption lines and the 4 s capture window (poni_core::capture Chunker, services/capture.rs post_loop)',
    lives: 'island/crates/poni-core/src/capture.rs, services/capture.rs, engine-rs/engine/src/app.rs (/draft interim flag), docs/roadmap/caption-speed.md',
    states: null, after: `${timeline}<div class="gr2" style="margin-top:34px">${a}${b}${c}${d}</div>${bench}`,
    before: before('', 'Not capturable (island window excluded from screen capture); drawn from today\'s code: one final line per 4 s window, translation after it.', todayLive()),
    must: ['A timeline of one sentence today (about 4.9 s to first text) and after (about 1.3 s), with the 1.5 s target marked.', 'The pill shows an interim line (lighter, with a caret) under the last final line; the final line replaces it.', 'Translation per sentence, not per window.', 'An optional latency readout "[ 820 ms ]" after each line.', 'Study rows A to E are cited; the benchmark table is empty until build.'],
    motion: [['Interim grows', 'new words fade in 80 ms; no line jump'], ['Final replaces', 'interim to final colour 120 ms, translation slides in 120 ms'], ['Caret', 'blinks 1 s; steady with reduced motion']],
    stories: [st('PMM-025', 'Speed', 'partial', 'First caption text on screen under 1.5 s after speech starts (today about 4 s window plus ASR). Interim text grows while the person speaks and is replaced by the final line; translation follows per sentence.', 'Exists: 4 s windows, silence skipped, one /draft in flight, newest wins. Missing: interim lines, utterance buffer, per-sentence finals.'), st('PMM-027', 'Study', 'new', 'docs/roadmap/caption-speed.md: what LiveCaptions-Translator does, what we adopt (rows A to G), latency measured before and after on the same recording; the benchmark table above is the fill-in.')],
    where: ['<code>poni-core/src/capture.rs</code>: Chunker becomes an utterance buffer (row A)', '<code>services/capture.rs post_loop</code> and <code>SessionLog.push</code>: interim then final', '<code>engine app.rs /draft</code>: <code>interim</code> and <code>accurate</code> flags; <code>translate.rs</code> context turns (rows C, D)', '<code>services/livecaptions.rs</code> (new, row B, behind a setting)'],
  };
};

export const BOARDS2 = [P08(), P09(), P10(), P11(), P12()];
