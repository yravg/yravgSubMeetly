//! The engine's models for Settings: ask `GET /models`, download one with `POST /models/pull`
//! (the engine answers at once and downloads in the background, so a thread asks `/models` every
//! 1.5 s until the row stops pulling: that is the progress in the row), and switch with
//! `POST /engine/models`.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use poni_core::models::{self, Inventory, Kind};
use serde_json::Value;
use std::time::{Duration, Instant};

const PROGRESS_EVERY: Duration = Duration::from_millis(1500);
/// A model of several GB over a slow line: no end in four hours is a failure.
const PULL_DEADLINE: Duration = Duration::from_secs(4 * 3600);

pub fn fetch(sink: EventSink, port: u16) {
    std::thread::Builder::new()
        .name("poni-models".into())
        .spawn(move || sink.send(AppEvent::Models(read(port))))
        .ok();
}

fn read(port: u16) -> Result<Inventory, String> {
    let (code, body) = helper::request(port, "GET", "/models", None).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        return Err(format!("The engine answered {code} for /models."));
    }
    models::parse(&body).ok_or_else(|| "The engine's model list was not in a shape this version reads.".into())
}

/// Download `id`; `AppEvent::Models` says how far it is, `AppEvent::ModelPulled` how it ended.
pub fn pull(sink: EventSink, port: u16, kind: Kind, id: String) {
    std::thread::Builder::new()
        .name("poni-models-pull".into())
        .spawn(move || {
            let result = start(port, &id).and_then(|()| follow(&sink, port, &id));
            sink.send(AppEvent::ModelPulled { kind, id, result });
        })
        .ok();
}

/// 200 (already on disk) and 202 (started, or already under way) both mean "watch the row".
fn start(port: u16, id: &str) -> Result<(), String> {
    let body = serde_json::json!({ "id": id }).to_string();
    match helper::request(port, "POST", "/models/pull", Some(&body)) {
        Ok((200 | 202, _)) => Ok(()),
        Ok((code, reply)) => Err(sentence(&reply, code)),
        Err(e) => Err(format!("The engine stopped answering ({e}).")),
    }
}

fn follow(sink: &EventSink, port: u16, id: &str) -> Result<(), String> {
    let (began, mut silent, mut idle) = (Instant::now(), 0, 0);
    while began.elapsed() < PULL_DEADLINE {
        std::thread::sleep(PROGRESS_EVERY);
        let r = read(port);
        sink.send(AppEvent::Models(r.clone()));
        let Ok(inv) = r else {
            silent += 1;
            if silent >= 3 {
                return Err("The engine stopped answering.".into());
            }
            continue;
        };
        silent = 0;
        let Some(st) = inv.status(id) else { return Err("The engine does not list this model any more.".into()) };
        if st.pulling {
            idle = 0;
        } else if let Some(e) = &st.error {
            return Err(e.clone());
        } else if st.downloaded {
            return Ok(());
        } else {
            // Not pulling, not done, no error: the 202 may be a poll ahead of the job; twice is a stop.
            idle += 1;
            if idle >= 2 {
                return Err("The download stopped before it finished.".into());
            }
        }
    }
    Err("The download did not finish in four hours.".into())
}

/// Switch the engine to `id` (`models::OFF` for no translation); `AppEvent::ModelSelected` says how it went.
pub fn select(sink: EventSink, port: u16, kind: Kind, id: String) {
    std::thread::Builder::new()
        .name("poni-models-select".into())
        .spawn(move || {
            let body = serde_json::json!({ kind.wire(): id }).to_string();
            let result = match helper::request(port, "POST", "/engine/models", Some(&body)) {
                Ok((200, reply)) => {
                    // applied.<kind> == false: an environment variable pins it.
                    let applied = serde_json::from_str::<Value>(&reply).ok().and_then(|v| v.get("applied")?.get(kind.wire())?.as_bool());
                    if applied == Some(false) { Err("An environment variable fixes this model; the engine did not switch.".to_string()) } else { Ok(()) }
                }
                Ok((code, reply)) => Err(sentence(&reply, code)),
                Err(e) => Err(format!("The engine stopped answering ({e}).")),
            };
            sink.send(AppEvent::ModelSelected { kind, result });
        })
        .ok();
}

/// Move `id` to a folder: the one the person picks (`pick`), or back to the engine's default.
/// The engine copies in the background and checks the copy before it switches, so `AppEvent::ModelPlaced`
/// only says the request was taken; `AppEvent::Models` then shows the progress.
pub fn relocate(sink: EventSink, port: u16, kind: Kind, id: String, pick: bool) {
    let finish = move |result| sink.send(AppEvent::ModelPlaced { kind, result });
    let post = move |dir: Option<String>| {
        let body = serde_json::json!({ "id": id, "dir": dir }).to_string();
        match helper::request(port, "POST", "/engine/models/location", Some(&body)) {
            Ok((200, _)) => Ok(()),
            Ok((code, reply)) => Err(sentence(&reply, code)),
            Err(e) => Err(format!("The engine stopped answering ({e}).")),
        }
    };
    if pick {
        // Cancelled: no request (a null dir would mean "the default folder"), only the event that frees the row.
        crate::shell::pick_folder(&format!("Folder for the {}", kind.label().to_lowercase()), move |dir| match dir.filter(|d| !d.trim().is_empty()) {
            Some(d) => finish(post(Some(d))),
            None => finish(Ok(())),
        });
    } else {
        std::thread::Builder::new().name("poni-models-place".into()).spawn(move || finish(post(None))).ok();
    }
}

/// The engine's own `error` text, or the status code.
fn sentence(reply: &str, code: u16) -> String {
    serde_json::from_str::<Value>(reply).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| format!("The engine said {code}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_request_shows_the_engines_reason() {
        assert_eq!(sentence(r#"{"error":"unknown model id"}"#, 400), "unknown model id");
        assert_eq!(sentence("<html>", 500), "The engine said 500.");
    }
}
