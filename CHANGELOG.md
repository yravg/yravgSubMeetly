# Riwayat rilis

## Unreleased — feat/notes-v2
- Minutes Register v2: typed register (decision/action/question/risk/metric/note), provenance per item, carry-forward that keeps age, issue/freeze/amend, Markdown/CSV/JSON export
- Register workspace implements the full Minutes Register design canvas: correction banner ("Ben and Coding" → "bending and coating") with apply / keep-as-heard / glossary, metric detail with series curve, standing register across the series with age + consecutive-meeting pills, A4 issued-MoM document with ‡/↩ markers and Print/PDF, keyboard j/k/a/o/d
- Side-panel Notes tab is a "Captured so far" ticker; the table lives in the full-tab register
- Interpreter mode chooser (Teams-style): consecutive two-way (a ⇄ b, direction detected per utterance) alongside the existing simultaneous one-way path, with an entry pill under Task Mode and a card modal
- Two-way mode lists BOTH translation directions in the model warning, each with its own Download button
- `src/lib/lang-detect.js` — offline script + stop-word heuristic (no models, no network) picks which of the two conversation languages was spoken; captions carry a `ZH → EN` direction tag

## 1.1.1 — 2026-09-03
- CC0/Public Domain spoken QA samples (3+ per Opus-MT source language, 10–30s) + attribution
- Easy sample test: Offline sample picker and Settings → MT pair → Test (lab / app.html)
- UI language toggle expanded to all Opus-MT source languages
- Realtime lab mock tab loops the CC0 speech.wav demo clip (removed personal YouTube example)

## 1.1.0 — 2026-09-03
- Chrome Web Store package: on-device captions, notes stub, helper status, store listing/privacy/MV3 audit
- Honest privacy copy: local inference after user-triggered model downloads (no Local TransSub cloud API)
- Release QA: smoke, E2E harness, e2e-file, release gate with documented CWS residuals (native/--pick)
- Win/Linux helper installers + SETUP.md; Studio offline harness; pack:store dual zip paths

## 1.0.0
- Rilis awal subtitel lokal + native helper + app macOS
