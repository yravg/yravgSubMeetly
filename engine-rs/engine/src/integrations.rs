//! Webhooks: the engine calls URLs the person entered when a meeting is saved or when
//! action items appear (docs/INTEGRATIONS.md).
//!
//! Safety defaults:
//! - Only URLs the person typed (Settings, `submeetly-engine cli webhook add`, or
//!   `POST /integrations/webhooks`, which are loopback-only and origin-guarded like every
//!   engine route). Nothing in a note or a model answer ever names a URL.
//! - http and https only, no credentials in the URL, redirects are not followed (a hook
//!   cannot bounce the engine to another host), a 10 s timeout, and the answer's body is
//!   never stored (only the status).
//! - Deliveries run on one background thread with retries; a slow or dead receiver never
//!   blocks the engine. Failures are logged to stderr and kept as `last` on the hook.
//! - A secret signs the exact body: `X-Submeetly-Signature: sha256=<hex HMAC-SHA256>`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::state::{now_epoch_secs, now_utc_iso};

pub const EVENT_MEETING_SAVED: &str = "meeting.saved";
pub const EVENT_ACTIONS_CREATED: &str = "action_items.created";
pub const EVENT_PING: &str = "ping";
const KNOWN_EVENTS: [&str; 2] = [EVENT_MEETING_SAVED, EVENT_ACTIONS_CREATED];
const MAX_HOOKS: usize = 20;
const DEFAULT_BACKOFF_MS: [u64; 3] = [1_000, 4_000, 16_000];

/// HMAC-SHA256 (RFC 2104) over `sha2`, so no extra dependency.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.map(|b| b ^ 0x36));
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(k.map(|b| b ^ 0x5c));
    outer.update(inner);
    outer.finalize().into()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `sha256=<hex>`: the signature header's value.
pub fn signature(secret: &str, body: &[u8]) -> String {
    format!("sha256={}", hex(&hmac_sha256(secret.as_bytes(), body)))
}

/// Why a URL is refused, or the URL trimmed.
pub fn check_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.len() > 2048 {
        return Err("url is too long".into());
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or("url must start with http:// or https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err("url has no host".into());
    }
    if authority.contains('@') {
        return Err("url must not carry a user name or password (use the secret)".into());
    }
    if url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("url has spaces or control characters".into());
    }
    Ok(url.to_string())
}

#[derive(Clone, Debug)]
struct Hook {
    id: String,
    url: String,
    secret: String,
    events: Vec<String>,
    enabled: bool,
}

impl Hook {
    fn wants(&self, event: &str) -> bool {
        self.enabled
            && (self.events.iter().any(|e| e == "*") || self.events.iter().any(|e| e == event))
    }

    fn to_json(&self, last: Option<&Value>) -> Value {
        json!({
            "id": self.id,
            "url": self.url,
            "events": self.events,
            "enabled": self.enabled,
            "hasSecret": !self.secret.is_empty(),
            "last": last.cloned().unwrap_or(Value::Null),
        })
    }
}

struct Job {
    hook: Hook,
    event: String,
    body: String,
}

pub struct Integrations {
    path: PathBuf,
    hooks: Mutex<Vec<Hook>>,
    last: Arc<Mutex<HashMap<String, Value>>>,
    tx: Mutex<Option<Sender<Job>>>,
}

impl Integrations {
    pub fn new(path: PathBuf) -> Self {
        let hooks = load(&path);
        Self {
            path,
            hooks: Mutex::new(hooks),
            last: Arc::default(),
            tx: Mutex::new(None),
        }
    }

    fn lock_hooks(&self) -> std::sync::MutexGuard<'_, Vec<Hook>> {
        self.hooks.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `GET /integrations/webhooks`.
    pub fn list(&self) -> Value {
        let last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        let hooks: Vec<Value> = self
            .lock_hooks()
            .iter()
            .map(|h| h.to_json(last.get(&h.id)))
            .collect();
        json!({ "webhooks": hooks, "events": KNOWN_EVENTS })
    }

    /// `POST /integrations/webhooks`: add (`url`), change (`id` + fields) or remove (`id`, `remove`).
    pub fn change(&self, body: &Value) -> Result<Value, String> {
        let Value::Object(map) = body else {
            return Err("body must be a JSON object".into());
        };
        let id = map.get("id").and_then(Value::as_str).unwrap_or("");
        if map.get("remove").and_then(Value::as_bool) == Some(true) {
            let mut hooks = self.lock_hooks();
            let before = hooks.len();
            hooks.retain(|h| h.id != id);
            if hooks.len() == before {
                return Err("webhook not found".into());
            }
            save(&self.path, &hooks);
            self.last
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(id);
            return Ok(json!({ "ok": true, "removed": id }));
        }
        let events = match map.get("events") {
            None | Some(Value::Null) => None,
            Some(Value::Array(list)) => {
                let mut out = Vec::new();
                for e in list {
                    let e = e.as_str().unwrap_or("");
                    if e != "*" && !KNOWN_EVENTS.contains(&e) {
                        return Err(format!(
                            "unknown event {e:?} (use {KNOWN_EVENTS:?} or \"*\")"
                        ));
                    }
                    if !out.iter().any(|x: &String| x == e) {
                        out.push(e.to_string());
                    }
                }
                if out.is_empty() {
                    return Err("events must not be empty".into());
                }
                Some(out)
            }
            _ => return Err("events must be a list".into()),
        };
        let mut hooks = self.lock_hooks();
        let hook = if id.is_empty() {
            let url = check_url(
                map.get("url")
                    .and_then(Value::as_str)
                    .ok_or("url is required")?,
            )?;
            if hooks.len() >= MAX_HOOKS {
                return Err(format!("at most {MAX_HOOKS} webhooks"));
            }
            let seed = format!("{url}{}{}", now_epoch_secs(), hooks.len());
            let hook = Hook {
                id: format!("wh-{}", &hex(&Sha256::digest(seed.as_bytes()))[..8]),
                url,
                secret: map
                    .get("secret")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                events: events
                    .unwrap_or_else(|| KNOWN_EVENTS.iter().map(|e| e.to_string()).collect()),
                enabled: map.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            };
            hooks.push(hook.clone());
            hook
        } else {
            let hook = hooks
                .iter_mut()
                .find(|h| h.id == id)
                .ok_or("webhook not found")?;
            if let Some(url) = map.get("url").and_then(Value::as_str) {
                hook.url = check_url(url)?;
            }
            if let Some(secret) = map.get("secret").and_then(Value::as_str) {
                hook.secret = secret.to_string();
            }
            if let Some(events) = events {
                hook.events = events;
            }
            if let Some(on) = map.get("enabled").and_then(Value::as_bool) {
                hook.enabled = on;
            }
            hook.clone()
        };
        save(&self.path, &hooks);
        Ok(json!({ "ok": true, "webhook": hook.to_json(None) }))
    }

    /// `POST /integrations/webhooks/test`: one `ping`, answered with how it went.
    pub fn test(&self, body: &Value) -> Result<Value, String> {
        let id = body.get("id").and_then(Value::as_str).unwrap_or("");
        let hook = self
            .lock_hooks()
            .iter()
            .find(|h| h.id == id)
            .cloned()
            .ok_or("webhook not found")?;
        let payload = envelope(
            EVENT_PING,
            json!({ "message": "yravgSubMeetly webhook test" }),
        );
        let result = attempt(&hook, EVENT_PING, &payload);
        let report = report(1, &result);
        self.last
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(hook.id, report.clone());
        Ok(json!({ "ok": result.is_ok(), "result": report }))
    }

    /// A note was saved by `POST /notes`: tell the hooks. `previous` is the note it replaced.
    pub fn note_saved(&self, previous: Option<&Value>, note: &Value) {
        self.dispatch(EVENT_MEETING_SAVED, json!({ "note": note }));
        let seen: Vec<&str> = previous
            .and_then(|p| p.get("actions"))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.get("id").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();
        let fresh: Vec<Value> = note
            .get("actions")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter(|x| {
                        x.get("status").and_then(Value::as_str) != Some("closed")
                            && !seen.contains(&x.get("id").and_then(Value::as_str).unwrap_or(""))
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if !fresh.is_empty() {
            self.dispatch(
                EVENT_ACTIONS_CREATED,
                json!({
                    "noteId": note.get("id").cloned().unwrap_or(Value::Null),
                    "title": note.get("title").cloned().unwrap_or(Value::Null),
                    "actions": fresh,
                }),
            );
        }
    }

    fn dispatch(&self, event: &str, data: Value) {
        let hooks: Vec<Hook> = self
            .lock_hooks()
            .iter()
            .filter(|h| h.wants(event))
            .cloned()
            .collect();
        if hooks.is_empty() {
            return;
        }
        let body = envelope(event, data);
        let mut tx = self.tx.lock().unwrap_or_else(|e| e.into_inner());
        if tx.is_none() {
            let (sender, receiver) = channel::<Job>();
            let last = Arc::clone(&self.last);
            let started = std::thread::Builder::new()
                .name("webhooks".into())
                .spawn(move || {
                    let backoff = backoff();
                    for job in receiver {
                        let mut tries = 0;
                        let outcome = loop {
                            tries += 1;
                            let r = attempt(&job.hook, &job.event, &job.body);
                            match r {
                                Err(ref e) if tries <= backoff.len() && retryable(e) => {
                                    std::thread::sleep(Duration::from_millis(backoff[tries - 1]));
                                }
                                other => break other,
                            }
                        };
                        if let Err(e) = &outcome {
                            eprintln!(
                                "webhook {} ({}): {e} after {tries} tries",
                                job.hook.id, job.event
                            );
                        }
                        last.lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .insert(job.hook.id.clone(), report(tries, &outcome));
                    }
                });
            if started.is_err() {
                return;
            }
            *tx = Some(sender);
        }
        if let Some(sender) = tx.as_ref() {
            for hook in hooks {
                let _ = sender.send(Job {
                    hook,
                    event: event.to_string(),
                    body: body.clone(),
                });
            }
        }
    }
}

fn backoff() -> Vec<u64> {
    std::env::var("WEBHOOK_BACKOFF_MS")
        .ok()
        .map(|v| {
            v.split(',')
                .filter_map(|p| p.trim().parse().ok())
                .collect::<Vec<u64>>()
        })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_BACKOFF_MS.to_vec())
}

fn envelope(event: &str, data: Value) -> String {
    json!({
        "event": event,
        "delivery": format!("dl-{}", &hex(&Sha256::digest(format!("{event}{}{}", now_epoch_secs(), data).as_bytes()))[..12]),
        "createdAt": now_utc_iso(),
        "data": data,
    })
    .to_string()
}

/// A 4xx (but 408/429) is the receiver's no: not worth repeating.
fn retryable(error: &str) -> bool {
    match error
        .strip_prefix("status ")
        .and_then(|s| s.parse::<u16>().ok())
    {
        Some(code) => code >= 500 || code == 408 || code == 429,
        None => true,
    }
}

fn report(tries: usize, outcome: &Result<u16, String>) -> Value {
    let mut m = Map::new();
    m.insert("at".into(), json!(now_utc_iso()));
    m.insert("attempts".into(), json!(tries));
    match outcome {
        Ok(status) => {
            m.insert("ok".into(), json!(true));
            m.insert("status".into(), json!(status));
        }
        Err(e) => {
            m.insert("ok".into(), json!(false));
            m.insert("error".into(), json!(e));
        }
    }
    Value::Object(m)
}

/// One delivery. Ok(status) for a 2xx/3xx answer.
fn attempt(hook: &Hook, event: &str, body: &str) -> Result<u16, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent("yravgSubMeetly-webhook")
        .build()
        .into();
    let mut request = agent
        .post(&hook.url)
        .header("Content-Type", "application/json")
        .header("X-Submeetly-Event", event)
        .header("X-Submeetly-Timestamp", &now_epoch_secs().to_string());
    if !hook.secret.is_empty() {
        request = request.header(
            "X-Submeetly-Signature",
            &signature(&hook.secret, body.as_bytes()),
        );
    }
    let reply = request.send(body).map_err(|e| format!("{e}"))?;
    let status = reply.status().as_u16();
    if status < 400 {
        Ok(status)
    } else {
        Err(format!("status {status}"))
    }
}

fn load(path: &PathBuf) -> Vec<Hook> {
    let Some(doc) = fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return Vec::new();
    };
    doc.get("webhooks")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|h| {
                    Some(Hook {
                        id: h.get("id")?.as_str()?.to_string(),
                        url: check_url(h.get("url")?.as_str()?).ok()?,
                        secret: h
                            .get("secret")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        events: h
                            .get("events")
                            .and_then(Value::as_array)
                            .map(|e| {
                                e.iter()
                                    .filter_map(|x| x.as_str().map(str::to_string))
                                    .collect()
                            })
                            .unwrap_or_else(|| {
                                KNOWN_EVENTS.iter().map(|e| e.to_string()).collect()
                            }),
                        enabled: h.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn save(path: &PathBuf, hooks: &[Hook]) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let list: Vec<Value> = hooks
        .iter()
        .map(|h| json!({ "id": h.id, "url": h.url, "secret": h.secret, "events": h.events, "enabled": h.enabled }))
        .collect();
    let _ = fs::write(path, json!({ "webhooks": list }).to_string());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The file holds the secrets: this account only.
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_the_rfc_4231_vectors() {
        // Test case 1 and 2 of RFC 4231.
        assert_eq!(
            hex(&hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // A key longer than a block is hashed first (case 6).
        assert_eq!(
            hex(&hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn urls_are_checked() {
        assert!(check_url("https://example.com/hook?x=1").is_ok());
        assert!(check_url("http://127.0.0.1:9000/h").is_ok());
        for bad in [
            "ftp://x.y/",
            "file:///etc/passwd",
            "https://",
            "https://user:pw@x.y/",
            "http://a b/",
            "javascript:alert(1)",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_hook_is_added_changed_listed_without_its_secret_and_removed() {
        let dir = std::env::temp_dir().join(format!(
            "sm-int-{}-{}",
            std::process::id(),
            now_epoch_secs()
        ));
        let path = dir.join("integrations.json");
        let int = Integrations::new(path.clone());
        let added = int
            .change(&json!({ "url": "http://127.0.0.1:9/h", "secret": "s3" }))
            .unwrap();
        let id = added["webhook"]["id"].as_str().unwrap().to_string();
        assert_eq!(added["webhook"]["hasSecret"], true);
        assert!(!added.to_string().contains("s3"));
        assert!(!int.list().to_string().contains("s3"));
        int.change(&json!({ "id": id, "enabled": false })).unwrap();
        assert_eq!(int.list()["webhooks"][0]["enabled"], false);
        assert!(int
            .change(&json!({ "url": "x", "events": ["nope"] }))
            .is_err());
        // It survives a restart, secret included.
        let again = Integrations::new(path);
        assert_eq!(again.list()["webhooks"].as_array().unwrap().len(), 1);
        assert_eq!(again.lock_hooks()[0].secret, "s3");
        again.change(&json!({ "id": id, "remove": true })).unwrap();
        assert!(again.change(&json!({ "id": id, "remove": true })).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn only_server_errors_are_retried() {
        assert!(
            retryable("status 503") && retryable("status 429") && retryable("connection refused")
        );
        assert!(!retryable("status 404") && !retryable("status 401"));
    }
}
