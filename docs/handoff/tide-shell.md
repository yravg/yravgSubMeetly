# Handoff: Tide app shell

Roadmap / PRD: `docs/roadmap/tide-shell.md`. Canvas source: `docs/design/tide-shell-canvas/`
(generator `build.mjs`, Before shots `shots/`, Tide art `tide/`, Oyenza reference `ref/` gitignored).

Updated 2026-11-09 by the lead (Claude Opus 5.5); build rows by worker tide-build on the VPS.

## Status

| Step | State | Evidence |
|---|---|---|
| T1 PRD | done | docs/roadmap/tide-shell.md |
| T2 Canvas | done | Claude Design canvas https://claude.ai/artifact/QHTw3xufZj9nVZvpeJNBe6 (private, version 3): cover, status, story index, K01 + A01..A09. Worker `tide-canvas` (Sonnet) built it; lead fixed the `--dc` export (x-dc wrapper, v3 canvas.json, self-closed br). lint_boards 10/10 per board; render 0 errors / 0 broken images; slop scan 75 (B), 0 errors, 63 warnings (inline styles, pane `!important`); contrast table on the Status board (lowest text pair 4.88). Controls: 187 from today's pages, all assigned to a board, 110 drawn inside a frame |
| T3 Owner review | open | owner comments on the canvas |
| Build 1 · TIDE-024 compact summary (A04d) | done | 77ebeaa. Band 121 → 49 px at 1440, 85 px at 1024, wraps at 390; chevron opens per-type counts + %; empty = 0 + "No items yet". `test/minutes-summary-band.test.mjs` 5/5; `npm test` 448 pass / 0 fail / 13 skip (Rust engine + macOS binaries, jsdom absent on VPS). Slop scan minutes.css/js unchanged vs HEAD (no new findings). New text pairs 4.71–15.12:1. Viewed 1440/1024/390, expanded, empty (dark page) |
| Build fix · lab-lib pkill | done | f603dbe. `npm run build` killed every `scripts/lab-server.py` on the machine, including the systemd preview; now only this checkout's own server |
| Build 2 · TIDE-023 Minutes window (A04c) | done | c0a5bd9. Side panel Notes tab "Open Minutes window ↗"; `src/lib/minutes-window.js`; unit 6/6; `npm test` 454 / 0 / 13. Real extension (Chrome for Testing + xvfb): popup 1280×800, 2nd click focuses, reopen at remembered 30,40 1100×760, label flips both ways. Lab: named `window.open`. Button text 5.31–10.20:1. Shell Minutes page gets the same button in build 4 |
| Build 3 · TIDE-001 Tide tokens (K01) | done | 7de87fa. `npm test` 457 pass, 2 load timeouts (load avg 138–174 on 4 cores; both files 16/16 alone). `src/theme-tide.css` scoped to `[data-reskin='tide']`; fonts Fredoka + Plus Jakarta Sans TTF with OFL; design-tokens 11/11 incl. 14-pair contrast table × light/dark (lowest 4.88 green-ink on mint, matches K01); slop 100 (A). Viewed swatch/type sheet light + dark, both fonts `loaded` |
| Build 4..7 (T5..T8) | open | in progress by worker tide-build |

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
