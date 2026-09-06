# Local TransSub — Notes v2: the Minutes Register

**Target:** replace the current Notes tab with a Facilitator-class minutes surface — a typed, sortable, provenance-linked register that survives from meeting to meeting.

**Reference points:** Microsoft Loop Facilitator (`CPOC Phase 7 — GZS Weekly Progress Meeting`) and the TeamsMaestro / AI-Meeting-Notes class of bots.

**Status of this doc:** design spec. Phase 2.0+ is shipped in `src/` (`minutes.html`, `notes-*`); `test/notes-register.html` is the static prototype. See `docs/NOTES-V2-STATUS.md` for done vs stub.

---

## 0. The one-line thesis

Loop Facilitator produces a **document**. What a weekly progress meeting actually needs is a **register** — numbered, typed, owned, dated, carried forward, and auditable back to the words that were said.

Loop can't do that last part, because Loop never had the audio. Local TransSub does. **Provenance is the moat.** Every other feature on this list is table stakes; the one thing a competitor structurally cannot copy is a row that plays back the sentence it came from.

---

## 1. What the reference products actually give you

### 1.1 Loop Facilitator (read from the live CPOC page)

| Block | Shape | Notes |
|---|---|---|
| Header | Title, date, time range, organiser, **View recap** link | Recap is a separate artifact (video + speakers) |
| AI disclaimer | One static line | No per-item confidence, no per-item source |
| **Decisions** | Flat bullet list | 2 items on the CPOC page |
| **Open questions** | Flat bullet list | 2 items — *this section does not exist in TransSub at all* |
| **Agenda** | Collaborative, pre-meeting | Empty on this page — the coverage signal is wasted |
| **Meeting notes** | Prose grouped under **topic headings** | Safety Incident / Safety Controls / Document Review / Offshore Mobilization / Safety Performance |
| Follow-up tasks | Loop task list → syncs to Planner/To Do | Assignee, due date, checkbox |
| Collaboration | Live co-edit, presence, comments, share link | |

**What Loop does well and TransSub must copy:** topic clustering, a real Open-questions section, an agenda that the notes are checked against, tasks as first-class objects with assignee + due + status.

**What Loop does badly:** decisions are strings, so nothing can be sorted, filtered, counted, or rolled forward. There is no line from any bullet back to who said it or when. Every week starts a blank page — last week's open actions are not inherited. And the CPOC page proves the failure mode: two "open questions" with no owner and no date, which means they will be re-asked next Tuesday.

### 1.2 TeamsMaestro / AI-meeting-notes class

> I could not read that tab — the browser bridge asked for a `select_browser` call that isn't available in this session. The following is the product class, not that specific page. Re-open it and I'll diff against the real UI.

Category-standard capabilities to design against:

- A **bot joins the meeting** and records — capture is not the user's problem
- **Speaker diarization** with named participants pulled from the calendar invite
- **Meeting series memory** — "this is the 7th CPOC weekly", previous notes are in context
- **Action items pushed out** to Planner / Jira / email, and their completion pulled back
- **Cross-meeting semantic search** — "what did we decide about the C900?"
- **Templates per meeting type** — a standup extracts differently from a contract negotiation
- **Retention and admin controls** — who can see the transcript, how long it's kept

TransSub's counter-positioning is that all of this runs on the user's Mac, which is exactly why it can be used for contract-sensitive meetings that no cloud bot will ever be allowed into.

---

## 2. Gap analysis — the current code

Read: `src/lib/notes-schema.js`, `notes-store.js`, `notes-generate.js`, `notes-export.js`, `notes-api.js`, `notes-stub.js`, `src/notes-panel.js`, `native/server.py:360-608`.

### 2.1 Schema — the root problem

```js
// src/lib/notes-schema.js — today
MeetingNote {
  summary: string,
  decisions: string[],          // ← strings. Not addressable.
  actions: ActionItem[],        // ← only actions get structure
}
```

Consequences that are already visible in the UI:

| # | Defect | Where | Impact |
|---|---|---|---|
| G1 | `decisions` is `string[]` | `notes-schema.js:24` | A decision cannot have an owner, a date, a status, or a source. It can never be exported to a register or carried forward. |
| G2 | No **open questions**, no **risks** | schema | The two things a progress meeting exists to surface have nowhere to live. The Loop page has 2 open questions; TransSub would drop both. |
| G3 | No link back to the transcript | schema | `transcriptPreview` is a 6-line blob. Given a note, you cannot find the sentence it came from. This is the single biggest miss. |
| G4 | No topic / agenda dimension | schema | Loop's topic headings have no equivalent. Everything is one undifferentiated list. |
| G5 | No AI-vs-human state | schema | Loop at least prints a disclaimer. TransSub prints nothing — a hallucinated action looks identical to a confirmed one. |
| G6 | Panel strings are hardcoded Indonesian | `notes-panel.js:60-140` | The app ships a 15-locale `i18n.js` with `tabNotes`, `notesTitle` etc. already wired — and the panel ignores it entirely. "Poin Keputusan", "Kosongkan keputusan", "tanpa tenggat" are literals in the template. |
| G7 | Nothing is editable | `notes-panel.js` | The panel renders `innerHTML` and re-renders whole. No owner assignment, no due date, no status toggle, no text correction. An ASR error is permanent. |
| G8 | Demo buttons in the product surface | `notes-panel.js:96` | `Buat Notulen dari contoh` / `Kosongkan keputusan` are harness affordances that shipped into the panel. |
| G9 | Extraction is regex | `notes-generate.js:24-46` | `/\b(keputusan\|diputuskan\|we (decided\|agree)\|decision)\b/` — fires on "no decision was taken", misses everything phrased normally. On the CPOC transcript it would find **zero** of the 5 real decisions. |
| G10 | Two storage systems that never reconcile | `notes-store.js` (`chrome.storage.local`) vs `native/server.py:360` (`~/.localtranssub/notes.json`) | Both cap at 50, neither syncs, no schema version negotiation, no conflict rule. |
| G11 | Export is TXT/MD only | `notes-export.js` | A planning engineer needs XLSX (register), DOCX (issued MoM), ICS (due dates), CSV (import to P6/Primavera or a tracker). |
| G12 | Side panel is ~380 px | `sidepanel.html` | A register table does not fit. This is an architecture decision, not a CSS one — see §4.1. |
| G13 | No meeting identity | schema | `title` + `source` only. No series, no sequence number, no attendees, no chair, no meeting date distinct from `generatedAt`. Carry-forward is impossible without this. |
| G14 | 50-note cap, no search | both stores | Weekly meetings hit the cap in a year. Nothing can be searched across meetings. |

---

## 3. The v2 data model

One flat register of **typed items**, replacing `summary` + `decisions[]` + `actions[]`.

```js
// src/lib/notes-schema.js — v2
export const NOTE_SCHEMA_VERSION = 2;

/** @typedef {'decision'|'action'|'question'|'risk'|'info'} ItemType */
/** @typedef {'open'|'progress'|'closed'|'carried'} ItemStatus */
/** @typedef {'ai'|'accepted'|'edited'} ReviewState */

/**
 * @typedef {object} MinuteItem
 * @property {string}  ref          "W36-003" — series-scoped, human-quotable, stable
 * @property {ItemType} type
 * @property {string}  topic        key into the meeting's topic map
 * @property {string|null} agenda   agenda ref "A2" — drives coverage
 * @property {Record<string,string>} text   { en: "...", id: "...", zh: "..." }
 * @property {string|null} owner    participant id
 * @property {string|null} org      "GZS" | "COMPANY" | "MWS" — matters in EPCI
 * @property {string|null} due      YYYY-MM-DD
 * @property {ItemStatus}  status
 * @property {'high'|'med'|'low'} priority
 * @property {ReviewState} review   ai | accepted | edited   ← the trust dimension
 * @property {number}  confidence   0..1, from ASR + extractor agreement
 * @property {Provenance} src       ← the moat
 * @property {string|null} carriedFrom   "MOM-CPOC7-W35"
 * @property {string|null} openedAt      YYYY-MM-DD — age survives carry-forward
 * @property {Revision[]} history        append-only audit trail
 */

/**
 * @typedef {object} Provenance
 * @property {number} t0            seconds into the recording
 * @property {number} t1
 * @property {string} tc            "00:09:05" display form
 * @property {string} speaker       diarized label or resolved participant
 * @property {string} lang          detected source language
 * @property {string} orig          the exact words spoken
 * @property {string} tr            the MT output the extractor read
 * @property {string} segmentId     FK into transcript store
 * @property {string} meetingId     lets a carried item point at the *original* meeting
 */

/**
 * @typedef {object} Meeting
 * @property {string} id            "MOM-CPOC7-W36"
 * @property {string} seriesId      "CPOC7-WEEKLY"      ← enables carry-forward
 * @property {number} seq           36
 * @property {string} title
 * @property {string} date          YYYY-MM-DD          ← distinct from generatedAt
 * @property {string} start "10:00"  @property {string} end "12:00"  @property {string} tz
 * @property {string|null} chair
 * @property {Participant[]} attendees
 * @property {AgendaItem[]} agenda
 * @property {Record<string,Record<string,string>>} topics   topic key → localized labels
 * @property {MinuteItem[]} items
 * @property {EngineStamp} engine   model, version, duration, segment count
 * @property {string} generatedAt
 * @property {string|null} issuedAt  set when the MoM is issued — freezes the doc
 */
```

### 3.1 Why each field earns its place

- **`ref` not `id`** — the register number is what people say out loud ("close out W36-003"). It must be stable, sortable, and survive carry-forward with a re-number that keeps the audit link.
- **`text` as a language map, not a string** — this is a translation product. A minute item recorded from Mandarin should hold `zh` (as spoken), `en` (working language), and `id` (Enrico's UI). The UI toggle then switches labels *and* content without re-translating.
- **`review`** — three states, not a boolean. `ai` items print in the register but are excluded from the issued MoM's binding sections until a human accepts them. This is what makes an AI-drafted MoM defensible in a contract dispute.
- **`src`** — carries `t0/t1` as numbers (for seeking), `orig` and `tr` (so a mistranslation is visible next to the item it produced), and `meetingId` so a carried item still points at the meeting where it was raised.
- **`openedAt`** — age is the metric that makes carry-forward useful. W35-022 is not "8 days overdue", it is "open for 22 days", and that is the number that goes on a progress report.
- **`history`** — append-only `{at, by, field, from, to}`. Required for the same reason as `review`.

### 3.2 Migration from v1

`src/lib/notes-migrate.js`, run on read in both stores:

```
v1.summary            → items[] of type 'info', review:'ai', src:null
v1.decisions[i]       → { ref:`${mid}-D${i}`, type:'decision', text:{[locale]:str},
                          review:'ai', src:null, status:'closed' }
v1.actions[i]         → { type:'action', text:{[locale]:a.text}, owner:a.owner,
                          due:a.due, status: a.status==='done'?'closed':'open', review:'ai' }
v1.transcriptPreview  → meeting.legacyPreview   (kept, not shown)
```

`src` is `null` for every migrated item — the UI must render that honestly ("no source — imported"), not fake a timestamp. Write the migration with a `schemaVersion` gate so v1 files are upgraded once and stamped, and keep a v1 reader for 2 releases.

---

## 4. Frontend

### 4.1 Surface split — the decision that unblocks everything

A register does not fit in a 380 px side panel. Do not try.

| Surface | Job | Width |
|---|---|---|
| **Side panel** (existing) | *Live capture.* Captions, plus a compact "items captured so far" ticker: count by type, last 3 items, one-tap "flag this moment". | 320–420 px |
| **Minutes workspace** (new) | The register. An extension page (`chrome-extension://…/minutes.html`) opened in a full tab from the panel, or from the extension action. | full tab |

This mirrors how the product already splits offscreen/worker from panel — the workspace is a new page, not a wider panel. The prototype is responsive down to side-panel width (the table collapses to stacked rows below 620 px) so the same component serves both, but the *default* register experience is the tab.

### 4.2 Views (prototype implements all four)

1. **Register** — the table. Sortable on ref / type / topic / owner / due / status. This is the default.
2. **By topic** — Loop's topic-heading structure, kept because it is how the meeting was actually run, with an open-count per topic.
3. **Minutes** — the readable document, generated *from* the register. Summary, then Decisions / Action register / Open questions / Risks / Discussion notes. This is what gets issued.
4. **Carry-forward** — last meeting's open items with their age, and a `Carry in` action that re-numbers into this week's register.

Three views over one array. No second source of truth, and the document can never disagree with the table.

### 4.3 Table columns

| Col | Width | Encoding |
|---|---|---|
| Ref | 78 | mono, `↩` glyph if carried |
| Type | 104 | 3 px colour rail + label — not a pill on every row, so the rail reads as a scannable column |
| Topic | 120 | quiet outlined tag |
| Item | flex | agenda ref in mono prefix, then text; optional second line = other language (Dual text toggle) |
| Owner | 132 | avatar + name + org — org matters when COMPANY and CONTRACTOR sit in the same meeting |
| Due | 92 | mono, tabular-nums, red when overdue / amber ≤3 days, with a relative line under it |
| Status | 104 | ring→fill dot + label |
| Source | 78 | `▶ 00:09:05`, an ASR confidence bar, and the review state under it |

**Colour discipline:** the emerald accent (`--accent`) stays reserved for interface affordances — active tab, primary button, closed status. Item types get their own hues (`--t-decision` harbour blue, `--t-action` buoy amber, `--t-question` violet, `--t-risk` signal red, `--t-info` slate) so that severity and brand never compete. All tokens extend `src/sidepanel.css` rather than replacing it.

### 4.4 The detail drawer

Click a row → drawer with editable text / owner / due / status / topic, and below them the block that justifies the whole product:

```
WHERE THIS CAME FROM
▶ 00:09:05  ·  Nasmee Samang                        ASR 88%
ORIGINAL (ZH)   事故复盘建议建立起重机检查清单，包括润滑、快绳滑车检查…
TRANSLATED (EN) The incident review recommended establishing a crane
                inspection checklist, including greasing, fast-line block…
[waveform, item span highlighted]
```

`Accept` promotes `ai → accepted`; any field edit promotes to `edited`. `▶` seeks the transcript/audio.

### 4.5 i18n — fix G6 properly

Every string in the new panel goes through `T()`. Add a `notes.*` namespace to `src/lib/i18n.js` (`en` and `id` written out; other locales fall through to `en` as they already do). The prototype ships the full EN/ID string table — lift it directly into `i18n.js`.

Separate the two language axes, which the current code conflates:

- **UI language** — existing `uiLang` setting, drives labels.
- **Content language** — which `text[lang]` to display, with a `Dual text` toggle to show both. Defaults to UI language, falls back to the meeting's working language.

### 4.6 Keyboard

`/` focus search · `j`/`k` row nav · `Enter` open drawer · `a` accept · `o` cycle owner · `d` date picker · `1-5` set type · `Esc` close. A minute-taker types during the meeting; every mouse trip is a lost sentence.

---

## 5. Backend

### 5.1 Where the work goes

`native/server.py` already has `/draft` and an `mlx_lm` venv. The extraction pipeline belongs there, not in `ai-worker.js` — it needs the full transcript in context, and MLX on the Apple GPU is where the headroom is.

```
audio ──▶ ASR (whisper large-v3-turbo, MLX)  ──▶ segments[]  {t0,t1,text,lang,conf}
                        │
                        ├──▶ diarization (pyannote / whisperx)  ──▶ speaker per segment
                        │
                        └──▶ MT (existing)                      ──▶ tr per segment
                                        │
                                        ▼
                              ┌──── chunker ────┐   ~6 min windows, 60 s overlap,
                              │                 │   never split mid-utterance
                              ▼                 ▼
                        extractor pass 1   extractor pass 2
                        (per chunk)        (cross-chunk merge + dedupe)
                                        │
                                        ▼
                              MinuteItem[] with src pointers
                                        │
                                        ▼
                              validator → repair → store
```

### 5.2 Extraction — replace the regex (G9)

Local LLM via `mlx_lm`, constrained output, one call per chunk. Model: an 8B-class instruct model quantised to 4-bit fits alongside Whisper on a 32 GB Mac; expose the choice in Settings alongside the existing ASR model picker.

**Constrained decoding, not free text.** Emit one JSON object per line (JSONL), validate each against the `MinuteItem` schema, discard and retry the line if invalid. Free-form JSON blobs fail on long meetings; line-at-a-time degrades gracefully.

**The prompt must return segment ids, not prose.** This is the part that makes provenance real:

```
You are extracting a minutes register from a meeting transcript.
Each input line is:  [segId] (mm:ss) SPEAKER: text

For each item, output ONE JSON object per line:
{"type":"decision|action|question|risk|info",
 "text":"<one sentence, imperative for actions>",
 "owner":"<exact participant name or null>",
 "due":"<YYYY-MM-DD or null>",
 "topic":"<one of: {topics}>",
 "agenda":"<agenda ref or null>",
 "segIds":["s0412","s0413"],        ← REQUIRED. Only ids you were given.
 "confidence":0.0-1.0}

Rules:
- Every item must cite segIds. An item with no segIds is invalid — drop it.
- A decision is a settled position, not a proposal. "We should consider X" is a question.
- An action needs a verb and, where stated, an owner. Never invent an owner.
- Resolve relative dates against the meeting date {date}. "next Tuesday" → the date.
- Do not summarise. Extract only what was said.
```

**Post-validation, all of it cheap and deterministic:**

| Check | Action on fail |
|---|---|
| every `segId` exists | drop the item |
| `owner` ∈ attendees | null the owner, flag `needsOwner` |
| `due` parses and is ≥ meeting date | null the date, flag `needsDate` |
| decisions with hedging verbs ("should", "maybe", "consider") | reclassify → `question` |
| near-duplicate text across chunks (cosine > 0.9) | merge, union the `segIds` |
| `type: action` with no verb | reclassify → `info` |

`confidence` = min(mean ASR confidence over cited segments, extractor self-reported). This is what drives the bar in the Source column and the "N need review" count in the header.

### 5.3 Templates per meeting type

A `MeetingTemplate` selects the topic vocabulary, the agenda skeleton, the extraction prompt's type emphasis, and the export layout.

- `weekly-progress` (the CPOC case) — HSE / document review / mobilisation / marine / procurement; heavy on actions + carry-forward
- `standup` — light, actions only, no MoM export
- `contract-negotiation` — decisions and positions, both parties' wording preserved verbatim, no paraphrase
- `technical-review` — risks and open questions dominant
- `custom` — user-defined topic list

Store templates as JSON under `~/.localtranssub/templates/`. Ship three, let the user clone.

### 5.4 API surface

Extend `native/server.py`. Existing `/notes`, `/notes/generate` stay as v1 shims for one release, then redirect.

```
GET    /v2/meetings?series=&from=&to=&q=       list + filter
POST   /v2/meetings                             create (from calendar or manual)
GET    /v2/meetings/{id}                        full meeting + items
PATCH  /v2/meetings/{id}                        metadata
POST   /v2/meetings/{id}/extract                → job id  (async, long)
GET    /v2/jobs/{jobId}                         reuse the existing job machinery
PATCH  /v2/items/{ref}                          field edits; appends to history
POST   /v2/items/{ref}/accept                   ai → accepted
POST   /v2/meetings/{id}/carry-forward          pull open items from prior meeting in series
POST   /v2/meetings/{id}/issue                  freeze; sets issuedAt; blocks further edits
GET    /v2/meetings/{id}/export?format=md|docx|xlsx|csv|ics|json
GET    /v2/search?q=&type=&owner=&status=&from= cross-meeting
GET    /v2/series/{seriesId}/open-items         the standing action register
GET    /v2/series/{seriesId}/stats              closure rate, mean age, by owner
```

`/extract` must be a job, not a request — a 2-hour meeting is minutes of GPU time. The job machinery in `server.py:609-680` already does this for file transcription; reuse it verbatim.

### 5.5 Storage — end the two-store split (G10)

**SQLite** at `~/.localtranssub/transsub.db`, owned by the native helper, single writer.

```sql
meetings(id PK, series_id, seq, title, date, start, end, tz, chair,
         template, engine_json, generated_at, issued_at, schema_version)
participants(meeting_id, name, org, email, speaker_label)
agenda(meeting_id, ref, title_json, covered)
items(ref PK, meeting_id, type, topic, agenda_ref, text_json, owner, org,
      due, status, priority, review, confidence, carried_from, opened_at)
provenance(item_ref PK, meeting_id, t0, t1, speaker, lang, orig, tr, segment_id)
segments(id PK, meeting_id, t0, t1, speaker, lang, text, tr, conf)
history(id PK, item_ref, at, actor, field, from_val, to_val)
items_fts  -- FTS5 virtual table over items.text_json + provenance.orig/tr
```

FTS5 gives cross-meeting search with no embedding model and no index to keep warm. Add vectors later only if lexical search proves insufficient — for a register of a few thousand short items it usually doesn't.

**The extension keeps `chrome.storage.local` as a cache only**, with the helper as the source of truth. Rules: helper online → read through, write through; helper offline → serve cache read-only and queue edits with a `pendingOps` log; on reconnect, replay ops in order, last-write-wins per field with `history` recording both sides. Never merge two stores by guessing.

Audio and the raw transcript stay on disk (`~/.localtranssub/recordings/{meetingId}/`), referenced by path, never in the DB.

---

## 6. Long-term usage — the part that decides whether this gets used in year two

### 6.1 Meeting series and carry-forward

`seriesId` is what turns 52 disconnected notes into a project record.

On creating meeting *n*, the helper pulls every item from meeting *n−1* (and earlier, unresolved) in the same series with `status ∈ {open, progress}` and stages them as `carried`. The minute-taker triages: `Carry in` (re-numbers into this week, keeps `openedAt` and a `carriedFrom` chain) or `Close`. **Age never resets.** W35-022 carried three times is 22 days old, not 1 — and that number is the one that goes in the progress report.

This alone is worth more than every extraction feature combined, and neither Loop nor a Teams bot does it.

### 6.2 The standing register

`GET /v2/series/{id}/open-items` is the live action register across the whole project — the thing that today lives in someone's spreadsheet and is always one meeting stale. Give it its own view: filter by owner, by org, by overdue, by topic. Export to XLSX and it *is* the register you attach to the weekly report.

Series statistics that follow for free and are genuinely useful in a progress-control context: closure rate per week, mean age of open items, items opened vs closed (a burn-up), distribution by owner and by org, topics that generate the most repeat items.

### 6.3 Growth and retention

At one 2-hour meeting a week: ~20 items and ~1,500 segments per meeting → ~1,000 items and ~78,000 segments a year. SQLite is unbothered. Audio is the weight: ~120 MB/meeting compressed, ~6 GB/year.

Retention policy, per series, user-set, default:

- **items + provenance text** — forever (this is the record)
- **full segment transcript** — 24 months, then keep only segments cited by an item
- **audio** — 6 months, then delete; provenance keeps `orig`/`tr` text so a row still shows its source, just without playback
- **issued MoM exports** — forever, immutable, in a `mom/` folder

Surface it as a Storage panel with real numbers and a "what will be deleted" preview. A local-first product that silently eats a disk loses the user who chose it for control.

### 6.4 Issue, freeze, and amend

`POST /issue` freezes the meeting: `issuedAt` is set, items become read-only, an immutable export is written. Later corrections don't mutate the record — they create an **amendment** (`MOM-CPOC7-W36-A1`) that references the original. For anyone whose minutes might be read back to them in a contractual argument, this distinction is the whole point, and it's cheap to build if `history` exists from day one.

### 6.5 Integration, without giving up local-first

Export first, sync later, always user-initiated:

- **XLSX** — the register, one row per item, matching the on-screen columns (use the existing `xlsx` skill's layout conventions)
- **DOCX** — the issued MoM, on the company template
- **ICS** — one VTODO per open action with its due date, so actions land in the owner's calendar
- **CSV** — for import into a tracker or a schedule tool
- **Markdown / clipboard-as-table** — paste straight into Loop or Teams, so the team's existing habits survive

Then, optionally and behind an explicit toggle: read a `.ics` calendar file to prefill meeting metadata and attendees (offline, no API); push actions to Planner/Jira via a user-supplied token. Never make an outbound call the user hasn't switched on individually — that promise is the product.

### 6.6 Multi-device

Out of scope for v2, but don't design it out. The DB is single-writer by meeting, `history` is append-only, and every item has a stable `ref` — which is exactly the shape that syncs later over a user-owned folder (iCloud/Dropbox/Syncthing) with per-meeting file locking. Don't build a server.

---

## 7. Roadmap

| Phase | Scope | Ships |
|---|---|---|
| **2.0** Schema + register | v2 schema, migration, SQLite, `/v2` read+write, minutes workspace page, table + drawer, full EN/ID i18n, editing, MD/CSV/XLSX export | The register replaces the current panel |
| **2.1** Real extraction | mlx_lm extractor, constrained JSONL, validators, confidence, `review` states, `/extract` job, templates | Regex gone; the numbers in the header become trustworthy |
| **2.2** Provenance | segment store, `▶` seek from item to audio, waveform span, diarization → speaker names, original/translation pair in the drawer | The moat |
| **2.3** Series | `seriesId`, carry-forward, age tracking, standing register, series stats, cross-meeting FTS search | Year-two value |
| **2.4** Issue & retain | issue/freeze/amend, DOCX + ICS export, retention policy UI, storage panel | Defensible for contract work |

Sequencing note: 2.0 before 2.1 is deliberate. A better extractor writing into the old `string[]` schema throws away most of what it produces. Fix the container first.

---

## 8. Files to touch

| File | Action |
|---|---|
| `src/lib/notes-schema.js` | rewrite — v2 types, `createMinuteItem`, `createMeeting`, validators |
| `src/lib/notes-migrate.js` | **new** — v1 → v2, schema-version gated |
| `src/lib/notes-store.js` | rewrite — cache + `pendingOps` queue against the helper |
| `src/lib/notes-api.js` | extend — `/v2/*` client |
| `src/lib/notes-generate.js` | **delete** the regex path; keep a thin heuristic fallback for when the helper is offline, clearly labelled as such in the UI |
| `src/lib/notes-export.js` | extend — md / csv / xlsx / ics / docx |
| `src/notes-panel.js` | rewrite — becomes the compact live-capture ticker |
| `src/minutes.html` + `src/minutes.js` + `src/minutes.css` | **new** — the workspace (port from the prototype) |
| `src/lib/i18n.js` | add `notes.*` namespace, EN + ID written out |
| `src/manifest.json` | register the workspace page + `chrome.tabs.create` from the panel |
| `native/server.py` | `/v2` routes, SQLite layer, extractor job |
| `native/extract.py` | **new** — chunker, prompt, mlx_lm call, validators |
| `native/store.py` | **new** — SQLite schema + migrations |
| `test/notes-register.html` | the prototype — keep as the visual reference harness |
| `test/e2e.mjs`, `smoke.mjs` | add register cases: extract → edit → accept → carry-forward → export |

---

## 9. Open questions for you

1. **Working language.** Are the CPOC meetings conducted in Mandarin with English minutes? That decides whether `text.zh` is the primary key and `en`/`id` are derived, or the reverse.
2. **Does the register need to reconcile with a schedule tool?** If these actions ought to tie to P6 activity IDs, add `activityId` to `MinuteItem` now rather than retrofitting.
3. **Who else reads the MoM?** If it goes to COMPANY, the DOCX template and the `org` column matter more than anything in §5; if it's internal, §6.1 carry-forward is the priority.
4. **Diarization budget.** Speaker names make owner-assignment near-automatic, but pyannote adds ~1.5 GB and real GPU time. Worth it, or accept manual owner assignment in 2.0?

---

# Addendum — after reading the complete Loop page

The first read of the CPOC Phase 7 page was truncated. The full page carries two further sections, and one of them changes the schema.

## A1. Two sections the first read missed

**Progress Reporting.** "The 28 August 2026 progress report was issued as the pre-baseline version for the WPR, with weightage updated according to the latest information. Land-pack manufacturing was reported complete for all batches and ready for shipment, resulting in cumulative actual progress of 10.89%, which was 1.11% ahead of baseline."

**Schedule Risk.** "The team identified a significant potential delay risk for the Ben and Coding activities, particularly for items planned for shipment to DNS, and noted that the risk needed continued monitoring and mitigation despite the project being ahead of baseline this week."

## A2. A sixth item type: `metric`

Three numbers — 10.89% actual, 9.78% implied baseline, +1.11% variance — arrived inside one spoken sentence and Loop stored them as prose. Next week's figure will land in a different paragraph on a different page, and nobody will be able to plot the two together without retyping them.

Add `metric` to `ItemType`:

```js
/** @typedef {'decision'|'action'|'question'|'risk'|'info'|'metric'} ItemType */

/**
 * @typedef {object} MetricPayload   present only when type === 'metric'
 * @property {string} measure      "cumulative_progress" — stable key, series-scoped
 * @property {number} value        10.89
 * @property {number|null} baseline 9.78
 * @property {number|null} variance +1.11   (derived, stored for export fidelity)
 * @property {string} unit         "%"
 * @property {string} asOf         YYYY-MM-DD — the report date, NOT the meeting date
 * @property {string|null} sourceDoc "28 Aug 2026 progress report (pre-baseline, WPR)"
 */
```

Why it earns a type rather than a tag:

- `GET /v2/series/{id}/metrics?measure=cumulative_progress` returns the S-curve with no parsing. Thirteen meetings become a chart instead of thirteen sentences.
- The extractor prompt gets a rule that pays for itself immediately: *a percentage, quantity or rate stated as a project status figure is a `metric`, not an `info` — capture value, baseline and the date it is "as of".*
- Export changes shape: metrics become their own sheet in the XLSX, with one row per meeting per measure. That sheet is directly pasteable into a WPR.
- `asOf` matters. The figure was reported on 28 August but discussed on 2 September. Storing only the meeting date silently shifts every point on the curve by five days.

Candidate measures visible in this one meeting: `cumulative_progress`, `baseline_progress`, `manhours_accumulated` (35,000+), `hse_incidents` (0). The last two are already in the register as `info` items — reclassify them.

## A3. The case for provenance, in one line of the client's own minutes

The Loop page reads: *"a significant potential delay risk for the **Ben and Coding** activities."*

There is no activity called Ben and Coding. In a pipeline fabrication scope, the activity is **bending and coating**. Speech recognition misheard it, the summariser wrote the mishearing down as fact, and it was issued to the team as part of the official record. Nobody reading that page can tell — the audio is not attached to the sentence, so there is nothing to check it against.

This is the whole argument for §4.4 and §5.2, and it is worth stating plainly in the roadmap:

1. **Confidence must be per-item, not per-page.** Loop's single "AI-generated content may be incorrect" banner cannot distinguish this line from the 21 correct ones. `MinuteItem.confidence`, derived from the ASR confidence over the cited segments, can — and a sub-threshold item gets a visible flag rather than a footnote.
2. **The drawer must show the original beside the translation.** The mistake is invisible in English and obvious against the source audio. Showing `src.orig` and `src.tr` side by side is what makes it catchable in two seconds.
3. **A project glossary closes the loop.** Domain terms — bending and coating, HRLFE, PLV, ZPMC, GMDR, MDR, MWS, OSP, CUL, DNS, C900 — should be a per-series word list fed to the ASR decoder as an initial prompt/bias and used to post-correct near-misses. Add `Series.glossary: string[]`, seeded from accepted item text, editable, and offer "Add to glossary" from the correction banner. This is the cheapest accuracy win available and it compounds: by week 20 the model has the project's vocabulary.

Design implication, already built into the prototype and the canvas: the correction banner is not an error state to be hidden. It is the product demonstrating that it can be checked.

## A4. Series evidence

The Loop navigator lists prior meeting pages: May 20, Jun 3, Jun 10, Jun 24, Jul 1, Jul 8, Jul 16, Jul 22, Aug 5, Aug 12 — and onward to Sep 2. Thirteen-plus weekly meetings, each a separate page, each starting from an empty Decisions list.

That list is §6.1 stated as a fact rather than a hypothesis: the carry-forward and standing-register work is not a nice-to-have for "later", it is the difference between thirteen documents and one project record. Move phase **2.3 Series** ahead of **2.2 Provenance** only if the glossary from A3 can ship inside 2.1 — otherwise keep the order, because an inaccurate register carried forward for a year is worse than no register.

## A5. Revised item-type palette

| Type | Hue | Token |
|---|---|---|
| Decision | harbour blue | `#7fb3d5` |
| Action | buoy amber | `#e0b05c` |
| Question | violet | `#b79ce0` |
| Risk | signal red | `#e06c75` |
| Metric | cyan | `#4fb8c9` |
| Note | slate | `#9a9a9a` |

Chart series use their own validated pair — `#199e70` and `#d95926` on the `#1f1f1f` surface (passes lightness band, chroma floor, CVD separation, normal-vision floor and contrast). The emerald `--accent` stays reserved for interface affordances and the closed state; it is never a data colour.

## A6. Still outstanding

The TeamsMaestro tab could not be read — the browser bridge required a browser-selection call this session does not expose. §1.2 remains written against the product class rather than that specific page. Re-open it and this section can be replaced with a real diff.
