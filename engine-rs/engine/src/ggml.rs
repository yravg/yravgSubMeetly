//! GGML speech models run by whisper.cpp: quantised Whisper on the GPU through Vulkan
//! (NVIDIA, AMD and Intel alike), or on the CPU when there is none.
//!
//! A catalog id `ggml/whisper-<name>` runs the file `ggml-<name>.bin` of [`GGML_REPO`],
//! kept in that id's own model folder so moving and deleting work per model.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::whisper::{Segment, Task};

/// The Hugging Face repo serving every GGML file.
pub const GGML_REPO: &str = "ggerganov/whisper.cpp";

/// The GGML file catalog id `id` runs, or `None` for a candle model.
pub fn ggml_file(id: &str) -> Option<String> {
    id.strip_prefix("ggml/whisper-")
        .map(|name| format!("ggml-{name}.bin"))
}

/// The hub cache [`GGML_REPO`] is kept in for `id`: inside `id`'s own folder of `cache`.
pub fn hub_dir(cache: &Path, id: &str) -> PathBuf {
    crate::models::model_root(cache, id)
}

/// Download (or find cached) the one file `id` runs.
pub fn fetch(
    cache: &Path,
    id: &str,
    progress: Option<&hf_hub::progress::Progress>,
    finished: &mut dyn FnMut(&Path),
) -> Result<()> {
    let file = ggml_file(id).ok_or_else(|| anyhow::anyhow!("{id} is not a GGML model"))?;
    let path = crate::ml::hub_file_with(
        &hub_dir(cache, id),
        GGML_REPO,
        None,
        &file,
        progress.cloned(),
    )?;
    finished(&path);
    Ok(())
}

#[cfg(feature = "whisper-cpp")]
pub use run::GgmlAsr;

#[cfg(feature = "whisper-cpp")]
mod run {
    use super::*;
    use whisper_rs::{
        FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
    };

    pub struct GgmlAsr {
        state: WhisperState,
        /// The GPU it runs on, `None` on the CPU.
        gpu: Option<String>,
        _ctx: WhisperContext,
    }

    impl GgmlAsr {
        pub fn load(path: &Path, want_gpu: bool) -> Result<Self> {
            if !vulkan_loader() {
                anyhow::bail!("GGML models need vulkan-1.dll, which is missing (reinstall Kasi)");
            }
            whisper_rs::install_logging_hooks();
            let picked = if want_gpu { pick_gpu() } else { None };
            let mut params = WhisperContextParameters::default();
            params.use_gpu = picked.is_some();
            params.flash_attn = picked.is_some();
            params.gpu_device = picked.as_ref().map_or(0, |(index, _)| *index);
            let gpu = picked.map(|(_, name)| name);
            let ctx = WhisperContext::new_with_params(path, params)
                .map_err(|e| anyhow::anyhow!("load {}: {e}", path.display()))?;
            let state = ctx
                .create_state()
                .map_err(|e| anyhow::anyhow!("whisper state: {e}"))?;
            Ok(Self {
                state,
                gpu,
                _ctx: ctx,
            })
        }

        /// The GPU the model runs on, `None` on the CPU.
        pub fn gpu(&self) -> Option<&str> {
            self.gpu.as_deref()
        }

        pub fn transcribe(
            &mut self,
            pcm: &[f32],
            language: Option<&str>,
            task: Task,
        ) -> Result<Vec<Segment>> {
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some(language.unwrap_or("auto")));
            params.set_translate(matches!(task, Task::Translate));
            params.set_no_context(true);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            let threads = std::thread::available_parallelism().map_or(4, |n| n.get().min(8));
            params.set_n_threads(threads as i32);
            self.state
                .full(params, pcm)
                .map_err(|e| anyhow::anyhow!("whisper.cpp: {e}"))?;
            let mut segments = Vec::new();
            for i in 0..self.state.full_n_segments() {
                let Some(seg) = self.state.get_segment(i) else {
                    continue;
                };
                let text = seg
                    .to_str_lossy()
                    .map(|t| t.trim().to_string())
                    .unwrap_or_default();
                if !text.is_empty() {
                    // whisper.cpp counts time in hundredths of a second.
                    segments.push(Segment {
                        start: seg.start_timestamp() as f64 / 100.0,
                        end: seg.end_timestamp() as f64 / 100.0,
                        text,
                    });
                }
            }
            Ok(segments)
        }
    }

    /// The GPU for whisper.cpp as (its `gpu_device` index, name): a discrete one before an
    /// integrated one, `None` without any. Only names are read: `whisper_rs::vulkan::list_devices`
    /// sets up every device's buffers and threw (aborting the engine) on this laptop's pair.
    fn pick_gpu() -> Option<(i32, String)> {
        use whisper_rs::whisper_rs_sys as sys;
        let mut found = Vec::new();
        // SAFETY: indices below ggml's device count; descriptions are NUL-terminated strings it owns.
        unsafe {
            for i in 0..sys::ggml_backend_dev_count() {
                let dev = sys::ggml_backend_dev_get(i);
                let kind = sys::ggml_backend_dev_type(dev);
                let discrete = kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU;
                if discrete || kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU {
                    let name = std::ffi::CStr::from_ptr(sys::ggml_backend_dev_description(dev));
                    found.push((
                        found.len() as i32,
                        discrete,
                        name.to_string_lossy().into_owned(),
                    ));
                }
            }
        }
        found
            .into_iter()
            .max_by_key(|(index, discrete, _)| (*discrete, -index))
            .map(|(index, _, name)| (index, name))
    }

    /// True once a Vulkan loader is in the process. vulkan-1.dll is delay-loaded (build.rs):
    /// without it whisper.cpp's first Vulkan call would end the process, so the system copy
    /// is loaded first, else the one the installer ships in `<exe dir>\vulkan\`.
    #[cfg(all(windows, feature = "vulkan"))]
    fn vulkan_loader() -> bool {
        use std::os::windows::ffi::OsStrExt;
        static FOUND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        extern "system" {
            fn LoadLibraryExW(
                name: *const u16,
                file: *mut std::ffi::c_void,
                flags: u32,
            ) -> *mut std::ffi::c_void;
        }
        const SEARCH_SYSTEM32: u32 = 0x800;
        const ALTERED_SEARCH_PATH: u32 = 0x8;
        let wide = |p: &std::ffi::OsStr| p.encode_wide().chain([0]).collect::<Vec<u16>>();
        *FOUND.get_or_init(|| {
            let system = wide("vulkan-1.dll".as_ref());
            // SAFETY: a NUL-terminated name; the module stays loaded for the life of the process.
            if !unsafe { LoadLibraryExW(system.as_ptr(), std::ptr::null_mut(), SEARCH_SYSTEM32) }
                .is_null()
            {
                return true;
            }
            let Some(shipped) = std::env::current_exe()
                .ok()
                .and_then(|exe| Some(exe.parent()?.join("vulkan").join("vulkan-1.dll")))
            else {
                return false;
            };
            let shipped = wide(shipped.as_os_str());
            // SAFETY: as above, an absolute path.
            !unsafe { LoadLibraryExW(shipped.as_ptr(), std::ptr::null_mut(), ALTERED_SEARCH_PATH) }
                .is_null()
        })
    }

    #[cfg(not(all(windows, feature = "vulkan")))]
    fn vulkan_loader() -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ggml_id_names_its_file_and_a_candle_id_none() {
        assert_eq!(
            ggml_file("ggml/whisper-large-v3-turbo-q5_0").as_deref(),
            Some("ggml-large-v3-turbo-q5_0.bin")
        );
        assert_eq!(
            ggml_file("ggml/whisper-base").as_deref(),
            Some("ggml-base.bin")
        );
        assert_eq!(ggml_file("openai/whisper-base"), None);
    }

    #[test]
    fn a_ggml_model_counts_as_downloaded_from_its_own_folder_only() {
        use crate::models::{cache_state, Kind};
        let cache = std::env::temp_dir().join(format!("sm-ggml-{}", std::process::id()));
        let id = "ggml/whisper-base";
        assert!(!cache_state(&cache, id, Kind::Asr).downloaded);
        let repo = crate::models::model_root(&hub_dir(&cache, id), GGML_REPO);
        std::fs::create_dir_all(repo.join("snapshots/rev1")).unwrap();
        std::fs::create_dir_all(repo.join("refs")).unwrap();
        std::fs::write(repo.join("refs/main"), "rev1").unwrap();
        std::fs::write(repo.join("snapshots/rev1/ggml-base.bin"), b"weights").unwrap();
        assert!(cache_state(&cache, id, Kind::Asr).downloaded);
        // Another GGML model's file is not this one.
        assert!(!cache_state(&cache, "ggml/whisper-medium-q5_0", Kind::Asr).downloaded);
        let _ = std::fs::remove_dir_all(&cache);
    }
}
