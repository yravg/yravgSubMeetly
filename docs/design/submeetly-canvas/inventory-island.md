# Island inventory: Oyenza pill and island features against the SubMeetly boards

Source: Oyenza Studio (MIT code), crates/poni/src. Paths below are relative to it. Name, logo and the Oyen character are not used.
Boards: I01 Pill, I02 Island open: Live, I03 Meeting, I04 Inbox, I05 Add-ins, I06 Agenda timer and Talk time, I07 Engine monitor, I08 Settings.
Format: Oyenza feature (file:line) -> our equivalent -> board. "target" = not built yet.

## Motion

1. Width grow spring 500/32.5, 324 ms (pill/motion.rs:21) -> `--ix` clip-path spring as CSS linear() -> I01, I02
2. Height grow spring 250/23, 458 ms (motion.rs:25) -> `--iy` spring -> I01, I02
3. Width shrink 400/36, 280 ms; height shrink 560/43, 244 ms (motion.rs:27-30) -> fold springs -> I01, I02
4. Radius grow 1200/69.3, 222 ms; shrink 150/24.5, 628 ms (motion.rs:33,35) -> `--ir` springs -> I01, I02
5. Top spring 300/34.6, 444 ms (motion.rs) -> Notch/Pill top edge move -> I08
6. Content spring 700/52.9, 292 ms (motion.rs:38) and fade delay 0.03 / 0.05 s (island.rs:28-29) -> content out 0.12 s, in 0.24 s after 0.2 s, scale .97 to 1 (from the film) -> I02
7. Hover dwell 220 ms, choices Quick 120 / Normal 220 / Slow 450 (settings.rs:229, settings_window.rs:335) -> dwell ring 1.5 s from the film; switch 0.22 s (Oyenza); Settings choices 0.22 / 1.5 / 3 s / Off. Owner decision 2026-11-08: 0.22 s default, as Oyenza; 1.5 s stays an option and the film uses it -> I01, I08
8. Page switch 0.26 s, slide 20 px (app.rs:588, pages/mod.rs:356) -> page fade + 20 px slide 0.26 s -> I02-I08
9. Tab label grid-columns open 0.32 s (film) -> same, cubic-bezier(.25,1,.5,1) -> I02
10. Tooltip delay 0.4 s, fade 0.12 s (pages/mod.rs:499-500) -> not ported: tab names are visible when active; the tooltip is a title attribute only
11. Reduced motion -> `prefers-reduced-motion`: animations off, transitions 0.12 s -> all

## Pill

12. Idle pill with status text (pill/mod.rs) -> idle "ready · Ctrl Alt S" -> I01 Empty
13. Live caption line in the pill (pill/island.rs) -> live caption pill with translation line -> I01 Normal
14. Equaliser bars at the pill end -> bars; replaced by the 22 px dwell ring while hovering (film) -> I01
15. Pill 8 px below top edge (pill/mod.rs:41 TOP_GAP) -> Pill shape; Notch shape flattens the top edge -> I01, I08
16. Peek 5 s (PEEK_S) -> not ported: no new-event peek in SubMeetly yet; reason: the owner has not asked for notifications on the pill
17. Recording opening state 15 s, error 8 s (REC_OPENING_S, REC_ERROR_S) -> error state "Helper offline, browser engine took over" -> I01 Error
18. Permission blocked state -> "Microphone blocked" -> I01 Locked
19. Needs-you state -> "3 wait on you" -> I01 Needs input
20. Pin / keep open -> "Keep island open" checkbox -> I01-I08
21. Hide in full-screen apps (settings.rs) -> switch in Settings -> I08

## Island pages

22. Live page, three lines (pages/live.rs) -> Live: previous, current, translation; Pause / Stop -> I02
23. Notes / meeting page (pages: notes) -> Meeting page with Accept, rows close up, count, toast -> I03
24. Inbox of open items -> Inbox with Done / Snooze and "Inbox zero" -> I04
25. Add-ins page with switches (pages/addons) -> Add-ins; a switch adds or removes its tab -> I05
26. Timer activity (activities.rs:25-51) -> Agenda timer with ring and agenda ticks -> I06
27. Talk time -> Talk time bars from diarised segments -> I06
28. Engine / system page -> Engine monitor (CPU, GPU, real-time factor, bars). "Rust engine · CUDA" is target state, marked on the board -> I07
29. Settings page (settings.rs:10-115) -> Theme, Shape, While captioning, Open on hover, Display, Full-screen apps -> I08
30. Each page state set (normal, empty, error, locked, needs input) -> state switcher on every board -> I01-I08

## Input

31. Wheel switches pages (app.rs:3867-3876) -> not wired: pure CSS cannot read the wheel; tabs click instead; noted on I02
32. Esc and Ctrl+W close (app.rs:1701-1702) -> not wired: same reason; leaving with the pointer folds the island; noted on I02
33. Global hotkeys Alt+Shift+F and Alt+Shift+S (app.rs:68-72) -> Ctrl Alt S start; Ctrl Alt D / A / Q quick capture (labels only) -> I01, I02
34. Tray menu (tray.rs:55-95) -> not ported: SubMeetly has a browser extension and a macOS app; tray belongs to the macOS app board set (not in this canvas)

## Not ported

35. Prayer times, Game, Health, IELTS, Stocks, AI usage -> not ported: not meeting features
36. Apple Music, lyrics, media activity -> not ported: no music player in a meeting tool; the lyric lines served as the model for caption lines only
37. Oyen character, eyes idle style, Oyenza account and money -> not ported: brand and character are not licensed; no account in SubMeetly
38. Phone LAN drop -> not ported: SubMeetly has Drop to transcribe on the island instead (I05 add-in)

Counts: 38 lines. Ported or adapted: 28 (1-9, 11-15, 17-30). Partly ported (wheel, Esc, hotkeys): 3 (31-33). Not ported: 7 (10, 16, 34, 35, 36, 37, 38 as groups).
