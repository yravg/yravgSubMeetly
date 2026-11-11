//! Loopback HTTP engine: the routes of native/server.py.
//!
//! `App` is transport-free so the golden replay can call `handle` directly;
//! `server` puts it behind std::net. Models load lazily on first ML request.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use crate::audio::pcm_f32_le;
use crate::calendar::{Calendar, Fail};
use crate::engine::{mt_engine, segments_json, Jobs, Ml, SavedModels, ASR_ENGINE};
use crate::heuristic::heuristic_notes;
use crate::locations::{
    dir_status, free_bytes, legacy_hubs, migrate_legacy, move_model, move_needs, probe_dir,
    pull_needs, validate_dir, Locations, ModelDirUnavailable, MoveJob,
};
use crate::models::{
    cache_state, catalog_spec, delete_cached, hub_cache_dir, model_root, scan_model_cache, Kind,
    ModelNotDownloaded, PullProgress, CATALOG,
};
use crate::notes::{
    export_note_md, export_note_txt, normalize_note_doc, py_str, py_truthy, safe_filename,
};
use crate::protocol::{AskReply, Request, Response};
use crate::state::{now_epoch_secs, now_utc_iso};
use crate::translate::norm_lang;
use crate::whisper::Task;

const ENGINE_MODES: [&str; 3] = ["fast", "balanced", "accurate"];
const DEVICE_CHOICES: [&str; 3] = ["auto", "cpu", "cuda"];
const UI_THEMES: [&str; 3] = ["auto", "light", "dark"];
const UI_RESKINS: [&str; 4] = ["yraverage", "coretax", "modern", "tide"];
const UI_SURFACES: [&str; 3] = ["overlay", "island", "both"];
const TARGET_LANGS: [&str; 11] = [
    "en", "zh", "de", "fr", "es", "ru", "it", "id", "vi", "ja", "ko",
];
/// Turns of the conversation the model sees, and the longest answer it gives.
const ASK_HISTORY: usize = 6;
const ASK_MAX_TOKENS: usize = 512;
const NO_TRANSLATE: &str = "no translation model (set TRANSLATE=on)";
const CUDA_WARNING: &str = "CUDA tidak terdeteksi — helper akan jatuh ke CPU saat start";

fn live_idle() -> Value {
    json!({ "seq": 0, "source": "", "translation": "", "ms": null, "audio_s": null, "rtf": null, "at": null })
}

/// A model download started by `POST /models/pull`. A finished one is dropped (the
/// cache says it is downloaded); a failed one stays until the next try, with its reason.
struct Pull {
    progress: Arc<PullProgress>,
    /// Catalog size, until the hub reports the real one.
    approx_bytes: u64,
    error: Option<String>,
}

/// A model move started by `POST /engine/models/location`. A finished one is dropped (the
/// row shows the new folder); a failed one stays until the next try, with its reason.
struct Move {
    done: Arc<AtomicU64>,
    total: u64,
    phase: &'static str,
    running: bool,
    error: Option<String>,
    /// Moved and switched, but the old copy could not be deleted yet.
    warning: Option<String>,
}

/// Downloads and moves in flight, by model id. One lock, so a model is never both.
#[derive(Default)]
struct Transfers {
    pulls: HashMap<String, Pull>,
    moves: HashMap<String, Move>,
}

impl Transfers {
    /// What is running on `id` right now.
    fn busy(&self, id: &str) -> Option<&'static str> {
        if self.moves.get(id).is_some_and(|m| m.running) {
            Some("moving")
        } else if self.pulls.get(id).is_some_and(|p| p.error.is_none()) {
            Some("downloading")
        } else {
            None
        }
    }
}

type SharedTransfers = Arc<Mutex<Transfers>>;

fn transfers_lock(transfers: &Mutex<Transfers>) -> std::sync::MutexGuard<'_, Transfers> {
    transfers.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct App {
    state_dir: PathBuf,
    models_path: PathBuf,
    transfers: SharedTransfers,
    locations: Arc<Locations>,
    notes_path: PathBuf,
    engine_mode_path: PathBuf,
    device_pref_path: PathBuf,
    ui_prefs_path: PathBuf,
    allowed_origins: Vec<String>,
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
        let models_path = env_path("ENGINE_MODELS_PATH", state_dir.join("engine-models.json"));
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
        let saved = read_json(&models_path).map_or_else(SavedModels::default, |value| {
            let text = |key| value.get(key).and_then(Value::as_str).map(str::to_string);
            SavedModels {
                asr: text("asr"),
                translate: text("translate"),
            }
        });
        let locations = Arc::new(Locations::load(
            env_path(
                "ENGINE_LOCATIONS_PATH",
                state_dir.join("engine-locations.json"),
            ),
            hub_cache_dir(),
        ));
        // Finish what a crash or an unplugged drive left half done (can take a while: a
        // multi-gigabyte delete), so not on the start path.
        let cleanup = Arc::clone(&locations);
        let _ = std::thread::Builder::new()
            .name("locations-recover".into())
            .spawn(move || {
                for note in cleanup.recover() {
                    eprintln!("[models] {note}");
                }
            });
        Self {
            calendar: Calendar::new(state_dir.clone()),
            state_dir,
            models_path,
            transfers: SharedTransfers::default(),
            notes_path,
            engine_mode_path,
            device_pref_path,
            ui_prefs_path,
            allowed_origins,
            ml: Arc::new(Ml::from_env(&device_pref, &saved, Arc::clone(&locations))),
            locations,
            jobs: Jobs::default(),
            shutdown: AtomicBool::new(false),
            live: Mutex::new(live_idle()),
        }
    }

    /// Point the model-cache routes at another hub cache (tests).
    /// One-time job for engine start: models older installs downloaded into `C:/tmp` (HOME
    /// was unset) are copied into the real cache. Run it on a thread: it can copy gigabytes.
    pub fn legacy_migration(&self) -> impl FnOnce() + Send + 'static {
        let locations = Arc::clone(&self.locations);
        move || {
            let wanted = |id: &str| locations.custom(id).is_none();
            let lines = migrate_legacy(&legacy_hubs(), &locations.default_dir(), &wanted);
            for line in lines {
                eprintln!("[models] {line}");
            }
        }
    }

    pub fn set_hf_cache(&mut self, dir: PathBuf) {
        self.locations.set_default(dir);
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
        if let Some(response) = self.ai_get(request) {
            return response;
        }
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
            "/models" => self.json_response(request, 200, self.models_body()),
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
        if let Some(response) = self.ai_post(request) {
            return response;
        }
        let path = request.path();
        match path {
            "/engine/device" => self.post_engine_device(request),
            "/engine/mode" => self.post_engine_mode(request),
            "/engine/models" => self.post_engine_models(request),
            "/engine/models/location" => self.post_models_location(request),
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
                    Err(error) => self.ml_error_response(request, &error),
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

    /// The JSON answer for a route whose model is away, not downloaded, or that failed.
    fn ml_error_response(&self, request: &Request, error: &anyhow::Error) -> Response {
        // The model's folder is away: say which, so the UI can ask to reconnect it.
        if let Some(away) = error.downcast_ref::<ModelDirUnavailable>() {
            return self.json_response(
                request,
                503,
                json!({
                    "error": format!("Error: {error:#}"),
                    "code": "model-dir-unavailable",
                    "id": away.id,
                    "dir": away.dir.to_string_lossy(),
                    "reason": away.reason,
                }),
            );
        }
        // Only POST /models/pull downloads: a route that needs a model that is not
        // on disk answers at once, so a caption loop never waits on a download.
        if let Some(missing) = error.downcast_ref::<ModelNotDownloaded>() {
            return self.json_response(
                request,
                409,
                json!({
                    "error": missing.to_string(),
                    "code": "model-not-downloaded",
                    "id": missing.id,
                }),
            );
        }
        self.json_response(
            request,
            500,
            json!({ "error": format!("Error: {error:#}") }),
        )
    }

    /// `POST /ask` (Ask Tide, local mode): `{question, grounding, history?}` answered by the
    /// local Qwen model as Server-Sent Events `{delta}` ... `{done}` or `{error}`.
    pub fn handle_ask<'a>(&'a self, request: &Request) -> AskReply<'a> {
        let plain = |response| AskReply::Reply(response);
        if let Some(denied) = self.local_only(request) {
            return plain(denied);
        }
        if request.method != "POST" || request.path() != "/ask" {
            return plain(self.json_response(request, 404, json!({ "error": "not found" })));
        }
        let Some(payload) = parse_body(&request.body) else {
            return plain(self.json_response(
                request,
                400,
                json!({ "error": "invalid JSON body" }),
            ));
        };
        let question = payload
            .get("question")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if question.is_empty() {
            return plain(self.json_response(
                request,
                400,
                json!({ "error": "question is required" }),
            ));
        }
        // The person's own endpoint answers when the connector is on; otherwise the local model.
        let connector =
            Some(crate::connector::load(&self.state_dir)).filter(crate::connector::Config::usable);
        if connector.is_none() {
            if !self.ml.translate_available() {
                return plain(self.json_response(request, 501, json!({ "error": NO_TRANSLATE })));
            }
            if let Err(error) = self.ml.require_translate() {
                return plain(self.ml_error_response(request, &error));
            }
        }
        let mut turns = Vec::new();
        for turn in payload
            .get("history")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let role = turn.get("role").and_then(Value::as_str).unwrap_or("");
            let content = turn.get("content").and_then(Value::as_str).unwrap_or("");
            if matches!(role, "user" | "assistant") && !content.is_empty() {
                turns.push((role.to_string(), content.to_string()));
            }
        }
        let skip = turns.len().saturating_sub(ASK_HISTORY);
        turns.drain(..skip);
        turns.push(("user".to_string(), question.to_string()));
        let grounding = payload
            .get("grounding")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut headers = self.cors_headers(request);
        headers.push((
            "Content-Type".into(),
            "text/event-stream; charset=utf-8".into(),
        ));
        headers.push(("Cache-Control".into(), "no-cache".into()));
        AskReply::Stream {
            headers,
            run: Box::new(move |emit| {
                if let Some(cfg) = &connector {
                    match crate::connector::chat(
                        cfg,
                        &grounding,
                        &turns,
                        ASK_MAX_TOKENS as u32,
                        &mut |piece| {
                            emit(&json!({ "delta": piece }));
                        },
                    ) {
                        Ok(_) => emit(&json!({ "done": true })),
                        Err(error) => emit(&json!({ "error": format!("{error:#}") })),
                    };
                    return;
                }
                let result = self.ml.with_translator(|mt| {
                    mt.chat_stream(&grounding, &turns, ASK_MAX_TOKENS, &mut |piece| {
                        emit(&json!({ "delta": piece }))
                    })
                });
                match result {
                    Ok(()) => emit(&json!({ "done": true })),
                    Err(error) => emit(&json!({ "error": format!("{error:#}") })),
                };
            }),
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
        let tgt = target_lang(q.get("tgt").map(String::as_str));
        let accurate = self.load_engine_mode() == "accurate";
        let started = std::time::Instant::now();
        let ms = || started.elapsed().as_millis() as u64;
        // Each route's model must already be on disk; none of them downloads.
        let ready = match path {
            "/translate" | "/translate_refine" if !self.ml.translate_available() => Ok(()),
            "/translate" | "/translate_refine" => self.ml.require_translate(),
            // Under 1600 samples (4 bytes each) the route answers empty without a model.
            "/transcribe" | "/draft" if request.body.len() < 1600 * 4 => Ok(()),
            _ => self.ml.require_asr(),
        };
        if let Err(error) = ready {
            if let Some(file) = &request.body_file {
                let _ = fs::remove_file(file);
            }
            return Err(error);
        }
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
                let out = if fast {
                    self.ml.translate_fast(&text, &src, &tgt)?
                } else {
                    self.ml
                        .with_translator(|mt| mt.translate(&text, &src, &tgt, false))?
                };
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
        // An interim (the island's growing utterance) is shown by whoever asked; only a final is the
        // caption `GET /live` follows, so the page's previous-line history stays whole sentences.
        let interim = q.get("interim").is_some_and(|v| v == "1");
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
        let downloaded = self.ml.translate_downloaded();
        let (mt, state) = draft_translation(
            self.ml.translate_available(),
            downloaded,
            self.ml.translate_loaded(),
            src,
            tgt,
        );
        if state == "loading" && !self.ml.translate_loading() {
            // Load in the background; this caption goes out without it.
            // shortcut: a load that keeps failing is retried by every caption (logged
            // each time), a retry limit when it shows up in practice.
            let ml = Arc::clone(&self.ml);
            let _ = std::thread::Builder::new()
                .name("translate-load".into())
                .spawn(move || {
                    if let Err(error) = ml.with_translator(|_| Ok(())) {
                        eprintln!("[translate] load failed: {error:#}");
                    }
                });
        }
        match mt {
            DraftMt::Model => {}
            DraftMt::WhisperEnglish => {
                // No ready translation model: Whisper's own translate task gives English.
                let mt_start = std::time::Instant::now();
                let translation = self.ml.text(&pcm, language, Task::Translate)?;
                let translate_ms = mt_start.elapsed().as_millis() as u64;
                if !interim {
                    self.record_live(&source, &translation, ms(), pcm.len());
                }
                return Ok(self.json_response(
                    request,
                    200,
                    json!({
                        "source": source,
                        "translation": translation,
                        "ms": ms(),
                        "asr_ms": asr_ms,
                        "translate_ms": translate_ms,
                        "translate_via": "whisper",
                        "translateState": state,
                    }),
                ));
            }
            DraftMt::SourceOnly => {
                // Same language needs no translation; otherwise the translation is empty.
                let translation = if src == tgt { source.as_str() } else { "" };
                if !interim {
                    self.record_live(&source, translation, ms(), pcm.len());
                }
                return Ok(self.json_response(
                    request,
                    200,
                    json!({
                        "source": source,
                        "translation": translation,
                        "ms": ms(),
                        "asr_ms": asr_ms,
                        "translateState": state,
                    }),
                ));
            }
        }
        let mt_start = std::time::Instant::now();
        let translation = if accurate {
            self.ml
                .with_translator(|mt| mt.translate(&source, src, tgt, false))?
        } else {
            self.ml.translate_fast(&source, src, tgt)?
        };
        let translate_ms = mt_start.elapsed().as_millis() as u64;
        if !interim {
            self.record_live(&source, &translation, ms(), pcm.len());
        }
        Ok(self.json_response(
            request,
            200,
            json!({
                "source": source,
                "translation": translation,
                "ms": ms(),
                "asr_ms": asr_ms,
                "translate_ms": translate_ms,
                "translateState": state,
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
        let mut note = heuristic_notes(
            &lines,
            &text("title", "Notulen sesi"),
            &text("source", "helper"),
        );
        let texts: Vec<String> = lines
            .iter()
            .map(crate::heuristic::line_text)
            .filter(|t| !t.is_empty())
            .collect();
        let template = match crate::templates::resolve(&self.state_dir, payload.get("template")) {
            Ok(t) => t,
            Err(e) => return self.json_response(request, 400, json!({ "error": e.to_string() })),
        };
        // Summarize with the connector on: the person's endpoint writes it (and says so in `via`);
        // any failure falls back to the local notes. Generate never leaves the device.
        let cfg = crate::connector::load(&self.state_dir);
        let remote = summarize && cfg.usable();
        let template = template.or_else(|| {
            remote
                .then(|| crate::templates::find(&self.state_dir, "general"))
                .flatten()
        });
        let mut extra = json!({});
        if let Some(t) = &template {
            let mut rendered = crate::templates::render_local(t, &note, &texts);
            extra["via"] = json!("local");
            if remote {
                let transcript = clip_transcript(&texts);
                match crate::connector::chat(
                    &cfg,
                    &crate::templates::system_prompt(t),
                    &[("user".to_string(), transcript)],
                    1500,
                    &mut |_| {},
                ) {
                    Ok(answer) => {
                        let sections = crate::templates::parse_markdown(t, &answer);
                        let md = crate::templates::markdown(&t.style, &sections);
                        by_kind(&mut note, &sections);
                        rendered =
                            json!({ "template": t.id, "sections": sections, "markdown": md });
                        extra["via"] = json!("connector");
                    }
                    Err(e) => extra["connectorError"] = json!(format!("{e:#}")),
                }
            }
            if let (Value::Object(map), Value::Object(r)) = (&mut extra, rendered) {
                map.extend(r);
            }
        }
        if !summarize {
            if let (Value::Object(n), Value::Object(x)) = (&mut note, extra) {
                n.extend(x);
            }
            return self.json_response(request, 200, json!({ "note": note }));
        }
        let count = |key: &str| note[key].as_array().map_or(0, Vec::len);
        let mut body = json!({
            "summary": note["summary"],
            "decisions": note["decisions"],
            "actions": note["actions"],
            "counts": {
                "segments": lines.len(),
                "decisions": count("decisions"),
                "actions": count("actions"),
            },
        });
        if let (Value::Object(b), Value::Object(x)) = (&mut body, extra) {
            b.extend(x);
        }
        self.json_response(request, 200, body)
    }

    /// Cache, folder, download and move state of one model, the same fields on every row.
    fn model_status(&self, id: &str, kind: Kind) -> Map<String, Value> {
        let dir = self.locations.dir_for(id);
        let custom = self.locations.custom(id).is_some();
        let dir_state = if custom { dir_status(&dir) } else { Ok(()) };
        let cache = cache_state(&dir, id, kind);
        let transfers = transfers_lock(&self.transfers);
        let pull = transfers.pulls.get(id);
        let moved = transfers.moves.get(id);
        let moving = moved.is_some_and(|m| m.running);
        let (move_done, move_total) =
            moved.map_or((0, 0), |m| (m.done.load(Ordering::Relaxed), m.total));
        let running = pull.is_some_and(|p| p.error.is_none());
        let (done, total) = pull.filter(|_| running).map_or((0, 0), |p| {
            // The hub reports a file's size when it starts, so before the last file
            // the total is an estimate; never let it sit below what is already done.
            let done = p.progress.bytes_done();
            (done, p.approx_bytes.max(done))
        });
        let Value::Object(status) = json!({
            "downloaded": cache.downloaded,
            "bytes": cache.bytes,
            "partialBytes": cache.partial_bytes,
            "pulling": running,
            "bytesDone": done,
            "bytesTotal": total,
            // Held at 99 until the last file lands: the total is an estimate.
            "pct": if running && total > 0 { json!((done * 99 / total).min(99)) } else { Value::Null },
            "pullError": pull.and_then(|p| p.error.clone()),
            // Where the model lives: the default cache, or the folder the user chose.
            "dir": dir.to_string_lossy(),
            "dirIsDefault": !custom,
            "dirAvailable": dir_state.is_ok(),
            "dirError": dir_state.as_ref().err(),
            "freeBytes": if dir_state.is_ok() { json!(free_bytes(&dir)) } else { Value::Null },
            "moving": moving,
            "moveBytesDone": move_done,
            "moveBytesTotal": move_total,
            "movePct": if moving && move_total > 0 { json!((move_done * 99 / move_total).min(99)) } else { Value::Null },
            "movePhase": moved.filter(|_| moving).map(|m| m.phase),
            "moveError": moved.and_then(|m| m.error.clone()),
            "moveWarning": moved.and_then(|m| m.warning.clone()),
        }) else {
            unreachable!("object literal")
        };
        status
    }

    fn model_inventory(&self) -> Vec<Value> {
        let device = self.ml.device_name();
        let mt = self.ml.translate_available();
        let asr = self.ml.asr_id();
        let translate = self.ml.translate_id();
        let mut asr_row = json!({
            "key": "asr",
            "kind": "asr",
            "id": asr,
            "engine": ASR_ENGINE,
            "device": device,
            "available": true,
            "loaded": self.ml.asr_loaded(),
            "loading": self.ml.asr_loading(),
            "fromEnv": self.ml.asr_from_env(),
        });
        let mut translate_row = json!({
            "key": "translate",
            "kind": "translate",
            "id": translate,
            "engine": match &translate {
                Some(id) if mt => Value::from(mt_engine(id)),
                _ => Value::Null,
            },
            "device": device,
            "available": mt,
            "loaded": self.ml.translate_loaded(),
            "loading": self.ml.translate_loading(),
            "fromEnv": self.ml.translate_from_env(),
        });
        asr_row
            .as_object_mut()
            .expect("object")
            .extend(self.model_status(&asr, Kind::Asr));
        let translate_status = match &translate {
            Some(id) => self.model_status(id, Kind::Translate),
            None => Map::new(),
        };
        translate_row
            .as_object_mut()
            .expect("object")
            .extend(translate_status);
        vec![asr_row, translate_row]
    }

    fn catalog_rows(&self) -> Vec<Value> {
        let (asr, translate) = (self.ml.asr_id(), self.ml.translate_id());
        CATALOG
            .iter()
            .map(|spec| {
                let mut row = json!({
                    "kind": spec.kind.as_str(),
                    "id": spec.id,
                    "label": spec.label,
                    "approxBytes": spec.approx_bytes,
                    "selected": match spec.kind {
                        Kind::Asr => asr == spec.id,
                        Kind::Translate => translate.as_deref() == Some(spec.id),
                        // Never chosen: used for its pair whenever it is downloaded.
                        Kind::PairMt => false,
                    },
                });
                row.as_object_mut()
                    .expect("object")
                    .extend(self.model_status(spec.id, spec.kind));
                row
            })
            .collect()
    }

    fn models_body(&self) -> Value {
        // The translation model to offer first, and whether it is on disk: when it is not, a
        // picker shows its download even though an older model may be translating meanwhile.
        let (recommended, downloaded) = self.ml.translate_recommended();
        json!({
            "models": self.model_inventory(),
            "catalog": self.catalog_rows(),
            "cached": self.cached_rows(),
            "recommended": { "id": recommended, "downloaded": downloaded },
        })
    }

    /// `cached[]`: the scan of the default cache, plus the models kept in a folder of
    /// their own, each tagged with it.
    fn cached_rows(&self) -> Vec<Value> {
        let mut rows = scan_model_cache(&self.locations.default_dir());
        let mut seen: Vec<PathBuf> = Vec::new();
        for (_, dir) in self.locations.all_custom() {
            if seen.contains(&dir) {
                continue;
            }
            seen.push(dir.clone());
            for mut row in scan_model_cache(&dir) {
                let mine = row["id"]
                    .as_str()
                    .is_some_and(|id| self.locations.custom(id).as_ref() == Some(&dir));
                if mine {
                    row["dir"] = json!(dir.to_string_lossy());
                    rows.push(row);
                }
            }
        }
        rows
    }

    /// Ids the engine runs now: the ones `/models/cache` must not delete.
    fn inventory_ids(&self) -> Vec<String> {
        let mut ids = vec![self.ml.asr_id()];
        ids.extend(self.ml.translate_id());
        ids
    }

    /// The kind of a model the engine can download: a catalog entry or an active one.
    fn model_kind(&self, id: &str) -> Option<Kind> {
        catalog_spec(id).map(|spec| spec.kind).or_else(|| {
            if self.ml.asr_id() == id {
                Some(Kind::Asr)
            } else {
                (self.ml.translate_id().as_deref() == Some(id)).then_some(Kind::Translate)
            }
        })
    }

    /// Starts the download in the background and answers 202 at once; progress is
    /// on the model's row in `GET /models`.
    fn post_models_pull(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let want = match payload.get("id") {
            Some(id) if py_truthy(id) => py_str(id).trim().to_string(),
            _ => String::new(),
        };
        let Some(kind) = self.model_kind(&want) else {
            return self.json_response(
                request,
                400,
                json!({ "error": "id must be one of the /models inventory ids" }),
            );
        };
        let source = match payload.get("source").and_then(Value::as_str) {
            None => crate::ml::Source::default(),
            Some(s) => match crate::ml::Source::parse(s) {
                Some(source) => source,
                None => {
                    return self.json_response(
                        request,
                        400,
                        json!({ "error": "source must be huggingface or modelscope" }),
                    )
                }
            },
        };
        let status = |started: bool| {
            self.model_reply(&want, kind, json!({ "ok": true, "started": started }))
        };
        let refuse = |code: u16, tag: &str, error: String| {
            let body = self.model_reply(
                &want,
                kind,
                json!({ "ok": false, "error": error, "code": tag }),
            );
            self.json_response(request, code, body)
        };
        // A custom folder that is away is an error, never a download somewhere else.
        let cache = match self.locations.usable_dir(&want) {
            Ok(cache) => cache,
            Err(away) => return refuse(409, "model-dir-unavailable", away.to_string()),
        };
        let state = cache_state(&cache, &want, kind);
        if state.downloaded {
            return self.json_response(request, 200, status(false));
        }
        let approx_bytes = catalog_spec(&want).map_or(0, |spec| spec.approx_bytes);
        if approx_bytes > 0 {
            let need = pull_needs(approx_bytes, state.bytes + state.partial_bytes);
            if let Some(free) = free_bytes(&cache).filter(|free| *free < need) {
                return refuse(
                    400,
                    "not-enough-space",
                    format!(
                        "not enough free space in {}: {want} needs about {} MB, {} MB is free",
                        cache.display(),
                        need / 1_000_000,
                        free / 1_000_000
                    ),
                );
            }
        }
        let progress = {
            let mut transfers = transfers_lock(&self.transfers);
            match transfers.busy(&want) {
                Some("moving") => {
                    drop(transfers);
                    return refuse(
                        409,
                        "busy",
                        format!("{want} is being moved; try again when it is done"),
                    );
                }
                Some(_) => {
                    drop(transfers);
                    return self.json_response(request, 202, status(false));
                }
                None => {}
            }
            let pull = Pull {
                progress: Arc::default(),
                approx_bytes,
                error: None,
            };
            let progress = Arc::clone(&pull.progress);
            transfers.pulls.insert(want.clone(), pull);
            progress
        };
        let (transfers, id) = (Arc::clone(&self.transfers), want.clone());
        std::thread::Builder::new()
            .name(format!("pull-{id}"))
            .spawn(move || {
                let result = crate::ml::with_source(source, || {
                    crate::models::pull(&cache, &id, kind, &progress)
                });
                let mut transfers = transfers_lock(&transfers);
                match result {
                    Ok(()) => {
                        transfers.pulls.remove(&id);
                    }
                    Err(error) => {
                        eprintln!("[pull] {id} from {}: {error:#}", source.label());
                        if let Some(pull) = transfers.pulls.get_mut(&id) {
                            pull.error =
                                Some(format!("download failed ({}): {error:#}", source.label()));
                        }
                    }
                }
            })
            .expect("spawn pull thread");
        self.json_response(request, 202, status(true))
    }

    /// The body every models answer carries: what the caller asked, plus the model's row.
    fn model_reply(&self, id: &str, kind: Kind, mut body: Value) -> Value {
        body.as_object_mut()
            .expect("object")
            .extend(self.model_status(id, kind));
        body["id"] = json!(id);
        body
    }

    /// Choose the folder one model is stored in (`dir` null = the default cache). A
    /// downloaded model is moved there in the background; nothing changes until the copy
    /// is verified, and a failure leaves the old copy and the old folder in place.
    fn post_models_location(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let id = payload
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let Some(kind) = self.model_kind(id) else {
            return self.json_response(
                request,
                400,
                json!({ "error": "id must be one of the /models inventory ids" }),
            );
        };
        let refuse = |status: u16, code: &str, error: String, extra: Value| {
            let mut body = self.model_reply(
                id,
                kind,
                json!({ "ok": false, "error": error, "code": code }),
            );
            body.as_object_mut()
                .expect("object")
                .extend(extra.as_object().cloned().unwrap_or_default());
            self.json_response(request, status, body)
        };
        let target = match payload.get("dir") {
            None => {
                return refuse(
                    400,
                    "bad-dir",
                    "body needs dir: an absolute folder, or null for the default".into(),
                    json!({}),
                );
            }
            Some(Value::Null) => None,
            Some(Value::String(dir)) if dir.trim().is_empty() => None,
            Some(Value::String(dir)) => match validate_dir(dir) {
                Ok(dir) => Some(dir),
                Err(error) => return refuse(400, "bad-dir", error, json!({})),
            },
            Some(_) => {
                return refuse(
                    400,
                    "bad-dir",
                    "dir must be a string or null".into(),
                    json!({}),
                )
            }
        };
        let to = target
            .clone()
            .unwrap_or_else(|| self.locations.default_dir());
        let from = self.locations.dir_for(id);
        let busy = |transfers: &Transfers| {
            transfers.busy(id).map(|what| {
                refuse(
                    409,
                    "busy",
                    format!("{id} is {what}; try again when it is done"),
                    json!({}),
                )
            })
        };
        if let Some(response) = busy(&transfers_lock(&self.transfers)) {
            return response;
        }
        let same = from == to
            || from
                .to_string_lossy()
                .eq_ignore_ascii_case(&to.to_string_lossy());
        if same {
            return self.json_response(
                request,
                200,
                self.model_reply(
                    id,
                    kind,
                    json!({ "ok": true, "started": false, "moved": false }),
                ),
            );
        }
        let probe = match probe_dir(&to) {
            Ok(probe) => probe,
            Err(error) => return refuse(400, "dir-not-writable", error, json!({})),
        };
        let state = cache_state(&from, id, kind);
        if !state.downloaded {
            // Nothing to copy: the model will download into the new folder.
            let transfers = transfers_lock(&self.transfers);
            if let Some(response) = busy(&transfers) {
                return response;
            }
            let saved = self.locations.set(id, target.as_deref());
            drop(transfers);
            return match saved {
                Ok(()) => self.json_response(
                    request,
                    200,
                    self.model_reply(
                        id,
                        kind,
                        json!({ "ok": true, "started": false, "moved": false }),
                    ),
                ),
                Err(error) => refuse(
                    500,
                    "save-failed",
                    format!("could not save the folder: {error}"),
                    json!({}),
                ),
            };
        }
        if model_root(&to, id).exists() {
            return refuse(
                409,
                "target-has-copy",
                format!(
                    "{} already holds a copy of {id}; remove it or pick another folder",
                    to.display()
                ),
                json!({}),
            );
        }
        let need = move_needs(state.bytes, probe.hard_links);
        if let Some(free) = free_bytes(&to).filter(|free| *free < need) {
            return refuse(
                400,
                "not-enough-space",
                format!(
                    "not enough free space in {}: needs about {} MB, {} MB is free",
                    to.display(),
                    need / 1_000_000,
                    free / 1_000_000
                ),
                json!({ "needBytes": need, "freeBytes": free }),
            );
        }
        let done = Arc::new(AtomicU64::new(0));
        {
            let mut transfers = transfers_lock(&self.transfers);
            if let Some(response) = busy(&transfers) {
                return response;
            }
            transfers.moves.insert(
                id.to_string(),
                Move {
                    done: Arc::clone(&done),
                    total: state.bytes,
                    phase: "copying",
                    running: true,
                    error: None,
                    warning: None,
                },
            );
        }
        let (transfers, locations, id_owned) = (
            Arc::clone(&self.transfers),
            Arc::clone(&self.locations),
            id.to_string(),
        );
        std::thread::Builder::new()
            .name(format!("move-{id}"))
            .spawn(move || {
                let phase_to = |phase: &'static str| {
                    if let Some(entry) = transfers_lock(&transfers).moves.get_mut(&id_owned) {
                        entry.phase = phase;
                    }
                };
                let job = MoveJob {
                    id: &id_owned,
                    kind,
                    from: &from,
                    to: &to,
                };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    move_model(
                        &locations,
                        &job,
                        &done,
                        &mut |phase| phase_to(phase),
                        &mut |_| Ok(()),
                    )
                }))
                .unwrap_or_else(|_| Err(anyhow::anyhow!("the move stopped unexpectedly")));
                let mut transfers = transfers_lock(&transfers);
                match result {
                    Ok(None) => {
                        transfers.moves.remove(&id_owned);
                    }
                    Ok(Some(warning)) => {
                        eprintln!("[move] {id_owned}: {warning}");
                        if let Some(entry) = transfers.moves.get_mut(&id_owned) {
                            entry.running = false;
                            entry.warning = Some(warning);
                        }
                    }
                    Err(error) => {
                        eprintln!("[move] {id_owned}: {error:#}");
                        if let Some(entry) = transfers.moves.get_mut(&id_owned) {
                            entry.running = false;
                            entry.error = Some(format!("{error:#}"));
                        }
                    }
                }
            })
            .expect("spawn move thread");
        self.json_response(
            request,
            202,
            self.model_reply(
                id,
                kind,
                json!({ "ok": true, "started": true, "moved": false }),
            ),
        )
    }

    /// Choose the speech and/or translation model. Saved like `/engine/mode`, applied
    /// at once: the old model is dropped on the next request, and a model that is not
    /// downloaded yet is fetched then (so the first request after the switch is slow).
    fn post_engine_models(&self, request: &Request) -> Response {
        let Some(payload) = parse_body(&request.body) else {
            return self.json_response(request, 400, json!({ "error": "invalid JSON body" }));
        };
        let wanted = |key: &str| payload.get(key).and_then(Value::as_str).map(str::trim);
        let (asr, translate) = (wanted("asr"), wanted("translate"));
        if asr.is_none() && translate.is_none() {
            return self.json_response(
                request,
                400,
                json!({ "error": "body needs asr and/or translate (a catalog id; translate may be \"off\")" }),
            );
        }
        let asr = asr.map(crate::whisper::repo_for);
        let known = |id: &str, kind: Kind| catalog_spec(id).is_some_and(|spec| spec.kind == kind);
        let bad = asr.as_deref().is_some_and(|id| !known(id, Kind::Asr))
            || translate.is_some_and(|id| id != "off" && !known(id, Kind::Translate));
        if bad {
            let allowed: Vec<&str> = CATALOG
                .iter()
                .filter(|spec| spec.kind != Kind::PairMt)
                .map(|spec| spec.id)
                .collect();
            return self.json_response(
                request,
                400,
                json!({ "error": "id must be one of the /models catalog ids", "allowed": allowed }),
            );
        }
        let mut saved = read_json(&self.models_path).unwrap_or_else(|| json!({}));
        let mut applied = Map::new();
        if let Some(id) = &asr {
            saved["asr"] = json!(id);
            applied.insert("asr".into(), json!(self.ml.set_asr(id)));
        }
        if let Some(id) = translate {
            saved["translate"] = json!(id);
            let on = (id != "off").then_some(id);
            applied.insert("translate".into(), json!(self.ml.set_translate(on)));
        }
        write_json(&self.models_path, saved);
        self.json_response(
            request,
            200,
            json!({
                "ok": true,
                "asr": self.ml.asr_id(),
                "translate": self.ml.translate_id(),
                // false: an env var (WHISPER_MODEL, TRANSLATE, TRANSLATE_MODEL) pins that
                // kind; the choice is saved but does not apply until the env var goes.
                "applied": applied,
            }),
        )
    }

    fn delete(&self, request: &Request) -> Response {
        if let Some(id) = request.path().strip_prefix("/notes/templates/") {
            return match crate::templates::delete(&self.state_dir, &percent_decode(id)) {
                Ok(true) => self.json_response(request, 200, json!({ "ok": true })),
                Ok(false) => {
                    self.json_response(request, 404, json!({ "error": "template not found" }))
                }
                Err(e) => self.json_response(request, 400, json!({ "error": e.to_string() })),
            };
        }
        let path = request.path();
        if let Some(rest) = path.strip_prefix("/models/cache/") {
            let q = query(&request.target);
            let confirm = matches!(
                q.get("confirm").map(String::as_str),
                Some("1" | "true" | "yes")
            );
            let slug = percent_decode(rest);
            let id = slug.replacen("--", "/", 1);
            let busy = transfers_lock(&self.transfers).busy(&id);
            let (status, body) = match (busy, self.locations.usable_dir(&id)) {
                (Some(what), _) => (
                    409,
                    json!({ "error": format!("{id} is {what}; try again when it is done"), "code": "busy" }),
                ),
                (None, Err(away)) => (
                    409,
                    json!({ "error": away.to_string(), "code": "model-dir-unavailable" }),
                ),
                (None, Ok(dir)) => delete_cached(&dir, &slug, &self.inventory_ids(), confirm),
            };
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

    /// `GET /ai/connector` (the saved connector, without its key) and `GET /notes/templates`.
    fn ai_get(&self, request: &Request) -> Option<Response> {
        match request.path() {
            "/ai/connector" => Some(self.json_response(
                request,
                200,
                crate::connector::load(&self.state_dir).public(),
            )),
            "/notes/templates" => {
                Some(self.json_response(request, 200, crate::templates::list_json(&self.state_dir)))
            }
            _ => None,
        }
    }

    /// `POST /ai/connector`, `/ai/connector/test` and `/notes/templates`.
    fn ai_post(&self, request: &Request) -> Option<Response> {
        let path = request.path();
        if !matches!(
            path,
            "/ai/connector"
                | "/ai/connector/test"
                | "/notes/templates"
                | "/notes/templates/default"
        ) {
            return None;
        }
        let Some(body) = parse_body(&request.body) else {
            return Some(self.json_response(request, 400, json!({ "error": "invalid JSON body" })));
        };
        let current = crate::connector::load(&self.state_dir);
        Some(match path {
            "/ai/connector" => match crate::connector::apply_patch(&current, &body)
                .and_then(|cfg| crate::connector::save(&self.state_dir, &cfg).map(|()| cfg))
            {
                Ok(cfg) => self.json_response(request, 200, cfg.public()),
                Err(e) => self.json_response(request, 400, json!({ "error": e.to_string() })),
            },
            "/ai/connector/test" => {
                // The test never needs the connector to be on: it tries the saved settings plus any given here.
                let mut probe = body.clone();
                probe["enabled"] = json!(false);
                match crate::connector::apply_patch(&current, &probe) {
                    Ok(cfg) => self.json_response(request, 200, crate::connector::test(&cfg)),
                    Err(e) => self.json_response(
                        request,
                        400,
                        json!({ "ok": false, "error": e.to_string() }),
                    ),
                }
            }
            "/notes/templates/default" => match crate::templates::set_default(
                &self.state_dir,
                body.get("id").and_then(Value::as_str),
            ) {
                Ok(()) => {
                    self.json_response(request, 200, crate::templates::list_json(&self.state_dir))
                }
                Err(e) => self.json_response(request, 400, json!({ "error": e.to_string() })),
            },
            _ => match crate::templates::upsert(&self.state_dir, &body) {
                Ok(t) => self.json_response(request, 200, json!({ "template": t.to_json() })),
                Err(e) => self.json_response(request, 400, json!({ "error": e.to_string() })),
            },
        })
    }

    fn health(&self) -> Value {
        let mt = self.ml.translate_available();
        json!({
            "ok": true,
            "engine": ASR_ENGINE,
            "engine_label": ASR_ENGINE,
            "model": self.ml.asr_id(),
            // Media is decoded in-process (symphonia), not by ffmpeg.
            "ffmpeg": false,
            "media_decoder": "symphonia",
            "translate": mt,
            "translate_model": self.ml.translate_id(),
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
        if !["theme", "reskin", "captionSurface", "srcLang", "tgtLang"]
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
            for (key, auto) in [("srcLang", true), ("tgtLang", false)] {
                if let Some(code) = saved.get(key).and_then(|v| ui_lang(v, auto)) {
                    prefs.insert(key.to_string(), Value::String(code));
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
        for (key, auto) in [("srcLang", true), ("tgtLang", false)] {
            if let Some(code) = patch.get(key).and_then(|v| ui_lang(v, auto)) {
                prefs.insert(key.to_string(), Value::String(code));
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

/// A language code for the shared UI prefs: letters, digits, `-`, `_`, 1..=12 chars;
/// "auto" only for the spoken language. Anything else is ignored, not stored.
fn ui_lang(value: &Value, allow_auto: bool) -> Option<String> {
    let code = value.as_str()?.trim();
    let valid = !code.is_empty()
        && code.chars().count() <= 12
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    (valid && (allow_auto || code != "auto")).then(|| code.to_string())
}

/// How `/draft` turns the source text into the target language.
#[derive(Debug, PartialEq, Eq)]
enum DraftMt {
    /// The translation model, loaded and ready.
    Model,
    /// No ready model, target English: Whisper's translate task answers now.
    WhisperEnglish,
    /// No ready model, other target: the source goes out with an empty translation.
    SourceOnly,
}

/// What a caption gets while translation is not ready. `chosen`: a model is selected;
/// `downloaded`: it is on disk; `loaded`: it is in memory. A caption never waits for a
/// download or a load: it gets the source (or Whisper's English) now, and
/// `translateState` says why ("off", "missing", "loading", or "ready").
/// The `tgt` of a request: a known language (else English), or `none` (the island's captions
/// without translation), which `norm_lang` would otherwise turn into English.
fn target_lang(raw: Option<&str>) -> String {
    match raw.map(str::trim) {
        Some("none") => "none".into(),
        other => norm_lang(other, "en"),
    }
}

fn draft_translation(
    chosen: bool,
    downloaded: bool,
    loaded: bool,
    src: &str,
    tgt: &str,
) -> (DraftMt, &'static str) {
    // The island's "translate captions" off: the spoken line only.
    if tgt == "none" {
        return (DraftMt::SourceOnly, "off");
    }
    let state = match (chosen, downloaded, loaded) {
        (false, ..) => "off",
        (true, false, _) => "missing",
        (true, true, false) => "loading",
        (true, true, true) => "ready",
    };
    let mt = if state == "ready" {
        DraftMt::Model
    } else if tgt == "en" && src != "en" {
        DraftMt::WhisperEnglish
    } else {
        DraftMt::SourceOnly
    };
    (mt, state)
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

/// The transcript for the connector: capped (head and tail kept) so a very long meeting still fits.
fn clip_transcript(texts: &[String]) -> String {
    const MAX: usize = 48_000;
    let all = texts.join("\n");
    if all.chars().count() <= MAX {
        return all;
    }
    let head: String = all.chars().take(MAX / 2).collect();
    let tail: String = all
        .chars()
        .rev()
        .take(MAX / 2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}\n[...middle of the transcript left out...]\n{tail}")
}

/// Fill the note's summary, decisions and actions from a connector's sections, by section kind.
fn by_kind(note: &mut Value, sections: &[Value]) {
    let items = |kind: &str| -> Vec<String> {
        sections
            .iter()
            .filter(|s| s["kind"] == kind)
            .flat_map(|s| s["items"].as_array().cloned().unwrap_or_default())
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect()
    };
    let summary = items("summary");
    if !summary.is_empty() {
        note["summary"] = json!(summary.join(" "));
    }
    let decisions = items("decisions");
    if !decisions.is_empty() {
        note["decisions"] = json!(decisions);
    }
    let actions = items("actions");
    if !actions.is_empty() {
        note["actions"] = Value::Array(actions.iter().enumerate().map(|(i, t)| json!({ "id": format!("act-{}", i + 1), "text": t, "owner": null, "due": null, "status": "open" })).collect());
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
    fn ui_lang_accepts_codes_and_rejects_the_rest() {
        let code = |v: Value, auto| ui_lang(&v, auto);
        assert_eq!(code(json!(" zh-CN "), false).as_deref(), Some("zh-CN"));
        assert_eq!(code(json!("auto"), true).as_deref(), Some("auto"));
        assert_eq!(code(json!("auto"), false), None);
        assert_eq!(code(json!(""), true), None);
        assert_eq!(code(json!("a b"), true), None);
        assert_eq!(code(json!("../../etc"), true), None);
        assert_eq!(code(json!("x".repeat(13)), true), None);
        assert_eq!(code(json!(7), true), None);
    }

    #[test]
    fn a_caption_never_waits_for_translation_to_download_or_load() {
        use DraftMt::*;
        // (chosen, downloaded, loaded) -> state; only a loaded model translates now.
        assert_eq!(
            draft_translation(true, true, true, "de", "en"),
            (Model, "ready")
        );
        assert_eq!(
            draft_translation(true, true, true, "de", "id"),
            (Model, "ready")
        );
        assert_eq!(
            draft_translation(true, true, false, "de", "id"),
            (SourceOnly, "loading")
        );
        assert_eq!(
            draft_translation(true, true, false, "de", "en"),
            (WhisperEnglish, "loading")
        );
        assert_eq!(
            draft_translation(true, false, false, "de", "id"),
            (SourceOnly, "missing")
        );
        assert_eq!(
            draft_translation(true, false, false, "auto", "en"),
            (WhisperEnglish, "missing")
        );
        assert_eq!(
            draft_translation(false, false, false, "de", "en"),
            (WhisperEnglish, "off")
        );
        assert_eq!(
            draft_translation(false, false, false, "de", "id"),
            (SourceOnly, "off")
        );
        assert_eq!(
            (
                target_lang(Some("none")).as_str(),
                target_lang(Some("xx")).as_str(),
                target_lang(None).as_str()
            ),
            ("none", "en", "en")
        );
        // The island asked for the spoken line only.
        assert_eq!(
            draft_translation(true, true, true, "de", "none"),
            (SourceOnly, "off")
        );
        // English speech to English needs no translation.
        assert_eq!(
            draft_translation(true, false, false, "en", "en"),
            (SourceOnly, "missing")
        );
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
