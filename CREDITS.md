# Credits and origins

yravgSubMeetly stands on other people's work. This page says where each idea and each piece of code came from, so anyone can trace it back. Licence texts for bundled code are in [`island/LICENSE`](island/LICENSE), [`island/THIRD-PARTY-NOTICES.txt`](island/THIRD-PARTY-NOTICES.txt) and the README's [Open-source components](README.md#open-source-components) table.

## Projects this app is built on or learned from

| Project | What we took | Licence | How |
|---|---|---|---|
| [Oyenza Studio / Poni](https://github.com/lucacadalora/oyenza-studio) by Jatevo Labs | The Windows island in [`island/`](island/) is a fork of its "living notch" (upstream commit `bfbed6d`, release 0.2.26). The Windows installer and the signed update file (`latest.json`, the "Update available" pop-up) follow its structure. | MIT | Code forked, licence kept. The Oyenza name, the Oyen character, the logo and the app icon are not MIT and are not used: see [`island/NOTICE.md`](island/NOTICE.md). Signing keys, release repository, art and installer script are ours. |
| [Meetily](https://github.com/Zackriya-Solutions/meetily) by Zackriya Solutions | Structure of the macOS app in [`mac/`](mac/): sidebar of meetings, recording pill and status bar, four-step onboarding, tabbed Settings, design tokens (radius, shadow, motion steps). | MIT | Rebuilt in SwiftUI from its design system (version 0.4.1) with our own brand colours and our own code. |
| [Threadbear](https://github.com/mikecann/threadbear) by Mike Cann | Ideas for the Minutes register: Inbox of open items across meetings, Projects with a rule-based librarian, Highlights, patches that became our add-ins. | MIT | Ideas only; mapped in [`docs/roadmap/threadbear-mapping.md`](docs/roadmap/threadbear-mapping.md), no code copied. |
| "Local AI Subtitle" Chrome extension | The first idea: live subtitles for any browser tab, computed on the device. | — | Rebuilt from scratch on an open stack; no code copied. |
| Coretax UI kit | Patterns of the "Coretax · paper" theme (warm canvas, navy structure, gold highlight). | — | Patterns only; colour values and assets are our own. |
| [LRCLIB](https://lrclib.net) | Synced lyrics for the island's music extra (inherited from Oyenza Studio). | Public API | Credited in the island's tray menu. |

## Engines and models

| Component | Use | Licence |
|---|---|---|
| [candle](https://github.com/huggingface/candle) by Hugging Face | Whisper and Qwen2.5 inference in the Rust engine ([`engine-rs/`](engine-rs/)) | Apache-2.0 / MIT |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) by SYSTRAN | Former engine of the native helper; the Rust engine was checked against its output (WER ≤ 0.021) | MIT |
| OpenAI Whisper | Speech recognition models | MIT |
| Qwen2.5 Instruct by Alibaba Cloud | Translation and draft refinement | Apache-2.0 for the 0.5B, 1.5B and 7B models; check the model card for other sizes |
| Hugging Face transformers.js, Microsoft ONNX Runtime Web | In-browser engine of the extension | Apache-2.0, MIT |
| Helsinki-NLP Opus-MT | In-browser translation | CC BY 4.0 |
| Silero VAD, @ricky0123/vad-web | Voice activity detection | MIT, ISC |
| [Symphonia](https://github.com/pdeljanov/Symphonia) | Audio decoding in the Rust engine (no ffmpeg needed) | MPL-2.0 |
| [Inno Setup](https://jrsoftware.org/isinfo.php) | Windows installer | Inno Setup licence |

Model weights belong to their authors and institutions.

## Our own earlier work reused here

- **DCS_DocConSystem**: the training and gamification pattern (XP, levels, tours, quiz) in the Minutes register.
- **Solvarium** and the **yravg UI catalogue** ([uiux.yraveragehub.io](https://uiux.yraveragehub.io)): the JS-plus-Rust engine pattern (golden files from the JavaScript or Python reference, Rust must match) and UI pieces.

If you see your work here without proper credit, or credited wrongly, please open an issue.
