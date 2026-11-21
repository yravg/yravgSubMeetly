# Handoff: caption speed, quality and uptime

Roadmap: `docs/roadmap/speed-quality.md`.

| WP | State | Evidence |
|---|---|---|
| 1.4.7 backlog fix + captions window | done, installed on the laptop | 0c01d33, 740c454; Kasi-Setup-1.4.7.exe sha256 e6358f7b…9e6b |
| Folder-away fallback | done, installed in 1.4.8 | 4ffe2ad |
| Item 10 warm models at start, item 18 SRT/VTT from captions window | done, installed in 1.4.8 | b11b295 |
| 1.4.8 installer | installed on the laptop 2026-11-21 14:11; zh->en 3.3 s per 4.8 s line | Kasi-Setup-1.4.8.exe sha256 a057af94…71c5 |
| A GPU speech | in progress | worker wp-a-gpu |
| B Clean input | done, installed in 1.4.8 | 7cea3a0, 0f6d1ad (voice gate island, false-line filter engine) |
| D Right model | done, installed in 1.4.8 | worker wp-d-model, branch worktree-agent-a74d1b5539e9da413: poni-core `model_pick` (1.2x line, switch offer, bench after download / first use, presets), Settings › Models › Speech recognition rows; latency readout already existed (Captions › Display) |
| C Cloud speech | done, installed in 1.4.8 | 06b72a7; test cloud_speech::after_a_failure_the_cloud_rests… flaky under load |
| E Better words | open | |
| F Live feel | open | |
| G Use it everywhere | open | |

Laptop facts: Ryzen AI 9 HX 370 (12 cores), RTX 4060 Laptop 8 GB, Radeon 890M. No CUDA toolkit or Vulkan SDK installed (2026-11-21).
Whisper Medium CPU: 0.3x real time (unusable live). Base CPU: 4.8 s clip in 1.8-2.5 s. D: drive (model folder) often not connected.

Next step: merge worker branches one at a time, write CHANGELOG entries, bump version, build installer, install on the laptop.
