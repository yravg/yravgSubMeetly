//! A captioned session as the meeting document the engine keeps (`POST /notes`,
//! the shape `src/lib/notes-sync.js` writes and `engine-rs/engine/src/notes.rs`
//! normalizes): the lines the island heard while captions ran, plus the
//! heuristic draft summary, decisions and actions of `POST /notes/generate`.

use crate::datetime::LocalDateTime;
use crate::helper::Line;
use serde_json::{json, Value};

/// What a Stop saves: the engine keeps at most this many lines of a transcript.
pub const MAX_LINES: usize = 3000;

/// `Meeting 2026-11-10 09:05`, the title of a session no calendar event names.
pub fn default_title(t: &LocalDateTime) -> String {
    format!("Meeting {} {:02}:{:02}", t.day_key(), t.hour, t.minute)
}

/// Local `YYYY-MM-DDTHH:MM`, the document's `meeting.start`.
pub fn start_stamp(t: &LocalDateTime) -> String {
    format!("{}T{:02}:{:02}", t.day_key(), t.hour, t.minute)
}

/// The `POST /notes/generate` body for these lines (the engine reads each line's `text`).
pub fn generate_body(title: &str, lines: &[Line]) -> String {
    let lines: Vec<Value> = lines.iter().map(|l| json!({ "text": l.source })).collect();
    json!({ "title": title, "source": "island", "lines": lines }).to_string()
}

/// The note of a `/notes/generate` reply body, if it is one.
pub fn generated_note(body: &str) -> Option<Value> {
    serde_json::from_str::<Value>(body).ok()?.get("note").filter(|n| n.is_object()).cloned()
}

/// The meeting document of a session, or `None` when nothing was heard.
/// `generated`: the draft note from `/notes/generate`, if the engine made one.
/// `start`: local `YYYY-MM-DDTHH:MM`; `date`: local `YYYY-MM-DD`; `locale`: the spoken language
/// (`auto` is not a locale, so it reads as English).
pub fn meeting_doc(id: &str, title: &str, date: &str, start: &str, locale: &str, lines: &[Line], generated: Option<&Value>) -> Option<Value> {
    let lines = &lines[lines.len().saturating_sub(MAX_LINES)..];
    if lines.is_empty() {
        return None;
    }
    let strings = |key: &str| -> Vec<String> { generated.and_then(|g| g.get(key)).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str()).map(str::to_string).collect()).unwrap_or_default() };
    let decisions = strings("decisions");
    let actions: Vec<Value> = generated.and_then(|g| g.get("actions")).and_then(Value::as_array).cloned().unwrap_or_default();
    // The draft is a heuristic: its items are marked AI and unsure, so the page asks for a check.
    let mut items: Vec<Value> = decisions.iter().enumerate().map(|(n, t)| json!({ "ref": format!("D-{}", n + 1), "type": "decision", "text": t, "review": "ai", "confidence": 0.6 })).collect();
    items.extend(actions.iter().enumerate().filter_map(|(n, a)| {
        let text = a.get("text")?.as_str()?;
        Some(json!({ "ref": format!("A-{}", n + 1), "type": "action", "text": text, "owner": a.get("owner"), "due": a.get("due"), "status": "open", "review": "ai", "confidence": 0.6 }))
    }));
    let end = lines.last().map_or(0.0, |l| l.t1);
    Some(json!({
        "id": id,
        "title": title,
        "date": date,
        "source": "island",
        "status": "ready",
        "summary": generated.and_then(|g| g.get("summary")).and_then(Value::as_str).unwrap_or(""),
        "decisions": decisions,
        "actions": actions,
        "transcriptPreview": lines.iter().take(6).map(|l| l.source.as_str()).collect::<Vec<_>>().join("\n"),
        "schemaVersion": 2,
        "meeting": {
            "locale": if locale.is_empty() || locale == "auto" { "en" } else { locale },
            "start": start,
            "engine": { "segments": lines.len(), "durationSec": end.round() as i64 },
        },
        "items": items,
        "transcript": lines.iter().map(|l| json!({ "t0": l.t0, "t1": l.t1, "source": l.source, "translation": l.translation })).collect::<Vec<_>>(),
    }))
}

/// PMM-015: a media (video) session is kept as a transcript, not a meeting. It is the same
/// document saved through the same `POST /notes`, with `source: "media"` as the only marker: the
/// engine keeps `source` as given, the register's sync leaves such documents out of its meetings
/// (`src/lib/engine-sync.js`), and the Minutes page tags them "Video". "Save as meeting" sets
/// `source` back to the island's own ([`promote`]).
pub const SOURCE_MEDIA: &str = "media";

pub fn as_transcript(mut doc: Value) -> Value {
    doc["source"] = json!(SOURCE_MEDIA);
    doc
}

pub fn is_transcript(doc: &Value) -> bool {
    doc.get("source").and_then(Value::as_str) == Some(SOURCE_MEDIA)
}

/// The kept transcript as a meeting (`None` when it is one already).
pub fn promote(doc: &Value) -> Option<Value> {
    is_transcript(doc).then(|| {
        let mut d = doc.clone();
        d["source"] = json!("island");
        d
    })
}

/// A meeting document built from pasted lines (`doc`), poured into the meeting it belongs to
/// (`base`, one started from Calendar's Notes: its title, date, attendees and calendar fields
/// stay). The people who spoke join the attendees.
pub fn with_base(doc: Value, base: Option<&Value>, speakers: &[String]) -> Value {
    let mut out = base.filter(|b| b.is_object()).cloned().unwrap_or_else(|| json!({}));
    let Value::Object(fresh) = doc else { return out };
    let keep = ["id", "title", "date"];
    let o = out.as_object_mut().expect("object");
    for (k, v) in fresh {
        if k == "meeting" {
            let m = o.entry("meeting").or_insert_with(|| json!({}));
            if let (Some(m), Value::Object(new)) = (m.as_object_mut(), v) {
                for (mk, mv) in new {
                    m.entry(mk).or_insert(mv);
                }
            }
        } else if !(keep.contains(&k.as_str()) && o.contains_key(&k)) {
            o.insert(k, v);
        }
    }
    o.insert("source".into(), json!("paste"));
    let m = o.entry("meeting").or_insert_with(|| json!({}));
    if let Some(m) = m.as_object_mut() {
        let list = m.entry("attendees").or_insert_with(|| json!([]));
        if let Some(a) = list.as_array_mut() {
            for s in speakers {
                let known = a.iter().any(|x| x.as_str().or_else(|| x.get("name").and_then(Value::as_str)).is_some_and(|n| n.eq_ignore_ascii_case(s)));
                if !known {
                    a.push(json!(s));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_media_session_is_kept_as_a_transcript_until_saved_as_a_meeting() {
        let doc = meeting_doc("MOM-WIN-1", "macOS 27.2.1 is out", "2026-11-11", "2026-11-11T09:00", "en", &[line(0.0, "Hi", "")], None).unwrap();
        assert!(!is_transcript(&doc), "a captions session is a meeting by default");
        assert_eq!(promote(&doc), None, "a meeting has nothing to promote");
        let kept = as_transcript(doc);
        assert!(is_transcript(&kept));
        assert_eq!(kept["source"], "media");
        let meeting = promote(&kept).unwrap();
        assert!(!is_transcript(&meeting));
        assert_eq!(meeting["source"], "island");
        // Everything else (id, transcript, items) rides along unchanged.
        assert_eq!((meeting["id"].clone(), meeting["transcript"].clone()), (kept["id"].clone(), kept["transcript"].clone()));
        assert!(!is_transcript(&json!({ "id": "x" })) && !is_transcript(&json!(null)));
    }

    #[test]
    fn a_paste_fills_the_calendar_meeting_and_adds_who_spoke() {
        let base = json!({ "id": "CAL-1", "title": "Bun4 EP weekly meeting", "date": "2026-11-11", "meeting": { "start": "2026-11-11T10:00", "attendees": ["Riza Putra"] } });
        let lines = [line(3.0, "Riza Putra: we agreed", ""), line(9.0, "Alya: I will send it", "")];
        let doc = meeting_doc("MOM-PASTE-x", "Meeting 2026-11-10 12:00", "2026-11-10", "2026-11-10T12:00", "en", &lines, None).unwrap();
        let out = with_base(doc, Some(&base), &["Riza Putra".into(), "Alya".into()]);
        assert_eq!((out["id"].as_str(), out["title"].as_str(), out["date"].as_str()), (Some("CAL-1"), Some("Bun4 EP weekly meeting"), Some("2026-11-11")));
        assert_eq!(out["meeting"]["start"], "2026-11-11T10:00", "the calendar's start stays");
        assert_eq!(out["meeting"]["attendees"], json!(["Riza Putra", "Alya"]));
        assert_eq!(out["transcript"].as_array().map(Vec::len), Some(2));
        assert_eq!(out["source"], "paste");
        // No base: the pasted document as it is.
        let doc = meeting_doc("MOM-PASTE-x", "T", "2026-11-10", "2026-11-10T12:00", "en", &lines, None).unwrap();
        let out = with_base(doc, None, &[]);
        assert_eq!(out["id"], "MOM-PASTE-x");
    }

    fn line(t0: f64, source: &str, translation: &str) -> Line {
        Line { t0, t1: t0 + 4.0, source: source.into(), translation: translation.into() }
    }

    #[test]
    fn the_title_and_start_are_local_wall_clock() {
        let t = LocalDateTime { year: 2026, month: 11, day: 10, hour: 9, minute: 5, second: 59 };
        assert_eq!((default_title(&t).as_str(), start_stamp(&t).as_str()), ("Meeting 2026-11-10 09:05", "2026-11-10T09:05"));
    }

    #[test]
    fn nothing_heard_saves_nothing() {
        assert_eq!(meeting_doc("MOM-WIN-1", "Meeting", "2026-11-10", "2026-11-10T09:00", "de", &[], None), None);
    }

    #[test]
    fn the_doc_has_the_shape_the_engine_normalizes() {
        let lines = [line(0.0, "line one", "linie eins"), line(4.0, "line two", "")];
        let gen = json!({ "summary": "line one … line two (2 segmen).", "decisions": ["We decided line one"], "actions": [{ "id": "act-1", "text": "Alya to send line two", "owner": null, "due": null, "status": "open" }] });
        let d = meeting_doc("MOM-WIN-7", "Meeting 2026-11-10 09:00", "2026-11-10", "2026-11-10T09:00", "auto", &lines, Some(&gen)).unwrap();
        assert_eq!((d["id"].as_str(), d["source"].as_str(), d["schemaVersion"].as_i64()), (Some("MOM-WIN-7"), Some("island"), Some(2)));
        assert_eq!(d["summary"], "line one … line two (2 segmen).");
        assert_eq!(d["decisions"], json!(["We decided line one"]));
        assert_eq!(d["meeting"]["locale"], "en", "auto is not a locale");
        assert_eq!((d["meeting"]["engine"]["segments"].as_i64(), d["meeting"]["engine"]["durationSec"].as_i64()), (Some(2), Some(8)));
        // v2 items carry both lists, each marked as an unsure AI draft.
        let kinds: Vec<_> = d["items"].as_array().unwrap().iter().map(|i| (i["ref"].as_str().unwrap(), i["type"].as_str().unwrap(), i["review"].as_str().unwrap())).collect();
        assert_eq!(kinds, [("D-1", "decision", "ai"), ("A-1", "action", "ai")]);
        // The transcript keeps source and translation, with times.
        assert_eq!(d["transcript"][0], json!({ "t0": 0.0, "t1": 4.0, "source": "line one", "translation": "linie eins" }));
        assert_eq!(d["transcriptPreview"], "line one\nline two");
    }

    #[test]
    fn the_island_page_reads_back_what_it_saved() {
        let lines = [line(0.0, "テスト行", "test line")];
        let gen = json!({ "summary": "s", "decisions": ["d one"], "actions": [{ "text": "a one" }] });
        let d = meeting_doc("MOM-WIN-8", "Meeting", "2026-11-10", "2026-11-10T09:00", "ja", &lines, Some(&gen)).unwrap();
        let notes = crate::helper::parse_notes(&json!({ "notes": [d] }).to_string()).unwrap();
        let n = &notes[0];
        assert_eq!((n.id.as_str(), n.items.len(), n.transcript.len(), n.issued), ("MOM-WIN-8", 2, 1, false));
        assert_eq!(n.transcript[0].translation, "test line");
    }

    #[test]
    fn a_long_session_keeps_the_newest_lines_and_the_generate_body_reads_text() {
        let lines: Vec<Line> = (0..MAX_LINES + 5).map(|i| line(i as f64, &format!("l{i}"), "")).collect();
        let d = meeting_doc("MOM-WIN-9", "M", "2026-11-10", "2026-11-10T09:00", "en", &lines, None).unwrap();
        assert_eq!(d["transcript"].as_array().unwrap().len(), MAX_LINES);
        assert_eq!(d["transcript"][0]["source"], "l5");
        let b: Value = serde_json::from_str(&generate_body("M", &lines[..1])).unwrap();
        assert_eq!(b["lines"][0]["text"], "l0");
        assert_eq!(generated_note(r#"{"note":{"summary":"x"}}"#), Some(json!({ "summary": "x" })));
        assert_eq!(generated_note(r#"{"error":"no"}"#), None);
    }
}
