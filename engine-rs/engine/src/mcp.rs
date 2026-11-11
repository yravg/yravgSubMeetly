//! `submeetly-engine mcp`: a Model Context Protocol server on stdio (newline-delimited
//! JSON-RPC 2.0) that lets an AI assistant (Claude Desktop, Claude Code, any MCP client) read
//! and search the person's meetings. It is a client of the running engine's loopback HTTP API:
//! it does not start the engine, and says so when nothing answers.
//!
//! Tools: list_meetings, get_meeting, search_meetings, get_transcript, list_action_items,
//! create_note, ask. Resources: `submeetly://meeting/<id>` (Markdown).

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use crate::client::{grounding, summary_row, transcript_text, Client};

const SUPPORTED: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

pub fn tools() -> Value {
    let id =
        json!({ "type": "string", "description": "The meeting id, as list_meetings shows it" });
    json!([
        { "name": "list_meetings", "description": "List the saved meetings (newest first) with their id, title, date and counts.",
          "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 50 } } } },
        { "name": "get_meeting", "description": "One meeting: summary, decisions, action items and register items.",
          "inputSchema": { "type": "object", "properties": { "id": id }, "required": ["id"] } },
        { "name": "search_meetings", "description": "Search every meeting's title, summary, decisions, actions and transcript for a word or phrase.",
          "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] } },
        { "name": "get_transcript", "description": "A meeting's transcript as [mm:ss] lines (with translations when it has them).",
          "inputSchema": { "type": "object", "properties": { "id": id }, "required": ["id"] } },
        { "name": "list_action_items", "description": "Open action items across all meetings, or of one meeting.",
          "inputSchema": { "type": "object", "properties": { "meeting_id": id, "include_closed": { "type": "boolean" } } } },
        { "name": "create_note", "description": "Save a new meeting note (for example minutes the assistant wrote).",
          "inputSchema": { "type": "object", "properties": {
              "title": { "type": "string" }, "summary": { "type": "string" }, "date": { "type": "string" },
              "decisions": { "type": "array", "items": { "type": "string" } },
              "actions": { "type": "array", "items": { "type": "object", "properties": { "text": { "type": "string" }, "owner": { "type": "string" }, "due": { "type": "string" } }, "required": ["text"] } } },
            "required": ["title"] } },
        { "name": "ask", "description": "Ask the local on-device model a question about a meeting (or the latest five). Needs the translation model downloaded.",
          "inputSchema": { "type": "object", "properties": { "question": { "type": "string" }, "meeting_id": id }, "required": ["question"] } },
    ])
}

fn text(content: String) -> Value {
    json!({ "content": [{ "type": "text", "text": content }] })
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// One tool call: Ok(result) or Err(message), which the caller turns into `isError`.
pub fn call_tool(client: &Client, name: &str, args: &Value) -> Result<Value, String> {
    let arg = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    let need = |key: &str| arg(key).ok_or_else(|| format!("{key} is required"));
    match name {
        "list_meetings" => {
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(20)
                .clamp(1, 50) as usize;
            let rows: Vec<Value> = client
                .notes()?
                .iter()
                .take(limit)
                .map(summary_row)
                .collect();
            Ok(text(pretty(&json!({ "meetings": rows }))))
        }
        "get_meeting" => {
            let mut note = client.note(need("id")?)?;
            // The transcript has its own tool: keep this answer small.
            if let Some(n) = note
                .get("transcript")
                .and_then(Value::as_array)
                .map(Vec::len)
            {
                note["transcript"] = json!(format!("{n} lines: use get_transcript"));
            }
            Ok(text(pretty(&note)))
        }
        "search_meetings" => Ok(text(pretty(
            &json!({ "results": client.search(need("query")?)? }),
        ))),
        "get_transcript" => {
            let note = client.note(need("id")?)?;
            let t = transcript_text(&note);
            Ok(text(if t.is_empty() {
                "This meeting has no transcript.".into()
            } else {
                t
            }))
        }
        "list_action_items" => {
            let closed = args
                .get("include_closed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(text(pretty(
                &json!({ "actionItems": client.action_items(arg("meeting_id"), closed)? }),
            )))
        }
        "create_note" => {
            let reply = client.post(
                "/notes",
                &json!({ "note": {
                "title": need("title")?,
                "summary": arg("summary").unwrap_or(""),
                "date": arg("date").unwrap_or(""),
                "decisions": args.get("decisions").cloned().unwrap_or(json!([])),
                "actions": args.get("actions").cloned().unwrap_or(json!([])),
                "source": "mcp",
            } }),
            )?;
            Ok(text(pretty(
                &json!({ "saved": reply.get("note").map(summary_row) }),
            )))
        }
        "ask" => {
            let notes = client.notes()?;
            let answer = client.ask(need("question")?, &grounding(&notes, arg("meeting_id")))?;
            Ok(text(answer))
        }
        other => Err(format!("unknown tool {other}")),
    }
}

fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// One JSON-RPC message in, the answer out (None for a notification).
pub fn handle(client: &Client, message: &Value) -> Option<Value> {
    let method = message.get("method").and_then(Value::as_str)?;
    let id = message.get("id");
    // Notifications (no id) never get an answer.
    let id = match id {
        Some(id) if !id.is_null() => id.clone(),
        _ => return None,
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            let version = SUPPORTED
                .iter()
                .find(|v| **v == asked)
                .unwrap_or(&SUPPORTED[0]);
            reply(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false }, "resources": { "listChanged": false, "subscribe": false } },
                    "serverInfo": { "name": "yravgsubmeetly", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Read, search and write the person's meeting notes held by the local yravgSubMeetly engine. Everything stays on this computer.",
                }),
            )
        }
        "ping" => reply(&id, json!({})),
        "tools/list" => reply(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(client, name, &args) {
                Ok(result) => reply(&id, result),
                Err(message) if name_known(name) => reply(
                    &id,
                    json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
                ),
                Err(message) => error(&id, -32602, &message),
            }
        }
        "resources/list" => match client.notes() {
            Ok(notes) => reply(
                &id,
                json!({ "resources": notes.iter().map(|n| json!({
                "uri": format!("submeetly://meeting/{}", n.get("id").and_then(Value::as_str).unwrap_or("")),
                "name": n.get("title").and_then(Value::as_str).unwrap_or("Meeting"),
                "description": n.get("date").and_then(Value::as_str).unwrap_or(""),
                "mimeType": "text/markdown",
            })).collect::<Vec<_>>() }),
            ),
            Err(e) => error(&id, -32603, &e),
        },
        "resources/templates/list" => reply(
            &id,
            json!({ "resourceTemplates": [{
            "uriTemplate": "submeetly://meeting/{id}", "name": "Meeting", "mimeType": "text/markdown",
            "description": "A meeting's minutes as Markdown",
        }] }),
        ),
        "resources/read" => {
            let uri = params.get("uri").and_then(Value::as_str).unwrap_or("");
            match uri.strip_prefix("submeetly://meeting/") {
                None => error(&id, -32602, "unknown resource uri"),
                Some(note_id) => {
                    match client.post("/notes/export", &json!({ "id": note_id, "format": "md" })) {
                        Ok(out) => reply(
                            &id,
                            json!({ "contents": [{
                        "uri": uri, "mimeType": "text/markdown",
                        "text": out.get("content").and_then(Value::as_str).unwrap_or(""),
                    }] }),
                        ),
                        Err(e) => error(&id, -32002, &e),
                    }
                }
            }
        }
        "prompts/list" => reply(&id, json!({ "prompts": [] })),
        _ => error(&id, -32601, "method not found"),
    })
}

fn name_known(name: &str) -> bool {
    tools()
        .as_array()
        .is_some_and(|t| t.iter().any(|x| x["name"] == name))
}

/// The stdio loop: one JSON message per line, one answer per request, until stdin closes.
pub fn run(client: &Client, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let answers: Vec<Value> = batch.iter().filter_map(|m| handle(client, m)).collect();
                (!answers.is_empty()).then_some(Value::Array(answers))
            }
            Ok(message) => handle(client, &message),
            Err(_) => Some(error(&Value::Null, -32700, "parse error")),
        };
        if let Some(answer) = answer {
            writeln!(output, "{answer}")?;
            output.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offline() -> Client {
        // Nothing listens on port 9: every engine call fails with the "not answering" error.
        Client::new("http://127.0.0.1:9").unwrap()
    }

    #[test]
    fn initialize_tools_and_notifications() {
        let c = offline();
        let init = handle(&c, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2024-11-05");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        // An unknown version gets the newest supported.
        let init = handle(&c, &json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "1999-01-01" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert!(handle(
            &c,
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
        )
        .is_none());
        let list = handle(
            &c,
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" }),
        )
        .unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "list_meetings",
                "get_meeting",
                "search_meetings",
                "get_transcript",
                "list_action_items",
                "create_note",
                "ask"
            ]
        );
        assert_eq!(
            handle(&c, &json!({ "jsonrpc": "2.0", "id": 4, "method": "nope" })).unwrap()["error"]
                ["code"],
            -32601
        );
    }

    #[test]
    fn a_tool_with_the_engine_away_is_an_error_result_not_a_crash() {
        let c = offline();
        let out = handle(&c, &json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "list_meetings", "arguments": {} } })).unwrap();
        assert_eq!(out["result"]["isError"], true);
        assert!(out["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("not answering"));
        let bad = handle(&c, &json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": { "name": "rm_rf" } })).unwrap();
        assert_eq!(bad["error"]["code"], -32602);
        let missing = handle(&c, &json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": "get_meeting", "arguments": {} } })).unwrap();
        assert!(missing["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("id is required"));
    }

    #[test]
    fn the_loop_answers_each_line_and_survives_garbage() {
        let c = offline();
        let input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\nnot json\n\n{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n";
        let mut out = Vec::new();
        run(&c, input.as_bytes(), &mut out).unwrap();
        let lines: Vec<Value> = String::from_utf8(out)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["result"], json!({}));
        assert_eq!(lines[1]["error"]["code"], -32700);
    }
}
