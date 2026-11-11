//! Shared ML plumbing: compute device and Hugging Face downloads.

use std::cell::Cell;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use candle_core::Device;
use hf_hub::progress::{DownloadEvent, Progress, ProgressEvent};
use hf_hub::{split_id, HFClient, HFClientSync, HFError};

/// Where a download that misses the cache comes from. ModelScope (modelscope.cn) mirrors
/// most of the catalog and answers where huggingface.co is blocked or slow.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Source {
    #[default]
    HuggingFace,
    ModelScope,
}

impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "huggingface" => Some(Self::HuggingFace),
            "modelscope" => Some(Self::ModelScope),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::HuggingFace => "Hugging Face",
            Self::ModelScope => "ModelScope",
        }
    }
}

thread_local! {
    // Per thread, so two pulls from different sources never mix; loads use Hugging Face.
    static SOURCE: Cell<Source> = const { Cell::new(Source::HuggingFace) };
}

/// Run `f` with downloads on this thread coming from `source`.
pub fn with_source<T>(source: Source, f: impl FnOnce() -> T) -> T {
    let before = SOURCE.replace(source);
    let out = f();
    SOURCE.set(before);
    out
}

/// Device the build can use: CUDA/Metal when compiled in and present, else CPU.
pub fn pick_device(want_gpu: bool) -> Device {
    if want_gpu {
        #[cfg(feature = "cuda")]
        if let Ok(device) = Device::new_cuda(0) {
            return device;
        }
        #[cfg(feature = "metal")]
        if let Ok(device) = Device::new_metal(0) {
            return device;
        }
    }
    Device::Cpu
}

pub fn device_name(device: &Device) -> &'static str {
    match device {
        Device::Cpu => "cpu",
        Device::Cuda(_) => "cuda",
        Device::Metal(_) => "metal",
    }
}

/// True when this build has a GPU backend and a device answers.
pub fn gpu_available() -> bool {
    !matches!(pick_device(true), Device::Cpu)
}

/// The cache is always passed in (the model's folder, `Locations::usable_dir`).
/// hf-hub resolves `$HOME` alone and falls back to `/tmp` (so `C:\tmp` on Windows),
/// and an app started from Explorer has no `HOME`: downloads would land where
/// nothing looks and the model would never show as downloaded.
fn async_client(cache: &Path) -> Result<HFClient> {
    HFClient::builder()
        .cache_dir(cache)
        .build()
        .context("hugging face client")
}

fn client(cache: &Path) -> Result<HFClientSync> {
    HFClientSync::from_inner(async_client(cache)?).context("hugging face client")
}

/// hf-hub waits only 10 s for another downloader of the same blob (a second
/// request, a second engine, the `hf` CLI) and then fails with `CacheLockTimeout`.
/// Keep waiting instead: once they finish, the file is cached and the retry returns it.
/// shortcut: gives up after ~1 h of waiting, raise if models outgrow a slow link.
const LOCK_WAITS: u32 = 360;

fn wait_for_lock<T>(mut attempt: impl FnMut() -> Result<T, HFError>) -> Result<T, HFError> {
    let mut waits = 0;
    loop {
        match attempt() {
            Err(HFError::CacheLockTimeout { .. }) if waits < LOCK_WAITS => waits += 1,
            other => return other,
        }
    }
}

/// One file of `repo_id` at `revision` (None = main), via the default hub cache.
pub fn hub_file(repo_id: &str, revision: Option<&str>, filename: &str) -> Result<PathBuf> {
    hub_file_with(
        &crate::models::hub_cache_dir(),
        repo_id,
        revision,
        filename,
        None,
    )
}

/// [`hub_file`] in `cache`, reporting byte progress to `progress` (must not block).
pub fn hub_file_with(
    cache: &Path,
    repo_id: &str,
    revision: Option<&str>,
    filename: &str,
    progress: Option<Progress>,
) -> Result<PathBuf> {
    let by_hand = crate::models::manual_dir(repo_id).join(filename);
    if by_hand.is_file() {
        return Ok(by_hand);
    }
    let (owner, name) = split_id(repo_id);
    // A chosen folder behind a junction fails the same way as the default (os error 448).
    let cache = &crate::models::real_path(cache);
    let repo = client(cache)?.model(owner, name);
    // Cached files never ask the Hub: a `main` lookup costs a round trip on every model
    // load and hangs on a dead link. shortcut: a newer upstream commit is not picked up;
    // delete the cached model to update it.
    let cached = repo
        .download_file()
        .filename(filename)
        .maybe_revision(revision)
        .local_files_only(true)
        .send();
    match cached {
        // A recorded 404 (`.no_exist`) is as good as asking again.
        Ok(_) | Err(HFError::EntryNotFound { .. }) => {
            return cached.with_context(|| format!("download {repo_id}/{filename}"))
        }
        Err(_) => {}
    }
    if SOURCE.get() == Source::ModelScope {
        return modelscope_file(cache, repo_id, revision, filename, progress.as_ref());
    }
    wait_for_lock(|| {
        repo.download_file()
            .filename(filename)
            .maybe_revision(revision)
            .maybe_progress(progress.clone())
            .send()
    })
    .with_context(|| format!("download {repo_id}/{filename}"))
}

/// ModelScope names Whisper `openai-mirror/…`; the other catalog repos keep their id.
fn modelscope_id(repo_id: &str) -> String {
    match repo_id.strip_prefix("openai/") {
        Some(name) => format!("openai-mirror/{name}"),
        None => repo_id.to_string(),
    }
}

/// The commit every ModelScope file is filed under (ModelScope sends no commit hash).
const MODELSCOPE_COMMIT: &str = "6d6f64656c73636f706500000000000000000000";

/// One file from ModelScope, written in the hub cache layout (blob, snapshot, ref) so the
/// loaders, `cache_state` and Delete treat it as any other download.
fn modelscope_file(
    cache: &Path,
    repo_id: &str,
    revision: Option<&str>,
    filename: &str,
    progress: Option<&Progress>,
) -> Result<PathBuf> {
    let url = format!(
        "https://www.modelscope.cn/models/{}/resolve/master/{filename}",
        modelscope_id(repo_id)
    );
    // shortcut: no timeout while the body streams (a big file takes minutes); a stalled
    // link hangs this pull until the engine restarts. Add a per-read timeout if seen.
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .user_agent("yravgSubMeetly-engine")
        .build()
        .into();
    let mut reply = agent.get(&url).call().map_err(|e| match e {
        ureq::Error::StatusCode(404) => {
            anyhow!("{filename} of {repo_id} is not on ModelScope; download it from Hugging Face")
        }
        ureq::Error::StatusCode(code) => anyhow!("ModelScope answered {code} for {filename}"),
        e => anyhow!("ModelScope did not answer: {e}"),
    })?;
    let total = reply.body().content_length().unwrap_or(0);
    let report = |done: u64| {
        if let Some(p) = progress {
            p.on_progress(&ProgressEvent::Download(DownloadEvent::AggregateProgress {
                bytes_completed: done,
                total_bytes: total,
                bytes_per_sec: None,
            }));
        }
    };
    if let Some(p) = progress {
        p.on_progress(&ProgressEvent::Download(DownloadEvent::Start {
            total_files: 1,
            total_bytes: total,
        }));
    }
    let root = crate::models::model_root(cache, repo_id);
    let blobs = root.join("blobs");
    fs::create_dir_all(&blobs).with_context(|| format!("create {}", blobs.display()))?;
    let flat = filename.replace(['/', '\\'], "--");
    let blob = blobs.join(format!("ms-{flat}"));
    let part = blobs.join(format!("ms-{flat}.incomplete"));
    let mut out = fs::File::create(&part).with_context(|| format!("create {}", part.display()))?;
    let mut body = reply.body_mut().as_reader();
    let (mut buf, mut done) = (vec![0u8; 1 << 20], 0u64);
    loop {
        let n = body
            .read(&mut buf)
            .with_context(|| format!("ModelScope stopped sending {filename} at {done} bytes"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])
            .with_context(|| format!("write {}", part.display()))?;
        done += n as u64;
        report(done);
    }
    drop(out);
    if total > 0 && done != total {
        return Err(anyhow!(
            "ModelScope sent {done} of {total} bytes of {filename}"
        ));
    }
    fs::rename(&part, &blob).with_context(|| format!("finish {}", blob.display()))?;
    let snap = root
        .join("snapshots")
        .join(MODELSCOPE_COMMIT)
        .join(filename);
    if let Some(dir) = snap.parent() {
        fs::create_dir_all(dir)?;
    }
    let _ = fs::remove_file(&snap);
    // A hard link keeps the bytes once (`cache_state` counts blobs); a copy where it cannot.
    if fs::hard_link(&blob, &snap).is_err() {
        fs::copy(&blob, &snap).with_context(|| format!("copy to {}", snap.display()))?;
    }
    let refs = root.join("refs").join(revision.unwrap_or("main"));
    if let Some(dir) = refs.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&refs, MODELSCOPE_COMMIT)?;
    Ok(snap)
}

/// True when the Hub answered 404 for the file or revision, as opposed to a
/// network, disk or Xet failure. Callers may try another ref only then.
pub fn is_not_found(err: &anyhow::Error) -> bool {
    matches!(
        err.downcast_ref::<HFError>(),
        Some(HFError::EntryNotFound { .. } | HFError::RevisionNotFound { .. })
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloads_go_to_the_folder_they_are_given() {
        let dir = std::env::temp_dir().join("ml-cache-pin");
        assert_eq!(async_client(&dir).unwrap().cache_dir(), dir);
    }

    /// A file already in the cache loads without asking the Hub (a slow or dead link
    /// must not hold up a model load). The repo does not exist on the Hub at all.
    #[test]
    fn a_cached_file_is_returned_without_the_network() {
        let cache = std::env::temp_dir().join(format!("ml-cached-{}", std::process::id()));
        let root = cache.join("models--nobody--not-a-real-repo-7f3a");
        let sha = "0123456789abcdef0123456789abcdef01234567";
        std::fs::create_dir_all(root.join("refs")).unwrap();
        std::fs::create_dir_all(root.join("snapshots").join(sha)).unwrap();
        std::fs::write(root.join("refs/main"), sha).unwrap();
        let file = root.join("snapshots").join(sha).join("config.json");
        std::fs::write(&file, "{}").unwrap();
        // hf-hub records a 404 as an empty `.no_exist` file: a 404 again, no request.
        let no_exist = root.join(".no_exist").join(sha);
        std::fs::create_dir_all(&no_exist).unwrap();
        std::fs::write(no_exist.join("model.safetensors.index.json"), "").unwrap();
        let repo = "nobody/not-a-real-repo-7f3a";
        let got = hub_file_with(&cache, repo, None, "config.json", None);
        let index = hub_file_with(&cache, repo, None, "model.safetensors.index.json", None);
        let _ = std::fs::remove_dir_all(&cache);
        assert_eq!(got.expect("cached"), file);
        assert!(is_not_found(&index.expect_err("recorded 404")));
    }

    #[test]
    fn only_hub_404_counts_as_not_found() {
        let missing = anyhow::Error::new(HFError::EntryNotFound {
            path: "model.safetensors".into(),
            repo_id: "openai/whisper-base".into(),
            context: None,
        })
        .context("download openai/whisper-base/model.safetensors");
        assert!(is_not_found(&missing));
        assert!(!is_not_found(&anyhow::anyhow!("connection reset")));
    }

    fn locked() -> HFError {
        HFError::CacheLockTimeout {
            path: "blob.lock".into(),
        }
    }

    #[test]
    fn lock_timeouts_are_waited_out() {
        let mut calls = 0;
        let got = wait_for_lock(|| {
            calls += 1;
            if calls < 4 {
                Err(locked())
            } else {
                Ok(calls)
            }
        });
        assert_eq!(got.unwrap(), 4);
    }

    #[test]
    fn lock_wait_is_bounded_and_other_errors_pass_straight_through() {
        let mut calls = 0;
        let forever: Result<(), _> = wait_for_lock(|| {
            calls += 1;
            Err(locked())
        });
        assert!(matches!(forever, Err(HFError::CacheLockTimeout { .. })));
        assert_eq!(calls, LOCK_WAITS + 1);

        let mut calls = 0;
        let other: Result<(), _> = wait_for_lock(|| {
            calls += 1;
            Err(HFError::CacheNotEnabled)
        });
        assert!(matches!(other, Err(HFError::CacheNotEnabled)));
        assert_eq!(calls, 1);
    }

    #[test]
    fn whisper_has_its_own_name_on_modelscope() {
        assert_eq!(
            modelscope_id("openai/whisper-base"),
            "openai-mirror/whisper-base"
        );
        assert_eq!(
            modelscope_id("unsloth/Qwen3-0.6B-GGUF"),
            "unsloth/Qwen3-0.6B-GGUF"
        );
        assert_eq!(Source::parse("modelscope"), Some(Source::ModelScope));
        assert_eq!(Source::parse("hf-mirror"), None);
    }

    /// Live: a ModelScope file lands in the hub layout, so a later Hugging Face lookup
    /// finds it in the cache without the network. Run with `--ignored`.
    #[test]
    #[ignore = "downloads from modelscope.cn"]
    fn a_modelscope_file_is_found_again_from_the_cache() {
        let dir = std::env::temp_dir().join(format!("ms-cache-{}", std::process::id()));
        let repo = "Helsinki-NLP/opus-mt-en-id";
        let got = with_source(Source::ModelScope, || {
            hub_file_with(&dir, repo, None, "config.json", None)
        })
        .unwrap();
        assert!(fs::read_to_string(&got).unwrap().contains("Marian"));
        let again = hub_file_with(&dir, repo, None, "config.json", None).unwrap();
        assert_eq!(again, got);
        let state = crate::models::cache_state(&dir, repo, crate::models::Kind::PairMt);
        assert!(state.bytes > 0 && state.partial_bytes == 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
