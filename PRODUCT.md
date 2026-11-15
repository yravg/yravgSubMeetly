# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-11-15 without an interview: the owner was away and asked for autonomous work. Facts marked *(inferred)* come from the repo and the owner's messages, not from a confirmed answer.

## Platform

web (this record covers the public landing page in `site/`; the product itself ships as a Windows and a macOS desktop app plus a Chrome extension)

## Stack

delegated *(inferred)*: plain static HTML, CSS and JavaScript in `site/`, no build step, so it can be served by GitHub Pages from the public repo `yravg/yravgSubMeetly`, the way the style reference (rama2555.github.io/nusa) is served.

## Users

People who sit in many online meetings and watch talks or videos in a language that is not their first, on a Windows laptop or a Mac: project and office teams that meet across languages (for example English, Mandarin and Indonesian) and must issue minutes afterwards *(inferred)*.

## Product Purpose

yravgSubMeetly puts a small pill at the top edge of the screen that shows live captions of whatever the computer plays or hears (a Teams, Zoom or Webex call, a YouTube video, the room microphone), translates them, and turns a meeting into minutes: decisions, actions, questions, with the transcript beside them. Success: you follow a meeting in a language you half-know, and you leave it with minutes already drafted.

## Positioning

Everything runs on the computer. Speech recognition (Whisper) and translation (OPUS-MT, Qwen) run on the device after a one-time model download; no account, no telemetry, no audio or transcript sent to a yravgSubMeetly cloud. It lives in the screen's top edge instead of a window, and it knows a meeting from a video (Teams, Zoom, Webex, Slack huddle use of the microphone).

## Operating Context

- The pill rests at the top centre of the screen (32 px tall, black) showing the time and battery, and opens on hover into tabs: Live, Minutes, Media, Today (calendar), Captions, Focus, Shelf, Prayer and more; tabs can be reordered.
- Captions start by themselves when a call or a video plays; sources are Room (microphone), This PC, or Both.
- Minutes: a register of records with Accept, Carry and Assign per item, the transcript side by side, translate a transcript again into any language, and a full Minutes app window.
- YouTube closed captions are fetched ahead of time and translated before the line is spoken (1.4.4, 1.4.5).
- Calendar from an Outlook ICS link with a Join button for Teams.

## Capabilities and Constraints

- Current release v1.4.5 (2026-11-12): `yravgSubMeetly-Setup-1.4.5.exe` 35.1 MB (Windows 10/11), `yravgSubMeetly-1.4.5-mac.dmg` 67.4 MB (macOS, universal). Releases and a signed `latest.json` live on GitHub releases; the apps update from it.
- Models download once from Hugging Face or ModelScope; size depends on the model chosen.
- Speaker labels are approximate (You / Others, Speaker 1..N).
- Undecided: a public domain, a support or donation channel, store listings (Microsoft Store, Mac App Store). Do not invent them.

## Brand Commitments

- Name: **yravgSubMeetly**, part of the yravg family (lowercase `yravg`). Older internal name yraverageSubMin.
- Every UI string in English and Indonesian.
- Mascot: the owner rejected Bud (green plush seedling, yravgBuds) as "too generic" and wants a mascot on par with top-chart apps of 2026 *(owner, 2026-11-15)*. Tide (white otter) is the current in-app mascot from yravgBuds.
- Style reference for the landing page: rama2555.github.io/nusa *(owner, 2026-11-15)*: dark, one big live demo of the notch, short sections, EN/ID switch. Borrow structure and feel, not its words, art or purple look.

## Evidence on Hand

- Real: release sizes and dates above, the changelog (`CHANGELOG.md`), screenshots in `island/docs/` (pill, Minutes register).
- Absent, never fabricate: download counts other than what the GitHub API returns live, memory or CPU benchmarks, user testimonials, press, ratings.

## Product Principles

1. On the device or not at all: every claim about privacy must be literally true of the code.
2. Out of the way until needed: the pill rests small and opens on hover.
3. The meeting ends with minutes, not just a transcript.
4. Bilingual by default (English and Indonesian).
