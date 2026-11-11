//! Notes document normalization and export.
//!
//! Mirrors `_normalize_note_doc` and the TXT/Markdown exporters in
//! native/server.py (the oracle). Documents are stored as `notes.json` under
//! the state directory; the schema is the register v2 superset.

use serde_json::{json, Map, Value};

use crate::state::{now_epoch_secs, now_utc_iso};

const ITEM_TYPES: [&str; 6] = ["decision", "action", "question", "risk", "metric", "info"];
const ITEM_STATUSES: [&str; 4] = ["open", "progress", "closed", "carried"];
const REVIEW_STATES: [&str; 3] = ["ai", "accepted", "edited"];
const PRIORITIES: [&str; 3] = ["high", "med", "low"];
const LIKELIHOODS: [&str; 4] = ["certain", "likely", "possible", "unlikely"];
const MAX_ITEMS: usize = 500;
const MAX_TRANSCRIPT: usize = 3000;
const LOW_CONFIDENCE: f64 = 0.7;

pub fn py_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

/// Python `str(value)` for the scalar shapes notes contain.
///
/// shortcut: objects/arrays format differently than Python repr and large
/// floats lose Python's exponent sign; no golden exercises either.
pub fn py_str(value: &Value) -> String {
    match value {
        Value::Null => "None".to_string(),
        Value::Bool(true) => "True".to_string(),
        Value::Bool(false) => "False".to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        other => other.to_string(),
    }
}

fn py_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn py_int(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().map(|u| u as i64))
            .or_else(|| number.as_f64().map(|f| f.trunc() as i64)),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        Value::Bool(flag) => Some(i64::from(*flag)),
        _ => None,
    }
}

fn truncate(text: String, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// Python `str(v or "")`: falsy values become the empty string.
fn text_or_empty(value: Option<&Value>) -> String {
    match value {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => String::new(),
    }
}

fn opt_text(value: Option<&Value>, limit: usize) -> Option<String> {
    match value {
        Some(inner) if py_truthy(inner) => Some(truncate(py_str(inner), limit)),
        _ => None,
    }
}

fn flat_text(value: &Value) -> String {
    let resolved = if let Value::Object(map) = value {
        for key in ["id", "en"] {
            if let Some(inner) = map.get(key) {
                if py_truthy(inner) {
                    return py_str(inner).trim().to_string();
                }
            }
        }
        map.values().next().unwrap_or(&Value::Null)
    } else {
        value
    };
    let text = if py_truthy(resolved) {
        py_str(resolved)
    } else {
        String::new()
    };
    text.trim().to_string()
}

fn pick(value: Option<&Value>, allowed: &[&str], fallback: Option<&str>) -> Option<String> {
    if let Some(Value::String(text)) = value {
        if allowed.contains(&text.as_str()) {
            return Some(text.clone());
        }
    }
    fallback.map(str::to_string)
}

fn normalize_metric(raw: Option<&Value>) -> Value {
    let Some(Value::Object(metric)) = raw else {
        return Value::Null;
    };
    let Some(value) = metric.get("value").and_then(py_f64) else {
        return Value::Null;
    };
    let opt_num = |key: &str| -> Value {
        match metric.get(key) {
            Some(Value::Null) | None => Value::Null,
            Some(inner) => match py_f64(inner) {
                Some(number) => json!(number),
                None => Value::Null,
            },
        }
    };
    json!({
        "measure": truncate(text_or_empty(metric.get("measure")), 120),
        "value": value,
        "unit": truncate(text_or_empty(metric.get("unit")), 24),
        "baseline": opt_num("baseline"),
        "variance": opt_num("variance"),
        "asOf": opt_text(metric.get("asOf"), 32),
    })
}

fn normalize_items(raw: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(items)) = raw else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (index, item) in items.iter().take(MAX_ITEMS).enumerate() {
        let Value::Object(item) = item else {
            continue;
        };
        let text = flat_text(item.get("text").unwrap_or(&Value::Null));
        if text.is_empty() {
            continue;
        }
        let confidence = match item.get("confidence").and_then(py_f64) {
            Some(number) => number.clamp(0.0, 1.0),
            None => 1.0,
        };
        let reference = match item.get("ref") {
            Some(inner) if py_truthy(inner) => py_str(inner),
            _ => format!("I-{}", index + 1),
        };
        let links = match item.get("links") {
            Some(Value::Array(values)) => values
                .iter()
                .take(20)
                .map(|value| truncate(py_str(value), 40))
                .collect(),
            _ => Vec::new(),
        };
        let needs_review =
            item.get("needsReview").map(py_truthy).unwrap_or(false) || confidence < LOW_CONFIDENCE;
        out.push(json!({
            "ref": truncate(reference, 40),
            "type": pick(item.get("type"), &ITEM_TYPES, Some("info")),
            "topic": truncate(text_or_empty(item.get("topic")), 120),
            "text": truncate(text, 4000),
            "owner": opt_text(item.get("owner"), 80),
            "org": opt_text(item.get("org"), 80),
            "due": opt_text(item.get("due"), 32),
            "status": pick(item.get("status"), &ITEM_STATUSES, Some("open")),
            "priority": pick(item.get("priority"), &PRIORITIES, None),
            "likelihood": pick(item.get("likelihood"), &LIKELIHOODS, None),
            "review": pick(item.get("review"), &REVIEW_STATES, Some("ai")),
            "confidence": confidence,
            "needsReview": needs_review,
            "tc": opt_text(item.get("tc"), 16),
            "speaker": opt_text(item.get("speaker"), 80),
            "carriedFrom": opt_text(item.get("carriedFrom"), 64),
            "links": links,
            "metric": normalize_metric(item.get("metric")),
        }));
    }
    out
}

fn normalize_transcript(raw: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(lines)) = raw else {
        return Vec::new();
    };
    let number = |line: &Map<String, Value>, key: &str| -> f64 {
        line.get(key)
            .and_then(py_f64)
            .map(|value| value.max(0.0))
            .unwrap_or(0.0)
    };
    let mut out = Vec::new();
    for line in lines.iter().take(MAX_TRANSCRIPT) {
        let Value::Object(line) = line else {
            continue;
        };
        let source_value = match line.get("source") {
            Some(inner) if py_truthy(inner) => inner,
            _ => line.get("text").unwrap_or(&Value::Null),
        };
        let source = flat_text(source_value);
        if source.is_empty() {
            continue;
        }
        let mut entry = json!({
            "t0": number(line, "t0"),
            "t1": number(line, "t1"),
            // Who said it ("You", "Others", "Speaker 2"): optional, absent in older documents.
            "speaker": opt_text(line.get("speaker"), 80),
            "source": truncate(source, 2000),
            "translation": truncate(
                flat_text(line.get("translation").unwrap_or(&Value::Null)),
                2000
            ),
        });
        // Who spoke (diarization or the capture source), only when the sender knows.
        if let Some(who) = opt_text(line.get("speaker"), 80) {
            entry["speaker"] = Value::String(who);
        }
        out.push(entry);
    }
    out
}

fn normalize_meeting_meta(raw: Option<&Value>) -> Value {
    let Some(Value::Object(meta)) = raw else {
        return Value::Null;
    };
    let empty = Map::new();
    let agenda = match meta.get("agenda") {
        Some(Value::Object(map)) => map,
        _ => &empty,
    };
    let engine = match meta.get("engine") {
        Some(Value::Object(map)) if !map.is_empty() => Some(map),
        _ => None,
    };
    let attendees = match meta.get("attendees") {
        Some(Value::Array(values)) => values
            .iter()
            .take(60)
            .map(|value| truncate(py_str(value), 100))
            .collect(),
        _ => Vec::new(),
    };
    let engine_value = match engine {
        Some(map) => json!({
            "asr": truncate(text_or_empty(map.get("asr")), 80),
            "mt": opt_text(map.get("mt"), 80),
            "segments": map.get("segments").and_then(py_int).unwrap_or(0),
            "durationSec": map.get("durationSec").and_then(py_int),
        }),
        None => Value::Null,
    };
    json!({
        "seriesId": truncate(text_or_empty(meta.get("seriesId")), 80),
        "seq": meta.get("seq").and_then(py_int),
        "projectType": truncate(
            match meta.get("projectType") {
                Some(inner) if py_truthy(inner) => py_str(inner),
                _ => "general".to_string(),
            },
            40
        ),
        "locale": truncate(
            match meta.get("locale") {
                Some(inner) if py_truthy(inner) => py_str(inner),
                _ => "en".to_string(),
            },
            16
        ),
        "tz": truncate(text_or_empty(meta.get("tz")), 64),
        "start": opt_text(meta.get("start"), 32),
        "end": opt_text(meta.get("end"), 32),
        "chair": opt_text(meta.get("chair"), 80),
        "attendees": attendees,
        "agenda": {
            "total": agenda.get("total").and_then(py_int).unwrap_or(0),
            "covered": agenda.get("covered").and_then(py_int).unwrap_or(0),
        },
        "issuedAt": opt_text(meta.get("issuedAt"), 40),
        "generatedAt": truncate(text_or_empty(meta.get("generatedAt")), 40),
        "engine": engine_value,
    })
}

pub fn normalize_note_doc(raw: &Value) -> Result<Value, String> {
    let Value::Object(doc) = raw else {
        return Err("note must be a JSON object".to_string());
    };
    let title_value = match doc.get("title") {
        Some(inner) if py_truthy(inner) => inner.clone(),
        _ => Value::String("Notulen sesi".to_string()),
    };
    let Value::String(title) = title_value else {
        return Err("title must be a string".to_string());
    };
    let summary_value = doc
        .get("summary")
        .cloned()
        .unwrap_or(Value::String(String::new()));
    let summary = match &summary_value {
        Value::Object(_) => flat_text(&summary_value),
        Value::String(text) => text.clone(),
        _ => return Err("summary must be a string".to_string()),
    };
    let decisions_value = doc
        .get("decisions")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let Value::Array(decisions_in) = decisions_value else {
        return Err("decisions must be a list".to_string());
    };
    let mut decisions = Vec::new();
    for decision in &decisions_in {
        let text = py_str(decision).trim().to_string();
        if !text.is_empty() {
            decisions.push(Value::String(text));
            if decisions.len() == 50 {
                break;
            }
        }
    }
    let actions_value = doc
        .get("actions")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let Value::Array(actions_in) = actions_value else {
        return Err("actions must be a list".to_string());
    };
    let mut actions = Vec::new();
    for (index, action) in actions_in.iter().take(100).enumerate() {
        let Value::Object(action) = action else {
            return Err(format!("actions[{}] must be an object", index + 1));
        };
        let text_value = action
            .get("text")
            .cloned()
            .unwrap_or(Value::String(String::new()));
        let text = if matches!(text_value, Value::Object(_)) {
            flat_text(&text_value)
        } else {
            py_str(&text_value)
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let id = match action.get("id") {
            Some(inner) if py_truthy(inner) => py_str(inner),
            _ => format!("act-{}", index + 1),
        };
        let status = match action.get("status") {
            Some(Value::String(value)) if value == "open" || value == "closed" => value.clone(),
            _ => "open".to_string(),
        };
        actions.push(json!({
            "id": id,
            "text": text,
            "owner": action.get("owner").cloned().unwrap_or(Value::Null),
            "due": action.get("due").cloned().unwrap_or(Value::Null),
            "status": status,
        }));
    }
    let id = match doc.get("id") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => format!("note-{}", now_epoch_secs()),
    };
    let date = match doc.get("date") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => String::new(),
    };
    let source = match doc.get("source") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => "helper".to_string(),
    };
    let status = match doc.get("status") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => "ready".to_string(),
    };
    let generated_at = match doc.get("generatedAt") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => now_utc_iso(),
    };
    Ok(json!({
        "id": id,
        "title": title.trim(),
        "date": date,
        "source": source,
        "status": status,
        "generatedAt": generated_at,
        "summary": summary,
        "decisions": decisions,
        "actions": actions,
        "transcriptPreview": text_or_empty(doc.get("transcriptPreview")),
        "savedLocally": true,
        "schemaVersion": 2,
        "meeting": normalize_meeting_meta(doc.get("meeting")),
        "items": normalize_items(doc.get("items")),
        "transcript": normalize_transcript(doc.get("transcript")),
    }))
}

fn join_parts(parts: &[String]) -> String {
    parts.join(" — ")
}

fn action_text(action: &Value) -> String {
    action.get("text").map(py_str).unwrap_or_default()
}

pub fn export_note_txt(note: &Value) -> String {
    let field = |key: &str| note.get(key).map(py_str).unwrap_or_default();
    let mut lines = vec![
        field("title"),
        format!("{} · {}", field("id"), field("date")),
        if note.get("status").and_then(Value::as_str) == Some("issued") {
            "Issued".to_string()
        } else {
            "Draft — not yet issued".to_string()
        },
        String::new(),
    ];
    if note.get("summary").map(py_truthy).unwrap_or(false) {
        lines.push("Summary".to_string());
        lines.push(note.get("summary").map(py_str).unwrap_or_default());
        lines.push(String::new());
    }
    if let Some(Value::Array(decisions)) = note.get("decisions") {
        if !decisions.is_empty() {
            lines.push("Decisions".to_string());
            for decision in decisions {
                lines.push(format!("- {}", py_str(decision)));
            }
            lines.push(String::new());
        }
    }
    if let Some(Value::Array(actions)) = note.get("actions") {
        if !actions.is_empty() {
            lines.push("Action items".to_string());
            for action in actions {
                let mut parts = Vec::new();
                if let Some(owner) = action.get("owner") {
                    if py_truthy(owner) {
                        parts.push(py_str(owner));
                    }
                }
                if let Some(due) = action.get("due") {
                    if py_truthy(due) {
                        parts.push(format!("due {}", py_str(due)));
                    }
                }
                if let Some(status) = action.get("status") {
                    match status {
                        Value::Null => {}
                        Value::String(text) if text.is_empty() || text == "open" => {}
                        other => parts.push(py_str(other)),
                    }
                }
                let meta = join_parts(&parts);
                let suffix = if meta.is_empty() {
                    String::new()
                } else {
                    format!(" — {meta}")
                };
                lines.push(format!("- {}{suffix}", action_text(action)));
            }
            lines.push(String::new());
        }
    }
    lines.push("Drafted on-device. Nothing left this machine.".to_string());
    format!("{}\n", lines.join("\n"))
}

pub fn export_note_md(note: &Value) -> String {
    let field = |key: &str| note.get(key).map(py_str).unwrap_or_default();
    let summary = match note.get("summary") {
        Some(inner) if py_truthy(inner) => py_str(inner),
        _ => "_No summary yet._".to_string(),
    };
    let mut lines = vec![
        format!("# {}", field("title")),
        String::new(),
        format!("_{}_ · {}", field("id"), field("date")),
        String::new(),
        summary,
        String::new(),
    ];
    if let Some(Value::Array(decisions)) = note.get("decisions") {
        if !decisions.is_empty() {
            lines.push("## Decisions".to_string());
            for decision in decisions {
                lines.push(format!("- {}", py_str(decision)));
            }
            lines.push(String::new());
        }
    }
    if let Some(Value::Array(actions)) = note.get("actions") {
        if !actions.is_empty() {
            lines.push("## Action items".to_string());
            for action in actions {
                let checked = action.get("status").and_then(Value::as_str) == Some("closed");
                let mut parts = Vec::new();
                if let Some(owner) = action.get("owner") {
                    if py_truthy(owner) {
                        parts.push(py_str(owner));
                    }
                }
                if let Some(due) = action.get("due") {
                    if py_truthy(due) {
                        parts.push(format!("due {}", py_str(due)));
                    }
                }
                let meta = join_parts(&parts);
                let suffix = if meta.is_empty() {
                    String::new()
                } else {
                    format!(" — {meta}")
                };
                lines.push(format!(
                    "- [{}] {}{suffix}",
                    if checked { "x" } else { " " },
                    action_text(action)
                ));
            }
            lines.push(String::new());
        }
    }
    lines.push("Drafted on-device. Nothing left this machine.".to_string());
    format!("{}\n", lines.join("\n"))
}

pub fn safe_filename(title: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for character in title.chars() {
        let safe = character.is_alphanumeric() || matches!(character, '_' | '.' | '-');
        if safe {
            in_run = false;
            out.push(character);
        } else if !in_run {
            in_run = true;
            out.push('_');
        }
    }
    let out: String = out.chars().take(60).collect();
    if out.is_empty() {
        "notes".to_string()
    } else {
        out
    }
}

/// One CSV field, RFC 4180: quoted when it holds a comma, quote, CR or LF; quotes doubled.
fn csv_field(text: &str) -> String {
    if text.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_string()
    }
}

fn csv_clock(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        total / 3600,
        total % 3600 / 60,
        total % 60
    )
}

/// The meeting's transcript as CSV (RFC 4180, CRLF rows): start, end, speaker (empty when the
/// line has none), original, translation. The caller adds the UTF-8 BOM Excel wants.
pub fn export_note_csv(note: &Value) -> String {
    let mut rows = vec!["start,end,speaker,original,translation".to_string()];
    if let Some(Value::Array(lines)) = note.get("transcript") {
        for line in lines {
            let text = |key: &str| line.get(key).map(py_str).unwrap_or_default();
            let num = |key: &str| line.get(key).and_then(Value::as_f64).unwrap_or(0.0);
            rows.push(
                [
                    csv_clock(num("t0")),
                    csv_clock(num("t1")),
                    csv_field(&text("speaker")),
                    csv_field(&text("source")),
                    csv_field(&text("translation")),
                ]
                .join(","),
            );
        }
    }
    let mut out = rows.join("\r\n");
    out.push_str("\r\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_export_escapes_and_keeps_unicode() {
        let note = json!({ "transcript": [
            { "t0": 0.0, "t1": 3.2, "source": "Halo, \"dunia\"", "translation": "Hello,\nworld" },
            { "t0": 3725.0, "t1": 3730.0, "source": "日本語", "translation": "", "speaker": "Rina" }
        ]});
        assert_eq!(
            export_note_csv(&note),
            "start,end,speaker,original,translation\r\n00:00:00,00:00:03,,\"Halo, \"\"dunia\"\"\",\"Hello,\nworld\"\r\n01:02:05,01:02:10,Rina,日本語,\r\n"
        );
        assert_eq!(
            export_note_csv(&json!({})),
            "start,end,speaker,original,translation\r\n"
        );
    }

    #[test]
    fn unknown_enums_fall_back_and_metric_needs_a_number() {
        let note = json!({
            "items": [
                { "text": "A", "type": "nope", "status": "nope", "confidence": 0.5,
                  "metric": { "measure": "m" } },
                { "text": "B", "confidence": 0.9, "metric": { "measure": "m", "value": 2 } }
            ]
        });
        let normalized = normalize_note_doc(&note).expect("valid note");
        let items = normalized["items"].as_array().expect("items");
        assert_eq!(items[0]["type"], "info");
        assert_eq!(items[0]["status"], "open");
        assert_eq!(items[0]["needsReview"], true);
        assert_eq!(items[0]["metric"], Value::Null);
        assert_eq!(items[1]["needsReview"], false);
        assert_eq!(items[1]["metric"]["value"], json!(2.0));
    }

    #[test]
    fn item_cap_is_500() {
        let items: Vec<Value> = (0..505)
            .map(|i| json!({ "text": format!("item {i}") }))
            .collect();
        let normalized = normalize_note_doc(&json!({ "items": items })).expect("valid note");
        assert_eq!(normalized["items"].as_array().expect("items").len(), 500);
    }

    #[test]
    fn export_matches_the_house_format() {
        let note = normalize_note_doc(&json!({
            "id": "n-1",
            "title": "Rapat",
            "date": "2026-11-08",
            "status": "issued",
            "generatedAt": "2026-11-08T00:00:00Z",
            "summary": "Ringkas",
            "decisions": ["Setuju"],
            "actions": [{ "text": "Kirim", "owner": "Rina", "due": "2026-11-10", "status": "closed" }]
        }))
        .expect("valid note");
        assert_eq!(
            export_note_txt(&note),
            "Rapat\nn-1 · 2026-11-08\nIssued\n\nSummary\nRingkas\n\nDecisions\n- Setuju\n\nAction items\n- Kirim — Rina — due 2026-11-10 — closed\n\nDrafted on-device. Nothing left this machine.\n"
        );
        assert!(export_note_md(&note).contains("- [x] Kirim — Rina — due 2026-11-10"));
    }

    #[test]
    fn filename_squashes_runs_like_the_python_regex() {
        assert_eq!(
            safe_filename("Rapat & Rencana / 2026"),
            "Rapat_Rencana_2026"
        );
        assert_eq!(safe_filename("_ x"), "__x");
        assert_eq!(safe_filename("x".repeat(70).as_str()).len(), 60);
        assert_eq!(safe_filename(""), "notes");
    }
}
