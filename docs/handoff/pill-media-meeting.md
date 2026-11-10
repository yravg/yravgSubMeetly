# Handoff: Media, Meeting and quick caption settings on the pill

Roadmap / PRD: `docs/roadmap/pill-media-meeting.md` (PMM-001 to PMM-027).
Canvas generator: `docs/design/pill-media-meeting-canvas/`.
Claude Design canvas: https://claude.ai/artifact/TT3DHVZ8QvKkvidzuCPhTo (private, version 6: cover, index, P01-P12)

## Status

| Step | State | Evidence |
| --- | --- | --- |
| 0. Caption settings apply to running captions (pre-work) | done | island 1.2.9, commit 6ea3ea3, installed on the laptop |
| 1. PRD | done | `docs/roadmap/pill-media-meeting.md` |
| 2b. Canvas round 2 (P08-P12) | done | build 12 boards, 0 anatomy problems, 56 new controls, PMM-001..027 placed; render 0 errors / 0 broken / scrollWidth 1640; lint 12/12; slop 73 (C) 0 errors 49 warnings; new text pairs all >= 4.5:1 (lowest 4.76) |
| 2. Canvas (boards P01-P07) | done | worker `pmm-canvas` (Sonnet) + lead fixes; build: 7 boards, 0 anatomy problems, 29 new controls, 18/18 PRD rows placed; render 1640: 0 errors, 0 broken images, scrollWidth 1640; lint_boards 7/7; slop 73 (C), 0 errors, 27 warnings (11px mono labels, `!important` in Before/After panes, inline padding); contrast lowest checked pair 4.99 (`#F2745A` on `#2b2b2e`). Regenerate: `node build.mjs` (static) / `node build.mjs --dc <root>`; render needs `PUPPETEER_EXECUTABLE_PATH` = Chrome for Testing 154 |
| 3. Owner answers Q1-Q3 | done | 2026-11-10: all defaults accepted; Q1 extended -> PMM-017/018 |
| 3b. Owner sign-off on canvas | waived | owner 2026-11-10: proceed with the build once boards are finished |
| 4. Build PMM-001 .. PMM-027 | in progress | orchestrator `pmm-lead` (Fable 5.2), checkpoint `.checkpoints/pmm-lead.md`; build steps below |
| 4.1 PMM-001 rename + PMM-024 register real records | done | island 1.3.0 installed (`island/dist/yravgSubMeetly-Setup-1.3.0.exe`, sha256 9ccad895...b8a7). Tests: poni 291 pass / 6 ignored (`media_tab_reads_media`, `media_section_title`), poni-core 531; `test/register-sync.test.mjs` 9 + `test/register-sync-page.test.mjs` 2. Seen headless on the installed engine: register lists 10 island meetings, pill "Synced with island · just now", no write requests. Not seen on screen: the Media tab label on the pill |
| 4.2 PMM-004/017/018 classifier + PMM-014 Settings rows | done, part open | island 1.3.1. Tests: poni 293 pass / 6 ignored, poni-core 544 (`meeting_source` 12 tests incl. `every_family_is_a_meeting`, `a_joined_link_stays_active_for_ten_minutes`; `an_old_file_gets_the_meeting_defaults`; `meeting_apps_rows_follow_the_drawing`, `picking_a_running_app_keeps_its_process_name`). Full `npm test` after step 4.1: 686 / 674 pass / 0 fail / 12 skipped. Open: "Paste a meeting link" and the "Always treat <host> as a meeting" offer have no UI until the Meeting tab (4.5; unknown host is only logged). Differs from P07: no Add dialog (the settings kit has no dialog or text field): "Paste link" reads the clipboard, "Add a running app" › Pick lists apps inline; "Kept: <host>" is a notice. Not seen: a real Teams/Zoom/Meet call, the Settings rows on screen |
| 4.3 PMM-011/012/013 Aa strip, pop-up language pills | done | island 1.3.2 installed (`island/dist/yravgSubMeetly-Setup-1.3.2.exe`, sha256 98cb9d37...c459). Shared component `pill/quick_captions.rs` (strip, list, keyboard, `notice_press`), Aa on Live, `Settings::quick_captions_open`, pop-up language pills (capsule cap 450 for "Captions on" only). Tests: poni 302 pass / 6 ignored, poni-core 544. Differs from P05/P06: on Empty/Error Live, Aa sits in the page's top right corner (no header row there); the pop-up subtitle reads "Translating" / "Original language only" since the pills name the languages; the mac app does not route pop-up pill presses (Windows only). Not seen on screen: strip, list and pop-up pills (island window excluded from capture) |
| 4.4 PMM-002/003/015 Media caption column | done | island 1.3.3 installed (`island/dist/yravgSubMeetly-Setup-1.3.3.exe`, sha256 a22f7eea...d896). `pages/media.rs` `column()` decides the right column (synced lyrics > running non-meeting captions > kept transcript > "Caption this" offer > lyrics); Aa strip under the caption column. PMM-015 design: same `/notes` doc with `source: "media"` (`meeting_doc::as_transcript/is_transcript/promote`), session fold `meeting_source::SessionSeen` (any meeting moment keeps the meeting save); `engine-sync.js` pull skips `source: media`; island Minutes page shows a Video chip + Save as meeting. Tests: poni 303 / 6 ignored, poni-core 546, register-sync 10 + page 2. Full `npm test`: 687 / 673 pass / 2 fail / 12 skipped; both failures (`native-connection` ping, `web-host-captions` spoken clip) also fail with HEAD's `engine-sync.js`, so not from this step (likely the installed engine running on the default port; not investigated). Not seen on screen: caption column, Caption this, Kept as transcript, Video chip |
| 4.5 PMM-005..009 Meeting tab with live notes (+ PMM-018 UI) | done | island 1.3.4 installed (`island/dist/yravgSubMeetly-Setup-1.3.4.exe`, 34.2 MB, sha256 f4bb2839...750c; built on D: because E: is full). Worker `pmm-meeting` (Sonnet): `poni_core::live_notes`, `pages/call.rs` (`PageKind::Call`), `CallState`, notes saved with the session. Tests: poni 304 / 6 ignored, poni-core 556. Full `npm test`: 687 / 673 pass / 2 fail / 12 skipped, same two as step 4.4. Cause of the `native-connection` ping failure: `test/engine-bin.mjs` picks the stale `engine-rs/target/debug` engine (8 Nov) when `SUBMEETLY_ENGINE_BIN` is unset; with the installed engine it passes. `web-host-captions` then gets further but times out waiting for a subtitle (Runtime.callFunctionOn, 180 s); not investigated, no JS changed in this step. Not seen on screen: the Meeting tab, notes refresh, Saved state (island window excluded from capture; no real call) |
| 4.6 PMM-019/020/021 Live in the room | open | |
| 4.7 PMM-025/026/027 faster captions | open | |
| 4.8 PMM-022 Captions tab, PMM-023 Minutes all records | open | |

## Decisions

- Audio playback in tests (owner 2026-11-10, IDM grabs media URLs): never open a media URL (mp3, lab-server sample, YouTube) through the default browser, `start`, `explorer.exe <url>`, `Start-Process <url>` or Chrome's default profile. Play local files only, in-process: PowerShell `System.Windows.Media.MediaPlayer` on a local path (curl to a scratch file first), `ffplay -nodisp -autoexit <local file>`, or SAPI speech (`System.Speech.Synthesis.SpeechSynthesizer`). Browser tests: only headless puppeteer with Chrome for Testing (`PUPPETEER_EXECUTABLE_PATH`, its own temp profile).

- Owner 2026-11-10: after the boards are finished, build without waiting for a canvas sign-off. Orchestrator: Fable 5.2. Workers: Opus 5.5 at low effort or Sonnet 5.5 at high effort.

- Canvas: Before and After where a real Before exists (owner screenshots of the Music page and Advanced settings; the island window is left out of screen capture, so other Before frames are drawn from today's code and labelled so). No reference strips (no public Teams Facilitator frames). Claude Design only. Taken from the owner's earlier canvas answers (Before+After, Design only) and the "no check-ins" rule.

## Known gaps in the canvas

- P03-P06 Before panes are drawn from code (the island window is excluded from screen capture); P01, P02, P07 use owner screenshots.
- Tab row with Meeting active is ~9 DIP wider than 620; P01 shows it with Shelf hidden (decide at build: icon-only Meeting tab or narrower gaps).
- Proposals, not code facts: pop-up width cap 372 -> 450, Meeting page 428 tall.
- Older caption lines use `--faint` (navy at 50%), same as today's Live "previous line"; about 3.4:1 on white, below 4.5:1. Revisit at build.

## Build notes

- Rust on this laptop: default toolchain is `stable-x86_64-pc-windows-gnu` (fails: `dlltool.exe` not found). Set `$env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-msvc'`.
- JS tests: `python3` must be a real `.exe` (Node `spawn` does not run `.cmd`): prepend a folder holding a copy of `python.exe` named `python3.exe` and set `PYTHONHOME=C:\Program Files\Python311`. `npm` from Git Bash is broken (stale kimi shim): run `npm` from PowerShell.
- Engine tests: the stale `engine-rs/target/debug` engine was deleted (owner 2026-11-11). Set `SUBMEETLY_ENGINE_BIN` to a fresh engine (a release build on D:, or a copy of the installed `submeetly-engine.exe`), else the engine tests skip.
- PMM-024 limits (comment `shortcut:` in `src/lib/engine-sync.js`): a meeting deleted on the engine side stays in the browser copy; a local edit made while the engine was down is overwritten at the next start. The Source fact shows the raw value for sources without a label (`calendar`).

## Next step

Step 4.6: PMM-019/020/021 Live in the room. Blocker: E: has 7 MB free; build on D: (`CARGO_TARGET_DIR=D:\cargo-target\pmm-meeting`, `TMP=D:
usttmp-pmm`, installer `/OD:\sm-dist`). Old caches in `E:\cargo-target` (about 58 GB, last used 2026-11-08..10) wait for the owner to delete them.
