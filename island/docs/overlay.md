# Subtitle overlay

A borderless, transparent, always-on-top strip over the screen with the live captions and their translation
(Windows and macOS). The idea of a configurable caption overlay (colours, opacity, sentence count,
click-through) comes from LiveCaptions-Translator (Apache-2.0); the code is ours.

| Where | What |
|---|---|
| `crates/poni-core/src/overlay.rs` | The settings (`Settings.overlay`), which sentences are shown, where the strip sits, the pure compositor. Tested. |
| `crates/poni/src/overlay_win.rs` | The Windows window: layered popup, text rasterised with GDI, composed to premultiplied BGRA, `UpdateLayeredWindow`. Click-through is `WS_EX_TRANSPARENT`; otherwise dragged by its body. |
| `crates/poni/src/mac/overlay.rs` | The macOS window: non-activating `NSPanel` (all Spaces, over full-screen apps), labels in a rounded `NSBox`. Click-through is `ignoresMouseEvents`; otherwise `movableByWindowBackground`. |
| Settings › Subtitle overlay | Show/hide, Shows (original, translation, both), sentences, text size, colours, background and its opacity, click-through, Preview, Position reset. |
| Menu (menu bar / tray) | Subtitle overlay on/off, Pause or resume the overlay, Copy the current caption. |

Pause freezes what the strip shows (a "Paused" line says so); it does not stop the engine. Copy puts the
newest sentence (original, then translation) on the clipboard.

Captions come from the session's lines (`AppState.call.lines`). The Mac app has no caption capture yet, so
there the strip shows "Listening …" until captions exist; **Preview** (Settings) shows sample captions.

Dev aids (Mac): `YSM_OVERLAY_DEMO=1` keeps the sample captions up; `YSM_OVERLAY_SNAPSHOT=<file.png>` writes
the strip to a file as it is drawn (screen capture needs a permission a test session may not have).
`docs/overlay-mac.png` is such a snapshot.

Not verified: the Windows window has only been compiled (`cargo check --target x86_64-pc-windows-msvc`),
never run.
