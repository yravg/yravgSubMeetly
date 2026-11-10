//! `POST /ask` (Ask Tide, local mode): the guard, the body, and the answers that need no
//! model. The streamed answer itself needs Qwen: see `qwen_ask_streams` in ml_golden.rs.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use submeetly_engine::protocol::AskReply;
use submeetly_engine::{App, Request};

fn app() -> App {
    for key in ["TRANSLATE", "TRANSLATE_MODEL", "HF_HOME", "HF_HUB_CACHE"] {
        std::env::remove_var(key);
    }
    // A dead Hub: a route that tried to download would fail slowly, not answer at once.
    std::env::set_var("HF_ENDPOINT", "http://127.0.0.1:9");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let state: PathBuf =
        std::env::temp_dir().join(format!("submeetly-ask-{}-{unique}", std::process::id()));
    let cache = state.join("hub");
    fs::create_dir_all(&cache).expect("cache dir");
    let mut app = App::new(state);
    app.set_hf_cache(cache);
    app.set_allowed_origins(Vec::new());
    app
}

fn post(path: &str, origin: Option<&str>, host: &str, peer: bool, body: Value) -> Request {
    let mut headers = vec![("host".to_string(), host.to_string())];
    if let Some(origin) = origin {
        headers.push(("origin".to_string(), origin.to_string()));
    }
    Request {
        method: "POST".to_string(),
        target: path.to_string(),
        headers,
        body: body.to_string().into_bytes(),
        peer_loopback: peer,
        body_file: None,
    }
}

fn question() -> Value {
    json!({ "question": "What did I promise?", "grounding": "You are Tide.", "history": [] })
}

fn reply(app: &App, request: &Request) -> (u16, Value) {
    match app.handle_ask(request) {
        AskReply::Reply(response) => (response.status, response.body.unwrap_or(Value::Null)),
        AskReply::Stream { .. } => panic!("expected a plain reply, got a stream"),
    }
}

#[test]
fn a_missing_model_is_a_409_at_once_and_nothing_is_downloaded() {
    let app = app();
    let started = Instant::now();
    let (status, body) = reply(
        &app,
        &post("/ask", None, "127.0.0.1:17865", true, question()),
    );
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["code"], "model-not-downloaded");
    assert!(body["id"].is_string());
    assert!(started.elapsed() < Duration::from_secs(5), "no download");
}

#[test]
fn ask_is_loopback_only_like_every_other_route() {
    let app = app();
    let remote = post("/ask", None, "127.0.0.1:17865", false, question());
    assert_eq!(reply(&app, &remote).0, 403);
    let host = post("/ask", None, "evil.example:17865", true, question());
    assert_eq!(reply(&app, &host).0, 403);
    let origin = post(
        "/ask",
        Some("https://evil.example"),
        "127.0.0.1:17865",
        true,
        question(),
    );
    let (status, body) = reply(&app, &origin);
    assert_eq!(
        (status, body),
        (403, json!({ "error": "asal tidak diizinkan" }))
    );
    // Not reflected to a foreign page either.
    let AskReply::Reply(response) = app.handle_ask(&origin) else {
        panic!("a denied request is a plain reply")
    };
    assert!(!response
        .headers
        .iter()
        .any(|(name, _)| name == "Access-Control-Allow-Origin"));
}

#[test]
fn a_question_is_required_and_the_body_must_be_json() {
    let app = app();
    for body in [
        json!({}),
        json!({ "question": "   " }),
        json!({ "question": 4 }),
    ] {
        let (status, answer) = reply(&app, &post("/ask", None, "127.0.0.1:17865", true, body));
        assert_eq!(status, 400, "{answer}");
    }
    let mut broken = post("/ask", None, "127.0.0.1:17865", true, json!(null));
    broken.body = b"{not json".to_vec();
    assert_eq!(reply(&app, &broken).0, 400);
}

#[test]
fn only_post_reaches_ask() {
    let app = app();
    let mut get = post("/ask", None, "127.0.0.1:17865", true, json!(null));
    get.method = "GET".into();
    let response = app.handle(&get);
    assert_eq!(response.status, 404);
}
