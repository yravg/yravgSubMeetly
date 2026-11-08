# yravgSubMeetly next: Rust engine, top island, add-ins, threads, de-slop

Owner request 2026-11-08. Handoff: `docs/handoff/submeetly-next.md`.

## Goal

1. Brand shown to users becomes **yravgSubMeetly** (owner choice).
2. The local engine (today `native/server.py`, Python) runs in Rust with the same HTTP and
   native-messaging contract, then Python is removed.
3. A pill that hangs from the top of the screen (Windows first, then Mac), using the UI and
   animation of Oyenza Studio's island (MIT code, https://github.com/lucacadalora/oyenza-studio),
   painted with our design tokens. Control the app from the top of the screen; the existing
   main pages stay.
4. Add-ins in the island, built on Oyenza's add-on system, but only add-ins that belong to a
   meeting / subtitle app.
5. Threadbear ideas (https://github.com/mikecann/threadbear, MIT) brought to meetings:
   decisions as buttons, options side by side, inbox zero for actions, a librarian that files
   meetings into projects, patches as add-ins.
6. Minutes register, Side panel and app.html lab shell redesigned to remove AI-made look,
   keeping `src/tokens.css` and the surface themes.

## Constraints

- Oyenza name, logo, Oyen character, `docs/brand`, `installer/art`, app icon: NOT MIT. Never copy.
  Keep its LICENSE and THIRD-PARTY-NOTICES with any copied code.
- Account-bound Oyenza pages (Oyenza money, Health, Stocks, Today calendar/Gmail, AI usage) are dropped.
- Internal ids stay (`ysm*` keys, `~/.yraveragesubmin`, native host name, bundle id) — display-only
  rename, no migration (Oyenza used the same rule).
- House rule (yravgbuilder) says no UI in Rust. Exception requested by owner for the island only:
  it is Oyenza's native Win32/Direct2D + AppKit renderer, reused, not rewritten. Main pages stay web.
- Python engine stays as oracle until the Rust engine is golden-equal on every route.

## Steps

| # | Step | Acceptance |
|---|---|---|
| S1 | Display rename to yravgSubMeetly | No user-visible "yraverageSubMin"; `npm test` green; rename-migration tests still pass |
| S2 | Engine contract goldens | `engine-rs/golden/*.json` captured from Python for every non-ML route |
| S3 | engine-rs non-ML routes | Rust server passes goldens 0 mismatch: /health, /engine/*, /notes*, /ui-prefs, /jobs, origin check, state dir, native messaging framing |
| S4 | engine-rs ASR + translate | Library decision (candle pure Rust vs whisper-rs + cmake); /transcribe, /transcribe_file(_job), /translate, /draft within tolerance of Python on bench set |
| S5 | Switch default to Rust, delete Python | Owner sign-off; installers point to Rust binary; e2e + e2e:native PASS |
| S6 | Island fork | `island/` builds on Windows, pill theme default, our tokens as a Look, Oyenza brand/account pages removed, runs |
| S7 | Island SubMeetly pages | Live (subtitle line in collapsed pill + start/stop), Minutes (register summary, decisions/actions), Record; talks to engine over loopback |
| S8 | Add-ins | Add-on system kept; meeting add-ins (list fixed after S9 spec) |
| S9 | Threadbear mapping spec | `docs/roadmap/threadbear-mapping.md`: each Threadbear feature → meeting feature, kept/dropped with reason |
| S10 | De-slop canvas | Scan + critique of the 3 pages, Before/After canvas, owner sign-off |
| S12 | Windows installer + signed updates with pop-up (owner 2026-11-08, like Oyenza Studio) | Inno Setup per-user Setup installs island + Rust engine + native host; app reads a signed latest.json from the release repo and shows an update pop-up; our own signing key (Oyenza keys removed) |
| S11 | De-slop build | Per board, slop scan 0 errors, viewed at 1440/1024/390, dark |

Order: S1, S2, S6, S9, S10 run in parallel. S3 after S2. S4 after library decision. S7 after S3+S6.
S8 after S9. S11 after S10 sign-off. S12 after S6 (needs the engine binary; ships Python until S5). S5 last.

## PRD rows

Status words: `missing`, `partial`, `done`. The handoff holds the evidence for each row.

| ID | P | Row | Acceptance (observable) | Status |
|---|---|---|---|---|
| BRAND-001 | P0 | Display name yravgSubMeetly everywhere users look | No user-visible "yraverageSubMin" in extension, helper, macOS app, guides, store listing | done (merged 35f47ce; all three store PNGs recaptured 2026-11-08 by the lead, 03 now the Helper tab in English; open owner gate: overlay label "ySub" and theme names) |
| ENG-001 | P0 | Rust engine serves every non-ML route like Python | 79 goldens, 0 mismatches, `npm run test:engine-rs` | done (merged 6da5720) |
| ENG-002 | P0 | Rust engine speech-to-text (candle Whisper) | WER <= 0.10 vs Python faster-whisper per clip on 5 CC0 clips; segment starts within 0.5 s; RTF reported | done (merge a595096: WER <= 0.021, starts within 0.06 s on 5 clips; RTF rust 0.19-0.28, python 0.05-0.16 on CPU) |
| ENG-003 | P1 | Rust engine translation (candle Qwen2.5) | Same prompts as Python; non-empty, target script, no prompt leakage on fixed set | done, part open (2026-11-08 lead: `qwen_translation_properties` pass with Qwen2.5-0.5B-Instruct on CPU, 0.4-0.8 s per line, en->zh, en->ja, ja->en, de->en, refine en->id. Open: 0.5B meaning errors the properties do not catch: en->ja turned "agreed to ship" into past "shipped", refine en->id turned Friday into Sabtu (Saturday); no Python side-by-side on the same lines) |
| ENG-004 | P0 | Rust is the default engine, Python removed | Owner sign-off; installers start Rust binary; e2e + e2e:native pass | missing (S5, owner gate) |
| ISL-001 | P0 | Island at top of screen (Windows) | `island/` builds and runs, pill theme default, our tokens, no Oyenza brand/account pages | done (S6 fe8ca90; paper look default 17c98db; 343 core tests pass) |
| ISL-002 | P0 | Island pages: Live, Meeting, Record | Live line + start/stop in pill; decisions Accept; talks to engine over loopback | done, part open (merge 17c98db pages; island3 merge 2026-11-08: GET /live caption stream in both engines, golden 102, shown in pill and Live; Engine CPU + RTF. Open: capture start/stop lives only in the Chrome extension, island Hold/Unfollow say so; browser/WASM mode does not feed /live) |
| ISL-003 | P1 | Every Oyenza pill/island feature mapped and drawn | `docs/design/submeetly-canvas/inventory-island.md` each line on a board or "not ported" with reason; boards interactive, animations checked frame by frame | done on canvas v10 (inventory files, interactive boards) |
| ADD-001 | P1 | Meeting add-ins in the island | Add-on system kept; list fixed by owner (proposed: Agenda timer, Quick capture on by default) | partial (island add-ins Agenda timer, Talk time, Engine monitor in 17c98db; side panel Add-in API v0 + Settings › Add-ins with Flag decision and Actions in a7a3078; final list still owner) |
| THB-001 | P1 | Threadbear map to meetings | `docs/roadmap/threadbear-mapping.md`, first five steps with acceptance | done (merged 92f2ef5) |
| THB-002 | P1 | Threadbear boards show the full three-pane layout with working interactions | `inventory-threadbear-boards.md`; open thread, reply, done, archive, inbox zero clickable on T-boards | done on canvas v10; built in Minutes (T01 Inbox, T02 Projects, T04 Highlights) 2026-11-08, QA 19/19 |
| UI-001 | P0 | Canvas of every redesigned screen, light theme, Before/After, reference strips | Claude Design canvas Un8sDJNJmo7Fu2yivL6Qxh; lint + per-board check pass; owner comments resolved | partial (v11 published; owner comments answered, sign-off open) |
| UI-002 | P0 | No feature lost in redesign of side panel, lab shell, draft options | `inventory-D02-D03-T03.md`: every control of today's code lands on a board | done on canvas v10 (inventory files, interactive boards) |
| UI-003 | P1 | De-slop build of Minutes register, side panel, app.html | Per board: slop scan 0 errors, viewed at 1440/1024/390, built same as drawn | done (D02 + D03 bb86286; D01 Minutes + T03 draft options merged on main 2026-11-08; viewed 1440/1024/390; QA 15/15; lead fixes 2026-11-08: Minutes toolbar wraps at 390 px, Helper card follows the UI language, QA 19/19) |
| ISL-004 | P1 | Island opens on hover after 0.22 s by default, as in Oyenza; 1.5 s selectable | Default dwell 0.22 s in island settings and boards; option kept | done (canvas v12; island ff6a90b: 0.22 / 1.5 / 3 s / Off) |
| UI-004 | P2 | Translation colour selectable (indigo default, 4-5 swatches) | Setting in island Settings and side panel Settings; every swatch >= 4.5:1 on its card | done (side panel bb86286, island ff6a90b; 5 swatches, contrast 5.44-10.00:1 on canvas) |
| UI-005 | P1 | Side panel shows one tab row by default; a toggle brings back the second row | Default one row; "Tab rows: One / Two" toggle; nothing removed | done (bb86286; Settings > General > Tab rows, viewed in lab) |
| ISL-005 | P2 | Island carries only meeting features | Prayer module, `site/places` data (6.8 MB), sholat/ja/downloader add-ons and Gmail/Calendar icons removed from `island/` | done (dc9e181 in 17c98db; site/places removed) |
| REL-001 | P1 | Windows installer, like Oyenza Studio | Per-user Setup (no admin) installs island exe, engine binary, native messaging host, Start menu, optional start at sign-in; uninstaller keeps notes; our own art | done, part open (S12 merged cf8f04a: Setup 9.2 MB builds; inspected, not run on this machine; [Code] page untested) |
| REL-002 | P1 | Signed auto-update with an "update available" pop-up | App checks latest.json in the release repo, believes it only with our key, shows Install / Later / notes; download size + SHA-256 checked; silent install and relaunch; Oyenza keys removed from update-keys.txt | partial (S12 merged cf8f04a: own key, local signed feed smoke showed the pop-up; Install sheet not screenshotted; no real release yet: owner must make the repo public, add UPDATE_FEED_KEY secret and a spare key) |

## Decisions (owner, 2026-11-08)

- S4: **candle** (pure Rust) for ASR and translation. whisper-rs rejected (needs cmake + libclang).
- S6: **"UI in Rust" exception accepted for the island only.** Main pages stay web.
- Canvas: always a Claude Design canvas, light theme only, interactive boards (canvas-to-app-html),
  colorful icon tiles like Solvarium, uiux.yraveragehub catalogue pieces, no feature removed for a look.
- Canvas UI design work runs on Sonnet workers (owner, 2026-11-08).
- Every change also updates these PRD rows, this roadmap when scope moves, and the handoff (owner, 2026-11-08).
- Hover delay: same as Oyenza (0.22 s) by default (owner, 2026-11-08).
- Translation colour: keep indigo `--ai`, with an option for users to change it (owner, 2026-11-08).
- Merge `yravg/sm-island` into main: yes (owner, 2026-11-08; merged fe8ca90).
- Side panel tab rows: keep both, simplified to one by default, with a toggle (owner, 2026-11-08).
- Workers: Sonnet 5.5 first, then Cursor, Antigravity Gemini, OpenCode Go (owner, 2026-11-08).

## Open questions (owner)

- S8: final add-in list after S9.
- S12: which GitHub repo hosts releases (default: origin yraveragework/yraveragesub; must be public for the app to download), and who keeps the offline backup signing key.
