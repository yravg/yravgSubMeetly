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

## Benchmark (to fill at build)

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
