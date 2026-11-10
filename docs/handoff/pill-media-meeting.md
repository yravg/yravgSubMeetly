# Handoff: Media, Meeting and quick caption settings on the pill

Roadmap / PRD: `docs/roadmap/pill-media-meeting.md` (PMM-001 to PMM-018).
Canvas generator: `docs/design/pill-media-meeting-canvas/`.
Claude Design canvas: https://claude.ai/artifact/TT3DHVZ8QvKkvidzuCPhTo (private, version 5: cover, index, P01-P07)

## Status

| Step | State | Evidence |
| --- | --- | --- |
| 0. Caption settings apply to running captions (pre-work) | done | island 1.2.9, commit 6ea3ea3, installed on the laptop |
| 1. PRD | done | `docs/roadmap/pill-media-meeting.md` |
| 2. Canvas (boards P01-P07) | done | worker `pmm-canvas` (Sonnet) + lead fixes; build: 7 boards, 0 anatomy problems, 29 new controls, 18/18 PRD rows placed; render 1640: 0 errors, 0 broken images, scrollWidth 1640; lint_boards 7/7; slop 73 (C), 0 errors, 27 warnings (11px mono labels, `!important` in Before/After panes, inline padding); contrast lowest checked pair 4.99 (`#F2745A` on `#2b2b2e`). Regenerate: `node build.mjs` (static) / `node build.mjs --dc <root>`; render needs `PUPPETEER_EXECUTABLE_PATH` = Chrome for Testing 154 |
| 3. Owner answers Q1-Q3 | done | 2026-11-10: all defaults accepted; Q1 extended -> PMM-017/018 |
| 3b. Owner sign-off on canvas | open | owner |
| 4. Build PMM-001 .. PMM-018 | open | blocked on canvas sign-off (3b) |

## Decisions

- Canvas: Before and After where a real Before exists (owner screenshots of the Music page and Advanced settings; the island window is left out of screen capture, so other Before frames are drawn from today's code and labelled so). No reference strips (no public Teams Facilitator frames). Claude Design only. Taken from the owner's earlier canvas answers (Before+After, Design only) and the "no check-ins" rule.

## Known gaps in the canvas

- P03-P06 Before panes are drawn from code (the island window is excluded from screen capture); P01, P02, P07 use owner screenshots.
- Tab row with Meeting active is ~9 DIP wider than 620; P01 shows it with Shelf hidden (decide at build: icon-only Meeting tab or narrower gaps).
- Proposals, not code facts: pop-up width cap 372 -> 450, Meeting page 428 tall.
- Older caption lines use `--faint` (navy at 50%), same as today's Live "previous line"; about 3.4:1 on white, below 4.5:1. Revisit at build.

## Next step

Owner reviews the canvas (comments on boards). Then build in the PRD order, starting with PMM-001 (rename) and PMM-004/017 (classifier + user list).
