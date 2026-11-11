//! The custom AI model connector: one OpenAI-compatible chat endpoint the person
//! configures (OpenAI, OpenRouter, Ollama, LM Studio, a company gateway ...).
//!
//! **Privacy:** nothing is ever sent to the endpoint unless the person turned the
//! connector on (`enabled`). Then, and only then, `/notes/summarize` and `/ask` send the
//! transcript or grounding text to that endpoint instead of the local model. With it
//! off (the default) the engine behaves as before: everything stays on the device.
//!
//! The API key lives in `ai-connector.json` in the engine's state directory (mode 0600
//! on Unix). It is never logged and never returned by the API (only `hasKey` and the
//! last four characters).

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

const FILE: &str = "ai-connector.json";

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Config {
    pub fn usable(&self) -> bool {
        self.enabled && !self.base_url.is_empty() && !self.model.is_empty()
    }

    /// What the API shows: never the key.
    pub fn public(&self) -> Value {
        let key = self.api_key.trim();
        let hint: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        json!({
            "enabled": self.enabled,
            "baseUrl": self.base_url,
            "model": self.model,
            "hasKey": !key.is_empty(),
            "keyHint": if key.chars().count() > 8 { hint } else { String::new() },
            "note": "Off by default. When on, transcripts and questions are sent to this endpoint instead of the local model.",
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
    Config {
        enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        base_url: s("baseUrl"),
        api_key: s("apiKey"),
        model: s("model"),
    }
}

pub fn save(dir: &Path, cfg: &Config) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let body = json!({ "enabled": cfg.enabled, "baseUrl": cfg.base_url, "apiKey": cfg.api_key, "model": cfg.model });
    let target = path(dir);
    let tmp = target.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(body.to_string().as_bytes())?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, body.to_string())?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Validate and merge a `POST /ai/connector` body into the saved config.
pub fn apply_patch(current: &Config, patch: &Value) -> Result<Config> {
    let mut cfg = current.clone();
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
    // An absent or empty apiKey keeps the saved one; `clearKey: true` removes it.
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
    if cfg.enabled && (cfg.base_url.is_empty() || cfg.model.is_empty()) {
        bail!("set the base URL and the model name before turning the connector on");
    }
    Ok(cfg)
}

fn chat_url(base: &str) -> String {
    let b = base.trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        b.to_string()
    } else {
        format!("{b}/chat/completions")
    }
}

/// A `messages` array: the system text, then (role, content) turns.
fn messages(system: &str, turns: &[(String, String)]) -> Value {
    let mut out = Vec::new();
    if !system.trim().is_empty() {
        out.push(json!({ "role": "system", "content": system }));
    }
    for (role, content) in turns {
        out.push(json!({ "role": role, "content": content }));
    }
    Value::Array(out)
}

/// Make a chat request and stream the answer: `on_piece` gets each text delta; the whole
/// text is returned. Works with servers that stream (`data: {...}` lines) and with ones
/// that ignore `stream` and answer one JSON document. The key is sent only as a Bearer
/// header and never appears in an error message.
pub fn chat(
    cfg: &Config,
    system: &str,
    turns: &[(String, String)],
    max_tokens: u32,
    on_piece: &mut dyn FnMut(&str),
) -> Result<String> {
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        bail!("the connector has no base URL or model");
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(120)))
        .timeout_global(Some(Duration::from_secs(600)))
        .http_status_as_error(false)
        .user_agent("yravgSubMeetly-engine")
        .build()
        .into();
    let body = json!({ "model": cfg.model, "messages": messages(system, turns), "max_tokens": max_tokens, "stream": true }).to_string();
    let mut req = agent
        .post(&chat_url(&cfg.base_url))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream, application/json");
    if !cfg.api_key.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", cfg.api_key));
    }
    let mut reply = req.send(body.as_str()).map_err(|e| {
        anyhow!(
            "the endpoint did not answer: {}",
            scrub(&e.to_string(), cfg)
        )
    })?;
    let status = reply.status().as_u16();
    if !(200..300).contains(&status) {
        let mut text = String::new();
        let _ = reply
            .body_mut()
            .as_reader()
            .take(4096)
            .read_to_string(&mut text);
        bail!(
            "the endpoint answered {status}: {}",
            scrub(&short_error(&text), cfg)
        );
    }
    let reader = BufReader::new(reply.body_mut().as_reader());
    let mut whole = String::new();
    let mut raw = String::new();
    for line in reader.lines() {
        let line = line.map_err(|e| anyhow!("the answer was cut off: {e}"))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data == "[DONE]" {
                break;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                if let Some(err) = v.get("error") {
                    bail!(
                        "the endpoint reported an error: {}",
                        scrub(&short_error(&err.to_string()), cfg)
                    );
                }
                let piece = v["choices"][0]["delta"]["content"]
                    .as_str()
                    .or_else(|| v["choices"][0]["text"].as_str())
                    .unwrap_or("");
                if !piece.is_empty() {
                    whole.push_str(piece);
                    on_piece(piece);
                }
            }
        } else {
            raw.push_str(line);
            raw.push('\n');
        }
    }
    if whole.is_empty() && !raw.trim().is_empty() {
        // A server that ignored `stream`: one JSON document.
        let v: Value = serde_json::from_str(raw.trim())
            .map_err(|_| anyhow!("the endpoint's answer was not in the OpenAI chat format"))?;
        if let Some(err) = v.get("error") {
            bail!(
                "the endpoint reported an error: {}",
                scrub(&short_error(&err.to_string()), cfg)
            );
        }
        let text = v["choices"][0]["message"]["content"].as_str().unwrap_or("");
        if !text.is_empty() {
            on_piece(text);
            whole.push_str(text);
        }
    }
    if whole.trim().is_empty() {
        bail!("the endpoint answered with no text");
    }
    Ok(whole)
}

fn short_error(text: &str) -> String {
    let t = text.trim();
    let v = serde_json::from_str::<Value>(t).ok().and_then(|v| {
        v["error"]["message"]
            .as_str()
            .or_else(|| v["error"].as_str())
            .or_else(|| v["message"].as_str())
            .map(str::to_string)
    });
    v.unwrap_or_else(|| t.chars().take(200).collect())
}

/// Never let the key leak into a message.
fn scrub(text: &str, cfg: &Config) -> String {
    if cfg.api_key.len() >= 6 {
        text.replace(&cfg.api_key, "***")
    } else {
        text.to_string()
    }
}

/// `POST /ai/connector/test`: a tiny request, with the saved config plus any overrides.
pub fn test(cfg: &Config) -> Value {
    let started = Instant::now();
    let mut sample = String::new();
    match chat(
        cfg,
        "Reply with the single word: ok",
        &[("user".to_string(), "ping".to_string())],
        8,
        &mut |p| sample.push_str(p),
    ) {
        Ok(text) => {
            json!({ "ok": true, "model": cfg.model, "sample": text.trim().chars().take(40).collect::<String>(), "ms": started.elapsed().as_millis() as u64 })
        }
        Err(e) => json!({ "ok": false, "error": format!("{e:#}") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    /// A one-request mock endpoint: returns what it received and the thread's result.
    fn mock(
        reply: &'static str,
        content_type: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 16384];
            let mut got = Vec::new();
            // Read the head, then the body by Content-Length.
            loop {
                let n = s.read(&mut buf).unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text
                        .to_lowercase()
                        .split("content-length:")
                        .nth(1)
                        .and_then(|r| r.split("\r\n").next())
                        .and_then(|n| n.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if got.len() >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nConnection: close\r\n\r\n"
            );
            s.write_all(head.as_bytes()).unwrap();
            s.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&got).to_string()
        });
        (url, h)
    }

    fn cfg(url: String) -> Config {
        Config {
            enabled: true,
            base_url: url,
            api_key: "sk-secret-key-123".into(),
            model: "m1".into(),
        }
    }

    #[test]
    fn streams_deltas_and_sends_the_key_only_as_a_bearer_header() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n";
        let (url, h) = mock(sse, "text/event-stream");
        let mut pieces = Vec::new();
        let out = chat(
            &cfg(url),
            "sys",
            &[("user".into(), "hi".into())],
            16,
            &mut |p| pieces.push(p.to_string()),
        )
        .unwrap();
        assert_eq!(out, "Hello");
        assert_eq!(pieces, vec!["Hel", "lo"]);
        let seen = h.join().unwrap();
        assert!(seen.starts_with("POST /v1/chat/completions"), "{seen}");
        assert!(seen
            .to_lowercase()
            .contains("authorization: bearer sk-secret-key-123"));
        assert!(seen.contains("\"model\":\"m1\"") && seen.contains("\"stream\":true"));
    }

    #[test]
    fn a_server_that_ignores_stream_still_works() {
        let (url, _h) = mock(
            "{\"choices\":[{\"message\":{\"content\":\"plain answer\"}}]}",
            "application/json",
        );
        let out = chat(
            &cfg(url),
            "",
            &[("user".into(), "q".into())],
            16,
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(out, "plain answer");
    }

    #[test]
    fn config_never_shows_the_key_and_is_private_on_disk() {
        let dir = std::env::temp_dir().join(format!("ysm-conn-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c = apply_patch(&Config::default(), &json!({ "baseUrl": "http://127.0.0.1:11434/v1/", "model": "llama3", "apiKey": "sk-abcdefghijkl", "enabled": true })).unwrap();
        assert_eq!(c.base_url, "http://127.0.0.1:11434/v1");
        save(&dir, &c).unwrap();
        assert_eq!(load(&dir), c);
        let shown = c.public().to_string();
        assert!(
            !shown.contains("sk-abcdefghijkl")
                && shown.contains("ijkl")
                && shown.contains("\"hasKey\":true")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        // An empty apiKey keeps the saved one; clearKey removes it.
        let kept = apply_patch(&c, &json!({ "apiKey": "" })).unwrap();
        assert_eq!(kept.api_key, "sk-abcdefghijkl");
        assert!(apply_patch(&c, &json!({ "clearKey": true }))
            .unwrap()
            .api_key
            .is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_urls_and_enabling_without_a_model() {
        assert!(apply_patch(&Config::default(), &json!({ "baseUrl": "ftp://x" })).is_err());
        assert!(apply_patch(&Config::default(), &json!({ "enabled": true })).is_err());
        assert!(!Config::default().usable());
    }

    #[test]
    fn errors_do_not_leak_the_key() {
        let c = cfg("http://x".into());
        assert!(!scrub("bad key sk-secret-key-123 here", &c).contains("sk-secret"));
    }
}
