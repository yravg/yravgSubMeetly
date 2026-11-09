# PRD: Tide app shell (app.html in the Oyenza layout)

Owner request 2026-11-09: "the UI is really confusing … I need it to be like Oyenza", "Use Tide from
github.com/yravg/yravgBuds as our mascot and design token". Handoff: `docs/handoff/tide-shell.md`.
Design canvas: `docs/design/tide-shell-canvas/` (Claude Design canvas link in the handoff).

## Problem

`http://127.0.0.1:8799/app.html` shows three things at once with equal weight: lab rails (Lab status,
Overlay log, CC0 samples, Helper mock), a lab bar (width buttons, Minutes register, test pages,
four lab tabs, two warning cards) and the real product (the side panel, 480 px wide, with its own
tab bar of Captions / Notes / History / Helper / Settings). There is no home, no single place that
says "what is happening today", and lab tools look like product. A first-time user cannot tell
where to start captions.

## Goal

One app window that reads like Oyenza (oyenza.app): left sidebar with sections, a greeting hero
with one ask bar and quick chips, a key number with a breakdown, a right rail of "do this next"
cards, one black primary pill. Painted with the yravg brand tokens, with **Tide** (white sea otter,
green paws, lime shell) as the mascot. Lab tools stay, but move into a Developer area that is off
by default in the extension and on in the lab.

## Owner decisions

| Date | Decision | Source |
|---|---|---|
| 2026-11-09 | Layout follows Oyenza's web app (sidebar, hero, ask bar, chips, KPI, right rail, black pill) | owner message + screenshot |
| 2026-11-09 | Mascot is Tide; colours, type and motion come from `yravgBuds/brand/tokens.css` | owner message |
| 2026-11-09 | Canvas: Before and After, Oyenza reference strip, Claude Design only | AskUserQuestion |
| 2026-11-09 | Ship the shell as an extension page (`app.html` in `dist/`), opened from the side panel "Open app"; the lab keeps its Developer area | owner: "do all your recommendation" |
| 2026-11-09 | Primary action = black ink pill (one per screen); brand green for active nav, Tide and success | same |
| 2026-11-09 | Ask Tide answers from the register heuristics first; uses the local Qwen model through the helper when it runs | same |
| 2026-11-09 | Ask Tide follows Solvarium's chat (E:/devSchedule/Solvarium, solvarium-chat) with OpenRouter or a local model; credits the same as Solvarium; monthly plans shaped like oyenza.com (Free / Pro $4.99 / Agent $9.99) | owner message + pricing screenshot |
| 2026-11-09 | Local model stays the default; OpenRouter is opt-in and labelled (lead proposal, keeps the on-device promise) | lead, owner may overrule |
| 2026-11-09 | yravgBuds docs say Tide covers SubMeetly too (yravgBuds branch `docs/tide-submeetly` 34bf106, not pushed) | same |

## Constraints

- Oyenza is a reference only. Its name, Oyen cat, illustration, copy and assets are never copied;
  reference frames stay in `docs/design/tide-shell-canvas/ref/` (gitignored, private canvas only).
- yravgBuds `docs/brand-architecture.md` assigns Tide to yravg Route. The owner now uses Tide for
  SubMeetly too; the brand kit text should be updated in yravgBuds (owner's repo, not changed here).
- No control is removed (house rule). Every control on today's app.html and side panel lands on a
  board; lab controls land in the Developer area.
- Brand rules from yravgBuds: brand-green `#22C55E` is never text on light grounds (2.3:1); readable
  green is green-ink `#0E7A47` (dark `#4ADE80`); one mascot per screen; mascot never talks; every UI
  string in English and Indonesian.
- Real data only: numbers on the home come from the register, history and helper. Sample data is
  labelled sample.
- The side panel (480 px) keeps working; it gets the same tokens later (TIDE-012), not a new layout.

## PRD rows

Status words: `missing`, `partial`, `done`. Today everything is `missing` unless noted.

| ID | P | Row | Acceptance (observable) | Status |
|---|---|---|---|---|
| TIDE-001 | P0 | Tide tokens layer | `src/theme-tide.css` maps yravg brand tokens (green, lime, emerald, ink, mint wash, line, green-ink, Fredoka display, Plus Jakarta Sans UI, ease-out, spring) onto the app's token names, light and dark; contrast of every text pair ≥ 4.5:1 | missing |
| TIDE-002 | P0 | App shell: sidebar | Brand row (Tide mark + yravgSubMeetly + notifications), meeting-series switcher, "Ask Tide…" field, sections **Meetings** (Today, Live captions, Minutes, History, Files) and **Features** (Add-ins, Glossary, Island, Performance, All features N), black "Start captions" pill with shortcut, footer with user and helper status dot + "Last synced" | missing |
| TIDE-003 | P0 | Today home: hero | Greeting by time of day and name, date line with hide-numbers eye, key number (minutes captured today) with sub line (meetings), Ask Tide bar with send button, 4 chips (Recap last meeting, What did I promise?, Open actions, Translate a file), Tide pose on the hero | missing |
| TIDE-004 | P0 | Today home: this week | "Actions this week" number with change vs last week, "Where it went" bars per item type (decision, action, risk, question) with owner filter, over-due line in red | partial (register counts exist in minutes.html; no week view) |
| TIDE-005 | P0 | Today home: right rail | Card "Yesterday's minutes are still open" + black "Issue minutes" button; card "Today · N meetings" with rows (time, title, series, duration, status); card "Helper" (engine, device, model, live dot) | partial (helper status card exists in side panel) |
| TIDE-006 | P0 | Live captions page | Source (tab / file / mic), Transcribe / + Translate, From / To, engine line with Change, Start / End, live preview (spoken + translation), "Captions show on: Page overlay / Island / Both" | partial (all controls exist in side panel Captions tab) |
| TIDE-007 | P1 | Ask Tide | Dialog 640 px: user bubble (black pill), step rows ("Looked at …", chevron when >1), answer with key figure bold, cards: list card (meetings / items), bars card, action card with Cancel / Confirm (nothing written before Confirm), export card (Done · N rows · Open →). Answers come from the local register and helper `/notes/generate`; no cloud | missing |
| TIDE-008 | P0 | Minutes page in the shell | Register (summary, filters, rows, provenance) inside the shell; same controls as `minutes.html` | partial (minutes.html exists, own shell) |
| TIDE-009 | P1 | History and Files | History list with search; Files: drop a file, job progress, Cancel, export TXT / SRT / VTT | partial (side panel History, offline task) |
| TIDE-010 | P1 | All features | Grid of feature tiles (Recap email, Glossary, Due dates to calendar, Island, Performance, Library, Training, Export), each with on/off and "Open" | partial (add-ins merged 035e1f1, scattered) |
| TIDE-011 | P0 | Settings | Engine (Browser / Native Helper), device, model, captions surface, languages, theme, density, dock motion; helper install and troubleshooting | partial (side panel Settings + Helper tabs) |
| TIDE-012 | P2 | Side panel on Tide tokens | Same tabs, Tide tokens, Tide in empty states only | missing |
| TIDE-013 | P0 | Developer area | Lab status, overlay log, CC0 samples + Run sample, Helper mock (mode, latency, failNext, health, device, log), test pages list, guides, width buttons; shown in the lab, hidden in the extension unless Settings › Developer is on | partial (all exist on app.html, as rails) |
| TIDE-014 | P0 | States with Tide | Empty (Tide sleep), loading / thinking (Tide compass), welcome (Tide wave), done (Tide celebrate), error (no mascot, plain red callout), locked (needs the extension / needs the helper) | missing |
| TIDE-016 | P0 | Minutes detail page kept (`minutes.html`) in Tide | Owner 2026-11-09: keep the full register page, opened from A04 by "Open full register ↗". Every control kept; Tide light tokens; improvements: type tags as ink word + hue dot, overdue as red sub-line, Source status in sentence-case chips, sticky header, density Review / Reading / Compact, row hover Accept / Edit / Owner, empty state with Tide asleep | partial (page and every control exist in src/minutes.html) |
| TIDE-017 | P0 | Register summary compact band | One band ≤ 72 px (≈190 px today): count, one segmented bar with inline legend, five stats inline, Review button right; chevron opens the legend with percentages; ≤ 120 px at 1024 | partial (block and figures exist in src/minutes.html) |
| TIDE-018 | P0 | Ask Tide model engine (Solvarium pattern) | Port Solvarium `app/src/agent/models.js` (`chatRequest`, `readStream`, presets) and `buildGrounding` as a register-grounded system prompt ("You are Tide…" + MEETING, REGISTER, EARLIER IN THIS SERIES, APP FEATURES). Providers: Local (helper Qwen, default), Register-only (no model), OpenRouter (cloud). Streams SSE `{delta}`/`{done}`/`{error}` through the helper (`/ask`), last 6 turns of history, sessions in local storage. Writes only through an action card with Confirm (like Solvarium `propose_edits`) | missing |
| TIDE-019 | P0 | Cloud consent | OpenRouter is off until the user turns it on; each cloud answer is labelled "Cloud model · <name>"; the on-device provenance line changes to say text was sent; key stays in the helper (`%USERPROFILE%/.yravg/openrouter.key` for the owner's dev key), never in the extension or git | missing |
| TIDE-020 | P1 | Credits, same as solvarium-chat | Identical rules: 1 credit = Rp100; charge `ceil(openrouter usage.cost_usd × fx_idr_usd × (1 + margin) / 100)`, margin per model 0.20–0.40 (default 0.35, `config/margins.ts`), min 1 credit per model per turn; starter grant 50 credits, expires after 14 days; packs Rp25.000 = 250, Rp50.000 = 525, Rp100.000 = 1.100, Rp250.000 = 2.750; append-only ledger (hold, settle, release); at 0: Send disabled + "Out of credits" card, banner under 10. Local and Register-only answers cost 0 credits | missing (solvarium-chat has the tables and ledger; debit, FX and top-up are its open tickets T06–T08) |
| TIDE-021 | P1 | Monthly plans like Oyenza | Free $0 (unlimited local Ask Tide, register answers, starter credits), Pro $4.99 / month (monthly credit allowance for cloud answers, unlimited file transcription, shared register), Agent $9.99 / month (Pro + agent work: weekly recap emails, series reports, action follow-ups) — "Coming soon" buttons until payments exist | missing |
| TIDE-022 | P1 | Account + wallet server | Credits and plans need a server: reuse the solvarium-chat backend (Better Auth, `wallet`, `credit_ledger`, Xendit/Paddle webhooks) as one yravg wallet; the helper calls it with the user's session; no server = Local and Register-only only | missing (owner decision) |
| TIDE-015 | P1 | Responsive + dark | 1440, 1024 (sidebar collapses to icons), 390 (sidebar becomes a sheet, right rail moves under the hero); dark theme from tokens | missing |

## Steps

| # | Step | Acceptance |
|---|---|---|
| T1 | PRD (this file) | Owner reads it |
| T2 | Canvas | Claude Design canvas: cover, status, one board per row family, Before/After, Oyenza strip; lint 0 failures, render 0 errors, slop scan 0 errors |
| T3 | Owner review | Comments on the canvas answered |
| T4 | Tokens (TIDE-001) | `src/theme-tide.css`, contrast table, design-tokens test extended |
| T5 | Shell + Today (TIDE-002..005, 014) | Same as the board; `test/app-surfaces` extended; viewed 1440/1024/390 |
| T6 | Pages in the shell (TIDE-006, 008..011, 013) | Every control from the Before dump present (control-count test) |
| T7 | Ask Tide (TIDE-007) | Local answers only; write guard tested |
| T8 | Side panel tokens (TIDE-012), responsive + dark (TIDE-015) | Slop scan, contrast, views |

Order: T1, T2, T3 before any code. T4 first in build. T5 before T6. T7 after T6. T8 last.

## Open questions

| Question | Who | Recommendation |
|---|---|---|
| "Same 100% for credits": copy solvarium-chat's credit rules exactly (margin 0.35 over OpenRouter cost), or charge cloud answers at cost (margin 0)? | owner | Copy exactly (margin 0.35), as TIDE-020 says; solvarium-chat has no "100%" figure. |
| Pro monthly allowance: Oyenza gives 1,000 coins. At 1 credit = Rp100, 1,000 credits sell for Rp100.000 (~$6.3) and cost about $4.6 wholesale, against a $4.99 price. | owner | 400 credits / month on Pro, 1,000 on Agent; review after a month of real usage. |
| Server for credits and plans | owner | Share the solvarium-chat backend (one yravg wallet); until it ships its debit code, ship TIDE-018/019 with Local, Register-only and the owner's OpenRouter key only. |
| Rotate the OpenRouter key pasted in chat on 2026-11-09 | owner | Yes; the lead replaces `%USERPROFILE%/.yravg/openrouter.key`. |
