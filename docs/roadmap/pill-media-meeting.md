# Media, Meeting and quick caption settings on the pill (roadmap / PRD)

Owner request 2026-11-10 (island 1.2.9):

> If we play video/music, the captions should also pop up on [the Music page]. Better change
> "Music" to "Media". If there is a meeting (Teams, Zoom, Google Meet or any official video
> meeting), the captions go under "Meeting". This new Meeting tab has captions with the minutes
> of that meeting recorded live, like the Teams Facilitator feature. Live should still be there
> and have more options to toggle the language etc. like Advanced settings has, because now
> every change needs Advanced settings. Better a button to hide and show them directly on the pill.
> Create PRD and Canvas first, before the build, so we avoid rebuilding again and again.

Handoff (live state): `docs/handoff/pill-media-meeting.md`.
Canvas: `docs/design/pill-media-meeting-canvas/` (generator) and the Claude Design canvas named in the handoff.
Builds on: `docs/roadmap/pill-meetings.md` (M1-M10, done in 1.2.5) and island 1.2.9 (caption settings
apply to running captions without a restart).

## Today (1.2.9), what exists

| Area | Today | Where |
| --- | --- | --- |
| Music tab | Art, title, seek bar, transport, synced lyrics; "No synced lyrics for this song" otherwise. Shows any media session (Chrome video too). | `island/crates/poni/src/pages/media.rs`, `PageKind::Media` title "Music" |
| Live tab | Previous + current caption line, translation under it, Hold / Unfollow, empty and error states. No language controls. | `pages/live.rs` |
| Minutes tab | Meeting register (Accept / Carry / Assign), pager, Paste transcript. Enum is `PageKind::Meeting`. | `pages/meeting.rs` |
| Caption settings | Only in Advanced settings › Captions and languages: Caption what this PC plays, Start captions by themselves, Translate captions, Spoken language, Translate into, Translate synced lyrics. | `settings_window.rs` `Section::Speech` |
| Auto start | Media session from a non-music app (`captionable_app`) or a calendar meeting with a join link running (`meeting_now`). Stops 90 s after. | `poni_core::capture::Auto` |
| Session end | Every captions session with lines is saved as a meeting (`MOM-WIN-*`) with a `/notes/generate` draft. | `app.rs` `end_session` |
| "Captions on" pop-up | Translate / Don't translate pill, opens Live. | `app.rs` `captions_notice` |

## Gap list

1. Tab says "Music" though it plays any media (YouTube in Chrome in the owner's screenshot).
2. Video playing: the right column says "No synced lyrics for this song" while captions of that video run elsewhere (Live).
3. No meeting-specific place: Teams / Zoom / Meet captions land on Live like a video.
4. No live minutes: decisions and actions are drafted only after Stop.
5. Language and translation changes need Advanced settings; nothing on the pill.
6. Meeting apps are recognised only through a calendar event with a join link; an ad-hoc Teams call, Zoom or Meet without a calendar entry is treated like a video.

## Requirements

Status words: `missing`, `partial`, `done`. Priority P0 (must, this round), P1 (should), P2 (later).

| ID | P | Requirement | Acceptance (what the person sees) | Status |
| --- | --- | --- | --- | --- |
| PMM-001 | P0 | Music tab renamed **Media** | Tab label, tab tooltip, tray menu, Settings › Tabs row and the Advanced settings section read "Media" / "Media and lyrics"; icon unchanged; `settings.json` keys unchanged (no migration needed). | missing |
| PMM-002 | P0 | Captions on the Media page | While captions run for a media source and the track has no synced lyrics, the right column shows the caption lines (previous dim, current large, translation under it) instead of "No synced lyrics". Synced lyrics, when present, keep the column. | missing |
| PMM-003 | P1 | Caption a song without lyrics | Music app, no synced lyrics, captions off: the right column offers "Caption this" (starts captions for this session only; auto rules unchanged). | missing |
| PMM-004 | P0 | Meeting source detection | A call is a meeting when (a) a calendar event with a join link runs (today), or (b) a meeting app is in a call: Teams (`ms-teams.exe`, classic `Teams.exe`), Zoom (`Zoom.exe`), Webex, Slack huddle, or a browser whose window title shows Google Meet / Teams / Zoom web and that uses the microphone. Detection runs on the island only, reads process names, window titles and Windows' microphone-in-use record; nothing leaves the PC. Pure classifier `poni_core::capture::source_kind` with tests. | missing |
| PMM-005 | P0 | New **Meeting** tab | A tab "Meeting" (call icon) after Live. Visible while a meeting source is active or its session was saved in the last 10 minutes; hideable in Settings › Tabs like the others. Captions of a meeting source open this tab (not Live) when they start by themselves. | missing |
| PMM-006 | P0 | Live captions on the Meeting tab | Left column: rolling caption lines (speaker-less, newest at the bottom), translation under each when on; elapsed time and meeting title (calendar title, app name otherwise). | missing |
| PMM-007 | P0 | Live minutes (Facilitator-style) | Right column "Notes so far": Summary (1-3 lines), Decisions, Action items, Questions, refreshed from the session lines every 60 s or every 12 new lines via the engine's `/notes/generate`, marked "AI draft". Each item: Keep (pins it into the minutes), Edit, Remove. "Updated 20 s ago" stamp; engine down shows "Notes paused: engine not answering" and captions continue. | missing |
| PMM-008 | P0 | Add a note by hand | "+ Note" on the Meeting tab adds a decision, action (with owner) or note typed on the pill; it is kept and never overwritten by a refresh. | missing |
| PMM-009 | P0 | Meeting ends → minutes saved | When the meeting source ends (or Stop): the session is saved as today (`MOM-WIN-*`, calendar title when there is one) with kept items, typed notes and the last draft; the tab shows "Saved · Open in Minutes". | partial (save exists, no live items) |
| PMM-010 | P0 | Live tab keeps its controls (see PMM-019/020) | Live keeps every current state (normal, empty, error, locked, needs input, Hold / Unfollow) and shows captions of any source. | done (keep) |
| PMM-011 | P0 | Quick caption settings on the pill | A "Aa" settings button on Live, Meeting and the Media caption column shows / hides a strip with: Captions on/off, Auto start, Translate on/off, Spoken language, Translate into. Each control writes the same setting as Advanced settings, applies to running captions at once (1.2.9 path), and shows the result in the next caption window. Strip visibility remembered (`settings.quick_captions_open`). Keyboard: Tab order left to right, Space toggles, ←/→ steps a language. | missing |
| PMM-012 | P1 | Language picker list | Pressing the language name (not −/+) opens a list of the 12 languages (Spoken also Auto-detect) on the pill; Esc closes; the current one is checked. | missing |
| PMM-013 | P1 | "Captions on" pop-up gets languages | The pop-up shows "Auto-detect → Chinese" as two small pills that open the list (PMM-012), beside Translate / Don't translate. | missing |
| PMM-014 | P1 | Settings window follows | Advanced settings › Captions and languages gets "Meeting apps" (switch per app family: Teams, Zoom, Meet, Webex, Slack) and "Open the Meeting tab when a meeting starts". | missing |
| PMM-015 | P1 | Media sessions not saved as meetings | A media (non-meeting) session is kept as a transcript (History on the Minutes page, type "Video") instead of a new meeting in the register; "Save as meeting" turns it into one. | missing (open question Q2) |
| PMM-017 | P0 | Meeting apps are a list the person extends | Advanced settings › Captions and languages › Meeting apps lists the built-in families (Teams, Zoom, Google Meet, Webex, Slack) and an **Add** row: pick a running app (its process name is kept) or paste a meeting link or web address (e.g. a Tencent Meeting / VooV link; its host, `meeting.tencent.com`, is kept). Kept in `settings.meeting_apps` (`{kind: app|host, value, label}`), each removable. The classifier (PMM-004) reads built-ins plus this list; no code change needed to add a service. | missing |
| PMM-018 | P0 | Join from a pasted link records under Meeting | A meeting link pasted on the Meeting tab ("Paste a meeting link", or Today › a calendar row's Join) opens it (app scheme when installed, else the browser) and marks that meeting active for the island: captions that start in the next 10 minutes while its app/browser plays sound go to the Meeting tab with the link's host as title until a better title is known. Unknown hosts are added to Meeting apps after a one-tap "Always treat <host> as a meeting". | missing |
| PMM-019 | P0 | Live = the room around the laptop | The Live tab transcribes and translates what the laptop's **microphone** hears (people speaking in the room), not only what the PC plays. Source picker on Live: Room (mic), This PC (loopback), Both (hybrid: room + online call mixed). Default for Live: Room. Mic chosen from Windows input devices; "Mic in use / blocked" states with the Windows privacy link. | missing |
| PMM-020 | P0 | Live works like Meeting, offline | Live has the same layout as the Meeting tab: captions with translation left, live "Notes so far" right (Summary, Decisions, Actions, Questions; Keep/Edit/Remove; + Note), elapsed time, title ("In-room meeting", editable; calendar title when a meeting without join link runs). Stop saves to Minutes like PMM-009, type "In-room". Hold / Unfollow and today's states stay (rule: never remove features). | missing |
| PMM-021 | P1 | Hybrid meeting | "Both" mixes mic and loopback into one stream for the engine; lines are tagged Room / Online (from which side had more energy in the window) so the minutes can tell them apart. | missing |
| PMM-022 | P1 | Captions tab (all caption settings on the pill) | Optional tab "Captions" (sliders icon, hidden by default, switch in Settings › Tabs) holding every caption and translation setting of Advanced settings › Captions and languages plus the new ones (source per tab, mic device, meeting apps, latency mode, translation engine, font size, show original/translation/both). The Aa strip stays as the quick subset. | missing |
| PMM-023 | P0 | Minutes compiles every tab's records | The Minutes tab lists every saved record from Meeting, Live (in-room), Media (transcripts) and pasted transcripts, newest first, with a source chip (Meeting · Teams, Live · Room, Media · Video, Pasted) and a filter. Each tab also has its own "History" list showing only its records. One store: the engine's notes (`~/.yraveragesubmin/notes.json`). | missing |
| PMM-024 | P0 | Minutes register page shows real records | The Minutes register main page (minutes.html opened from the island, and the app window's Minutes page) shows the meetings the island saved, not demo / sample minutes. Demo minutes appear only after "Load demo meetings", labelled Sample, and can be removed. Register edits write back to the engine so the island sees them. | missing. Cause (2026-11-10): the register reads only its own origin's browser storage (`src/lib/notes-store.js:16,68-72`, key `minutesRegister`); `src/lib/engine-sync.js:32-56` pushes register → engine but only primes ids on pull, never imports engine docs; `notes-sync.js` has `meetingToDoc` but no doc → meeting converter. The island opens `http://127.0.0.1:17865/app/minutes.html` (`services/engine.rs:68-71`), whose localStorage still holds the two CPOC demo meetings (`notes-fixture.js`, `MOM-CPOC7-W35/W36`) from an earlier "Load demo meetings" click. Fix: `docToMeeting` + pull-and-merge in `startEngineSync` (engine wins for ids it holds; local-only demo stays labelled Sample), `storage`/poll refresh, round-trip test against the island's `meeting_doc` shape. |
| PMM-025 | P0 | Faster live captions | Measured target: first caption text on screen under 1.5 s after speech starts (today about 4 s window + ASR). Interim text grows while the person speaks and is replaced by the final line; translation follows per sentence. Techniques studied from LiveCaptions-Translator (GitHub, SakiRinn) and listed in the engine study row. | missing |
| PMM-026 | P1 | Caption engine options | Latency mode (Fast / Balanced / Accurate), ASR source (our Whisper engine, or Windows Live Captions where available), translation context (previous sentences sent with each line), show original / translation / both, font size on the pill. | missing |
| PMM-027 | P1 | Engine study and benchmark | `docs/roadmap/caption-speed.md`: what LiveCaptions-Translator does, what we adopt, latency measured before and after on the same recording (first text, final line, translation), RTF and CPU. | missing |
| PMM-016 | P2 | Speaker names in meetings | When the meeting app exposes nothing, lines stay speaker-less; Teams transcript paste (exists) adds names after. Live speaker names need a separate study. | missing |

## Order of build (after canvas sign-off)

1. PMM-001 rename (small, unblocks the canvas wording).
2. PMM-004 classifier (pure core + tests), then PMM-005 tab and routing.
3. PMM-011 quick strip on Live (shared component), then reuse on Meeting and Media.
4. PMM-002 Media caption column.
5. PMM-006 / 007 / 008 / 009 Meeting tab with live minutes.
6. P1 rows: 012, 013, 014, 003, 015.

Each step: failing test first, `cargo test -p poni -p poni-core`, version bump, installer, install on the laptop, CHANGELOG line, handoff update.

## Owner request 2 (2026-11-10, after the first canvas)

> Live should transcribe the audio where the device is: the laptop is the receiver of people speaking around it, with translation, like the Meeting tab but for a meeting held offline (or offline + online). If needed, another tab for quick access to all advanced caption/translation settings; the Aa strip is very good. The Meeting tab is very good. Minutes compiles all records from any tab, and each tab sees its own history too. The Minutes register main page must be synced; it still shows the CPOC / demo minutes. Improve live caption speed, performance and options, learning from github.com/SakiRinn/LiveCaptions-Translator.

Rows PMM-019 to PMM-027. PMM-010 ("Live stays as today") is replaced by PMM-019/020: Live keeps every current control and state, and gains the room source and the notes column.

## Owner answers (2026-11-10)

- Q1 meeting apps: Teams, Zoom, Google Meet, Webex, Slack; **easy to add later**, also by giving a meeting link (e.g. Tencent Meeting) so it records under Meeting → PMM-017, PMM-018.
- Q2 media sessions: kept as transcripts with "Save as meeting" (PMM-015 confirmed).
- Q3 live minutes refresh every 60 s / 12 lines on the local engine, paused on battery saver (confirmed).
