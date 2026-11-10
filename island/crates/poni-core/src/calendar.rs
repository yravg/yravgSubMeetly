//! The island's view of the engine's calendar (`GET /calendar`, see
//! `engine-rs/engine/src/calendar.rs`): meetings read from an Outlook or Gmail
//! ICS link or an imported `.ics` file.
//!
//! Everything here is pure except the five request helpers at the bottom,
//! which reuse [`helper::request`]. The ICS link is a secret: the engine hands
//! back only a masked form (`https://host/...`), and nothing here ever sees
//! or logs the full link except [`add_link`], which sends it to the engine on
//! loopback and drops it.
//!
//! Times: a timed event carries epoch seconds (UTC). An all-day event carries
//! the UTC midnight of its civil date (end exclusive) and `all_day`; [`Event::span`]
//! turns it into the person's local midnight with the clock's UTC offset.

use crate::datetime::{civil_from_days, days_from_civil, fmt_date_short, LocalDateTime};
use crate::helper;
use serde_json::{json, Value};

/// How often the island asks for the calendar again.
pub const EVERY_S: u64 = 60;
/// The pill says "in N min" this long before a meeting starts (seconds)...
pub const SOON_LEAD_S: i64 = 15 * 60;
/// ...and "starting" this long after.
pub const SOON_GRACE_S: i64 = 2 * 60;

#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub id: String,
    pub title: String,
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub location: Option<String>,
    pub organizer: Option<String>,
    pub attendees: usize,
    /// Only `http(s)`: it is opened by the browser.
    pub join_url: Option<String>,
    pub recurring: bool,
}

impl Event {
    /// (start, end) in epoch seconds, with an all-day event placed on the
    /// person's local midnights. `offset` = local minus UTC, in seconds.
    pub fn span(&self, offset: i64) -> (i64, i64) {
        if self.all_day {
            (self.start - offset, self.end - offset)
        } else {
            (self.start, self.end.max(self.start))
        }
    }

    pub fn is_now(&self, now: i64, offset: i64) -> bool {
        let (s, e) = self.span(offset);
        s <= now && now < e
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Link,
    File,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    pub id: String,
    pub kind: SourceKind,
    pub name: String,
    /// `https://host/...` for a link; the full link never comes back.
    pub link: Option<String>,
    pub events: usize,
    pub last_error: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Calendar {
    pub sources: Vec<Source>,
    pub events: Vec<Event>,
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// `2026-11-09T14:00:00Z` -> (epoch seconds, false); `2026-11-09` -> (UTC
/// midnight of that date, true). Anything else is `None`.
pub fn parse_iso(s: &str) -> Option<(i64, bool)> {
    let b = s.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        s.get(from..from + len)?
            .bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| s[from..from + len].parse().ok())?
    };
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y as i32, m as u8, d as u8);
    if b.len() == 10 {
        return Some((days * 86_400, true));
    }
    if b.len() != 20 || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[19] != b'Z' {
        return None;
    }
    let (h, mi, se) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if h > 23 || mi > 59 || se > 60 {
        return None;
    }
    Some((days * 86_400 + h * 3600 + mi * 60 + se, false))
}

fn parse_event(v: &Value) -> Option<Event> {
    let (start, all_day) = parse_iso(v.get("start")?.as_str()?)?;
    let (end, _) = parse_iso(v.get("end")?.as_str()?)?;
    let join_url =
        text(v, "joinUrl").filter(|u| u.starts_with("https://") || u.starts_with("http://"));
    let organizer = v
        .get("organizer")
        .filter(|o| o.is_object())
        .and_then(|o| text(o, "name").or_else(|| text(o, "email")));
    Some(Event {
        id: text(v, "id")?,
        title: text(v, "title").unwrap_or_else(|| "(No title)".into()),
        start,
        end,
        all_day,
        location: text(v, "location"),
        organizer,
        attendees: v
            .get("attendees")
            .and_then(Value::as_array)
            .map_or(0, Vec::len),
        join_url,
        recurring: v.get("recurring").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn parse_source(v: &Value) -> Option<Source> {
    Some(Source {
        id: text(v, "id")?,
        kind: if text(v, "kind").as_deref() == Some("link") {
            SourceKind::Link
        } else {
            SourceKind::File
        },
        name: text(v, "name").unwrap_or_else(|| "Calendar".into()),
        link: text(v, "link"),
        events: v.get("events").and_then(Value::as_u64).unwrap_or(0) as usize,
        last_error: text(v, "lastError"),
        warnings: v
            .get("warnings")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|w| w.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// A `GET /calendar` body.
pub fn parse_calendar(body: &str) -> Option<Calendar> {
    let v: Value = serde_json::from_str(body).ok()?;
    let sources = v
        .get("sources")?
        .as_array()?
        .iter()
        .filter_map(parse_source)
        .collect();
    let events = v
        .get("events")?
        .as_array()?
        .iter()
        .filter_map(parse_event)
        .collect();
    Some(Calendar { sources, events })
}

// ------------------------------------------------------------------- when

/// Local minus UTC in seconds, from the wall clock and the epoch read at the
/// same moment, rounded to a quarter hour (the clocks are read a few ms apart).
pub fn utc_offset(local: &LocalDateTime, unix: i64) -> i64 {
    let wall = days_from_civil(local.year, local.month, local.day) * 86_400
        + local.hour as i64 * 3600
        + local.minute as i64 * 60
        + local.second as i64;
    ((wall - unix) as f64 / 900.0).round() as i64 * 900
}

/// The wall clock at epoch second `t` in a zone `offset` seconds from UTC.
pub fn local_at(t: i64, offset: i64) -> LocalDateTime {
    let s = t + offset;
    let (y, m, d) = civil_from_days(s.div_euclid(86_400));
    let r = s.rem_euclid(86_400);
    LocalDateTime {
        year: y,
        month: m,
        day: d,
        hour: (r / 3600) as u8,
        minute: (r / 60 % 60) as u8,
        second: (r % 60) as u8,
    }
}

/// Local day number (days since 1970-01-01 on the person's wall clock).
pub fn local_day(t: i64, offset: i64) -> i64 {
    (t + offset).div_euclid(86_400)
}

/// Events that have not ended, starting before the local midnight `days`
/// days after today's, earliest first.
pub fn upcoming(cal: &Calendar, now: i64, offset: i64, days: i64) -> Vec<&Event> {
    let horizon = (local_day(now, offset) + days) * 86_400 - offset;
    let mut v: Vec<&Event> = cal
        .events
        .iter()
        .filter(|e| e.span(offset).1 > now && e.span(offset).0 < horizon)
        .collect();
    v.sort_by(|a, b| {
        a.span(offset)
            .0
            .cmp(&b.span(offset).0)
            .then_with(|| a.title.cmp(&b.title))
    });
    v
}

/// "Today", "Tomorrow", else "Wed 11 Nov".
pub fn day_label(day: i64, today: i64) -> String {
    match day - today {
        0 => "Today".into(),
        1 => "Tomorrow".into(),
        _ => {
            let (y, m, d) = civil_from_days(day);
            fmt_date_short(&LocalDateTime {
                year: y,
                month: m,
                day: d,
                ..Default::default()
            })
        }
    }
}

fn clock(t: &LocalDateTime, use_24h: bool) -> String {
    crate::datetime::fmt_clock(t, use_24h)
}

/// "14:00 - 15:00", or "All day".
pub fn range_label(e: &Event, offset: i64, use_24h: bool) -> String {
    if e.all_day {
        return "All day".into();
    }
    let (s, t) = e.span(offset);
    format!(
        "{} \u{2013} {}",
        clock(&local_at(s, offset), use_24h),
        clock(&local_at(t, offset), use_24h)
    )
}

/// The meeting the pill should mention: the first timed event that starts
/// within [`SOON_LEAD_S`], or began at most [`SOON_GRACE_S`] ago.
#[derive(Clone, Debug, PartialEq)]
pub struct Soon<'a> {
    pub event: &'a Event,
    /// Whole minutes until it starts, rounded up; 0 = starting now.
    pub mins: i64,
}

pub fn soon(cal: &Calendar, now: i64) -> Option<Soon<'_>> {
    cal.events
        .iter()
        .filter(|e| !e.all_day && (-SOON_GRACE_S..=SOON_LEAD_S).contains(&(e.start - now)))
        .min_by_key(|e| e.start)
        .map(|event| Soon {
            event,
            mins: ((event.start - now).max(0) + 59) / 60,
        })
}

/// The pill's words for [`Soon`]: "Standup in 5 min" / "Standup starting".
pub fn soon_text(s: &Soon<'_>) -> String {
    match s.mins {
        0 => format!("{} starting", s.event.title),
        n => format!("{} in {n} min", s.event.title),
    }
}

// ---------------------------------------------------------------- requests

fn reason(code: u16, reply: &str) -> String {
    serde_json::from_str::<Value>(reply)
        .ok()
        .and_then(|v| text(&v, "error"))
        .unwrap_or_else(|| format!("The engine said {code}."))
}

/// How long a request that makes the engine read a calendar link waits. Above the engine's own
/// fetch limit (60 s), so its sentence ("did not answer in time") arrives instead of a socket error.
pub const LINK_WAIT: std::time::Duration = std::time::Duration::from_secs(75);

fn call(port: u16, method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    // Adding or refreshing a link reads it over the network; everything else is local and quick.
    let wait = if method == "POST" { LINK_WAIT } else { std::time::Duration::from_secs(4) };
    let (code, reply) = helper::request_bytes(port, method, path, "application/json", body.unwrap_or("").as_bytes(), wait)
        .map_err(|e| if e.contains("os error") { "The engine is not answering. Is it running?".to_string() } else { e })?;
    if code == 200 {
        Ok(reply)
    } else if code == 404 && path == "/calendar" {
        // shortcut: an engine older than the calendar answers 404 for everything under it; say so, do not retry.
        Err("This engine has no calendar yet. Update the engine.".into())
    } else {
        Err(reason(code, &reply))
    }
}

/// `GET /calendar` (the engine's default window: yesterday to a week ahead).
pub fn fetch(port: u16) -> Result<Calendar, String> {
    parse_calendar(&call(port, "GET", "/calendar", None)?)
        .ok_or_else(|| "The calendar answer could not be read.".into())
}

/// `POST /calendar/sources {url}`. The link goes to the engine and nowhere else.
pub fn add_link(port: u16, url: &str) -> Result<(), String> {
    call(
        port,
        "POST",
        "/calendar/sources",
        Some(&json!({ "url": url }).to_string()),
    )
    .map(|_| ())
}

/// `POST /calendar/sources {ics, name}` for an imported `.ics` file's text.
pub fn add_file(port: u16, ics: &str, name: &str) -> Result<(), String> {
    call(
        port,
        "POST",
        "/calendar/sources",
        Some(&json!({ "ics": ics, "name": name }).to_string()),
    )
    .map(|_| ())
}

pub fn remove(port: u16, id: &str) -> Result<(), String> {
    call(
        port,
        "DELETE",
        &format!("/calendar/sources/{}", crate::urlenc::encode(id)),
        None,
    )
    .map(|_| ())
}

/// `POST /calendar/refresh`: read every link again now.
pub fn refresh(port: u16) -> Result<(), String> {
    call(port, "POST", "/calendar/refresh", Some("{}")).map(|_| ())
}

/// `POST /calendar/notes` makes (or finds) the meeting's note; posting it
/// back to `/notes` moves it to the front, where the Meeting page reads.
/// Returns the note's title.
pub fn open_notes(port: u16, event_id: &str, tz_minutes: i64) -> Result<String, String> {
    let reply = call(
        port,
        "POST",
        "/calendar/notes",
        Some(&json!({ "id": event_id, "tzMinutes": tz_minutes }).to_string()),
    )?;
    let v: Value = serde_json::from_str(&reply)
        .map_err(|_| "The notes answer could not be read.".to_string())?;
    let note = v
        .get("note")
        .filter(|n| n.is_object())
        .ok_or("The engine made no note.")?;
    helper::post_note(port, &json!({ "note": note }).to_string())?;
    Ok(text(note, "title").unwrap_or_else(|| "Meeting".into()))
}

/// What a page can ask the engine to do with the calendar.
#[derive(Clone, Debug, PartialEq)]
pub enum Req {
    Link(String),
    File { ics: String, name: String },
    Remove(String),
    Refresh,
    Notes { event: String, tz_minutes: i64 },
}

/// Do `req`. `Some(title)` only for [`Req::Notes`]: the note now on the Meeting page.
pub fn run(port: u16, req: &Req) -> Result<Option<String>, String> {
    match req {
        Req::Link(u) => add_link(port, u).map(|_| None),
        Req::File { ics, name } => add_file(port, ics, name).map(|_| None),
        Req::Remove(id) => remove(port, id).map(|_| None),
        Req::Refresh => refresh(port).map(|_| None),
        Req::Notes { event, tz_minutes } => open_notes(port, event, *tz_minutes).map(Some),
    }
}

/// A pasted link is worth sending when it looks like one; the engine decides the rest
/// (https only, public hosts only). Returns the trimmed text.
pub fn looks_like_link(s: &str) -> Option<&str> {
    let s = s.trim();
    let lower = s.get(..9).unwrap_or(s).to_ascii_lowercase();
    ((lower.starts_with("https://")
        || lower.starts_with("webcal://")
        || lower.starts_with("http://"))
        && !s.contains(char::is_whitespace))
    .then_some(s)
}

/// `.ics` by extension, the only file the calendar takes.
pub fn is_ics_path(p: &str) -> bool {
    p.to_ascii_lowercase().ends_with(".ics")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"{"from":"x","to":"y",
      "sources":[{"id":"s1","kind":"link","name":"Work","link":"https://outlook.example.com/...","events":3,"lastSyncAt":"2026-11-09T08:00:00Z","lastError":null,"warnings":["RDATE is not supported"]},
                 {"id":"s2","kind":"file","name":"team.ics","link":null,"events":1,"lastError":"Could not read it."}],
      "events":[
        {"id":"e1","uid":"u1","title":"Standup","start":"2026-11-09T14:00:00Z","end":"2026-11-09T14:15:00Z","allDay":false,"location":"Room 4","organizer":{"name":"Mei Lin","email":"m@example.com"},"attendees":["a","b"],"joinUrl":"https://meet.google.com/abc-defg-hij","sourceId":"s1","recurring":true},
        {"id":"e2","title":"","start":"2026-11-10","end":"2026-11-11","allDay":true,"organizer":null,"attendees":[],"joinUrl":"javascript:alert(1)"},
        {"id":"e3","title":"Bad","start":"nope","end":"2026-11-11"}]}"#;

    // 2026-11-09 is day 20766 since 1970-01-01 (20454 for 2026-01-01 + 312), so 14:00 UTC is 20766*86400 + 50400.
    const T1400: i64 = 1_794_232_800;

    #[test]
    fn parses_events_and_sources() {
        let c = parse_calendar(BODY).unwrap();
        assert_eq!(
            (c.sources.len(), c.events.len()),
            (2, 2),
            "the event with a bad date is dropped"
        );
        assert_eq!(
            c.sources[0].link.as_deref(),
            Some("https://outlook.example.com/...")
        );
        assert_eq!(
            (c.sources[0].kind, c.sources[1].kind),
            (SourceKind::Link, SourceKind::File)
        );
        assert_eq!(
            c.sources[1].last_error.as_deref(),
            Some("Could not read it.")
        );
        assert_eq!(c.sources[0].warnings, ["RDATE is not supported"]);
        let e = &c.events[0];
        assert_eq!(
            (e.start, e.end - e.start, e.attendees, e.recurring),
            (T1400, 900, 2, true)
        );
        assert_eq!(
            (e.organizer.as_deref(), e.location.as_deref()),
            (Some("Mei Lin"), Some("Room 4"))
        );
        assert_eq!(
            e.join_url.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
        let all = &c.events[1];
        assert!(
            all.all_day && all.join_url.is_none(),
            "a javascript: link is not a join link"
        );
        assert_eq!(all.title, "(No title)");
        assert!(parse_calendar("nope").is_none() && parse_calendar("{}").is_none());
    }

    #[test]
    fn iso_parsing_is_strict() {
        assert_eq!(parse_iso("2026-11-09T14:00:00Z"), Some((T1400, false)));
        assert_eq!(parse_iso("2026-11-09"), Some((T1400 - 50_400, true)));
        for bad in [
            "",
            "2026-11-09T14:00:00",
            "2026-13-09",
            "2026-11-09T24:00:00Z",
            "2026/11/09",
            "2026-11-09T14:00:00+01:00",
            "abcd-ef-gh",
        ] {
            assert_eq!(parse_iso(bad), None, "{bad}");
        }
    }

    #[test]
    fn offset_comes_from_the_two_clocks() {
        // 14:00 UTC is 21:00 in Jakarta (+7), and the clocks are read 1 s apart.
        let local = LocalDateTime {
            year: 2026,
            month: 11,
            day: 9,
            hour: 21,
            minute: 0,
            second: 1,
        };
        assert_eq!(utc_offset(&local, T1400), 7 * 3600);
        let west = LocalDateTime {
            year: 2026,
            month: 11,
            day: 9,
            hour: 9,
            minute: 0,
            second: 0,
        };
        assert_eq!(utc_offset(&west, T1400), -5 * 3600);
        let l = local_at(T1400, 7 * 3600);
        assert_eq!((l.day, l.hour, l.minute), (9, 21, 0));
        let across = local_at(T1400 + 4 * 3600, 7 * 3600);
        assert_eq!(
            (across.day, across.hour),
            (10, 1),
            "past local midnight is the next day"
        );
    }

    #[test]
    fn upcoming_lists_what_has_not_ended_in_order() {
        let c = parse_calendar(BODY).unwrap();
        let tz = 7 * 3600;
        // 21:05 local, 5 minutes in: standup is on, the all-day event is tomorrow.
        let now = T1400 + 300;
        let v = upcoming(&c, now, tz, 7);
        assert_eq!(
            v.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["e1", "e2"]
        );
        assert!(v[0].is_now(now, tz) && !v[1].is_now(now, tz));
        // After it ends, only the all-day one is left; a one-day window stops before it.
        assert_eq!(upcoming(&c, T1400 + 901, tz, 7).len(), 1);
        assert!(
            upcoming(&c, T1400 + 901, tz, 1).is_empty(),
            "tomorrow's all-day event is past a one-day horizon"
        );
        assert_eq!(upcoming(&c, T1400 + 901, tz, 2).len(), 1);
        // The all-day event covers local Nov 10 only: from 00:00 to 24:00 in the person's zone.
        let (s, e) = v[1].span(tz);
        assert_eq!(
            (local_at(s, tz).day, local_at(s, tz).hour, e - s),
            (10, 0, 86_400)
        );
    }

    #[test]
    fn labels() {
        let c = parse_calendar(BODY).unwrap();
        assert_eq!(
            range_label(&c.events[0], 7 * 3600, true),
            "21:00 \u{2013} 21:15"
        );
        assert_eq!(
            range_label(&c.events[0], 0, false),
            "2:00 PM \u{2013} 2:15 PM"
        );
        assert_eq!(range_label(&c.events[1], 0, true), "All day");
        let today = days_from_civil(2026, 11, 9);
        assert_eq!(
            (
                day_label(today, today).as_str(),
                day_label(today + 1, today).as_str()
            ),
            ("Today", "Tomorrow")
        );
        assert_eq!(day_label(today + 2, today), "Wed 11 Nov");
    }

    #[test]
    fn the_pill_mentions_a_meeting_only_around_its_start() {
        let c = parse_calendar(BODY).unwrap();
        let at = |t: i64| soon(&c, t).map(|s| soon_text(&s));
        assert_eq!(at(T1400 - 16 * 60), None, "too early");
        assert_eq!(at(T1400 - 15 * 60).as_deref(), Some("Standup in 15 min"));
        assert_eq!(
            at(T1400 - 61).as_deref(),
            Some("Standup in 2 min"),
            "rounds up"
        );
        assert_eq!(at(T1400 - 60).as_deref(), Some("Standup in 1 min"));
        assert_eq!(at(T1400).as_deref(), Some("Standup starting"));
        assert_eq!(at(T1400 + 120).as_deref(), Some("Standup starting"));
        assert_eq!(at(T1400 + 121), None, "after the grace the pill goes quiet");
        // An all-day event never counts.
        let mut only_all_day = c.clone();
        only_all_day.events.remove(0);
        assert!(soon(&only_all_day, T1400).is_none());
    }

    #[test]
    fn pasted_text_is_a_link_only_when_it_looks_like_one() {
        assert_eq!(
            looks_like_link("  https://outlook.example.com/owa/x.ics\n"),
            Some("https://outlook.example.com/owa/x.ics")
        );
        assert!(looks_like_link("webcal://cal.example.com/a.ics").is_some());
        // http is passed on so the engine can say why it refuses it.
        assert!(looks_like_link("http://cal.example.com/a.ics").is_some());
        for no in [
            "",
            "my calendar",
            "https://a b",
            "ftp://x/y.ics",
            "file:///c:/a.ics",
            "é",
        ] {
            assert!(looks_like_link(no).is_none(), "{no}");
        }
        assert!(is_ics_path("C:\\Users\\me\\Team.ICS") && !is_ics_path("notes.txt"));
    }

    #[test]
    fn a_closed_port_is_an_error_not_a_hang() {
        assert!(fetch(1).is_err());
        assert!(open_notes(1, "x", 0).is_err());
    }
}
