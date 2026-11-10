//! Calendar sources: an ICS subscription link (Outlook, Gmail) or an imported
//! `.ics` file, kept in the state dir and read through `ics.rs`.
//!
//! The link is a secret: anyone holding it reads the whole calendar. It is
//! stored only in `calendar.json`, sent only to its own host over https, and
//! leaves this module only masked (`mask_url`). Our own error strings are
//! returned instead of the HTTP client's, which can carry the URL.

use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ureq::config::Config;
use ureq::http::Uri;
use ureq::unversioned::resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};
use ureq::{Agent, Error as HttpError};

use crate::ics::{self, Occurrence, Parsed};
use crate::state::now_epoch_secs;

/// Links are re-read this often (seconds).
pub const REFRESH_SECS: i64 = 900;
const MAX_BODY: u64 = 5 * 1024 * 1024;
// Big Outlook calendars (400+ KB) on a slow line took 20 s and more to arrive.
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_SOURCES: usize = 8;
const MAX_URL: usize = 2048;
const DAY: i64 = 86_400;
/// Events one source may hand back for one window.
const WINDOW_LIMIT: usize = 2_000;
const TOTAL_LIMIT: usize = 1_500;

/// Why a calendar call failed; the app maps it to 400 / 404 / 502.
#[derive(Debug, PartialEq)]
pub enum Fail {
    Bad(String),
    Missing,
    Upstream(String),
}

// ----------------------------------------------------------- URL validation

/// Check a pasted link and return it in the form we fetch: `https`, no
/// fragment. `webcal://` (what Outlook and Apple hand out) means `https://`.
pub fn validate_url(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Paste the calendar link first.".into());
    }
    if raw.len() > MAX_URL || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("That does not look like a calendar link.".into());
    }
    let lower = raw.to_ascii_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        &raw[raw.len() - r.len()..]
    } else if let Some(r) = lower.strip_prefix("webcals://") {
        &raw[raw.len() - r.len()..]
    } else if let Some(r) = lower.strip_prefix("webcal://") {
        &raw[raw.len() - r.len()..]
    } else if lower.starts_with("http://") {
        return Err("Only https links are accepted. Ask your calendar for the https link.".into());
    } else {
        return Err("That is not a web link (it must start with https:// or webcal://).".into());
    };
    let rest = rest.split('#').next().unwrap_or("");
    let end = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.contains('@') {
        return Err("The link must not contain a user name or password.".into());
    }
    if authority.starts_with('[') {
        return Err(
            "Links to an IP address are not accepted. Use the calendar's host name.".into(),
        );
    }
    let host = match authority.rsplit_once(':') {
        Some((h, "443")) => h,
        Some(_) => return Err("Only the standard https port is accepted.".into()),
        None => authority,
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    let well_formed = labels.len() >= 2
        && labels
            .iter()
            .all(|l| !l.is_empty() && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
    if !well_formed {
        return Err("That does not look like a calendar link.".into());
    }
    // A last label of digits only is an IP address written some other way.
    if labels
        .last()
        .is_some_and(|l| l.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(
            "Links to an IP address are not accepted. Use the calendar's host name.".into(),
        );
    }
    const PRIVATE_SUFFIXES: [&str; 9] = [
        "localhost",
        "local",
        "internal",
        "lan",
        "home",
        "corp",
        "intranet",
        "private",
        "arpa",
    ];
    if labels.last().is_some_and(|l| PRIVATE_SUFFIXES.contains(l)) {
        return Err("That link points inside a private network, not to a calendar service.".into());
    }
    let tail = if tail.is_empty() { "/" } else { tail };
    Ok(format!("https://{host}{tail}"))
}

/// What may be shown or logged of a link: its host, never the secret path.
pub fn mask_url(url: &str) -> String {
    let host = url.strip_prefix("https://").unwrap_or(url);
    let host = host.split(['/', '?']).next().unwrap_or("");
    format!("https://{host}/…")
}

/// Addresses a calendar link may never reach: loopback, private networks,
/// link-local, shared and documentation ranges, multicast. Checked on the
/// resolved address, so DNS tricks and redirects cannot get around it.
pub fn addr_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => v4_blocked(a),
        IpAddr::V6(a) => v6_blocked(a),
    }
}

fn v4_blocked(a: Ipv4Addr) -> bool {
    let [o0, o1, o2, _] = a.octets();
    a.is_unspecified()
        || a.is_loopback()
        || a.is_private()
        || a.is_link_local()
        || a.is_broadcast()
        || a.is_multicast()
        || o0 == 0
        || o0 >= 240
        || (o0 == 100 && (64..128).contains(&o1)) // shared address space
        || (o0 == 192 && o1 == 0 && o2 <= 2) // IETF + TEST-NET-1
        || (o0 == 198 && (o1 == 18 || o1 == 19)) // benchmarking
        || (o0 == 198 && o1 == 51 && o2 == 100) // TEST-NET-2
        || (o0 == 203 && o1 == 0 && o2 == 113) // TEST-NET-3
}

fn v6_blocked(a: Ipv6Addr) -> bool {
    let s = a.segments();
    if a.is_unspecified() || a.is_loopback() || a.is_multicast() {
        return true;
    }
    if s[0] & 0xfe00 == 0xfc00 || s[0] & 0xffc0 == 0xfe80 {
        return true; // unique-local, link-local
    }
    if s[0] == 0x2001 && s[1] == 0x0db8 {
        return true; // documentation
    }
    // IPv4 inside IPv6 (mapped, compatible, NAT64): judge the v4 address.
    let embedded =
        |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    if s[..5] == [0, 0, 0, 0, 0] && (s[5] == 0xffff || s[5] == 0) {
        return v4_blocked(embedded(s[6], s[7]));
    }
    if s[0] == 0x0064 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
        return v4_blocked(embedded(s[6], s[7]));
    }
    false
}

// -------------------------------------------------------------------- fetch

/// The system resolver, minus every address `addr_blocked` refuses.
#[derive(Debug)]
struct PublicOnly;

impl Resolver for PublicOnly {
    fn resolve(
        &self,
        uri: &Uri,
        config: &Config,
        timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, HttpError> {
        let all = DefaultResolver::default().resolve(uri, config, timeout)?;
        let mut kept = self.empty();
        for addr in all.iter().filter(|a| !addr_blocked(a.ip())) {
            kept.push(*addr);
        }
        if kept.is_empty() {
            Err(HttpError::HostNotFound)
        } else {
            Ok(kept)
        }
    }
}

fn agent() -> Agent {
    // No proxy: a proxy would resolve the host itself and skip `PublicOnly`.
    let config = Agent::config_builder()
        .https_only(true)
        .proxy(None)
        .max_redirects(3)
        .http_status_as_error(false)
        .timeout_global(Some(FETCH_TIMEOUT))
        .user_agent("yravgSubMeetly-calendar")
        .build();
    Agent::with_parts(config, DefaultConnector::default(), PublicOnly)
}

/// Our own wording for a failed request; the client's `Display` can hold the URL.
fn fetch_error(e: &HttpError) -> String {
    match e {
        HttpError::Timeout(_) => "The calendar server did not answer in time.".into(),
        HttpError::BodyExceedsLimit(_) => {
            "The calendar is larger than 5 MB, which is more than we read.".into()
        }
        HttpError::TooManyRedirects | HttpError::RedirectFailed => {
            "The calendar link redirects too often.".into()
        }
        HttpError::Tls(_)
        | HttpError::Rustls(_)
        | HttpError::TlsRequired
        | HttpError::RequireHttpsOnly(_) => {
            "Could not make a secure (https) connection to the calendar server.".into()
        }
        _ => "The calendar host could not be reached, or it is not a public address.".into(),
    }
}

fn fetch(url: &str) -> Result<String, String> {
    let mut resp = agent()
        .get(url)
        .header("Accept", "text/calendar, text/plain;q=0.5, */*;q=0.1")
        .call()
        .map_err(|e| fetch_error(&e))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(match status {
            401 | 403 | 404 | 410 => {
                "The calendar refused the link. It may have been reset: create a new link."
                    .to_string()
            }
            _ => format!("The calendar server answered with an error ({status})."),
        });
    }
    resp.body_mut()
        .with_config()
        .limit(MAX_BODY)
        .lossy_utf8(true)
        .read_to_string()
        .map_err(|e| fetch_error(&e))
}

// ------------------------------------------------------------------- store

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    id: String,
    /// `link` or `file`.
    kind: String,
    /// The secret. Never serialised into a response.
    #[serde(default)]
    url: Option<String>,
    name: String,
    added_at: i64,
    #[serde(default)]
    last_sync: Option<i64>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    events: usize,
    #[serde(default)]
    warnings: Vec<String>,
    /// When we last tried (memory only), so a dead link is not hammered.
    #[serde(skip)]
    last_try: i64,
}

impl Source {
    fn public(&self) -> Value {
        json!({
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "link": self.url.as_deref().map(mask_url),
            "events": self.events,
            "lastSyncAt": self.last_sync.map(ics::iso_utc),
            "lastError": self.last_error,
            "warnings": self.warnings,
        })
    }
}

#[derive(Default)]
struct Inner {
    sources: Vec<Source>,
    parsed: HashMap<String, Arc<Parsed>>,
}

pub struct Calendar {
    dir: PathBuf,
    inner: Mutex<Inner>,
}

/// FNV-1a: ids that stay the same across restarts and Rust versions.
fn fnv(parts: &[&str]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in parts {
        for b in p.bytes().chain(std::iter::once(0)) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")[..12].to_string()
}

/// Calendar files hold private meetings: owner-only where the OS has modes.
/// shortcut: Windows relies on the profile folder's own ACL, upgrade if the state dir moves out of it.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(bytes)?;
    }
    #[cfg(not(unix))]
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

impl Calendar {
    pub fn new(dir: PathBuf) -> Self {
        let sources = fs::read_to_string(dir.join("calendar.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| serde_json::from_value::<Vec<Source>>(v.get("sources")?.clone()).ok())
            .unwrap_or_default();
        Self {
            dir,
            inner: Mutex::new(Inner {
                sources,
                parsed: HashMap::new(),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn ics_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("calendar-{id}.ics"))
    }

    fn save(&self, inner: &Inner) {
        let doc = json!({ "sources": inner.sources });
        let _ = write_private(&self.dir.join("calendar.json"), doc.to_string().as_bytes());
    }

    /// Store a freshly read calendar under `id` (new or replacing).
    fn commit(
        &self,
        id: &str,
        kind: &str,
        url: Option<String>,
        name: String,
        text: &str,
        parsed: Parsed,
    ) -> Value {
        let now = now_epoch_secs() as i64;
        let _ = write_private(&self.ics_path(id), text.as_bytes());
        let mut inner = self.lock();
        let events = parsed.events.len();
        let warnings: Vec<String> = parsed.warnings.iter().take(10).cloned().collect();
        let source = match inner.sources.iter_mut().find(|s| s.id == id) {
            Some(s) => {
                s.name = name;
                s.url = url;
                s.last_sync = Some(now);
                s.last_error = None;
                s.events = events;
                s.warnings = warnings;
                s.last_try = now;
                s.clone()
            }
            None => {
                let s = Source {
                    id: id.to_string(),
                    kind: kind.to_string(),
                    url,
                    name,
                    added_at: now,
                    last_sync: Some(now),
                    last_error: None,
                    events,
                    warnings,
                    last_try: now,
                };
                inner.sources.push(s.clone());
                s
            }
        };
        inner.parsed.insert(id.to_string(), Arc::new(parsed));
        self.save(&inner);
        source.public()
    }

    fn check_room(&self, id: &str) -> Result<(), Fail> {
        let inner = self.lock();
        if inner.sources.len() >= MAX_SOURCES && !inner.sources.iter().any(|s| s.id == id) {
            return Err(Fail::Bad(format!(
                "At most {MAX_SOURCES} calendars. Remove one first."
            )));
        }
        Ok(())
    }

    /// Add a subscription link (or refresh it when it is already there).
    pub fn add_link(&self, raw: &str) -> Result<Value, Fail> {
        let url = validate_url(raw).map_err(Fail::Bad)?;
        let id = fnv(&["link", &url]);
        self.check_room(&id)?;
        let text = fetch(&url).map_err(Fail::Upstream)?;
        let parsed = ics::parse(&text)
            .map_err(|_| Fail::Bad("That link did not return a calendar (.ics) file.".into()))?;
        let name = link_name(&parsed, &url);
        Ok(self.commit(&id, "link", Some(url), name, &text, parsed))
    }

    /// Import `.ics` text. The same file name replaces the earlier import.
    pub fn add_file(&self, text: &str, file_name: &str) -> Result<Value, Fail> {
        if text.len() as u64 > MAX_BODY {
            return Err(Fail::Bad(
                "The file is larger than 5 MB, which is more than we read.".into(),
            ));
        }
        let parsed = ics::parse(text)
            .map_err(|_| Fail::Bad("That file is not a calendar (.ics) file.".into()))?;
        let file = file_name.rsplit(['/', '\\']).next().unwrap_or("").trim();
        let file: String = file.chars().filter(|c| !c.is_control()).take(80).collect();
        let name = if !file.is_empty() {
            file.clone()
        } else if !parsed.name.is_empty() {
            parsed.name.clone()
        } else {
            "Imported calendar".to_string()
        };
        let id = fnv(&["file", &file]);
        self.check_room(&id)?;
        Ok(self.commit(&id, "file", None, name, text, parsed))
    }

    pub fn remove(&self, id: &str) -> Result<(), Fail> {
        let mut inner = self.lock();
        let before = inner.sources.len();
        inner.sources.retain(|s| s.id != id);
        if inner.sources.len() == before {
            return Err(Fail::Missing);
        }
        inner.parsed.remove(id);
        self.save(&inner);
        drop(inner);
        let _ = fs::remove_file(self.ics_path(id));
        Ok(())
    }

    /// Read one link again. A failure keeps the last good events and records why.
    pub fn refresh_one(&self, id: &str) -> Result<(), Fail> {
        let url = {
            let mut inner = self.lock();
            let Some(s) = inner.sources.iter_mut().find(|s| s.id == id) else {
                return Err(Fail::Missing);
            };
            s.last_try = now_epoch_secs() as i64;
            match &s.url {
                Some(u) => u.clone(),
                None => return Ok(()), // an imported file has nothing to re-read
            }
        };
        let outcome = fetch(&url).and_then(|text| {
            ics::parse(&text)
                .map(|p| (text, p))
                .map_err(|_| "The link no longer returns a calendar file.".to_string())
        });
        match outcome {
            Ok((text, parsed)) => {
                let name = link_name(&parsed, &url);
                self.commit(id, "link", Some(url), name, &text, parsed);
                Ok(())
            }
            Err(message) => {
                let mut inner = self.lock();
                if let Some(s) = inner.sources.iter_mut().find(|s| s.id == id) {
                    s.last_error = Some(message.clone());
                }
                self.save(&inner);
                Err(Fail::Upstream(message))
            }
        }
    }

    /// Refresh every link (`id` None) or one.
    pub fn refresh(&self, id: Option<&str>) -> Result<(), Fail> {
        match id {
            Some(id) => self.refresh_one(id),
            None => {
                let ids: Vec<String> = self
                    .lock()
                    .sources
                    .iter()
                    .filter(|s| s.url.is_some())
                    .map(|s| s.id.clone())
                    .collect();
                for id in ids {
                    let _ = self.refresh_one(&id);
                }
                Ok(())
            }
        }
    }

    /// Called every minute by the server: re-read links not read for `REFRESH_SECS`.
    pub fn tick(&self) {
        let now = now_epoch_secs() as i64;
        let due: Vec<String> = self
            .lock()
            .sources
            .iter()
            .filter(|s| {
                s.url.is_some() && now - s.last_try.max(s.last_sync.unwrap_or(0)) >= REFRESH_SECS
            })
            .map(|s| s.id.clone())
            .collect();
        for id in due {
            let _ = self.refresh_one(&id);
        }
    }

    pub fn sources(&self) -> Vec<Value> {
        self.lock().sources.iter().map(Source::public).collect()
    }

    /// The parsed calendar of a source, read back from its cached file after a restart.
    fn parsed(&self, id: &str) -> Option<Arc<Parsed>> {
        if let Some(p) = self.lock().parsed.get(id) {
            return Some(Arc::clone(p));
        }
        let text = fs::read_to_string(self.ics_path(id)).ok()?;
        let parsed = Arc::new(ics::parse(&text).ok()?);
        self.lock()
            .parsed
            .insert(id.to_string(), Arc::clone(&parsed));
        Some(parsed)
    }

    /// Every event overlapping `[from, to)`, soonest first.
    fn occurrences(&self, from: i64, to: i64) -> Vec<(String, Occurrence)> {
        let ids: Vec<String> = self.lock().sources.iter().map(|s| s.id.clone()).collect();
        let mut all = Vec::new();
        for id in ids {
            if let Some(p) = self.parsed(&id) {
                all.extend(
                    ics::expand(&p, from, to, WINDOW_LIMIT)
                        .into_iter()
                        .map(|o| (id.clone(), o)),
                );
            }
        }
        all.sort_by(|a, b| (a.1.start, &a.1.title, &a.0).cmp(&(b.1.start, &b.1.title, &b.0)));
        all.truncate(TOTAL_LIMIT);
        all
    }

    pub fn events(&self, from: i64, to: i64) -> Value {
        let events: Vec<Value> = self
            .occurrences(from, to)
            .iter()
            .map(|(id, o)| event_json(id, o))
            .collect();
        json!({
            "from": ics::iso_utc(from),
            "to": ics::iso_utc(to),
            "sources": self.sources(),
            "events": events,
        })
    }

    /// Meeting-note document for one calendar event, by event id. `tz_minutes`
    /// is the reader's offset from UTC, so a 07:00 meeting lands on its own date.
    pub fn note_for(&self, event_id: &str, tz_minutes: i64, now: i64) -> Option<Value> {
        let (_, o) = self
            .occurrences(now - 14 * DAY, now + 90 * DAY)
            .into_iter()
            .find(|(sid, o)| event_id_of(sid, o) == event_id)?;
        let date = if o.all_day {
            ics::iso_date(o.start)
        } else {
            ics::iso_date(o.start + tz_minutes * 60)
        };
        let (start, end) = if o.all_day {
            (ics::iso_date(o.start), ics::iso_date(o.end))
        } else {
            (ics::iso_utc(o.start), ics::iso_utc(o.end))
        };
        let title = if o.title.is_empty() {
            "(No title)".to_string()
        } else {
            o.title.clone()
        };
        Some(json!({
            "id": format!("MOM-CAL-{event_id}"),
            "title": title,
            "date": date,
            "source": "calendar",
            "status": "draft",
            "meeting": {
                "start": start,
                "end": end,
                "chair": o.organizer.as_ref().map(|p| p.display().to_string()).filter(|s| !s.is_empty()),
                "attendees": o.attendees.iter().take(60).map(|p| p.display().to_string()).collect::<Vec<_>>(),
            },
        }))
    }
}

fn link_name(parsed: &Parsed, url: &str) -> String {
    if parsed.name.is_empty() {
        mask_url(url)
            .trim_start_matches("https://")
            .trim_end_matches("/…")
            .to_string()
    } else {
        parsed.name.clone()
    }
}

fn event_id_of(source_id: &str, o: &Occurrence) -> String {
    fnv(&[source_id, &o.uid, &o.start.to_string()])
}

fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

fn event_json(source_id: &str, o: &Occurrence) -> Value {
    let (start, end) = if o.all_day {
        (ics::iso_date(o.start), ics::iso_date(o.end))
    } else {
        (ics::iso_utc(o.start), ics::iso_utc(o.end))
    };
    json!({
        "id": event_id_of(source_id, o),
        "uid": o.uid,
        "title": if o.title.is_empty() { "(No title)".to_string() } else { clip(&o.title, 200) },
        "start": start,
        "end": end,
        "allDay": o.all_day,
        "location": clip(&o.location, 200),
        "description": clip(&o.description, 600),
        "organizer": o.organizer.as_ref().map(|p| json!({ "name": p.name, "email": p.email })),
        "attendees": o.attendees.iter().take(50).map(|p| p.display().to_string()).collect::<Vec<_>>(),
        "joinUrl": o.join_url,
        "sourceId": source_id,
        "recurring": o.recurring,
    })
}

#[cfg(test)]
mod tests;
