//! The island's view of the yravgSubMeetly helper (native/server.py or
//! engine-rs) over loopback: `GET /health`, `GET /notes`, `POST /notes`.
//!
//! The contract is the one `src/lib/notes-sync.js` writes and
//! `_normalize_note_doc` reads: a note document with `items[]` (ref, type,
//! text, owner, due, status, review, confidence), a `meeting{}` block
//! (attendees, chair, agenda counts, issuedAt) and, from the macOS app, a
//! `transcript[]` of `{t0, t1, source, translation}`.
//!
//! Everything here is pure except [`request`] and [`fetch`], which speak
//! plain HTTP/1.1 to `127.0.0.1` with `std::net` only. The pages ask this
//! module which of the five states they are in ([`PageState`]) and what a
//! decision button changes ([`decide`]); nothing in it draws.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

/// native/server.py's default port (`PORT`).
pub const DEFAULT_PORT: u16 = 17865;
/// The port to talk to: `YSM_HELPER_PORT`, else the helper's default.
pub fn port_from_env(var: Option<&str>) -> u16 {
    var.and_then(|v| v.trim().parse().ok()).filter(|p| *p != 0).unwrap_or(DEFAULT_PORT)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Decision,
    Action,
    Question,
    Risk,
    Metric,
    Info,
}

impl Kind {
    pub fn parse(s: &str) -> Kind {
        match s {
            "decision" => Kind::Decision,
            "action" => Kind::Action,
            "question" => Kind::Question,
            "risk" => Kind::Risk,
            "metric" => Kind::Metric,
            _ => Kind::Info,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Decision => "Decision",
            Kind::Action => "Action",
            Kind::Question => "Question",
            Kind::Risk => "Risk",
            Kind::Metric => "Metric",
            Kind::Info => "Info",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Open,
    Progress,
    Closed,
    Carried,
}

impl Status {
    fn parse(s: &str) -> Status {
        match s {
            "progress" => Status::Progress,
            "closed" => Status::Closed,
            "carried" => Status::Carried,
            _ => Status::Open,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Review {
    Ai,
    Accepted,
    Edited,
}

impl Review {
    fn parse(s: &str) -> Review {
        match s {
            "accepted" => Review::Accepted,
            "edited" => Review::Edited,
            _ => Review::Ai,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub rf: String,
    pub kind: Kind,
    pub text: String,
    pub owner: Option<String>,
    pub due: Option<String>,
    pub status: Status,
    pub review: Review,
}

impl Item {
    /// A decision, action or question nobody has taken yet: it waits on a person.
    pub fn waits(&self) -> bool {
        self.status == Status::Open && self.review == Review::Ai && matches!(self.kind, Kind::Decision | Kind::Action | Kind::Question)
    }

    /// Still open for the Inbox: an action, question or risk that is not closed.
    pub fn inbox_open(&self) -> bool {
        matches!(self.kind, Kind::Action | Kind::Question | Kind::Risk) && self.status != Status::Closed
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub t0: f64,
    pub t1: f64,
    pub source: String,
    pub translation: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub date: String,
    pub issued: bool,
    pub items: Vec<Item>,
    pub transcript: Vec<Line>,
    pub attendees: Vec<String>,
    pub agenda_total: u32,
    pub agenda_covered: u32,
    /// The document as the helper sent it. A decision edits this and posts it
    /// back, so keys this version does not know survive the round trip.
    pub raw: Value,
}

impl Note {
    pub fn waiting(&self) -> usize {
        self.items.iter().filter(|i| i.waits()).count()
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Health {
    pub engine: String,
    pub model: String,
    pub device: String,
    pub compute: String,
    pub translate: bool,
    pub platform: String,
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn parse_health(body: &str) -> Option<Health> {
    let v: Value = serde_json::from_str(body).ok()?;
    if v.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    Some(Health {
        engine: text(&v, "engine").unwrap_or_default(),
        model: text(&v, "model").unwrap_or_default(),
        device: text(&v, "device").unwrap_or_default(),
        compute: text(&v, "compute").unwrap_or_default(),
        translate: v.get("translate").and_then(Value::as_bool).unwrap_or(false),
        platform: text(&v, "platform").unwrap_or_default(),
    })
}

fn parse_item(v: &Value, n: usize) -> Option<Item> {
    let body = text(v, "text")?;
    Some(Item {
        rf: text(v, "ref").unwrap_or_else(|| format!("I-{}", n + 1)),
        kind: Kind::parse(v.get("type").and_then(Value::as_str).unwrap_or("")),
        text: body,
        owner: text(v, "owner"),
        due: text(v, "due"),
        status: Status::parse(v.get("status").and_then(Value::as_str).unwrap_or("")),
        review: Review::parse(v.get("review").and_then(Value::as_str).unwrap_or("")),
    })
}

fn parse_note(v: &Value) -> Option<Note> {
    let id = text(v, "id")?;
    let meeting = v.get("meeting");
    let meeting_str = |k: &str| meeting.and_then(|m| text(m, k));
    let agenda = meeting.and_then(|m| m.get("agenda"));
    let count = |k: &str| agenda.and_then(|a| a.get(k)).and_then(Value::as_u64).unwrap_or(0) as u32;
    Some(Note {
        title: text(v, "title").unwrap_or_else(|| "Meeting".into()),
        date: text(v, "date").unwrap_or_default(),
        issued: text(v, "status").as_deref() == Some("issued") || meeting_str("issuedAt").is_some(),
        items: v.get("items").and_then(Value::as_array).map(|a| a.iter().enumerate().filter_map(|(n, i)| parse_item(i, n)).collect()).unwrap_or_default(),
        transcript: v
            .get("transcript")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|l| {
                        let source = text(l, "source")?;
                        Some(Line {
                            t0: l.get("t0").and_then(Value::as_f64).unwrap_or(0.0),
                            t1: l.get("t1").and_then(Value::as_f64).unwrap_or(0.0),
                            source,
                            translation: text(l, "translation").unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        attendees: meeting.and_then(|m| m.get("attendees")).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str()).map(person_name).collect()).unwrap_or_default(),
        agenda_total: count("total"),
        agenda_covered: count("covered"),
        raw: v.clone(),
        id,
    })
}

/// "Mei Lin (Client HSE)" -> "Mei Lin".
fn person_name(s: &str) -> String {
    s.split(" (").next().unwrap_or(s).trim().to_string()
}

/// The notes of a `GET /notes` body, newest first as the helper keeps them.
pub fn parse_notes(body: &str) -> Option<Vec<Note>> {
    let v: Value = serde_json::from_str(body).ok()?;
    Some(v.get("notes")?.as_array()?.iter().filter_map(parse_note).collect())
}

/// What the island knows of the helper.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Snapshot {
    pub health: Health,
    pub notes: Vec<Note>,
}

/// Whether the helper answered the last time we asked.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Link {
    /// Not asked yet.
    #[default]
    Connecting,
    Online,
    /// Why not, in words for the person.
    Offline(String),
}

/// The five states every page has (boards I01-I08).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageState {
    Normal,
    Empty,
    Error,
    Locked,
    Needs,
}

/// The note the pages show: the newest one.
pub fn current(notes: &[Note]) -> Option<&Note> {
    notes.first()
}

pub fn meeting_state(link: &Link, notes: &[Note]) -> PageState {
    if matches!(link, Link::Offline(_)) {
        return PageState::Error;
    }
    match current(notes) {
        None => PageState::Empty,
        Some(n) if n.items.is_empty() => PageState::Empty,
        Some(n) if n.issued => PageState::Locked,
        Some(n) if n.waiting() > 0 => PageState::Needs,
        Some(_) => PageState::Normal,
    }
}

/// An open item and the meeting it came from.
#[derive(Clone, Debug, PartialEq)]
pub struct InboxRow<'a> {
    pub note: &'a Note,
    pub item: &'a Item,
}

/// Open items across meetings. Issued meetings are read-only and listed
/// apart ([`inbox_locked`]).
pub fn inbox(notes: &[Note]) -> Vec<InboxRow<'_>> {
    notes.iter().filter(|n| !n.issued).flat_map(|n| n.items.iter().filter(|i| i.inbox_open()).map(move |item| InboxRow { note: n, item })).collect()
}

/// Open items that sit in issued meetings.
pub fn inbox_locked(notes: &[Note]) -> usize {
    notes.iter().filter(|n| n.issued).map(|n| n.items.iter().filter(|i| i.inbox_open()).count()).sum()
}

pub fn inbox_state(link: &Link, notes: &[Note]) -> PageState {
    if matches!(link, Link::Offline(_)) {
        PageState::Error
    } else if !inbox(notes).is_empty() {
        PageState::Normal
    } else if inbox_locked(notes) > 0 {
        PageState::Locked
    } else {
        PageState::Empty
    }
}

/// The three caption lines of the Live page.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Captions {
    pub previous: String,
    pub current: String,
    pub translation: String,
}

/// The lines up to and including index `at` (the newest when `None`: a
/// paused page passes the index it froze on).
pub fn captions(note: &Note, at: Option<usize>) -> Captions {
    let n = note.transcript.len();
    if n == 0 {
        return Captions::default();
    }
    let i = at.map_or(n - 1, |a| a.min(n - 1));
    Captions {
        previous: if i > 0 { note.transcript[i - 1].source.clone() } else { String::new() },
        current: note.transcript[i].source.clone(),
        translation: note.transcript[i].translation.clone(),
    }
}

/// `following`: the person has not pressed Stop on the Live page.
pub fn live_state(link: &Link, notes: &[Note], following: bool) -> PageState {
    if matches!(link, Link::Offline(_)) {
        return PageState::Error;
    }
    match current(notes) {
        Some(n) if n.issued && !n.transcript.is_empty() => PageState::Locked,
        Some(n) if following && !n.transcript.is_empty() => {
            if n.waiting() > 0 {
                PageState::Needs
            } else {
                PageState::Normal
            }
        }
        _ => PageState::Empty,
    }
}

/// What the three decision buttons and Assign change on an item.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// A person confirms what the engine wrote.
    Accept,
    /// A question that got its answer.
    Answered,
    /// Move it to the next meeting.
    Carry,
    /// Give it to the next attendee after the current owner.
    Assign,
}

/// The person Assign gives `item` to: the next attendee after its owner (the
/// first when it has none or the owner is not listed).
pub fn next_owner(item: &Item, attendees: &[String]) -> Option<String> {
    if attendees.is_empty() {
        return None;
    }
    let at = item.owner.as_deref().and_then(|o| attendees.iter().position(|a| a == o));
    Some(attendees[at.map_or(0, |i| (i + 1) % attendees.len())].clone())
}

/// The `POST /notes` body that applies `d` to the item `rf` of `note`, or
/// `None` when the meeting is issued, the item is missing, or Assign has
/// nobody to give it to. The document is the helper's own, edited in place,
/// so nothing the island does not know is lost; an action's entry in the
/// v1 `actions[]` list follows its status (older readers use that list).
pub fn decide(note: &Note, rf: &str, d: Decision) -> Option<String> {
    if note.issued {
        return None;
    }
    let item = note.items.iter().find(|i| i.rf == rf)?;
    let owner = if d == Decision::Assign { Some(next_owner(item, &note.attendees)?) } else { None };
    let mut doc = note.raw.clone();
    let it = doc.get_mut("items")?.as_array_mut()?.iter_mut().find(|i| i.get("ref").and_then(Value::as_str) == Some(rf))?;
    match d {
        Decision::Accept => it["review"] = json!("accepted"),
        Decision::Answered => {
            it["status"] = json!("closed");
            it["review"] = json!("accepted");
        }
        Decision::Carry => it["status"] = json!("carried"),
        Decision::Assign => {
            it["owner"] = json!(owner);
            it["review"] = json!("edited");
        }
    }
    let status = it.get("status").cloned();
    let owner_now = it.get("owner").cloned();
    if let (Some(actions), Some(status)) = (doc.get_mut("actions").and_then(Value::as_array_mut), status) {
        if let Some(a) = actions.iter_mut().find(|a| a.get("id").and_then(Value::as_str) == Some(rf)) {
            a["status"] = if status == json!("closed") { json!("closed") } else { json!("open") };
            if let Some(o) = owner_now.filter(|o| !o.is_null()) {
                a["owner"] = o;
            }
        }
    }
    serde_json::to_string(&json!({ "note": doc })).ok()
}

/// Talk time as far as the register knows it: how many items each speaker
/// raised (the helper's transcript lines carry no speaker), most first.
pub fn talk_share(note: &Note) -> Vec<(String, f32)> {
    let mut by: Vec<(String, u32)> = Vec::new();
    for who in note.items.iter().filter_map(|i| i.owner.clone()) {
        match by.iter_mut().find(|(n, _)| *n == who) {
            Some((_, c)) => *c += 1,
            None => by.push((who, 1)),
        }
    }
    let total: u32 = by.iter().map(|(_, c)| c).sum();
    by.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    by.into_iter().map(|(n, c)| (n, c as f32 / total.max(1) as f32)).collect()
}

/// One HTTP/1.1 request to the helper on loopback. Returns the status and body.
pub fn request(port: u16, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(800)).map_err(|e| e.to_string())?;
    let t = Some(Duration::from_secs(4));
    let _ = s.set_read_timeout(t);
    let _ = s.set_write_timeout(t);
    let payload = body.unwrap_or("");
    let head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n", payload.len());
    s.write_all(head.as_bytes()).and_then(|_| s.write_all(payload.as_bytes())).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    parse_response(&raw)
}

/// The status line and body of a raw HTTP response.
pub fn parse_response(raw: &[u8]) -> Result<(u16, String), String> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no response")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let status = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|c| c.parse().ok()).ok_or("bad status line")?;
    let body = &raw[split + 4..];
    // The helpers send Content-Length; a chunked body would need its own reader.
    if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        return Err("chunked responses are not supported".into());
    }
    Ok((status, String::from_utf8_lossy(body).into_owned()))
}

/// Ask `/health` and `/notes`. An answer that is not JSON of the expected
/// shape counts as "not the helper".
pub fn fetch(port: u16) -> Result<Snapshot, String> {
    let (code, body) = request(port, "GET", "/health", None).map_err(|e| format!("The helper is not running ({e})."))?;
    let health = if code == 200 { parse_health(&body) } else { None }.ok_or_else(|| format!("Port {port} answered, but not as the helper."))?;
    let (code, body) = request(port, "GET", "/notes", None)?;
    let notes = if code == 200 { parse_notes(&body) } else { None }.ok_or("The helper's notes could not be read.")?;
    Ok(Snapshot { health, notes })
}

/// `POST /notes` with a body from [`decide`].
pub fn post_note(port: u16, body: &str) -> Result<(), String> {
    let (code, reply) = request(port, "POST", "/notes", Some(body))?;
    if code == 200 {
        Ok(())
    } else {
        Err(serde_json::from_str::<Value>(&reply).ok().and_then(|v| text(&v, "error")).unwrap_or_else(|| format!("The helper said {code}.")))
    }
}

/// Items nobody owns yet (the Talk page asks who).
pub fn unowned(note: &Note) -> usize {
    note.items.iter().filter(|i| i.owner.is_none() && i.kind != Kind::Info).count()
}

pub fn timer_state(link: &Link, notes: &[Note]) -> PageState {
    if matches!(link, Link::Offline(_)) {
        return PageState::Error;
    }
    match current(notes) {
        None => PageState::Empty,
        Some(n) if n.issued => PageState::Locked,
        Some(n) if n.agenda_total == 0 => PageState::Needs,
        Some(_) => PageState::Normal,
    }
}

pub fn talk_state(link: &Link, notes: &[Note]) -> PageState {
    if matches!(link, Link::Offline(_)) {
        return PageState::Error;
    }
    match current(notes) {
        Some(n) if !talk_share(n).is_empty() => {
            if n.issued {
                PageState::Locked
            } else if unowned(n) > 0 {
                PageState::Needs
            } else {
                PageState::Normal
            }
        }
        _ => PageState::Empty,
    }
}

/// No Locked here: the engine has nothing to read-protect.
pub fn engine_state(link: &Link, health: &Health) -> PageState {
    match link {
        Link::Offline(_) => PageState::Error,
        Link::Connecting => PageState::Empty,
        Link::Online if !health.translate => PageState::Needs,
        Link::Online => PageState::Normal,
    }
}

/// "m:ss" or "h:mm:ss".
pub fn clock(secs: f64) -> String {
    let t = secs.max(0.0) as u64;
    if t >= 3600 {
        format!("{}:{:02}:{:02}", t / 3600, t / 60 % 60, t % 60)
    } else {
        format!("{}:{:02}", t / 60, t % 60)
    }
}

/// A stopwatch on the island's own clock (mono seconds), for the Agenda timer.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Stopwatch {
    since: Option<f64>,
    before: f64,
}

impl Stopwatch {
    pub fn running(&self) -> bool {
        self.since.is_some()
    }
    pub fn elapsed(&self, now: f64) -> f64 {
        self.before + self.since.map_or(0.0, |s| (now - s).max(0.0))
    }
    pub fn toggle(&mut self, now: f64) {
        match self.since.take() {
            Some(s) => self.before += (now - s).max(0.0),
            None => self.since = Some(now),
        }
    }
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// Round trips kept for the Engine monitor's bars.
pub const RTT_KEPT: usize = 24;

/// Everything the island pages read of the helper, owned by the UI thread.
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub link: Link,
    pub snap: Snapshot,
    /// Live follows the newest line until Stop; Start follows again.
    pub following: bool,
    /// Live is paused on this line of the newest note.
    pub frozen: Option<usize>,
    /// Milliseconds of the last answers, oldest first.
    pub rtt: Vec<u32>,
    pub timer: Stopwatch,
}

impl Default for View {
    fn default() -> Self {
        Self { link: Link::Connecting, snap: Snapshot::default(), following: true, frozen: None, rtt: Vec::new(), timer: Stopwatch::default() }
    }
}

impl View {
    /// Take the service's answer: a snapshot and how long it took, or why not.
    /// An offline helper keeps the last notes on screen (stale, not blank).
    pub fn apply(&mut self, r: Result<(Snapshot, u32), String>) {
        match r {
            Ok((snap, ms)) => {
                self.link = Link::Online;
                self.snap = snap;
                self.rtt.push(ms);
                if self.rtt.len() > RTT_KEPT {
                    self.rtt.remove(0);
                }
            }
            Err(e) => self.link = Link::Offline(e),
        }
    }

    pub fn note(&self) -> Option<&Note> {
        current(&self.snap.notes)
    }

    /// Pause on the current line, or let go.
    pub fn toggle_pause(&mut self) {
        self.frozen = match (self.frozen, self.note()) {
            (None, Some(n)) if !n.transcript.is_empty() => Some(n.transcript.len() - 1),
            _ => None,
        };
    }

    /// Stop following; Start follows again from the newest line.
    pub fn set_following(&mut self, on: bool) {
        self.following = on;
        self.frozen = None;
    }

    pub fn live_state(&self) -> PageState {
        live_state(&self.link, &self.snap.notes, self.following)
    }

    pub fn captions(&self) -> Captions {
        self.note().map(|n| captions(n, self.frozen)).unwrap_or_default()
    }
}

/// `YSM_HELPER_PORT`, else the helper's default.
pub fn configured_port() -> u16 {
    port_from_env(std::env::var("YSM_HELPER_PORT").ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTES: &str = r#"{"notes":[
      {"id":"MOM-1","title":"Rapat K3","date":"2026-02-17","status":"ready","summary":"s",
       "decisions":["Drill dipindah"],"actions":[{"id":"A-1","text":"Topik","owner":null,"due":"Fri","status":"open"}],
       "meeting":{"attendees":["Lars Nilsen (CSE)","Mei Lin"],"agenda":{"total":5,"covered":2},"issuedAt":null},
       "transcript":[{"t0":0,"t1":2,"source":"Satu.","translation":"One."},{"t0":2,"t1":4,"source":"Dua.","translation":"Two."}],
       "items":[
        {"ref":"D-1","type":"decision","text":"Drill dipindah ke Jumat","status":"open","review":"ai"},
        {"ref":"Q-1","type":"question","text":"Near-miss log?","status":"open","review":"ai"},
        {"ref":"A-1","type":"action","text":"Topik","owner":"Mei Lin","due":"Fri","status":"open","review":"accepted"},
        {"ref":"R-1","type":"risk","text":"Heat stress","status":"open","review":"accepted"},
        {"ref":"I-1","type":"info","text":"fyi"}]},
      {"id":"MOM-0","title":"Rapat W01","status":"issued","items":[{"ref":"A-9","type":"action","text":"Lama","status":"open","review":"accepted"}]}
    ]}"#;

    fn notes() -> Vec<Note> {
        parse_notes(NOTES).unwrap()
    }

    #[test]
    fn health_needs_ok_true() {
        let h = parse_health(r#"{"ok":true,"engine":"faster-whisper","model":"large-v3","device":"cuda","compute":"float16","translate":true,"platform":"windows"}"#).unwrap();
        assert_eq!((h.engine.as_str(), h.device.as_str(), h.translate), ("faster-whisper", "cuda", true));
        assert!(parse_health(r#"{"ok":false}"#).is_none());
        assert!(parse_health("<html>").is_none());
    }

    #[test]
    fn notes_parse_items_transcript_and_meeting() {
        let n = notes();
        assert_eq!(n.len(), 2);
        let a = &n[0];
        assert_eq!((a.id.as_str(), a.items.len(), a.transcript.len()), ("MOM-1", 5, 2));
        assert_eq!(a.attendees, ["Lars Nilsen", "Mei Lin"]);
        assert_eq!((a.agenda_total, a.agenda_covered, a.issued), (5, 2, false));
        assert!(n[1].issued);
        assert_eq!(a.waiting(), 2);
        // Bad bodies are not notes.
        assert!(parse_notes("{}").is_none());
        assert!(parse_notes("nope").is_none());
        // An item without text, and a note without id, are dropped.
        let v = parse_notes(r#"{"notes":[{"title":"x"},{"id":"a","items":[{"ref":"x"}]}]}"#).unwrap();
        assert_eq!((v.len(), v[0].items.len()), (1, 0));
    }

    #[test]
    fn meeting_states() {
        let n = notes();
        assert_eq!(meeting_state(&Link::Online, &n), PageState::Needs);
        assert_eq!(meeting_state(&Link::Offline("x".into()), &n), PageState::Error);
        assert_eq!(meeting_state(&Link::Online, &[]), PageState::Empty);
        assert_eq!(meeting_state(&Link::Online, &n[1..]), PageState::Locked);
        let mut done = n[0].clone();
        for i in &mut done.items {
            i.review = Review::Accepted;
        }
        assert_eq!(meeting_state(&Link::Online, &[done]), PageState::Normal);
    }

    #[test]
    fn inbox_lists_open_items_and_reports_locked() {
        let n = notes();
        let rows = inbox(&n);
        let refs: Vec<&str> = rows.iter().map(|r| r.item.rf.as_str()).collect();
        assert_eq!(refs, ["Q-1", "A-1", "R-1"]);
        assert_eq!(inbox_locked(&n), 1);
        assert_eq!(inbox_state(&Link::Online, &n), PageState::Normal);
        assert_eq!(inbox_state(&Link::Online, &n[1..]), PageState::Locked);
        assert_eq!(inbox_state(&Link::Online, &[]), PageState::Empty);
        assert_eq!(inbox_state(&Link::Offline("x".into()), &n), PageState::Error);
    }

    #[test]
    fn captions_follow_the_tail_or_a_frozen_line() {
        let n = notes();
        let c = captions(&n[0], None);
        assert_eq!((c.previous.as_str(), c.current.as_str(), c.translation.as_str()), ("Satu.", "Dua.", "Two."));
        let f = captions(&n[0], Some(0));
        assert_eq!((f.previous.as_str(), f.current.as_str()), ("", "Satu."));
        assert_eq!(captions(&n[0], Some(99)).current, "Dua.");
        assert_eq!(captions(&n[1], None), Captions::default());
    }

    #[test]
    fn live_states() {
        let n = notes();
        assert_eq!(live_state(&Link::Online, &n, true), PageState::Needs);
        assert_eq!(live_state(&Link::Online, &n, false), PageState::Empty);
        assert_eq!(live_state(&Link::Online, &[], true), PageState::Empty);
        assert_eq!(live_state(&Link::Offline("x".into()), &n, true), PageState::Error);
        let mut issued = n[0].clone();
        issued.issued = true;
        assert_eq!(live_state(&Link::Online, &[issued], true), PageState::Locked);
    }

    #[test]
    fn decisions_edit_the_document_and_keep_unknown_keys() {
        let mut n = notes().remove(0);
        n.raw["futureKey"] = json!(42);
        n.raw["items"][0]["futureItemKey"] = json!("x");
        let post = |d, rf| -> Value { serde_json::from_str(&decide(&n, rf, d).unwrap()).unwrap() };
        let v = post(Decision::Accept, "D-1");
        assert_eq!(v["note"]["items"][0]["review"], "accepted");
        assert_eq!(v["note"]["futureKey"], 42);
        assert_eq!(v["note"]["items"][0]["futureItemKey"], "x");
        assert_eq!(v["note"]["items"][1]["review"], "ai", "other items stay");
        let v = post(Decision::Answered, "Q-1");
        assert_eq!((v["note"]["items"][1]["status"].as_str(), v["note"]["items"][1]["review"].as_str()), (Some("closed"), Some("accepted")));
        let v = post(Decision::Carry, "A-1");
        assert_eq!(v["note"]["items"][2]["status"], "carried");
        assert_eq!(v["note"]["actions"][0]["status"], "open", "v1 list: carried is not closed");
        let v = post(Decision::Assign, "D-1");
        assert_eq!(v["note"]["items"][0]["owner"], "Lars Nilsen");
        // Assign again from Mei Lin wraps to the first attendee.
        let v = post(Decision::Assign, "A-1");
        assert_eq!(v["note"]["items"][2]["owner"], "Lars Nilsen");
        assert_eq!(v["note"]["actions"][0]["owner"], "Lars Nilsen");
    }

    #[test]
    fn closing_an_action_closes_its_v1_entry() {
        let mut n = notes().remove(0);
        n.items[2].status = Status::Open;
        let body = decide(&n, "A-1", Decision::Answered).unwrap();
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["note"]["actions"][0]["status"], "closed");
    }

    #[test]
    fn decide_refuses_issued_missing_and_nobody_to_assign() {
        let n = notes();
        assert!(decide(&n[1], "A-9", Decision::Accept).is_none(), "issued meetings are read-only");
        assert!(decide(&n[0], "NOPE", Decision::Accept).is_none());
        let mut alone = n[0].clone();
        alone.attendees.clear();
        assert!(decide(&alone, "D-1", Decision::Assign).is_none());
    }

    #[test]
    fn talk_share_counts_owners() {
        let n = notes();
        let t = talk_share(&n[0]);
        assert_eq!(t, vec![("Mei Lin".to_string(), 1.0)]);
        assert!(talk_share(&n[1]).is_empty());
    }

    #[test]
    fn port_and_response_parsing() {
        assert_eq!(port_from_env(None), DEFAULT_PORT);
        assert_eq!(port_from_env(Some(" 4100 ")), 4100);
        assert_eq!(port_from_env(Some("0")), DEFAULT_PORT);
        assert_eq!(port_from_env(Some("abc")), DEFAULT_PORT);
        let (c, b) = parse_response(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        assert_eq!((c, b.as_str()), (200, "{}"));
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n").is_err());
        assert!(parse_response(b"garbage").is_err());
    }

    #[test]
    fn a_closed_port_is_an_error_not_a_hang() {
        // Port 1 is never open on a dev machine; the connect is refused at once.
        assert!(fetch(1).is_err());
    }

    #[test]
    fn stopwatch_and_view() {
        let mut w = Stopwatch::default();
        assert_eq!(w.elapsed(10.0), 0.0);
        w.toggle(10.0);
        assert!(w.running());
        assert_eq!(w.elapsed(15.0), 5.0);
        w.toggle(15.0);
        assert_eq!(w.elapsed(99.0), 5.0, "paused keeps its time");
        w.toggle(20.0);
        assert_eq!(w.elapsed(22.0), 7.0);
        w.reset();
        assert!(!w.running() && w.elapsed(30.0) == 0.0);

        let mut v = View::default();
        assert_eq!(v.live_state(), PageState::Empty);
        v.apply(Ok((Snapshot { notes: notes(), ..Default::default() }, 12)));
        assert_eq!(v.link, Link::Online);
        assert_eq!(v.live_state(), PageState::Needs);
        assert_eq!(v.captions().current, "Dua.");
        v.toggle_pause();
        assert_eq!(v.frozen, Some(1));
        v.frozen = Some(0);
        assert_eq!(v.captions().current, "Satu.");
        v.toggle_pause();
        assert_eq!(v.frozen, None);
        v.set_following(false);
        assert_eq!(v.live_state(), PageState::Empty);
        v.apply(Err("down".into()));
        assert_eq!(v.live_state(), PageState::Error);
        assert!(!v.snap.notes.is_empty(), "the last notes stay");
        for i in 0..40 {
            v.apply(Ok((Snapshot::default(), i)));
        }
        assert_eq!(v.rtt.len(), RTT_KEPT);
        assert_eq!(*v.rtt.last().unwrap(), 39);
    }

    #[test]
    fn timer_talk_engine_states() {
        let n = notes();
        let off = Link::Offline("x".into());
        assert_eq!(timer_state(&Link::Online, &n), PageState::Normal);
        assert_eq!(timer_state(&Link::Online, &n[1..]), PageState::Locked);
        assert_eq!(timer_state(&Link::Online, &[]), PageState::Empty);
        assert_eq!(timer_state(&off, &n), PageState::Error);
        let mut none = n[0].clone();
        none.agenda_total = 0;
        assert_eq!(timer_state(&Link::Online, &[none]), PageState::Needs, "no agenda to count");

        assert_eq!(unowned(&n[0]), 3, "decision, question, risk have no owner; the info row is not counted");
        assert_eq!(talk_state(&Link::Online, &n), PageState::Needs);
        assert_eq!(talk_state(&Link::Online, &n[1..]), PageState::Empty, "nobody owns anything");
        assert_eq!(talk_state(&off, &n), PageState::Error);
        let mut owned = n[0].clone();
        for i in &mut owned.items {
            i.owner = Some("Mei Lin".into());
        }
        assert_eq!(talk_state(&Link::Online, &[owned.clone()]), PageState::Normal);
        owned.issued = true;
        assert_eq!(talk_state(&Link::Online, &[owned]), PageState::Locked);

        let mut h = Health { translate: true, ..Default::default() };
        assert_eq!(engine_state(&Link::Online, &h), PageState::Normal);
        h.translate = false;
        assert_eq!(engine_state(&Link::Online, &h), PageState::Needs);
        assert_eq!(engine_state(&Link::Connecting, &h), PageState::Empty);
        assert_eq!(engine_state(&off, &h), PageState::Error);
    }

    #[test]
    fn clock_formats() {
        assert_eq!((clock(0.0).as_str(), clock(65.4).as_str(), clock(3725.0).as_str(), clock(-3.0).as_str()), ("0:00", "1:05", "1:02:05", "0:00"));
    }
}
