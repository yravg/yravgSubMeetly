# Handoff: Tide app shell

Roadmap / PRD: `docs/roadmap/tide-shell.md`. Canvas source: `docs/design/tide-shell-canvas/`
(generator `build.mjs`, Before shots `shots/`, Tide art `tide/`, Oyenza reference `ref/` gitignored).

Updated 2026-11-09 by the lead (Claude Opus 5.5); build rows by worker tide-build on the VPS.

## Status

| Step | State | Evidence |
|---|---|---|
| T1 PRD | done | docs/roadmap/tide-shell.md |
| T2 Canvas | done | Claude Design canvas https://claude.ai/artifact/QHTw3xufZj9nVZvpeJNBe6 (private, version 3): cover, status, story index, K01 + A01..A09. Worker `tide-canvas` (Sonnet) built it; lead fixed the `--dc` export (x-dc wrapper, v3 canvas.json, self-closed br). lint_boards 10/10 per board; render 0 errors / 0 broken images; slop scan 75 (B), 0 errors, 63 warnings (inline styles, pane `!important`); contrast table on the Status board (lowest text pair 4.88). Controls: 187 from today's pages, all assigned to a board, 110 drawn inside a frame |
| T3 Owner review | done | owner comments resolved (canvas version 8, 2026-11-09); owner said "go build everything through VPS" |
| T4..T8 build | in progress (VPS; build 1-6 merged to main 2026-11-09, T8 still uncommitted on VPS) | worker `tide-build` (Claude Code in Orca tab `bd0f6219…`, env hostinger-vps-dev) in worktree `/home/dev/orca/workspaces/yraveragesub/burbot`, branch `burbot` from laptop main 1e0b913; brief and checkpoint in its `.checkpoints/`; preview http://100.108.253.30:33104/app.html (systemd `submeetly-dev-web`, Tailscale only); sync mode direct (`/home/user/dev/yravgSubMeetly/.yravgvps.json`): laptop pushes main to `laptop-main`, fetches `burbot` over SSH |
| Build 1 · TIDE-024 compact summary (A04d) | done | 77ebeaa. Band 121 → 49 px at 1440, 85 px at 1024, wraps at 390; chevron opens per-type counts + %; empty = 0 + "No items yet". `test/minutes-summary-band.test.mjs` 5/5; `npm test` 448 pass / 0 fail / 13 skip (Rust engine + macOS binaries, jsdom absent on VPS). Slop scan minutes.css/js unchanged vs HEAD (no new findings). New text pairs 4.71–15.12:1. Viewed 1440/1024/390, expanded, empty (dark page) |
| Build fix · lab-lib pkill | done | f603dbe. `npm run build` killed every `scripts/lab-server.py` on the machine, including the systemd preview; now only this checkout's own server |
| Build 2 · TIDE-023 Minutes window (A04c) | done | c0a5bd9. Side panel Notes tab "Open Minutes window ↗"; `src/lib/minutes-window.js`; unit 6/6; `npm test` 454 / 0 / 13. Real extension (Chrome for Testing + xvfb): popup 1280×800, 2nd click focuses, reopen at remembered 30,40 1100×760, label flips both ways. Lab: named `window.open`. Button text 5.31–10.20:1. Shell Minutes page gets the same button in build 4 |
| Build 3 · TIDE-001 Tide tokens (K01) | done | 7de87fa. `npm test` 457 pass, 2 load timeouts (load avg 138–174 on 4 cores; both files 16/16 alone). `src/theme-tide.css` scoped to `[data-reskin='tide']`; fonts Fredoka + Plus Jakarta Sans TTF with OFL; design-tokens 11/11 incl. 14-pair contrast table × light/dark (lowest 4.88 green-ink on mint, matches K01); slop 100 (A). Viewed swatch/type sheet light + dark, both fonts `loaded` |
| Build 4–6 · T5 shell + Today, T6 pages, T7 Ask Tide | done | 66c8a60 (one commit: changes interleaved in app.js/css/html). Tests: today 5 (mutation-checked), app-shell 11, app-controls 17 (all 789 controls from controls.json reachable), ask-tide 8, ask-tide-ui 8. `npm test` at T5+T6: 492 pass / 0 fail / 13 skip. `npm test` at T7 was killed by Claude Code for low machine memory (not a test failure); targeted T7 tests 27/27. Slop 99–100 (A), 0 errors; text pairs ≥ 4.71:1. Viewed 1440/1024/390, dark, sheet, welcome/empty/loading states, Minutes Classic+Modern (light/dark/empty), All features, Developer, Ask dialog (register, local stream, picker, consent, 390, dark), Plans |
| Build 7 · T8 side panel Tide reskin (TIDE-012) | done | 52f5fff (lead finished the worker's tree on 2026-11-10). `test/panel-test.html` now loads theme-tide.css like sidepanel.html (the test failed light/dark without it); empty-History test clears chrome-mock's demo session first. `sidepanel-tide` 7/7; VPS `npm test` 515 pass / 0 fail / 13 skip. Viewed 480/390 × light/dark × Captions/History/Settings, 0 page errors. Merged to main 673ad6a |
| Engine keeps `reskin: "tide"` | done | 42f89fd. `UI_RESKINS` + contract test (failed first). fmt, clippy -D warnings, contract 10/10 on the VPS. `tests/native_host.rs` dies by SIGTERM on the VPS with and without this change (Linux-only, pre-existing, not investigated); laptop C: was full so the Rust gate ran there |

Deviations for the lead to judge:
- Live captions, History, Files, Settings, Helper, Add-ins, Glossary, Island and Performance pages mount the existing side panel views (`sidepanel.html?view=…`) instead of new A02/A05/A07 layouts; every control is kept (control test) but those boards are not drawn as designed.
- Developer area (A08) mounts the existing lab page; in the extension it frames http://127.0.0.1:8799/app.html behind Settings › Developer.
- Modern register: the theme picker keeps its two choices (dark = Tide dark, "Coretax · paper" = Tide light); its labels still say Coretax. A04a improvements done: Tide colours, type tag as ink word + dot, empty state with Tide. Not done: sticky header, density control, row hover actions, sentence-case Source chips.
- Ask Tide: export card ("Done · N rows · Open →") not built (a page cannot open a downloaded file); helper `/ask` route does not exist yet in engine-rs, so Local shows "no Ask route" until it is added; OpenRouter model ids are guesses mapped in the helper.
- Side panel default reskin stays Yraverage; Tide is an option. Making Tide the default is a global change: owner/lead decision.
- A01 headline kept as "Items this week" (board), PRD says "Actions this week".

## Facts

- Before capture of app.html (1600x900): `docs/design/tide-shell-canvas/shots/app-before.png`.
- Tide art source: `E:/dev/yravgBuds` (`assets/mascot/tide/*.svg`, `assets/3d/tide/webp/*.webp`,
  `brand/tokens.css`), head 68f4292.
- Oyenza chat spec summary: `ref/oyenza-chat-spec.md` (from Drive capture pack R01).

## Open questions (owner)

See the PRD "Open questions" table.

## Known gaps

- Impeccable critique not run (no scores). Viewed by the lead: A01 only; by the worker: A01, A02, A03, A07, A09.
- A01 says "Items this week" (counts four item types), PRD says "Actions this week": owner to pick.
- A01: empty block under the "this week" column (P3).
- 78 of 187 kept controls appear only in the "Controls kept from today" chip strips, not drawn in a frame.
- Ask Tide reference strip has no Oyenza frame (Drive frames zip not pulled); it quotes the spec.

## Next step

Read owner comments on the canvas (`ArtifactComments`), fix in `build.mjs`, re-export with
`node build.mjs --dc <root>`, publish only changed boards. After sign-off: T4 tokens.
