# Handoff: yravgSubMeetly next

Roadmap: `docs/roadmap/submeetly-next.md`. References: Oyenza Studio clone at
`E:\orca\tmp\claude\e82400107c6fe069\f12395e0-5a7c-49e8-9d16-f0ae07040ddf\scratchpad\ref\oyenza-studio`
(re-clone from GitHub if gone), Threadbear on GitHub (mikecann/threadbear).

Updated 2026-11-08 by the lead session.

| Step | State | Evidence |
|---|---|---|
PRD rows with acceptance: roadmap section "PRD rows" (BRAND, ENG, ISL, ADD, THB, UI).

| S1 rename | done, merged | merge 35f47ce (branch a597757). npm test on main after merge not run (node_modules nearly empty). Open: overlay label "ySub", reskin names "Yraverage Klasik/Modern", store PNGs still old wordmark, Swift not built here |
| S2 goldens | done, merged | merge 6da5720 (0458bf2): 79 goldens, `scripts/gen-engine-golden.mjs` |
| S3 non-ML routes | done, merged | merge 6da5720 (75323f1): 79/79 goldens 0 mismatch; GET /models, DELETE /models/cache, POST /shutdown not ported (go to S4). ML routes 501. |
| S4 ASR/translate | done, part open, merged a595096 | branch yravg/sm-s4 8272acf (Opus ctx_fa4448d709c1, then Sonnet s4fix ctx_00df3435961e). Lead verified on the merge: fmt clean, clippy -D warnings clean, cargo test --release all pass (16 lib, 6 contract, golden replay 0 mismatch), ignored `candle_whisper_base_matches_faster_whisper` pass: WER 0/0/0/0/0.021 on en-1..3, de-1, es-1, all segments matched, max start diff 0.06 s, RTF rust 0.19-0.28 vs python 0.05-0.16 (CPU); npm test 324: 300 pass, 4 fail (Windows baseline four), 20 skipped. /health ffmpeg=false + media_decoder=symphonia; extension no longer warns "no ffmpeg" for it. Open: Qwen translation test `qwen_translation_properties` never ran (Qwen2.5-0.5B download ~100 KB/s, stalled; partial cache in sm-s4 worktree .hf-cache); no CUDA build (no nvcc); Rust slower than faster-whisper on CPU |
| S5 switch | open | |
| S6 island fork | done, merged fe8ca90 (owner yes 2026-11-08) | `yravg/sm-island` e48c6a6 (Sonnet worker ctx_999d4e8149cd after two OpenCode workers stalled). Lead verified: `cargo build -p poni` ok (103 dead-code warnings), `cargo test -p poni-core` 429 pass. Pill runs on Windows (island/docs/pill-first-run.png, cropped by lead: the worker shot included a personal browser tab). Open: island still dark (owner wants light first), no SubMeetly pages (S7), mac-only code still shows "Oyenza" strings (menu, sign-in), crate names poni/poni-core kept |
| S7 island pages | done, part open, merged 17c98db | branch yravg/sm-island2 b642817 (Sonnet ctx_19304829a6b2). Lead verified: `cargo test -p poni-core` 343 + helper_smoke 1 pass, `cargo build -p poni` ok (99 warnings), looked at island/docs/s7-*.png (21 shots, 5 states). Open: Live follows the note transcript tail (no caption stream); Pause/Stop control the island, not capture; Talk time = items per owner; Engine shows no CPU/RTF; mac code still has "Oyenza" strings; pairdrop default server drop.oyenza.com; `cargo test -p poni` broken at baseline |
| S8 add-ins | open | |
| S9 threadbear spec | done, merged | merge 92f2ef5 (db2eb95), docs/roadmap/threadbear-mapping.md |
| S10b canvas rework (owner comments v4) | in progress | Sonnet agents, files under docs/design/submeetly-canvas: D02/D03/T03 (inventory-D02-D03-T03.md, icons/), I-boards (inventory-island.md), T-boards except T03 DONE and published v5 2026-11-08 (threads.mjs, inventory-threadbear-boards.md 37 rows/36 landed, T04 + T05 new, interactive, render 0 errors 0 overflow, slop threads.mjs 100 A; lint_boards not run, DC runtime clicks not verified; T01 threads resolved), island film DONE 2026-11-08 (stageshow gold dynamic-island, film.mjs --gate "rehearsal passed" at 900 and 390; shots/island-demo.gif 1.9 MB 16 s, poster png; source docs/design/island-demo/; uploaded as /_blob/af4958e4..., /_blob/19053ddc..., in blobs.json; not yet placed on a board). Checkpoints `.checkpoints/canvas-*.md`, `island-demo.md`. Open comment threads: D02, D03, T03, T01 x4, I01, I02. Lead publishes and resolves threads. |
| S10 canvas (all boards) | v4 published, owner comments open | `docs/design/submeetly-canvas/submeetly-canvas.html` (build.mjs), 12 boards / 30 stories, lint 1/1 + per-board check, render 0 errors 0 overflow. Owner chose Before+After and reference strips. Built by lead (canvas-to-app-nohtml), not a worker. Also on Claude Design for comments: https://claude.ai/artifact/Un8sDJNJmo7Fu2yivL6Qxh (15 artboards; regenerate with `node build.mjs --dc <root>` after `heights.json`, images = uploaded assets in `blobs.json`). |
| S11 de-slop build | open | |

Known: Rust 1.99.1 at `%USERPROFILE%\.cargo\bin` (not on Git Bash PATH). MSVC Build Tools 2022
present. cmake and clang absent.

Orca run `run_b338bcd50b3c`. Dispatches: rename `ctx_c28ae7fe715e`, engine `ctx_37ed8a92c04f`,
island `ctx_5e7a32b1b549`, threadbear (term_1c7494af…). Worktrees under
`C:\Users\Enrico D. Marlon\orca\workspaces\yraverageSubMeetly\sm-<name>`, branches `yravg/sm-<name>`.
Specs: scratchpad `specs/<name>.full.md`.
All four OpenCode workers stopped at "Access external directory" prompts; owner must click Allow.

**BLOCKED 2026-11-08: disks full** (C: 0 GB, E: 0.18 GB free). Island cargo fetch failed with
`There is not enough space on the disk. (os error 112)`. All five workers stopped by the lead
(`worker-stop`). Worktrees kept. Saved state: rename has 38 uncommitted edits (docs/README
rename in progress); island has the Oyenza copy uncommitted under `island/`; engine, threadbear,
deslop2 have no commits of their own yet. Worktrees branch from origin/main (`6e79f44`, 3 Meetily
commits ahead of local main) — not from local main.
Restart after space is freed: one worker at a time, same specs.

**Resumed 2026-11-08** after the owner freed space (C: 15 GB, E: 75 GB). Same worktrees, new
dispatches: rename `ctx_58332dbe4ec5`, engine `ctx_c74c33a354fe`, island `ctx_e8272833754e`,
threadbear `ctx_42c1df766ae2`. Each worktree holds `.ref/` (spec, roadmap, handoff; island also the
Oyenza clone) so workers need no outside folders. Cargo builds go to `E:\cargo-target\<worktree>`.
Worktrees `sm-deslop`, `sm-deslop2` are unused (the canvas replaced that task) and can be removed.
OpenCode `external_directory` permission still not set (owner must edit its config).

Merged 2026-11-08: rename, engine, threadbear into main (HEAD f901339); their worktrees removed.

Next: collect S4 and S6 worker reports and verify (cargo test, test:engine-rs, WER/RTF); collect
the four canvas agents, merge their build.mjs edits, run build + lint + render, publish changed
boards, resolve threads; commit docs/design/ (still untracked). Owner gates: S5, D02 tab rows,
add-in list, "ySub" label and theme names.

## Verification 2026-11-08 (lead)

- main after merge (f901339): `npm ci` ok, `npm run build` ok, `npm run test:engine-rs` ok (11 unit + 6 contract + golden replay 0 mismatches).
- `npm test`: 309 tests, 285 pass, 4 fail, 20 skipped, run with a `python3` shim (venv in scratchpad) and
  `PUPPETEER_EXECUTABLE_PATH` = Chrome for Testing 154 (Puppeteer could not download its pinned 152).
  The same 4 fail on the pre-merge commit 6e79f44, so they are not from the merge. All are Windows-only:
  CRLF default export on Windows (export-browser x2), no exec bit for native/run.sh (setup-docs),
  ~/.localtranssub migration test (rename-migration). Without the shim, 54 fail (python3 absent, no Chrome).
- Canvas: T01 clicks verified inside Claude Design (open thread, Done moves to Finished with Undo toast).
  D02 feature-map click verified there. Found and fixed: Before view was blank on D02, D03, T03
  (pane CSS lacked the `ba:before` rule; build.mjs paneCss) and DC export dropped notes/aside cards
  (lazy section regex). Before fix checked in Playwright on the offline page (all three visible).
  Not yet re-checked inside Claude Design: the canvas page stopped loading after v8 (service 503s,
  "content fetch failed in transit"); retry D02 Before there.
- Owner decisions applied on canvas v12-v13 (2026-11-08): hover 0.22 s default (1.5 s option, film keeps 1.5 s);
  translation colour setting with 5 swatches (indigo default; contrast 5.44-10.00:1) on I08 and D02;
  D02 one tab row by default with "Tab rows: One | Two". Verified inside Claude Design: I08 hover opens the
  island, Teal swatch recolours the sample line. Found and fixed: Story index artboard was empty since the
  section-split fix (last section cut at the first `</main>`); now `lastIndexOf`. Index re-check inside
  Claude Design not done (canvas page loading very slowly at the time); offline export holds the stories.

## Wave 2 (2026-11-08, owner: "keep on doing the work until all finish", /testsprite-test)

Canvas committed on main 3b07370. S4 Opus worker reported 598bae4: 101 goldens 0 mismatch, WER <= 0.071 on 5 clips,
but en-3 segment-start gate fails (2.0 s, boundary difference), Qwen not smoke-tested, /health ffmpeg=false, no CUDA build (no nvcc).
Five Sonnet Orca workers (specs in scratchpad specs/w-*.md, common rules w-common.md):

| Worker | Dispatch | Worktree / branch | PRD rows |
|---|---|---|---|
| s4fix | ctx_00df3435961e | sm-s4 / yravg/sm-s4 | ENG-002, ENG-003 |
| qa (TestSprite-style, local Playwright) | ctx_fe025b27d994 | sm-qa / yravg/sm-qa | qa/ cases for all surfaces |
| island2 | ctx_19304829a6b2 | sm-island2 / yravg/sm-island2 | ISL-002, ISL-004, ISL-005, light look |
| sidepanel | ctx_ad01f11ef081 | sm-sidepanel / yravg/sm-sidepanel | UI-003 (D02, D03), UI-004, UI-005 |
| minutes | ctx_d660a26755a6 | sm-minutes / yravg/sm-minutes | UI-003 (D01), THB T03 |

Next wave after these merge: T01/T02/T04 in Minutes (after minutes), T05 + S8 add-ins (after island2 + sidepanel),
then qa re-run on main. S5 (Rust default, delete Python) stays an owner gate.
- qa merged (2026-11-08): `yravg/sm-qa` 0871ead + lead run; `npm run qa` re-run by the lead = 14 pass, 1 fail
  (TC010: floating dock at src/minutes.css:879 covers #d-save at 1280x800, a real bug; sent to the minutes worker).
  Needs python3 on PATH (QA_PYTHON), `npm run build` first, PUPPETEER_EXECUTABLE_PATH; cargo for TC014-015.
- sidepanel merged (2026-11-08) bb86286 (branch 116733e + lead fix 023f16c: lab shell said "yraverageSubMeetly", now yravgSubMeetly).
  Lead checks: `npm run build` ok; `npm test` 323 tests, 299 pass, 4 fail (same Windows-only four as baseline), 20 skipped;
  app.html viewed at 1440/1024/390 (overflow 0, no page errors); Settings > Tab rows Two brings back the Captions/Notes row;
  five translation swatches present. QA specs TC001/004/005/008 were stale against board D02 (3 Captions cards, export in
  History, engine on Settings > Engine) and were updated, not the product. TC005 now clicks the visible label.
  `npm run qa` after merge: run-20261108-145858 (before spec update) 10 pass 5 fail; run-20261108-151018 14 pass, 1 fail (TC010, minutes worker).
- island2 merged (2026-11-08) 17c98db: see S7 row.
- s4 merged (2026-11-08) a595096: see S4 row. Worker stopped. To close ENG-003 run (needs a faster network): `HF_HOME=engine-rs/.hf-cache TRANSLATE_TEST_MODEL=Qwen/Qwen2.5-0.5B-Instruct cargo test --release --manifest-path engine-rs/Cargo.toml --test ml_golden qwen_translation -- --ignored --nocapture`.
- Still running: minutes (ctx_d660a26755a6, also fixes TC010).
