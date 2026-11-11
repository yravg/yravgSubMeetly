# Custom AI connector and summary templates

Both live in the engine (`engine-rs/engine/src/connector.rs`, `templates.rs`), so the island, the Chrome extension and the Mac app share them. Our own implementation; nothing here comes from Meetily Pro.

## Privacy: when does text leave the computer?

**Only when the connector is on.** It is off by default. While off, `/notes/summarize` and `/ask` use the local engine exactly as before, and nothing is sent anywhere. When the person turns it on (Settings › Models › Summaries and AI › "Use my own AI model"):

- `/notes/summarize` sends the transcript, and `/ask` the question, the grounding text and recent turns, to **the endpoint the person typed**, and to no one else.
- If the endpoint fails, `/notes/summarize` falls back to the local notes and says so (`via: "local"`, `connectorError`); `/ask` shows the error.
- `/notes/generate` (the automatic draft on Stop) **never** uses the connector; it stays local.

The API key is stored in `ai-connector.json` in the engine's state directory (`~/.yraveragesubmin`, mode 0600 on Unix). The API never returns it (only `hasKey` and the last four characters), it is sent only as a `Bearer` header, and it is scrubbed from error messages.

## Connector

Any OpenAI-compatible chat endpoint: OpenAI, OpenRouter, Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), a company gateway. The engine posts `{base}/chat/completions` with `stream: true` (and also reads servers that ignore `stream`).

| Route | |
|---|---|
| `GET /ai/connector` | `{enabled, baseUrl, model, hasKey, keyHint}` |
| `POST /ai/connector` | `{baseUrl?, model?, apiKey?, clearKey?, enabled?}`; an empty or absent `apiKey` keeps the saved one; enabling needs a URL and a model |
| `POST /ai/connector/test` | one tiny request with the saved settings plus any given: `{ok, model, sample, ms}` or `{ok:false, error}` |

In the island the three text fields are filled from the clipboard (copy, then press **Paste URL / Paste name / Paste key**), because Settings has no text boxes.

## Summary templates

Seven built-ins (General, Standup, 1:1, Sales call, Interview, Retrospective, Project status; read-only) plus the person's own (`note-templates.json`). A template is a name, a style (`bullets` or `prose`) and 1 to 12 sections; a section is a heading, a prompt for the model, and a `kind` (`summary`, `decisions`, `actions`, `questions`, `risks`, `topics`, `notes`) that the local keyword renderer uses.

| Route | |
|---|---|
| `GET /notes/templates` | `{templates, default}` |
| `POST /notes/templates` | create or replace one (`{id?, name, description?, style?, sections:[{heading, prompt?, kind?}]}`) |
| `DELETE /notes/templates/{id}` | custom ones only |
| `POST /notes/templates/default` | `{id}` or `{id: null}`: the template used when a request names none |

`POST /notes/generate` and `/notes/summarize` take `template` (an id or an inline object; `""` = plain notes; absent = the default template, if one is set). The reply adds `template`, `sections:[{heading, kind, items}]`, `markdown` and `via` (`"local"` or `"connector"`); the old `summary`, `decisions`, `actions` keys stay (filled from the sections by kind when the connector wrote them).

## Limits

- Local rendering is keyword extraction, not understanding: `risks` and `questions` find sentences with risk words or a `?`, `topics` lists the first segments. A model (the connector) does much better.
- The island's automatic notes on Stop use the default template locally; it never calls `/notes/summarize`, so the connector shapes summaries and Ask, not that draft.
