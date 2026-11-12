//! Translate a saved meeting's transcript again, into any language, so it can be shared with people
//! who read another one. Each line goes to the engine's `POST /translate?src=&tgt=` (body: the line,
//! answer `{text}`) off the UI thread; the job then reads the meeting again (a decision pressed in the
//! meantime must survive), puts the new translations into its transcript and sends the document back
//! to be saved (`Command::HelperPost`, the same path as a decision). Shared by Windows and the Mac.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// The job that may run: a new start or a Stop moves it on, and a job that sees another number ends.
static CURRENT: AtomicU64 = AtomicU64::new(0);

/// How a job is going, or how it ended.
#[derive(Debug)]
pub enum Event {
    Progress { id: String, done: usize, total: usize },
    /// The meeting document with the new translations, ready for `POST /notes`.
    Done { id: String, tgt: String, body: String },
    Failed { id: String, why: String },
    Stopped { id: String },
}

/// Translate meeting `id`'s transcript from `src` (`auto` lets the engine tell) into `tgt`.
/// A job already running stops.
pub fn start(sink: EventSink, port: u16, id: String, src: String, tgt: String) {
    let gen = CURRENT.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::Builder::new()
        .name("poni-retranslate".into())
        .spawn(move || {
            let ev = run(&sink, port, &id, &src, &tgt, gen);
            sink.send(AppEvent::Retranslate(ev));
        })
        .ok();
}

/// Stop the running job (its lines so far are not saved).
pub fn stop() {
    CURRENT.fetch_add(1, Ordering::SeqCst);
}

fn live(gen: u64) -> bool {
    CURRENT.load(Ordering::SeqCst) == gen
}

fn run(sink: &EventSink, port: u16, id: &str, src: &str, tgt: &str, gen: u64) -> Event {
    let failed = |why: String| Event::Failed { id: id.to_string(), why };
    let lines = match fetch_note(port, id) {
        Ok(doc) => source_lines(&doc),
        Err(why) => return failed(why),
    };
    let total = lines.len();
    if total == 0 {
        return failed("This meeting has no transcript to translate.".into());
    }
    let path = translate_path(src, tgt);
    let mut out: Vec<String> = Vec::with_capacity(total);
    for (n, text) in lines.iter().enumerate() {
        if !live(gen) {
            return Event::Stopped { id: id.to_string() };
        }
        out.push(if text.trim().is_empty() {
            String::new()
        } else {
            match translate(port, &path, text) {
                Ok(t) => t,
                Err(why) => return failed(format!("Line {} of {total}: {why}", n + 1)),
            }
        });
        sink.send(AppEvent::Retranslate(Event::Progress { id: id.to_string(), done: n + 1, total }));
    }
    if !live(gen) {
        return Event::Stopped { id: id.to_string() };
    }
    // The meeting as it is now: items pressed while the lines were translated are kept.
    let mut doc = match fetch_note(port, id) {
        Ok(d) => d,
        Err(why) => return failed(why),
    };
    if !apply(&mut doc, &lines, &out, tgt) {
        return failed("The transcript changed while it was translated. Try again.".into());
    }
    Event::Done { id: id.to_string(), tgt: tgt.to_string(), body: doc.to_string() }
}

/// `/translate?src=..&tgt=..` (codes come from the app's own list, so they need no escaping).
pub fn translate_path(src: &str, tgt: &str) -> String {
    let src = if src.trim().is_empty() { "auto" } else { src };
    format!("/translate?src={src}&tgt={tgt}")
}

fn translate(port: u16, path: &str, text: &str) -> Result<String, String> {
    // The first line may wait for the translation model to load.
    let (code, reply) = helper::request_bytes(port, "POST", path, "text/plain; charset=utf-8", text.as_bytes(), Duration::from_secs(120)).map_err(|e| format!("the engine is not answering ({e})"))?;
    let v: Value = serde_json::from_str(&reply).unwrap_or(Value::Null);
    if code == 501 {
        return Err("no translation model on this device yet. Download one in Settings › Models.".into());
    }
    if code != 200 {
        let why = v.get("error").and_then(Value::as_str).map(str::to_string);
        return Err(why.unwrap_or_else(|| format!("the engine said {code}")));
    }
    v.get("text").and_then(Value::as_str).map(|s| s.trim().to_string()).ok_or_else(|| "the engine sent no text".into())
}

fn fetch_note(port: u16, id: &str) -> Result<Value, String> {
    let (code, reply) = helper::request_bytes(port, "GET", "/notes", "application/json", b"", Duration::from_secs(10)).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        return Err(format!("The engine said {code} for the meetings."));
    }
    let v: Value = serde_json::from_str(&reply).map_err(|_| "The engine's meetings were not in a shape this version reads.".to_string())?;
    find_note(&v, id).cloned().ok_or_else(|| "That meeting is no longer there.".into())
}

/// Meeting `id` in a `GET /notes` body.
pub fn find_note<'a>(body: &'a Value, id: &str) -> Option<&'a Value> {
    body.get("notes")?.as_array()?.iter().find(|n| n.get("id").and_then(Value::as_str) == Some(id))
}

/// The spoken text of each transcript line, in order.
pub fn source_lines(doc: &Value) -> Vec<String> {
    doc.get("transcript").and_then(Value::as_array).map_or_else(Vec::new, |a| a.iter().map(|l| l.get("source").and_then(Value::as_str).unwrap_or("").to_string()).collect())
}

/// Put `out` as the translation of each line of `doc` whose source is still `lines`, and note the
/// language. False when the transcript no longer has those lines (nothing is changed then).
pub fn apply(doc: &mut Value, lines: &[String], out: &[String], tgt: &str) -> bool {
    if source_lines(doc) != lines || lines.len() != out.len() {
        return false;
    }
    if let Some(a) = doc.get_mut("transcript").and_then(Value::as_array_mut) {
        for (l, t) in a.iter_mut().zip(out) {
            if let Some(o) = l.as_object_mut() {
                o.insert("translation".into(), Value::String(t.clone()));
            }
        }
    }
    if let Some(o) = doc.as_object_mut() {
        o.insert("translationLang".into(), Value::String(tgt.to_string()));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_path_asks_auto_when_the_language_is_unknown() {
        assert_eq!(translate_path("", "id"), "/translate?src=auto&tgt=id");
        assert_eq!(translate_path("en", "ja"), "/translate?src=en&tgt=ja");
    }

    #[test]
    fn new_translations_replace_the_old_and_keep_everything_else() {
        let mut doc = json!({"id":"MOM-1","items":[{"ref":"D-1","review":"accepted"}],
            "transcript":[{"t0":0,"source":"Halo.","translation":"Hello.","speaker":"You"},{"t0":2,"source":"Dua.","translation":""}]});
        let lines = source_lines(&doc);
        assert_eq!(lines, vec!["Halo.", "Dua."]);
        assert!(apply(&mut doc, &lines, &["こんにちは。".into(), "二。".into()], "ja"));
        assert_eq!(doc["transcript"][0]["translation"], "こんにちは。");
        assert_eq!(doc["transcript"][0]["speaker"], "You");
        assert_eq!(doc["transcript"][1]["translation"], "二。");
        assert_eq!(doc["translationLang"], "ja");
        assert_eq!(doc["items"][0]["review"], "accepted");
    }

    #[test]
    fn a_transcript_that_changed_meanwhile_is_left_alone() {
        let mut doc = json!({"transcript":[{"source":"A","translation":"a"}]});
        assert!(!apply(&mut doc, &["B".into()], &["b".into()], "en"));
        assert_eq!(doc["transcript"][0]["translation"], "a");
        assert!(doc.get("translationLang").is_none());
    }

    #[test]
    fn the_meeting_is_found_by_id() {
        let body = json!({"notes":[{"id":"A"},{"id":"B","title":"b"}]});
        assert_eq!(find_note(&body, "B").unwrap()["title"], "b");
        assert!(find_note(&body, "C").is_none());
    }
}
