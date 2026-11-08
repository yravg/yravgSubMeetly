# yravgSubMeetly next: Rust engine, top island, add-ins, threads, de-slop

Owner request 2026-11-08. Handoff: `docs/handoff/submeetly-next.md`.

## Goal

1. Brand shown to users becomes **yravgSubMeetly** (owner choice).
2. The local engine (today `native/server.py`, Python) runs in Rust with the same HTTP and
   native-messaging contract, then Python is removed.
3. A pill that hangs from the top of the screen (Windows first, then Mac), using the UI and
   animation of Oyenza Studio's island (MIT code, https://github.com/lucacadalora/oyenza-studio),
   painted with our design tokens. Control the app from the top of the screen; the existing
   main pages stay.
4. Add-ins in the island, built on Oyenza's add-on system, but only add-ins that belong to a
   meeting / subtitle app.
5. Threadbear ideas (https://github.com/mikecann/threadbear, MIT) brought to meetings:
   decisions as buttons, options side by side, inbox zero for actions, a librarian that files
   meetings into projects, patches as add-ins.
6. Minutes register, Side panel and app.html lab shell redesigned to remove AI-made look,
   keeping `src/tokens.css` and the surface themes.

## Constraints

- Oyenza name, logo, Oyen character, `docs/brand`, `installer/art`, app icon: NOT MIT. Never copy.
  Keep its LICENSE and THIRD-PARTY-NOTICES with any copied code.
- Account-bound Oyenza pages (Oyenza money, Health, Stocks, Today calendar/Gmail, AI usage) are dropped.
- Internal ids stay (`ysm*` keys, `~/.yraveragesubmin`, native host name, bundle id) — display-only
  rename, no migration (Oyenza used the same rule).
- House rule (yravgbuilder) says no UI in Rust. Exception requested by owner for the island only:
  it is Oyenza's native Win32/Direct2D + AppKit renderer, reused, not rewritten. Main pages stay web.
- Python engine stays as oracle until the Rust engine is golden-equal on every route.

## Steps

| # | Step | Acceptance |
|---|---|---|
| S1 | Display rename to yravgSubMeetly | No user-visible "yraverageSubMin"; `npm test` green; rename-migration tests still pass |
| S2 | Engine contract goldens | `engine-rs/golden/*.json` captured from Python for every non-ML route |
| S3 | engine-rs non-ML routes | Rust server passes goldens 0 mismatch: /health, /engine/*, /notes*, /ui-prefs, /jobs, origin check, state dir, native messaging framing |
| S4 | engine-rs ASR + translate | Library decision (candle pure Rust vs whisper-rs + cmake); /transcribe, /transcribe_file(_job), /translate, /draft within tolerance of Python on bench set |
| S5 | Switch default to Rust, delete Python | Owner sign-off; installers point to Rust binary; e2e + e2e:native PASS |
| S6 | Island fork | `island/` builds on Windows, pill theme default, our tokens as a Look, Oyenza brand/account pages removed, runs |
| S7 | Island SubMeetly pages | Live (subtitle line in collapsed pill + start/stop), Minutes (register summary, decisions/actions), Record; talks to engine over loopback |
| S8 | Add-ins | Add-on system kept; meeting add-ins (list fixed after S9 spec) |
| S9 | Threadbear mapping spec | `docs/roadmap/threadbear-mapping.md`: each Threadbear feature → meeting feature, kept/dropped with reason |
| S10 | De-slop canvas | Scan + critique of the 3 pages, Before/After canvas, owner sign-off |
| S11 | De-slop build | Per board, slop scan 0 errors, viewed at 1440/1024/390, dark |

Order: S1, S2, S6, S9, S10 run in parallel. S3 after S2. S4 after library decision. S7 after S3+S6.
S8 after S9. S11 after S10 sign-off. S5 last.

## Decisions (owner, 2026-11-08)

- S4: **candle** (pure Rust) for ASR and translation. whisper-rs rejected (needs cmake + libclang).
- S6: **"UI in Rust" exception accepted for the island only.** Main pages stay web.

## Open questions (owner)

- S8: final add-in list after S9.
