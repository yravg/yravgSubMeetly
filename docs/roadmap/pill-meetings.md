# Meetings on the pill, no browser (roadmap)

Owner request 2026-11-10: everything about meetings must work from the island
(`yravgSubMeetly.exe`) alone, without Chrome or the extension, with no setup
beyond pasting a calendar link. Choose any meeting (current or past) and open
its minutes; import a transcript by copy-paste (Teams captions or transcript,
read.ai, VTT/SRT, plain "Name: text"); act on the minutes on the pill.

Handoff: `docs/handoff/pill-meetings.md`.

## Gap list (2026-11-10, island 1.2.4)

1. Calendar row "Captions" opened Chrome / the extension setup page.
2. Meeting page shows only the newest meeting; no way to pick another.
3. Meeting page shows 5 items, the rest are "+N more in the register" (unreachable on the pill).
4. No transcript import on Windows (the extension has Teams paste; the pill has none).
5. Inbox rows cannot open their meeting.
6. Calendar hides meetings that ended; Notes on a past meeting is impossible.
7. Captions saved during a calendar meeting get a generic title (`running_event_title` returned None).
8. Join opens the browser even when Teams is installed.

## Scenarios

### Top 10, must have

| # | Workflow | Acceptance (what the person sees) |
| --- | --- | --- |
| M1 | Paste an Outlook/Google ICS link on Calendar | Meetings of the week appear within a minute, "Reading your calendar" meanwhile; a refusal says why |
| M2 | Press Captions on a calendar row | Island captions start (no browser), page switches to Live |
| M3 | A Teams call or a video plays | Captions start by themselves; stop 90 s after; saved as a meeting |
| M4 | Captions stop during a calendar meeting | Saved meeting carries that event's title |
| M5 | Pick any meeting on the Meeting page | ‹ › steps through every meeting newest first, "3 of 14", date shown; Accept/Carry/Assign act on the shown meeting |
| M6 | Read every item of a meeting | Items page with ‹ › when more than 5; no item unreachable |
| M7 | Paste a transcript (Teams, read.ai, VTT/SRT, "Name: text") | Copy, press "Paste transcript": a meeting with drafted decisions and actions opens; speakers kept; timestamps and VTT noise dropped |
| M8 | Paste a transcript into a meeting started from Calendar Notes | The empty calendar meeting gets the lines and the draft, keeps its title and attendees |
| M9 | Calendar shows past meetings | "Earlier" toggle lists meetings that ended this week; Notes opens or creates their minutes and selects them |
| M10 | Inbox row opens its meeting | Pressing the text of a row selects that meeting on the Meeting page |

### 20 secondary

S1 Join a Teams link opens the Teams app when installed (msteams:), else the browser. S2 Notes on an event that already has minutes selects them, never a duplicate. S3 Paste with an empty or non-transcript clipboard explains what to copy. S4 Paste while the engine is off says the engine is not answering and keeps nothing half-saved. S5 Selected meeting deleted elsewhere: page falls back to the newest. S6 New meeting saved (captions stop / paste) becomes the selected one. S7 Issued meeting: read-only, picker still works. S8 Done/Carry in Inbox keep working across meetings. S9 Calendar refresh keeps the selected meeting. S10 Teams "Copy transcript" with "Name  0:01" lines. S11 Teams live captions copy ("Name: text" per line). S12 read.ai paste with "Name (00:01:02): text" and summary headers. S13 VTT with `<v Name>` cues and NOTE blocks. S14 SRT with numbered cues. S15 Plain notes without speakers still give lines. S16 Very long paste (> 3000 lines) keeps the last 3000, says so. S17 Captions running while choosing another meeting: Live still follows the engine line. S18 Auto captions setting off: nothing starts by itself. S19 Calendar link removed: past and upcoming meetings disappear, minutes stay. S20 Island restart keeps meetings (engine store) and the setting.

### 20 tertiary

T1 Two meetings with the same title are told apart by date. T2 All-day events never trigger captions. T3 Calendar with only past events shows the Earlier list. T4 Event without join link: Captions still starts island captions. T5 Paste of a non-English transcript keeps the text as is. T6 Assign with no attendees explains. T7 Carry on the last meeting of a series. T8 Picker at first/last meeting disables the arrow. T9 Items page resets when another meeting is chosen. T10 Pasted speaker names become attendees. T11 Duplicate paste (same text twice) does not create two meetings. T12 Clipboard holding an ICS link on Meeting page is refused as a transcript. T13 Notes button on Calendar while engine is offline says so. T14 Calendar every-minute refresh does not clear the paste notice. T15 Music app playing does not start captions. T16 Video paused for less than 90 s keeps captions. T17 Pressing Stop during a meeting holds until the meeting ends. T18 Speech model missing: Live offers Download, auto start does not loop. T19 Tray Start/Stop still work. T20 Settings window shows and toggles "Start captions by themselves".

## Order

Build M4 → M5/M6 (selection in `poni_core::helper::View`) → M7/M8 (`poni_core::transcript_paste` parser, tested on real formats) → M9 → M10 → S1. Each step: failing test first in poni-core, then the page.

## Open questions

- Opening the full Minutes register (`minutes.html`) still uses a Chrome/Edge `--app` window; a native register is out of scope for the pill.
