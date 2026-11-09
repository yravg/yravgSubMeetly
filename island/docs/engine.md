# The engine and the island

The island runs the Rust engine (`submeetly-engine.exe`) itself. Every 2.5 s it asks `/health`; when nothing answers it starts the engine (up to 3 tries, 20 s apart) and stops it again when the island quits. An engine that was already running (a dev helper, another island) is used as it is and left alone.

Where it looks for the engine exe: `SUBMEETLY_ENGINE_EXE` (full path), else next to the island exe. The installer puts both in `%LOCALAPPDATA%\Programs\yravgSubMeetly`.

The Meeting, Live, Inbox, Talk time, Agenda timer and Engine pages say what the supervisor is doing while nothing answers: "Starting the engine…", "Engine not found" (reinstall, or set `SUBMEETLY_ENGINE_EXE`), "Engine would not start" (port busy). **Try again** starts the engine and asks again.

## Dev runs

| Variable | Effect |
|---|---|
| `SUBMEETLY_ENGINE_EXE` | Full path of the engine exe, e.g. `E:\cargo-target\x\release\submeetly-engine.exe` |
| `YSM_HELPER_PORT` | Port the island asks and the engine listens on (default 17865) |
| `YSM_STATE_DIR` | Engine state (notes) directory, default `~/.yraveragesubmin` |
| `PONI_HOME` | Own settings/cache directory; a run with it is its own instance, next to an installed island |

A dev island next to the installed one: set `PONI_HOME`, `YSM_HELPER_PORT` (not 17865) and `SUBMEETLY_ENGINE_EXE`. Set `island_x` in its `settings.json` to move the pill off the installed island, and `collapse_delay_ms` high so it stays open for a screenshot.

Screenshots: `desktop-meeting-engine-missing.png` (exe not found), `desktop-meeting-engine-starting.png` (engine launching), `desktop-meeting-engine-connected.png` (register read from the engine).
