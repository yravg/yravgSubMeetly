# Project tracker

Single source of truth for **what is released, what the plans promised, what each platform really has, and what is in flight**.
Last audited: **2026-11-12** against `origin/main` @ `820db3d` (v1.3.13). Written by an audit pass that read `HANDOFF.md`, `PROJECT-CONTEXT.md`, `CHANGELOG.md`, `docs/roadmap/*.md`, `docs/handoff/*.md`, `island/docs/*.md`, `docs/RELEASE-CHECKLIST.md` and the code.

Status words: **done** (shipped and evidenced) · **partial** · **missing** · **unverified** (docs say done, no proof in repo or never seen running) · **in progress** · **n/a**.
Objective release rows are checked by machine: `python3 island/tools/tracker_check.py` (add `--deep` to download and hash the assets). Last run: all PASS.

---

## A. Releases

Only `v1.3.13` is a GitHub release. Every earlier island build (0.2.26, 1.2.0 … 1.3.12) was built and installed **by hand on the owner's Windows laptop**; none was tagged or published. `CHANGELOG.md` has no 1.3.13 entry yet (see gaps).

| Release | Date (UTC) | What shipped | Assets | Machine check | Install verified |
| --- | --- | --- | --- | --- | --- |
| `v1.3.13` (Latest) | 2026-11-11 | First CI release. Mac app builds again (features removed from the fork dropped), ad-hoc signed **universal DMG**, Mac app starts + supervises + bundles the engine (`submeetly-engine`), model library plumbing on Mac, signed `latest.json` with `windows` and `mac` entries | `yravgSubMeetly-Setup-1.3.13.exe` 34 602 035 B · `yravgSubMeetly-1.3.13-mac.dmg` 27 291 188 B · `latest.json` | tag == `island/Cargo.toml`; `latest.json` signature verifies with key `ad662e29df0544ce`; sizes and sha256 match payload (`tracker_check.py`) | **Mac:** installed from the lead's local build of the same source, launches, engine answers `/health` and `/models`; a clean-download check of the GitHub DMG (sha256, codesign, launch from a temp folder) was started by the lead; its result is **not recorded here yet**. **Windows: NOT run on a Windows PC** (CI built it only). Mac update-in-place proven by `mac-update-test.sh` (1.3.12 → 99.0.0). No clean-Mac Gatekeeper "Open Anyway" walk-through. |
| `addon-sholat-3` | 2026-11-11 | Prayer-times files (places.json, adzan.m4a, NOTICE) | 3 | pre-release, URLs 200, sha256 = pins in `addons.rs` | n/a |
| `addon-ja-1` | 2026-11-11 | Japanese readings dictionary + NOTICE | 2 | same | n/a |
| `addon-downloader-1` | 2026-11-11 | Windows Downloader NOTICE (tools come from yt-dlp / quickjs-ng / GyanD) | 1 | same | n/a |
| `addon-downloader-mac-1` | 2026-11-11 | Mac Downloader qjs, ffmpeg, NOTICE + ffmpeg LGPL source | 6 | same (bytes taken from Oyenza's identical release; hashes match pins) | n/a |
| `v1.3.12` | — | Cancelled before publishing (its Mac DMG had no engine); tag deleted | — | — | built and installed on the laptop only, not via release |
| 1.2.0 … 1.3.11 | 2026-11-08 … 11-11 | Windows island builds (see `CHANGELOG.md`) | local `island/dist/*.exe` only | none | laptop only |

Auto-update chain status: the feed, key, `release` environment secret and signing are **proven** (a real signed `latest.json` exists and verifies). The **updater has never updated a real install from a published release** (Windows: never run on Windows from CI output; Mac: only the synthetic 99.0.0 test).

---

## B. Roadmap / sprints

### B1. Island product (`docs/roadmap/pill-media-meeting.md`, `docs/handoff/pill-media-meeting.md`)

Evidence column = commit/test/changelog entry. "Seen" = looked at on a real screen; the handoff repeatedly says the island window is excluded from screen capture, so **almost nothing in the island UI has been seen by a human or screenshot**.

| Item | Status | Evidence / note |
| --- | --- | --- |
| PMM-001 Music → Media rename, PMM-024 register reads real records | done (not seen) | 1.3.0; `test/register-sync*.test.mjs` |
| PMM-004 / 017 / 018 meeting vs video classifier + Settings rows | done, part open | 1.3.1; `meeting_source` tests. **Open:** "Always treat <host> as a meeting" offer UI; no real Teams/Zoom/Meet call tried |
| PMM-011 / 012 / 013 Aa strip, pop-up language pills | done (Windows only) | 1.3.2, `pill/quick_captions.rs`. Mac does not route pop-up pill presses |
| PMM-002 / 003 / 015 Media caption column, "Caption this", keep video as transcript | done (not seen) | 1.3.3 |
| PMM-005..009 Meeting tab with live notes | done (not seen) | 1.3.4, `poni_core::live_notes`, `pages/call.rs` |
| PMM-019 / 020 / 021 Live the room (mic / This PC / Both) | done, mic hardware tested | 1.3.5/1.3.6. Room/Online tag is a text prefix (shortcut); caption end-to-end not run |
| PMM-025 / 026 / 027 faster captions (interim line, Latency Fast/Balanced/Accurate) | done, **target unmeasured** | 1.3.7. 1.5 s first-text target probably missed (arithmetic 2.2–2.9 s); `caption-speed.md` bench rows partly filled (first text ≈ 5.2–5.7 s on bench clips) |
| PMM-022 Captions tab, PMM-023 Minutes lists all records | done (not seen) | 1.3.7, `7a44c65`, `0e685d7` |
| PMM-028 / 029 / 030 model library, languages, delete | done (not seen) | 1.3.11; Mac wired in 1.3.13 (library list, pull/select/delete; no folder picker on Mac) |
| PMM-031 / 032 andon lights, download bar, failure notice, ModelScope | done | 1.3.12; live ModelScope pull verified |
| Task F: Fast = Windows Live Captions (1.3.9), five Captions groups, px font, interim caret, latency readout | **unverified** | built on a Linux VPS under wine; handoff says "unrun on a real Windows 11 PC" (crash guard, Restore, bar parking) |
| PMM-016 (P2) | unverified | row exists in the PRD, no handoff evidence found |
| Caption-speed ideas C (translate per sentence end), D (context turns) | missing | `chat_prompt_turns` exists in `engine/src/translate.rs`, not used for captions |
| Idea F in `caption-speed.md` (OpenAI-compatible / Ollama endpoint) | missing → **in flight** (feat/connector-templates) | see D |
| Model catalog roadmap (`model-catalog.md`): quantized Qwen3, OPUS-MT pairs, catalog-as-data | partial | Qwen3-0.6B/1.7B GGUF + Marian shipped; Qwen3-ASR, Hy-MT, quantized whisper, "catalog as data" not done |

### B2. Meetings on the pill (`docs/handoff/pill-meetings.md`, M1–M10, S1)

All **done in code and unit tests**, all **"not verified on screen"** per the handoff (pager, Paste transcript with a real Teams copy, "Captions on" pop-up, Earlier list, Join → Teams). Known limits: engine keeps only 50 meetings; no meeting search; sound detection cannot tell a call from a browser playing audio.

### B3. SubMeetly-next (`docs/roadmap/submeetly-next.md`, `docs/handoff/submeetly-next.md`)

| Row | Status | Note |
| --- | --- | --- |
| BRAND-001 rename | partial | S1 open items: overlay label, store PNGs old wordmark; app footer still says v1.1.1 (extension manifest version) and exe ProductVersion resource reads 0.2.26 |
| ENG-001 non-ML routes (79 goldens) | done | engine tests 163 pass on Mac |
| ENG-002 / 003 Rust ASR + translation | done | WER ≤ 0.07; Qwen2.5-0.5B meaning poor (4/20) → replaced by Qwen3-1.7B q4 (16/20) |
| ENG-004 / S5 "Rust is default, Python removed" | **missing / unverified** | S5 row "open" in handoff; owner said yes 2026-11-08; `native/` Python helper still in repo and docs; verify whether installers start only the Rust engine (Windows installer does) |
| ISL-001..005, REL-001, REL-002 | done (REL-001/002: see A) | island fork S6/S7, installer S12 |
| ADD-001 add-ins (Agenda timer, Talk time, Engine monitor, Flag decision, Actions; + Recap email, Glossary, Due dates → .ics) | partial | S8 done; `addins2` (three new add-ins) result not found in repo history — **unverified** |
| THB-001/002 Threadbear map | done (docs) | `threadbear-mapping.md` |
| UI-001 canvas, UI-002 no feature lost | done (canvas v4–v13 on Claude Design; links in handoff, private) | canvases live on claude.ai, not verifiable from the repo; sources in `docs/design/*-canvas` |
| UI-003 de-slop build (S11), UI-004 translation colour, UI-005 one tab row | **open** (S11 "open") | UI-004/005 designed on canvas; no code evidence audited |

### B4. Tide shell (`docs/roadmap/tide-shell.md`, `docs/handoff/tide-shell.md`)

T1–T12 done and merged (Tide tokens, shell, Today, Ask Tide `/ask`, Minutes native page, side panel reskin, A01–A10 boards). T13 "Ship" is still marked *in progress* in the handoff although island 1.2.6 shipped.

| Item | Status |
| --- | --- |
| TIDE-001..017, 023, 024 | done (VPS tests; laptop `npm test` 658 pass / 0 fail / 8 skipped at 1.2.6) |
| TIDE-018 Ask Tide model engine, TIDE-019 cloud consent | partial — local `/ask` streams Qwen (seen once on the laptop); OpenRouter/cloud consent not audited → **unverified** |
| TIDE-020 credits, TIDE-021 monthly plans, TIDE-022 account + wallet server | **missing** (needs a server; explicitly "no server" in handoff) |
| Known gaps | real Qwen stream never observed on VPS; no abort on Ask close; no helper Speed row (no rtf in `/health`); Impeccable critique never run; 78/187 controls only in "kept" chip strips; 390 px header band clipped; Install-card wording; Models/Output/About tabs have no board |

### B5. Original plan (HANDOFF.md, NgodingPakeAI plan "UI Interaktif & Rilis Menyeluruh")

Plan marked complete 2026-09-05 (gate CLEAR, 306/306 → later 692 tests). Residuals still open: `e2e:native` REL-03 failed 3× consistently (renderer stops answering CDP in native mode) — "accepted residual", never root-caused; CWS package never uploaded; Windows/Linux installers and `run.bat` "never executed on a real machine" (the Inno Setup installer has since been run on the owner's laptop, `run.bat`/Linux not).
`HANDOFF.md` itself is **stale**: last "Posisi sekarang" is Sept; it still says (macOS bring-up section) that the island Mac app does not compile — **fixed in v1.3.13**.

### B6. Canvases / design boards

| Board set | Where | Verifiable here? |
| --- | --- | --- |
| SubMeetly canvas (12 boards, v13) | Claude Design (private link in `docs/handoff/submeetly-next.md`), source `docs/design/submeetly-canvas/` | source yes; hosted version no |
| Tide shell canvas A01–A10, K01 (v8) | claude.ai artifact link in `tide-shell.md`, source `docs/design/tide-shell-canvas/` | source yes; per-board worker reports `.ref/REPORT.md` lived on the old VPS worktrees `/home/user/dev/yravgSubMeetly/wt/tide-*` → **cannot be verified; likely lost** |
| Pill media/meeting canvas P01–P12 (v6) | claude.ai link in `pill-media-meeting.md`, source `docs/design/pill-media-meeting-canvas/` | same |
| overlay-revamp | `docs/design/overlay-revamp/` | not referenced by any roadmap — **check whether the overlay window work (D2) should follow it** |

---

## C. Feature parity (honest, as of v1.3.13)

Columns: **Win** = island on Windows · **Mac** = Rust island on macOS (v1.3.13) · **Ext** = Chrome extension / `app.html` shell · **Swift** = legacy `mac/` Swift app (separate product, not in the release).

| Feature | Win | Mac | Ext | Notes |
| --- | --- | --- | --- | --- |
| Live captions from PC audio (system sound → engine `/draft`) | done (WASAPI loopback) | **missing** (capture service stripped in the port; menu items are no-ops) | done (tab capture) | Swift app has ScreenCaptureKit captions, not shipped |
| Captions from microphone / room, Both | done (not seen) | **missing** | partial | |
| "Fast" captions via Windows Live Captions | unverified | n/a | n/a | never run on Win11 |
| Interim line, latency modes, show orig/translation/both, font px | done | missing (no capture) | partial | |
| Translation (local Qwen/Marian via engine) | done | engine runs; **no caption UI to use it** | done | |
| Model library: list, download (HF/ModelScope), select, delete, lights | done | **done in 1.3.13** (folder move: Windows only) | done (`#native-models`) | |
| Model speed graphs | missing → **in flight** | missing → in flight | partial (Performance tab, `perf-charts.js`) | |
| Calendar (ICS), Today month grid, Join Teams | done (not seen) | partial (pages shared; engine `/calendar` available) — **unverified** | n/a | |
| Meetings / Minutes / live notes / paste transcript | done (not seen) | **missing** (notes/IELTS/recorder services stripped; Minutes page opens nothing on Mac) | done (Minutes register) | |
| Exports | TXT/MD/SRT/VTT | missing | TXT/MD/SRT/VTT; CSV missing | PDF/DOCX/CSV in flight |
| Auto-detect meetings / auto captions | done (meeting_probe, mic-in-use) | **missing** (stub `Seen`) → in flight | n/a | |
| Now playing + synced lyrics | done | partial (Music/Spotify only; **no system now-playing reader**) → in flight | n/a | |
| Prayer times, Japanese readings, Downloader add-ons | done | done (add-on files now published) — **unverified on Mac** | n/a | |
| Pairdrop / phone drop, Shelf, Pomodoro, Script | done | partial / not audited | n/a | |
| Installer | Inno Setup per-user (CI built, **never run from CI output**) | DMG ad-hoc signed (Gatekeeper "Open Anyway"); no Developer ID | CWS zip never uploaded | |
| Auto-update | feed+signature proven, never exercised on Windows | in-place swap proven synthetically only | n/a | |
| Engine start/supervise | done | **done in 1.3.13** | native-messaging host | |
| Subtitle overlay window (transparent, always-on-top) | missing (pill only) | missing | partial (in-page overlay) | in flight |
| Speaker identification | missing | missing | missing (v2 notes carry `speaker` only from Teams paste) | in flight |
| Ask Tide (`/ask`) | done | n/a | done | |

---

## D. In flight (branches; none merged yet — check before trusting a row)

### D1. Meetily-Pro-parity (own implementation; Meetily Pro is closed/paid, only the Community edition is open source)

| Feature | Branch | Status |
| --- | --- | --- |
| Speaker diarization ("who said what") | `feat/diarization` | merged in 1.4.0 (tests green; not seen live) |
| Custom AI model connector (OpenAI-compatible / Ollama / OpenRouter) | `feat/connector-templates` | merged in 1.4.0 (tests green; not seen live) |
| Custom summary templates | `feat/connector-templates` | merged in 1.4.0 (tests green; not seen live) |
| Auto-detect meetings (Mac equivalent + notification) | `feat/auto-detect` | merged in 1.4.0 (tests green; not seen live) |
| Advanced exports (PDF, DOCX, Markdown) | `feat/exports` | merged in 1.4.0 (tests green; not seen live) |
| AI assistant & script integrations (MCP, webhooks, CLI) | `feat/integrations` | merged in 1.4.0 (tests green; not seen live) |
| Mac now-playing reader (MediaRemote adapter vendored, bundled, CI-built) | `feat/mac-nowplaying` | merged in 1.4.0 (tests green; not seen live) |

| Mac live captions (Core Audio tap + mic → engine → pill, saved as MOM-MAC) | `feat/mac-captions` | merged in 1.4.0 (verified live in 1.4.1: Mac sound tap → caption 1.8 s, translation, meeting saved on Quit) |
| Model speed tests + charts on Models | `feat/model-bench` | merged in 1.4.0 (real measurements on this Mac; rendered picture checked) |

### D2. LiveCaptions-Translator parity (Apache-2.0; features only)

| Feature (upstream README) | Ours today | Branch / status |
| --- | --- | --- |
| Translation engines: Ollama, OpenAI-compatible, OpenRouter | none (local only) | merged in 1.4.0 via `feat/connector-templates` + `feat/providers` (tests green; not seen live) |
| Translation engines: Google, DeepL, Youdao, Baidu, MTranServer, LibreTranslate | none | merged in 1.4.0 (tests green; not seen live) |
| Overlay window: borderless, transparent, colours/size/opacity, sentences count, click-through | missing | merged in 1.4.0 (tests green; not seen live) |
| Always-on-top, pause/resume, one-click copy | partial (pill pins) | merged in 1.4.0 (tests green; not seen live) |
| History as CSV export | missing | merged in 1.4.0 (tests green; not seen live) |
| Log cards (recent lines as cards) | missing | merged in 1.4.0 (tests green; not seen live) |
| Windows Live Captions integration | built (1.3.9), unverified | needs a real Win11 PC |
| Light/dark auto theme | done | — |

### D3. Model speed charts (Settings › Models)

`feat/model-bench`: engine benchmark endpoint + persisted runs, island bar chart and sparkline with design tokens only. Planned, not started when this audit was written. Existing data to seed expectations (not shown to users): `docs/roadmap/caption-speed.md` tables (Qwen3-1.7B q4 en→id p50 599 ms, 16/20 meaning; whisper large-v3-turbo on Metal 1.7 s for 26 s audio).

---

## E. Known gaps and risks

| # | Gap / risk | Severity | Where |
| --- | --- | --- | --- |
| 1 | **Mac island has no captions, no meetings/minutes, no notes** — it is a pill with media, calendar, add-ons and the model library. The Mac DMG is not feature-equal to the Windows installer | high | section C |
| 2 | Windows installer from CI has **never been installed on Windows**; updater never exercised on a real install | high | A |
| 3 | Almost the whole island UI was never seen on screen (window excluded from capture); every "done" is compile + unit test | high | B1/B2 |
| 4 | `CHANGELOG.md` lacks a 1.3.13 entry and still has `## Unreleased — feat/notes-v2`; `HANDOFF.md` stale since Sept; `docs/handoff/pill-media-meeting.md` row 4.7 says "show original/font size not built" (they were, 1.3.8) and "Next step" says 1.3.11 not installed | medium | docs |
| 5 | No Apple Developer ID: Gatekeeper warning on first open; notarization steps documented only | medium | `island/docs/updates.md` |
| 6 | Intel Mac: universal binary built, **never run on an Intel Mac** | medium | |
| 7 | Mac engine bundled is CPU/Metal build; first-run model download has no offline fallback; engine orphaned if app is SIGKILLed (new app then reuses the stale engine) | low-medium | |
| 8 | HF pulls can sit at 0 bytes with no stall timeout (OPUS-MT) | medium | engine `models.rs` |
| 9 | `e2e:native` (REL-03) fails consistently; test pollution: some UI test writes engine `device.json` | medium | `HANDOFF.md` |
| 10 | Caption latency target 1.5 s unmeasured end to end (bench shows ≈ 5.2–5.7 s first text on bench clips) | high for the product promise | `caption-speed.md` |
| 11 | Python helper (`native/`) still in repo and docs while S5 says "Rust default, Python removed" | low | |
| 12 | Canvas boards and VPS worker reports live outside the repo (claude.ai / old VPS) | medium | B6 |
| 13 | Release-workflow first run took ~30 min with the Mac job queued; any failed job blocks publishing (by design) | low | |
| 14 | Third-party notices: new add-on files (ffmpeg LGPL source uploaded) — confirm `THIRD-PARTY-NOTICES.txt` mentions them | low | |

### Plan items not covered by D that the audit noticed missing from the app

- Mac: PC-audio captions, mic/room captions, Meeting tab, Minutes page, Paste transcript, Windows-style Live page.
- TIDE-020/021/022 credits, plans, account/wallet server (design exists, no server).
- Add-ins hooks "declared, not fired in v0" (S8); add-in strings English only.
- Translation context (idea D) and per-sentence translation (idea C).
- Search across meetings (picker steps one by one; engine keeps 50 meetings, older fall off).

---

## F. Definition of done — every release

Tick all before calling a release finished; `tracker_check.py` covers the starred rows.

- [ ] Version bumped in `island/Cargo.toml` (and `Cargo.lock`); `CHANGELOG.md` entry written; `HANDOFF.md` / this file updated.
- [ ] `cargo test -p poni-core --release`, `cargo test -p poni --release` (island/) and `cargo test` (engine-rs) green on the Mac; Windows `cargo test` green on the laptop.
- [ ] `npm test` green (or each failure explained); `npm run release:gate` CLEAR for extension changes.
- [ ] Tag `v<version>` pushed; Release workflow: `windows`, `mac`, `publish` all green.
- [ ] ★ latest release tag == `island/Cargo.toml` version.
- [ ] ★ `latest.json` is an asset, names the same version, signature verifies with a key in `update-keys.txt`.
- [ ] ★ Setup and DMG exist; sizes and sha256 match the payload; add-on pre-releases still resolve and are not "latest".
- [ ] Mac: DMG downloaded from GitHub, `codesign --verify`, opened (Open Anyway), engine starts, `/models` answers; installed to `/Applications` on the build Mac.
- [ ] Mac: update-in-place test (`island/tools/mac-update-test.sh`) passes on the built app.
- [ ] Windows: Setup installed on a Windows PC, app starts, engine starts, Models tab lists models; silent update from the previous release works.
- [ ] Anything new in the UI looked at on a real screen (or a `--render` picture checked) and noted in this file.
- [ ] Rollback plan: previous release stays a normal release; "mark previous as latest" documented in `island/docs/updates.md`.

## G. How to keep this file true

1. After every merge to `main`: update section A (releases) and the affected C/D rows in the same PR.
2. After every release: run `python3 island/tools/tracker_check.py --deep`, paste the RESULT line under A.
3. Never mark a row "done" without a commit, test name or screenshot path in the evidence column.
