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

## Model speed tests (Advanced settings › Models › Speed)

The engine measures how fast each downloaded model runs **on this PC**: `POST /models/bench` queues tests (`{"id": "<model>"}`, `{"ids": [...]}` or `{"kind": "asr" | "translate" | "pair" | "all"}`; 202, one at a time in the background; 409 for a model that is not downloaded), `GET /models/bench` answers `{runs: {id: [run, ...]}, active: {id, kind, progress} | null, queue: [...], failed: {id: reason}}`. Results are kept in `bench.json` in the engine state folder (last 10 runs per model; `ENGINE_BENCH_PATH` moves it). Nothing is ever shipped or invented: a model nobody tested has no number.

| Model | What runs | Headline | Detail |
|---|---|---|---|
| Speech (Whisper) | three 4 s windows of a real English recording (CC0, `test/samples/cc0/en-1.mp3`, embedded in the engine), after one untimed warm-up window | times real time: audio seconds per compute second for one 4 s window | mean ms per window |
| Translation (Qwen) | eight fixed English sentences to Indonesian, greedy, after a warm-up | tokens per second | mean ms per sentence |
| Fast pair (OPUS-MT) | the same eight sentences in the pair's direction (en-xx or id-en) | sentences per second | mean ms per sentence |

Each run is stamped with the device (`cpu`, `metal`, `cuda`), the time and the engine version. The island draws one bar chart per group (bars scale within a group because the units differ), a small history line beside each bar, a Test / Retest / Retry button per model and Test all downloaded; a test under way shows its progress in yellow and a failed one shows its reason in red. The test loads its own copy of the model, so it never changes the model a caption session is using (it does need the memory of one more model while it runs).
