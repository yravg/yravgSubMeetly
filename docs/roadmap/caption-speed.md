# Caption speed study (PMM-025 to PMM-027)

Source studied: github.com/SakiRinn/LiveCaptions-Translator (LCT), Apache-2.0, C#/WPF, read 2026-11-10
(shallow clone, nothing run). We reimplement ideas in Rust with our own prompts; no code or prompt text
is copied, so no Apache obligations apply.

## How LCT is fast

- Text, not audio: it reads Windows 11 Live Captions' UI Automation element `CaptionsTextBlock` every 25 ms
  (read 10-20 ms). Words appear as Windows hears them; no ASR cost of its own.
- Sentence logic: it translates the tail after the last `.?!。？！`; a finished sentence is translated at once,
  a changing partial every 3 loop passes, an unchanged partial after about 1.25 s (idle flush).
- Newest wins: finished translations cancel older in-flight ones (we do the same).
- Optional context: the previous 2 source/translation pairs go in as chat turns.
- Options: latency readout per line, overlay font/colour/opacity/sentences shown, log only (no translation),
  history with CSV export, many translation backends (Ollama, OpenAI-compatible, DeepL, ...).
- No caching; no end-to-end latency numbers published.

## Our pipeline today (1.2.9)

Fixed 4 s windows, no overlap (`poni-core/src/capture.rs` `Chunker`, `WINDOW_S`), silence skipped, one
`/draft` in flight, newest wins (`island/crates/poni/src/services/capture.rs` `post_loop`); engine `/draft` =
Whisper then Qwen (`engine-rs/engine/src/app.rs` ~630-740). Every line waits for its 4 s window plus ASR plus
translation, and sentences are cut at window edges.

## What we adopt, ranked

| # | Idea | Gain | Effort | Where |
| --- | --- | --- | --- | --- |
| A | Utterance buffer: re-post the growing utterance every 1-1.5 s as **interim**, finalise on silence or 15-20 s; pill shows interim then replaces it with the final line | high | medium-high | `poni-core/src/capture.rs` (Chunker -> utterance buffer), `services/capture.rs` post_loop + `SessionLog.push`, `/draft` `interim` flag |
| B | **Windows Live Captions** as optional ASR source ("Fast (Windows captions)" vs "Accurate (Whisper)"): UIA read of `CaptionsTextBlock`, translate with engine `/translate`; never kill the user's Live Captions window; loopback off in this mode | high | medium | new `services/livecaptions.rs`, setting beside `auto_captions` |
| C | Translate per **sentence end** or 1.25 s idle, not per window; interim lines get the fast prompt, final lines `/translate_refine` | medium-high | low-medium | `services/capture.rs`, `/draft` `accurate`, `translate.rs` |
| D | **Context**: previous 1-2 source/translation pairs as chat turns (`chat_prompt_turns` exists); test on Qwen 1.5B/3B, 0.5B may copy context | medium (quality) | low-medium | `engine-rs/engine/src/translate.rs` `translate_prompt`, /draft handler |
| E | **Latency readout** (`ms`, `asr_ms`, `translate_ms` already in `/draft`) + pill font size, sentences shown, original / translation / both, log only | medium (trust) | low | pill pages + Captions tab (PMM-022) |
| F | Optional **OpenAI-compatible / Ollama** translation endpoint, opt-in and labelled "not offline"; fixes weak 0.5B Indonesian | medium | medium | `translate.rs` |
| G | Caching / similarity overwrite | low | low | skip |

Order: C + E first (cheap, visible), then A, then B behind a setting, D and F last.

## Engine benchmark (PMM-027, step 4.7)

Harness: `engine-rs/engine/tests/caption_bench.rs` (ignored test). It drives the engine's own `Ml`
the way `/draft` does (Whisper, then `Ml::translate_fast`) on the committed CC0 clips
`test/samples/cc0/{en-1,id-1,zh-1,ja-1}.mp3` (about 20 s each) cut into 4 s windows like the island,
then a fixed sentence set and a 20-sentence English -> Indonesian meaning check. Run from `engine-rs`:

```
HF_HUB_CACHE=<cache> WHISPER_MODEL=base TRANSLATE_MODEL=<catalog id> \
  cargo test --release --test caption_bench -- --ignored --nocapture
```

"First text" = end of the first window with speech + its ASR time (no queueing); "first translation"
adds that window's translate time. Laptop, CPU, release build, 2026-11-11.

### BEFORE: whisper-base + Qwen2.5-0.5B-Instruct (today's defaults)

| Clip | First text | First translation | ASR RTF | Translate p50 |
| --- | --- | --- | --- | --- |
| en-1 en->id | 5143 ms | 6012 ms | 0.29 | 869 ms |
| id-1 id->en | 5667 ms | 6558 ms | 0.42 | 958 ms |
| zh-1 zh->en | 5180 ms | 5551 ms | 0.31 | 570 ms |
| ja-1 ja->en | 5265 ms | 6089 ms | 0.39 | 908 ms |

Sentences, fast translate, p50 / p95: en-id 1093 / 1388 ms (n=20), id-en 790 / 946, zh-en 662 / 792,
ja-en 768 / 938, en-zh 670 / 769. Load: whisper-base 20.5 s, Qwen2.5-0.5B 25.6 s (cold, cache on D:).

Indonesian meaning check (judged by hand; correct = core meaning kept, no false fact): **4 of 20**
(good morning / start, mute microphone, agree but cost too high, price includes transport). Typical errors: "weather" -> "Kebijakan" (policy), "Friday" -> "Sabtu", answers
the question instead of translating ("Tentu, saya bisa ..."), negation flipped, "contractor" -> "Kantor".

Reading: about 4 s of every first-text figure is the window itself; ASR adds 1.0-1.7 s, translation
0.6-1.0 s. A faster translation model cannot reach the 1.5 s target alone: that needs the utterance
buffer (A) and per-sentence translate (C) on the island side.

### AFTER: Qwen3 q4_k_m GGUF (candle `quantized_qwen3`)

Same harness, same day, whisper-base unchanged (so first-text and ASR RTF move only by noise).
The GGUF tokenizer is rebuilt from the file's metadata; `tests/gguf_tokenizer.rs` checks it encodes and
decodes exactly like Qwen3's own tokenizer.json (passed on the 0.6B file).

| Translate model | en-id p50 / p95 | id-en | zh-en | ja-en | en-zh | ID meaning | Size |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen2.5-0.5B f32 (BEFORE) | 1093 / 1388 | 790 | 662 | 768 | 670 | 4/20 | 988 MB |
| Qwen3-0.6B q4_k_m | 251 / 298 | 210 | 194 | 190 | 178 | 7/20 | 397 MB |
| **Qwen3-1.7B q4_k_m** | **599 / 702** | 490 | 456 | 446 | 441 | **16/20** | 1107 MB |

(ms per sentence, fast prompt.) Recordings, first translation (first text + translate of that window):

| Clip | BEFORE | Qwen3-0.6B | Qwen3-1.7B |
| --- | --- | --- | --- |
| en-1 en->id | 6012 ms | 5619 ms | 5969 ms |
| id-1 id->en | 6558 ms | 6014 ms | 6208 ms |
| zh-1 zh->en | 5551 ms | 5329 ms | 5210 ms |
| ja-1 ja->en | 6089 ms | 5661 ms | 5928 ms |

Translate p50 per window: 1.7B 436-610 ms, 0.6B 230-271 ms, BEFORE 570-958 ms.

Qwen3-1.7B misses (4/20): "next meeting" -> "Kunjungan" (visit), "next month" -> "besok" (tomorrow),
"Can everyone hear me" -> "Siapa yang bisa" (who can), "approval" -> "Pengalaman" (experience).
Qwen3-0.6B is fast but still drops or swaps facts (cool for warm, "rapat" for report, "4th month").

**Default changed to `unsloth/Qwen3-1.7B-GGUF`**: faster than the old default on every pair (about 1.8x on
en-id) and 16/20 against 4/20 on meaning, with less RAM (q4 file mapped, no f32 copy: the old default
grew the process to about 3 GB while loading). 0.6B stays in the catalog as the fast choice.

Load times are not comparable this session: D: (exFAT, shared with other workers' builds) had a disk
queue of 10-12 during some runs, so the same Qwen2.5-0.5B load took 25.6 s in one run and 498 s in another.
A separate fix removed the network from model loads (below), whisper-base then loaded in 245 ms.

### Model loads no longer ask the Hub

`ml::hub_file_with` resolved `main` over the network on every load (one round trip per file) and only
used the cache after a transient error; on this link a load hung for minutes. It now returns a cached file
(or a cached 404) without a request; downloads are unchanged. Cost: a newer upstream commit is not picked
up until the cached model is deleted.

### OPUS-MT pairs (fast tier)

Kind `translate-pair`, five catalog rows (en-id, id-en, en-zh, zh-en, ja-en); when a pair is downloaded,
`/draft` and fast `/translate` use it for that pair and the LLM for every other pair (`Ml::translate_fast`).
The repos' `pytorch_model.bin` is a legacy pickle candle cannot read, so the weights come from the Hub
conversion bot's safetensors pull request (pinned per pair in `marian.rs`).

Measured en-id only (the other four pair files did not finish downloading on this link), with the new
default Qwen3-1.7B serving the other pairs:

| en -> id | p50 / p95 | Meaning check | en-1 first translation |
| --- | --- | --- | --- |
| Qwen2.5-0.5B (BEFORE) | 1093 / 1388 ms | 4/20 | 6012 ms |
| Qwen3-1.7B q4 | 599 / 702 ms | 16/20 | 5969 ms |
| **OPUS-MT en-id** | **99 / 121 ms** | **19/20** | 5309 ms |

Its one miss: "minutes" (of a meeting) -> "menit" (time). It uses the informal register (kau, aku).
Load: 262 ms including the first sentence. OPUS-MT is only used when its pair is downloaded; nothing pulls
it by default yet, so whether onboarding pulls the user's pair is an island decision.
Not measured: id-en, en-zh, zh-en, ja-en pairs (weights not downloaded), CPU %.

## Island benchmark (to fill at build)

Same recording (2 min English speech, 1 min Chinese), laptop, Whisper base + Qwen 0.5B:

| Metric | 1.2.9 | After A+C | Windows captions (B) |
| --- | --- | --- | --- |
| Speech start -> first text on pill | | | |
| Sentence end -> final line | | | |
| Final line -> translation | | | |
| CPU % average | | | |

Target (PMM-025): first text under 1.5 s.

## Not verified

Live Captions language list vs our 12 languages; whether `CaptionsTextBlock` still exists on this Windows
build (10.0.28000); Whisper cost of re-posting growing utterances on this laptop; Microsoft's terms for reading
Live Captions through UI Automation.
