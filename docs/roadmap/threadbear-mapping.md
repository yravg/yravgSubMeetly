# Threadbear -> yravgSubMeetly: feature mapping

Research spec for S9. It adds no product code. Source read: `mikecann/threadbear` at
`b333a970cbb365da57b6044ea027fa6a60f2e4e4` (main, 2026-11-07), MIT. All Threadbear paths
below are relative to that commit. Our paths are relative to this repo.

The brief calls Threadbear a TypeScript app. The current main is not: the Mac UI is Swift
(`app/Sources/Threadbear`, `app/Sources/ThreadbearCore`), the runner is TypeScript
(`runner/src`), the backend is Convex TypeScript (`convex/`), and patches are TypeScript
files the runner imports. `dock/` is a Swift panel demo; `ios/` is the phone app. Treat
Threadbear as "native Mac app + TS runner + TS patches" and the mapping stays accurate.

## How to read this

- **Where** uses only: Minutes register, Side panel, island page, island add-in, engine.
  The island does not exist yet; S6/S7/S8 in `docs/roadmap/submeetly-next.md:34-49` build it.
  Every "island" row is a plan against that roadmap, not a shipped surface.
- **Size**: S = a day or less, M = about a week, L = multiple weeks or new storage.
- **Keep** means it fits our product. **Drop** means it solves a problem we do not have.
  **Keep later** means it fits but is not in the first slice.
- Threadbear is a conversation with an agent; a meeting here is a transcript plus a typed
  register. We borrow the interaction patterns, not the agent loop.

## Core one: meeting = thread

**Threadbear.** A thread is one conversation with an agent in one folder, remembered in
full (`app/Sources/ThreadbearCore/Protocol/Models.swift:1063`). The list groups threads
into Starred / Inbox / Running / Hibernating / Archived and each row carries project,
status, unread mark and last activity (`app/Sources/Threadbear/Views/SidebarView.swift:50`,
`app/Sources/ThreadbearCore/Threads/ThreadSections.swift:16-26`). One thread is one unit
of work you can return to days later.

**Ours.** A meeting is already one unit: a `Meeting` with `seriesId`, `seq`, `projectType`,
attendees, agenda, typed `items`, multilingual summary, transcript provenance and an
`issuedAt` freeze (`src/lib/notes-schema.js:152-173`, built by `createMeeting` at
`src/lib/notes-schema.js:306`). The register switcher lists meetings
(`src/minutes.js:888`, `src/minutes.html:25`); the side panel shows the same register in a
compact form (`src/notes-panel.js:233-460`).

**Where.** Minutes register (canonical), Side panel (compact), island page "Minutes" (S7).

**Verdict.** Keep the unit. Drop the agent/chat toolbar: a meeting has no agent turn to
steer. Size S (no new model, only section labels).

**Builds on.** `src/lib/notes-schema.js:152-173`, `:306`; `src/lib/notes-store.js:112-150`;
`src/minutes.js:888`; `src/notes-panel.js:233`.

## Core two: decisions and open questions as buttons

**Threadbear.** An agent ends a turn with `end_turn`, carrying up to 10 asks, each with an
`action`, `why`, optional `reply`, up to six `options` and a `suggested` pick
(`runner/src/needs.ts:1-90`; wire model `runner/src/protocol.ts:796-809`). The app renders
a "Needs you" card: the asks listed, paged when they are long, each answer a button that
says what picking it does, plus "Something else" with its own box (`app/Sources/ThreadbearCore/Threads/Decisions.swift:6-30`,
`app/Sources/Threadbear/Views/AnswerChips.swift:8`, `app/Sources/Threadbear/Transcript/AskAnswerBox.swift:9`;
protocol: `docs/protocol.md:2169`). Picks persist and go out as one message; the card
survives restart.

**Ours.** We already classify decisions, actions, risks and open questions from live lines
(`src/lib/notes-generate.js:15-38`, `:69`), and a human can add a decision or action from
the side panel (`src/notes-panel.js:693`, `:741`). Accepting an AI item is one call
(`acceptItem`, `src/lib/notes-actions.js:58`), editing is one call (`editItem`, `:158`),
adding is one call (`addItem`, `:192`). Flagging the current moment is
`flagMoment` (`:224`). The register drawer already shows provenance, links and history
(`src/minutes.js:951`, `:976`, `:990`; drawer at `:1105`).

**Where.** Island page (an ask card on the Minutes page) + Minutes register (the item
drawer) + Side panel (the "needs review" list).

**Verdict.** Keep. This is the single highest-value borrow: it turns a detected decision
into a one-tap review instead of a register row nobody reads. Size M.

**Builds on.** `src/lib/notes-generate.js:69`; `src/lib/notes-actions.js:58`, `:158`,
`:192`, `:224`, `:263`; `src/notes-panel.js:693`, `:741`; `src/minutes.js:1105`; item shape
`src/lib/notes-schema.js:103-126`.

**Adaptation.** A card per open decision/question with Accept / Edit / Dismiss and (for a
question) Answer. Accept writes `review: accepted`; Edit opens the register drawer;
Dismiss leaves it as `info` or removes it. "Something else" is the existing free-text
edit. Multi-select does not map: one meeting item has one review state, so a card is one
item, not a batch.

## Core three: options compare

**Threadbear.** `show_options` creates a durable design review of up to 12 options, each with
images, several shots, or a live URL; the window steps through shots then puts options
side by side, with picks, per-option notes, a free reply, "none", and a recommended pick
(`docs/protocol.md:649`; `runner/src/reviews.ts`; `app/Sources/Threadbear/Views/ReviewWindow.swift:11`,
`:294`; `app/Sources/Threadbear/ReviewSession.swift`; design rationale in
`docs/options-review-design/README.md`). The card stays pending until answered, cancelled or
superseded by a message in the thread.

**Ours.** The register is text-only: a decision, risk or metric item has multilingual text
and provenance, no media (`src/lib/notes-schema.js:103-126`). A `design-review` project
type already exists (`src/lib/notes-schema.js:29-44`), and the register can show items side
by side only as table rows (`src/minutes.js:372`).

**Where.** Island page "Compare" (a new page in the Minutes island section).

**Verdict.** Keep later. Text-only compare (pick two to four register items or pasted text,
read side by side, one Pick writes a decision via `addItem`) is M and useful for vendor,
design and wording choices. Image/video/HTML compare is L: it needs durable media storage,
thumbnails and a viewer, none of which the register has. Do not port Threadbear's review
window as the first slice.

**Builds on.** `src/lib/notes-actions.js:192`, `:158`; `src/minutes.js:372`, `:604`;
`src/lib/notes-schema.js:103-126`.

## Core four: inbox zero for action items

**Threadbear.** The sidebar has four working sections. Inbox is only what needs the user;
Running is work in flight; Hibernating and Archived are put away, folded by default
(`app/Sources/Threadbear/Views/SidebarView.swift:50-134`;
`app/Sources/ThreadbearCore/Threads/ThreadSections.swift:16-26`, classifier at `:147-154`).
Archive is one click, with an undo toast, an empty-state "inbox zero", and an animated
row-into-the-Archived-heading transition (`app/Sources/Threadbear/AppModel+ThreadActions.swift:625`,
`:668`, `:758`; `app/Sources/Threadbear/Views/ArchiveFlight.swift`; `docs/archive-transition-design/README.md`).

**Ours.** Action items are already first-class: `action` type with `owner`, `due`,
`status` open/progress/closed, `openedAt` that survives carry-forward
(`src/lib/notes-schema.js:103-126`; `src/lib/notes-actions.js:279-343`). There is already a
per-series open-items API (`listOpenItems`, `src/lib/notes-store.js:150`), a series
summary that collects every still-open item with age and carry chain
(`seriesSummary`, `src/lib/notes-actions.js:384`), and a Carry-forward register view
(`src/minutes.js:604`). What is missing is the inbox: one place that shows the whole
backlog and lets you close it.

**Where.** Island page "Inbox" + Minutes register Carry-forward view.

**Verdict.** Keep. It is pure surfacing over data we already persist, and it is the natural
counterpart to the decisions card: one surface asks, the other clears. Size S.

**Builds on.** `src/lib/notes-store.js:150`; `src/lib/notes-actions.js:263`, `:384`;
`src/minutes.js:115`, `:122`, `:604`; `src/lib/notes-schema.js:391`.

**Adaptation.** Sections: Overdue, This week, No date, Doing, Done (folded). One tap closes
(status closed) with Undo; "Snooze" sets `due` to tomorrow/next week (the existing
`editItem` path). Hibernating as a separate state is unnecessary: an action with a future
due date is snoozed, an action closed is archived.

## Core five: librarian auto-filing meetings into projects/series

**Threadbear.** The librarian is a runner background job that looks at a thread on its
first message, at first turn end, on a folder move, on a catch-up every 20 minutes, and on
demand. One small model call returns which projects the thread belongs in with a reason, a
new project when none fits, a new project state, whether the title still fits, and whether
to rename a stale project (`runner/src/librarian.ts:1-20`; project model
`runner/src/projects.ts:1-15`; protocol: `docs/protocol.md:4149`). The user can take a thread
out and the librarian never puts it back. UI: `app/Sources/Threadbear/Views/LibrarianView.swift:8`,
`app/Sources/Threadbear/Views/LibrarianHome.swift:9`.

**Ours.** A meeting already knows its series and project type: `seriesId` keys carry-forward,
`projectType` drives filtering and the Library/Training catalogue
(`src/lib/notes-schema.js:29-44`, `:152-173`). Starting the next meeting copies series,
chair, attendees, topics and project type, then carries open items without resetting their
age (`startNextMeeting` at `src/lib/notes-actions.js:322`; `carryForward` at `:292`). What is
manual is choosing `seriesId`/`projectType` and naming the meeting. Our local extractor
already has the signal to suggest both (`src/lib/notes-generate.js:69`), and the Library
already has domains and series (`src/lib/sample-library.js`; `src/minutes-extras.js:201`).

**Where.** Engine (a small local job after save/end) + island page "Librarian" (suggestions
and history) + Minutes register (the title/series/type fields at
`src/minutes.html:121-132`).

**Verdict.** Keep, rules first. A rules-only librarian (match title/agenda/speakers to an
existing series, score project type from keywords, propose a title) is M and needs no model.
A local-LLM version is L and waits for the Rust engine. Never silently overwrite a value a
human set.

**Builds on.** `src/lib/notes-schema.js:29-44`, `:306`; `src/lib/notes-actions.js:322`,
`:292`; `src/lib/notes-generate.js:69`; `src/lib/sample-library.js`; `src/minutes-extras.js:201`.

**Adaptation.** On meeting end, compute a suggestion `{seriesId, projectType, title, why}`
and show it as one card: Accept / Change / Dismiss. Persist the look in a small
`librarian.json` so it is auditable, like Threadbear's `librarian.json`. Project notes/state
carry forward per series in a new `series.json` (do not add fields to every meeting); a
`Series brief` appears in the island Minutes page and at the top of the register.

## Core six: patches = our add-in API

**Threadbear.** A patch is a TypeScript module in `.threadbear/patches/` (or
`~/.threadbear/patches/`) whose default export declares `actions` (chips above the composer:
run a command, send a prompt, or open a URL), `panels` (a URL, image or native list beside the
transcript), `hooks` (run on turn events) and `tools` (extra MCP tools), with live `when` and
`badge` functions and a trust gate before anything runs
(`runner/src/patches.ts:1-60`; `runner/src/patch-trust.ts`; protocol: `docs/protocol.md:2894`;
design: `docs/threadbear-design/README.md`; chips: `app/Sources/Threadbear/Views/ActionChips.swift:14`;
panels: `app/Sources/Threadbear/Views/PanelsView.swift`). Patches stack by folder and by
project, and the agent can write one for you.

**Ours.** Add-ins are planned on the Oyenza add-on system for the island (S8,
`docs/roadmap/submeetly-next.md:15-16`, `:44-49`). The engine already exposes a small,
loopback-only HTTP contract (`native/server.py:16-27`, dispatch at `:1325` and `:1389`), and
the island talks to it over loopback (S7).

**Where.** Island add-in (primary) + engine (only the verbs an add-in may call).

**Verdict.** Keep. The manifest shape is the right one: it lets one add-in add a button, a
page and an event hook without touching the island. Copy the shape, not the shell trust
model. Size M for the spec + one example, L for the full loader and trust UI.

**Builds on.** `docs/roadmap/submeetly-next.md:15-16`, `:34-49`; `native/server.py:16-27`;
register actions `src/lib/notes-actions.js:58-224`; island S6/S7 (not in this tree yet).

**Adaptation.** An add-in declares:

- `appliesTo`: `{ projectType?: string[], series?: string[], always?: boolean }`.
- `actions`: `{ title, icon?, run?: "engine.route", prompt?: string, open?: "https://..." }`
  shown as island chips and in the register toolbar. `run` may only name an engine route or
  a built-in command; no arbitrary shell, no network except `open`.
- `panels`: `{ title, page: "actions" | "meetings" | "series" | "compare" | "custom", items? }`
  as an island page or a side panel card.
- `hooks`: `{ on: "meeting.end" | "meeting.start" | "item.accepted" | "line", run }`.
- `when` / `badge`: optional live functions evaluated with the current meeting summary.
- `tools` (Threadbear's extra MCP tools) is dropped: there is no agent to call them.
  Add-in `actions` are the equivalent.
- Trust: install by explicit file pick or a repo path, show what it will run, disable on
  change. No silent loading from a transcript or a meeting.

## Rest of Threadbear

| Threadbear feature | What it does (paths) | Our equivalent | Where | Verdict | Size | Builds on |
|---|---|---|---|---|---|---|
| Thread list sections | Starred / Inbox / Running / Hibernating / Archived; folded put-away sections | Meetings by type + "needs review" + issued; series switcher | Minutes register + island Minutes | Keep simplified: 3 states, not 5 | S | `src/minutes.js:888`, `src/minutes.html:25`, `src/lib/notes-schema.js:391` |
| Hibernate / snooze | Snooze a thread until a time or a phrase; lands in Hibernating (`docs/guide.md:480`; `AppModel+ThreadActions.swift:762`) | Snooze an action by setting its `due` date | Island Inbox + register drawer | Keep as due-date, drop the state machine | S | `src/lib/notes-actions.js:158`, `src/minutes.js:115` |
| Highlights panel | A side panel that collects what the thread made: librarian line, Needs you, projects, boards (`app/Sources/Threadbear/Views/HighlightsView.swift`, `HighlightsBoard.swift`; `docs/protocol.md:3817`) | Meeting highlights: decisions/actions/questions/risks counts, recent items, needs-review list | Side panel | Keep: it is the side-panel home for the register | S | `src/notes-panel.js:233-460`, `src/lib/notes-schema.js:391` |
| Movable panel layout | Drag panels into tabs, splits or windows; persisted (`docs/guide.md:543`; `app/Sources/Threadbear/Views/PanelsView.swift`) | Existing dock: resizable left/right/bottom, collapsible rails, torn-off floating window, layout persisted | Minutes register | Keep as-is; do not port the AppKit panel system | S | `src/minutes-dock.js:40`, `:108` |
| Reply buttons | Inline buttons an agent adds to a reply (`app/Sources/ThreadbearCore/Protocol/ReplyButton.swift:8`; `docs/protocol.md:787`) | No agent replies; add-in actions cover the same need | Island add-in | Drop | - | `docs/roadmap/submeetly-next.md:15-16` (add-ins) |
| Schedules | Send a message to a thread or start one at a time, repeat, choose a Mac (`runner/src/schedules.ts`; `docs/protocol.md:4365`) | Due dates and series already carry recurrence; a meeting reminder is a calendar feature | Island page later | Keep later, not in first 5 | M | `src/lib/notes-actions.js:292`, `:322` |
| Search | Search title and last reply across every section, folded ones opened (`docs/guide.md:19`) | Register search + session history search | Minutes register + Side panel | Keep existing | S | `src/minutes.js:272`, `src/lib/notes-store.js:164`, `src/lib/session-search.js:15` |
| Voice mode | Spoken conversation with a thread (`app/Sources/Threadbear/Voice/VoiceServer.swift`, `VoiceMode.swift`) | We are voice-in only (ASR + translation); no spoken agent | - | Drop: no local conversational agent | - | `src/offscreen.js:1` |
| Phone sync via Convex | Phone and web follow threads through the user's own Convex deployment (`convex/schema.ts`, `convex/sync.ts`; `docs/protocol.md:4568`; README "On your phone") | None; our data is local to the extension/helper/Mac app | - | Drop: cloud backend contradicts on-device | - | `src/lib/notes-store.js` (local backend) |
| Accounts, pools, usage | Rotate Claude/Codex logins, quotas, usage panels (`runner/src/pools.ts`, `app/Sources/Threadbear/Views/UsagePanel.swift`) | Performance tab is local latency, not quota | Performance tab | Drop: no accounts or quota | - | `src/perf-panel.js:59`, `src/lib/perf-log.js:17` |
| Connectors / MCP | External MCP services through a gateway (`runner/src/connectors.ts`; `app/Sources/Threadbear/Views/ConnectorsPanel.swift`) | None; add-ins are local and explicit | - | Drop for now; no external services | M later | `native/server.py:16-27` |
| Updates / fork | Fork Threadbear, bring Mike's releases in (`app/Sources/Threadbear/AppUpdate.swift`; `docs/bringing-in-updates.md`) | We are not a fork; add-in versioning is the closest need | - | Drop | - | add-in spec above |
| Worktrees | Give each thread its own git worktree (`runner/src/worktrees.ts`; `docs/thread-worktrees.md`) | No coding agents or repos in a meeting | - | Drop | - | - |
| Ask links / multi-pick | Links on an ask (file, page, review) and several picks (`docs/protocol.md:2169`) | Provenance link to timecode + linked item refs; one review state per item | Register drawer + island card | Keep provenance, drop multi-pick | S | `src/lib/notes-schema.js:70-91`, `src/lib/notes-actions.js:120`, `src/minutes.js:951` |
| Notion task board | Read a Notion board into a project (`runner/src/notion-tasks.ts`) | Local action items are already the board | - | Drop: external dependency | - | `src/lib/notes-actions.js:279` |

## Recommended first 5, in order

Each one is shippable alone and leaves the app usable if the next is delayed. The order
minimises new concepts: 1-3 add no model, 4 adds local rules, 5 adds the extension point.

### 1. Action inbox zero (island page + register)

Why first: it turns data we already store into the one screen a meeting owner checks daily,
and it has no model or engine dependency.

Acceptance criteria:

- The island Inbox page lists every open action across all meetings, from
  `seriesSummary` (or `listOpenItems` when scoped to one series), grouped Overdue / This
  week / No date / Doing / Done (done folded).
- Each row shows the meeting title and date, `ref`, owner (or "No owner"), due date and
  source timecode when it has one; tapping opens the register at that item.
- Closing an action writes `status: closed` through `setStatusAndSave`; the register and
  the inbox agree after reload; Undo restores `open`.
- Snooze sets `due` to tomorrow or next week through `editItemAndSave`; a snoozed action
  leaves Overdue and appears in This week (or No date when cleared).
- The empty state says "Inbox zero" and the count equals `seriesSummary(...).open` for the
  same store.
- Works with the engine stopped; no network call.

### 2. Decisions and open questions as buttons (island ask card)

Why second: it closes the loop the extractor opens, and it reuses the accept/edit paths
that already exist.

Acceptance criteria:

- A decision or question added by the extractor or by hand shows a card on the island
  Minutes page with Accept, Edit, Dismiss, and Open transcript.
- Accept sets `review: accepted`; Edit opens the register drawer on that ref; Dismiss
  removes the item only after a confirm; each action persists through
  `acceptItemAndSave` / `removeItemAndSave`.
- The card shows the provenance timecode, speaker and confidence; Open transcript focuses
  the source segment.
- Re-running the extractor on the same segment does not create a second item (dedupe by
  meeting + timecode + normalized text).
- A question card additionally offers "Answered", which sets `status: closed` and keeps
  the text.
- The register and the side panel reflect the change without a reload.

### 3. Meeting Highlights in the side panel

Why third: the side panel is already open during a meeting, and this makes the register
visible without switching tabs.

Acceptance criteria:

- The side panel shows the active meeting's counts for decisions, actions, questions and
  risks, plus the last five items and a "Needs you" list (`review: ai` or
  `confidence < 0.7` or an overdue action).
- Every row opens the register at its `ref`; the register drawer shows the same item.
- Counts match `meetingStats(active)` after every save.
- Works in English and Indonesian, dark and light, and at 390 px panel width without
  horizontal scroll.
- The panel degrades to "No meeting yet" when the register is empty.

### 4. Librarian lite (series and project type suggestions)

Why fourth: it removes the two manual fields that make the register feel like data entry,
and it is deterministic without a model.

Acceptance criteria:

- On meeting save/end, the engine returns a suggestion `{seriesId, projectType, title, why}`
  using rules over the title, agenda and transcript; no network call.
- The island shows one card: Accept applies all three, Change opens the three fields,
  Dismiss records the look and changes nothing.
- A user-set `seriesId`/`projectType`/title is never overwritten without an explicit
  Accept; a dismissed suggestion is not shown again for the same meeting.
- Starting the next meeting in a series uses `startNextMeeting` and keeps `openedAt`
  unchanged for every carried item; a fixed transcript fixture produces the same suggestion
  twice.
- The look history is readable (meeting, suggestion, accepted/dismissed) and stored on
  device.

### 5. Add-in API v0, patch-shaped

Why fifth: it needs the island (S6/S7) and the trust UI, but it unlocks every later feature
without shipping each one as core code.

Acceptance criteria:

- An add-in is a folder with a manifest whose default export accepts
  `actions`, `panels`, `hooks`, `when`, `badge` and `appliesTo`.
- Two examples ship and work: a "Flag decision" action that writes an `info`/`decision` item
  through the documented engine call, and an "Actions" panel that renders the inbox from
  `seriesSummary`.
- An action chip appears only when `appliesTo` matches the active meeting's `projectType` or
  `seriesId`; `when` hides it when false and `badge` shows a count.
- A broken, untrusted or changed add-in is listed with its error but never executed; it
  cannot run shell commands or open network connections; `open` only accepts `https://`.
- Install, disable and remove are explicit; no add-in is loaded from a transcript or a
  meeting payload.
- Tests cover: manifest validation, trust gate, scoping, the two example add-ins, and one
  action end-to-end on a fixed meeting fixture.

## Dropped or later, and why

- **Convex phone/web sync**: a cloud backend is the one thing the owner excluded; our
  register is local (`src/lib/notes-store.js`). Revisit only as a
  user-owned export/import, not a live sync.
- **Accounts, pools, usage**: no login pool; the Performance tab
  (`src/perf-panel.js:59`) measures the engine, not quota.
- **Connectors/MCP**: no external services in a meeting. Add-ins are the local extension
  point; a local MCP host is a separate project.
- **Updates/fork/worktrees/voice/schedules/reply buttons**: all solve agent-app problems
  (forking, coding in worktrees, spoken agent turns, agent message queues), not meeting
  problems. Schedules may return as meeting reminders after the first five.
- **Image/video options compare** and **Notion boards**: both need durable external media
  or a cloud account; later than the text-only compare.

## Risks and non-goals

- The island does not exist in this worktree. S6/S7 land it; this spec assumes the island
  can host pages and add-ins and can read the register through the engine.
- The Rust engine does not exist yet (S2-S5). Suggestions, add-in verbs and inbox reads
  should go through the same HTTP routes the Python helper already exposes
  (`native/server.py:16-27`), so the Python oracle and the Rust engine stay interchangeable.
- Register storage is `chrome.storage.local` / `localStorage` (`src/lib/notes-store.js`).
  Cross-device sync is out of scope; the Mac app reads shared notes through the helper, not
  a server (`mac/Sources/yraverageSubMin/HelperSharedNotes.swift`).
- Add-in trust is new surface. Default to "not run until trusted", show the exact engine
  call and scope, and never let a meeting payload install an add-in.
- Threadbear is MIT, so code can be copied with its LICENSE. Its mascot, name and brand
  are not needed for any feature here; do not copy them. Oyenza's brand and Oyen character
  remain excluded by `docs/roadmap/submeetly-next.md:24-26`.

## Sources read

- Threadbear: `README.md`; `docs/guide.md` (Threads, Hibernate and archive, Panels,
  Highlights, Projects, The librarian, Patches, Schedules); `docs/protocol.md` (Needs you,
  Design reviews, Reply buttons, Patches, Showing panels, Projects);
  `docs/options-review-design/README.md`; `docs/reply-card-design/README.md`;
  `docs/archive-transition-design/README.md`; `docs/threadbear-design/README.md`;
  `runner/src/needs.ts`, `patches.ts`, `librarian.ts`, `projects.ts`, `protocol.ts`;
  `app/Sources/ThreadbearCore/Threads/{Decisions,ThreadSections,Panels}.swift`;
  `app/Sources/ThreadbearCore/Protocol/{Models,ReplyButton}.swift`;
  `app/Sources/Threadbear/Views/{SidebarView,ActionChips,AnswerChips,ReviewWindow,LibrarianView}.swift`;
  `app/Sources/Threadbear/AppModel+ThreadActions.swift`.
- Ours: `src/lib/notes-schema.js`, `notes-actions.js`, `notes-api.js`, `notes-generate.js`,
  `notes-store.js`; `src/minutes.js`, `src/minutes.html`, `src/minutes-dock.js`,
  `src/minutes-extras.js`, `src/notes-panel.js`, `src/sidepanel.js`, `src/sidepanel.html`,
  `src/offscreen.js`, `src/background.js`, `src/content.js`, `src/perf-panel.js`,
  `src/lib/perf-log.js`; `native/server.py`; `mac/Sources/yraverageSubMin/*`;
  `docs/roadmap/submeetly-next.md`.
