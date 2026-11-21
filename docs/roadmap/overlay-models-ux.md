# Captions window, overlay strip and Models tab: 26 UI/UX improvements

Owner ask (2026-11-21): improve the Models tab and the overlay. At the start the overlay had many controls: speed, refine, time, and a click on the time jumped the video to that line. Owner auto-approves the canvas; proceed to build; everything must work; speed is a must (never slow the caption path).

Version target: 1.5.0. Handoff: docs/handoff/overlay-models-ux.md. Canvas: docs/design/overlay-models-canvas/.
Reference for the old controls: the Chrome extension overlay, src/content.js (toolbar L560-760, time button L1035, seekVideo L135). Rule (owner 2026-11-09): the Windows app keeps every extension feature.

Three surfaces:
- **CW** = Captions window, `src/captions.html` (web page, opened by Pop out via `/app/captions.html`; lines from engine `GET /live/lines?after=<seq>`).
- **ST** = Overlay strip, native (`island/crates/poni/src/overlay_win.rs`, `poni-core/src/overlay.rs`, `app.rs` overlay_tick).
- **MT** = Models tab, native (`island/crates/poni/src/settings_window.rs` Section::Models, `poni-core/src/{models,library,speed,model_pick}.rs`, `services/models.rs`) and the pill Captions > Models group.

| ID | Surface | Improvement | Acceptance |
| --- | --- | --- | --- |
| OM-01 | CW | Click a line's time to jump the video to that line | Each line carries the media position when it was heard (`media_s`); click sends it to the island, which seeks the playing media (SMTC). No media / no seek support: the time is plain text with a tooltip saying why. |
| OM-02 | CW | Time shown as video time (m:ss) or clock time, one toggle, remembered | Toggle in the toolbar; lines without `media_s` show clock time. |
| OM-03 | CW | Refine translation switch (draft while speaking, corrected at the end) | Same meaning as extension `refineTranslation`; stored; engine `/translate_refine` is used for the correction. |
| OM-04 | CW | Show as a segmented control (Both / Original / Translation) instead of a select | Keyboard arrows work, state announced. |
| OM-05 | CW | Auto-scroll switch plus a "N new lines" jump pill | Pill counts lines that arrived while reading; Esc / End jumps. |
| OM-06 | CW | Force translate menu: Re-translate all / Selected lines / Time range (From-To) | Progress "12 of 40", Cancel, errors shown per line; uses engine `/translate`. |
| OM-07 | CW | Line selection: checkbox, Shift-click range, selection bar (Copy, Re-translate, Clear) | Counts update; selection survives new lines arriving. |
| OM-08 | CW | Speed readout: header chip "2.7x real time" and an optional per-line latency badge | Computed from `audio_s` and the engine's ASR time per window; turns amber below 1.2x with the words "falling behind". |
| OM-09 | CW | Find in captions: Ctrl+F, highlight, next/previous, count | Searches original and translation; no full re-render per key. |
| OM-10 | CW | Row actions on hover and focus: Copy line, Re-translate, Jump | Reachable by keyboard; no layout shift. |
| OM-11 | CW | Compact mode (one line per caption, no chrome) and Pin on top, remembered | Compact hides toolbar rows; Pin keeps the window above (Chrome app window: best effort, state shown honestly). |
| OM-12 | CW | Status bar with every state: Listening, Paused, Falling behind, Engine offline (Retry), Empty | Pause/Resume button stops the page from fetching and says so; Retry reconnects. |
| OM-13 | CW | One Export menu: Copy all, TXT, SRT, VTT | Replaces the three loose buttons; keeps every existing function. |
| OM-14 | CW | Fast rendering: incremental DOM, window of at most 400 rows in the DOM, adaptive polling | Appending one line touches one row; 5000 lines scroll at 60 fps; polling is 300-400 ms while lines flow and backs off to 1.5 s when idle. Measured and reported. |
| OM-15 | ST | Interim line is dimmer and ends with a caret | Final lines solid; matches the pill. |
| OM-16 | ST | Hover toolbar on the strip (when not click-through): Pause, Copy, Pop out, Lock | Buttons appear on hover, hit-testable; dragging the body still works. Stretch: if it cannot be made reliable, say so and keep the tray/menu commands. |
| OM-17 | ST | Strip fades out after 8 s of silence and returns on the next line | Never fades while hovered, paused or in preview. |
| OM-18 | ST | Latency readout on the strip, reusing the existing Display > Latency readout setting | Off by default, same text as the pill "[ 820 ms ]". |
| OM-19 | MT | Sub-tabs inside Models: Library, Speed, Services | One group set per sub-tab; remembered; every existing control stays reachable. |
| OM-20 | MT | "In use now" card at the top: speech and translation model, light, speed, device (GPU/CPU) | One glance answers "what is running and is it fast enough". |
| OM-21 | MT | The duplicate "Models in use: folders and downloads by hand" group becomes a collapsed group | No control removed; collapsed by default, state remembered. |
| OM-22 | MT | Storage summary: size of all models, free space of the model drive | Updates after a download or delete. |
| OM-23 | MT | Sort: Recommended / Size / Speed / Name | A Choice row; sort is stable and remembered. |
| OM-24 | MT | Download rows show percent, speed, ETA and a Cancel button | Cancel stops the pull cleanly and the row returns to Download; partial files kept for resume. |
| OM-25 | MT | Speed chip coloured (green at 2x or more, amber 1.2-2x, red below) with a "Test again" button | Colour is never the only signal (words too). |
| OM-26 | MT | Privacy chip on cloud rows ("Sends audio to Groq") and the runtime line on speech rows ("Runs on GPU via Vulkan") | Truthful: derived from settings and engine health, not hard-coded. |

## Rules for every item
- Tokens only (src/tokens.css for web; `palette::` for native). No raw colours.
- Every state exists: empty, loading, error, disabled, success.
- Never remove a control: move it, fold it, or rename it only.
- Speed is P0: nothing is added to the capture to caption hot path. Report measured numbers before and after (render ms, poll cost, paint ms).
- Test first where there is logic. Report what was not viewed.
