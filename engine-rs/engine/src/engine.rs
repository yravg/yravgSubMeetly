//! ML state behind the HTTP routes: lazily loaded Whisper and Qwen models,
//! the file pipelines (one-shot and windowed) and the background job table.

use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use anyhow::{anyhow, Result};
use candle_core::Device;
use serde_json::{json, Value};

use crate::audio::{self, MonoStream, Windows, SAMPLE_RATE};
use crate::translate::{Translator, DEFAULT_TRANSLATE_MODEL};
use crate::whisper::{repo_for, Segment, Task, WhisperAsr};

pub const ASR_ENGINE: &str = "candle-whisper";
pub const MT_ENGINE: &str = "candle-qwen2";

fn env_f64(key: &str, fallback: f64) -> f64 {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}

pub struct Ml {
    pub asr_model: String,
    pub translate_model: Option<String>,
    pub device: Device,
    asr: Mutex<Option<WhisperAsr>>,
    mt: Mutex<Option<Translator>>,
    asr_loaded: AtomicBool,
    mt_loaded: AtomicBool,
    pub stream_chunk_sec: f64,
    pub stream_overlap_sec: f64,
    pub stream_min_bytes: u64,
}

/// Env `DEVICE` wins over the saved preference; only `cpu` turns the GPU off.
fn wants_gpu(env_device: Option<&str>, pref: &str) -> bool {
    env_device.unwrap_or(pref) != "cpu"
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl Ml {
    /// `device_pref` is the saved auto/cpu/cuda choice; env `DEVICE` wins, like the oracle.
    pub fn from_env(device_pref: &str) -> Self {
        let model = env::var("WHISPER_MODEL").unwrap_or_else(|_| "large-v3-turbo".to_string());
        let translate_model = (env::var("TRANSLATE").unwrap_or_default() != "off").then(|| {
            env::var("TRANSLATE_MODEL").unwrap_or_else(|_| DEFAULT_TRANSLATE_MODEL.to_string())
        });
        let device =
            crate::ml::pick_device(wants_gpu(env::var("DEVICE").ok().as_deref(), device_pref));
        Self {
            asr_model: repo_for(&model),
            translate_model,
            device,
            asr: Mutex::new(None),
            mt: Mutex::new(None),
            asr_loaded: AtomicBool::new(false),
            mt_loaded: AtomicBool::new(false),
            stream_chunk_sec: env_f64("STREAM_CHUNK_SEC", 300.0),
            stream_overlap_sec: env_f64("STREAM_OVERLAP_SEC", 2.0),
            stream_min_bytes: env_f64("STREAM_MIN_BYTES", 512.0 * 1024.0 * 1024.0) as u64,
        }
    }

    pub fn device_name(&self) -> &'static str {
        crate::ml::device_name(&self.device)
    }

    pub fn asr_loaded(&self) -> bool {
        self.asr_loaded.load(Ordering::Relaxed)
    }

    pub fn translate_loaded(&self) -> bool {
        self.mt_loaded.load(Ordering::Relaxed)
    }

    pub fn translate_available(&self) -> bool {
        self.translate_model.is_some()
    }

    pub fn with_asr<R>(&self, f: impl FnOnce(&mut WhisperAsr) -> Result<R>) -> Result<R> {
        let mut guard = lock(&self.asr);
        if guard.is_none() {
            eprintln!("[asr] loading {} …", self.asr_model);
            *guard = Some(WhisperAsr::load(&self.asr_model, self.device.clone())?);
            self.asr_loaded.store(true, Ordering::Relaxed);
        }
        f(guard.as_mut().expect("loaded above"))
    }

    pub fn with_translator<R>(&self, f: impl FnOnce(&mut Translator) -> Result<R>) -> Result<R> {
        let repo = self
            .translate_model
            .as_deref()
            .ok_or_else(|| anyhow!("translation is off"))?;
        let mut guard = lock(&self.mt);
        if guard.is_none() {
            eprintln!("[translate] loading {repo} …");
            *guard = Some(Translator::load(repo, self.device.clone())?);
            self.mt_loaded.store(true, Ordering::Relaxed);
        }
        f(guard.as_mut().expect("loaded above"))
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
