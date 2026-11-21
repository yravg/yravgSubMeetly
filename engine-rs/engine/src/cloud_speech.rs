//! Optional speech-to-text in the cloud with the person's own key: Groq (Whisper large-v3-turbo)
//! first, any OpenAI-compatible `/audio/transcriptions` endpoint second.
//!
//! **Privacy:** off by default. Only when the person turns it on does a final caption's audio go
//! to that service (interims, the growing utterance, stay on the device). On an error, a timeout
//! ([`TIMEOUT`]) or no network the on-device model answers the same request, and `/draft` says
//! where each line was made (`asr_via`).
//!
//! The key lives in `cloud-speech.json` in the state directory (mode 0600 on Unix), stored like
//! the AI connector's. It is never logged and never returned (only `hasKey` and the last four).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

const FILE: &str = "cloud-speech.json";
/// A cloud answer slower than this is dropped and the device answers: captions must not wait.
pub const TIMEOUT: Duration = Duration::from_secs(3);
/// After a failure the cloud is not asked again for this long, so an offline laptop does not add
/// the timeout to every line.
const PAUSE: Duration = Duration::from_secs(30);
static PAUSED_UNTIL: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Provider {
    #[default]
    Local,
    Groq,
    OpenAi,
}

pub const ALL: [Provider; 3] = [Provider::Local, Provider::Groq, Provider::OpenAi];

impl Provider {
    pub fn id(self) -> &'static str {
        match self {
            Provider::Local => "local",
            Provider::Groq => "groq",
            Provider::OpenAi => "openai",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Local => "On this device",
            Provider::Groq => "Groq",
            Provider::OpenAi => "OpenAI-compatible",
        }
    }

    fn default_base(self) -> &'static str {
        match self {
            Provider::Local => "",
            Provider::Groq => "https://api.groq.com/openai/v1",
            Provider::OpenAi => "https://api.openai.com/v1",
        }
    }

    fn default_model(self) -> &'static str {
        match self {
            Provider::Local => "",
            Provider::Groq => "whisper-large-v3-turbo",
            Provider::OpenAi => "whisper-1",
        }
    }

    /// The fields Settings shows (same words as `/translate/provider`).
    fn needs(self) -> &'static [&'static str] {
        match self {
            Provider::Local => &[],
            Provider::Groq => &["key"],
            Provider::OpenAi => &["baseUrl", "model", "key"],
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub provider: Provider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Config {
    fn base(&self) -> &str {
        if self.base_url.is_empty() {
            self.provider.default_base()
        } else {
            &self.base_url
        }
    }

    fn model(&self) -> &str {
        if self.model.is_empty() {
            self.provider.default_model()
        } else {
            &self.model
        }
    }

    /// A key is needed unless an OpenAI-compatible server of the person's own is set.
    fn needs_key(&self) -> bool {
        self.provider == Provider::Groq || self.base_url.is_empty()
    }

    pub fn active(&self) -> bool {
        self.enabled
            && self.provider != Provider::Local
            && !(self.needs_key() && self.api_key.is_empty())
    }

    /// Where the audio goes, for "Audio is sent to …".
    fn sent_to(&self) -> String {
        match self.provider {
            Provider::Local => String::new(),
            Provider::Groq => "Groq".into(),
            Provider::OpenAi => {
                let host = self
                    .base()
                    .split("://")
                    .nth(1)
                    .unwrap_or("")
                    .split('/')
                    .next()
                    .unwrap_or("");
                if host.is_empty() {
                    "the server".into()
                } else {
                    host.to_string()
                }
            }
        }
    }

    fn off_device(&self) -> bool {
        let b = self.base();
        self.provider != Provider::Local
            && !(b.contains("://localhost") || b.contains("://127.") || b.contains("://[::1]"))
    }

    /// What the API shows (the `/translate/provider` shape): never the key.
    pub fn public(&self) -> Value {
        let key = self.api_key.trim();
        let hint: String = key
            .chars()
            .skip(key.chars().count().saturating_sub(4))
            .collect();
        json!({
            "enabled": self.enabled,
            "provider": self.provider.id(),
            "label": self.provider.label(),
            "needs": self.provider.needs(),
            "offDevice": self.off_device(),
            "sentTo": self.sent_to(),
            "baseUrl": self.base_url,
            "defaultBaseUrl": self.provider.default_base(),
            "model": self.model(),
            "hasKey": !key.is_empty(),
            "keyHint": if key.chars().count() > 8 { hint } else { String::new() },
            "providers": ALL.iter().map(|p| json!({ "id": p.id(), "label": p.label() })).collect::<Vec<_>>(),
            "note": "Off by default: speech is heard on this device. When on, each final caption's audio is sent to the chosen service; this device answers if it fails or takes over 3 s.",
        })
    }
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn load(dir: &Path) -> Config {
    let Some(v) = std::fs::read_to_string(path(dir))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return Config::default();
    };
    let s = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let id = s("provider");
    Config {
        enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        provider: ALL.into_iter().find(|p| p.id() == id).unwrap_or_default(),
        base_url: s("baseUrl"),
        api_key: s("apiKey"),
        model: s("model"),
    }
}

pub fn save(dir: &Path, cfg: &Config) -> Result<()> {
    let body = json!({
        "enabled": cfg.enabled, "provider": cfg.provider.id(), "baseUrl": cfg.base_url,
        "apiKey": cfg.api_key, "model": cfg.model,
    });
    // New settings (a fixed key, another service) are tried at once.
    *PAUSED_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = None;
    crate::connector::write_private(dir, &path(dir), &body.to_string())
}

/// Validate and merge a `POST /speech/provider` body. Choosing another provider clears the
/// URL, model and key (a Groq key is no OpenAI key) and turns it off.
pub fn apply_patch(current: &Config, patch: &Value) -> Result<Config> {
    let mut cfg = current.clone();
    if let Some(id) = patch.get("provider").and_then(Value::as_str) {
        let p = ALL
            .into_iter()
            .find(|p| p.id() == id)
            .ok_or_else(|| anyhow!("unknown speech provider {id:?}"))?;
        if p != cfg.provider {
            cfg = Config {
                provider: p,
                ..Config::default()
            };
        }
    }
    if let Some(u) = patch.get("baseUrl").and_then(Value::as_str) {
        let u = u.trim().trim_end_matches('/').to_string();
        if !u.is_empty() && !(u.starts_with("http://") || u.starts_with("https://")) {
            bail!("baseUrl must start with http:// or https://");
        }
        cfg.base_url = u;
    }
    if let Some(m) = patch.get("model").and_then(Value::as_str) {
        cfg.model = m.trim().to_string();
    }
    if let Some(k) = patch.get("apiKey").and_then(Value::as_str) {
        if !k.trim().is_empty() {
            cfg.api_key = k.trim().to_string();
        }
    }
    if patch.get("clearKey").and_then(Value::as_bool) == Some(true) {
        cfg.api_key.clear();
    }
    if let Some(e) = patch.get("enabled").and_then(Value::as_bool) {
        cfg.enabled = e;
    }
    if cfg.enabled && cfg.provider == Provider::Local {
        bail!("choose Groq or an OpenAI-compatible service first");
    }
    if cfg.enabled && cfg.needs_key() && cfg.api_key.is_empty() {
        bail!("paste your API key before turning cloud speech on");
    }
    Ok(cfg)
}

/// 16 kHz mono f32 as a 16-bit WAV (half the bytes of f32, what every Whisper API reads).
fn wav(pcm: &[f32]) -> Vec<u8> {
    let data = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&16000u32.to_le_bytes());
    out.extend_from_slice(&32000u32.to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

fn scrub(text: &str, cfg: &Config) -> String {
    if cfg.api_key.len() >= 6 {
        text.replace(&cfg.api_key, "***")
    } else {
        text.to_string()
    }
}

/// The words in `pcm` (16 kHz mono) from the configured service, within [`TIMEOUT`].
/// `language`: an engine code ("en", "zh", …) or `None` to let the service detect it.
pub fn transcribe(cfg: &Config, pcm: &[f32], language: Option<&str>) -> Result<String> {
    let who = cfg.provider.label();
    let boundary = "----kasi-speech-7f3a9c";
    let mut body = Vec::new();
    let mut field = |name: &str, value: &str| {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
    };
    field("model", cfg.model());
    field("response_format", "json");
    field("temperature", "0");
    if let Some(l) = language {
        // Whisper APIs take ISO-639-1: "zh-TW" is "zh".
        field("language", l.split(['-', '_']).next().unwrap_or(l));
    }
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
    body.extend_from_slice(&wav(pcm));
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .http_status_as_error(false)
        .user_agent("kasi-engine")
        .build()
        .into();
    let mut req = agent
        .post(&format!("{}/audio/transcriptions", cfg.base()))
        .header(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        );
    if !cfg.api_key.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", cfg.api_key));
    }
    let mut reply = req
        .send(&body[..])
        .map_err(|e| anyhow!("{who} did not answer: {}", scrub(&e.to_string(), cfg)))?;
    let status = reply.status().as_u16();
    let mut text = String::new();
    let _ = reply
        .body_mut()
        .as_reader()
        .take(1 << 20)
        .read_to_string(&mut text);
    if !(200..300).contains(&status) {
        let brief: String = text.trim().chars().take(160).collect();
        bail!("{who} answered {status}: {}", scrub(&brief, cfg));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|_| anyhow!("{who} answered in a shape this version does not read"))?;
    Ok(v.get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string())
}

/// The cloud's words when cloud speech is on: `None` when off, else the text and the provider id,
/// or why it failed (the caller then asks the device).
pub fn try_transcribe(
    dir: &Path,
    pcm: &[f32],
    language: Option<&str>,
) -> Option<std::result::Result<(String, &'static str), String>> {
    let cfg = load(dir);
    if !cfg.active() {
        return None;
    }
    let mut paused = PAUSED_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    if paused.is_some_and(|until| std::time::Instant::now() < until) {
        return Some(Err(format!(
            "{} failed a moment ago; this computer hears the lines for now",
            cfg.provider.label()
        )));
    }
    drop(paused);
    let heard = transcribe(&cfg, pcm, language);
    paused = PAUSED_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    *paused = heard.is_err().then(|| std::time::Instant::now() + PAUSE);
    Some(
        heard
            .map(|t| (t, cfg.provider.id()))
            .map_err(|e| e.to_string()),
    )
}

/// `POST /speech/provider/test`: one second of silence through the service (checks the key).
pub fn test(cfg: &Config) -> Value {
    let started = std::time::Instant::now();
    match transcribe(cfg, &[0.0; 16000], Some("en")) {
        Ok(_) => {
            json!({ "ok": true, "ms": started.elapsed().as_millis() as u64, "provider": cfg.provider.id() })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    /// A one-request server: waits `delay`, answers `status` + `reply`; returns (url, what it saw).
    fn mock(
        status: u16,
        reply: &'static str,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 65536];
            loop {
                let Ok(n) = s.read(&mut buf) else { break };
                got.extend_from_slice(&buf[..n]);
                let t = String::from_utf8_lossy(&got).to_lowercase();
                if n == 0 || t.ends_with("--\r\n") {
                    break;
                }
            }
            std::thread::sleep(delay);
            let out = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            let _ = s.write_all(out.as_bytes());
            String::from_utf8_lossy(&got).to_string()
        });
        (url, h)
    }

    fn cfg(provider: Provider, base: &str) -> Config {
        Config {
            enabled: true,
            provider,
            base_url: base.into(),
            api_key: "gsk_secret_key_1234".into(),
            model: String::new(),
        }
    }

    #[test]
    fn a_transcription_sends_the_wav_the_model_and_the_key_as_a_bearer() {
        let (url, h) = mock(200, r#"{"text":" halo dunia "}"#, Duration::ZERO);
        let text = transcribe(&cfg(Provider::Groq, &url), &[0.1; 8000], Some("zh-TW")).unwrap();
        assert_eq!(text, "halo dunia");
        let seen = h.join().unwrap();
        let low = seen.to_lowercase();
        assert!(low.starts_with("post /audio/transcriptions "), "{seen:.80}");
        assert!(low.contains("authorization: bearer gsk_secret_key_1234"));
        assert!(seen.contains("whisper-large-v3-turbo") && seen.contains("\r\n\r\nzh\r\n"));
        assert!(seen.contains("RIFF") && seen.contains("WAVEfmt "));
    }

    #[test]
    fn a_wrong_key_is_an_error_without_the_key_in_it() {
        let (url, _h) = mock(
            401,
            r#"{"error":{"message":"Invalid API Key gsk_secret_key_1234"}}"#,
            Duration::ZERO,
        );
        let e = transcribe(&cfg(Provider::Groq, &url), &[0.0; 1600], None)
            .unwrap_err()
            .to_string();
        assert!(e.contains("401") && !e.contains("gsk_secret"), "{e}");
    }

    #[test]
    fn a_slow_service_gives_up_after_the_timeout() {
        let (url, _h) = mock(200, r#"{"text":"late"}"#, Duration::from_secs(6));
        let t = std::time::Instant::now();
        assert!(transcribe(&cfg(Provider::OpenAi, &url), &[0.0; 1600], None).is_err());
        let took = t.elapsed();
        assert!(
            took >= TIMEOUT && took < TIMEOUT + Duration::from_secs(2),
            "{took:?}"
        );
    }

    #[test]
    fn no_network_is_an_error_not_a_hang() {
        assert!(transcribe(
            &cfg(Provider::Groq, "http://127.0.0.1:9"),
            &[0.0; 1600],
            None
        )
        .is_err());
    }

    #[test]
    fn after_a_failure_the_cloud_rests_so_lines_do_not_wait() {
        let dir = std::env::temp_dir().join(format!("kasi-cloud-pause-{}", std::process::id()));
        save(&dir, &cfg(Provider::Groq, "http://127.0.0.1:9")).unwrap();
        assert!(try_transcribe(&dir, &[0.0; 1600], None).unwrap().is_err());
        let t = std::time::Instant::now();
        let again = try_transcribe(&dir, &[0.0; 1600], None)
            .unwrap()
            .unwrap_err();
        assert!(
            t.elapsed() < Duration::from_secs(1) && again.contains("a moment ago"),
            "{again}"
        );
        *PAUSED_UNTIL.lock().unwrap() = None;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn off_by_default_needs_a_key_and_never_shows_it() {
        let dir = std::env::temp_dir().join(format!("kasi-cloud-speech-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            try_transcribe(&dir, &[0.0; 1600], None).is_none(),
            "off: nothing leaves"
        );
        let groq = apply_patch(&Config::default(), &json!({ "provider": "groq" })).unwrap();
        assert!(
            apply_patch(&groq, &json!({ "enabled": true })).is_err(),
            "no key, not on"
        );
        let on = apply_patch(
            &groq,
            &json!({ "apiKey": " gsk_abcdefghijkl ", "enabled": true }),
        )
        .unwrap();
        save(&dir, &on).unwrap();
        let back = load(&dir);
        assert!(back.active() && back.api_key == "gsk_abcdefghijkl");
        let p = back.public();
        assert!(!p.to_string().contains("gsk_abcdefgh"));
        assert_eq!(
            (
                p["keyHint"].as_str(),
                p["sentTo"].as_str(),
                p["offDevice"].as_bool()
            ),
            (Some("ijkl"), Some("Groq"), Some(true))
        );
        let other = apply_patch(&back, &json!({ "provider": "openai" })).unwrap();
        assert!(
            !other.enabled && other.api_key.is_empty(),
            "a new provider starts clean"
        );
        let own = apply_patch(
            &other,
            &json!({ "baseUrl": "http://127.0.0.1:8000/v1", "enabled": true }),
        )
        .unwrap();
        assert!(
            own.active() && !own.public()["offDevice"].as_bool().unwrap(),
            "an own local server needs no key"
        );
        assert!(apply_patch(&own, &json!({ "baseUrl": "ftp://x" })).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
