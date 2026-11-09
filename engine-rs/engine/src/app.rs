//! Loopback HTTP engine: the routes of native/server.py.
//!
//! `App` is transport-free so the golden replay can call `handle` directly;
//! `server` puts it behind std::net. Models load lazily on first ML request.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use crate::audio::pcm_f32_le;
use crate::calendar::{Calendar, Fail};
use crate::engine::{segments_json, Jobs, Ml, ASR_ENGINE, MT_ENGINE};
use crate::heuristic::heuristic_notes;
use crate::models::{delete_cached, hub_cache_dir, scan_model_cache};
use crate::notes::{
    export_note_md, export_note_txt, normalize_note_doc, py_str, py_truthy, safe_filename,
};
use crate::protocol::{Request, Response};
use crate::state::{now_epoch_secs, now_utc_iso};
use crate::translate::norm_lang;
use crate::whisper::Task;

const ENGINE_MODES: [&str; 3] = ["fast", "balanced", "accurate"];
const DEVICE_CHOICES: [&str; 3] = ["auto", "cpu", "cuda"];
const UI_THEMES: [&str; 3] = ["auto", "light", "dark"];
const UI_RESKINS: [&str; 3] = ["yraverage", "coretax", "modern"];
const UI_SURFACES: [&str; 3] = ["overlay", "island", "both"];
const TARGET_LANGS: [&str; 11] = [
    "en", "zh", "de", "fr", "es", "ru", "it", "id", "vi", "ja", "ko",
];
const NO_TRANSLATE: &str = "no translation model (set TRANSLATE=on)";
const CUDA_WARNING: &str = "CUDA tidak terdeteksi — helper akan jatuh ke CPU saat start";

fn live_idle() -> Value {
    json!({ "seq": 0, "source": "", "translation": "", "ms": null, "audio_s": null, "rtf": null, "at": null })
}

pub struct App {
    state_dir: PathBuf,
    notes_path: PathBuf,
    engine_mode_path: PathBuf,
    device_pref_path: PathBuf,
    ui_prefs_path: PathBuf,
    allowed_origins: Vec<String>,
    hf_cache: PathBuf,
    ml: Arc<Ml>,
    jobs: Jobs,
    shutdown: AtomicBool,
    live: Mutex<Value>,
    calendar: Calendar,
}

impl App {
    pub fn new(state_dir: PathBuf) -> Self {
        let notes_path = env_path("NOTES_PATH", state_dir.join("notes.json"));
        let engine_mode_path = env_path("ENGINE_MODE_PATH", state_dir.join("engine-mode.json"));
        let device_pref_path = env_path("DEVICE_PREF_PATH", state_dir.join("device.json"));
        let ui_prefs_path = env_path("UI_PREFS_PATH", state_dir.join("ui-prefs.json"));
        let allowed_origins = env::var("ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        let device_pref = read_json(&device_pref_path)
            .and_then(|v| v.get("device").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| "auto".to_string());
        Self {
            calendar: Calendar::new(state_dir.clone()),
            state_dir,
            notes_path,
            engine_mode_path,
            device_pref_path,
            ui_prefs_path,
            allowed_origins,
            hf_cache: hub_cache_dir(),
            ml: Arc::new(Ml::from_env(&device_pref)),
            jobs: Jobs::default(),
            shutdown: AtomicBool::new(false),
            live: Mutex::new(live_idle()),
        }
    }

    /// Point the model-cache routes at another hub cache (tests).
    pub fn set_hf_cache(&mut self, dir: PathBuf) {
        self.hf_cache = dir;
    }

    /// True once `POST /shutdown` answered; the server exits after the reply.
    pub fn shutdown_requested(&self) -> bool {
        self.shutdown.load(Ordering::Relaxed)
    }

    pub fn state_dir(&self) -> &PathBuf {
        &self.state_dir
    }

    /// Called by the server every minute: re-read calendar links that are due.
    pub fn calendar_tick(&self) {
        self.calendar.tick();
    }

    /// Replace the `ALLOWED_ORIGINS` list (embedders and policy tests).
    pub fn set_allowed_origins(&mut self, origins: Vec<String>) {
        self.allowed_origins = origins;
    }

    pub fn handle(&self, request: &Request) -> Response {
        if let Some(denied) = self.local_only(request) {
            return denied;
        }
        match request.method.as_str() {
            "GET" => self.get(request),
            "POST" => self.post(request),
            "DELETE" => self.delete(request),
            "OPTIONS" => Response {
                status: 204,
                body: None,
                headers: self.cors_headers(request),
            },
            _ => self.json_response(request, 404, json!({ "error": "not found" })),
        }
    }

    fn local_only(&self, request: &Request) -> Option<Response> {
        if !request.peer_loopback {
            return Some(self.json_response(
                request,
                403,
                json!({ "error": "helper hanya melayani loopback" }),
            ));
        }
        let host = request.header("Host").unwrap_or("");
        if !is_loopback_host(host_header_hostname(host)) {
            return Some(self.json_response(
                request,
                403,
                json!({ "error": "header Host bukan loopback" }),
            ));
        }
        let origin = request.header("Origin").unwrap_or("");
        if !origin.is_empty() && !self.origin_allowed(origin) {
            return Some(self.json_response(
                request,
                403,
                json!({ "error": "asal tidak diizinkan" }),
            ));
        }
        None
    }

    pub fn origin_allowed(&self, origin: &str) -> bool {
        let candidate = origin.trim();
        if candidate.is_empty() {
            return true;
        }
        if !self.allowed_origins.is_empty() {
            return self.allowed_origins.iter().any(|item| item == candidate);
        }
        if candidate.starts_with("chrome-extension://") || candidate.starts_with("moz-extension://")
        {
            return true;
        }
        let Some((scheme, host)) = parse_origin(candidate) else {
            return false;
        };
        matches!(scheme.as_str(), "http" | "https") && is_loopback_host(&host)
    }

    fn cors_headers(&self, request: &Request) -> Vec<(String, String)> {
        let mut headers = Vec::new();
        let origin = request.header("Origin").unwrap_or("");
        if !origin.is_empty() && self.origin_allowed(origin) {
            headers.push((
                "Access-Control-Allow-Origin".to_string(),
                origin.to_string(),
            ));
            headers.push(("Vary".to_string(), "Origin".to_string()));
        }
        headers.push((
            "Access-Control-Allow-Methods".to_string(),
            "GET, POST, DELETE, OPTIONS".to_string(),
        ));
        headers.push((
            "Access-Control-Allow-Headers".to_string(),
            "Content-Type, X-Filename".to_string(),
        ));
        headers
    }

    fn json_response(&self, request: &Request, status: u16, body: Value) -> Response {
        Response {
            status,
            body: Some(body),
            headers: self.cors_headers(request),
        }
    }

    fn get(&self, request: &Request) -> Response {
        let path = request.path();
        match path {
            "/engine/device" => self.json_response(request, 200, self.device_state()),
            "/health" => self.json_response(request, 200, self.health()),
            "/live" => {
                let live = self.live.lock().unwrap_or_else(|e| e.into_inner()).clone();
                self.json_response(request, 200, live)
            }
            "/notes" => self.json_response(request, 200, json!({ "notes": self.load_notes() })),
            "/calendar" => self.get_calendar(request),
            "/models" =>self.json_response(
                request,
                200,
                json!({ "models": self.model_inventory(), "cached": scan_model_cache(&self.hf_cache) }),
            ),
            "/engine/mode" => {
                self.json_response(request, 200, json!({ "mode": self.load_engine_mode() }))
            }
            "/languages/targets" => self.json_response(
                request,
                200,
                json!({ "targets": target_status(self.ml.translate_available()), "engine": ASR_ENGINE }),
            ),
            "/ui-prefs" => {
                let (prefs, stored) = self.load_ui_prefs();
                self.json_response(request, 200, json!({ "prefs": prefs, "stored": stored }))
            }
            _ => {
                if let Some(rest) = path.strip_prefix("/notes/") {
                    let note_id = percent_decode(rest);
                    if note_id.is_empty() || note_id.contains('/') {
                        return self.json_response(request, 404, json!({ "error": "not found" }));
                    }
                    let wanted = Value::String(note_id.clone());
                    match self
                        .load_notes()
                        .into_iter()
                        .find(|note| note.get("id") == Some(&wanted))
                    {
                        Some(note) => self.json_response(request, 200, json!({ "note": note })),
                        None => {
                            self.json_response(request, 404, json!({ "error": "note not found" }))
                        }
                    }
                } else if let Some(id) = path.strip_prefix("/jobs/") {
                    let job = crate::engine::jobs_lock(&self.jobs).get(id).cloned();
                    match job {
                        Some(job) => self.json_response(request, 200, job),
                        None => self.json_response(request, 404, json!({ "error": "job not found" })),
                    }
                } else {
                    self.json_response(request, 404, json!({ "error": "not found" }))
                }
            }
        }
    }

    fn post(&self, request: &Request) -> Response {
        let path = request.path();
        match path {
            "/engine/device" => self.post_engine_device(request),
            "/engine/mode" => self.post_engine_mode(request),
            "/ui-prefs" => self.post_ui_prefs(request),
            "/notes/export" => self.post_notes_export(request),
            "/notes" => self.post_notes(request),
            "/notes/generate" => self.post_notes_generate(request, false),
            "/notes/summarize" => self.post_notes_generate(request, true),
            "/calendar/sources" => self.post_calendar_source(request),
            "/calendar/refresh" => self.post_calendar_refresh(request),
            "/calendar/notes" => self.post_calendar_note(request),
            "/models/pull" => self.post_models_pull(request),
            "/shutdown" => {
                self.shutdown.store(true, Ordering::Relaxed);
                self.json_response(request, 200, json!({ "ok": true, "shutting_down": true }))
            }
            "/transcribe"
            | "/transcribe_file"
            | "/transcribe_file_job"
            | "/translate"
            | "/draft"
            | "/translate_refine" => {
                // The oracle answers any exception in these routes with 500.
                match self.ml_route(request, path) {
                    Ok(response) => response,
                    Err(error) => self.json_response(
                        request,
                        500,
                        json!({ "error": format!("Error: {error:#}") }),
                    ),
                }
            }
            _ => {
                if let Some(rest) = path.strip_prefix("/jobs/") {
                    if let Some(id) = rest.strip_suffix("/cancel") {
                        return self.cancel_job(request, id);
                    }
                }
                self.json_response(request, 404, json!({ "error": "not found" }))
            }
        }
    }

    fn cancel_job(&self, request: &Request, id: &str) -> Response {
        let mut jobs = crate::engine::jobs_lock(&self.jobs);
        let Some(Value::Object(job)) = jobs.get_mut(id) else {
            return self.json_response(request, 404, json!({ "error": "job not found" }));
        };
        job.insert("cancel".into(), json!(true));
        if job.get("status") == Some(&json!("running")) {
            job.insert("status".into(), json!("cancelling"));
        }
        drop(jobs);
        self.json_response(request, 200, json!({ "ok": true, "jobId": id }))
    }

    fn ml_route(&self, request: &Request, path: &str) -> anyhow::Result<Response> {
        let q = query(&request.target);
        let language = q.get("language").cloned().unwrap_or_else(|| "auto".into());
        let task = if q.get("task").map(String::as_str) == Some("translate") {
            Task::Translate
        } else {
            Task::Transcribe
        };
        let lang = |code: &str| (!code.is_empty() && code != "auto").then(|| code.to_string());
        let src = norm_lang(q.get("src").map(String::as_str), "auto");
        let tgt = norm_lang(q.get("tgt").map(String::as_str), "en");
        let accurate = self.load_engine_mode() == "accurate";
        let started = std::time::Instant::now();
        let ms = || started.elapsed().as_millis() as u64;
        Ok(match path {
            "/transcribe" => {
                let pcm = pcm_f32_le(&request.body);
                if pcm.len() < 1600 {
                    return Ok(self.json_response(request, 200, json!({ "text": "" })));
                }
                let text = self.ml.text(&pcm, lang(&language).as_deref(), task)?;
                self.record_live(&text, "", ms(), pcm.len());
                self.json_response(request, 200, json!({ "text": text, "ms": ms() }))
            }
            "/transcribe_file" => {
                let file = self.body_to_file(request, &q)?;
                let result = self.ml.file(&file, lang(&language).as_deref(), task);
                let _ = fs::remove_file(&file);
                self.json_response(
                    request,
                    200,
                    json!({ "segments": segments_json(&result?), "ms": ms() }),
                )
            }
            "/transcribe_file_job" => self.start_job(request, &q, lang(&language), task)?,
            "/translate" => {
                if !self.ml.translate_available() {
                    return Ok(self.json_response(request, 501, json!({ "error": NO_TRANSLATE })));
                }
                let text = String::from_utf8_lossy(&request.body).to_string();
                let fast = matches!(
                    q.get("fast").map(String::as_str),
                    Some("1" | "true" | "yes")
                ) && !accurate;
                if text.trim().is_empty() {
                    return Ok(self.json_response(request, 200, json!({ "text": "" })));
                }
                let out = self
                    .ml
                    .with_translator(|mt| mt.translate(&text, &src, &tgt, fast))?;
                self.json_response(request, 200, json!({ "text": out, "ms": ms() }))
            }
            "/translate_refine" => {
                if !self.ml.translate_available() {
                    return Ok(self.json_response(request, 501, json!({ "error": NO_TRANSLATE })));
                }
                let Some(payload) = parse_body(&request.body) else {
                    return Ok(self.json_response(
                        request,
                        400,
                        json!({ "error": "invalid JSON body" }),
                    ));
                };
                let field = |key: &str| {
                    payload
                        .get(key)
                        .filter(|v| py_truthy(v))
                        .map(py_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string()
                };
                let (text, draft) = (field("text"), field("draft"));
                if text.is_empty() {
                    return Ok(self.json_response(request, 200, json!({ "text": draft })));
                }
                let out = self
                    .ml
                    .with_translator(|mt| mt.refine(&text, &draft, &src, &tgt))?;
                self.json_response(request, 200, json!({ "text": out }))
            }
            _ => self.draft(request, &q, &src, &tgt, accurate)?,
        })
    }

    /// `/draft`: full-model ASR + fast translate (the oracle has no small
    /// draft model off Apple Silicon either).
    fn draft(
        &self,
        request: &Request,
        q: &HashMap<String, String>,
        src: &str,
        tgt: &str,
        accurate: bool,
    ) -> anyhow::Result<Response> {
        let started = std::time::Instant::now();
        let ms = || started.elapsed().as_millis() as u64;
        let pcm = pcm_f32_le(&request.body);
        if pcm.len() < 1600 {
            return Ok(self.json_response(
                request,
                200,
                json!({ "source": "", "translation": "" }),
            ));
        }
        let language = q.get("language").map(String::as_str).unwrap_or(src);
        let language = (!language.is_empty() && language != "auto").then_some(language);
        let source = self.ml.text(&pcm, language, Task::Transcribe)?;
        let asr_ms = ms();
        if !draft_source_ok(&source, pcm.len()) {
            return Ok(self.json_response(
                request,
                200,
                json!({ "source": "", "translation": "", "ms": ms(), "asr_ms": asr_ms }),
            ));
        }
        if !self.ml.translate_available() {
            self.record_live(&source, &source, ms(), pcm.len());
            return Ok(self.json_response(
                request,
                200,
                json!({ "source": source, "translation": source, "ms": ms(), "asr_ms": asr_ms }),
            ));
        }
        let mt_start = std::time::Instant::now();
        let translation = self
            .ml
            .with_translator(|mt| mt.translate(&source, src, tgt, !accurate))?;
        let translate_ms = mt_start.elapsed().as_millis() as u64;
        self.record_live(&source, &translation, ms(), pcm.len());
        Ok(self.json_response(
            request,
            200,
            json!({
                "source": source,
                "translation": translation,
                "ms": ms(),
                "asr_ms": asr_ms,
                "translate_ms": translate_ms,
            }),
        ))
    }

    /// Remember the latest caption for `GET /live` (same fields as server.py).
    /// `samples` is the 16 kHz audio length, so `rtf` = compute / audio seconds.
    pub fn record_live(&self, source: &str, translation: &str, ms: u64, samples: usize) {
        if source.trim().is_empty() {
            return;
        }
        let audio_s = samples as f64 / 16000.0;
        let round3 = |x: f64| (x * 1000.0).round() / 1000.0;
        let mut live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        let seq = live["seq"].as_u64().unwrap_or(0) + 1;
        *live = json!({
            "seq": seq,
            "source": source.trim(),
            "translation": translation.trim(),
            "ms": ms,
            "audio_s": round3(audio_s),
            "rtf": if audio_s > 0.0 { json!(round3(ms as f64 / 1000.0 / audio_s)) } else { Value::Null },
            "at": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        });
    }

    /// Upload body as a temp file owned by the caller. The server already
    /// streamed large bodies to disk (`body_file`); small ones are written here.
    fn body_to_file(
        &self,
        request: &Request,
        q: &HashMap<String, String>,
    ) -> anyhow::Result<PathBuf> {
        let name = q.get("filename").map(String::as_str).unwrap_or("input.bin");
        let ext = std::path::Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()))
            .unwrap_or("bin");
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let target =
            env::temp_dir().join(format!("ysm-upload-{}-{nanos}.{ext}", std::process::id()));
        match &request.body_file {
            // Rename takes ownership: the server's own cleanup then finds nothing.
            Some(file) => {
                if fs::rename(file, &target).is_err() {
                    fs::copy(file, &target)?;
                }
            }
            None => fs::write(&target, &request.body)?,
        }
        Ok(target)
    }

    fn start_job(
        &self,
        request: &Request,
        q: &HashMap<String, String>,
        language: Option<String>,
        task: Task,
    ) -> anyhow::Result<Response> {
        let name = q
            .get("filename")
            .cloned()
            .unwrap_or_else(|| "input.bin".into());
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let id = format!("job-{millis}");
        let file = self.body_to_file(request, q)?;
        let size = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        crate::engine::jobs_lock(&self.jobs).insert(
            id.clone(),
            json!({
                "id": id,
                "status": "running",
                "progress": 0.05,
                "filename": name,
                "sizeBytes": size,
                "segments": null,
                "partialSegments": 0,
                "streaming": false,
                "error": null,
                "cancel": false,
            }),
        );
        let (ml, jobs, job_id) = (Arc::clone(&self.ml), Arc::clone(&self.jobs), id.clone());
        std::thread::spawn(move || {
            crate::engine::run_job(ml, jobs, job_id, file, language, task, size)
        });
        Ok(self.json_response(request, 202, json!({ "jobId": id })))
    }

    fn post_notes_generate(&self, request: &Request, summarize: bool) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let get = |key: &str| payload.get(key).filter(|v| py_truthy(v));
        let text = |key: &str, fallback: &str| {
            get(key).map(py_str).unwrap_or_else(|| fallback.to_string())
        };
        let lines: Vec<Value> = match get("lines") {
            Some(Value::Array(items)) => items.clone(),
            _ => Vec::new(),
        };
        if summarize && lines.is_empty() {
            return self.json_response(
                request,
                400,
                json!({ "error": "body needs non-empty lines[]" }),
            );
        }
        let note = heuristic_notes(
            &lines,
            &text("title", "Notulen sesi"),
            &text("source", "helper"),
        );
        if !summarize {
            return self.json_response(request, 200, json!({ "note": note }));
        }
        let count = |key: &str| note[key].as_array().map_or(0, Vec::len);
        self.json_response(
            request,
            200,
            json!({
                "summary": note["summary"],
                "decisions": note["decisions"],
                "actions": note["actions"],
                "counts": {
                    "segments": lines.len(),
                    "decisions": count("decisions"),
                    "actions": count("actions"),
                },
            }),
        )
    }

    fn model_inventory(&self) -> Vec<Value> {
        let device = self.ml.device_name();
        let mt = self.ml.translate_available();
        vec![
            json!({
                "key": "asr",
                "kind": "asr",
                "id": self.ml.asr_model,
                "engine": ASR_ENGINE,
                "device": device,
                "available": true,
                "loaded": self.ml.asr_loaded(),
            }),
            json!({
                "key": "translate",
                "kind": "translate",
                "id": self.ml.translate_model,
                "engine": if mt { Value::from(MT_ENGINE) } else { Value::Null },
                "device": device,
                "available": mt,
                "loaded": self.ml.translate_loaded(),
            }),
        ]
    }

    fn inventory_ids(&self) -> Vec<String> {
        let mut ids = vec![self.ml.asr_model.clone()];
        ids.extend(self.ml.translate_model.clone());
        ids
    }

    fn post_models_pull(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let want = match payload.get("id") {
            Some(id) if py_truthy(id) => py_str(id).trim().to_string(),
            _ => String::new(),
        };
        if want.is_empty() || !self.inventory_ids().contains(&want) {
            return self.json_response(
                request,
                400,
                json!({ "error": "id must be one of the /models inventory ids" }),
            );
        }
        match crate::models::pull(&want) {
            Ok((path, bytes)) => self.json_response(
                request,
                200,
                json!({ "ok": true, "id": want, "path": path.to_string_lossy(), "bytes": bytes }),
            ),
            Err(error) => self.json_response(
                request,
                502,
                json!({ "error": format!("download failed: {error:#}") }),
            ),
        }
    }

    fn delete(&self, request: &Request) -> Response {
        let path = request.path();
        if let Some(rest) = path.strip_prefix("/models/cache/") {
            let q = query(&request.target);
            let confirm = matches!(
                q.get("confirm").map(String::as_str),
                Some("1" | "true" | "yes")
            );
            let (status, body) = delete_cached(
                &self.hf_cache,
                &percent_decode(rest),
                &self.inventory_ids(),
                confirm,
            );
            return self.json_response(request, status, body);
        }
        if let Some(rest) = path.strip_prefix("/calendar/sources/") {
            return match self.calendar.remove(&percent_decode(rest)) {
                Ok(()) => self.json_response(request, 200, json!({ "ok": true })),
                Err(fail) => self.calendar_fail(request, fail),
            };
        }
        if let Some(rest) = path.strip_prefix("/notes/") {
            let note_id = percent_decode(rest);
            if note_id.is_empty() || note_id.contains('/') {
                return self.json_response(request, 404, json!({ "error": "not found" }));
            }
            let notes = self.load_notes();
            let wanted = Value::String(note_id.clone());
            let kept: Vec<Value> = notes
                .iter()
                .filter(|note| note.get("id") != Some(&wanted))
                .cloned()
                .collect();
            if kept.len() == notes.len() {
                return self.json_response(request, 404, json!({ "error": "note not found" }));
            }
            self.save_notes(&kept);
            return self.json_response(request, 200, json!({ "ok": true, "id": note_id }));
        }
        self.json_response(request, 404, json!({ "error": "not found" }))
    }

    fn health(&self) -> Value {
        let mt = self.ml.translate_available();
        json!({
            "ok": true,
            "engine": ASR_ENGINE,
            "engine_label": ASR_ENGINE,
            "model": self.ml.asr_model,
            // Media is decoded in-process (symphonia), not by ffmpeg.
            "ffmpeg": false,
            "media_decoder": "symphonia",
            "translate": mt,
            "translate_model": self.ml.translate_model,
            "draft_model": Value::Null,
            "device": self.ml.device_name(),
            "compute": "float32",
            "engine_mode": self.load_engine_mode(),
            "platform": env::consts::OS,
            "loaded": { "asr": self.ml.asr_loaded(), "translate": self.ml.translate_loaded() },
            "features": {
                "fast_translate": true,
                "translate_refine": mt,
                // The oracle's draft flag means a separate small draft model; none here.
                "draft": false,
                "notes": true,
                "transcribe_file_jobs": true,
                "streaming_file_jobs": true,
                "faster_whisper": false,
                "ui_prefs": true,
                "models": true,
            },
        })
    }

    fn device_state(&self) -> Value {
        let pref = self.load_device_pref();
        let active = self.ml.device_name();
        json!({
            "device": pref,
            "active": active,
            "compute": "float32",
            "cuda_available": crate::ml::gpu_available(),
            "supported": true,
            "applied": pref == "auto" || pref == active,
        })
    }

    fn post_engine_device(&self, request: &Request) -> Response {
        let Some(Value::Object(payload)) = parse_body(&request.body) else {
            return self.json_response(
                request,
                400,
                json!({ "error": "body harus JSON {\"device\": ...}" }),
            );
        };
        let Some(want) = payload.get("device").and_then(Value::as_str) else {
            return self.json_response(
                request,
                400,
                json!({ "error": "device must be auto, cpu, or cuda" }),
            );
        };
        if !DEVICE_CHOICES.contains(&want) {
            return self.json_response(
                request,
                400,
                json!({ "error": "device must be auto, cpu, or cuda" }),
            );
        }
        let saved = self.save_device_pref(want);
        if saved == "cuda" && !crate::ml::gpu_available() {
            return self.json_response(
                request,
                200,
                json!({
                    "ok": true,
                    "supported": true,
                    "device": saved,
                    "warning": CUDA_WARNING,
                    "restart_required": true,
                }),
            );
        }
        self.json_response(
            request,
            200,
            json!({
                "ok": true,
                "supported": true,
                "device": saved,
                "restart_required": saved != self.ml.device_name(),
            }),
        )
    }

    fn post_engine_mode(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let Some(mode) = payload.get("mode").and_then(Value::as_str) else {
            return self.json_response(
                request,
                400,
                json!({ "error": "mode must be fast, balanced, or accurate" }),
            );
        };
        if !ENGINE_MODES.contains(&mode) {
            return self.json_response(
                request,
                400,
                json!({ "error": "mode must be fast, balanced, or accurate" }),
            );
        }
        self.save_engine_mode(mode);
        self.json_response(request, 200, json!({ "ok": true, "mode": mode }))
    }

    fn post_ui_prefs(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let Value::Object(patch) = payload else {
            return self.json_response(
                request,
                400,
                json!({ "error": "body needs theme and/or reskin" }),
            );
        };
        if !["theme", "reskin", "captionSurface"]
            .iter()
            .any(|k| patch.contains_key(*k))
        {
            return self.json_response(
                request,
                400,
                json!({ "error": "body needs theme and/or reskin" }),
            );
        }
        let prefs = self.save_ui_prefs(&patch);
        self.json_response(
            request,
            200,
            json!({ "ok": true, "prefs": prefs, "stored": true }),
        )
    }

    fn post_notes(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let candidate = match &payload {
            Value::Object(map) => match map.get("note") {
                Some(note) if py_truthy(note) => note.clone(),
                _ => payload.clone(),
            },
            _ => payload.clone(),
        };
        let note = match normalize_note_doc(&candidate) {
            Ok(note) => note,
            Err(error) => return self.json_response(request, 400, json!({ "error": error })),
        };
        let note_id = note.get("id").cloned().unwrap_or(Value::Null);
        let mut notes = self.load_notes();
        notes.retain(|existing| existing.get("id") != Some(&note_id));
        notes.insert(0, note.clone());
        notes.truncate(50);
        self.save_notes(&notes);
        self.json_response(request, 200, json!({ "ok": true, "note": note }))
    }

    fn calendar_fail(&self, request: &Request, fail: Fail) -> Response {
        let (status, error) = match fail {
            Fail::Bad(message) => (400, message),
            Fail::Missing => (404, "calendar not found".to_string()),
            Fail::Upstream(message) => (502, message),
        };
        self.json_response(request, status, json!({ "error": error }))
    }

    /// `GET /calendar?from=&to=` (ISO dates or times, UTC). Default: yesterday
    /// to a week ahead; a window is at most 62 days.
    fn get_calendar(&self, request: &Request) -> Response {
        let q = query(&request.target);
        let now = now_epoch_secs() as i64;
        let bound = |key: &str, fallback: i64| match q.get(key) {
            Some(text) => crate::ics::parse_iso(text),
            None => Some(fallback),
        };
        let (Some(from), Some(to)) = (bound("from", now - 86_400), bound("to", now + 7 * 86_400))
        else {
            return self.json_response(
                request,
                400,
                json!({ "error": "from/to must be ISO dates" }),
            );
        };
        let to = to.min(from + 62 * 86_400);
        if to <= from {
            return self.json_response(request, 400, json!({ "error": "to must be after from" }));
        }
        self.json_response(request, 200, self.calendar.events(from, to))
    }

    /// `POST /calendar/sources` with `{url}` (a subscription link) or
    /// `{ics, name}` (the text of an imported file).
    fn post_calendar_source(&self, request: &Request) -> Response {
        let Some(Value::Object(body)) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let text = |key: &str| body.get(key).and_then(Value::as_str).unwrap_or("");
        let added = if !text("url").is_empty() {
            self.calendar.add_link(text("url"))
        } else if !text("ics").is_empty() {
            self.calendar.add_file(text("ics"), text("name"))
        } else {
            Err(Fail::Bad("body needs url or ics".into()))
        };
        match added {
            Ok(source) => self.json_response(request, 200, json!({ "ok": true, "source": source })),
            Err(fail) => self.calendar_fail(request, fail),
        }
    }

    /// `POST /calendar/refresh` with an optional `{id}`: read the links again now.
    fn post_calendar_refresh(&self, request: &Request) -> Response {
        let Some(Value::Object(body)) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let id = body
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        // A link that fails to read is reported in `sources[].lastError`, not as a failed call.
        match self.calendar.refresh(id) {
            Err(Fail::Missing) => self.calendar_fail(request, Fail::Missing),
            _ => self.json_response(
                request,
                200,
                json!({ "ok": true, "sources": self.calendar.sources() }),
            ),
        }
    }

    /// `POST /calendar/notes` with `{id, tzMinutes?}`: make the meeting note for a
    /// calendar event. An existing note is returned as it is, never overwritten.
    fn post_calendar_note(&self, request: &Request) -> Response {
        let Some(Value::Object(body)) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let Some(event_id) = body
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
        else {
            return self.json_response(request, 400, json!({ "error": "body needs id" }));
        };
        let tz = body
            .get("tzMinutes")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .clamp(-14 * 60, 14 * 60);
        let Some(doc) = self
            .calendar
            .note_for(event_id, tz, now_epoch_secs() as i64)
        else {
            return self.json_response(request, 404, json!({ "error": "event not found" }));
        };
        let note = match normalize_note_doc(&doc) {
            Ok(note) => note,
            Err(error) => return self.json_response(request, 400, json!({ "error": error })),
        };
        let mut notes = self.load_notes();
        if let Some(existing) = notes.iter().find(|n| n.get("id") == note.get("id")) {
            return self.json_response(
                request,
                200,
                json!({ "ok": true, "created": false, "note": existing }),
            );
        }
        notes.insert(0, note.clone());
        notes.truncate(50);
        self.save_notes(&notes);
        self.json_response(
            request,
            200,
            json!({ "ok": true, "created": true, "note": note }),
        )
    }

    fn post_notes_export(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let Value::Object(payload) = payload else {
            return self.json_response(request, 400, json!({ "error": "body needs id or note" }));
        };
        let format = match payload.get("format") {
            Some(Value::String(text)) if !text.is_empty() => text.to_lowercase(),
            _ => "md".to_string(),
        };
        if format != "txt" && format != "md" {
            return self.json_response(
                request,
                400,
                json!({ "error": "format must be \"txt\" or \"md\"" }),
            );
        }
        let note = match payload.get("note") {
            Some(note @ Value::Object(_)) => match normalize_note_doc(note) {
                Ok(normalized) => normalized,
                Err(error) => {
                    return self.json_response(request, 400, json!({ "error": error }));
                }
            },
            _ => match payload.get("id") {
                Some(id) if py_truthy(id) => {
                    match self
                        .load_notes()
                        .into_iter()
                        .find(|note| note.get("id").map(|value| value == id) == Some(true))
                    {
                        Some(note) => note,
                        None => {
                            return self.json_response(
                                request,
                                404,
                                json!({ "error": "note not found" }),
                            );
                        }
                    }
                }
                _ => {
                    return self.json_response(
                        request,
                        400,
                        json!({ "error": "body needs id or note" }),
                    );
                }
            },
        };
        let title = match note.get("title") {
            Some(value) if py_truthy(value) => py_str(value),
            _ => note.get("id").map(py_str).unwrap_or_default(),
        };
        let safe = safe_filename(&title);
        let content = if format == "txt" {
            export_note_txt(&note)
        } else {
            export_note_md(&note)
        };
        self.json_response(
            request,
            200,
            json!({ "filename": format!("{safe}.{format}"), "content": content }),
        )
    }

    fn load_notes(&self) -> Vec<Value> {
        fs::read_to_string(&self.notes_path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|value| value.get("notes").and_then(Value::as_array).cloned())
            .unwrap_or_default()
    }

    fn save_notes(&self, notes: &[Value]) {
        if let Some(parent) = self.notes_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let document = json!({ "updatedAt": now_utc_iso(), "notes": notes });
        let _ = fs::write(&self.notes_path, document.to_string());
    }

    fn load_engine_mode(&self) -> String {
        read_json(&self.engine_mode_path)
            .and_then(|value| {
                value
                    .get("mode")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .filter(|mode| ENGINE_MODES.contains(&mode.as_str()))
            .unwrap_or_else(|| "fast".to_string())
    }

    fn save_engine_mode(&self, mode: &str) -> String {
        write_json(&self.engine_mode_path, json!({ "mode": mode }));
        mode.to_string()
    }

    fn load_device_pref(&self) -> String {
        read_json(&self.device_pref_path)
            .and_then(|value| {
                value
                    .get("device")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .filter(|device| DEVICE_CHOICES.contains(&device.as_str()))
            .unwrap_or_else(|| "auto".to_string())
    }

    fn save_device_pref(&self, device: &str) -> String {
        write_json(&self.device_pref_path, json!({ "device": device }));
        device.to_string()
    }

    fn load_ui_prefs(&self) -> (Value, bool) {
        let defaults = json!({ "theme": "auto", "reskin": "yraverage" });
        let Some(stored) = read_json(&self.ui_prefs_path) else {
            return (defaults, false);
        };
        let mut prefs = match defaults {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        if let Some(Value::Object(saved)) = stored.get("prefs") {
            if let Some(Value::String(theme)) = saved.get("theme") {
                if UI_THEMES.contains(&theme.as_str()) {
                    prefs.insert("theme".to_string(), Value::String(theme.clone()));
                }
            }
            if let Some(Value::String(reskin)) = saved.get("reskin") {
                if UI_RESKINS.contains(&reskin.as_str()) {
                    prefs.insert("reskin".to_string(), Value::String(reskin.clone()));
                }
            }
            // Only present once set, so GET /ui-prefs stays as it was for older clients.
            if let Some(Value::String(s)) = saved.get("captionSurface") {
                if UI_SURFACES.contains(&s.as_str()) {
                    prefs.insert("captionSurface".to_string(), Value::String(s.clone()));
                }
            }
        }
        (Value::Object(prefs), true)
    }

    fn save_ui_prefs(&self, patch: &Map<String, Value>) -> Value {
        let (prefs, _) = self.load_ui_prefs();
        let Value::Object(mut prefs) = prefs else {
            return Value::Null;
        };
        if let Some(Value::String(theme)) = patch.get("theme") {
            if UI_THEMES.contains(&theme.as_str()) {
                prefs.insert("theme".to_string(), Value::String(theme.clone()));
            }
        }
        if let Some(Value::String(reskin)) = patch.get("reskin") {
            if UI_RESKINS.contains(&reskin.as_str()) {
                prefs.insert("reskin".to_string(), Value::String(reskin.clone()));
            }
        }
        if let Some(Value::String(s)) = patch.get("captionSurface") {
            if UI_SURFACES.contains(&s.as_str()) {
                prefs.insert("captionSurface".to_string(), Value::String(s.clone()));
            }
        }
        let prefs = Value::Object(prefs);
        write_json(
            &self.ui_prefs_path,
            json!({ "updatedAt": now_utc_iso(), "prefs": prefs }),
        );
        prefs
    }
}

fn draft_source_ok(source: &str, samples: usize) -> bool {
    let s = source.trim();
    if s.is_empty() {
        return false;
    }
    let max_chars = 40usize.max((samples as f64 / 16000.0 * 25.0) as usize + 20);
    s.chars().count() <= max_chars
}

/// `parse_qs(...)` first values: `+` is a space, then percent-decoded.
fn query(target: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some((_, qs)) = target.split_once('?') else {
        return out;
    };
    for pair in qs.split(['&', ';']) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if value.is_empty() {
            continue; // parse_qs drops blank values
        }
        out.entry(percent_decode(&key.replace('+', " ")))
            .or_insert_with(|| percent_decode(&value.replace('+', " ")));
    }
    out
}

fn target_status(translate: bool) -> Vec<Value> {
    TARGET_LANGS
        .iter()
        .map(|code| {
            if *code == "en" {
                json!({ "code": code, "via": "whisper-direct", "local": true })
            } else if translate {
                json!({ "code": code, "via": "llm", "local": true })
            } else {
                json!({ "code": code, "via": "none", "local": false })
            }
        })
        .collect()
}

fn env_path(key: &str, fallback: PathBuf) -> PathBuf {
    match env::var_os(key) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => fallback,
    }
}

fn parse_body(body: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(body);
    let source = if text.is_empty() { "{}" } else { &text };
    serde_json::from_str(source).ok()
}

fn read_json(path: &PathBuf) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}

fn write_json(path: &PathBuf, value: Value) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, value.to_string());
}

pub fn is_loopback_host(hostname: &str) -> bool {
    let host = hostname.trim().to_lowercase();
    if host.is_empty() || host == "localhost" || host == "::1" || host == "[::1]" {
        return true;
    }
    let Some(rest) = host.strip_prefix("127.") else {
        return false;
    };
    let parts: Vec<&str> = rest.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.parse::<u8>().is_ok())
}

pub fn host_header_hostname(host: &str) -> &str {
    let value = host.trim();
    if let Some(rest) = value.strip_prefix('[') {
        return match rest.find(']') {
            Some(end) => &rest[..end],
            None => value,
        };
    }
    if value.matches(':').count() == 1 {
        return value
            .rsplit_once(':')
            .map(|(name, _)| name)
            .unwrap_or(value);
    }
    value
}

/// `urlparse(origin)` -> (scheme, hostname). Mirrors Python's leniency for
/// origins without `//`: the hostname is then empty, which counts as loopback.
fn parse_origin(origin: &str) -> Option<(String, String)> {
    let (scheme, rest) = origin.split_once(':')?;
    let scheme = scheme.to_lowercase();
    let authority = match rest.strip_prefix("//") {
        Some(after) => after.split(['/', '?', '#']).next().unwrap_or(""),
        None => "",
    };
    let host_port = match authority.rsplit_once('@') {
        Some((_, host)) => host,
        None => authority,
    };
    let hostname = if let Some(rest) = host_port.strip_prefix('[') {
        match rest.find(']') {
            Some(end) => &rest[..end],
            None => host_port,
        }
    } else if host_port.matches(':').count() == 1 {
        host_port
            .rsplit_once(':')
            .map(|(host, _)| host)
            .unwrap_or(host_port)
    } else {
        host_port
    };
    Some((scheme, hostname.to_lowercase()))
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                out.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_follow_the_python_rules() {
        for host in ["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]", ""] {
            assert!(is_loopback_host(host), "{host}");
        }
        for host in [
            "evil.example",
            "128.0.0.1",
            "127.0.0",
            "127.0.0.999",
            "10.0.0.1",
        ] {
            assert!(!is_loopback_host(host), "{host}");
        }
    }

    #[test]
    fn host_header_shapes() {
        assert_eq!(host_header_hostname("127.0.0.1:17865"), "127.0.0.1");
        assert_eq!(host_header_hostname("[::1]:17865"), "::1");
        assert_eq!(host_header_hostname("::1"), "::1");
        assert_eq!(host_header_hostname("evil.example:17865"), "evil.example");
    }

    #[test]
    fn percent_decoding_keeps_plus_and_decodes_utf8() {
        assert_eq!(percent_decode("note%20two"), "note two");
        assert_eq!(percent_decode("a+b"), "a+b");
        assert_eq!(percent_decode("caf%C3%A9"), "café");
        assert_eq!(percent_decode("%zz"), "%zz");
    }
}
