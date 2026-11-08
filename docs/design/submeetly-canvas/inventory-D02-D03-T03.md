# Feature inventory: D02 side panel, D03 lab shell, T03 draft options

Rule: every line lands on the new board as a visible control, a tab or state, or a callout note. Nothing is dropped.
Landing codes: `tab:x` = a tab pane, `st:x` = a state (Normal / Empty / Error / Locked / Needs input), `ov:x` = overlay, `den:detail` = shown only in Detail density, `note` = callout note, `map` = feature map card (D02 right column).
Source paths are relative to the repo root. Line numbers are from the files as read on 2026-11-08.

## D02 Side panel (src/sidepanel.html unless stated)

### Top bar and navigation
1. Recording dot `#topbar-rec` (:13) -> top bar, red when Live runs (`st:normal`, Live pane).
2. View tabs Captions / Notes `#view-tabs` (:17) -> tab bar, kept as the top row (open owner decision: duplicate with bottom nav, note).
3. Density Simple / Detail `#density-toggle` (:25) -> `den` switch in the top bar; Detail-only controls tagged `den:detail`.
4. Settings gear `#btn-settings` (:35) -> `tab:settings`.
5. Captions sub-tabs Live / Performance `#captions-subtabs` (:42) -> `sub` switch inside `tab:captions`.
6. Performance view `#view-perf` (:46) (src/perf-panel.js) -> `sub:perf`: KPI row, p50 chart, filters, export (items 62-66).
7. Bottom nav `#bottom-nav` (:273) -> bottom bar, 5 destinations Captions / Notes / History / Helper / Settings (History and Helper were scroll sections, now reachable).
8. Footer version + About `#btn-about` (:269) -> footer line v1.1.1 with info link, `tab:settings` About card.
9. Toast stack `#toast-stack` (:265) -> toast at the bottom (`st:error`: "Helper not reachable", `st:normal`: "Copied").

### Source
10. Offline / Realtime `#mode-toggle` (:51) -> `mode` switch in the Listen block.
11. Realtime target card: favicon, title, url `#rt-target` (:58-62) -> `mode:rt` card.
12. "Current page" tag `#target-tag` (:64) -> chip on the target card.
13. "Go to tab" `#btn-goto-session-tab` (:65) and hint `#session-tab-hint` (:67) -> shown in `st:locked` (session runs in another tab).
14. Offline dropzone `#off-drop` + file input (:70-75) (mp3, wav, m4a, mp4, webm, ogg) -> `mode:off` dropzone with type chips; `st:empty` shows the empty dropzone, `st:normal` a chosen file name `#off-filename`.
15. CC0 sample bar `#qa-sample-select` + Run `#btn-qa-run` (:79-88) (lab only) -> `den:detail` row under the dropzone, tagged "lab only".
16. "Pick tab / window manually" `#btn-pick` + `#pick-hint` (:174-175) -> `den:detail` link under Start, hint line.

### Task and languages
17. Task mode: Transcribe / + Translate `#task-toggle` (:112) -> segmented control.
18. Refine switch `#refine-main` (:104) (detail) -> `den:detail` switch.
19. Dual line switch `#dual-line-main` (:108) (detail) -> `den:detail` switch.
20. Interpreter row: summary `#interpreter-summary` + Change `#btn-interpreter` (:117-121) (detail) -> `den:detail` row; Change opens `ov:interp`.
21. From `#src-lang` / To `#tgt-lang` selects (:126-133) -> From / To fields; To hidden when Transcribe only.
22. Model warning + per-model Download `#model-warning`, `#dl-list` (:140-141) -> `st:need` card "2 models to download" with Download buttons and "Manage models" link (-> `tab:settings` models).
23. Status line `#status-line` (:143) -> status row (dot + text) per state.
24. Start steps Capture / Models / Warm-up / Listening `#start-steps` (:144) -> 4-step strip, shown in `st:normal` with step 3 current.
25. Error box: title, hint, technical detail `<details>`, action, dismiss (:150-159) -> `st:error` card with all five parts.
26. Start Task / End Task `#btn-start` `#btn-stop` (:171-172) (End becomes Cancel in offline) -> CTA row; End label reads Cancel in `mode:off`; both disabled in `st:locked`.
27. Engine + device line (new from D02 v1) -> kept below the languages.

### Live and offline results
28. Live preview Original / Translation boxes `#live-preview` (:178-185) -> Live pane three-line block.
29. Offline results: progress text `#off-progress-text`, SRT / VTT / TXT `#btn-srt` `#btn-vtt` `#btn-txt` (:190-196) -> `mode:off` results card.
30. Export destination hint + "Change..." `#export-dest-text` `#btn-export-dest-change` (:199-201) -> hint row on the results card.
31. Offline lines list `#off-lines` (:203) -> scroll list on the results card.

### History
32. Search `#history-search` (:212) -> `tab:history` search field.
33. History rows with Open / TXT / SRT / VTT / Delete, url, snippets `#history-list` (:214) -> rows with those five actions.
34. Empty state "No history yet" -> `st:empty`.
35. Export-subtitles block mounted at `#export-mount` (:218) (src/lib/helper-status.js ~:120-165) -> `tab:history` Export card (items 46-48).

### Native Helper card (collapsible, detail, default collapsed key "helper") (:222-230)
36. Collapse toggle `#helper-card-toggle` (:224) -> card header chevron on `tab:helper` (open there; collapsed note kept).
37. Connected / disconnected pill, guide label, engine (helper-status.js ~:77) -> status header of the Helper card.
38. Indicators Mode / Task / Engine / model / device pill -> row of chips in the Helper card.
39. Disconnect banner -> `st:error` banner on `tab:helper` and on Captions.
40. "Panduan <OS>" steps -> Install guide card (items 49-52).
41. Large-file job: progress bar, cancel, stage pill -> `tab:helper` job card (`st:normal` running at 62 percent, `st:empty` none).

### Helper install and diagnostics (src/lib/helper-guide.js)
42. Diagnostics + Re-check -> Diagnostics card with Re-check button.
43. OS tabs (macOS / Windows / Linux) -> `sub` OS switch.
44. Prerequisites `<details>` -> collapsible row.
45. Steps with Copy -> numbered steps with Copy buttons.
46. Export: SRT / VTT / TXT buttons with descriptions -> three rows on the History Export card.
47. Export: CRLF / BOM / language-suffix switches -> three switches.
48. `btn-export-os-default` + target line -> button + target line.
49. Host-manifest paths with Copy -> two path rows with Copy.
50. Troubleshooting `<details>` -> collapsible row (6 entries, 2 shown).
51. Mock fallback "browser engine takes over" (E01) -> chip row.
52. Native device CPU / GPU CUDA + active pill + hint (:445-455) -> Settings Engine card and Helper card.

### Notes view (:235-259, src/notes-panel.js)
53. Collapsible Notes card `#notes-card-toggle` (:238) -> card header chevron on `tab:notes`.
54. Meeting bar: switch `#notes-meeting-switch` (notes-panel.js:223) + new (inline name form) -> `tab:notes` meeting bar with + button.
55. Status pill on-device / notice / no meeting + backend name -> pill row.
56. Capture rail: rec dot, clock, engine badge, wave strip (decorative; no Pause by design) -> rail at the top of `tab:notes`.
57. Project-type select `#notes-project-type` (:76, 14 types) -> select in the rail.
58. "End & draft" `#btn-end-draft` (:197) -> primary button, disabled in `st:empty` and `st:locked`.
59. "Flag this moment" `#btn-flag-moment` (:203), Ctrl+Shift+F (Cmd+Shift+F on Mac) -> button with shortcut chip; disabled in `st:locked` with the reason.
60. "Captured so far": count, summary (Auto summary / Save / Cancel), decisions (+ add, save, cancel, delete), actions (+ add with owner input), latest items with confidence and low flag -> `tab:notes` captured card, `st:normal`; `st:empty` shows "Nothing captured yet".
61. `#btn-open-register` (:330), TXT / Markdown / Sync buttons, "Start next (Minutes demo)", saved-meetings collapsible list with delete -> button row + list.
62. Paste a Teams transcript: textarea `#paste-input`, title, "Make minutes", result (:245-257) -> `st:need` shows this card with an empty textarea and a hint.
63. draftFromSession (notes-panel.js:541) -> End & draft note, links to T03.
64. Frozen when issued -> `st:locked`.

### Performance (src/perf-panel.js)
65. Title, subtitle, view toggle charts / table, float / dock -> `sub:perf` header.
66. Filters stage / pair / source + series chips -> filter row.
67. KPIs ASR p50, MT p50, RTF, N -> four KPI cells.
68. Charts p50 by pair (500 ms target), scatter, line; table; empty state -> bar chart drawn; empty text in `st:empty`.
69. Footer export JSON / MD, import JSON, load bench, clear -> footer buttons.

### Interpreter modal (:291-372)
70. Consecutive (lang A <-> B) vs Simultaneous (one language) radio cards, badges -> `ov:interp`.
71. Lang selects `#interp-lang-a/b/one`, error `#interp-error`, running note "Changes apply to the next task", Cancel / Turn on -> `ov:interp` footer; error shown in `st:error`.

### Settings modal (:378-521) -> `tab:settings`, grouped in cards
72. Search `#settings-search` + no-match (:385-389) -> search field + empty text in `st:empty`.
73. UI language `#ui-lang-toggle` (:393) -> General card.
74. Theme Auto / Light / Dark `#theme-toggle` (:398) -> General card.
75. Reskin pattern Yraverage / Coretax / Yraverage Modern + Reset `#btn-reskin-reset` (:407-422) -> General card.
76. Engine select `#engine-toggle` (:428) -> Engine card.
77. Native block: URL, status dot, Start / Stop / Restart / Refresh, host hint, native models (:430-458) -> Engine card.
78. Download source HuggingFace / HF-Mirror `#mirror-toggle` (:463) -> Models card.
79. Inference device Auto / WebGPU / WASM `#device-toggle` (:471) -> Engine card.
80. Save exports to folder: Choose / Clear + label (:481-483) -> Output card.
81. Live refine, Dual line switches, subtitle font size slider (:490-500) -> Output card.
82. Model Files: Speed vs accuracy Fast / Balanced / Accurate + hint, ASR rows, translation rows per pair (:510-519) -> Models card.
83. About / open-source licenses (9 items) `#about-block` (:521) -> About card with count chip.

D02 total: 83 lines. Every one lands on the board.

## D03 Lab shell (test/app.html, test/chrome-mock.js)

1. Banner developer paragraph (app.html:196) -> "How the lab works" popover (`ov:how`), full text kept verbatim.
2. Width seg Auto / Compact / Wide / Full `#width-seg` (:205), stored `ysmAppWidth` -> working `w` switch; frame width follows (Auto 880 when Notes open, Compact 480, Wide 880, Full 100 percent).
3. "All test pages" menu `#pages-menu` (:211) -> `tab:pages` plus the dropdown in the bar.
4. Primary guides: 3 user guides (/guide.html?doc=...), Minutes Register (/src/minutes.html) -> Pages tab, group "Guides and register".
5. Translation Lab /lab.html -> Pages tab, group "Tools".
6. Offline Studio /studio.html -> Pages tab, "Tools".
7. Model manager /models.html -> Pages tab, "Tools".
8. Session history /history.html -> Pages tab, "Tools".
9. Helper status /helper-status.html -> Pages tab, "Tools".
10. Helper install guide /helper-guide.html -> Pages tab, "Tools".
11. Meeting notes ticker /notes-panel.html -> Pages tab, "Tools".
12. Release QA: verify.html, qa-report.html, bench.html, defects.html -> Pages tab, group "Release QA".
13. Extension harnesses: audio-page, overlay-test, panel-test, offscreen-test -> Pages tab, group "Extension harnesses".
14. More: test index, samples/ATTRIBUTION.md -> Pages tab, group "More".
15. Panel mount `#app-mount` loads /dist/sidepanel.html (app.html:242) -> `tab:panel` centre frame (live D02 panel).
16. chrome-mock.js is loaded -> note "Chrome APIs are mocked" + `tab:mock`.
17. dist/content.js overlay host -> right rail "Overlay log" (`tab:panel`).
18. dist/offscreen.js -> right rail line "Offscreen engine: loaded".
19. Failure text "dist/sidepanel.html missing, run npm run build" -> `st:error`.
20. Failure text "Failed to load /dist/sidepanel.js" -> `st:error` second line.
21. Loading text while fetching -> `st:empty`.
22. Needs the Chrome extension (tabCapture, overlay injection) -> `st:locked` banner.
23. CC0 sample pick / getDisplayMedia share prompt -> `st:need`.
24. window.__labMock helper.mode passthrough / offline / fixture (chrome-mock.js:124) -> `tab:mock` NEW mode switch.
25. latencyMs -> `tab:mock` number field.
26. failNext -> `tab:mock` switch.
27. health + device fixtures -> `tab:mock` two JSON fixture cards.
28. request log `log`, content.log -> `tab:mock` log table.
29. reset() -> `tab:mock` Reset button.
30. Intercepts fetch to 127.0.0.1:17865 (/health, /engine/device GET/POST) -> note on `tab:mock`.
31. Lab-only CC0 sample bar (sidepanel :79) -> right rail "CC0 samples".

D03 total: 31 lines.

## T03 Draft options (src/notes-panel.js:541 draftFromSession, docs/roadmap/threadbear-mapping.md:83-107)

1. End & draft produces one draft from the session lines (generateNotesFromTranscript) -> Draft A (Short) kept as the baseline path; same generator for B and C.
2. Merge with items already in the meeting -> footer "dedupe: 3 already in the register" count.
3. Frozen when issued (issuedAt) -> `st:locked`.
4. Variants Short / Full / Bilingual (new, partial) -> Compare tab, three lanes.
5. Compare side by side (new) -> Compare tab.
6. Pick one + note (new) -> `pk` radio per lane plus note field.
7. Recommended pick with a reason (Threadbear) -> "Suggested" mark.
8. "None of these" + free reply (Threadbear) -> `pk:none` option with text field.
9. Per-item include checkboxes (new) -> in each draft tab.
10. Edit toggle (new) -> `ed` switch.
11. Word-level diff accept / reject (yravg inline-diff) -> Diff tab.
12. Regenerate a variant (new) -> button per lane.
13. Use picked draft writes decisions via addItem (notes-actions.js:192) -> footer primary button.
14. Discard -> footer secondary button.
15. Source strip: 53 segments, 07:00-07:30, zh to en, sample-library -> header strip.
16. Bilingual needs the session language pair -> `st:need`.
17. Generator failed for a variant -> `st:error`, retry.
18. No transcript -> `st:empty`.

T03 total: 18 lines.
