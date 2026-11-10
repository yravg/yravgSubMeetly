# Engine model catalog: fast and upgradable ASR + translation (study, 2026-11-11)

Owner ask: captions (ASR from PC audio) and translation must be very fast; the engine offers several
models to choose and download, upgradable as newer models appear. Speed work itself: `caption-speed.md`
(PMM-025..027). This file chooses WHICH models the picker offers.

Engine runtime: candle 0.11.1 (`engine-rs/engine`). Catalog today (`engine/src/models.rs`):
whisper base/small/medium/large-v3-turbo, Qwen2.5 0.5B/1.5B/3B Instruct (f32 safetensors).
Known problem: Qwen2.5-0.5B gives wrong Indonesian meanings.

Sources read: HF Spaces categories language-translation and speech-synthesis (by likes), model cards,
candle `candle-transformers/src/models` on main. No leaderboard numbers were retrievable (Open ASR
Leaderboard and TTS Arena render client-side). Nothing below was measured on our hardware.

## What candle runs natively (main branch; 0.11.1 tag not compared)

whisper (+ quantized, q8_0 GGUF shipped only for tiny), marian, t5 / quantized_t5, qwen2, qwen3,
quantized_qwen2, quantized_qwen3, gemma3, quantized_gemma3, voxtral, mimi.
Not in candle: m2m100/NLLB, parakeet, moonshine, Qwen3-ASR (PR #3509 unmerged), Hunyuan.

## Ruled out for our languages (id, zh, ja, en)

distil-whisper large-v3.5 (English only), parakeet-tdt-0.6b-v3 and canary-1b-v2 (25 European languages),
Kyutai STT (en/fr), Moonshine streaming (English), Voxtral Mini (no id/ja), NLLB-200 (CC-BY-NC,
non-commercial), 7B MT models (Hunyuan-MT-7B, Seed-X) too slow on CPU.

## Proposed picker

| Kind | Tier | Model | Path | Why |
| --- | --- | --- | --- | --- |
| ASR | Fast | openai/whisper-base | native, today | CPU fallback; weak on Indonesian |
| ASR | Balanced (default) | openai/whisper-small, later Qwen/Qwen3-ASR-0.6B | native / port | Qwen3-ASR-0.6B: 30 languages incl. id/zh/ja, streaming, Apache-2.0, card TTFT ~92 ms on GPU |
| ASR | Accurate | openai/whisper-large-v3-turbo, later Qwen3-ASR-1.7B | native / port | |
| ASR | zh/ja fast path (optional) | FunAudioLLM/SenseVoiceSmall | onnx (sherpa-onnx) | non-autoregressive, ~70 ms per 10 s audio (vendor); no Indonesian; extra runtime |
| MT | Fast | Helsinki-NLP opus-mt Marian per pair (en-id, id-en, en-zh, zh-en, ja-en) | native (`marian`) | ~75M, expected <100 ms per sentence on CPU; no usable en->ja (fall back to LLM) |
| MT | Balanced (default) | Qwen/Qwen3-1.7B q4_k GGUF | native (`quantized_qwen3`) | all four languages, no port; should fix Indonesian meaning errors of Qwen2.5-0.5B (to measure) |
| MT | Accurate | tencent/Hy-MT1.5-1.8B, or google/translategemma-4b-it q4_k | port / native (`quantized_gemma3`) | Hy-MT built for real-time edge MT, 33 languages; TranslateGemma gated, Indonesian coverage not confirmed |

## Order of work (to fold into step 4.7 of `docs/handoff/pill-media-meeting.md`)

1. Benchmark harness first (same local recording, same sentence set in en/id/zh/ja): first text, ASR ms,
   translate ms per sentence, CPU %, plus a 20-sentence meaning check for Indonesian.
2. Native, no port: add `quantized_qwen3` path + Qwen3-1.7B q4_k (and 0.6B q4_k as Fast LLM), Marian
   opus-mt pairs as Fast MT with LLM fallback for unsupported pairs. Measure q4_k vs f32 Qwen2.5 on this laptop.
3. Quantized whisper: convert small and large-v3-turbo to q8_0 with candle `tensor-tools quantize`; keep
   only if measured faster (encoder is compute-bound, gain uncertain).
4. Catalog becomes data, not code: tier, kind, languages, size, license, path per entry, so newer models
   are added as rows.
5. Ports, each its own step after 1-4 land: Qwen3-ASR-0.6B (streaming, best language fit), Hy-MT1.5-1.8B.

## Not verified

Hy-MT license terms; TranslateGemma Indonesian coverage; quality of community Rust Qwen3-ASR crates
(`voxora-qwen3asr`, `aha`); every speed figure (model cards only). Speech synthesis (TTS: Kokoro,
Qwen3-TTS, Chatterbox, ...) was surveyed but is not part of captions; no TTS feature is planned.
