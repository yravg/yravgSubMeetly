//! Replays every engine-rs/golden/*.json against the Rust handler.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use submeetly_engine::{App, Request};

#[derive(Deserialize)]
struct Golden {
    name: String,
    request: GoldenRequest,
    response: GoldenResponse,
    #[serde(default)]
    mask: Vec<String>,
}

#[derive(Deserialize)]
struct GoldenRequest {
    method: String,
    path: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Deserialize)]
struct GoldenResponse {
    status: u16,
    #[serde(default)]
    body: Option<Value>,
}

#[test]
fn replays_every_golden_with_zero_mismatches() {
    let golden_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../golden");
    let mut files: Vec<PathBuf> = fs::read_dir(&golden_dir)
        .unwrap_or_else(|error| panic!("read {}: {error}", golden_dir.display()))
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no goldens in {}", golden_dir.display());

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let state_dir = std::env::temp_dir().join(format!(
        "submeetly-engine-golden-{}-{unique}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&state_dir);
    fs::create_dir_all(&state_dir).expect("state dir");
    // The oracle on a non-Apple machine has no translation model.
    std::env::set_var("TRANSLATE", "off");
    let hf_cache = state_dir.join("hf-cache");
    copy_dir(&golden_dir.join("fixtures").join("hf-cache"), &hf_cache);
    let mut app = App::new(state_dir.clone());
    app.set_hf_cache(hf_cache);

    let mut failures: Vec<String> = Vec::new();
    for path in &files {
        let golden: Golden = serde_json::from_str(
            &fs::read_to_string(path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display())),
        )
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));

        let mut headers: Vec<(String, String)> = golden
            .request
            .headers
            .iter()
            .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
            .collect();
        if !headers.iter().any(|(name, _)| name == "host") {
            // The HTTP client always sends Host; the capture recorded only the
            // headers it set itself.
            headers.push(("host".to_string(), "127.0.0.1:17865".to_string()));
        }
        let request = Request {
            method: golden.request.method.clone(),
            target: golden.request.path.clone(),
            headers,
            body: golden.request.body.clone().unwrap_or_default().into_bytes(),
            peer_loopback: true,
            body_file: None,
        };

        let actual = app.handle(&request);
        let mut expected_body = golden.response.body.clone().unwrap_or(Value::Null);
        let mut actual_body = actual.body.clone().unwrap_or(Value::Null);
        for mask in &golden.mask {
            strip_path(&mut expected_body, mask);
            strip_path(&mut actual_body, mask);
        }
        if actual.status != golden.response.status || !json_eq(&expected_body, &actual_body) {
            failures.push(format!(
                "{} [{} {}] status {} vs {}, expected {} got {}",
                golden.name,
                golden.request.method,
                golden.request.path,
                actual.status,
                golden.response.status,
                preview(&expected_body),
                preview(&actual_body),
            ));
        }
    }

    let _ = fs::remove_dir_all(&state_dir);
    assert!(
        failures.is_empty(),
        "{} of {} goldens mismatched:\n{}",
        failures.len(),
        files.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
    println!("replayed {} goldens, 0 mismatches", files.len());
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    fs::create_dir_all(to).expect("mkdir");
    for entry in fs::read_dir(from).expect("fixture dir").flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).expect("copy fixture");
        }
    }
}

fn preview(value: &Value) -> String {
    let text = value.to_string();
    if text.chars().count() > 1200 {
        format!("{}…", text.chars().take(1200).collect::<String>())
    } else {
        text
    }
}

/// JSON numbers compare by value: the Node capture writes 1.0 as 1.
fn json_eq(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(one), Value::Number(two)) => match (one.as_f64(), two.as_f64()) {
            (Some(one), Some(two)) => one == two,
            _ => one == two,
        },
        (Value::Array(one), Value::Array(two)) => {
            one.len() == two.len() && one.iter().zip(two).all(|(a, b)| json_eq(a, b))
        }
        (Value::Object(one), Value::Object(two)) => {
            one.len() == two.len()
                && one
                    .iter()
                    .all(|(key, value)| two.get(key).is_some_and(|other| json_eq(value, other)))
        }
        _ => left == right,
    }
}

fn strip_path(value: &mut Value, path: &str) {
    let (head, rest) = match path.split_once('.') {
        Some((head, rest)) => (head, Some(rest)),
        None => (path, None),
    };
    if let Value::Object(map) = value {
        match rest {
            None => {
                map.remove(head);
            }
            Some(rest) => {
                if let Some(child) = map.get_mut(head) {
                    strip_path(child, rest);
                }
            }
        }
    }
}
