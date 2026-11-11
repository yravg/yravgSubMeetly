//! ML state behind the HTTP routes: lazily loaded Whisper and Qwen models,
//! the file pipelines (one-shot and windowed) and the background job table.

use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

use anyhow::{anyhow, Result};
use candle_core::Device;
use serde_json::{json, Value};

use crate::audio::{self, MonoStream, Windows, SAMPLE_RATE};
use crate::locations::Locations;
use crate::marian::{pair_repo, MarianMt};
use crate::models::{cache_state, catalog_spec, Kind, ModelNotDownloaded, CATALOG};
use crate::translate::{Translator, DEFAULT_TRANSLATE_MODEL};
use crate::whisper::DEFAULT_ASR_MODEL;
use crate::whisper::{repo_for, Segment, Task, WhisperAsr};

pub const ASR_ENGINE: &str = "candle-whisper";
pub const MT_ENGINE: &str = "candle-qwen2";
/// The label of a q4_k_m GGUF translation model (the Qwen3 rows), which runs on candle's quantized path.
pub const MT_ENGINE_GGUF: &str = "candle-qwen3-gguf";

/// What `/models` calls the engine that runs translation model `id`.
pub fn mt_engine(id: &str) -> &'static str {
    if crate::translate::gguf_file(id).is_some() {
        MT_ENGINE_GGUF
    } else {
        MT_ENGINE
    }
}

fn env_f64(key: &str, fallback: f64) -> f64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

pub struct Ml {
    asr_model: RwLock<String>,
    translate_model: RwLock<Option<String>>,
    /// Nobody chose the translation model: it is the default, which gives way to one already on disk.
    translate_default: AtomicBool,
    /// Env vars win over the saved choice, so `POST /engine/models` cannot move these.
    asr_from_env: bool,
    translate_from_env: bool,
    pub device: Device,
    /// Where each model is stored; a loader asks it for the folder.
    locations: Arc<Locations>,
    /// The loaded model and the id it was loaded for; a changed choice reloads on next use.
    asr: Mutex<Option<(String, WhisperAsr)>>,
    mt: Mutex<Option<(String, Translator)>>,
    /// The OPUS-MT pair model last used by `translate_fast` (one at a time).
    pair: Mutex<Option<(String, MarianMt)>>,
    asr_loaded_id: RwLock<Option<String>>,
    mt_loaded_id: RwLock<Option<String>>,
    asr_loading: AtomicBool,
    mt_loading: AtomicBool,
    pub stream_chunk_sec: f64,
    pub stream_overlap_sec: f64,
    pub stream_min_bytes: u64,
}

/// The saved `engine-models.json` choice: an id, or `"off"` for translation.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct SavedModels {
    pub asr: Option<String>,
    pub translate: Option<String>,
}

/// Which model each kind starts with: env, then the saved choice, then the default.
#[derive(Debug, PartialEq, Eq)]
struct Picked {
    asr: String,
    asr_from_env: bool,
    translate: Option<String>,
    translate_from_env: bool,
    /// Nobody chose: the default, which may give way to a model already on disk.
    translate_default: bool,
}

/// The translation model to run when the default is not downloaded and nobody chose one:
/// the first downloaded catalog model, so an install made under an older default keeps
/// translating until the new default is pulled.
fn fallback_translate(downloaded: &dyn Fn(&str) -> bool) -> Option<&'static str> {
    CATALOG
        .iter()
        .filter(|spec| spec.kind == Kind::Translate && spec.id != DEFAULT_TRANSLATE_MODEL)
        .map(|spec| spec.id)
        .find(|id| downloaded(id))
}

/// The translation model to run now. A model somebody chose (`is_default` false) runs as chosen,
/// downloaded or not. The default nobody chose runs when it is on disk; until then an install made
/// under an older default keeps translating with a model it already has (`fallback_translate`),
/// and with none the default stays so the caption says "missing" and the picker offers the pull.
fn resolve_translate(
    chosen: Option<&str>,
    is_default: bool,
    downloaded: &dyn Fn(&str) -> bool,
) -> Option<String> {
    let chosen = chosen?;
    if is_default && chosen == DEFAULT_TRANSLATE_MODEL && !downloaded(chosen) {
        if let Some(id) = fallback_translate(downloaded) {
            return Some(id.to_string());
        }
    }
    Some(chosen.to_string())
}

fn pick_models(env: &dyn Fn(&str) -> Option<String>, saved: &SavedModels) -> Picked {
    // A saved id the catalog no longer lists (hand-edited file) is ignored.
    let saved_id = |value: &Option<String>, kind: Kind| {
        value
            .clone()
            .filter(|id| catalog_spec(id).is_some_and(|spec| spec.kind == kind))
    };
    let (asr, asr_from_env) = match env("WHISPER_MODEL") {
        Some(model) => (repo_for(&model), true),
        None => (
            saved_id(&saved.asr, Kind::Asr).unwrap_or_else(|| repo_for(DEFAULT_ASR_MODEL)),
            false,
        ),
    };
    let (translate, translate_from_env) = if env("TRANSLATE").as_deref() == Some("off") {
        (None, true)
    } else if let Some(model) = env("TRANSLATE_MODEL") {
        (Some(model), true)
    } else if saved.translate.as_deref() == Some("off") {
        (None, false)
    } else {
        let id = saved_id(&saved.translate, Kind::Translate)
            .unwrap_or_else(|| DEFAULT_TRANSLATE_MODEL.to_string());
        (Some(id), false)
    };
    let translate_default = !translate_from_env
        && saved.translate.as_deref() != Some("off")
        && saved_id(&saved.translate, Kind::Translate).is_none();
    Picked {
        asr,
        asr_from_env,
        translate,
        translate_from_env,
        translate_default,
    }
}

/// Env `DEVICE` wins over the saved preference; only `cpu` turns the GPU off.
fn wants_gpu(env_device: Option<&str>, pref: &str) -> bool {
    env_device.unwrap_or(pref) != "cpu"
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn read<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poison| poison.into_inner())
}

fn write<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|poison| poison.into_inner())
}

impl Ml {
    /// `device_pref` is the saved auto/cpu/cuda choice; env `DEVICE` wins, like the oracle.
    /// `saved` is the models chosen through `POST /engine/models`.
    pub fn from_env(device_pref: &str, saved: &SavedModels, locations: Arc<Locations>) -> Self {
        let picked = pick_models(&|key| env::var(key).ok(), saved);
        let device =
            crate::ml::pick_device(wants_gpu(env::var("DEVICE").ok().as_deref(), device_pref));
        Self {
            asr_model: RwLock::new(picked.asr),
            translate_model: RwLock::new(picked.translate),
            translate_default: AtomicBool::new(picked.translate_default),
            asr_from_env: picked.asr_from_env,
            translate_from_env: picked.translate_from_env,
            device,
            locations,
            asr: Mutex::new(None),
            mt: Mutex::new(None),
            pair: Mutex::new(None),
            asr_loaded_id: RwLock::new(None),
            mt_loaded_id: RwLock::new(None),
            asr_loading: AtomicBool::new(false),
            mt_loading: AtomicBool::new(false),
            stream_chunk_sec: env_f64("STREAM_CHUNK_SEC", 300.0),
            stream_overlap_sec: env_f64("STREAM_OVERLAP_SEC", 2.0),
            stream_min_bytes: env_f64("STREAM_MIN_BYTES", 512.0 * 1024.0 * 1024.0) as u64,
        }
    }

    pub fn device_name(&self) -> &'static str {
        crate::ml::device_name(&self.device)
    }

    pub fn asr_id(&self) -> String {
        read(&self.asr_model).clone()
    }

    /// The translation model that runs now (see `resolve_translate`); `None` = off.
    pub fn translate_id(&self) -> Option<String> {
        let chosen = read(&self.translate_model).clone();
        resolve_translate(
            chosen.as_deref(),
            self.translate_default.load(Ordering::Relaxed),
            &|id| self.downloaded_dir(id, Kind::Translate).is_ok(),
        )
    }

    /// The recommended translation model and whether it is on disk, so a picker can offer its download.
    pub fn translate_recommended(&self) -> (&'static str, bool) {
        let downloaded = self
            .downloaded_dir(DEFAULT_TRANSLATE_MODEL, Kind::Translate)
            .is_ok();
        (DEFAULT_TRANSLATE_MODEL, downloaded)
    }

    pub fn asr_from_env(&self) -> bool {
        self.asr_from_env
    }

    pub fn translate_from_env(&self) -> bool {
        self.translate_from_env
    }

    /// Switch the speech model; the old one is dropped on next use. False when env pins it.
    pub fn set_asr(&self, id: &str) -> bool {
        if self.asr_from_env {
            return false;
        }
        *write(&self.asr_model) = id.to_string();
        true
    }

    /// Switch the translation model (`None` = off). False when env pins it.
    pub fn set_translate(&self, id: Option<&str>) -> bool {
        if self.translate_from_env {
            return false;
        }
        *write(&self.translate_model) = id.map(str::to_string);
        // A choice, even of the default itself, is somebody's: it is no longer swapped for another.
        self.translate_default.store(false, Ordering::Relaxed);
        true
    }

    pub fn asr_loaded(&self) -> bool {
        *read(&self.asr_loaded_id) == Some(self.asr_id())
    }

    pub fn translate_loaded(&self) -> bool {
        let loaded = read(&self.mt_loaded_id);
        loaded.is_some() && *loaded == self.translate_id()
    }

    /// True while the model is being fetched and read into memory.
    pub fn asr_loading(&self) -> bool {
        self.asr_loading.load(Ordering::Relaxed)
    }

    pub fn translate_loading(&self) -> bool {
        self.mt_loading.load(Ordering::Relaxed)
    }

    pub fn translate_available(&self) -> bool {
        read(&self.translate_model).is_some()
    }

    /// The folder holding a fully downloaded `id`. A loader never fetches: a model that is
    /// not on disk (or whose folder is away) is an error the route reports at once.
    fn downloaded_dir(&self, id: &str, kind: Kind) -> Result<std::path::PathBuf> {
        let cache = self.locations.usable_dir(id)?;
        if !cache_state(&cache, id, kind).downloaded {
            return Err(ModelNotDownloaded {
                id: id.to_string(),
                kind,
            }
            .into());
        }
        Ok(cache)
    }

    /// Fails with `ModelNotDownloaded` / `ModelDirUnavailable` unless the speech model is ready to load.
    pub fn require_asr(&self) -> Result<()> {
        self.downloaded_dir(&self.asr_id(), Kind::Asr).map(drop)
    }

    pub fn require_translate(&self) -> Result<()> {
        let id = self
            .translate_id()
            .ok_or_else(|| anyhow!("translation is off"))?;
        self.downloaded_dir(&id, Kind::Translate).map(drop)
    }

    /// True when the translation model is on disk (its folder present) and the choice is on.
    pub fn translate_downloaded(&self) -> bool {
        self.translate_id()
            .is_some_and(|id| self.downloaded_dir(&id, Kind::Translate).is_ok())
    }

    pub fn with_asr<R>(&self, f: impl FnOnce(&mut WhisperAsr) -> Result<R>) -> Result<R> {
        let want = self.asr_id();
        let mut guard = lock(&self.asr);
        if guard.as_ref().map(|(id, _)| id) != Some(&want) {
            // Free the old weights first: two Whisper models at once is gigabytes.
            *guard = None;
            *write(&self.asr_loaded_id) = None;
            // Not on disk, or its folder is away: say so. Only POST /models/pull downloads.
            let cache = self.downloaded_dir(&want, Kind::Asr)?;
            eprintln!("[asr] loading {want} ...");
            self.asr_loading.store(true, Ordering::Relaxed);
            let loaded = WhisperAsr::load(&want, self.device.clone(), &cache);
            self.asr_loading.store(false, Ordering::Relaxed);
            *guard = Some((want.clone(), loaded?));
            *write(&self.asr_loaded_id) = Some(want);
        }
        f(&mut guard.as_mut().expect("loaded above").1)
    }

    pub fn with_translator<R>(&self, f: impl FnOnce(&mut Translator) -> Result<R>) -> Result<R> {
        let want = self
            .translate_id()
            .ok_or_else(|| anyhow!("translation is off"))?;
        let mut guard = lock(&self.mt);
        if guard.as_ref().map(|(id, _)| id) != Some(&want) {
            *guard = None;
            *write(&self.mt_loaded_id) = None;
            let cache = self.downloaded_dir(&want, Kind::Translate)?;
            eprintln!("[translate] loading {want} ...");
            self.mt_loading.store(true, Ordering::Relaxed);
            let loaded = Translator::load(&want, self.device.clone(), &cache);
            self.mt_loading.store(false, Ordering::Relaxed);
            *guard = Some((want.clone(), loaded?));
            *write(&self.mt_loaded_id) = Some(want);
        }
        f(&mut guard.as_mut().expect("loaded above").1)
    }

    /// A fresh copy of a downloaded speech model for the speed test (`bench.rs`), separate from the
    /// one the engine keeps loaded: the test never swaps the model a caption session is using.
    pub fn load_for_bench_asr(&self, id: &str) -> Result<WhisperAsr> {
        let cache = self.downloaded_dir(id, Kind::Asr)?;
        WhisperAsr::load(id, self.device.clone(), &cache)
    }

    /// Same for a translation LLM.
    pub fn load_for_bench_translator(&self, id: &str) -> Result<Translator> {
        let cache = self.downloaded_dir(id, Kind::Translate)?;
        Translator::load(id, self.device.clone(), &cache)
    }

    /// Same for an OPUS-MT pair model.
    pub fn load_for_bench_pair(&self, id: &str) -> Result<MarianMt> {
        let cache = self.downloaded_dir(id, Kind::PairMt)?;
        MarianMt::load(id, self.device.clone(), &cache)
    }

    /// Fast (caption) translation: the OPUS-MT model of the pair when it is downloaded,
    /// else the translation LLM.
    pub fn translate_fast(&self, text: &str, src: &str, tgt: &str) -> Result<String> {
        if let Some(repo) = pair_repo(src, tgt) {
            if let Ok(cache) = self.downloaded_dir(repo, Kind::PairMt) {
                let mut guard = lock(&self.pair);
                if guard.as_ref().map(|(id, _)| id.as_str()) != Some(repo) {
                    *guard = None;
                    eprintln!("[translate] loading {repo} ...");
                    let model = MarianMt::load(repo, self.device.clone(), &cache)?;
                    *guard = Some((repo.to_string(), model));
                }
                return guard.as_mut().expect("loaded above").1.translate(text);
            }
        }
        self.with_translator(|mt| mt.translate(text, src, tgt, true))
    }

    pub fn segments(
        &self,
        pcm: &[f32],
        language: Option<&str>,
        task: Task,
    ) -> Result<Vec<Segment>> {
        self.with_asr(|asr| asr.transcribe(pcm, language, task))
    }

    /// `asr_array`: joined text of the segments.
    pub fn text(&self, pcm: &[f32], language: Option<&str>, task: Task) -> Result<String> {
        let segs = self.segments(pcm, language, task)?;
        Ok(segs
            .iter()
            .map(|s| s.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string())
    }

    /// `asr_file`: whole file in one pass.
    pub fn file(&self, path: &Path, language: Option<&str>, task: Task) -> Result<Vec<Segment>> {
        let pcm = audio::decode_file(path)?;
        self.segments(&pcm, language, task)
    }

    /// `asr_file_streaming`: windowed pass with absolute, clamped, de-duplicated times.
    pub fn file_streaming(
        &self,
        path: &Path,
        language: Option<&str>,
        task: Task,
        mut on_progress: impl FnMut(Option<f64>, &[Segment]),
        cancelled: impl Fn() -> bool,
    ) -> Result<Vec<Segment>, JobError> {
        let mut windows = Windows::new(
            MonoStream::open(path)?,
            self.stream_chunk_sec,
            self.stream_overlap_sec,
        );
        let total = windows.duration_sec().filter(|t| *t > 0.0);
        let mut out: Vec<Segment> = Vec::new();
        while let Some((start_sec, lead_sec, window)) = windows.next_window()? {
            if cancelled() {
                return Err(JobError::Cancelled);
            }
            let base = start_sec - lead_sec;
            let win_end = base + window.len() as f64 / SAMPLE_RATE as f64;
            let segs = self.segments(&window, language, task)?;
            merge_window(&mut out, segs, base, start_sec, win_end, total);
            let done = start_sec + window.len() as f64 / SAMPLE_RATE as f64 - lead_sec;
            on_progress(total.map(|t| (done / t).min(0.99)), &out);
        }
        Ok(out)
    }
}

/// Fold one window's segments into `out`: times become absolute, are clamped to the
/// window and the file end, and audio already covered by the previous window (the
/// lead-in) is dropped or trimmed so cues never overlap.
fn merge_window(
    out: &mut Vec<Segment>,
    segs: Vec<Segment>,
    base: f64,
    start_sec: f64,
    win_end: f64,
    total: Option<f64>,
) {
    for seg in segs {
        let mut st = (base + seg.start).min(win_end).max(base);
        let mut en = (base + seg.end).min(win_end);
        if let Some(total) = total {
            st = st.min(total);
            en = en.min(total);
        }
        if en <= st || (!out.is_empty() && en <= start_sec + 0.05) {
            continue;
        }
        if !out.is_empty() {
            st = st.max(start_sec);
        }
        if en <= st {
            continue;
        }
        out.push(Segment {
            start: st,
            end: en,
            text: seg.text,
        });
    }
}

pub enum JobError {
    Cancelled,
    Failed(anyhow::Error),
}

impl From<anyhow::Error> for JobError {
    fn from(error: anyhow::Error) -> Self {
        JobError::Failed(error)
    }
}

pub fn segments_json(segs: &[Segment]) -> Value {
    Value::Array(
        segs.iter()
            .map(|s| json!({ "start": s.start, "end": s.end, "text": s.text }))
            .collect(),
    )
}

/// `/jobs/<id>` table, shared with the worker threads.
pub type Jobs = Arc<Mutex<HashMap<String, Value>>>;

pub fn job_update(jobs: &Jobs, id: &str, patch: Value) {
    if let (Some(Value::Object(job)), Value::Object(patch)) = (lock(jobs).get_mut(id), patch) {
        job.extend(patch);
    }
}

pub fn job_cancelled(jobs: &Jobs, id: &str) -> bool {
    lock(jobs)
        .get(id)
        .and_then(|job| job.get("cancel"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub fn jobs_lock(jobs: &Jobs) -> MutexGuard<'_, HashMap<String, Value>> {
    lock(jobs)
}

/// Body of `/transcribe_file_job`: runs on its own thread, deletes `path` at the end.
pub fn run_job(
    ml: Arc<Ml>,
    jobs: Jobs,
    id: String,
    path: std::path::PathBuf,
    language: Option<String>,
    task: Task,
    size: u64,
) {
    let language = language.as_deref();
    let result = (|| -> Result<(), JobError> {
        if job_cancelled(&jobs, &id) {
            return Err(JobError::Cancelled);
        }
        job_update(&jobs, &id, json!({ "progress": 0.1 }));
        let segs = if size >= ml.stream_min_bytes {
            job_update(&jobs, &id, json!({ "streaming": true }));
            ml.file_streaming(
                &path,
                language,
                task,
                |fraction, partial| {
                    let mut patch = json!({
                        "segments": segments_json(partial),
                        "partialSegments": partial.len(),
                    });
                    if let Some(fraction) = fraction {
                        patch["progress"] = json!(fraction.max(0.1));
                    }
                    job_update(&jobs, &id, patch);
                },
                || job_cancelled(&jobs, &id),
            )?
        } else {
            job_update(&jobs, &id, json!({ "progress": 0.2 }));
            ml.file(&path, language, task)?
        };
        if job_cancelled(&jobs, &id) {
            return Err(JobError::Cancelled);
        }
        job_update(
            &jobs,
            &id,
            json!({ "status": "done", "progress": 1.0, "segments": segments_json(&segs) }),
        );
        Ok(())
    })();
    match result {
        Ok(()) => {}
        Err(JobError::Cancelled) => job_update(&jobs, &id, json!({ "status": "cancelled" })),
        Err(JobError::Failed(error)) => job_update(
            &jobs,
            &id,
            json!({ "status": "error", "error": error.to_string() }),
        ),
    }
    let _ = std::fs::remove_file(&path);
}

#[cfg(test)]
mod merge_tests {
    use super::*;

    #[test]
    fn device_env_wins_over_the_saved_preference() {
        assert!(wants_gpu(None, "auto"));
        assert!(!wants_gpu(None, "cpu"));
        assert!(wants_gpu(Some("cuda"), "cpu"));
        assert!(!wants_gpu(Some("cpu"), "cuda"));
    }

    fn seg(start: f64, end: f64, text: &str) -> Segment {
        Segment {
            start,
            end,
            text: text.to_string(),
        }
    }

    fn pairs(out: &[Segment]) -> Vec<(f64, f64)> {
        out.iter().map(|s| (s.start, s.end)).collect()
    }

    #[test]
    fn times_become_absolute_and_the_last_one_reaches_the_file_end() {
        let mut out = Vec::new();
        merge_window(
            &mut out,
            vec![seg(0.0, 5.0, "w1")],
            0.0,
            0.0,
            5.0,
            Some(12.0),
        );
        // Second window starts at 5 s with a 1 s lead-in: base 4.
        merge_window(
            &mut out,
            vec![seg(1.0, 6.0, "w2")],
            4.0,
            5.0,
            10.0,
            Some(12.0),
        );
        merge_window(
            &mut out,
            vec![seg(1.0, 3.0, "w3")],
            9.0,
            10.0,
            12.0,
            Some(12.0),
        );
        assert_eq!(pairs(&out), [(0.0, 5.0), (5.0, 10.0), (10.0, 12.0)]);
    }

    #[test]
    fn lead_in_echoes_are_dropped_but_not_in_the_first_window() {
        let mut out = Vec::new();
        merge_window(
            &mut out,
            vec![seg(0.0, 0.8, "echo1"), seg(1.0, 5.0, "w1")],
            0.0,
            0.0,
            5.0,
            Some(12.0),
        );
        // Entirely inside the 1 s lead-in (4..5): already transcribed.
        merge_window(
            &mut out,
            vec![seg(0.0, 0.9, "echo2"), seg(1.0, 6.0, "w2")],
            4.0,
            5.0,
            10.0,
            Some(12.0),
        );
        let texts: Vec<_> = out.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["echo1", "w1", "w2"]);
        assert!(out.windows(2).all(|w| w[1].start >= w[0].end));
    }

    #[test]
    fn a_timestamp_past_the_window_is_clamped_to_the_file() {
        // Whisper once returned end 29.98 s for a 16 s file.
        let mut out = Vec::new();
        merge_window(
            &mut out,
            vec![seg(0.0, 29.98, "x")],
            0.0,
            0.0,
            12.0,
            Some(12.0),
        );
        assert_eq!(pairs(&out), [(0.0, 12.0)]);
    }

    #[test]
    fn a_cue_straddling_the_window_boundary_starts_at_the_new_audio() {
        let mut out = Vec::new();
        merge_window(
            &mut out,
            vec![seg(0.2, 5.0, "a")],
            0.0,
            0.0,
            5.0,
            Some(12.0),
        );
        merge_window(
            &mut out,
            vec![seg(0.5, 6.0, "b")],
            4.0,
            5.0,
            10.0,
            Some(12.0),
        );
        assert_eq!(pairs(&out), [(0.2, 5.0), (5.0, 10.0)]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    }

    fn saved(asr: Option<&str>, translate: Option<&str>) -> SavedModels {
        SavedModels {
            asr: asr.map(str::to_string),
            translate: translate.map(str::to_string),
        }
    }

    #[test]
    fn defaults_are_whisper_base_and_qwen3_1_7b_gguf() {
        let picked = pick_models(&env(&[]), &SavedModels::default());
        assert_eq!(picked.asr, "openai/whisper-base");
        assert_eq!(picked.translate.as_deref(), Some("unsloth/Qwen3-1.7B-GGUF"));
        assert!(!picked.asr_from_env && !picked.translate_from_env);
    }

    #[test]
    fn saved_choice_beats_the_default_and_env_beats_the_saved_choice() {
        let mine = saved(
            Some("openai/whisper-small"),
            Some("Qwen/Qwen2.5-3B-Instruct"),
        );
        let picked = pick_models(&env(&[]), &mine);
        assert_eq!(picked.asr, "openai/whisper-small");
        assert_eq!(
            picked.translate.as_deref(),
            Some("Qwen/Qwen2.5-3B-Instruct")
        );

        let picked = pick_models(
            &env(&[("WHISPER_MODEL", "tiny"), ("TRANSLATE", "off")]),
            &mine,
        );
        assert_eq!(picked.asr, "openai/whisper-tiny");
        assert!(picked.asr_from_env);
        assert_eq!(picked.translate, None);
        assert!(picked.translate_from_env);

        let picked = pick_models(&env(&[("TRANSLATE_MODEL", "acme/mt")]), &mine);
        assert_eq!(picked.translate.as_deref(), Some("acme/mt"));
    }

    fn on_disk<'a>(ids: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |id| ids.contains(&id)
    }

    #[test]
    fn the_default_runs_when_it_is_downloaded_even_if_older_models_are_too() {
        let disk = on_disk(&[DEFAULT_TRANSLATE_MODEL, "Qwen/Qwen2.5-0.5B-Instruct"]);
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), true, &disk);
        assert_eq!(id.as_deref(), Some(DEFAULT_TRANSLATE_MODEL));
    }

    #[test]
    fn an_install_with_only_an_older_model_keeps_translating_with_it() {
        // The 0.5B the old default pulled wins over a bigger one that is also there.
        let both = on_disk(&["Qwen/Qwen2.5-1.5B-Instruct", "Qwen/Qwen2.5-0.5B-Instruct"]);
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), true, &both);
        assert_eq!(id.as_deref(), Some("Qwen/Qwen2.5-0.5B-Instruct"));
        // Any other downloaded language model row will do when 0.5B is not there.
        let only = on_disk(&["Qwen/Qwen2.5-3B-Instruct"]);
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), true, &only);
        assert_eq!(id.as_deref(), Some("Qwen/Qwen2.5-3B-Instruct"));
        // An OPUS-MT pair is not a language model: it never stands in for the default.
        let pair = on_disk(&["Helsinki-NLP/opus-mt-en-id"]);
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), true, &pair);
        assert_eq!(id.as_deref(), Some(DEFAULT_TRANSLATE_MODEL));
    }

    #[test]
    fn with_nothing_downloaded_the_default_stays_so_the_state_says_missing() {
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), true, &on_disk(&[]));
        assert_eq!(id.as_deref(), Some(DEFAULT_TRANSLATE_MODEL));
        assert_eq!(
            resolve_translate(None, true, &on_disk(&[])),
            None,
            "translation off stays off"
        );
    }

    #[test]
    fn a_model_somebody_chose_is_never_swapped_for_another() {
        let disk = on_disk(&["Qwen/Qwen2.5-0.5B-Instruct"]);
        // Chosen on purpose (saved, or env): not downloaded means missing, not a quiet swap.
        let id = resolve_translate(Some(DEFAULT_TRANSLATE_MODEL), false, &disk);
        assert_eq!(id.as_deref(), Some(DEFAULT_TRANSLATE_MODEL));
        let id = resolve_translate(Some("Qwen/Qwen2.5-3B-Instruct"), true, &disk);
        assert_eq!(id.as_deref(), Some("Qwen/Qwen2.5-3B-Instruct"));
    }

    #[test]
    fn the_gguf_models_report_their_own_engine() {
        assert_eq!(mt_engine("unsloth/Qwen3-1.7B-GGUF"), "candle-qwen3-gguf");
        assert_eq!(mt_engine("unsloth/Qwen3-0.6B-GGUF"), "candle-qwen3-gguf");
        assert_eq!(mt_engine("Qwen/Qwen2.5-0.5B-Instruct"), MT_ENGINE);
    }

    #[test]
    fn saved_off_turns_translation_off_and_a_stale_id_is_ignored() {
        let picked = pick_models(&env(&[]), &saved(None, Some("off")));
        assert_eq!(picked.translate, None);
        assert!(!picked.translate_from_env);

        // An id the catalog does not list, or one of the wrong kind, falls back to the default.
        let picked = pick_models(
            &env(&[]),
            &saved(
                Some("Qwen/Qwen2.5-3B-Instruct"),
                Some("openai/whisper-small"),
            ),
        );
        assert_eq!(picked.asr, "openai/whisper-base");
        assert_eq!(picked.translate.as_deref(), Some("unsloth/Qwen3-1.7B-GGUF"));
    }
}
