# Inventory: Threadbear-tier boards (T01, T02, T04, T05)

Reference: Threadbear (MIT), native Swift under `app/Sources/...`, read from a sparse clone. Meeting equivalent: the sample meeting "Rapat Komite K3 W01" (series LIB-HSE2). Code: `threads.mjs` (shell + reducer), hooks in `build.mjs`. T03 is owned by another agent.

Owner comments (T01): all three panels (left, main, right), the same interactions as the threads, keep the "finished threads before archive" panel. Result: every T board uses one three-pane shell (rail + left list, main thread, right detail) driven by one pure reducer that works both on the static page and in the Claude Design Component class.

## T01 Inbox zero (13 rows: 12 landed, 1 dropped with reason)

| # | Reference (file:line) | Meeting equivalent | Where on the board |
|---|---|---|---|
| 1 | SidebarView.swift:23 left pane | Left list of open threads across meetings | Left pane, NEW outline |
| 2 | SidebarView.swift:86 ThreadSearch | Search field | Search box (shown, not wired) |
| 3 | SidebarView.swift:50 InboxList, ThreadSections.swift:16 InboxSection, :37 InboxOrder | Open actions, questions, unowned risks, newest first, unread dot | Inbox section, filter chips All/Decisions/Actions/Questions/Risks (chips toggle) |
| 4 | SidebarView.swift:70 ArchiveRows; AppModel+ThreadActions.swift:625 archive | Finished section (done, not yet archived) with Archive all | Finished section, Archive all link |
| 5 | AppModel+ThreadActions.swift:668 undoArchive | Undo after archive | Toast with Undo (restores to Finished) |
| 6 | AppModel+ThreadActions.swift:758 unarchive | Restore / Reopen | Reopen button in Finished banner, Restore in Archived banner |
| 7 | SidebarView.swift Archived section | Archived, folded | Archived row, click to unfold |
| 8 | SidebarView.swift:126 InboxZero | Inbox zero names the next meeting | Zero state in list and main pane |
| 9 | SidebarView.swift:179 ThreadSection; main thread view | Open thread: quote with timecode, replies | Main pane; click any of 5 threads |
| 10 | HighlightsView.swift:86 Needs you; AnswerChips.swift | Needs-you card with Done / Snooze / Carry (or Accept / Edit / Dismiss) | Card above composer; Done moves to Finished and opens the next thread |
| 11 | Composer | Reply box | Composer; Edit / Review buttons append a reply |
| 12 | HighlightsView.swift:14 right pane | Owner, due, status, source timecode, confidence, linked items, history | Right pane per thread |
| 13 | tb-phone-inbox (phone layout) | none | Dropped on the board: side panel is not a phone; kept as a reference image only |

## T02 Librarian (9 rows, 9 landed)

LibrarianView.swift:8 header, :80 Pause/Resume, :83 "Look at everything", :119 QueueRow, :147 EntryRow. Landed as: left list "To confirm" with filed section; suggestion card with a "Why" line (chair, attendees, title match); Accept / Change / Dismiss; Pause / Resume strip; project notes and look history in the right pane; Filed section with Archive all; Unfiled item; states. "Look at everything" is not a button on the board (the librarian runs after End and draft only).

## T04 Meeting highlights (8 rows, 8 landed)

HighlightsView.swift:14 shell, :86 Needs you, :152 Files, :158 Links, :166 Changes. Landed as: Meetings list (Live, yesterday, Issued), counts (decisions, actions, questions, risks), Needs you ticks (update the left badge), last items, source line, Files, Links, Changes in the right pane, Issue MoM (Done) then Issued section, Close without MoM (Archive). The "finished threads before archive" panel (tb-inbox-1) is also shown as a reference here: Issued is the same Finished step.

## T05 Add-ins (7 rows, 7 landed)

ToolCard Allow card (no line number: a type, not one place). Landed as: add-in list (Needs trust, Enabled), manifest quote (appliesTo, panels, hooks), May call and Last runs in the right pane, Trust gate (Trust and enable, Review manifest, Remove), changed-since-trusted state, broken manifest listed but never run, Enabled section.

## States (all four boards)

Switcher "vw vs": Normal / Empty / Error / Locked / Needs input. Empty hides rows and shows the zero view; Error greys rows and shows Retry; Locked blocks actions in the card, banner and composer; Needs input outlines the card and adds a banner.

## Counts

| Board | Reference rows | Landed | Dropped | Interactions wired |
|---|---|---|---|---|
| T01 | 13 | 12 | 1 | open x5, filter x5, done, archive, archive all, undo, reopen, reply, unfold archived, 5 states |
| T02 | 9 | 9 | 0 | open x3, accept, change, dismiss, pause, archive all, undo, 5 states |
| T04 | 8 | 8 | 0 | open x2, tick x5, Issue MoM, close, archive all, undo, 5 states |
| T05 | 7 | 7 | 0 | open x3, trust, review, remove, archive all, undo, 5 states |

## Not done

- No Before/After toggle: T boards are new screens (afterOnly).
- Search, Send and the rail icons are shown, not wired.
- Sample file and link names in the T04 right pane are made up for the sample meeting, not real data.
- Whether the Claude Design runtime binds `data-*` attributes and `{{}}` text in these positions is unverified (runtime support.js not available locally).
