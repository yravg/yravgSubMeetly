# Roadmap: caption speed, quality and uptime (2026-11-21)

Owner goal: captions and translation fast and good on any laptop, 95-99 % uptime, accessibility kept.
Learned from Handy, FluidVoice, OpenWhispr (owner agreed to all 20 items on 2026-11-21).

## Done before this roadmap
- 1.4.7: /draft no longer queues behind a slow model (busy 503, slow-model notice); captions window (Pop out).
- 1.4.8 (pending): a model whose chosen folder is away loads from the default cache when a full copy is there.

## Work packages (one worker and one branch each)

| WP | Items | Acceptance (observable) |
|---|---|---|
| A GPU speech | 1 GPU (Vulkan/CUDA/Metal), 9 quantised models | On this laptop (RTX 4060 + Radeon 890M) /health says a GPU device; 4.8 s Chinese clip ASR under 0.5 s with Medium or large-v3-turbo; same build still runs on a PC without a GPU (CPU fallback, no crash, no missing DLL dialog). |
| B Clean input | 5 voice activity gate, 6 false-line filter | Silence and music clips give no caption; "Thanks for watching!"-type lines never appear; speech still captioned (tests with fixtures). |
| C Cloud speech | 3 bring-your-own-key speech (Groq, OpenAI), 4 local/cloud per feature with fallback, 19 privacy label | With a key, /draft uses the cloud and answers under 1 s; with the key wrong or offline it falls back to local within the same request; each line says where it was made. |
| D Right model | 7 speed test after download, 8 auto-pick by speed, 15 latency on pill, 16 speed on model cards, 20 presets | Model cards show "x real time" from the bench; a model slower than real time is marked "too slow for live"; first run picks the fastest model that is good enough; pill shows latency ms. |
| E Better words | 12 custom vocabulary, 13 AI clean-up (OpenRouter etc.) | Words list in Settings reaches Whisper's prompt; optional clean-up pass rewrites finished lines through the translation provider. |
| F Live feel | 10 keep model warm, 11 word-by-word streaming | First caption after start under 3 s on Base CPU; interim text grows while a sentence is spoken. |
| G Use it everywhere | 14 push-to-talk dictation, 17 history search and re-run, 18 SRT/VTT export of a live session | Global hotkey types speech into the focused app; Captions window exports SRT/VTT. |

| H Other speech models | SenseVoice-Small (zh/ja/ko/en/yue, non-autoregressive) and Parakeet-TDT v3 (25 European languages) through sherpa-onnx, DirectML/CPU | 4.8 s zh clip under 0.3 s on CPU; models listed and chosen like Whisper; falls back cleanly |
| I Settings | Model manager like the Chrome version (use, download, delete, state, speed); Advanced tab revamp | every old control still reachable; delete asks; keyboard and screen reader work |
| J BYOA | Use the person's own agent subscription (Claude Code, Codex, Gemini CLI, OpenCode) for summaries, Ask, refine | detected CLIs listed; fake-CLI tests for success, timeout, missing |
| K Stable input | Real Stop and Start; debounce Auto and meeting-source flips; device changes | Stop is immediate and sticky; Start runs in 1 s or says why; state-machine tests |

Owner asks added 2026-11-21 (afternoon): H, I, J, K. Started I, J, K; H after A merges (both touch the speech engine).

Order: A, B, D first (speed and uptime), then C, E, F, G.

## Rules for every worker
- Follow the Working discipline section of the global CLAUDE.md; never remove a feature; keep keyboard/screen-reader access.
- Tests first; engine `cargo fmt`, `cargo test`; island `cargo test -p poni-core` and `cargo check -p poni`.
- Do not edit CHANGELOG.md (the lead writes the entries at merge); put the entry text in the final report.
- Keep a checkpoint at `.checkpoints/<agent>.md` and update `docs/handoff/speed-quality.md` row when done.
