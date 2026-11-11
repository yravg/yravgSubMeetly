# Speaker labels ("who said what")

Our own light implementation, on-device, no model download (`engine-rs/engine/src/diarize.rs`). It does not use
Meetily Pro's code (a closed, paid edition); Meetily Community is open source and only the idea of the feature is shared.

## What it does

`POST /diarize` on the engine:

```json
{ "segments": [{ "t0": 0.0, "t1": 3.2, "text": "Hello", "channel": "mic" }, { "t0": 3.4, "t1": 6.0, "text": "Hi" }],
  "path": "/abs/path/to/recording.m4a", "maxSpeakers": 0 }
```

returns the same segments with a `speaker`, the set of speakers, and `method` (`channel` or `acoustic`).

1. **Channel labels (exact):** a segment with `channel` "mic" is **You**, "system" is **Others**.
2. **Acoustic clustering (approximate):** segments without a channel are matched to voiced stretches of the audio file at
   `path` (energy gate, split at pauses, one small voice fingerprint per stretch, average-linkage clustering) and named
   **Speaker 1..N** in order of first appearance. `maxSpeakers` 0 lets the distances decide (up to 8).

Notes documents (`POST /notes`) keep an optional `speaker` on each transcript line; older documents have none.
The island shows it in front of the current caption line (Settings > Captions > Show who is speaking).

## Limits (read before trusting it)

- It is **not a neural speaker model**. It separates voices that differ clearly (a low and a high voice, a near and a far
  microphone). Similar voices, overlapping speech, music, noise and stretches under ~0.4 s are not handled well.
- Two remote people on the same system-audio channel both come out as **Others** unless the audio file is clustered.
- Labels are a reading aid, not evidence of who spoke. The Windows island captures only system audio and does not label
  live lines yet; labels appear for notes that carry them.
