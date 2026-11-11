# Integrations: AI assistants, webhooks and scripts

Three ways to use your meetings outside the app. All of them talk to the **local engine**
(`submeetly-engine`, loopback only, default `http://127.0.0.1:17865`). Nothing leaves your computer
unless you set a webhook up yourself.

The engine is started by the yravgSubMeetly app. The MCP server and the command line do **not** start
it: with the app closed they say `The yravgSubMeetly engine is not answering at ...` and exit with 1.

Where the engine program is:

| | Path |
|---|---|
| macOS | `/Applications/yravgSubMeetly.app/Contents/MacOS/submeetly-engine` |
| Windows | `%LOCALAPPDATA%\Programs\yravgSubMeetly\submeetly-engine.exe` |

Set `PORT` (or `ENGINE_URL`, loopback only) when the engine listens on another port.

## 1. MCP server (Claude Desktop, Claude Code, any MCP client)

`submeetly-engine mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio
(newline-delimited JSON-RPC, protocol versions 2025-06-18, 2025-03-26 and 2024-11-05).

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yravgsubmeetly": {
      "command": "/Applications/yravgSubMeetly.app/Contents/MacOS/submeetly-engine",
      "args": ["mcp"]
    }
  }
}
```

On Windows use the full path with doubled backslashes, for example
`"command": "C:\\Users\\<you>\\AppData\\Local\\Programs\\yravgSubMeetly\\submeetly-engine.exe"`.

**Claude Code**:

```bash
claude mcp add yravgsubmeetly -- /Applications/yravgSubMeetly.app/Contents/MacOS/submeetly-engine mcp
```

Tools:

| Tool | What it does |
|---|---|
| `list_meetings` | The saved meetings, newest first: id, title, date, number of decisions and actions. `limit` 1 to 50. |
| `get_meeting` | One meeting: summary, decisions, action items, register items (`id`). |
| `search_meetings` | Searches titles, summaries, decisions, actions and transcripts (`query`); says where each word matched. |
| `get_transcript` | The transcript as `[mm:ss]` lines, with translations when it has them (`id`). |
| `list_action_items` | Open action items of every meeting, or of `meeting_id`; `include_closed` adds the closed ones. |
| `create_note` | Saves a new note: `title`, optional `summary`, `date`, `decisions`, `actions[{text, owner, due}]`. It fires the webhooks like any saved meeting. |
| `ask` | Asks the on-device model about a meeting (or the latest five). Needs the translation model downloaded (Settings, Models). |

Resources: every meeting is `submeetly://meeting/<id>` (Markdown).

## 2. Command line

```text
submeetly-engine cli list [--limit N] [--json]
submeetly-engine cli show <id> [--json]
submeetly-engine cli transcript <id>
submeetly-engine cli search <words...> [--json]
submeetly-engine cli actions [--meeting <id>] [--all] [--json]
submeetly-engine cli export <id> [--format md|txt|json] [--out file]
submeetly-engine cli ask <question...> [--meeting <id>]
submeetly-engine cli webhook list
submeetly-engine cli webhook add <url> [--secret S] [--events meeting.saved,action_items.created]
submeetly-engine cli webhook enable|disable|remove|test <id>
```

Exit code 0 on success, 1 when the engine is not running or says no, 2 for a command line it does not
understand. `--json` prints JSON for scripts. Examples:

```bash
submeetly-engine cli actions --json | jq -r '.actionItems[] | "\(.owner // "-")\t\(.text)"'
submeetly-engine cli export MOM-WIN-1730000000 --format md --out minutes.md
```

## 3. Webhooks

The engine calls a URL you choose when:

| Event | When | `data` |
|---|---|---|
| `meeting.saved` | A meeting is saved (the app after Stop, the Minutes register, `create_note`, `POST /notes`) | `{ "note": { ... } }` |
| `action_items.created` | A saved meeting has open action items it did not have before | `{ "noteId", "title", "actions": [ ... ] }` |
| `ping` | You press Test | `{ "message": ... }` |

Add them in **Settings, General, Webhooks** (copy the URL, press *Paste URL*; switch, Test and Remove on
each row), or with the command line (needed for a secret and for choosing events), or with the API:

```bash
curl -s -X POST http://127.0.0.1:17865/integrations/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hook","secret":"s3cret","events":["meeting.saved"]}'
```

`GET /integrations/webhooks` lists them (never the secret: only `hasSecret`) and how the last delivery
went. `POST /integrations/webhooks` adds (`url`), changes (`id` plus `url`, `secret`, `events`,
`enabled`) or removes (`id`, `remove: true`). `POST /integrations/webhooks/test {id}` sends one `ping`.

A delivery is a `POST` of JSON:

```json
{ "event": "meeting.saved", "delivery": "dl-3f9a01c2b7de", "createdAt": "2026-11-12T09:30:00Z", "data": { "note": { "id": "MOM-WIN-1", "title": "..." } } }
```

Headers: `X-Submeetly-Event`, `X-Submeetly-Timestamp` (unix seconds), and, when the hook has a secret,
`X-Submeetly-Signature: sha256=<hex>`: the HMAC-SHA256 of the **exact request body** with the secret as
key. Verify it before trusting a call:

```python
import hmac, hashlib
ok = hmac.compare_digest(
    request.headers["X-Submeetly-Signature"],
    "sha256=" + hmac.new(SECRET.encode(), request.body, hashlib.sha256).hexdigest())
```

Reliability: a delivery times out after 10 s; a connection error, a 5xx, 408 or 429 is retried three
times (1 s, 4 s, 16 s later), any other 4xx is not. Deliveries run on a background thread, so a slow
receiver never slows the engine, and they are not persisted: an engine that quits mid-retry drops them.
Make receivers idempotent on `delivery`.

### Safety

- Only URLs you entered. Nothing in a note, a transcript or a model answer can name one.
- `http://` and `https://` only, no `user:password@` in the URL (use the secret), at most 20 webhooks.
- Redirects are **not** followed, so a hook cannot bounce the engine to another address.
- Private and loopback addresses are allowed on purpose (a script on this computer is the common case):
  anyone who can reach the engine's loopback port as you can point it at your LAN. The engine already
  refuses other computers and other websites (origin check), exactly like every other engine route.
- The secrets are stored in `integrations.json` in the engine's state folder (`~/.yraveragesubmin`),
  readable by your account only on macOS and Linux. Treat that folder like your notes.

## Limits

- The MCP server and the CLI read the 50 most recent meetings the engine keeps.
- `ask` is the small local model: good for "what did we decide", not for long analysis.
- No webhook for transcript lines as they arrive, only for saved meetings.
