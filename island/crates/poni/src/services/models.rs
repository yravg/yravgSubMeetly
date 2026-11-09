//! The engine's models for Settings: ask `GET /models`, and download one with `POST /models/pull`.
//! The pull blocks until the files are on disk, so it runs on its own thread while a second one
//! asks `/models` every 1.5 s, which is where the "N MB so far" in the row comes from.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use poni_core::models::{self, Kind, Row};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// A model of several hundred MB over a slow line: no answer in 30 minutes is a failure.
const PULL_WAIT: Duration = Duration::from_secs(30 * 60);
const PROGRESS_EVERY: Duration = Duration::from_millis(1500);

pub fn fetch(sink: EventSink, port: u16) {
    std::thread::Builder::new()
        .name("poni-models".into())
        .spawn(move || sink.send(AppEvent::Models(read(port))))
        .ok();
}

fn read(port: u16) -> Result<Vec<Row>, String> {
    let (code, body) = helper::request(port, "GET", "/models", None).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        return Err(format!("The engine answered {code} for /models."));
    }
    models::parse(&body).ok_or_else(|| "The engine's model list was not in a shape this version reads.".into())
}

/// Download `id`; `AppEvent::ModelPulled` says how it went, `AppEvent::Models` how far it is.
pub fn pull(sink: EventSink, port: u16, kind: Kind, id: String) {
    let done = Arc::new(AtomicBool::new(false));
    let (s, d) = (sink.clone(), done.clone());
    std::thread::Builder::new()
        .name("poni-models-progress".into())
        .spawn(move || {
            while !d.load(Ordering::Relaxed) {
                std::thread::sleep(PROGRESS_EVERY);
                if !d.load(Ordering::Relaxed) {
                    s.send(AppEvent::Models(read(port)));
                }
            }
        })
        .ok();
    std::thread::Builder::new()
        .name("poni-models-pull".into())
        .spawn(move || {
            let body = serde_json::json!({ "id": id }).to_string();
            let r = helper::request_bytes(port, "POST", "/models/pull", "application/json", body.as_bytes(), PULL_WAIT)
                .map_err(|e| format!("The engine stopped answering ({e})."))
                .and_then(|(code, reply)| if code == 200 { Ok(()) } else { Err(sentence(&reply, code)) });
            done.store(true, Ordering::Relaxed);
            sink.send(AppEvent::ModelPulled { kind, result: r });
        })
        .ok();
}

/// The engine's own `error` text, or the status code.
fn sentence(reply: &str, code: u16) -> String {
    serde_json::from_str::<Value>(reply).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| format!("The engine said {code}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_download_shows_the_engines_reason() {
        assert_eq!(sentence(r#"{"error":"download failed: no route to host"}"#, 502), "download failed: no route to host");
        assert_eq!(sentence("<html>", 500), "The engine said 500.");
    }
}
