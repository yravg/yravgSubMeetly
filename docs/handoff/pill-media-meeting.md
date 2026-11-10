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
| 4.3 PMM-011/012/013 Aa strip, pop-up language pills | open | |
| 4.4 PMM-002/003/015 Media caption column | open | |
| 4.5 PMM-005..009 Meeting tab with live notes | open | |
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
- PMM-024 limits (comment `shortcut:` in `src/lib/engine-sync.js`): a meeting deleted on the engine side stays in the browser copy; a local edit made while the engine was down is overwritten at the next start. The Source fact shows the raw value for sources without a label (`calendar`).

## Next step

Step 4.3: Aa quick strip on Live (shared component), language list, pop-up language pills.
