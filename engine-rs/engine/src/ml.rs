//! Shared ML plumbing: compute device and Hugging Face downloads.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use candle_core::Device;
use hf_hub::progress::Progress;
use hf_hub::{split_id, HFClient, HFClientSync, HFError};

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
    wait_for_lock(|| {
        repo.download_file()
            .filename(filename)
            .maybe_revision(revision)
            .maybe_progress(progress.clone())
            .send()
    })
    .with_context(|| format!("download {repo_id}/{filename}"))
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
}
