//! Local model cache: `/models` catalog scan, `DELETE /models/cache/<slug>`,
//! `/models/pull`. Mirrors `_scan_model_cache` and the delete guard in
//! native/server.py.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::state::home_dir;

/// `HF_HUB_CACHE`, else `HF_HOME/hub`, else `~/.cache/huggingface/hub`.
/// (The oracle's scan reads only `HF_HUB_CACHE`; its downloads honour `HF_HOME`
/// too, so this follows where models actually land.)
pub fn hub_cache_dir() -> PathBuf {
    if let Some(dir) = env::var_os("HF_HUB_CACHE").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(home) = env::var_os("HF_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(home).join("hub");
    }
    home_dir()
        .unwrap_or_default()
        .join(".cache")
        .join("huggingface")
        .join("hub")
}

fn counted(name: &str) -> bool {
    !(name.starts_with('.') || name.ends_with(".lock") || name.ends_with(".metadata"))
}

/// (bytes, files) under `dir`, following file symlinks like `os.stat`.
fn walk_size(dir: &Path, filter: bool) -> (u64, u64) {
    let mut total = 0;
    let mut files = 0;
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            let (bytes, count) = walk_size(&path, filter);
            total += bytes;
            files += count;
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if filter && !counted(&name) {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            if meta.is_file() {
                total += meta.len();
                files += 1;
            }
        }
    }
    (total, files)
}

pub fn scan_model_cache(cache: &Path) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(cache) else {
        return Vec::new();
    };
    let mut dirs: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| {
            (
                entry.file_name().to_string_lossy().to_string(),
                entry.path(),
            )
        })
        .filter(|(name, _)| name.starts_with("models--"))
        .collect();
    dirs.sort();
    dirs.into_iter()
        .map(|(name, path)| {
            let model_id = name["models--".len()..].replacen("--", "/", 1);
            let (bytes, files) = walk_size(&path, true);
            let snapshots = fs::read_dir(path.join("snapshots"))
                .map(|it| {
                    it.flatten()
                        .filter(|e| e.file_type().is_ok_and(|k| k.is_dir()))
                        .count()
                })
                .unwrap_or(0);
            json!({
                "id": model_id,
                "bytes": bytes,
                "files": files,
                "snapshots": snapshots,
                "complete": snapshots > 0 && files > 0,
            })
        })
        .collect()
}

/// Outcome of `DELETE /models/cache/<slug>` as (status, body).
pub fn delete_cached(cache: &Path, slug: &str, active: &[String], confirm: bool) -> (u16, Value) {
    if slug.is_empty() || slug.contains('/') || slug == "generate" || slug == "summarize" {
        return (404, json!({ "error": "not found" }));
    }
    let model_id = slug.replacen("--", "/", 1);
    if !model_id.contains('/') {
        return (400, json!({ "error": "id must look like org--name" }));
    }
    if active.iter().any(|id| id == &model_id) {
        return (
            400,
            json!({ "error": "refusing to delete an active inventory model" }),
        );
    }
    if !confirm {
        return (
            400,
            json!({ "error": "add ?confirm=1 to delete cached model" }),
        );
    }
    let target = cache.join(format!("models--{slug}"));
    let not_found = (404, json!({ "error": "cached model not found" }));
    let (Ok(resolved), Ok(root)) = (fs::canonicalize(&target), fs::canonicalize(cache)) else {
        return not_found;
    };
    if resolved.parent() != Some(root.as_path()) || !target.is_dir() {
        return not_found;
    }
    let (freed, _) = walk_size(&target, false);
    if let Err(error) = fs::remove_dir_all(&target) {
        return (500, json!({ "error": format!("delete failed: {error}") }));
    }
    (
        200,
        json!({ "ok": true, "id": model_id, "freedBytes": freed }),
    )
}

/// Download a whole repo snapshot into the hub cache; returns (path, bytes).
pub fn pull(repo_id: &str) -> anyhow::Result<(PathBuf, u64)> {
    let path = crate::ml::hub_snapshot(repo_id)?;
    let (bytes, _) = walk_size(&path, true);
    Ok((path, bytes))
}
