//! Settings › General › Webhooks: asks the engine for its webhooks and changes them
//! (`/integrations/webhooks`). Shared by the Windows and the Mac app; every call runs on its own
//! thread and answers with `AppEvent::Webhooks` (the list afterwards) and `AppEvent::WebhookNote`
//! (one line for the person).

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use poni_core::webhooks::{self, Webhook};
use serde_json::{json, Value};

fn list(port: u16) -> Result<Vec<Webhook>, String> {
    let (code, body) = helper::request(port, "GET", "/integrations/webhooks", None).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        return Err(format!("The engine answered {code} for the webhooks."));
    }
    webhooks::parse(&body).ok_or_else(|| "The engine's webhook list was not in a shape this version reads.".into())
}

fn sentence(reply: &str, code: u16) -> String {
    serde_json::from_str::<Value>(reply).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| format!("The engine said {code}."))
}

fn post(port: u16, path: &str, body: &Value) -> Result<Value, String> {
    match helper::request(port, "POST", path, Some(&body.to_string())) {
        Ok((200, reply)) => Ok(serde_json::from_str(&reply).unwrap_or(Value::Null)),
        Ok((code, reply)) => Err(sentence(&reply, code)),
        Err(e) => Err(format!("The engine is not answering ({e}).")),
    }
}

/// Ask for the list.
pub fn fetch(sink: EventSink, port: u16) {
    std::thread::Builder::new().name("poni-webhooks".into()).spawn(move || sink.send(AppEvent::Webhooks(list(port)))).ok();
}

/// What a change does.
pub enum Change {
    Add(String),
    Enable(String, bool),
    Remove(String),
    Test(String),
}

/// Do `change`, say how it went, then send the new list.
pub fn change(sink: EventSink, port: u16, change: Change) {
    std::thread::Builder::new()
        .name("poni-webhooks-change".into())
        .spawn(move || {
            let (path, body, done) = match &change {
                Change::Add(url) => ("/integrations/webhooks", json!({ "url": url }), "Webhook added"),
                Change::Enable(id, on) => ("/integrations/webhooks", json!({ "id": id, "enabled": on }), if *on { "Webhook on" } else { "Webhook off" }),
                Change::Remove(id) => ("/integrations/webhooks", json!({ "id": id, "remove": true }), "Webhook removed"),
                Change::Test(id) => ("/integrations/webhooks/test", json!({ "id": id }), "Test sent"),
            };
            let note = match post(port, path, &body) {
                // A test answers 200 even when the receiver said no: its own `ok` says.
                Ok(v) if matches!(change, Change::Test(_)) && v.get("ok") != Some(&Value::Bool(true)) => {
                    let why = v.pointer("/result/error").and_then(Value::as_str).unwrap_or("no answer");
                    (false, format!("The test did not go through: {why}"))
                }
                Ok(_) => (true, done.to_string()),
                Err(e) => (false, e),
            };
            sink.send(AppEvent::WebhookNote { ok: note.0, text: note.1 });
            sink.send(AppEvent::Webhooks(list(port)));
        })
        .ok();
}
