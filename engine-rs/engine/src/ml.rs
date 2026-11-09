//! Shared ML plumbing: compute device and Hugging Face downloads.

use std::path::PathBuf;

use anyhow::{Context, Result};
use candle_core::Device;
use hf_hub::{split_id, HFClientSync, HFError};

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

fn client() -> Result<HFClientSync> {
    HFClientSync::new().context("hugging face client")
}

/// One file of `repo_id` at `revision` (None = main), via the hub cache.
pub fn hub_file(repo_id: &str, revision: Option<&str>, filename: &str) -> Result<PathBuf> {
    let (owner, name) = split_id(repo_id);
    let repo = client()?.model(owner, name);
    let builder = repo.download_file().filename(filename);
    let path = match revision {
        Some(revision) => builder.revision(revision).send(),
        None => builder.send(),
    };
    path.with_context(|| format!("download {repo_id}/{filename}"))
}

/// True when the Hub answered 404 for the file or revision, as opposed to a
/// network, disk or Xet failure. Callers may try another ref only then.
pub fn is_not_found(err: &anyhow::Error) -> bool {
    matches!(
        err.downcast_ref::<HFError>(),
        Some(HFError::EntryNotFound { .. } | HFError::RevisionNotFound { .. })
    )
}

/// Whole snapshot of `repo_id` into the hub cache (for `/models/pull`).
pub fn hub_snapshot(repo_id: &str) -> Result<PathBuf> {
    let (owner, name) = split_id(repo_id);
    client()?
        .model(owner, name)
        .snapshot_download()
        .send()
        .with_context(|| format!("download {repo_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
