agent: pmm-speed
task: step 4.7 engine half: PMM-027 bench harness, Qwen3 GGUF + OPUS-MT fast MT, catalog rows (no commit)
brief: team-lead message; docs/roadmap/model-catalog.md "Order of work", docs/roadmap/caption-speed.md
worktree: E:\dev\yraverageSubMeetly (engine-rs + docs/roadmap/caption-speed.md only)
servers started: none running (all downloaders and bench runs stopped/finished; installed engine untouched)
unreverted change: none
done: harness tests/caption_bench.rs, tests/gguf_tokenizer.rs (both ignored)
done: BEFORE Qwen2.5-0.5B en-id p50 1093 ms 4/20; Qwen3-1.7B q4 599 ms 16/20; Qwen3-0.6B q4 251 ms 7/20; OPUS en-id 99 ms 19/20
done: default translate -> unsloth/Qwen3-1.7B-GGUF; ml::hub_file_with cache-first; OPUS weights from safetensors PR refs
done: gate fmt/clippy -D warnings/cargo test green (TEMP on NTFS; D: exFAT breaks one hard-link test)
not done: OPUS id-en/en-zh/zh-en/ja-en measurement (partial .part files in D:\sm-hf\hub); step 3 catalog-as-data; CPU %
next: finished
