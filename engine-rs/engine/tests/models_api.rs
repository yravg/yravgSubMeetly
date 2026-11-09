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
        // The free-space check is real; the disk this runs on may be full.
        std::env::set_var("ENGINE_FREE_BYTES", "1000000000000");
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
    let id = "openai/whisper-base";
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

// ---- per-model storage folder -------------------------------------------------------

fn wait_until(what: &str, mut ready: impl FnMut() -> bool) {
    let start = Instant::now();
    while !ready() {
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "timed out: {what}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn models_row(app: &App, id: &str) -> Value {
    let (_, body) = call(app, "GET", "/models", Value::Null);
    row(&body, "catalog", id).clone()
}

fn path_str(dir: &Path) -> String {
    dir.to_string_lossy().to_string()
}

const WHISPER: &str = "openai/whisper-base";
const BASE_FILES: [(&str, usize); 3] = [
    ("config.json", 10),
    ("tokenizer.json", 20),
    ("model.safetensors", 3000),
];

#[test]
fn a_folder_that_is_not_usable_is_refused_and_nothing_changes() {
    let (app, state, cache) = app();
    let file = state.join("a-file");
    fs::write(&file, b"x").expect("file");
    let cases = [
        (
            json!({ "id": WHISPER, "dir": "relative/models" }),
            "bad-dir",
        ),
        (
            json!({ "id": WHISPER, "dir": path_str(&state.join("..").join("x")) }),
            "bad-dir",
        ),
        (json!({ "id": WHISPER, "dir": 7 }), "bad-dir"),
        (json!({ "id": WHISPER }), "bad-dir"),
        (
            json!({ "id": WHISPER, "dir": path_str(&file) }),
            "dir-not-writable",
        ),
    ];
    for (body, code) in cases {
        let (status, answer) = call(&app, "POST", "/engine/models/location", body.clone());
        assert_eq!(status, 400, "{body}");
        assert_eq!(answer["code"], code, "{body}");
        assert_eq!(answer["ok"], false);
    }
    let (status, _) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": "x/unknown", "dir": path_str(&state) }),
    );
    assert_eq!(status, 400);
    let after = models_row(&app, WHISPER);
    assert_eq!(after["dir"], path_str(&cache));
    assert_eq!(after["dirIsDefault"], true);
    assert!(
        !state.join("engine-locations.json").exists(),
        "no mapping was written"
    );
}

#[test]
fn a_model_that_is_not_downloaded_is_only_pointed_at_the_new_folder() {
    let (app, state, cache) = app();
    let target = state.join("ssd").join("models");
    let (status, answer) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": path_str(&target) }),
    );
    assert_eq!(
        (status, &answer["started"], &answer["moved"]),
        (200, &json!(false), &json!(false)),
        "{answer}"
    );
    let row = models_row(&app, WHISPER);
    assert_eq!(row["dir"], path_str(&target));
    assert_eq!(row["dirIsDefault"], false);
    assert_eq!(row["dirAvailable"], true);
    assert_eq!(row["freeBytes"], 1_000_000_000_000_u64);

    // The choice survives a restart.
    let again = App::new(state.clone());
    assert_eq!(models_row(&again, WHISPER)["dir"], path_str(&target));

    // And null returns to the default.
    let (status, _) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": null }),
    );
    assert_eq!(status, 200);
    let row = models_row(&app, WHISPER);
    assert_eq!(
        (row["dir"].clone(), row["dirIsDefault"].clone()),
        (json!(path_str(&cache)), json!(true))
    );
}

#[test]
fn moving_a_downloaded_model_there_and_back_keeps_it_whole() {
    let (app, state, cache) = app();
    cache_files(&cache, WHISPER, &BASE_FILES);
    let target = state.join("ssd");
    let (status, answer) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": path_str(&target) }),
    );
    assert!(status == 202 || status == 200, "{status} {answer}");
    wait_until("move out", || {
        let row = models_row(&app, WHISPER);
        !row["moving"].as_bool().unwrap_or(true) && row["dir"] == path_str(&target)
    });
    let row = models_row(&app, WHISPER);
    assert_eq!(row["downloaded"], true);
    assert_eq!(row["bytes"], 3030);
    assert_eq!(row["moveError"], Value::Null);
    assert_eq!(row["moveWarning"], Value::Null);
    assert!(
        !cache.join("models--openai--whisper-base").exists(),
        "old copy deleted"
    );

    let (_, body) = call(&app, "GET", "/models", Value::Null);
    let cached = row_in(&body["cached"], WHISPER);
    assert_eq!(
        cached["dir"],
        path_str(&target),
        "cached[] lists the model in its own folder"
    );

    // Back to the default folder.
    let (status, _) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": null }),
    );
    assert!(status == 202 || status == 200);
    wait_until("move back", || {
        let row = models_row(&app, WHISPER);
        !row["moving"].as_bool().unwrap_or(true) && row["dirIsDefault"] == true
    });
    assert_eq!(models_row(&app, WHISPER)["bytes"], 3030);
    assert!(!target.join("models--openai--whisper-base").exists());
}

fn row_in<'a>(rows: &'a Value, id: &str) -> &'a Value {
    rows.as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == id))
        .unwrap_or_else(|| panic!("no {id} in cached"))
}

#[test]
fn a_folder_that_already_holds_a_copy_is_never_overwritten() {
    let (app, state, cache) = app();
    cache_files(&cache, WHISPER, &BASE_FILES);
    let target = state.join("ssd");
    cache_files(&target, WHISPER, &[("config.json", 1)]);
    let (status, answer) = call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": path_str(&target) }),
    );
    assert_eq!(
        (status, &answer["code"]),
        (409, &json!("target-has-copy")),
        "{answer}"
    );
    assert_eq!(
        models_row(&app, WHISPER)["dir"],
        path_str(&cache),
        "mapping unchanged"
    );
    assert_eq!(models_row(&app, WHISPER)["bytes"], 3030, "old copy intact");
    assert!(target
        .join("models--openai--whisper-base/blobs/blob-config.json")
        .exists());
}

#[test]
fn a_missing_drive_is_a_clear_error_and_recovers_when_it_returns() {
    let (app, state, cache) = app();
    let drive = state.join("usb");
    let target = drive.join("models");
    call(
        &app,
        "POST",
        "/engine/models/location",
        json!({ "id": WHISPER, "dir": path_str(&target) }),
    );
    cache_files(&target, WHISPER, &BASE_FILES);
    assert_eq!(models_row(&app, WHISPER)["downloaded"], true);

    fs::remove_dir_all(&drive).expect("unplug");
    let row = models_row(&app, WHISPER);
    assert_eq!(row["dirAvailable"], false);
    assert!(row["dirError"].as_str().is_some_and(|why| !why.is_empty()));
    assert_eq!(row["dir"], path_str(&target), "still points at the drive");

    let (status, answer) = call(&app, "POST", "/models/pull", json!({ "id": WHISPER }));
    assert_eq!(
        (status, &answer["code"]),
        (409, &json!("model-dir-unavailable")),
        "{answer}"
    );
    let (status, answer) = call(
        &app,
        "DELETE",
        "/models/cache/openai--whisper-base?confirm=1",
        Value::Null,
    );
    assert_eq!(
        (status, &answer["code"]),
        (409, &json!("model-dir-unavailable"))
    );
    assert!(
        !cache.join("models--openai--whisper-base").exists(),
        "nothing was fetched into the default cache"
    );

    cache_files(&target, WHISPER, &BASE_FILES); // plug it back in
    let row = models_row(&app, WHISPER);
    assert_eq!(
        (row["dirAvailable"].clone(), row["downloaded"].clone()),
        (json!(true), json!(true))
    );
}

// ---- no route downloads a model --------------------------------------------------------

fn call_pcm(app: &App, method: &str, path: &str, samples: usize) -> (u16, Value) {
    let request = Request {
        method: method.to_string(),
        target: path.to_string(),
        headers: vec![("host".to_string(), "127.0.0.1:17865".to_string())],
        body: vec![0u8; samples * 4],
        peer_loopback: true,
        body_file: None,
    };
    let response = app.handle(&request);
    (response.status, response.body.unwrap_or(Value::Null))
}

#[test]
fn a_missing_model_is_a_409_at_once_and_nothing_is_downloaded() {
    let (app, _, cache) = app();
    // Qwen is chosen (the default) but nothing is on disk; the Hub is a closed port.
    let started = Instant::now();
    for (path, what) in [
        ("/transcribe", "speech"),
        ("/transcribe_file", "speech"),
        ("/draft?src=de&tgt=en", "speech"),
        ("/translate?src=de&tgt=id", "translation"),
        ("/translate_refine?src=de&tgt=id", "translation"),
    ] {
        let (status, body) = call_pcm(&app, "POST", path, 16_000);
        assert_eq!(status, 409, "{path}: {body}");
        assert_eq!(body["code"], "model-not-downloaded", "{path}");
        assert_eq!(
            body["error"],
            format!("{what} model not downloaded"),
            "{path}"
        );
        assert!(body["id"].is_string(), "{path}");
    }
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "answered without trying the network"
    );
    assert!(
        !cache.join("models--openai--whisper-base").exists(),
        "no request created a download"
    );
}
