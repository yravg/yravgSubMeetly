# Handoff: Tide app shell

Roadmap / PRD: `docs/roadmap/tide-shell.md`. Canvas source: `docs/design/tide-shell-canvas/`
(generator `build.mjs`, Before shots `shots/`, Tide art `tide/`, Oyenza reference `ref/` gitignored).

Updated 2026-11-09 by the lead (Claude Opus 5.5).

## Status

| Step | State | Evidence |
|---|---|---|
| T1 PRD | done | docs/roadmap/tide-shell.md |
| T2 Canvas | done | Claude Design canvas https://claude.ai/artifact/QHTw3xufZj9nVZvpeJNBe6 (private, version 3): cover, status, story index, K01 + A01..A09. Worker `tide-canvas` (Sonnet) built it; lead fixed the `--dc` export (x-dc wrapper, v3 canvas.json, self-closed br). lint_boards 10/10 per board; render 0 errors / 0 broken images; slop scan 75 (B), 0 errors, 63 warnings (inline styles, pane `!important`); contrast table on the Status board (lowest text pair 4.88). Controls: 187 from today's pages, all assigned to a board, 110 drawn inside a frame |
| T3 Owner review | open | owner comments on the canvas |
| T4..T8 build | open | waits for T3 |

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
