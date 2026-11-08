# Handoff: yravgSubMeetly next

Roadmap: `docs/roadmap/submeetly-next.md`. References: Oyenza Studio clone at
`E:\orca\tmp\claude\e82400107c6fe069\f12395e0-5a7c-49e8-9d16-f0ae07040ddf\scratchpad\ref\oyenza-studio`
(re-clone from GitHub if gone), Threadbear on GitHub (mikecann/threadbear).

Updated 2026-11-08 by the lead session.

| Step | State | Evidence |
|---|---|---|
| S1 rename | done on branch, not merged | `yravg/sm-rename` a597757 (38 files). npm build ok; npm test 235 pass / 54 fail, all env (python3 absent: 53, run.sh exec bit: 1), same on HEAD per worker. Open: overlay label "ySub", reskin names "Yraverage Klasik/Modern", store PNGs still old wordmark, Swift not built here |
| S2 goldens | done on branch, not merged | `yravg/sm-engine` 0458bf2: 79 goldens from native/server.py (ML imports stubbed), `scripts/gen-engine-golden.mjs` |
| S3 non-ML routes | done on branch, not merged | `yravg/sm-engine` 75323f1: engine-rs/engine, 79/79 goldens 0 mismatch, 11 unit + 6 contract tests; fmt + clippy -D warnings clean (worker); lead re-ran cargo test: all pass. Not ported: GET /models, DELETE /models/cache, POST /shutdown (404 in Rust). ML routes 501. |
| S4 ASR/translate | open | owner chose candle 2026-11-08; needs disk space to build |
| S5 switch | open | |
| S6 island fork | in progress | worker `island` |
| S7 island pages | open | |
| S8 add-ins | open | |
| S9 threadbear spec | done on branch, not merged | `yravg/sm-threadbear` db2eb95, docs/roadmap/threadbear-mapping.md (390 lines, first 5 ordered with acceptance) |
| S10 canvas (all boards) | done, awaiting owner sign-off | `docs/design/submeetly-canvas/submeetly-canvas.html` (build.mjs), 12 boards / 30 stories, lint 1/1 + per-board check, render 0 errors 0 overflow. Owner chose Before+After and reference strips. Built by lead (canvas-to-app-nohtml), not a worker. Also on Claude Design for comments: https://claude.ai/artifact/Un8sDJNJmo7Fu2yivL6Qxh (15 artboards; regenerate with `node build.mjs --dc <root>` after `heights.json`, images = uploaded assets in `blobs.json`). |
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

Next: collect worker results, update this table, ask owner the S4/S6 decisions.
