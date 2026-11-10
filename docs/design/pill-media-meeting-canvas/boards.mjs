// Board data for the pill Media / Meeting canvas (P01-P07). All names, people and the video are sample data.
import { ic, esc, NEW, PART, dp } from './kit.mjs';

export const PRD_FILE = 'docs/roadmap/pill-media-meeting.md';
// PRD rows: id -> [priority, title, PRD status]. Status words are the PRD's own (missing / partial / done).
export const PRD = {
  'PMM-001': ['P0', 'Music tab renamed Media', 'missing'],
  'PMM-002': ['P0', 'Captions on the Media page', 'missing'],
  'PMM-003': ['P1', 'Caption a song without lyrics', 'missing'],
  'PMM-004': ['P0', 'Meeting source detection', 'missing'],
  'PMM-005': ['P0', 'New Meeting tab', 'missing'],
  'PMM-006': ['P0', 'Live captions on the Meeting tab', 'missing'],
  'PMM-007': ['P0', 'Live minutes (Facilitator-style)', 'missing'],
  'PMM-008': ['P0', 'Add a note by hand', 'missing'],
  'PMM-009': ['P0', 'Meeting ends, minutes saved', 'partial'],
  'PMM-010': ['P0', 'Live tab stays', 'done'],
  'PMM-011': ['P0', 'Quick caption settings on the pill', 'missing'],
  'PMM-012': ['P1', 'Language picker list', 'missing'],
  'PMM-013': ['P1', '"Captions on" pop-up gets languages', 'missing'],
  'PMM-014': ['P1', 'Settings window follows', 'missing'],
  'PMM-015': ['P1', 'Media sessions not saved as meetings', 'missing'],
  'PMM-016': ['P2', 'Speaker names in meetings', 'missing'],
  'PMM-017': ['P0', 'Meeting apps are a list the person extends', 'missing'],
  'PMM-018': ['P0', 'Join from a pasted link records under Meeting', 'missing'],
};
const st = (id, src, stat, text, gap) => ({ id, src, stat, text, gap });

/* ---------- pill pieces ---------- */
const TABS = [['Lyrics', 'live'], ['Call', 'meeting'], ['Clipboard', 'minutes'], ['CheckCircle', 'inbox'], ['Calendar', 'today'], ['Clock', 'timer'], ['Volume', 'talk'], ['Cpu', 'engine'], ['Music', 'media'], ['Tray', 'shelf'], ['ListChecks', 'tasks'], ['Timer', 'focus'], ['Gauge', 'system'], ['Script', 'script'], ['Addons', 'addons']];
const TITLE = { live: 'Live', meeting: 'Meeting', minutes: 'Minutes', media: 'Media', inbox: 'Inbox', today: 'Today' };
/** Pill header. meeting: hidden | ghost | idle | live. markMeeting wraps the Meeting tab in NEW; markMedia wraps the active Media tab in PARTIAL. */
export function header({ active = 'live', meeting = 'hidden', media = 'Media', skip = [], markMeeting = false, markMedia = false, clock = '15:51' } = {}) {
  const tabs = TABS.map(([icon, id]) => {
    if (skip.includes(id)) return '';
    if (id === 'meeting') {
      if (meeting === 'hidden') return '';
      if (meeting === 'ghost') return '<div class="ghost" title="hidden until a meeting runs"></div>';
      const dot = meeting === 'live' ? '<span class="ld"></span>' : '';
      const el = active === 'meeting' ? `<div class="tb on">${ic(icon, 16)}<span>Meeting</span>${dot}</div>` : `<div class="tb">${ic(icon, 16)}${dot}</div>`;
      return markMeeting ? NEW(el, 'display:flex', 'tbw') : el;
    }
    if (id === active) {
      const el = `<div class="tb on">${ic(icon, 16)}<span>${id === 'media' ? media : TITLE[id] || id}</span></div>`;
      return id === 'media' && markMedia ? PART(el, 'display:flex', 'tbw') : el;
    }
    return `<div class="tb">${ic(icon, 16)}</div>`;
  }).join('');
  return `<div class="ph"><div class="tb menu">${ic('Menu', 16)}</div>${tabs}<span class="clk">${clock}</span></div>`;
}
const pill = (head, body, { strip = '', hdr = false } = {}) => `<div class="pl">${head}${hdr ? '<div style="height:12px"></div>' : `<div class="pb">${body}${strip}</div>`}</div>`;

const AA = (on = false, mark = true) => { const b = `<span class="btn sq${on ? ' on' : ''}" style="font-size:11.5px">Aa</span>`; return mark ? NEW(b, 'display:inline-flex', 'aaw') : b; };
const sw = (on = true) => `<span class="sw${on ? ' on' : ''}"></span>`;
export const strip = ({ spoken = 'Auto-detect', into = 'Chinese', open = '' } = {}) => `<div class="qs"><span class="chip">Captions${sw()}</span><span class="chip">Auto${sw()}</span><span class="chip">Translate${sw()}</span><span class="chip${open === 'spoken' ? ' sel' : ''}"><span class="k">Spoken</span><span class="stp">${ic('Minus', 11)}</span><span class="nm">${spoken}${ic('Caret', 11)}</span><span class="stp">${ic('Plus', 11)}</span></span><span class="chip arrow${open === 'into' ? ' sel' : ''}"><span class="k">&rarr;</span><span class="stp">${ic('Minus', 11)}</span><span class="nm">${into}</span><span class="stp">${ic('Plus', 11)}</span></span></div>`;
const STRIP_H = 40;
export const LANGS = ['English', 'Indonesian', 'Chinese', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Thai', 'Russian', 'Arabic', 'Vietnamese'];
const langGrid = (cur, spoken = true, style = '') => `<div class="lgrid" style="${style}"><div class="h"><span>${spoken ? 'Spoken language' : 'Translate into'}</span><span>Esc closes</span></div><div class="g">${(spoken ? ['Auto-detect', ...LANGS] : LANGS).map((l) => `<span${l === cur ? ' class="cur"' : ''}>${l}${l === cur ? ic('Check', 12) : ''}</span>`).join('')}</div></div>`;
const GUIDE = (t) => `<div class="gd"><span>${t}</span><span>Today<i>Live</i><i>Minutes</i><i>Inbox</i><i>Agenda</i></span></div>`.replace('<i>Live</i>', '<i class="o">Live</i>');
const eq = '<div class="eq"><i style="height:6px"></i><i style="height:13px"></i><i style="height:9px"></i><i style="height:4px"></i></div>';
const mblock = (video) => `<div class="mblk"><div class="art ${video ? '' : 'm'}">${video ? 'macOS<br>27.2.1' : 'sample<br>cover'}</div><div class="mt"><div class="cap">${video ? 'Chrome' : 'Music app'}</div><div class="t">${video ? 'macOS 27.2.1 is out. W…' : 'Evening Walk'}</div><div class="a">${video ? 'HalfManHalfTech' : 'Sample Band'}</div></div>${eq}<div class="pr"><span>${video ? '5:50' : '1:12'}</span><div class="bar"><i style="width:${video ? 78 : 31}%"></i></div><span>&minus;${video ? '1:40' : '2:36'}</span></div><div class="ctl">${ic('Prev', 24)}<div class="pz"><i></i><i></i></div>${ic('Next', 24)}</div></div>`;
const capCol = (aaOn = false) => `<div class="mcol"><div class="cc"><div class="top"><span class="s"><span class="dot"></span>Captions</span>${AA(aaOn)}</div><div class="p">&hellip;and Apple says the update fixes</div><div class="c">macOS 27.2.1 is out, and it fixes the battery bug.</div><div class="tr">macOS 27.2.1 已发布，修复了电池问题。</div></div></div>`;
const noLyr = `<div class="mcol"><div class="lyr">${ic('Lyrics', 22)}<span>No synced lyrics for this song</span></div></div>`;
const synced = `<div class="mcol"><div class="syn"><div class="l1">Streetlights on the water</div><div class="l2">We keep walking, slow and wide</div><div class="l3">我们慢慢走，走得很远</div><div class="l4">Nobody asks where we are going</div></div></div>`;
const offer = `<div class="mcol"><div class="lyr">${ic('Lyrics', 22)}<span>No synced lyrics for this song</span>${NEW('<span class="btn pri">Caption this</span>', 'display:inline-flex', 'cw')}</div></div>`;
const kept = (kind) => `<div class="mcol"><div class="lyr">${ic('Check', 22)}<b style="color:#131B44;font-size:14px">Kept as transcript</b><span>${kind}</span>${NEW('<span class="btn pri">Save as meeting</span>', 'display:inline-flex', 'cw')}</div></div>`;
const media = ({ video = true, col, strip: s = '', markHead = false, aaOn = false, mediaLabel = 'Media' }) => pill(header({ active: 'media', media: mediaLabel, markMedia: markHead }), `<div class="mp">${mblock(video)}${col}</div>`, { strip: s });

const liveHead = (extra = '', follow = 'macOS 27.2.1 is out') => `<div class="lh"><span class="dot"></span><span class="t">Following&nbsp;&nbsp;<b>${follow}</b></span><span class="r">${extra}<span class="btn">Hold</span><span class="btn util">Unfollow</span><span class="btn">Stop captions</span></span></div>`;
const liveBody = (extra = '', s = '', { list = '' } = {}) => `${GUIDE('Captions of what this PC plays')}<div class="lv">${liveHead(extra)}<div class="lines"><div class="p">&hellip;and Apple says the update fixes</div><div class="c">macOS 27.2.1 is out, and it fixes the battery bug.</div><div class="tr">macOS 27.2.1 已发布，修复了电池问题。</div></div><div class="ft"><span>Captions are saved as a meeting when you stop.</span><span>24 / 24</span></div></div>${s}${list}`;
const live = ({ aa = false, s = '', list = '', markStrip = false } = {}) => pill(header({ active: 'live', meeting: 'hidden' }), liveBody(aa === false ? '' : AA(aa === 'on'), markStrip ? NEW(s, '', 'sw0') : s, { list }));

const CAP_L = `<div class="p">The tower crane is booked until noon.</div><div class="pt">塔吊中午前已被占用。</div><div class="p">Which slot is free after that?</div><div class="pt">之后哪个时段有空？</div><div class="p">The permit for level 5 is still pending.</div><div class="pt">五层的许可证还在审批中。</div><div class="p">We can't lift before the permit is checked.</div><div class="pt">许可证查清之前不能起吊。</div><div class="p">Chen, can you check it today?</div><div class="pt">陈，你今天能查一下吗？</div><div class="c">So move the crane slot to Thursday morning.</div><div class="tr">所以把吊车时段改到周四上午。</div>`;
const notesCol = ({ mode = 'ok', selected = true }) => {
  const acts = selected ? `<span class="ac"><span title="Keep">${ic('Check', 12)}</span><span title="Edit">${ic('Edit', 12)}</span><span title="Remove">${ic('Close', 12)}</span></span>` : '';
  const sk = '<div class="sk" style="width:92%"></div><div class="sk" style="width:64%"></div>';
  const body = mode === 'refresh'
    ? `<div class="ns"><div class="k s">Summary</div>${sk}</div><div class="ns"><div class="k d">Decisions</div><div class="it"><span class="kp">${ic('Pin', 11)}</span><span class="tx">Permit check before any lift</span></div><div class="sk" style="width:80%"></div></div><div class="ns"><div class="k a">Action items</div>${sk}</div><div class="ns"><div class="k q">Questions</div><div class="sk" style="width:70%"></div></div>`
    : `<div class="ns"><div class="k s">Summary</div><div class="it"><span class="tx">Crane slot moves to Thursday; the lift waits for the permit check.</span></div></div>
<div class="ns"><div class="k d">Decisions</div><div class="it${selected ? ' sel' : ''}"><span class="tx">Move the crane slot to Thursday 08:00</span>${acts}</div><div class="it"><span class="kp">${ic('Pin', 11)}</span><span class="tx">Permit check before any lift</span><span class="kp">Kept</span></div></div>
<div class="ns"><div class="k a">Action items</div><div class="it"><span class="tx">Confirm the lift permit with the yard</span><span class="ow">Chen &middot; Fri</span></div><div class="it"><span class="tx">Send the revised plan</span><span class="ow">Alya &middot; Wed</span></div></div>
<div class="ns"><div class="k q">Questions</div><div class="it"><span class="tx">Who covers the night watch on Friday?</span></div></div>`;
  const stamp = mode === 'refresh' ? 'Refreshing&hellip;' : mode === 'down' ? 'Paused &middot; last draft 2 min ago' : 'Updated 20 s ago';
  const warn = mode === 'down' ? `<div class="warn">${ic('Gear', 14)}Notes paused: engine not answering<span class="btn util" style="margin-left:auto;height:22px;background:#fff">Try again</span></div>` : '';
  return `<div class="nt"><div class="nh"><span class="cap" style="color:#131B44">Notes so far</span><span class="ai">AI draft</span><span class="up">${stamp}</span></div>${warn}<div style="display:flex;flex-direction:column;gap:7px;${mode === 'down' ? 'opacity:.55' : ''}">${body}</div><div class="pa"><span>Kept and typed notes never get overwritten</span>${NEW('<span class="btn">+ Note</span>', 'display:inline-flex', 'nw')}</div></div>`;
};
const meetingHead = ({ aaOn = false, title = 'Weekly site coordination', src = 'Teams' } = {}) => `<div class="mh"><span class="t">${title}</span><span class="src">${src}</span><span class="tm"><span class="dot r"></span>12:41</span><span class="r">${AA(aaOn)}<span class="btn">Stop captions</span></span></div>`;
const meeting = (state, { s = '' } = {}) => {
  let inner;
  if (state === 'none') inner = `<div class="emp">${ic('Call', 28)}<b>No meeting running</b><span>Start captions to caption this PC now, open Today to join the next meeting, or paste a link.</span>${NEW('<div class="lnk"><span class="in">Paste a meeting link</span><span class="btn pri">Join</span></div>', 'display:block', 'lk')}<div class="r"><span class="btn pri">Start captions</span><span class="btn">Open Today</span></div></div>`;
  else if (state === 'link') inner = `${meetingHead({ title: 'meeting.tencent.com', src: 'Link' })}${NEW('<div class="ask"><span>meeting.tencent.com is not a known meeting app.</span><span class="btn pri">Always treat meeting.tencent.com as a meeting</span><span class="btn util">Not now</span></div>', 'display:block', 'ak')}<div class="cols"><div class="cl">${CAP_L}</div>${notesCol({ mode: 'ok', selected: false })}</div>`;
  else inner = `${meetingHead({ aaOn: !!s })}${s}<div class="cols"><div class="cl">${state === 'down' ? CAP_L : CAP_L}</div>${notesCol({ mode: state === 'refresh' ? 'refresh' : state === 'down' ? 'down' : 'ok', selected: state === 'ok' })}</div>`;
  return pill(header({ active: 'meeting', meeting: state === 'none' ? 'idle' : 'live', skip: ['shelf'] }), `<div class="mt3" style="height:${state === 'none' ? 324 : state === 'link' ? 414 : 366}px">${inner}</div>`);
};

/* what the island shows today (drawn from the code; the real island window is excluded from screen capture) */
const todayLive = (empty) => pill(header({ active: 'live', media: 'Music' }), `${GUIDE('Captions of what this PC plays')}<div class="lv">${liveHead('')}<div class="lines"><div class="p">&hellip;and Apple says the update fixes</div><div class="c">macOS 27.2.1 is out, and it fixes the battery bug.</div><div class="tr">macOS 27.2.1 已发布，修复了电池问题。</div></div><div class="ft"><span>Captions are saved as a meeting when you stop.</span><span>24 / 24</span></div></div>`);
const todayPop = (sub, btn) => `<div class="pop" style="--pw:372px"><span class="disc">${ic('Lyrics', 16)}</span><span class="tt"><b>Captions on</b><small>${sub}</small></span><span class="btn">${btn}</span></div>`;

/* ---------- layout helpers ---------- */
const note = (html, pn = false) => `<div class="note${pn ? ' pn' : ''}">${html}</div>`;
const grp = (label, frame, notes = [], cls = '') => `<div class="grp${cls ? ' ' + cls : ''}"><div class="gl">${label}</div><div class="bk">${frame}</div><div class="nr">${notes.map((n) => (typeof n === 'string' ? note(n) : note(n[0], n[1]))).join('')}</div></div>`;
const grpR = (label, frame, notes = [], w = 752) => `<div class="grp"><div class="gl">${label}</div><div class="row2" style="grid-template-columns:${w}px 1fr"><div class="bk" style="padding:22px 16px">${frame}</div><div class="nc">${notes.map((n) => (typeof n === 'string' ? note(n) : note(n[0], n[1]))).join('')}</div></div></div>`;
const kk = (arr) => `<div class="kept"><div class="lbl">Controls kept from today (${arr.length})</div><div class="chips">${arr.map((c) => `<span>${esc(c)}</span>`).join('')}</div></div>`;
const before = (img, cap, html = '') => ({ cap, html: img ? `<img class="ixi" src="${img}" style="width:624px" alt="Before: ${esc(cap)}">` : `<div class="bk" style="width:752px">${html}</div>` });

/* ---------- boards ---------- */

const P01 = () => {
  const a = grp('No meeting: Meeting tab hidden, Media page open', pill(header({ active: 'media', meeting: 'ghost', markMedia: true }), '', { hdr: true }), [
    ['<b>Hover Media</b> the tooltip reads "Media". The icon stays the music note, the settings keys stay.'],
    ['<b>Exists:</b> tab label, tooltip, tray menu, Settings › Tabs row, section title. <b>Missing:</b> the word "Media" in each. No migration.', true],
  ]);
  const b = grp('Meeting running: Meeting tab appears after Live', pill(header({ active: 'live', meeting: 'live', markMeeting: true }), '', { hdr: true }), [
    ['<b>Teams call starts</b> the Meeting tab slides in after Live with a red live dot. Live stays where it is.'],
    ['<b>Call ends and is saved</b> the dot goes, the tab stays 10 minutes, then it leaves the row.'],
  ]);
  const c = grp('Meeting tab selected (Shelf hidden in this sample)', pill(header({ active: 'meeting', meeting: 'live', skip: ['shelf'], markMeeting: true }), '', { hdr: true }), [
    ['<b>Row length</b> with Meeting active the row is about 9 DIP longer than 620. Hide Shelf in Settings › Tabs, or the row drops the last icon first.'],
  ]);
  const tabs = `<div class="sw2" style="width:640px"><div class="ct" style="padding:16px 20px"><h4>Tabs shown on the island</h4><div class="gp">
${['Media', 'Meeting', 'Shelf', 'Tasks', 'Focus', 'Notifications'].map((n) => {
    const row = `<div class="rw"><div class="tx"><b>${n}</b><small>${n === 'Meeting' ? 'Shown while a meeting is running, and 10 minutes after' : n === 'Media' ? 'Playing now, controls and captions' : 'Show this tab in the island'}</small></div><span class="sw on"></span></div>`;
    return n === 'Media' ? PART(row, 'border-radius:10px', 'rw1') : n === 'Meeting' ? NEW(row, 'border-radius:10px', 'rw1') : row;
  }).join('')}
</div></div></div>`;
  const d = grp('Settings › Tabs (dark, as today)', tabs, [
    ['<b>Switch Meeting off</b> the tab never shows, captions of meetings open on Live as today.'],
    ['<b>Exists:</b> the row "Music", listed with Shelf, Tasks, Focus, Notifications. <b>Missing:</b> label "Media" and the new Meeting row.', true],
  ]);
  return {
    id: 'P01', slug: 'tab-row', title: 'Tab row: Media and Meeting', tier: 'PILL', ext: 'the island tab row (Live, Minutes, Inbox, Today ... Music, Shelf)',
    lives: 'island/crates/poni/src/pages/mod.rs (PageKind, tab titles), tray menu, Settings › Tabs',
    states: null,
    after: `<div class="gr2">${a}${b}${c}${d}</div>`,
    before: before('shots/before-music-page.png', 'Real capture of today (1.2.9): the active tab reads "Music" for a Chrome video.'),
    must: ['Tab reads "Media" everywhere: label, tooltip, tray, Settings › Tabs, section "Media and lyrics".', 'Meeting tab with a call icon sits right after Live; red dot while a call is live.', 'Hidden with no meeting; switchable off in Settings › Tabs like Shelf and Tasks.', 'The clock keeps its place; no tab overlaps it.'],
    motion: [['Appear', 'Meeting tab slides in 200 ms ease-out; neighbours shift'], ['Live dot', 'steady red; no blink (reduced motion safe)'], ['Leave', 'fades 200 ms, 10 min after the session is saved']],
    stories: [st('PMM-001', 'Rename', 'partial', 'Tab label, tooltip, tray menu, Settings › Tabs row and section read "Media" / "Media and lyrics"; icon and settings.json keys unchanged.', 'Exists: the tab, its tooltip, tray entry and Settings rows, titled "Music". Missing: the new word in each place.'), st('PMM-005', 'New tab', 'new', 'A Meeting tab (call icon) after Live; visible while a meeting source is active or saved in the last 10 minutes; hideable in Settings › Tabs.')],
    where: ['<code>island/crates/poni/src/pages/mod.rs</code>: <code>PageKind::title</code>, <code>HIDEABLE</code>', '<code>island/crates/poni/src/icons.rs</code>: add <code>Call</code> (drawn here, NEW)', '<code>island/crates/poni/src/settings_window.rs</code> Tabs section'],
  };
};

const P02 = () => {
  const a = grp('a. Video in Chrome, captions running', media({ video: true, col: capCol(), markHead: true }), [
    ['<b>Video plays, captions run</b> the right column shows the caption lines instead of "No synced lyrics": previous dim, current large, translation under it.'],
    ['<b>Exists:</b> the page with art, seek bar, transport and the lyrics column. <b>Missing:</b> caption lines in that column; the tab label.', true],
  ]);
  const b = grp('b. Song with synced lyrics: unchanged', media({ video: false, col: synced }), [
    ['<b>Synced lyrics exist</b> they keep the column, with the same translate-lyrics setting. Captions never replace lyrics.'],
  ]);
  const c = grp('c. Music app, no lyrics, captions off', media({ video: false, col: offer }), [
    ['<b>Press Caption this</b> captions start for this session only; Start captions by themselves is unchanged. The column switches to (a).'],
  ]);
  const d = grp('d. Aa pressed: quick strip under the page', media({ video: true, col: capCol(true), strip: strip() }), [
    ['<b>Press Aa</b> the strip opens under the page and the pill grows 40 px; press again to hide. Same strip as Live (P05).'],
    ['<b>Change Chinese to Japanese</b> the next caption window shows Japanese; no restart (1.2.9 path).'],
  ]);
  return {
    id: 'P02', slug: 'media-page', title: 'Media page with captions', tier: 'PILL', ext: 'the Music page (art, seek bar, transport, synced lyrics)',
    lives: 'island/crates/poni/src/pages/media.rs, pill/music.rs',
    states: null,
    after: `<div class="gr2">${a}${b}${c}${d}</div>`,
    before: before('shots/before-music-page.png', 'Real capture of today (1.2.9): Chrome video, right column says "No synced lyrics for this song" while captions run elsewhere.'),
    must: ['Video with captions on: caption lines in the right column (previous dim, current large, translation).', 'Song with synced lyrics: unchanged.', 'Song without lyrics, captions off: a "Caption this" button.', 'An Aa button on the caption column opens the quick strip.'],
    motion: [['New line', 'current line slides up 120 ms, older fades to dim'], ['Caption this', 'column cross-fades 150 ms to the caption view'], ['Strip', 'pill height 200 ms ease-out']],
    stories: [st('PMM-002', 'Media', 'partial', 'While captions run for a media source with no synced lyrics, the right column shows the caption lines; synced lyrics keep the column.', 'Exists: art, seek bar, transport, lyrics column with an empty state. Missing: caption lines and translation in the column.'), st('PMM-003', 'Media', 'new', 'Music app, no synced lyrics, captions off: the column offers "Caption this" for this session only.'), st('PMM-011', 'Aa', 'new', 'An Aa button on the Media caption column shows or hides the quick caption strip (full strip on P05).')],
    where: ['<code>pages/media.rs</code>: right column decision (lyrics, captions, offer)', '<code>pill/music.rs</code>: column layout 245 DIP', '<code>poni_core::capture</code>: captions state for the current session'],
  };
};

const P03 = () => {
  const mk = (state) => grpR({ ok: 'Listening: captions left, notes so far right', refresh: 'Notes refreshing', down: 'Engine down: captions continue', none: 'No meeting: empty state with Paste a meeting link', link: 'Joined from a pasted link, host not known yet' }[state], meeting(state), {
    ok: [
      ['<b>Every 60 s or 12 new lines</b> the notes refresh from the session lines; items are marked AI draft.'],
      ['<b>Keep</b> pins an item into the minutes, <b>Edit</b> changes the text, <b>Remove</b> drops it. A refresh never touches kept or typed items.'],
      ['<b>+ Note</b> adds a decision, action (with owner) or note typed on the pill (PMM-008).'],
      ['<b>Lines stay speaker-less</b> for now (P2): Teams transcript paste adds names after the meeting.'],
    ],
    refresh: [['<b>Refresh runs</b> the drafts show skeleton lines, kept items stay; captions on the left never pause.']],
    down: [['<b>Engine not answering</b> a warning replaces the stamp, the last draft is greyed, captions go on. Try again retries at once.']],
    none: [['<b>Tab opened with no meeting</b> it says so and offers Start captions (this PC now), Open Today (next meeting) or Paste a meeting link.'], ['<b>Paste a link, press Join</b> the island opens it (the app when installed, else the browser) and treats it as the active meeting: captions in the next 10 minutes go to this tab (PMM-018).']],
    link: [['<b>Link joined, host unknown</b> the tab is titled by the host; one tap on <b>Always treat meeting.tencent.com as a meeting</b> adds it to Settings › Meeting apps (P07).'], ['<b>Not now</b> keeps this session under Meeting but adds nothing to the list; a link from Today › Join behaves the same.']],
  }[state]);
  const states = [['ok', 'Listening'], ['refresh', 'Notes refreshing'], ['down', 'Engine down'], ['none', 'No meeting'], ['link', 'Pasted link']];
  const panes = states.map(([k]) => dp(`st:${k}`, mk(k))).join('');
  return {
    id: 'P03', slug: 'meeting-tab', title: 'Meeting tab: live captions and notes', tier: 'PILL', ext: 'the Live tab (captions) and the Minutes tab (register); drawn as a taller page like Minutes (268)',
    lives: 'new island/crates/poni/src/pages/meeting_live.rs, engine POST /notes/generate',
    states, after: panes,
    before: before('', 'Not capturable (the island window is excluded from screen capture); drawn from today\'s code: a Teams call lands on Live like a video, notes only appear after Stop.', todayLive()),
    must: ['Header: meeting title, app, red dot with elapsed time, Aa, Stop captions.', 'Left: rolling caption lines with translation; right: Notes so far (Summary, Decisions, Action items with owner, Questions) marked AI draft.', 'Keep, Edit, Remove on each item; "Updated 20 s ago"; + Note.', 'Empty state offers Paste a meeting link next to Start captions and Open Today.', 'A joined link titles the tab by its host; an unknown host shows one tap: Always treat it as a meeting.', 'States: listening, refreshing, engine down, no meeting, pasted link.'],
    motion: [['New caption', 'slides up 120 ms'], ['Refresh', 'skeleton fades in 150 ms, items cross-fade when new text lands'], ['Keep', 'pin icon settles 120 ms; row stays']],
    stories: [st('PMM-006', 'Meeting', 'new', 'Left column: rolling caption lines, newest at the bottom, translation under each; elapsed time and meeting title.'), st('PMM-007', 'Notes', 'new', 'Right column "Notes so far", refreshed every 60 s or 12 lines, AI draft, Keep / Edit / Remove, "Updated 20 s ago"; engine down shows "Notes paused" and captions continue.'), st('PMM-008', 'Note', 'new', '"+ Note" adds a decision, action with owner or note by hand; it is kept and never overwritten.'), st('PMM-018', 'Link', 'new', '"Paste a meeting link" (or Today › Join) opens the link and marks that meeting active: captions in the next 10 minutes go to the Meeting tab titled by the host; an unknown host shows "Always treat <host> as a meeting".'), st('PMM-016', 'P2', 'new', 'Lines stay speaker-less; live speaker names need a separate study (later).')],
    where: ['<code>engine-rs</code>: <code>/notes/generate</code> (exists), refresh timer on the island', '<code>poni_core::capture::Auto</code>: routes meeting sources here', '<code>app.rs end_session</code>: saves kept and typed items (P04)', '<code>poni_core::capture</code>: pasted-link meeting window (10 min), host title'],
  };
};

const P04 = () => {
  const ended = pill(header({ active: 'meeting', meeting: 'idle', skip: ['shelf'] }), `<div class="mt3" style="height:324px"><div class="sv"><span class="ok">${ic('Check', 22)}</span><b>Saved &middot; Weekly site coordination, 38 min</b><span class="m">1 summary, 2 decisions, 3 actions, 1 question. 2 items kept, 1 note typed by you.</span><div class="r">${PART('<span class="btn pri">Open in Minutes</span>', 'display:inline-flex', 'cw')}<span class="btn">Dismiss</span></div></div></div>`);
  const mv = media({ video: true, col: kept('Video sessions are not meetings.'), markHead: false });
  const hist = pill(header({ active: 'minutes' }), `${GUIDE('Meetings and transcripts')}<div class="hist" style="height:160px"><div class="hr"><span class="ty">Meeting</span><span class="tx">Weekly site coordination</span><span class="dim">38 min</span><span class="btn">Open</span></div><div class="hr"><span class="ty v">Video</span><span class="tx">macOS 27.2.1 is out</span><span class="dim">21 min</span>${NEW('<span class="btn">Save as meeting</span>', 'display:inline-flex', 'cw')}</div><div class="hr"><span class="ty">Meeting</span><span class="tx">Design review</span><span class="dim">45 min</span><span class="btn">Open</span></div></div>`);
  const a = grp('a. Meeting ended: tab shows the result', ended, [
    ['<b>Call ends or Stop</b> the session is saved as today (MOM-WIN-*, calendar title when there is one) plus kept items, typed notes and the last draft.'],
    ['<b>Exists:</b> the save and the draft after Stop. <b>Missing:</b> the live items in the save and the "Saved · Open in Minutes" result on the tab.', true],
  ]);
  const b = grp('b. Media session ended', mv, [
    ['<b>Video ends</b> it is kept as a transcript, not a meeting; Save as meeting turns it into one.'],
  ]);
  const c = grp('c. Minutes › History', hist, [
    ['<b>Open Minutes</b> the transcript sits in History with type "Video"; the register stays for real meetings.'],
  ]);
  return {
    id: 'P04', slug: 'meeting-ends', title: 'Meeting ends: saved, and the media variant', tier: 'PILL', ext: 'app.rs end_session (saves every captions session as a meeting today)',
    lives: 'island/crates/poni/src/app.rs end_session, pages/meeting.rs (History)',
    states: null, after: `<div class="gr2">${a}${b}${c}</div>`,
    before: before('', 'Not capturable (island window excluded from screen capture); drawn from today\'s code: Stop saves every session as a meeting without a result, video sessions land in the register too.', todayLive()),
    must: ['"Saved · Open in Minutes" with counts of kept and typed items.', 'Media variant: "Kept as transcript · Save as meeting".', 'History in Minutes lists transcripts with type Video.', 'Tab leaves 10 minutes after the save.'],
    motion: [['Saved', 'check draws 200 ms, buttons fade in'], ['Dismiss', 'result slides out 150 ms; tab stays its 10 minutes'], ['Save as meeting', 'row moves to the register with a 150 ms highlight']],
    stories: [st('PMM-009', 'Save', 'partial', 'When the source ends or Stop: saved as today with kept items, typed notes and the last draft; the tab shows "Saved · Open in Minutes".', 'Exists: the MOM-WIN-* save with a draft. Missing: kept and typed live items in it, and the result view.'), st('PMM-015', 'Media', 'new', 'A media session is kept as a transcript (History, type Video); "Save as meeting" turns it into one. Open question Q2.')],
    where: ['<code>app.rs end_session</code>', '<code>pages/meeting.rs</code>: History list and Save as meeting', '<code>engine</code>: <code>/notes</code> write path'],
  };
};

const P05 = () => {
  const a = grp('a. Strip hidden: Aa shows on Live', live({ aa: 'off' }), [
    ['<b>Aa off</b> Live looks as today plus one button; every existing control stays (Hold, Unfollow, Stop captions).'],
  ]);
  const b = grp('b. Strip shown', live({ aa: 'on', s: strip(), markStrip: true }), [
    ['<b>Press Aa</b> the strip opens and the pill grows 40 px; the choice is remembered (settings.quick_captions_open).'],
    ['<b>Space</b> toggles a switch, <b>Left / Right</b> steps a language, Tab walks left to right.'],
  ]);
  const c = grp('c. Language list open over the page', live({ aa: 'on', s: strip({ open: 'spoken' }), list: langGrid('Auto-detect', true, 'top:28px;height:186px') }), [
    ['<b>Press the language name</b> (not minus or plus) the list opens: Spoken adds Auto-detect; the current one is checked.'],
    ['<b>Esc</b> closes the list; picking one closes it and applies at once.'],
  ]);
  const d = grp('d. Translate into: list for the second language', live({ aa: 'on', s: strip({ open: 'into', into: 'Japanese' }), list: langGrid('Japanese', false, 'top:28px;height:186px') }), [
    ['<b>Change Chinese to Japanese</b> the next caption window and the translation line follow, no restart.'],
  ]);
  return {
    id: 'P05', slug: 'live-quick-strip', title: 'Live tab: quick caption strip', tier: 'PILL', ext: 'the Live tab (Hold, Unfollow, states) and Advanced settings › Captions and languages',
    lives: 'island/crates/poni/src/pages/live.rs, new shared component pill/quick_captions.rs, settings.quick_captions_open',
    states: null, after: `<div class="gr2">${a}${b}${c}${d}</div>${kk(['Following / Held / Issued dot + title', 'Hold / Release', 'Unfollow', 'Start / Stop captions', 'N wait on you', 'Listening to this PC', 'Nothing to follow', 'Unfollowed', 'Speech model needed', 'Captions need attention', 'Offline message + Try again', 'Translation hints + Download', 'Previous line, current line, translation line', 'n / total counter'])}`,
    before: before('', 'Not capturable (island window excluded from screen capture); drawn from today\'s code: Live has no language or caption controls; each change needs Advanced settings.', todayLive()),
    must: ['A strip with Captions on/off, Auto, Translate, Spoken language (−/+), → language (−/+).', 'Pressing a language name opens the list of 12 (Spoken adds Auto-detect), current checked, Esc closes.', 'Each control writes the same setting as Advanced settings and applies at once.', 'Every Live control and state stays.'],
    motion: [['Strip', 'pill height 200 ms ease-out; strip fades in 120 ms'], ['List', 'opens 150 ms scale from the name; Esc closes 100 ms'], ['Switch', 'thumb slides 120 ms']],
    stories: [st('PMM-010', 'Live', 'built', 'Live keeps every current state and shows captions of any source (kept, listed below the boards).'), st('PMM-011', 'Strip', 'new', 'Aa shows or hides the strip: Captions, Auto, Translate, Spoken, Translate into; same settings, applied at once, visibility remembered.'), st('PMM-012', 'List', 'new', 'Pressing a language name opens the 12-language list; Spoken also Auto-detect; Esc closes; current checked.')],
    where: ['<code>pages/live.rs</code>: header and strip row', '<code>settings.rs</code>: <code>quick_captions_open</code>', '<code>poni_core::capture::LANGS</code>, <code>step_lang</code>'],
  };
};

const P06 = () => {
  const pop = (sub, pills, btn, w = 450) => `<div class="pop" style="--pw:${w}px"><span class="disc">${ic('Lyrics', 16)}</span><span class="tt"><b>Captions on</b><small>${sub}</small></span>${pills}<span class="btn">${btn}</span></div>`;
  const lp = (t, x = false) => `<span class="lp${x ? ' x' : ''}">${t}${ic('Caret', 11)}</span>`;
  const a = grp('a. Translating: two language pills', PART(pop('Translating', `${lp('Auto-detect')}<span class="ar">&rarr;</span>${lp('Chinese', true)}`, "Don't translate"), 'display:flex', 'pw'), [
    ['<b>Press a pill</b> the language list opens (P05); the pop-up stays 8 s after the last touch.'],
    ['<b>Exists:</b> the capsule with title, subtitle and Translate / Don\'t translate (200 to 372 wide). <b>Missing:</b> the two pills; width cap 450.', true],
  ]);
  const b = grp('b. Original language only', PART(pop('Original language only', lp('Auto-detect'), 'Translate'), 'display:flex', 'pw'), [
    ['<b>Press Translate</b> the second pill appears and the line below captions turns on.'],
    ['<b>Exists:</b> the Translate pill and the subtitle "Original language only". <b>Missing:</b> the Auto-detect pill that opens the list.', true],
  ]);
  const c = grp('c. List open from a pill', `<div class="pl" style="width:450px;border-radius:22px;min-height:0;box-shadow:0 18px 40px -16px rgba(19,27,68,.45)"><div style="padding:12px 14px">${langGrid('Chinese', false, 'position:static;box-shadow:none;padding:0')}</div></div>`, [
    ['<b>Esc</b> closes the list and keeps the pop-up open.'],
  ]);
  const flow = `<div class="grp" style="grid-column:1/-1"><div class="gl">d. Where a source goes (detection runs on the island; nothing leaves the PC)</div><div class="flow">
<div class="fb" style="width:250px"><b>Signals</b><small>process name, window title, microphone in use</small><small>Local only. No audio, no titles are sent anywhere.</small></div><span class="fa">&rarr;</span>
${NEW('<div class="fb" style="width:210px;height:100%"><b>source_kind</b><small>pure classifier in poni_core::capture, with tests</small></div>', 'display:flex;align-self:stretch', 'fw')}<span class="fa">&rarr;</span>
<div class="flow col" style="flex:1"><div class="fb"><b>Meeting app</b><small>Teams, Zoom, Google Meet in a browser, Webex, Slack huddle. Or a calendar event with a join link that is running.</small></div><div class="fb"><b>Other media</b><small>YouTube, a browser video, a streamed talk: not a meeting app.</small></div>${NEW('<div class="fb"><b>Your list or a pasted link</b><small>Apps and web addresses added in Settings › Meeting apps (P07), or a link joined in the last 10 minutes.</small></div>', 'display:flex;flex-direction:column', 'fw2')}<div class="fb"><b>Music with synced lyrics</b><small>A music app with lyrics for the song.</small></div></div><span class="fa">&rarr;</span>
<div class="flow col" style="width:330px"><div class="fb" style="height:78px;justify-content:center"><b>Meeting tab</b><small>captions and notes so far (P03)</small></div><div class="fb" style="height:60px;justify-content:center"><b>Media page</b><small>caption column (P02)</small></div><div class="fb" style="height:60px;justify-content:center"><b>Lyrics</b><small>the lyrics column, unchanged</small></div></div>
</div><div class="nr" style="margin-top:12px">${note('<b>Teams call without a calendar entry</b> goes to the Meeting tab; today it is treated like a video and lands on Live.')}${note('<b>Settings › Meeting apps</b> switches one app family off: it then falls back to Media (P07).')}${note('<b>A pasted link or an entry you added</b> routes to the Meeting tab like a built-in family; an unknown host asks once (P03).')}</div></div>`;
  return {
    id: 'P06', slug: 'captions-popup-routing', title: '"Captions on" pop-up and source routing', tier: 'PILL', ext: 'app.rs captions_notice and pill/notice.rs (capsule 48 high, 8 s)',
    lives: 'island/crates/poni/src/pill/notice.rs, poni_core::capture::source_kind (new)',
    states: null, after: `<div class="gr2">${a}${b}${c}${flow}</div>`,
    before: before('', 'Not capturable (island window excluded from screen capture); drawn from today\'s code: the pop-up has a Translate / Don\'t translate pill and opens Live; there is no routing.', `<div style="display:flex;flex-direction:column;gap:14px;align-items:center">${todayPop('Translating into Chinese', "Don't translate")}${todayPop('Original language only', 'Translate')}</div>`),
    must: ['Pop-up shows "Auto-detect → Chinese" as two pills beside Translate / Don\'t translate.', 'Pills open the 12-language list.', 'A source is classified: meeting app (or calendar event with join link) to Meeting; other media to Media; music with lyrics to lyrics.', 'Your list (apps and hosts) and a pasted link join the meeting branch.', 'Signals are local: process name, window title, microphone in use.'],
    motion: [['Pop-up', 'drops in 200 ms ease-out, leaves 150 ms after 8 s'], ['Pills', 'press scales 0.97 for 80 ms'], ['Route', 'tab switch is instant; page content cross-fades 150 ms']],
    stories: [st('PMM-013', 'Pop-up', 'partial', 'The pop-up shows the two language pills beside Translate / Don\'t translate; pills open the list.', 'Exists: the capsule with title, subtitle and the translate pill. Missing: language pills, wider capsule.'), st('PMM-004', 'Routing', 'new', 'A call is a meeting when a calendar event with a join link runs, or a meeting app is in a call; classified by process name, window title and microphone-in-use, on the island only.')],
    where: ['<code>pill/notice.rs</code>, <code>app.rs captions_notice</code>', '<code>poni_core::capture::source_kind</code> (new, pure, tested)', '<code>capture::Auto</code>: <code>captionable_app</code>, <code>meeting_now</code> feed it'],
  };
};

const P07 = () => {
  const ri = (name, tint, on = false, extra = '') => `<div class="ri${on ? ' on' : ''}"><span class="tl" style="background:${tint}">${ic('Gear', 12)}</span>${name}${extra}</div>`;
  const rail = `<div class="rl"><div class="ti"><span class="lg"></span>Advanced settings</div>${ri('General', '#8E8E93')}${ri('Appearance', '#5E5CE6')}${ri('Island', '#0A84FF')}${PART(ri('Media and lyrics', '#FF375F'), 'border-radius:8px', 'rr')}${ri('Captions and languages', '#BF5AF2', true)}${ri('Models', '#FFD60A')}${ri('Pop-ups', '#64D2FF')}${ri('Tabs', '#30D158')}${ri('Add-ons', '#0A84FF')}${ri('Focus', '#FF9F0A')}<div class="ri push"><span class="lg" style="width:20px;height:20px;border-radius:6px;background:#3a3a3d"></span>About</div></div>`;
  const row = (t, s, on = true, sub = false) => `<div class="rw${sub ? ' sub' : ''}"><div class="tx"><b>${t}</b><small>${s}</small></div><span class="sw${on ? ' on' : ''}"></span></div>`;
  const stp = (v) => `<span class="stp"><i>&minus;</i>${v}<i>+</i></span>`;
  const rm = (t, s) => `<div class="rw"><div class="tx"><b>${t}</b><small>${s}</small></div><span class="rmv">Remove</span></div>`;
  const meetingApps = NEW(`<div class="gp" style="margin-top:2px">${row('Microsoft Teams', 'Desktop app and classic Teams')}${row('Zoom', 'Zoom.exe')}${row('Google Meet', 'In a browser window that uses the microphone')}${row('Webex', 'Desktop app')}${row('Slack huddles', 'Huddle windows only', false)}${rm('Tencent Meeting', 'Added from a link: meeting.tencent.com')}${rm('Zoho Meeting', 'Added from a running app: ZohoMeeting.exe')}<div class="rw add"><div class="tx"><b>Add a meeting app or link</b><small>Pick a running app or paste a meeting link</small></div><span class="btn2">Add</span></div></div>`, 'border-radius:10px', 'ma');
  const dlgLink = `<div class="dlg"><b>Add a meeting app</b><div class="sg"><span>Running app</span><span class="on">Meeting link</span></div><div class="fld">https://meeting.tencent.com/dm/sample</div><small>Kept: <b>meeting.tencent.com</b> (the address, not the whole link). Nothing else is stored.</small><div class="ft"><span class="btn2">Cancel</span><span class="btn2 pri">Add</span></div></div>`;
  const dlgApp = `<div class="dlg"><b>Add a meeting app</b><div class="sg"><span class="on">Running app</span><span>Meeting link</span></div><div class="ap"><span>ZohoMeeting.exe</span><i>pick</i></div><div class="ap"><span>Slack.exe</span><i>pick</i></div><div class="ap dis"><span>Zoom.exe</span><i>already in the list</i></div><small>Kept: the process name. Remove it later from the list.</small><div class="ft"><span class="btn2">Cancel</span><span class="btn2 pri">Add</span></div></div>`;
  const openTab = NEW(`<div class="gp">${row('Open the Meeting tab when a meeting starts', 'Otherwise captions start on Live and the tab only shows in the row')}</div>`, 'border-radius:10px', 'ot');
  const win = `<div class="sw2">${rail}<div class="ct"><h1>Captions and languages</h1><h4>Captions</h4><div class="gp">${row('Caption what this PC plays', 'The engine writes what it hears on the island, in the language it hears')}${row('Start captions by themselves', 'When the PC plays sound (a call, a video, a meeting; not a music app); they stop after it ends')}${row('Translate captions', 'A second line in the language under Translate into (English by default)')}</div><h4>Meeting apps</h4>${meetingApps}${openTab}<h4>Languages</h4><div class="gp"><div class="rw"><div class="tx"><b>Spoken language</b><small>What the sound is in; Auto-detect works it out</small></div>${stp('Auto-detect')}</div><div class="rw"><div class="tx"><b>Translate into</b><small>Captions and synced lyrics are translated into this</small></div>${stp('Chinese')}</div></div><h4>Lyrics</h4><div class="gp">${row('Translate synced lyrics', 'A second row under the sung line; needs a translation model')}</div></div></div>`;
  const g = grpR('Advanced settings › Captions and languages (dark, as today)', win, [
    ['<b>Switch Slack huddles off</b> a huddle is treated as Media, not Meeting. Each family is its own switch (default: all five on).'],
    ['<b>Open the Meeting tab</b> off: a meeting starts captions on Live and the Meeting tab only sits in the row.'],
    ['<b>Exists:</b> the rail item "Music and lyrics" and the Captions and languages page. <b>Missing:</b> "Media and lyrics", the Meeting apps group, the Open-tab switch.', true],
  ], 872);
  const g2 = grpR('b. Add a meeting app: link or running app', `<div style="display:flex;gap:16px;align-items:flex-start">${NEW(dlgLink, 'display:block', 'dl')}${NEW(dlgApp, 'display:block', 'da')}</div>`, [
    ['<b>Paste a link</b> only the host is kept (meeting.tencent.com); a link to an unknown service needs no code change.'],
    ['<b>Pick a running app</b> its process name is kept; one already in the list is greyed.'],
    ['<b>Remove</b> on an added entry drops it at once; built-in rows only switch off.'],
  ], 872);
  return {
    id: 'P07', slug: 'settings-captions', title: 'Advanced settings: Captions and languages', tier: 'SETTINGS', ext: 'Advanced settings › Captions and languages (Section::Speech); the window stays dark',
    lives: 'island/crates/poni/src/settings_window.rs (Section::Music title, Section::Speech rows)',
    states: null, after: g + g2,
    before: { cap: 'Real capture of today (1.2.9): rail "Music and lyrics", Captions / Languages / Lyrics groups only.', html: '<img class="ixi" src="shots/before-settings-captions.png" style="width:840px" alt="Before: Advanced settings, Captions and languages">' },
    must: ['Rail item reads "Media and lyrics".', 'A Meeting apps group with one switch per family: Teams, Zoom, Google Meet, Webex, Slack huddles.', '"Open the Meeting tab when a meeting starts" switch.', 'The Meeting apps list ends with your own entries (each with Remove) and an Add row: pick a running app or paste a meeting link.', 'Every row of today stays and writes the same keys.'],
    motion: [['Switch', 'thumb slides 120 ms, colour 150 ms'], ['Stepper', 'value cross-fades 100 ms']],
    stories: [st('PMM-001', 'Rail', 'partial', 'The Advanced settings section reads "Media and lyrics".', 'Exists: the rail item "Music and lyrics". Missing: the new title.'), st('PMM-017', 'Add', 'new', 'Meeting apps lists the built-in families and an Add row: pick a running app (process name kept) or paste a meeting link (host kept, e.g. meeting.tencent.com); each added entry is removable.'), st('PMM-014', 'Settings', 'partial', 'Captions and languages gets "Meeting apps" (a switch per family) and "Open the Meeting tab when a meeting starts".', 'Exists: the page with Captions, Languages and Lyrics groups. Missing: Meeting apps and the Open-tab switch.')],
    where: ['<code>settings_window.rs</code>: <code>Section::Music</code> title, <code>Section::Speech</code> rows', '<code>settings.rs</code>: new keys for the five families and open-tab', '<code>poni_core::capture::source_kind</code> reads the switches', '<code>settings.meeting_apps</code> new: <code>{kind: app|host, value, label}</code>'],
  };
};

export const BOARDS = [P01(), P02(), P03(), P04(), P05(), P06(), P07()];
