//! A thin client of the engine's loopback HTTP API, shared by `submeetly-engine cli` and
//! `submeetly-engine mcp`. It never starts the engine: when nothing answers it says so.

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde_json::{json, Value};

pub const DEFAULT_PORT: u16 = 17865;

pub struct Client {
    base: String,
    agent: ureq::Agent,
}

impl Client {
    /// `ENGINE_URL` (full base, loopback only), else `http://127.0.0.1:<PORT | YSM_HELPER_PORT | 17865>`.
    pub fn from_env() -> Result<Self, String> {
        let base = match std::env::var("ENGINE_URL").ok().filter(|v| !v.is_empty()) {
            Some(url) => url.trim_end_matches('/').to_string(),
            None => {
                let port = ["PORT", "YSM_HELPER_PORT"]
                    .iter()
                    .filter_map(|k| std::env::var(k).ok())
                    .find_map(|v| v.trim().parse::<u16>().ok())
                    .unwrap_or(DEFAULT_PORT);
                format!("http://127.0.0.1:{port}")
            }
        };
        Self::new(&base)
    }

    pub fn new(base: &str) -> Result<Self, String> {
        let host = base
            .strip_prefix("http://")
            .ok_or("ENGINE_URL must start with http://")?;
        let host = host.split('/').next().unwrap_or("");
        let name = host.rsplit_once(':').map_or(host, |(h, _)| h);
        if !(name == "localhost" || name == "[::1]" || name.starts_with("127.")) {
            return Err(
                "the engine is loopback only: ENGINE_URL must name 127.0.0.1 or localhost".into(),
            );
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(3)))
            .timeout_global(Some(Duration::from_secs(120)))
            .http_status_as_error(false)
            .build()
            .into();
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            agent,
        })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    fn down(&self, error: impl std::fmt::Display) -> String {
        format!(
            "The yravgSubMeetly engine is not answering at {} ({error}). Open the yravgSubMeetly app (it starts the engine) or run submeetly-engine.",
            self.base
        )
    }

    fn finish(&self, mut reply: ureq::http::Response<ureq::Body>) -> Result<Value, String> {
        let status = reply.status().as_u16();
        let text = reply
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())?;
        let value = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
        if status >= 400 {
            let why = value
                .get("error")
                .and_then(Value::as_str)
                .map_or_else(|| format!("status {status}"), str::to_string);
            return Err(format!("{why} (status {status})"));
        }
        Ok(value)
    }

    pub fn get(&self, path: &str) -> Result<Value, String> {
        let reply = self
            .agent
            .get(&format!("{}{path}", self.base))
            .call()
            .map_err(|e| self.down(e))?;
        self.finish(reply)
    }

    pub fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let reply = self
            .agent
            .post(&format!("{}{path}", self.base))
            .header("Content-Type", "application/json")
            .send(body.to_string())
            .map_err(|e| self.down(e))?;
        self.finish(reply)
    }

    /// `POST /ask`, the streamed local-model answer, collected into one string.
    pub fn ask(&self, question: &str, grounding: &str) -> Result<String, String> {
        let body = json!({ "question": question, "grounding": grounding, "history": [] });
        let reply = self
            .agent
            .post(&format!("{}/ask", self.base))
            .header("Content-Type", "application/json")
            .send(body.to_string())
            .map_err(|e| self.down(e))?;
        if reply.status().as_u16() >= 400 {
            return Err(self
                .finish(reply)
                .err()
                .unwrap_or_else(|| "ask failed".into()));
        }
        let mut out = String::new();
        for line in BufReader::new(reply.into_body().into_reader()).lines() {
            let line = line.map_err(|e| e.to_string())?;
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            let event: Value = serde_json::from_str(data).unwrap_or(Value::Null);
            if let Some(piece) = event.get("delta").and_then(Value::as_str) {
                out.push_str(piece);
            }
            if let Some(error) = event.get("error").and_then(Value::as_str) {
                return Err(error.to_string());
            }
            if event.get("done").is_some() {
                break;
            }
        }
        Ok(out)
    }

    // ---- what the CLI and the MCP server both do with notes

    pub fn notes(&self) -> Result<Vec<Value>, String> {
        Ok(self
            .get("/notes")?
            .get("notes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    pub fn note(&self, id: &str) -> Result<Value, String> {
        let path = format!("/notes/{}", encode(id));
        self.get(&path)?
            .get("note")
            .cloned()
            .ok_or_else(|| "note not found".to_string())
    }

    pub fn search(&self, query: &str) -> Result<Vec<Value>, String> {
        Ok(search_notes(&self.notes()?, query))
    }

    /// Open action items of every meeting (or of `note_id`), each with the meeting it came from.
    pub fn action_items(
        &self,
        note_id: Option<&str>,
        include_closed: bool,
    ) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        for note in self.notes()? {
            if note_id.is_some_and(|id| note.get("id").and_then(Value::as_str) != Some(id)) {
                continue;
            }
            for action in note
                .get("actions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if !include_closed && action.get("status").and_then(Value::as_str) == Some("closed")
                {
                    continue;
                }
                let mut item = action.clone();
                item["meetingId"] = note.get("id").cloned().unwrap_or(Value::Null);
                item["meetingTitle"] = note.get("title").cloned().unwrap_or(Value::Null);
                out.push(item);
            }
        }
        Ok(out)
    }
}

/// A meeting as one list row.
pub fn summary_row(note: &Value) -> Value {
    json!({
        "id": note.get("id").cloned().unwrap_or(Value::Null),
        "title": note.get("title").cloned().unwrap_or(Value::Null),
        "date": note.get("date").cloned().unwrap_or(Value::Null),
        "status": note.get("status").cloned().unwrap_or(Value::Null),
        "decisions": note.get("decisions").and_then(Value::as_array).map_or(0, Vec::len),
        "actions": note.get("actions").and_then(Value::as_array).map_or(0, Vec::len),
    })
}

/// The transcript lines as `[mm:ss] text` (and the translation under each when there is one).
pub fn transcript_text(note: &Value) -> String {
    let mut out = String::new();
    for line in note
        .get("transcript")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let t = line.get("t0").and_then(Value::as_f64).unwrap_or(0.0) as u64;
        let text = line.get("source").and_then(Value::as_str).unwrap_or("");
        out.push_str(&format!("[{:02}:{:02}] {text}\n", t / 60, t % 60));
        if let Some(tr) = line
            .get("translation")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            out.push_str(&format!("        {tr}\n"));
        }
    }
    out
}

/// Case-insensitive search over title, summary, decisions, actions and transcript; each hit says where.
pub fn search_notes(notes: &[Value], query: &str) -> Vec<Value> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for note in notes {
        let mut found: Vec<String> = Vec::new();
        let mut check = |label: &str, text: &str| {
            if text.to_lowercase().contains(&q) {
                let at = text.to_lowercase().find(&q).unwrap_or(0);
                let start = text
                    .char_indices()
                    .map(|(i, _)| i)
                    .rfind(|&i| i <= at.saturating_sub(40))
                    .unwrap_or(0);
                let snippet: String = text[start..].chars().take(120).collect();
                found.push(format!("{label}: {}", snippet.replace('\n', " ")));
            }
        };
        check(
            "title",
            note.get("title").and_then(Value::as_str).unwrap_or(""),
        );
        check(
            "summary",
            note.get("summary").and_then(Value::as_str).unwrap_or(""),
        );
        for d in note
            .get("decisions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            check("decision", d.as_str().unwrap_or(""));
        }
        for a in note
            .get("actions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            check(
                "action",
                a.get("text").and_then(Value::as_str).unwrap_or(""),
            );
        }
        for l in note
            .get("transcript")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            check(
                "transcript",
                l.get("source").and_then(Value::as_str).unwrap_or(""),
            );
            check(
                "translation",
                l.get("translation").and_then(Value::as_str).unwrap_or(""),
            );
        }
        if !found.is_empty() {
            let mut row = summary_row(note);
            found.truncate(5);
            row["matches"] = json!(found);
            hits.push(row);
        }
    }
    hits
}

/// The grounding text `ask` gives the local model: the chosen meeting (or the latest ones).
pub fn grounding(notes: &[Value], note_id: Option<&str>) -> String {
    let mut out = String::from("You answer questions about the user's meeting notes. Use only these notes; say so when they don't contain the answer.\n\n");
    let chosen: Vec<&Value> = match note_id {
        Some(id) => notes
            .iter()
            .filter(|n| n.get("id").and_then(Value::as_str) == Some(id))
            .collect(),
        None => notes.iter().take(5).collect(),
    };
    for note in chosen {
        out.push_str(&format!(
            "## {} ({})\n{}\n",
            note.get("title").and_then(Value::as_str).unwrap_or(""),
            note.get("date").and_then(Value::as_str).unwrap_or(""),
            note.get("summary").and_then(Value::as_str).unwrap_or("")
        ));
        for d in note
            .get("decisions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            out.push_str(&format!("- Decision: {}\n", d.as_str().unwrap_or("")));
        }
        for a in note
            .get("actions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            out.push_str(&format!(
                "- Action: {}\n",
                a.get("text").and_then(Value::as_str).unwrap_or("")
            ));
        }
        let t = transcript_text(note);
        out.push_str(&t.chars().take(6000).collect::<String>());
        out.push('\n');
    }
    out
}

fn encode(id: &str) -> String {
    id.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note() -> Value {
        json!({ "id": "M1", "title": "Budget review", "date": "2026-11-01", "summary": "We agreed the Q4 budget.",
            "decisions": ["Freeze hiring"], "actions": [{ "id": "a1", "text": "Send the deck", "status": "open" }],
            "transcript": [{ "t0": 65.0, "t1": 70.0, "source": "Let us talk about hiring", "translation": "Mari bicara soal perekrutan" }] })
    }

    #[test]
    fn search_finds_every_part_of_a_meeting() {
        let notes = vec![note()];
        for q in ["budget", "FREEZE", "deck", "hiring", "perekrutan"] {
            assert_eq!(search_notes(&notes, q).len(), 1, "{q}");
        }
        assert!(search_notes(&notes, "zebra").is_empty());
        assert!(search_notes(&notes, "  ").is_empty());
    }

    #[test]
    fn transcript_and_grounding_are_readable() {
        assert!(transcript_text(&note()).starts_with("[01:05] Let us talk about hiring"));
        let g = grounding(&[note()], Some("M1"));
        assert!(
            g.contains("Budget review")
                && g.contains("Decision: Freeze hiring")
                && g.contains("Action: Send the deck")
        );
    }

    #[test]
    fn the_client_refuses_a_remote_engine() {
        assert!(Client::new("http://example.com:17865").is_err());
        assert!(Client::new("https://127.0.0.1:1").is_err());
        assert!(Client::new("http://127.0.0.1:17865").is_ok());
        assert!(Client::new("http://localhost:1").is_ok());
    }

    #[test]
    fn ids_are_percent_encoded() {
        assert_eq!(encode("MOM-WIN 1/2"), "MOM-WIN%201%2F2");
    }
}
