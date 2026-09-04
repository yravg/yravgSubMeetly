# Minutes Register v2 — status

Branch: `feat/notes-v2` (off `release/1.1.1`). Design doc: `docs/NOTES-V2-SPEC.md`.
Cursor context rule: `.cursor/rules/notes-v2-register.mdc` (auto-attaches when
you open any `notes-*`/`minutes.*` file).

This file is the "what's actually done vs. what's still a stub" tracker —
update it as part of the same commit whenever you finish or start a chunk of
work, so anyone opening this repo cold (Cursor, Claude Code, future-you) can
tell in 30 seconds where things stand without reading the whole spec.

## Done — Phase 2.0 (schema + register UI)

- **Data layer** (`src/lib/notes-schema.js`, `notes-migrate.js`,
  `notes-store.js`, `notes-actions.js`, `notes-i18n.js`) — the v2 typed
  register: `decision | action | question | risk | metric | info` items,
  multilingual text, review state, provenance, carry-forward with age
  preservation, issue/freeze/amend. v1 → v2 migration is automatic and
  idempotent on read. 17 tests, `node --test test/notes-v2.test.mjs`.
- **Export** (`src/lib/notes-export.js`) — Markdown and CSV, v2-native. The
  old v1 `serializeNote`/`assertMeetingNote` API is gone (nothing calls it
  since `notes-panel.js` was rewired below).
- **Sample data** (`src/lib/notes-fixture.js`) — a two-meeting series
  (W35 → W36) built *through* `notes-actions.js` (not hand-written objects),
  so loading it exercises the same carry-forward path real usage does.
  Includes the "Ben and Coding" → "bending and coating" ASR-mishearing item
  that's the running example for why provenance matters (see spec §A3).
- **Minutes Register workspace** (`src/minutes.html` + `.css` + `.js`) — the
  full-tab surface. Register / By topic / Minutes (document) / Carry-forward
  / Series views; search, type-filter chips, mine-only, dual-text toggle,
  EN/ID toggle (persisted); detail drawer with provenance quote + accept /
  edit / discard; Issue MoM (blocks on unreviewed items unless forced) and
  Amend (post-issue correction); Export menu (md/csv/json); "Start next
  meeting" carries open items forward automatically. Bundled by
  `esbuild.config.mjs` → `dist/minutes.js` + copied `minutes.html`/`.css`.
- **Side-panel ticker** (`src/notes-panel.js`) — rewritten. It was calling a
  `saveNote`/`listNotes` API that no longer exists after the store rewrite
  (a real regression, not hypothetical — it would have thrown as soon as
  anyone opened the Notes tab). Now shows active-meeting status + open
  follow-ups + one "Open minutes register" button that opens the full tab.
- **Tests** — `test/notes-v2.test.mjs` (data layer, 14 cases) +
  `test/notes-minutes-smoke.mjs` (3 cases: every `#id` the JS queries exists
  in the markup it runs against; the empty-state → load-sample → populated
  register path renders for real against jsdom; the side-panel ticker
  mounts). Run both: `node --test test/notes-v2.test.mjs
  test/notes-minutes-smoke.mjs`. The smoke test needs `jsdom`
  (`npm install --no-save jsdom` — deliberately not a committed
  dependency; it skips itself cleanly if jsdom isn't present).
- **Design canvas → code (Phase 2.0b)** — the six artboards of the
  "Minutes Register" Claude Design canvas are now implemented for real, on
  live data:
  - *Main* — app bar breadcrumb (project / series / `W36 · date`), On-device
    pill, Present + Series facts, provenance band with the low-confidence
    count, stat strip with **Progress vs baseline**, "Needs review only"
    chip, metric rows with the big value / baseline / variance pill /
    sparkline, "Low ASR confidence" pill + dotted-underlined mis-hearing in
    the row, `AI draft · 61%` source label, footer with `j/k a o d /` hints
    (all wired) and "Last saved HH:MM · backend".
  - *Provenance drawer* — the correction banner ("The extractor wrote X. The
    audio at tc says Y" → **Apply correction / Keep as heard / Add to
    glossary**), topic + agenda chips in the head, timecode range + speaker
    + segment range + ASR %, as-spoken / machine-translation quote with the
    corrected phrase highlighted, cited-span waveform (deterministic
    placeholder until Phase 2.2 audio), linked items resolved across the
    series, history timeline, Priority field for risks/actions.
  - *Progress metric detail* — selecting a metric shows Actual / Baseline /
    Variance cards, an SVG curve of the measure across the series
    (`metricSeries`), and the "Ahead, but not safe" callout when an open
    risk shares the agenda line.
  - *Series* — series header (meetings, span, cadence, chair), per-meeting
    strip, standing action register sorted by age with age bars and the
    "raised in N consecutive meetings" pill, right rail with mean/oldest age,
    opened-vs-closed bar chart, open-by-party bars, "Raised again" callout,
    **Export standing register** (CSV) and **Start Wnn**.
  - *Issued MoM* — the Minutes tab is now the A4 paper document (light theme
    inside the dark app): letterhead, meta grid, numbered sections, `↩` for
    carried and `‡` for still-AI-drafted rows, KPI block, discussion notes by
    topic, provenance footer that names what was corrected, signature block,
    distribution line; **Export → Print / PDF** prints only the paper.
  - *Side panel* — the ticker is the "Captured so far" card: total, per-type
    chips, the three latest items with `tc · speaker · ASR%`, and the
    open-register button with its hint.
  - Data-layer additions behind this: `item.correction {from,to}` (schema),
    `applyCorrection`, `carryChain`, `linkedItems`, `seriesFlow`, and
    `seriesSummary` now counts a carried item once (newest copy) and reports
    `chain`. `acceptItem` clears a pending correction ("keep as heard") and
    records that in history. 20 data-layer tests + 3 DOM smoke tests.
- **Design reference** — `test/notes-register.html`, the original
  static/fake-data prototype, and the Claude Design canvas this was built
  from (published separately as an Artifact; not in this repo). When the two
  disagree, the canvas wins.

## Not done yet — later phases (see spec §7 roadmap)

Nothing below is wired up. Don't assume it exists when reading other files.

- **Phase 2.1 — real extraction.** `native/server.py` has no `/v2` routes;
  there's no `native/extract.py` or `native/store.py`. The register only
  ever gets data from (a) v1→v2 migration or (b) the sample fixture — there
  is no path yet from a live transcript to a `Meeting`. `src/lib/
  notes-generate.js` (the old regex extractor) is untouched and unused by
  the new UI; per spec §8 it should become a clearly-labelled offline
  fallback, not deleted outright, once real extraction exists.
- **Phase 2.1 — SQLite backend.** `notes-store.js` still uses
  `chrome.storage.local` / `localStorage`. `setBackend()` is the documented
  seam for swapping in a native-helper SQLite client; nothing calls it yet.
- **Phase 2.2 — provenance playback.** The drawer's "▶ Play from here" and
  every `data-play` timecode currently just show a toast
  ("Seeking transcript to …") — there's no audio and no seek. The waveform
  in the drawer is a deterministic placeholder keyed on the timecode (the
  cited span / low-confidence colouring is the information; the amplitudes
  are decoration) — replace it with real peaks when audio lands.
  `item.correction` is set only by the sample fixture today; the real
  extractor should populate it when MT text disagrees with the item text on
  a low-confidence span.
  Diarization / speaker names are not implemented (the fixture's `speaker`
  field is hand-set).
- **Phase 2.3 — cross-meeting search.** `notes-store.js` has `searchItems()`
  already (lexical, works across a series) but `minutes.js`'s search box
  only searches the ACTIVE meeting's items, not the whole series — wiring a
  "search everywhere" mode is a small follow-up, not started.
- **Phase 2.4 — retention / export formats.** No XLSX, ICS, or DOCX export.
  No retention-policy UI. Issue/freeze/amend the *data model* is done and
  tested; there's no storage panel or bulk cleanup UI.
- **Side panel "Flag this moment" + recording card** (SidePanel artboard) —
  not built; they need live recording state from `sidepanel.js`, which the
  notes ticker doesn't have access to yet.
- **`src/manifest.json`** — not modified. `minutes.html` doesn't need a
  manifest entry to open via `chrome.tabs.create` from inside the
  extension (MV3 doesn't require declaring internal pages), so this was
  intentionally skipped, not missed — confirm this still holds if Chrome's
  behavior here ever changes.

## Running things

```bash
node --test test/notes-v2.test.mjs test/notes-minutes-smoke.mjs   # data layer + UI smoke tests
node esbuild.config.mjs                                            # full extension build → dist/
```
Loading `dist/` as an unpacked extension and opening the side panel's Notes
tab is the fastest way to see the ticker → "Open minutes register" → full
workspace path end to end. (This session's sandboxed shell on your machine
can run `node --test` but not the esbuild binary or a real browser — those
were not exercised here beyond static/DOM checks; worth a manual pass.)

## Branch / commits

`feat/notes-v2`, branched off `release/1.1.1`, commit-as-you-go. Each commit
is meant to stand alone (buildable, its own tests green) rather than one
giant diff — `git log feat/notes-v2` for the breakdown.
