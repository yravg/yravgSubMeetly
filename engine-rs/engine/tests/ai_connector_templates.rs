//! The AI connector and the summary templates through the real routes: nothing leaves the
//! device unless the connector is on, the key is never shown, `/notes/summarize` and `/ask`
//! use the person's endpoint when it is on, and templates shape `/notes/generate`.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;

use serde_json::{json, Value};
use submeetly_engine::protocol::AskReply;
use submeetly_engine::{App, Request};

fn app() -> App {
    for key in ["TRANSLATE", "TRANSLATE_MODEL", "HF_HOME", "HF_HUB_CACHE"] {
        std::env::remove_var(key);
    }
    std::env::set_var("HF_ENDPOINT", "http://127.0.0.1:9");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let state: PathBuf =
        std::env::temp_dir().join(format!("submeetly-ai-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&state).unwrap();
    let mut app = App::new(state);
    app.set_allowed_origins(Vec::new());
    app
}

fn req(method: &str, path: &str, body: Value) -> Request {
    Request {
        method: method.to_string(),
        target: path.to_string(),
        headers: vec![("host".to_string(), "127.0.0.1:17865".to_string())],
        body: if body.is_null() {
            Vec::new()
        } else {
            body.to_string().into_bytes()
        },
        peer_loopback: true,
        body_file: None,
    }
}

fn call(app: &App, method: &str, path: &str, body: Value) -> (u16, Value) {
    let r = app.handle(&req(method, path, body));
    (r.status, r.body.unwrap_or(Value::Null))
}

/// An endpoint that answers `requests` chat calls with one SSE answer, and reports what it saw.
fn mock(answer: &'static str, requests: usize) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for _ in 0..requests {
            let (mut s, _) = listener.accept().unwrap();
            let mut got = Vec::new();
            let mut buf = vec![0u8; 65536];
            loop {
                let n = s.read(&mut buf).unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text
                        .to_lowercase()
                        .split("content-length:")
                        .nth(1)
                        .and_then(|r| r.split("\r\n").next())
                        .and_then(|n| n.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if got.len() >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let delta = json!({ "choices": [{ "delta": { "content": answer } }] });
            let body = format!("data: {delta}\n\ndata: [DONE]\n\n");
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            s.write_all(head.as_bytes()).unwrap();
            s.write_all(body.as_bytes()).unwrap();
            seen.push(String::from_utf8_lossy(&got).to_string());
        }
        seen
    });
    (url, handle)
}

fn lines() -> Value {
    json!([
        { "text": "Keputusan: kita rilis hari Jumat." },
        { "text": "Ada risiko vendor terlambat mengirim server." },
        { "text": "Todo: kirim laporan mingguan ke tim." }
    ])
}

#[test]
fn the_connector_is_off_by_default_and_never_shows_its_key() {
    let app = app();
    let (_, shown) = call(&app, "GET", "/ai/connector", Value::Null);
    assert_eq!(shown["enabled"], false);
    assert_eq!(shown["hasKey"], false);
    // On without a model name: refused.
    assert_eq!(
        call(&app, "POST", "/ai/connector", json!({ "enabled": true })).0,
        400
    );
    let (status, saved) = call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": "http://127.0.0.1:11434/v1", "model": "llama3", "apiKey": "sk-very-secret-1234", "enabled": true }),
    );
    assert_eq!(status, 200, "{saved}");
    assert!(!saved.to_string().contains("very-secret"));
    let (_, again) = call(&app, "GET", "/ai/connector", Value::Null);
    assert_eq!(
        (
            again["enabled"].clone(),
            again["hasKey"].clone(),
            again["keyHint"].clone()
        ),
        (json!(true), json!(true), json!("1234"))
    );
    // A key that is not given stays; the connector can be switched off without losing it.
    let (_, off) = call(&app, "POST", "/ai/connector", json!({ "enabled": false }));
    assert_eq!(off["hasKey"], true);
}

#[test]
fn summarize_stays_local_with_the_connector_off() {
    let app = app();
    let (status, body) = call(
        &app,
        "POST",
        "/notes/summarize",
        json!({ "lines": lines() }),
    );
    assert_eq!(status, 200);
    // The pre-existing contract: no template, no new fields.
    assert!(
        body.get("via").is_none() && body.get("sections").is_none(),
        "{body}"
    );
    assert_eq!(body["counts"]["decisions"], 1);
}

#[test]
fn summarize_uses_the_persons_endpoint_when_it_is_on() {
    let app = app();
    let (url, seen) = mock("## Summary\n- Launch on Friday.\n\n## Decisions\n- Ship on Friday\n\n## Action items\n- Send the weekly report\n", 1);
    call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": url, "model": "m1", "apiKey": "sk-test-key-0001", "enabled": true }),
    );
    let (status, body) = call(
        &app,
        "POST",
        "/notes/summarize",
        json!({ "lines": lines(), "template": "general" }),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["via"], "connector");
    assert_eq!(body["summary"], "Launch on Friday.");
    assert_eq!(body["decisions"], json!(["Ship on Friday"]));
    assert_eq!(body["actions"][0]["text"], "Send the weekly report");
    assert_eq!(body["sections"][1]["heading"], "Decisions");
    assert!(body["markdown"]
        .as_str()
        .unwrap()
        .contains("## Action items"));
    let request = seen.join().unwrap().remove(0);
    assert!(request
        .to_lowercase()
        .contains("authorization: bearer sk-test-key-0001"));
    // The transcript went to the endpoint, along with the template's headings.
    assert!(
        request.contains("Keputusan: kita rilis hari Jumat") && request.contains("## Action items")
    );
}

#[test]
fn a_dead_endpoint_falls_back_to_the_local_notes_and_says_so() {
    let app = app();
    call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": "http://127.0.0.1:9/v1", "model": "m", "enabled": true }),
    );
    let (status, body) = call(
        &app,
        "POST",
        "/notes/summarize",
        json!({ "lines": lines() }),
    );
    assert_eq!(status, 200);
    assert_eq!(body["via"], "local");
    assert!(body["connectorError"].is_string());
    assert_eq!(body["counts"]["decisions"], 1);
}

#[test]
fn generate_never_uses_the_connector_but_applies_a_template() {
    let app = app();
    // A connector that would fail loudly if it were called.
    call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": "http://127.0.0.1:9/v1", "model": "m", "enabled": true }),
    );
    let (status, body) = call(
        &app,
        "POST",
        "/notes/generate",
        json!({ "lines": lines(), "template": "project-status" }),
    );
    assert_eq!(status, 200, "{body}");
    assert!(body["note"].get("connectorError").is_none());
    assert_eq!(body["note"]["template"], "project-status");
    assert_eq!(body["note"]["via"], "local");
    assert_eq!(body["note"]["sections"].as_array().unwrap().len(), 5);
    assert!(body["note"]["markdown"]
        .as_str()
        .unwrap()
        .contains("## Risks and issues"));
    assert_eq!(
        call(
            &app,
            "POST",
            "/notes/generate",
            json!({ "lines": lines(), "template": "nope" })
        )
        .0,
        400
    );
}

#[test]
fn a_default_template_shapes_notes_that_name_none() {
    let app = app();
    assert_eq!(
        call(
            &app,
            "POST",
            "/notes/templates/default",
            json!({ "id": "nope" })
        )
        .0,
        400
    );
    let (status, listed) = call(
        &app,
        "POST",
        "/notes/templates/default",
        json!({ "id": "standup" }),
    );
    assert_eq!((status, listed["default"].clone()), (200, json!("standup")));
    let (_, body) = call(&app, "POST", "/notes/generate", json!({ "lines": lines() }));
    assert_eq!(body["note"]["template"], "standup");
    // An empty template says "none", and clearing the default restores the plain notes.
    let (_, none) = call(
        &app,
        "POST",
        "/notes/generate",
        json!({ "lines": lines(), "template": "" }),
    );
    assert!(none["note"].get("template").is_none());
    call(
        &app,
        "POST",
        "/notes/templates/default",
        json!({ "id": null }),
    );
    let (_, plain) = call(&app, "POST", "/notes/generate", json!({ "lines": lines() }));
    assert!(plain["note"].get("template").is_none());
}

#[test]
fn templates_can_be_created_used_and_deleted() {
    let app = app();
    let (_, list) = call(&app, "GET", "/notes/templates", Value::Null);
    assert_eq!(list["templates"].as_array().unwrap().len(), 7);
    let (status, made) = call(
        &app,
        "POST",
        "/notes/templates",
        json!({ "name": "Board update", "sections": [{ "heading": "Risks", "kind": "risks" }, { "heading": "Asks", "kind": "actions" }] }),
    );
    assert_eq!(status, 200, "{made}");
    let id = made["template"]["id"].as_str().unwrap().to_string();
    let (_, body) = call(
        &app,
        "POST",
        "/notes/generate",
        json!({ "lines": lines(), "template": id }),
    );
    assert_eq!(body["note"]["sections"][0]["heading"], "Risks");
    assert_eq!(
        body["note"]["sections"][0]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/notes/templates",
            json!({ "id": "general", "name": "x", "sections": [{ "heading": "h" }] })
        )
        .0,
        400
    );
    assert_eq!(
        call(&app, "DELETE", "/notes/templates/general", Value::Null).0,
        400
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/notes/templates/{id}"),
            Value::Null
        )
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/notes/templates/{id}"),
            Value::Null
        )
        .0,
        404
    );
}

#[test]
fn ask_goes_to_the_endpoint_when_the_connector_is_on_and_needs_no_local_model() {
    let app = app();
    let (url, seen) = mock("You promised a report.", 1);
    call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": url, "model": "m1", "enabled": true }),
    );
    let r = req(
        "POST",
        "/ask",
        json!({ "question": "What did I promise?", "grounding": "You are Tide.", "history": [] }),
    );
    let AskReply::Stream { run, .. } = app.handle_ask(&r) else {
        panic!("expected a stream")
    };
    let mut events = Vec::new();
    run(&mut |e| {
        events.push(e.clone());
        true
    });
    assert_eq!(events[0], json!({ "delta": "You promised a report." }));
    assert_eq!(events.last().unwrap(), &json!({ "done": true }));
    let request = seen.join().unwrap().remove(0);
    assert!(request.contains("You are Tide.") && request.contains("What did I promise?"));
}

#[test]
fn the_config_file_is_private_on_disk() {
    let app = app();
    call(
        &app,
        "POST",
        "/ai/connector",
        json!({ "baseUrl": "http://127.0.0.1:1/v1", "model": "m", "apiKey": "sk-disk-key-0002" }),
    );
    // The state dir is the temp dir this test made; find the file.
    let dir = std::fs::read_dir(std::env::temp_dir())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("submeetly-ai-"))
        .map(|e| e.path().join("ai-connector.json"))
        .find(|p| {
            p.exists()
                && std::fs::read_to_string(p)
                    .map(|t| t.contains("sk-disk-key-0002"))
                    .unwrap_or(false)
        });
    let file = dir.expect("config file");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    let _ = file;
}
