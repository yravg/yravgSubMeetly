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
- **Tests** — `test/notes-v2.test.mjs` (data layer, 21 cases) +
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
- **Artboard fidelity pass (Phase 2.0c)** — the gaps the artboard→code audit
  found on the Progress / Provenance / MoM / Main boards are closed:
  - *Progress* — selecting a metric now widens the drawer to
    `min(900px, 72vw)` (`.drawer.wide`) and lays it out like the artboard:
    ref · Metric · topic · agenda on one line, the item text as an `<h1>`,
    the three number cards, the full-width chart, then a `1.35fr 1fr` grid —
    "Where the figure came from" (timecode, speaker, segment range, ASR %,
    the cited sentence as a left-ruled quote, plus the editorial line
    `mTypedNote`) beside "Linked items" and the "Ahead, but not safe"
    callout. Non-metric items keep the 520px Provenance drawer; under 900px
    both are full-screen as before.
  - *Severity × likelihood* — `MinuteItem.likelihood`
    (`certain|likely|possible|unlikely`, default `possible`) is in the
    schema; the drawer shows risks as two side-by-side selects saved through
    `editItemAndSave`, and the MoM risks column is `Sev × Lik` →
    `High × Possible`. Non-risk items keep the single Priority field.
  - *Editable MoM summary* — `Meeting.summary` is a multilingual text map
    written by `setSummary` / `setSummaryAndSave` (refused on an issued
    meeting, like every other edit). §1 of the document renders the authored
    paragraph when there is one and the generated statistics sentence
    otherwise; before issue it is a `contenteditable` block with a
    **Save summary** button, after issue it is read-only. The W36 fixture
    ships an EN + ID summary.
  - *Recurring questions reach the document* — `viewDoc()` computes
    `carryChain()` per question and appends the bolded "Raised in N
    consecutive meetings; no owner assigned." (owner-less variant only when
    the item really has no owner).
  - *Correction highlight in "As spoken"* — `correction.origPhrase` carries
    the source-language phrase (fixture: `弯管和涂敷`) so the zh original is
    marked as well as the MT line.
  - *Fixture links + KPI measures* — W36 now has a land-pack `info` item and
    a `cumulative_progress` metric that links to it and to the delay risk
    (which links back), so "Linked in this register" renders on sample data;
    `man_hours` (35,000) and `hse_incidents` (0) are metric items, so they
    land in the §6 KPI band instead of §7 prose, with thousands separators
    via `Intl.NumberFormat`.
  - *Group control* — a `Group: none / Topic / Owner / Status` select in the
    toolbar; grouping inserts a full-width `tr.ghead` header per group and
    keeps the column sort inside each group.
  - *Small fidelity* — the MoM "Next" line shows date + start time + tz
    (`startNextMeeting` now inherits the series' time of day, so the slot
    survives), and the series flow chart labels both the tallest opened and
    the tallest closed bar on the y axis.
  - 28 tests (`node --test test/notes-v2.test.mjs
    test/notes-minutes-smoke.mjs`).
- **Design reference** — `test/notes-register.html`, the original
  static/fake-data prototype, and the Claude Design canvas this was built
  from (published separately as an Artifact; not in this repo). When the two
  disagree, the canvas wins.
- **Side-panel live-capture rail** (`src/notes-panel.js` + `.css`,
  `src/sidepanel.js`) — the SidePanel artboard's top block. A recording card
  (pulsing red dot / grey when idle, `T('recording')`/`T('idle')`, mono
  `HH:MM:SS` elapsed clock, engine badge — `MLX · GPU` when the native helper
  is the active engine, else `Whisper · browser`), a 20-bar decorative
  waveform whose last five bars go emerald while running, and "End & draft".
  `sidepanel.js` stamps `state.startedAt` wherever a capture starts or stops
  (`syncCaptureStamp()`, both the realtime and offline paths) and passes
  `{ getCapture, onEndCapture }` into `mountNotesPanel()` from both call
  sites; the ticker owns one 1 s interval per root and clears it on re-mount,
  so a language change (which re-mounts via `applyI18n()`) cannot stack
  timers. The waveform is DECORATION — the pipeline exposes no amplitudes and
  the bars are fixed rather than faked-live.
- **"Flag this moment"** (`flagMoment` / `flagMomentAndSave` in
  `src/lib/notes-actions.js`) — a dashed full-width button under the recording
  card with a `⌘⇧F` / `Ctrl+Shift+F` hint, wired as a real shortcut in
  `sidepanel.js` (fires only while the Notes view is visible and a capture is
  running). It appends an `info` item, `topic: 'flag'`, `review: 'edited'`
  (a human put it there), whose provenance is the timecode and nothing else:
  `src.orig`/`src.tr` stay empty because the panel must never invent
  transcript words. The rendered text comes from the caller
  (`T('flaggedAt', tc)`) — the actions layer knows no i18n. With no meeting
  in the store yet, the ticker creates one (`T('untitledMeeting')`, today's
  date, the UI locale) and flags that. Disabled with `T('flagNeedsRecording')`
  when nothing is running, and disabled with `T('flagRefusedIssued')` when the
  selected meeting is already issued — a refusal also surfaces for a few
  seconds in the panel's existing status pill, because the panel has no toast
  and a silent no-op is a bug.

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
- **Still data-dependent, not oversights** (the artboards show these; the
  model has nothing to render them from, and inventing values would be
  worse than the gap):
  - `Present 9 of 11 invited` — `Meeting.attendees` is who spoke/attended;
    there is no invited roster, so the header and the MoM meta line count
    attendees only.
  - `… · 02:04 GPU` in the pipeline line — `EngineStamp.durationSec` is the
    media length, not processing time; nothing measures wall-clock/GPU time.
  - Audio seek — every `data-play` timecode and "Play from here" still just
    toasts; there is no retained audio (Phase 2.2).
  - Waveform amplitudes — deterministic pseudo-peaks keyed on `src.t0`; the
    cited span and low-confidence colouring are the real information.
  - Job titles in the signature block (`Project Manager, GZS`) —
    `Participant` has `name`/`org`/`speakerLabel`, no role.
  - Retention wording in the MoM footer — there is no retention setting, so
    the footer says "kept on this device" and claims no period.
- **Side panel: Pause** — the SidePanel artboard draws a Pause button beside
  "End & draft"; the capture pipeline has no pause (start/stop only), so the
  rail ships without it rather than with a dead control. Phase 2.1.
- **Side panel: a flag is not bound to a capture session** — nothing ties a
  running capture to a meeting. A flag therefore lands on whichever meeting is
  currently selected in the panel, carrying a timecode measured from the live
  capture's own clock (`state.startedAt`), which may have nothing to do with
  that meeting's recording. This is deliberate for Phase 2.0 — the panel
  refuses to flag an issued MoM and says why, but it cannot know whether the
  selected meeting is the one being recorded. Binding a capture session to a
  meeting (and with it a single shared timecode clock, so `src.t0` means the
  same thing for flags and extracted items) is Phase 2.1.
- **Side panel: "End & draft" only ends** — it stops the running task through
  the existing `onStop()` path and opens the register. Actually *drafting* a
  register from the live transcript (running the extractor over what was just
  captured) is Phase 2.1; today the register it opens holds whatever was
  already stored, plus any flags.
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
