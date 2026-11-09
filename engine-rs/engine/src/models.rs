//! Local model cache: `/models` catalog scan, `DELETE /models/cache/<slug>`,
//! `/models/pull`. Mirrors `_scan_model_cache` and the delete guard in
//! native/server.py.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use hf_hub::progress::{DownloadEvent, Progress, ProgressEvent, ProgressHandler};

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

pub(crate) fn counted(name: &str) -> bool {
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

/// What a model does; decides which files a download needs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Asr,
    Translate,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Asr => "asr",
            Kind::Translate => "translate",
        }
    }
}

pub struct Spec {
    pub kind: Kind,
    pub id: &'static str,
    pub label: &'static str,
    /// Download size of the files the engine loads, rounded (what the UI shows before a pull).
    pub approx_bytes: u64,
}

/// Models the engine can run and `POST /engine/models` accepts. Whisper and Qwen are
/// multilingual: one download serves every language, so there is no per-language model.
pub const CATALOG: [Spec; 7] = [
    spec(
        Kind::Asr,
        "openai/whisper-base",
        "Whisper base",
        290_000_000,
    ),
    spec(
        Kind::Asr,
        "openai/whisper-small",
        "Whisper small",
        967_000_000,
    ),
    spec(
        Kind::Asr,
        "openai/whisper-medium",
        "Whisper medium",
        3_060_000_000,
    ),
    spec(
        Kind::Asr,
        "openai/whisper-large-v3-turbo",
        "Whisper large-v3 turbo",
        1_620_000_000,
    ),
    spec(
        Kind::Translate,
        "Qwen/Qwen2.5-0.5B-Instruct",
        "Qwen2.5 0.5B",
        988_000_000,
    ),
    spec(
        Kind::Translate,
        "Qwen/Qwen2.5-1.5B-Instruct",
        "Qwen2.5 1.5B",
        3_090_000_000,
    ),
    spec(
        Kind::Translate,
        "Qwen/Qwen2.5-3B-Instruct",
        "Qwen2.5 3B",
        6_170_000_000,
    ),
];

const fn spec(kind: Kind, id: &'static str, label: &'static str, approx_bytes: u64) -> Spec {
    Spec {
        kind,
        id,
        label,
        approx_bytes,
    }
}

pub fn catalog_spec(id: &str) -> Option<&'static Spec> {
    CATALOG.iter().find(|spec| spec.id == id)
}

/// What the hub cache holds for one model.
#[derive(Debug, PartialEq, Eq)]
pub struct CacheState {
    /// Every file the loader needs is in a snapshot.
    pub downloaded: bool,
    /// Finished blobs, `.incomplete` excluded.
    pub bytes: u64,
    /// `.incomplete` blobs of a download that has not finished.
    pub partial_bytes: u64,
}

/// A snapshot file that exists (a dangling link does not count).
fn snapshot_file(snapshots: &[PathBuf], name: &str) -> Option<PathBuf> {
    snapshots
        .iter()
        .map(|dir| dir.join(name))
        .find(|path| fs::metadata(path).is_ok_and(|meta| meta.is_file()))
}

fn shard_names(index: &Path) -> Option<Vec<String>> {
    let index: Value = serde_json::from_slice(&fs::read(index).ok()?).ok()?;
    let mut names: Vec<String> = index["weight_map"]
        .as_object()?
        .values()
        .filter_map(|name| name.as_str().map(str::to_string))
        .collect();
    names.sort();
    names.dedup();
    Some(names)
}

/// `<cache>/models--org--name`, the folder hf-hub keeps one repo in.
pub fn model_root(cache: &Path, repo_id: &str) -> PathBuf {
    cache.join(format!("models--{}", repo_id.replace('/', "--")))
}

pub fn cache_state(cache: &Path, repo_id: &str, kind: Kind) -> CacheState {
    let root = model_root(cache, repo_id);
    let (mut bytes, mut partial_bytes) = (0, 0);
    for entry in fs::read_dir(root.join("blobs"))
        .into_iter()
        .flatten()
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(meta) = fs::metadata(entry.path()) else {
            continue;
        };
        if name.ends_with(".incomplete") {
            partial_bytes += meta.len();
        } else if meta.is_file() && counted(&name) {
            bytes += meta.len();
        }
    }
    let snapshots: Vec<PathBuf> = fs::read_dir(root.join("snapshots"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    let have = |name: &str| snapshot_file(&snapshots, name).is_some();
    let weights = match kind {
        Kind::Asr => have("model.safetensors"),
        // Sharded repos (Qwen 1.5B and up) name their shards in the index.
        Kind::Translate => match snapshot_file(&snapshots, "model.safetensors.index.json") {
            Some(index) => shard_names(&index).is_some_and(|names| names.iter().all(|n| have(n))),
            None => have("model.safetensors"),
        },
    };
    CacheState {
        downloaded: weights && have("config.json") && have("tokenizer.json"),
        bytes,
        partial_bytes,
    }
}

/// Byte progress of one running download. Fed by hf-hub's progress events, which
/// arrive on its runtime thread, so every field is atomic and nothing blocks.
#[derive(Default)]
pub struct PullProgress {
    /// Sizes of the files finished so far.
    finished: AtomicU64,
    /// Bytes of the file in flight, and its size once the hub reported it.
    current: AtomicU64,
    current_total: AtomicU64,
}

impl PullProgress {
    pub fn bytes_done(&self) -> u64 {
        self.finished.load(Ordering::Relaxed) + self.current.load(Ordering::Relaxed)
    }

    pub fn file_finished(&self, path: &Path) {
        let size = fs::metadata(path).map_or(0, |meta| meta.len());
        self.finished.fetch_add(size, Ordering::Relaxed);
        self.current.store(0, Ordering::Relaxed);
        self.current_total.store(0, Ordering::Relaxed);
    }

    /// Size of the file in flight; 0 between files.
    pub fn current_total(&self) -> u64 {
        self.current_total.load(Ordering::Relaxed)
    }
}

impl ProgressHandler for PullProgress {
    fn on_progress(&self, event: &ProgressEvent) {
        let ProgressEvent::Download(event) = event else {
            return;
        };
        let reached = match event {
            DownloadEvent::Start { total_bytes, .. } => {
                self.current_total.store(*total_bytes, Ordering::Relaxed);
                return;
            }
            DownloadEvent::AggregateProgress {
                bytes_completed, ..
            } => *bytes_completed,
            // One file at a time, so the largest figure reported is this file's.
            DownloadEvent::Progress { files } => {
                files.iter().map(|f| f.bytes_completed).max().unwrap_or(0)
            }
            DownloadEvent::Complete => return,
        };
        self.current.fetch_max(reached, Ordering::Relaxed);
    }
}

/// Download exactly the files the loader for `kind` reads (not the whole repo).
pub fn pull(
    cache: &Path,
    repo_id: &str,
    kind: Kind,
    progress: &Arc<PullProgress>,
) -> anyhow::Result<()> {
    let handler: Progress = (Arc::clone(progress) as Arc<dyn ProgressHandler>).into();
    let mut finished = |path: &Path| progress.file_finished(path);
    match kind {
        Kind::Asr => {
            crate::whisper::fetch_files(cache, repo_id, Some(&handler), &mut finished)?;
        }
        Kind::Translate => {
            crate::translate::fetch_files(cache, repo_id, Some(&handler), &mut finished)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hf_hub::progress::{FileProgress, FileStatus};

    fn event(event: DownloadEvent) -> ProgressEvent {
        ProgressEvent::Download(event)
    }

    #[test]
    fn progress_follows_the_file_in_flight_and_adds_up_finished_files() {
        let progress = PullProgress::default();
        progress.on_progress(&event(DownloadEvent::Start {
            total_files: 1,
            total_bytes: 1000,
        }));
        assert_eq!(progress.current_total(), 1000);
        progress.on_progress(&event(DownloadEvent::AggregateProgress {
            bytes_completed: 400,
            total_bytes: 1000,
            bytes_per_sec: None,
        }));
        // A late, smaller report must not move the bar back.
        progress.on_progress(&event(DownloadEvent::Progress {
            files: vec![FileProgress {
                filename: "model.safetensors".into(),
                bytes_completed: 300,
                total_bytes: 1000,
                status: FileStatus::InProgress,
            }],
        }));
        assert_eq!(progress.bytes_done(), 400);

        let file = std::env::temp_dir().join(format!("pull-progress-{}", std::process::id()));
        fs::write(&file, vec![0; 1000]).expect("file");
        progress.file_finished(&file);
        let _ = fs::remove_file(&file);
        assert_eq!(progress.bytes_done(), 1000);
        assert_eq!(progress.current_total(), 0);
    }
}
