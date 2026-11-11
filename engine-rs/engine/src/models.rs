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

/// `path` with every symlink or junction along it replaced by its target, without traversing
/// any of them. Windows Redirection Guard (on for processes Explorer starts on recent builds)
/// refuses to cross a junction a user made (os error 448): `~/.cache/huggingface` moved to
/// another drive with a junction made every download and load fail.
pub fn real_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        out.push(part);
        let mut guard = 0;
        while guard < 16
            && fs::symlink_metadata(&out)
                .is_ok_and(|m| m.file_type().is_symlink() || is_junction(&m))
        {
            let Ok(target) = fs::read_link(&out) else {
                break;
            };
            out = if target.is_absolute() {
                target
            } else {
                out.parent().unwrap_or(Path::new("")).join(target)
            };
            guard += 1;
        }
    }
    out
}

#[cfg(windows)]
fn is_junction(m: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_junction(_: &fs::Metadata) -> bool {
    false
}

/// Point `HF_HOME` at the real folder behind any junction, before any thread starts, so the hub
/// cache and the Xet cache never cross one. Leaves an explicit `HF_HOME` / `HF_HUB_CACHE` alone.
pub fn pin_real_hf_home() {
    if env::var_os("HF_HOME").is_some_and(|v| !v.is_empty())
        || env::var_os("HF_HUB_CACHE").is_some_and(|v| !v.is_empty())
    {
        return;
    }
    let home = home_dir()
        .unwrap_or_default()
        .join(".cache")
        .join("huggingface");
    let real = real_path(&home);
    if real != home {
        env::set_var("HF_HOME", real);
    }
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
    /// An OPUS-MT model for one language pair: used for fast captions of that pair when
    /// downloaded, never chosen as the translation model.
    PairMt,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Asr => "asr",
            Kind::Translate => "translate",
            Kind::PairMt => "translate-pair",
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
pub const CATALOG: [Spec; 14] = [
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
    // q4_k_m GGUF: one file each, quantized for CPU speed.
    spec(
        Kind::Translate,
        "unsloth/Qwen3-0.6B-GGUF",
        "Qwen3 0.6B (fast)",
        397_000_000,
    ),
    spec(
        Kind::Translate,
        "unsloth/Qwen3-1.7B-GGUF",
        "Qwen3 1.7B (balanced)",
        1_110_000_000,
    ),
    // OPUS-MT per pair (the pairs of `marian::PAIRS`); other pairs use the LLM.
    spec(
        Kind::PairMt,
        "Helsinki-NLP/opus-mt-en-id",
        "OPUS-MT English to Indonesian",
        291_000_000,
    ),
    spec(
        Kind::PairMt,
        "Helsinki-NLP/opus-mt-id-en",
        "OPUS-MT Indonesian to English",
        291_000_000,
    ),
    spec(
        Kind::PairMt,
        "Helsinki-NLP/opus-mt-en-zh",
        "OPUS-MT English to Chinese",
        312_000_000,
    ),
    spec(
        Kind::PairMt,
        "Helsinki-NLP/opus-mt-zh-en",
        "OPUS-MT Chinese to English",
        312_000_000,
    ),
    spec(
        Kind::PairMt,
        "Helsinki-NLP/opus-mt-ja-en",
        "OPUS-MT Japanese to English",
        303_000_000,
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

/// A route needs a model that is not (fully) downloaded. Only `POST /models/pull` downloads.
#[derive(Debug)]
pub struct ModelNotDownloaded {
    pub id: String,
    pub kind: Kind,
}

impl std::fmt::Display for ModelNotDownloaded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let what = match self.kind {
            Kind::Asr => "speech",
            Kind::Translate | Kind::PairMt => "translation",
        };
        write!(f, "{what} model not downloaded")
    }
}

impl std::error::Error for ModelNotDownloaded {}

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
    let gguf = crate::translate::gguf_file(repo_id).filter(|_| kind == Kind::Translate);
    let downloaded = match kind {
        // A GGUF carries its config and tokenizer inside.
        _ if gguf.is_some() => gguf.is_some_and(|file| have(&file)),
        Kind::PairMt => crate::marian::FILES.iter().all(|n| have(n)),
        Kind::Asr => have("model.safetensors") && have("config.json") && have("tokenizer.json"),
        // Sharded repos (Qwen 1.5B and up) name their shards in the index.
        Kind::Translate => {
            let weights = match snapshot_file(&snapshots, "model.safetensors.index.json") {
                Some(index) => {
                    shard_names(&index).is_some_and(|names| names.iter().all(|n| have(n)))
                }
                None => have("model.safetensors"),
            };
            weights && have("config.json") && have("tokenizer.json")
        }
    };
    CacheState {
        downloaded,
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
            crate::translate::fetch_any(cache, repo_id, Some(&handler), &mut finished)?;
        }
        Kind::PairMt => {
            crate::marian::fetch_files(cache, repo_id, Some(&handler), &mut finished)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_plain_path_stays_as_it_is_and_a_linked_folder_becomes_its_target() {
        let dir = std::env::temp_dir().join(format!("sm-real-path-{}", std::process::id()));
        let target = dir.join("target");
        fs::create_dir_all(target.join("hub")).unwrap();
        assert_eq!(real_path(&target.join("hub")), target.join("hub"));
        let link = dir.join("link");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&target, &link).is_ok();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&target, &link).is_ok(); // needs Developer Mode
        if made {
            assert_eq!(real_path(&link.join("hub")), target.join("hub"));
        }
        let _ = fs::remove_dir_all(&dir);
    }

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

    /// A GGUF repo is complete with its one q4_k_m file; no config.json or tokenizer.json.
    #[test]
    fn gguf_repo_is_downloaded_with_its_one_file() {
        let cache = std::env::temp_dir().join(format!("gguf-state-{}", std::process::id()));
        let id = "unsloth/Qwen3-0.6B-GGUF";
        let snap = model_root(&cache, id).join("snapshots/abc");
        fs::create_dir_all(&snap).expect("snapshot");
        assert!(!cache_state(&cache, id, Kind::Translate).downloaded);
        fs::write(snap.join("Qwen3-0.6B-Q8_0.gguf"), b"x").expect("other quant");
        assert!(!cache_state(&cache, id, Kind::Translate).downloaded);
        fs::write(snap.join("Qwen3-0.6B-Q4_K_M.gguf"), b"x").expect("gguf");
        assert!(cache_state(&cache, id, Kind::Translate).downloaded);
        let _ = fs::remove_dir_all(&cache);
    }

    /// An OPUS-MT pair needs its config, source pieces, vocab and weights.
    #[test]
    fn opus_mt_pair_is_downloaded_with_all_its_files() {
        let cache = std::env::temp_dir().join(format!("pair-state-{}", std::process::id()));
        let id = "Helsinki-NLP/opus-mt-en-id";
        let snap = model_root(&cache, id).join("snapshots/abc");
        fs::create_dir_all(&snap).expect("snapshot");
        for name in &crate::marian::FILES[..3] {
            fs::write(snap.join(name), b"x").expect("file");
        }
        assert!(!cache_state(&cache, id, Kind::PairMt).downloaded);
        // The weights come from another revision (the safetensors PR): any snapshot counts.
        let pr = model_root(&cache, id).join("snapshots/def");
        fs::create_dir_all(&pr).expect("pr snapshot");
        fs::write(pr.join("model.safetensors"), b"x").expect("weights");
        assert!(cache_state(&cache, id, Kind::PairMt).downloaded);
        let _ = fs::remove_dir_all(&cache);
    }

    /// Every OPUS-MT pair the engine routes to has a catalog row a client can pull.
    #[test]
    fn every_opus_mt_pair_is_in_the_catalog() {
        for (src, tgt, repo, _) in crate::marian::PAIRS {
            let spec = catalog_spec(repo).unwrap_or_else(|| panic!("{src}-{tgt} missing"));
            assert_eq!(spec.kind, Kind::PairMt);
        }
    }
}
