//! Contract tests for the non-golden parts: origin/host policy, allowed-origin
//! override, state-dir migration, and the 501 answers for ML routes.

use std::fs;
use std::path::PathBuf;

use serde_json::json;
use submeetly_engine::state::migrate_state_dir;
use submeetly_engine::{App, Request};

fn unique_dir(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{label}-{}-{unique}", std::process::id()))
}

fn app_with_state() -> (App, PathBuf) {
    let state = unique_dir("submeetly-engine-contract");
    let _ = fs::remove_dir_all(&state);
    fs::create_dir_all(&state).expect("state dir");
    let mut app = App::new(state.clone());
    // Do not let the host environment widen the policy under test.
    app.set_allowed_origins(Vec::new());
    (app, state)
}

fn request(method: &str, path: &str, origin: Option<&str>, host: &str, peer: bool) -> Request {
    let mut headers = vec![("host".to_string(), host.to_string())];
    if let Some(origin) = origin {
        headers.push(("origin".to_string(), origin.to_string()));
    }
    Request {
        method: method.to_string(),
        target: path.to_string(),
        headers,
        body: Vec::new(),
        peer_loopback: peer,
    }
}

fn allow_header(response: &submeetly_engine::Response) -> Option<&str> {
    response
        .headers
        .iter()
        .find(|(name, _)| name == "Access-Control-Allow-Origin")
        .map(|(_, value)| value.as_str())
}

#[test]
fn origin_policy_mirrors_the_python_helper() {
    let (app, state) = app_with_state();

    let plain = app.handle(&request("GET", "/health", None, "127.0.0.1:17865", true));
    assert_eq!(plain.status, 200);
    assert_eq!(allow_header(&plain), None);

    for origin in [
        "https://evil.example",
        "http://example.com",
        "null",
        "file://",
    ] {
        let response = app.handle(&request(
            "GET",
            "/health",
            Some(origin),
            "127.0.0.1:17865",
            true,
        ));
        assert_eq!(response.status, 403, "{origin}");
        assert_eq!(
            response.body,
            Some(json!({ "error": "asal tidak diizinkan" }))
        );
        assert_eq!(
            allow_header(&response),
            None,
            "{origin} must not be reflected"
        );
    }

    for origin in [
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "http://127.0.0.1:8799",
        "http://localhost:8799",
    ] {
        let response = app.handle(&request(
            "GET",
            "/health",
            Some(origin),
            "127.0.0.1:17865",
            true,
        ));
        assert_eq!(response.status, 200, "{origin}");
        assert_eq!(allow_header(&response), Some(origin));
        assert!(response
            .headers
            .iter()
            .any(|(name, value)| name == "Vary" && value == "Origin"));
    }

    let host_denied = app.handle(&request("GET", "/health", None, "evil.example:17865", true));
    assert_eq!(host_denied.status, 403);
    assert_eq!(
        host_denied.body,
        Some(json!({ "error": "header Host bukan loopback" }))
    );

    for host in ["127.0.0.1:17865", "localhost:17865", "[::1]:17865"] {
        let response = app.handle(&request("GET", "/health", None, host, true));
        assert_eq!(response.status, 200, "{host}");
    }

    let remote = app.handle(&request("GET", "/health", None, "127.0.0.1:17865", false));
    assert_eq!(remote.status, 403);
    assert_eq!(
        remote.body,
        Some(json!({ "error": "helper hanya melayani loopback" }))
    );

    let _ = fs::remove_dir_all(&state);
}

#[test]
fn allowed_origins_override_replaces_the_default_policy() {
    let (mut app, state) = app_with_state();
    app.set_allowed_origins(vec!["https://app.example".to_string()]);

    let allowed = app.handle(&request(
        "GET",
        "/health",
        Some("https://app.example"),
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(allowed.status, 200);
    assert_eq!(allow_header(&allowed), Some("https://app.example"));

    let extension = app.handle(&request(
        "GET",
        "/health",
        Some("chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(extension.status, 403);

    let _ = fs::remove_dir_all(&state);
}

#[test]
fn legacy_state_dir_is_migrated_once() {
    let base = unique_dir("submeetly-engine-migrate");
    let legacy = base.join(".localtranssub");
    let current = base.join(".yraveragesubmin");
    fs::create_dir_all(&legacy).expect("legacy dir");
    fs::write(legacy.join("notes.json"), r#"{"notes":[]}"#).expect("notes");

    migrate_state_dir(&current, &legacy);
    assert!(current.join("notes.json").is_file());
    assert!(
        !legacy.exists(),
        "legacy dir is moved, not copied, when possible"
    );

    fs::create_dir_all(&legacy).expect("legacy again");
    fs::write(legacy.join("keep.txt"), "keep").expect("keep");
    migrate_state_dir(&current, &legacy);
    assert!(legacy.join("keep.txt").is_file(), "existing new dir wins");

    let _ = fs::remove_dir_all(&base);
}

#[test]
fn ml_routes_answer_501() {
    let (app, state) = app_with_state();
    for path in [
        "/transcribe",
        "/transcribe_file",
        "/transcribe_file_job",
        "/translate",
        "/translate_refine",
        "/draft",
        "/notes/generate",
        "/notes/summarize",
        "/models/pull",
    ] {
        let response = app.handle(&request("POST", path, None, "127.0.0.1:17865", true));
        assert_eq!(response.status, 501, "{path}");
        assert_eq!(
            response.body,
            Some(json!({ "error": "not-implemented-in-rust" })),
            "{path}"
        );
    }
    let _ = fs::remove_dir_all(&state);
}

#[test]
fn unknown_routes_stay_json_404s() {
    let (app, state) = app_with_state();
    for method in ["GET", "POST", "DELETE"] {
        let response = app.handle(&request(method, "/nothing", None, "127.0.0.1:17865", true));
        assert_eq!(response.status, 404, "{method}");
        assert_eq!(response.body, Some(json!({ "error": "not found" })));
    }
    let jobs = app.handle(&request(
        "GET",
        "/jobs/unknown",
        None,
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(jobs.status, 404);
    assert_eq!(jobs.body, Some(json!({ "error": "job not found" })));
    let cancel = app.handle(&request(
        "POST",
        "/jobs/unknown/cancel",
        None,
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(cancel.status, 404);
    assert_eq!(cancel.body, Some(json!({ "error": "job not found" })));
    let _ = fs::remove_dir_all(&state);
}

#[test]
fn preflight_is_no_content_and_respects_origin() {
    let (app, state) = app_with_state();
    let response = app.handle(&request(
        "OPTIONS",
        "/shutdown",
        Some("chrome-extension://abcdefghijklmnopabcdefghijklmnop"),
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(response.status, 204);
    assert_eq!(response.body, None);

    let denied = app.handle(&request(
        "OPTIONS",
        "/shutdown",
        Some("https://evil.example"),
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(denied.status, 403);
    assert_eq!(
        denied.body,
        Some(json!({ "error": "asal tidak diizinkan" }))
    );

    let _ = fs::remove_dir_all(&state);
}
