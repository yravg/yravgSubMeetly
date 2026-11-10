# Meetings on the pill: handoff

Roadmap: `docs/roadmap/pill-meetings.md` (the 50 scenarios). Updated 2026-11-10 by the lead session (Claude Opus 5.5).

## Status

| Step | State | Evidence |
| --- | --- | --- |
| M1 ICS link (slow Outlook calendars) | done | 1.2.4 `d05eb28`; owner's 450 KB link read in 46 s on the installed engine, 16 meetings |
| M2 Calendar Captions starts island captions, no Chrome | done | `pages/calendar.rs` (was `SetupExtension`) |
| M3 Captions start on any sound (not a music app), translate pop-up | done | `services/meter.rs` (`IAudioMeterInformation`), `capture::SoundGate` tests; notice "Captions on · Translating into English" with Don't translate / Translate pill (`InlineAction::Translate`); setting `translate_captions` (default on), engine `tgt=none` = spoken line only (`draft_translation` test) |
| M4 Saved captions take the running calendar meeting's title | done | `running_event_title` |
| M5 Pick any meeting | done | `View::selected/select_step/position`, test `the_person_can_step_through_every_meeting_and_a_gone_one_falls_back`; Meeting page head pager "Meeting 2 / 14" |
| M6 Every item reachable | done | Meeting, Inbox and Calendar pages page with ‹ › (`hkit::pager`) |
| M7 Paste transcript | done | `poni_core::transcript_paste` (Teams transcript, Teams captions, read.ai, VTT, SRT, plain; 5 tests); `Command::PasteTranscript` → `capture::save_pasted` |
| M8 Paste into a Calendar Notes meeting | done | `meeting_doc::with_base` test |
| M9 Earlier meetings on Calendar | done | `calendar::past`, `window_path` (engine asked from 7 days back), Notes only on past rows |
| M10 Inbox row opens its meeting | done | `pages/inbox.rs` |
| S1 Join opens the Teams app | done | `calendar::teams_app_link` + `window::url_scheme_registered("msteams")` |
| Secondary / tertiary | done by the same code unless listed below | see roadmap |

## Not verified on screen

Every page change above was compiled and unit-tested but not clicked through on the installed build:
the pager pills, Paste transcript with a real Teams copy, the "Captions on" pop-up and its pill,
the Earlier list, Join opening Teams. Next session: install the newest `island/dist` setup and
walk M1–M10 by hand.

## Known limits

- The engine keeps 50 meetings (`notes.truncate(50)` in `engine-rs/engine/src/app.rs`); older ones fall off.
- Sound detection cannot tell a Teams call from a browser playing music; a playing music app (Spotify, Apple Music…) is the only exclusion.
- The meeting picker steps one by one (no search).

## Next step

Walk M1–M10 on the installed build; fix what the screen shows.
