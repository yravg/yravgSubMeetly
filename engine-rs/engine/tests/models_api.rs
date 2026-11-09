//! `GET /models`, `POST /models/pull` and `POST /engine/models`: what is on disk, the
//! catalog, the saved choice, and a download that runs in the background. No model is
//! loaded and nothing reaches the real Hub (the endpoint points at a closed port).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use submeetly_engine::{App, Request};

fn unique_dir(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{label}-{}-{unique}", std::process::id()))
}

static ENV: Once = Once::new();

/// A dead Hub and no model env vars from the host. Each test scans its own cache
/// (`set_hf_cache`), so tests that fill a cache cannot disturb each other.
fn app() -> (App, PathBuf, PathBuf) {
    ENV.call_once(|| {
        for key in [
            "WHISPER_MODEL",
            "TRANSLATE",
            "TRANSLATE_MODEL",
            "HF_HOME",
            "HF_HUB_CACHE",
        ] {
            std::env::remove_var(key);
        }
        std::env::set_var("HF_ENDPOINT", "http://127.0.0.1:9");
    });
    let state = unique_dir("submeetly-models-api-state");
    let cache = state.join("hub");
    fs::create_dir_all(&cache).expect("cache dir");
    let mut app = App::new(state.clone());
    app.set_hf_cache(cache.clone());
    (app, state, cache)
}

fn call(app: &App, method: &str, path: &str, body: Value) -> (u16, Value) {
    let request = Request {
        method: method.to_string(),
        target: path.to_string(),
        headers: vec![("host".to_string(), "127.0.0.1:17865".to_string())],
        body: body.to_string().into_bytes(),
        peer_loopback: true,
        body_file: None,
    };
    let response = app.handle(&request);
    (response.status, response.body.unwrap_or(Value::Null))
}

fn row<'a>(body: &'a Value, list: &str, id: &str) -> &'a Value {
    body[list]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == id))
        .unwrap_or_else(|| panic!("no {id} in {list}"))
}

fn write(path: &Path, bytes: usize) {
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(path, vec![b'x'; bytes]).expect("write");
}

/// A snapshot the way hf-hub lays it out: blobs, plus snapshot files of the same bytes.
fn cache_files(cache: &Path, id: &str, files: &[(&str, usize)]) {
    let root = cache.join(format!("models--{}", id.replace('/', "--")));
    for (name, size) in files {
        write(&root.join("blobs").join(format!("blob-{name}")), *size);
        write(&root.join("snapshots").join("rev1").join(name), *size);
    }
}

#[test]
fn rows_say_what_is_on_disk_and_what_is_only_partly_there() {
    let (app, _, cache) = app();
    let (_, empty) = call(&app, "GET", "/models", Value::Null);
    let asr = &empty["models"][0];
    assert_eq!(asr["id"], "openai/whisper-base");
    assert_eq!(asr["downloaded"], false);
    assert_eq!(asr["bytes"], 0);
    assert_eq!(
        asr["available"], true,
        "available still means: the engine can run it"
    );

    let base = [
        ("config.json", 10),
        ("tokenizer.json", 20),
        ("model.safetensors", 300),
    ];
    cache_files(&cache, "openai/whisper-base", &base);
    // Qwen 0.5B: weights half way (an `.incomplete` blob, no snapshot file yet).
    cache_files(
        &cache,
        "Qwen/Qwen2.5-0.5B-Instruct",
        &[("config.json", 5), ("tokenizer.json", 6)],
    );
    write(
        &cache.join("models--Qwen--Qwen2.5-0.5B-Instruct/blobs/abc.incomplete"),
        700,
    );

    let (_, body) = call(&app, "GET", "/models", Value::Null);
    let asr = &body["models"][0];
    assert_eq!(asr["downloaded"], true);
    assert_eq!(asr["bytes"], 330);
    assert_eq!(asr["partialBytes"], 0);
    let mt = &body["models"][1];
    assert_eq!(
        mt["downloaded"], false,
        "config and tokenizer alone are not a model"
    );
    assert_eq!(
        mt["bytes"], 11,
        ".incomplete is not counted as downloaded bytes"
    );
    assert_eq!(mt["partialBytes"], 700);
    // The catalog rows carry the same truth.
    assert_eq!(
        row(&body, "catalog", "openai/whisper-base")["downloaded"],
        true
    );
    assert_eq!(
        row(&body, "catalog", "openai/whisper-small")["downloaded"],
        false
    );
}

#[test]
fn sharded_weights_count_only_when_every_shard_is_there() {
    let (app, _, cache) = app();
    let id = "Qwen/Qwen2.5-1.5B-Instruct";
    let index = json!({ "weight_map": { "a": "model-1.safetensors", "b": "model-2.safetensors" } });
    cache_files(
        &cache,
        id,
        &[
            ("config.json", 1),
            ("tokenizer.json", 1),
            ("model-1.safetensors", 50),
        ],
    );
    let root = cache.join("models--Qwen--Qwen2.5-1.5B-Instruct/snapshots/rev1");
    fs::write(root.join("model.safetensors.index.json"), index.to_string()).expect("index");

    let (_, body) = call(&app, "GET", "/models", Value::Null);
    assert_eq!(
        row(&body, "catalog", id)["downloaded"],
        false,
        "shard 2 is missing"
    );

    write(&root.join("model-2.safetensors"), 50);
    let (_, body) = call(&app, "GET", "/models", Value::Null);
    assert_eq!(row(&body, "catalog", id)["downloaded"], true);
}

#[test]
fn catalog_lists_the_fixed_choices_and_marks_the_selected_ones() {
    let (app, _, _) = app();
    let (status, body) = call(&app, "GET", "/models", Value::Null);
    assert_eq!(status, 200);
    let ids: Vec<&str> = body["catalog"]
        .as_array()
        .expect("catalog")
        .iter()
        .map(|row| row["id"].as_str().expect("id"))
        .collect();
    assert_eq!(
        ids,
        [
            "openai/whisper-base",
            "openai/whisper-small",
            "openai/whisper-medium",
            "openai/whisper-large-v3-turbo",
            "Qwen/Qwen2.5-0.5B-Instruct",
            "Qwen/Qwen2.5-1.5B-Instruct",
            "Qwen/Qwen2.5-3B-Instruct",
        ]
    );
    let small = row(&body, "catalog", "openai/whisper-small");
    assert_eq!(small["kind"], "asr");
    assert_eq!(small["approxBytes"], 967_000_000_u64);
    assert_eq!(small["selected"], false);
    assert_eq!(
        row(&body, "catalog", "openai/whisper-base")["selected"],
        true
    );
    assert_eq!(
        row(&body, "catalog", "Qwen/Qwen2.5-0.5B-Instruct")["selected"],
        true
    );
}

#[test]
fn the_chosen_models_are_validated_applied_and_survive_a_restart() {
    let (app, state, _) = app();
    let (status, body) = call(&app, "POST", "/engine/models", json!({}));
    assert_eq!(status, 400, "{body}");
    let (status, body) = call(
        &app,
        "POST",
        "/engine/models",
        json!({ "asr": "acme/mine" }),
    );
    assert_eq!(status, 400);
    assert_eq!(body["allowed"].as_array().map(Vec::len), Some(7));
    // A Qwen id is not a speech model.
    let (status, _) = call(
        &app,
        "POST",
        "/engine/models",
        json!({ "asr": "Qwen/Qwen2.5-3B-Instruct" }),
    );
    assert_eq!(status, 400);

    let (status, body) = call(
        &app,
        "POST",
        "/engine/models",
        json!({ "asr": "small", "translate": "Qwen/Qwen2.5-1.5B-Instruct" }),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["asr"], "openai/whisper-small",
        "short names are accepted"
    );
    assert_eq!(body["translate"], "Qwen/Qwen2.5-1.5B-Instruct");
    assert_eq!(body["applied"], json!({ "asr": true, "translate": true }));
    let (_, models) = call(&app, "GET", "/models", Value::Null);
    assert_eq!(models["models"][0]["id"], "openai/whisper-small");
    assert_eq!(
        models["models"][0]["downloaded"], false,
        "choosing does not download"
    );
    assert_eq!(
        call(&app, "GET", "/health", Value::Null).1["model"],
        "openai/whisper-small"
    );

    // A new engine on the same state dir starts with the saved choice.
    let again = App::new(state.clone());
    let (_, models) = call(&again, "GET", "/models", Value::Null);
    assert_eq!(models["models"][0]["id"], "openai/whisper-small");
    assert_eq!(models["models"][1]["id"], "Qwen/Qwen2.5-1.5B-Instruct");

    let (status, body) = call(
        &app,
        "POST",
        "/engine/models",
        json!({ "translate": "off" }),
    );
    assert_eq!(status, 200);
    assert_eq!(body["translate"], Value::Null);
    assert_eq!(
        body["asr"], "openai/whisper-small",
        "the other kind is left alone"
    );
    let (_, models) = call(&App::new(state), "GET", "/models", Value::Null);
    assert_eq!(models["models"][1]["available"], false);
}

#[test]
fn a_pull_runs_in_the_background_and_its_failure_shows_on_the_row() {
    let (app, _, _) = app();
    let (status, _) = call(&app, "POST", "/models/pull", json!({ "id": "acme/mine" }));
    assert_eq!(status, 400);

    let started = Instant::now();
    let id = "openai/whisper-medium";
    let (status, body) = call(&app, "POST", "/models/pull", json!({ "id": id }));
    assert_eq!(status, 202, "{body}");
    assert_eq!(body["started"], true);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "the POST must not wait for the download"
    );

    // The Hub is a closed port: the row ends with the reason instead of hanging.
    let deadline = Instant::now() + Duration::from_secs(60);
    let failed = loop {
        let (_, models) = call(&app, "GET", "/models", Value::Null);
        let medium = row(&models, "catalog", id).clone();
        if medium["pullError"].is_string() {
            break medium;
        }
        assert!(Instant::now() < deadline, "no failure reported: {medium}");
        std::thread::sleep(Duration::from_millis(100));
    };
    assert_eq!(failed["pulling"], false);
    assert_eq!(failed["downloaded"], false);
    assert!(failed["pullError"]
        .as_str()
        .expect("error")
        .contains("download failed"));

    // Trying again starts a new pull and clears the old error.
    let (status, body) = call(&app, "POST", "/models/pull", json!({ "id": id }));
    assert_eq!(status, 202);
    assert_eq!(body["started"], true);
    assert_eq!(body["pullError"], Value::Null);
}

#[test]
fn pulling_a_model_that_is_already_there_starts_nothing() {
    let (app, _, cache) = app();
    cache_files(
        &cache,
        "openai/whisper-base",
        &[
            ("config.json", 1),
            ("tokenizer.json", 1),
            ("model.safetensors", 1),
        ],
    );
    let (status, body) = call(
        &app,
        "POST",
        "/models/pull",
        json!({ "id": "openai/whisper-base" }),
    );
    assert_eq!(status, 200);
    assert_eq!(body["started"], false);
    assert_eq!(body["downloaded"], true);
}
