//! Contract tests for the non-golden parts: origin/host policy, allowed-origin
//! override, state-dir migration, and the ML routes' model-free answers.

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
        body_file: None,
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
fn ml_routes_answer_without_loading_a_model() {
    std::env::set_var("TRANSLATE", "off");
    let (app, state) = app_with_state();
    let post = |path: &str, body: &[u8]| {
        let mut req = request("POST", path, None, "127.0.0.1:17865", true);
        req.body = body.to_vec();
        app.handle(&req)
    };

    // Too short for ASR: answered before any model loads, like the oracle.
    let short = post("/transcribe", &[0u8; 400]);
    assert_eq!(
        (short.status, short.body),
        (200, Some(json!({ "text": "" })))
    );
    let draft = post("/draft?src=en&tgt=de", b"");
    assert_eq!(draft.body, Some(json!({ "source": "", "translation": "" })));

    for path in ["/translate?tgt=de", "/translate_refine"] {
        let response = post(path, b"{\"text\":\"hello\"}");
        assert_eq!(response.status, 501, "{path}");
    }

    let unknown = post("/jobs/job-1/cancel", b"");
    assert_eq!(unknown.status, 404);

    // The active ASR model's cache entry is never deletable.
    let active = app.handle(&request(
        "DELETE",
        "/models/cache/openai--whisper-large-v3-turbo?confirm=1",
        None,
        "127.0.0.1:17865",
        true,
    ));
    assert_eq!(active.status, 400);
    assert_eq!(
        active.body,
        Some(json!({ "error": "refusing to delete an active inventory model" }))
    );

    assert!(!app.shutdown_requested());
    let bye = post("/shutdown", b"");
    assert_eq!(bye.body, Some(json!({ "ok": true, "shutting_down": true })));
    assert!(app.shutdown_requested());

    let health = app.handle(&request("GET", "/health", None, "127.0.0.1:17865", true));
    let body = health.body.expect("health body");
    assert_eq!(body["loaded"], json!({ "asr": false, "translate": false }));
    assert_eq!(body["model"], json!("openai/whisper-large-v3-turbo"));
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

#[test]
fn live_keeps_the_last_caption_and_its_rtf() {
    let (app, state) = app_with_state();
    let get = || {
        app.handle(&request("GET", "/live", None, "127.0.0.1:17865", true))
            .body
            .expect("body")
    };
    assert_eq!(get()["seq"], 0);

    app.record_live("  halo dunia ", "", 100, 32000); // 2 s of audio in 100 ms
    let live = get();
    assert_eq!(live["seq"], 1);
    assert_eq!(live["source"], "halo dunia");
    assert_eq!(live["audio_s"], 2.0);
    assert_eq!(live["rtf"], 0.05);

    app.record_live("   ", "", 5, 32000); // silence is not a line
    assert_eq!(get()["seq"], 1);
    let _ = fs::remove_dir_all(&state);
}

#[test]
fn caption_surface_is_stored_only_when_valid_and_survives_other_prefs() {
    let (app, state) = app_with_state();
    let post = |body: &str| {
        let mut r = request("POST", "/ui-prefs", None, "127.0.0.1:17865", true);
        r.body = body.as_bytes().to_vec();
        app.handle(&r)
    };
    let get = || {
        let r = app.handle(&request("GET", "/ui-prefs", None, "127.0.0.1:17865", true));
        r.body.clone().expect("json body")
    };
    // Unset: the key is absent, so GET keeps its old shape.
    assert_eq!(
        get()["prefs"],
        json!({ "theme": "auto", "reskin": "yraverage" })
    );
    assert_eq!(post(r#"{"captionSurface":"island"}"#).status, 200);
    assert_eq!(get()["prefs"]["captionSurface"], "island");
    // A bad value is ignored; another pref does not clear it.
    assert_eq!(post(r#"{"captionSurface":"nope"}"#).status, 200);
    assert_eq!(post(r#"{"theme":"dark"}"#).status, 200);
    assert_eq!(
        get()["prefs"],
        json!({ "theme": "dark", "reskin": "yraverage", "captionSurface": "island" })
    );
    assert_eq!(post("{}").status, 400);
    let _ = fs::remove_dir_all(state);
}
