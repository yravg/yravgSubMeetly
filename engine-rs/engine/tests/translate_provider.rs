//! The caption translation provider through the real routes: the on-device model is the
//! default, the choice is saved, secrets are never shown, and a test call reaches the service.

use std::io::{Read, Write};
use std::net::TcpListener;

use serde_json::{json, Value};
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
    let state =
        std::env::temp_dir().join(format!("submeetly-prov-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&state).unwrap();
    let mut app = App::new(state);
    app.set_allowed_origins(Vec::new());
    app
}

fn call(app: &App, method: &str, path: &str, body: Value) -> (u16, Value) {
    let r = app.handle(&Request {
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
    });
    (r.status, r.body.unwrap_or(Value::Null))
}

fn mock(answer: &'static str) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let h = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut got = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = s.read(&mut buf).unwrap();
            got.extend_from_slice(&buf[..n]);
            let t = String::from_utf8_lossy(&got).to_string();
            if let Some(i) = t.find("\r\n\r\n") {
                let len = t
                    .to_lowercase()
                    .split("content-length:")
                    .nth(1)
                    .and_then(|r| r.split("\r\n").next())
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if got.len() >= i + 4 + len {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        let out = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",
            answer.len()
        );
        s.write_all(out.as_bytes()).unwrap();
        String::from_utf8_lossy(&got).to_string()
    });
    (url, h)
}

#[test]
fn the_default_is_on_device_and_nothing_is_enabled() {
    let app = app();
    let (code, v) = call(&app, "GET", "/translate/provider", Value::Null);
    assert_eq!(code, 200);
    assert_eq!(v["provider"], "local");
    assert_eq!(v["enabled"], false);
    assert_eq!(v["offDevice"], false);
    assert!(v["providers"].as_array().unwrap().len() >= 10);
}

#[test]
fn a_provider_can_be_chosen_saved_and_never_shows_its_secret() {
    let app = app();
    let (code, v) = call(
        &app,
        "POST",
        "/translate/provider",
        json!({ "provider": "baidu", "appId": "appid-1", "secret": "super-secret-123" }),
    );
    assert_eq!(code, 200, "{v}");
    let (code, v) = call(
        &app,
        "POST",
        "/translate/provider",
        json!({ "enabled": true }),
    );
    assert_eq!(code, 200, "{v}");
    assert_eq!(v["offDevice"], true);
    assert!(!v.to_string().contains("super-secret-123"));
    let (_, v) = call(&app, "GET", "/translate/provider", Value::Null);
    assert_eq!(v["provider"], "baidu");
    assert_eq!(v["hasSecret"], true);
    // Turning on without the needed fields is refused.
    let (code, v) = call(
        &app,
        "POST",
        "/translate/provider",
        json!({ "provider": "deepl", "enabled": true }),
    );
    assert_eq!(code, 400);
    assert!(v["error"].as_str().unwrap().contains("API key"), "{v}");
}

#[test]
fn the_test_route_reaches_the_service_without_enabling_it() {
    let app = app();
    let (url, h) = mock(r#"{"translatedText":"Selamat pagi"}"#);
    let (code, v) = call(
        &app,
        "POST",
        "/translate/provider/test",
        json!({ "provider": "libre", "baseUrl": url, "src": "en", "tgt": "id" }),
    );
    assert_eq!(code, 200, "{v}");
    assert_eq!(v["ok"], true, "{v}");
    assert!(v["sample"].as_str().unwrap().contains("Selamat"));
    assert!(h.join().unwrap().contains("POST /translate"));
    let (_, v) = call(&app, "GET", "/translate/provider", Value::Null);
    assert_eq!(v["enabled"], false, "a test never turns the provider on");
}

#[test]
fn a_dead_service_reports_an_error_from_the_test_route() {
    let app = app();
    let (_, v) = call(
        &app,
        "POST",
        "/translate/provider/test",
        json!({ "provider": "mtran", "baseUrl": "http://127.0.0.1:1" }),
    );
    assert_eq!(v["ok"], false);
    assert!(
        v["error"].as_str().unwrap().contains("did not answer"),
        "{v}"
    );
}
