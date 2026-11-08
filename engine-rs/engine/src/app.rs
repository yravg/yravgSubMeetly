//! Loopback HTTP engine: the non-ML routes of native/server.py.
//!
//! `App` is transport-free so the golden replay can call `handle` directly;
//! `server` puts it behind std::net. ML routes intentionally answer 501.

use std::env;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::notes::{
    export_note_md, export_note_txt, normalize_note_doc, py_str, py_truthy, safe_filename,
};
use crate::protocol::{Request, Response};
use crate::state::now_utc_iso;

const ENGINE_MODES: [&str; 3] = ["fast", "balanced", "accurate"];
const DEVICE_CHOICES: [&str; 3] = ["auto", "cpu", "cuda"];
const UI_THEMES: [&str; 3] = ["auto", "light", "dark"];
const UI_RESKINS: [&str; 3] = ["yraverage", "coretax", "modern"];
const TARGET_LANGS: [&str; 11] = [
    "en", "zh", "de", "fr", "es", "ru", "it", "id", "vi", "ja", "ko",
];
const ML_NOT_IMPLEMENTED: &str = "not-implemented-in-rust";
const CUDA_WARNING: &str = "CUDA tidak terdeteksi — helper akan jatuh ke CPU saat start";

pub struct App {
    state_dir: PathBuf,
    notes_path: PathBuf,
    engine_mode_path: PathBuf,
    device_pref_path: PathBuf,
    ui_prefs_path: PathBuf,
    allowed_origins: Vec<String>,
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
        Self {
            state_dir,
            notes_path,
            engine_mode_path,
            device_pref_path,
            ui_prefs_path,
            allowed_origins,
        }
    }

    pub fn state_dir(&self) -> &PathBuf {
        &self.state_dir
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
            "/notes" => self.json_response(request, 200, json!({ "notes": self.load_notes() })),
            "/engine/mode" => {
                self.json_response(request, 200, json!({ "mode": self.load_engine_mode() }))
            }
            "/languages/targets" => self.json_response(
                request,
                200,
                json!({ "targets": target_status(), "engine": "rust" }),
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
                } else if path.starts_with("/jobs/") {
                    self.json_response(request, 404, json!({ "error": "job not found" }))
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
            "/translate" | "/translate_refine" | "/draft" | "/notes/generate"
            | "/notes/summarize" | "/models/pull" => self.not_implemented(request),
            _ if path.starts_with("/transcribe") => self.not_implemented(request),
            _ => {
                if let Some(rest) = path.strip_prefix("/jobs/") {
                    if rest.ends_with("/cancel") {
                        return self.json_response(
                            request,
                            404,
                            json!({ "error": "job not found" }),
                        );
                    }
                }
                self.json_response(request, 404, json!({ "error": "not found" }))
            }
        }
    }

    fn delete(&self, request: &Request) -> Response {
        let path = request.path();
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

    fn not_implemented(&self, request: &Request) -> Response {
        self.json_response(request, 501, json!({ "error": ML_NOT_IMPLEMENTED }))
    }

    fn health(&self) -> Value {
        json!({
            "ok": true,
            "engine": "rust",
            "engine_label": "rust",
            "model": Value::Null,
            "ffmpeg": false,
            "translate": false,
            "translate_model": Value::Null,
            "draft_model": Value::Null,
            "device": "cpu",
            "compute": Value::Null,
            "engine_mode": self.load_engine_mode(),
            "platform": env::consts::OS,
            "features": {
                "fast_translate": false,
                "translate_refine": false,
                "draft": false,
                "notes": true,
                "transcribe_file_jobs": false,
                "streaming_file_jobs": false,
                "faster_whisper": false,
                "ui_prefs": true,
                "models": false,
            },
        })
    }

    fn device_state(&self) -> Value {
        let pref = self.load_device_pref();
        let active = "cpu";
        json!({
            "device": pref,
            "active": active,
            "compute": Value::Null,
            "cuda_available": false,
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
        if saved == "cuda" {
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
                "restart_required": saved != "cpu",
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
        if !patch.contains_key("theme") && !patch.contains_key("reskin") {
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
        let prefs = Value::Object(prefs);
        write_json(
            &self.ui_prefs_path,
            json!({ "updatedAt": now_utc_iso(), "prefs": prefs }),
        );
        prefs
    }
}

fn target_status() -> Vec<Value> {
    TARGET_LANGS
        .iter()
        .map(|code| {
            if *code == "en" {
                json!({ "code": code, "via": "whisper-direct", "local": true })
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
