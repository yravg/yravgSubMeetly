//! iCalendar (RFC 5545) subset: parse a `.ics` text into events and expand
//! recurring ones into occurrences for a time window. Pure: no I/O, no clock.
//!
//! Instants are epoch seconds (UTC). An all-day event (`VALUE=DATE`) is kept as
//! a pseudo-instant at midnight UTC of its date and flagged `all_day`, so the
//! same arithmetic holds; clients show it by date, not by instant.
//!
//! Supported: line unfolding; `DTSTART`/`DTEND`/`DURATION` in UTC, floating,
//! `TZID` (the file's own `VTIMEZONE`, else the built-in table of Windows and
//! IANA names) and all-day form; `SUMMARY`, `LOCATION`, `DESCRIPTION`, `URL`,
//! `ORGANIZER`, `ATTENDEE`; `STATUS:CANCELLED`; `EXDATE`; `RECURRENCE-ID`
//! overrides; `RRULE` with `FREQ` DAILY/WEEKLY/MONTHLY/YEARLY and `INTERVAL`,
//! `COUNT`, `UNTIL`, `BYDAY` (with an ordinal for MONTHLY/YEARLY), `BYMONTHDAY`,
//! `BYMONTH`, `WKST`.
//!
//! Not supported (the event then shows once, at its first start, and `warnings`
//! says so): `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYHOUR`/`BYMINUTE`/`BYSECOND`,
//! `FREQ` HOURLY/MINUTELY/SECONDLY, `RDATE`. A floating time (no zone) is read in
//! `X-WR-TIMEZONE` if the file names one, else as UTC.
//!
//! shortcut: a zone's DST rule is its latest one applied to every year, so a
//! date before a rule change (a country moving its DST dates) can be an hour
//! off; upgrade by keeping each observance's DTSTART year.

use std::collections::HashMap;

use crate::state::civil_from_days;

const DAY: i64 = 86_400;
/// Hard ceilings so a hostile or broken file cannot make a refresh run away.
const MAX_EVENTS: usize = 20_000;
const MAX_PERIODS: i64 = 40_000;
const MAX_PER_EVENT: usize = 5_000;

// ------------------------------------------------------------------ dates

pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

/// Monday = 0.
fn weekday(days: i64) -> u32 {
    (days + 3).rem_euclid(7) as u32
}

/// The `ord`-th `wd` of a month (`ord` -1 = last); `None` if it does not exist.
fn nth_weekday(y: i64, m: u32, ord: i32, wd: u32) -> Option<i64> {
    let first = days_from_civil(y, m, 1);
    let dim = days_in_month(y, m) as i64;
    let d = if ord > 0 {
        first + ((wd as i64 - weekday(first) as i64).rem_euclid(7)) + 7 * (ord as i64 - 1)
    } else if ord < 0 {
        let last = first + dim - 1;
        last - ((weekday(last) as i64 - wd as i64).rem_euclid(7)) - 7 * (-(ord as i64) - 1)
    } else {
        return None;
    };
    (d >= first && d < first + dim).then_some(d)
}

pub fn iso_utc(epoch: i64) -> String {
    let (y, mo, d) = civil_from_days(epoch.div_euclid(DAY));
    let s = epoch.rem_euclid(DAY);
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z",
        s / 3600,
        (s % 3600) / 60,
        s % 60
    )
}

pub fn iso_date(epoch: i64) -> String {
    let (y, mo, d) = civil_from_days(epoch.div_euclid(DAY));
    format!("{y:04}-{mo:02}-{d:02}")
}

/// `2026-11-09T09:00:00Z`, `2026-11-09T09:00:00` (read as UTC) or `2026-11-09`.
pub fn parse_iso(s: &str) -> Option<i64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)? as u32, num(8, 10)? as u32);
    if !(1..=12).contains(&mo) || d == 0 || d > days_in_month(y, mo) {
        return None;
    }
    let mut secs = 0;
    if b.len() >= 19 && b[10] == b'T' && b[13] == b':' && b[16] == b':' {
        secs = num(11, 13)? * 3600 + num(14, 16)? * 60 + num(17, 19)?;
    }
    Some(days_from_civil(y, mo, d) * DAY + secs)
}

// ------------------------------------------------------------------ zones

#[derive(Clone, Copy, Debug, PartialEq)]
struct Trans {
    month: u32,
    ord: i32,
    wd: u32,
    /// Seconds after midnight of the transition day.
    secs: i64,
    /// `secs` is UTC (EU rule) rather than the wall clock before the change.
    utc: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Dst {
    off: i64,
    start: Trans,
    end: Trans,
}

/// A UTC offset with an optional yearly daylight-saving rule.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Zone {
    std: i64,
    dst: Option<Dst>,
}

impl Zone {
    pub const UTC: Zone = Zone { std: 0, dst: None };

    fn instants(&self, d: &Dst, year: i64) -> Option<(i64, i64)> {
        let at = |t: &Trans, off: i64| -> Option<i64> {
            let day = nth_weekday(year, t.month, t.ord, t.wd)?;
            Some(day * DAY + t.secs - if t.utc { 0 } else { off })
        };
        Some((at(&d.start, self.std)?, at(&d.end, d.off)?))
    }

    fn is_dst(&self, utc: i64) -> bool {
        let Some(d) = &self.dst else { return false };
        let (year, _, _) = civil_from_days((utc + self.std).div_euclid(DAY));
        match self.instants(d, year) {
            Some((s, e)) if s < e => utc >= s && utc < e,
            Some((s, e)) => utc >= s || utc < e,
            None => false,
        }
    }

    pub fn offset_at(&self, utc: i64) -> i64 {
        match &self.dst {
            Some(d) if self.is_dst(utc) => d.off,
            _ => self.std,
        }
    }

    /// Wall clock (as seconds since the epoch, read as if UTC) -> instant.
    /// A time skipped by the spring change moves forward; a repeated one takes
    /// its first (daylight) reading.
    pub fn local_to_utc(&self, local: i64) -> i64 {
        if let Some(d) = &self.dst {
            let as_dst = local - d.off;
            if self.is_dst(as_dst) {
                return as_dst;
            }
        }
        local - self.std
    }
}

const EU_START: Trans = Trans {
    month: 3,
    ord: -1,
    wd: 6,
    secs: 3600,
    utc: true,
};
const EU_END: Trans = Trans {
    month: 10,
    ord: -1,
    wd: 6,
    secs: 3600,
    utc: true,
};
const US_START: Trans = Trans {
    month: 3,
    ord: 2,
    wd: 6,
    secs: 7200,
    utc: false,
};
const US_END: Trans = Trans {
    month: 11,
    ord: 1,
    wd: 6,
    secs: 7200,
    utc: false,
};
const AU_START: Trans = Trans {
    month: 10,
    ord: 1,
    wd: 6,
    secs: 7200,
    utc: false,
};
const AU_END: Trans = Trans {
    month: 4,
    ord: 1,
    wd: 6,
    secs: 10_800,
    utc: false,
};
const NZ_START: Trans = Trans {
    month: 9,
    ord: -1,
    wd: 6,
    secs: 7200,
    utc: false,
};

#[derive(Clone, Copy)]
enum Rule {
    None,
    Eu,
    Us,
    Au,
    Nz,
}

/// Windows and IANA zone names with their standard offset (minutes) and DST rule.
const ZONES: &[(&[&str], i64, Rule)] = &[
    (
        &[
            "UTC",
            "Etc/UTC",
            "GMT",
            "Z",
            "Greenwich Standard Time",
            "Etc/GMT",
            "Atlantic/Reykjavik",
        ],
        0,
        Rule::None,
    ),
    (
        &[
            "GMT Standard Time",
            "Europe/London",
            "Europe/Dublin",
            "Europe/Lisbon",
        ],
        0,
        Rule::Eu,
    ),
    (
        &[
            "W. Europe Standard Time",
            "Central Europe Standard Time",
            "Romance Standard Time",
            "Central European Standard Time",
            "Europe/Paris",
            "Europe/Berlin",
            "Europe/Madrid",
            "Europe/Rome",
            "Europe/Amsterdam",
            "Europe/Brussels",
            "Europe/Vienna",
            "Europe/Zurich",
            "Europe/Stockholm",
            "Europe/Oslo",
            "Europe/Copenhagen",
            "Europe/Warsaw",
            "Europe/Prague",
            "Europe/Budapest",
        ],
        60,
        Rule::Eu,
    ),
    (
        &[
            "E. Europe Standard Time",
            "GTB Standard Time",
            "FLE Standard Time",
            "Europe/Athens",
            "Europe/Helsinki",
            "Europe/Kiev",
            "Europe/Kyiv",
            "Europe/Bucharest",
        ],
        120,
        Rule::Eu,
    ),
    (
        &[
            "Egypt Standard Time",
            "South Africa Standard Time",
            "Africa/Cairo",
            "Africa/Johannesburg",
        ],
        120,
        Rule::None,
    ),
    (
        &[
            "Russian Standard Time",
            "Turkey Standard Time",
            "Arabic Standard Time",
            "Arab Standard Time",
            "E. Africa Standard Time",
            "Europe/Moscow",
            "Europe/Istanbul",
            "Africa/Nairobi",
            "Asia/Riyadh",
            "Asia/Baghdad",
        ],
        180,
        Rule::None,
    ),
    (&["Arabian Standard Time", "Asia/Dubai"], 240, Rule::None),
    (
        &[
            "Pakistan Standard Time",
            "West Asia Standard Time",
            "Asia/Karachi",
        ],
        300,
        Rule::None,
    ),
    (
        &[
            "India Standard Time",
            "Sri Lanka Standard Time",
            "Asia/Kolkata",
            "Asia/Calcutta",
            "Asia/Colombo",
        ],
        330,
        Rule::None,
    ),
    (&["Nepal Standard Time", "Asia/Kathmandu"], 345, Rule::None),
    (
        &[
            "Bangladesh Standard Time",
            "Central Asia Standard Time",
            "Asia/Dhaka",
        ],
        360,
        Rule::None,
    ),
    (
        &[
            "SE Asia Standard Time",
            "Asia/Jakarta",
            "Asia/Bangkok",
            "Asia/Ho_Chi_Minh",
            "Asia/Saigon",
        ],
        420,
        Rule::None,
    ),
    (
        &[
            "China Standard Time",
            "Singapore Standard Time",
            "Taipei Standard Time",
            "W. Australia Standard Time",
            "Asia/Shanghai",
            "Asia/Hong_Kong",
            "Asia/Singapore",
            "Asia/Kuala_Lumpur",
            "Asia/Manila",
            "Asia/Taipei",
            "Australia/Perth",
        ],
        480,
        Rule::None,
    ),
    (
        &[
            "Tokyo Standard Time",
            "Korea Standard Time",
            "Asia/Tokyo",
            "Asia/Seoul",
        ],
        540,
        Rule::None,
    ),
    (
        &["Cen. Australia Standard Time", "Australia/Adelaide"],
        570,
        Rule::Au,
    ),
    (
        &[
            "AUS Eastern Standard Time",
            "Tasmania Standard Time",
            "Australia/Sydney",
            "Australia/Melbourne",
        ],
        600,
        Rule::Au,
    ),
    (
        &["E. Australia Standard Time", "Australia/Brisbane"],
        600,
        Rule::None,
    ),
    (
        &["New Zealand Standard Time", "Pacific/Auckland"],
        720,
        Rule::Nz,
    ),
    (
        &["Hawaiian Standard Time", "Pacific/Honolulu"],
        -600,
        Rule::None,
    ),
    (
        &["Alaskan Standard Time", "America/Anchorage"],
        -540,
        Rule::Us,
    ),
    (
        &[
            "Pacific Standard Time",
            "America/Los_Angeles",
            "America/Vancouver",
        ],
        -480,
        Rule::Us,
    ),
    (
        &["US Mountain Standard Time", "America/Phoenix"],
        -420,
        Rule::None,
    ),
    (
        &["Mountain Standard Time", "America/Denver"],
        -420,
        Rule::Us,
    ),
    (
        &["Central Standard Time", "America/Chicago"],
        -360,
        Rule::Us,
    ),
    (
        &[
            "Canada Central Standard Time",
            "Central America Standard Time",
            "America/Mexico_City",
            "America/Regina",
        ],
        -360,
        Rule::None,
    ),
    (
        &[
            "Eastern Standard Time",
            "America/New_York",
            "America/Toronto",
        ],
        -300,
        Rule::Us,
    ),
    (
        &["SA Pacific Standard Time", "America/Bogota", "America/Lima"],
        -300,
        Rule::None,
    ),
    (
        &["Atlantic Standard Time", "America/Halifax"],
        -240,
        Rule::Us,
    ),
    (
        &[
            "E. South America Standard Time",
            "Argentina Standard Time",
            "America/Sao_Paulo",
            "America/Argentina/Buenos_Aires",
            "America/Buenos_Aires",
        ],
        -180,
        Rule::None,
    ),
    (
        &["W. Central Africa Standard Time", "Africa/Lagos"],
        60,
        Rule::None,
    ),
];

fn builtin_zone(name: &str) -> Option<Zone> {
    let (_, minutes, rule) = ZONES
        .iter()
        .find(|(names, _, _)| names.iter().any(|n| n.eq_ignore_ascii_case(name)))?;
    let std = minutes * 60;
    let dst = |start, end, plus: i64| {
        Some(Dst {
            off: std + plus,
            start,
            end,
        })
    };
    let dst = match rule {
        Rule::None => None,
        Rule::Eu | Rule::Us => dst(
            if matches!(rule, Rule::Eu) {
                EU_START
            } else {
                US_START
            },
            if matches!(rule, Rule::Eu) {
                EU_END
            } else {
                US_END
            },
            3600,
        ),
        Rule::Au => dst(AU_START, AU_END, 3600),
        Rule::Nz => dst(NZ_START, AU_END, 3600),
    };
    Some(Zone { std, dst })
}

// ------------------------------------------------------------ content lines

#[derive(Debug, Clone)]
struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
}

/// Unfold (a line starting with a space or tab continues the one before).
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.trim_start_matches('\u{feff}').split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        match (line.strip_prefix([' ', '\t']), lines.last_mut()) {
            (Some(rest), Some(prev)) => prev.push_str(rest),
            _ => lines.push(line.to_string()),
        }
    }
    lines
}

fn parse_prop(line: &str) -> Option<Prop> {
    let mut name_end = None;
    for (i, c) in line.char_indices() {
        if c == ';' || c == ':' {
            name_end = Some((i, c));
            break;
        }
    }
    let (i, c) = name_end?;
    let name = line[..i].trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let mut params = Vec::new();
    let mut rest = &line[i + 1..];
    if c == ';' {
        // name=value[;name=value]... until the first ':' outside quotes.
        let mut in_q = false;
        let mut start = 0;
        let mut end = None;
        let bytes = rest.as_bytes();
        for (j, &b) in bytes.iter().enumerate() {
            match b {
                b'"' => in_q = !in_q,
                b';' if !in_q => {
                    push_param(&mut params, &rest[start..j]);
                    start = j + 1;
                }
                b':' if !in_q => {
                    push_param(&mut params, &rest[start..j]);
                    end = Some(j);
                    break;
                }
                _ => {}
            }
        }
        rest = &rest[end? + 1..];
    }
    Some(Prop {
        name,
        params,
        value: rest.to_string(),
    })
}

fn push_param(params: &mut Vec<(String, String)>, raw: &str) {
    if let Some((k, v)) = raw.split_once('=') {
        params.push((
            k.trim().to_ascii_uppercase(),
            v.trim().trim_matches('"').to_string(),
        ));
    }
}

/// RFC 5545 TEXT escapes.
fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

// ---------------------------------------------------------------- datetime

/// A parsed DATE / DATE-TIME value before its zone is applied.
enum Dt {
    Date(i64),
    Utc(i64),
    Local(i64),
}

fn parse_dt(v: &str) -> Option<Dt> {
    let v = v.trim();
    let b = v.as_bytes();
    if b.len() < 8 || !b[..8].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let num = |a: usize, z: usize| v.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(4, 6)? as u32, num(6, 8)? as u32);
    if !(1..=12).contains(&mo) || d == 0 || d > days_in_month(y, mo) {
        return None;
    }
    let days = days_from_civil(y, mo, d);
    if b.len() == 8 {
        return Some(Dt::Date(days));
    }
    if b[8] != b'T' || b.len() < 15 {
        return None;
    }
    let secs = num(9, 11)? * 3600 + num(11, 13)? * 60 + num(13, 15)?;
    let at = days * DAY + secs;
    Some(if b.len() > 15 && b[15] == b'Z' {
        Dt::Utc(at)
    } else {
        Dt::Local(at)
    })
}

struct Ctx {
    zones: HashMap<String, Zone>,
    default_zone: Option<Zone>,
    warnings: Vec<String>,
}

impl Ctx {
    fn zone(&mut self, tzid: &str) -> Zone {
        let mut tries = vec![tzid.to_string()];
        // "/mozilla.org/20050126_1/Europe/Paris" -> "Europe/Paris", "Paris"
        let parts: Vec<&str> = tzid.split('/').filter(|s| !s.is_empty()).collect();
        if parts.len() >= 2 {
            tries.push(parts[parts.len() - 2..].join("/"));
        }
        for t in &tries {
            if let Some(z) = self
                .zones
                .get(&t.to_ascii_lowercase())
                .copied()
                .or_else(|| builtin_zone(t))
            {
                return z;
            }
        }
        let msg = format!(
            "unknown time zone '{}' read as UTC",
            tzid.chars().take(60).collect::<String>()
        );
        if !self.warnings.contains(&msg) {
            self.warnings.push(msg);
        }
        Zone::UTC
    }

    /// (instant, all_day, zone the wall clock is read in)
    fn resolve(&mut self, p: &Prop) -> Option<(i64, bool, Zone)> {
        let dt = parse_dt(&p.value)?;
        let zone = match p.param("TZID") {
            Some(t) => self.zone(t),
            None => self.default_zone.unwrap_or(Zone::UTC),
        };
        Some(match dt {
            Dt::Date(d) => (d * DAY, true, Zone::UTC),
            Dt::Utc(t) => (t, false, zone),
            Dt::Local(l) => (zone.local_to_utc(l), false, zone),
        })
    }
}

// ----------------------------------------------------------------- RRULE

#[derive(Debug, Clone, PartialEq)]
struct RRule {
    freq: Freq,
    interval: i64,
    count: Option<usize>,
    until: Option<Until>,
    by_day: Vec<(i32, u32)>,
    by_month_day: Vec<i32>,
    by_month: Vec<u32>,
    wkst: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Until {
    /// Inclusive date (DATE form).
    Date(i64),
    Utc(i64),
    Local(i64),
}

fn parse_weekday(s: &str) -> Option<u32> {
    ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
        .iter()
        .position(|d| *d == s)
        .map(|i| i as u32)
}

fn parse_rrule(v: &str) -> Result<RRule, String> {
    let mut r = RRule {
        freq: Freq::Daily,
        interval: 1,
        count: None,
        until: None,
        by_day: vec![],
        by_month_day: vec![],
        by_month: vec![],
        wkst: 0,
    };
    let mut have_freq = false;
    for part in v.split(';') {
        let Some((k, val)) = part.split_once('=') else {
            continue;
        };
        let val = val.trim();
        match k.trim().to_ascii_uppercase().as_str() {
            "FREQ" => {
                r.freq = match val.to_ascii_uppercase().as_str() {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    "YEARLY" => Freq::Yearly,
                    other => return Err(format!("FREQ={other}")),
                };
                have_freq = true;
            }
            "INTERVAL" => {
                r.interval = val
                    .parse::<i64>()
                    .ok()
                    .filter(|n| *n >= 1)
                    .ok_or("INTERVAL")?
            }
            "COUNT" => {
                r.count = Some(
                    val.parse::<usize>()
                        .ok()
                        .filter(|n| *n >= 1)
                        .ok_or("COUNT")?,
                )
            }
            "UNTIL" => {
                r.until = Some(match parse_dt(val).ok_or("UNTIL")? {
                    Dt::Date(d) => Until::Date(d),
                    Dt::Utc(t) => Until::Utc(t),
                    Dt::Local(l) => Until::Local(l),
                })
            }
            "BYDAY" => {
                for tok in val.split(',') {
                    let tok = tok.trim().to_ascii_uppercase();
                    if tok.len() < 2 {
                        return Err("BYDAY".into());
                    }
                    let (num, day) = tok.split_at(tok.len() - 2);
                    let ord = if num.is_empty() {
                        0
                    } else {
                        num.parse::<i32>().map_err(|_| "BYDAY")?
                    };
                    r.by_day.push((ord, parse_weekday(day).ok_or("BYDAY")?));
                }
            }
            "BYMONTHDAY" => {
                for tok in val.split(',') {
                    let n = tok.trim().parse::<i32>().map_err(|_| "BYMONTHDAY")?;
                    if n == 0 || n.abs() > 31 {
                        return Err("BYMONTHDAY".into());
                    }
                    r.by_month_day.push(n);
                }
            }
            "BYMONTH" => {
                for tok in val.split(',') {
                    let n = tok.trim().parse::<u32>().map_err(|_| "BYMONTH")?;
                    if !(1..=12).contains(&n) {
                        return Err("BYMONTH".into());
                    }
                    r.by_month.push(n);
                }
            }
            "WKST" => r.wkst = parse_weekday(&val.to_ascii_uppercase()).ok_or("WKST")?,
            "BYSETPOS" | "BYWEEKNO" | "BYYEARDAY" | "BYHOUR" | "BYMINUTE" | "BYSECOND" => {
                return Err(k.trim().to_ascii_uppercase())
            }
            _ => {}
        }
    }
    if !have_freq {
        return Err("no FREQ".into());
    }
    Ok(r)
}

/// Days (since the epoch) in `y`-`m` the rule picks.
fn month_days(r: &RRule, y: i64, m: u32, dt_day: u32) -> Vec<i64> {
    let dim = days_in_month(y, m);
    let first = days_from_civil(y, m, 1);
    let mut out: Vec<i64> = Vec::new();
    if !r.by_month_day.is_empty() {
        for &n in &r.by_month_day {
            let d = if n > 0 { n } else { dim as i32 + 1 + n };
            if d >= 1 && d <= dim as i32 {
                out.push(first + d as i64 - 1);
            }
        }
        if !r.by_day.is_empty() {
            out.retain(|d| r.by_day.iter().any(|(_, wd)| *wd == weekday(*d)));
        }
    } else if !r.by_day.is_empty() {
        for &(ord, wd) in &r.by_day {
            if ord == 0 {
                out.extend(
                    (0..dim as i64)
                        .map(|i| first + i)
                        .filter(|d| weekday(*d) == wd),
                );
            } else if let Some(d) = nth_weekday(y, m, ord, wd) {
                out.push(d);
            }
        }
    } else if dt_day <= dim {
        out.push(first + dt_day as i64 - 1);
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// Candidate days of period `p` (0-based, already scaled by INTERVAL) for the
/// rule that starts on day `d0`.
fn period_days(r: &RRule, d0: i64, p: i64) -> Vec<i64> {
    let (y0, m0, dd0) = civil_from_days(d0);
    let month_ok = |d: i64| r.by_month.is_empty() || r.by_month.contains(&civil_from_days(d).1);
    let mut days = match r.freq {
        Freq::Daily => {
            let d = d0 + p * r.interval;
            let mut v = vec![d];
            v.retain(|d| r.by_day.is_empty() || r.by_day.iter().any(|(_, wd)| *wd == weekday(*d)));
            v.retain(|d| {
                let (_, _, day) = civil_from_days(*d);
                r.by_month_day.is_empty()
                    || r.by_month_day.iter().any(|n| {
                        let (y, m, _) = civil_from_days(*d);
                        let dim = days_in_month(y, m) as i32;
                        (*n > 0 && *n == day as i32) || (*n < 0 && dim + 1 + *n == day as i32)
                    })
            });
            v
        }
        Freq::Weekly => {
            let ws = d0 - (weekday(d0) as i64 - r.wkst as i64).rem_euclid(7) + 7 * r.interval * p;
            let mut wds: Vec<u32> = r.by_day.iter().map(|(_, wd)| *wd).collect();
            if wds.is_empty() {
                wds.push(weekday(d0));
            }
            let mut v: Vec<i64> = wds
                .iter()
                .map(|wd| ws + (*wd as i64 - r.wkst as i64).rem_euclid(7))
                .collect();
            v.sort_unstable();
            v.dedup();
            v
        }
        Freq::Monthly => {
            let idx = y0 * 12 + (m0 as i64 - 1) + p * r.interval;
            month_days(r, idx.div_euclid(12), (idx.rem_euclid(12) + 1) as u32, dd0)
        }
        Freq::Yearly => {
            let y = y0 + p * r.interval;
            let mut months = r.by_month.clone();
            if months.is_empty() {
                months.push(m0);
            }
            months.sort_unstable();
            months.dedup();
            months
                .into_iter()
                .flat_map(|m| month_days(r, y, m, dd0))
                .collect()
        }
    };
    if r.freq != Freq::Yearly {
        days.retain(|d| month_ok(*d));
    }
    days
}

// ----------------------------------------------------------------- events

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Person {
    pub name: String,
    pub email: String,
}

impl Person {
    /// What a person is called in a list: the name, else the address.
    pub fn display(&self) -> &str {
        if self.name.is_empty() {
            &self.email
        } else {
            &self.name
        }
    }
}

#[derive(Debug, Clone)]
pub struct Event {
    pub uid: String,
    pub title: String,
    pub location: String,
    pub description: String,
    /// A meeting-link property (`URL`, Teams and Google conference extensions).
    pub url: String,
    pub organizer: Option<Person>,
    pub attendees: Vec<Person>,
    pub all_day: bool,
    pub start: i64,
    pub end: i64,
    zone: Zone,
    rrule: Option<RRule>,
    exdates: Vec<i64>,
    recurrence_id: Option<i64>,
    pub cancelled: bool,
}

#[derive(Debug, Default)]
pub struct Parsed {
    pub events: Vec<Event>,
    pub warnings: Vec<String>,
    /// `X-WR-CALNAME`, if the file has one.
    pub name: String,
}

fn person(p: &Prop) -> Person {
    let email = p.value.trim();
    let email = email
        .get(..7)
        .filter(|h| h.eq_ignore_ascii_case("mailto:"))
        .map_or(email, |_| &email[7..]);
    Person {
        name: unescape(p.param("CN").unwrap_or("")).trim().to_string(),
        email: email.trim().to_string(),
    }
}

fn build_event(props: &[Prop], ctx: &mut Ctx) -> Option<Event> {
    let get = |n: &str| props.iter().find(|p| p.name == n);
    let text = |n: &str| {
        get(n)
            .map(|p| unescape(&p.value).trim().to_string())
            .unwrap_or_default()
    };
    let title = text("SUMMARY");
    let (start, all_day, zone) = ctx.resolve(get("DTSTART")?)?;
    let end = match (get("DTEND").and_then(|p| ctx.resolve(p)), get("DURATION")) {
        (Some((e, _, _)), _) => e,
        (None, Some(d)) => start + parse_duration(&d.value).unwrap_or(0),
        (None, None) => start + if all_day { DAY } else { 0 },
    };
    let rrule = match get("RRULE") {
        Some(p) => match parse_rrule(&p.value) {
            Ok(r) => Some(r),
            Err(why) => {
                ctx.warnings.push(format!(
                    "recurrence not supported ({why}): '{}' shows once",
                    title.chars().take(60).collect::<String>()
                ));
                None
            }
        },
        None => None,
    };
    if get("RDATE").is_some() {
        ctx.warnings.push(format!(
            "RDATE not supported: '{}'",
            title.chars().take(60).collect::<String>()
        ));
    }
    let mut exdates = Vec::new();
    for p in props.iter().filter(|p| p.name == "EXDATE") {
        for v in p.value.split(',') {
            let one = Prop {
                name: p.name.clone(),
                params: p.params.clone(),
                value: v.to_string(),
            };
            if let Some((t, _, _)) = ctx.resolve(&one) {
                exdates.push(t);
            }
        }
    }
    let url = [
        "X-MICROSOFT-SKYPETEAMSMEETINGURL",
        "X-GOOGLE-CONFERENCE",
        "URL",
    ]
    .iter()
    .find_map(|n| {
        get(n)
            .map(|p| p.value.trim().to_string())
            .filter(|v| !v.is_empty())
    })
    .unwrap_or_default();
    let attendees = props
        .iter()
        .filter(|p| p.name == "ATTENDEE" && !matches!(p.param("CUTYPE"), Some("RESOURCE" | "ROOM")))
        .map(person)
        .filter(|p| !p.display().is_empty())
        .take(100)
        .collect();
    Some(Event {
        uid: text("UID"),
        title,
        location: text("LOCATION"),
        description: text("DESCRIPTION"),
        url,
        organizer: get("ORGANIZER")
            .map(person)
            .filter(|p| !p.display().is_empty()),
        attendees,
        all_day,
        start,
        end: end.max(start),
        zone,
        rrule,
        exdates,
        recurrence_id: get("RECURRENCE-ID")
            .and_then(|p| ctx.resolve(p))
            .map(|(t, _, _)| t),
        cancelled: text("STATUS").eq_ignore_ascii_case("CANCELLED"),
    })
}

/// `P1D`, `PT1H30M`, `P1W` -> seconds.
fn parse_duration(v: &str) -> Option<i64> {
    let v = v.trim();
    let (neg, v) = match v.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, v.strip_prefix('+').unwrap_or(v)),
    };
    let v = v.strip_prefix('P')?;
    let (mut total, mut n, mut any) = (0i64, 0i64, false);
    for c in v.chars() {
        match c {
            '0'..='9' => {
                n = n.checked_mul(10)?.checked_add(c as i64 - '0' as i64)?;
                any = true;
            }
            'T' => {}
            'W' => total += n * 7 * DAY,
            'D' => total += n * DAY,
            'H' => total += n * 3600,
            'M' => total += n * 60,
            'S' => total += n,
            _ => return None,
        }
        if c.is_ascii_alphabetic() && c != 'T' {
            n = 0;
        }
    }
    any.then_some(if neg { -total } else { total })
}

/// A `VTIMEZONE` observance.
struct Obs {
    daylight: bool,
    since: i64,
    offset: i64,
    trans: Option<Trans>,
}

fn parse_offset(v: &str) -> Option<i64> {
    let v = v.trim();
    let (sign, d) = match v.as_bytes().first()? {
        b'-' => (-1, &v[1..]),
        b'+' => (1, &v[1..]),
        _ => (1, v),
    };
    if d.len() < 4 || !d.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let s = if d.len() >= 6 {
        d[4..6].parse::<i64>().ok()?
    } else {
        0
    };
    Some(sign * (d[..2].parse::<i64>().ok()? * 3600 + d[2..4].parse::<i64>().ok()? * 60 + s))
}

fn observance(daylight: bool, props: &[Prop]) -> Option<Obs> {
    let get = |n: &str| props.iter().find(|p| p.name == n);
    let offset = parse_offset(&get("TZOFFSETTO")?.value)?;
    let Dt::Local(since) = parse_dt(&get("DTSTART")?.value)? else {
        return None;
    };
    let trans = get("RRULE")
        .and_then(|p| parse_rrule(&p.value).ok())
        .and_then(|r| {
            let (ord, wd) = *r.by_day.first()?;
            let month = *r.by_month.first()?;
            (r.freq == Freq::Yearly && ord != 0).then_some(Trans {
                month,
                ord,
                wd,
                secs: since.rem_euclid(DAY),
                utc: false,
            })
        });
    Some(Obs {
        daylight,
        since,
        offset,
        trans,
    })
}

fn zone_from(obs: &[Obs]) -> Option<Zone> {
    let latest = |daylight: bool, ruled: bool| {
        obs.iter()
            .filter(|o| o.daylight == daylight && (!ruled || o.trans.is_some()))
            .max_by_key(|o| o.since)
    };
    if let (Some(std), Some(dst)) = (latest(false, true), latest(true, true)) {
        return Some(Zone {
            std: std.offset,
            dst: Some(Dst {
                off: dst.offset,
                start: dst.trans?,
                end: std.trans?,
            }),
        });
    }
    let any = obs
        .iter()
        .filter(|o| !o.daylight)
        .max_by_key(|o| o.since)
        .or_else(|| obs.iter().max_by_key(|o| o.since))?;
    Some(Zone {
        std: any.offset,
        dst: None,
    })
}

/// Parse an iCalendar text. `Err` when it is not one at all.
pub fn parse(text: &str) -> Result<Parsed, String> {
    let lines = unfold(text);
    if !lines
        .iter()
        .any(|l| l.trim().eq_ignore_ascii_case("BEGIN:VCALENDAR"))
    {
        return Err("not an iCalendar file (no BEGIN:VCALENDAR)".into());
    }
    let mut ctx = Ctx {
        zones: HashMap::new(),
        default_zone: None,
        warnings: Vec::new(),
    };
    let mut name = String::new();
    // First pass for the calendar-level props that later events depend on is
    // not needed in order: VTIMEZONE normally precedes events, but a file may
    // not, so zones and the default zone are collected before any event builds.
    let mut stack: Vec<(String, Vec<Prop>)> = Vec::new();
    let mut obs: Vec<Obs> = Vec::new();
    let mut raw_events: Vec<Vec<Prop>> = Vec::new();
    for line in &lines {
        let Some(p) = parse_prop(line) else { continue };
        match p.name.as_str() {
            "BEGIN" => {
                if stack.len() < 8 {
                    stack.push((p.value.trim().to_ascii_uppercase(), Vec::new()));
                }
            }
            "END" => {
                let Some((comp, props)) = stack.pop() else {
                    continue;
                };
                match comp.as_str() {
                    "VEVENT" if raw_events.len() < MAX_EVENTS => raw_events.push(props),
                    "STANDARD" | "DAYLIGHT" => obs.extend(observance(comp == "DAYLIGHT", &props)),
                    "VTIMEZONE" => {
                        if let (Some(id), Some(z)) =
                            (props.iter().find(|p| p.name == "TZID"), zone_from(&obs))
                        {
                            ctx.zones
                                .insert(id.value.trim().trim_matches('"').to_ascii_lowercase(), z);
                        }
                        obs.clear();
                    }
                    _ => {}
                }
            }
            "X-WR-TIMEZONE" if stack.len() == 1 => {
                let v = unescape(&p.value);
                ctx.default_zone = Some(ctx.zone(v.trim()));
            }
            "X-WR-CALNAME" if stack.len() == 1 => {
                name = unescape(&p.value).trim().chars().take(80).collect()
            }
            _ => {
                if let Some((_, props)) = stack.last_mut() {
                    if props.len() < 200 {
                        props.push(p);
                    }
                }
            }
        }
    }
    let events = raw_events
        .iter()
        .filter_map(|props| build_event(props, &mut ctx))
        .collect();
    Ok(Parsed {
        events,
        warnings: ctx.warnings,
        name,
    })
}

// -------------------------------------------------------------- expansion

/// One event on the calendar: a single event, or one date of a recurring one.
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub uid: String,
    pub title: String,
    pub location: String,
    pub description: String,
    pub join_url: Option<String>,
    pub organizer: Option<Person>,
    pub attendees: Vec<Person>,
    pub all_day: bool,
    pub start: i64,
    pub end: i64,
    pub recurring: bool,
}

fn occurrence(e: &Event, start: i64, end: i64, recurring: bool) -> Occurrence {
    Occurrence {
        uid: e.uid.clone(),
        title: e.title.clone(),
        location: e.location.clone(),
        description: e.description.clone(),
        join_url: join_link(&[&e.url, &e.location, &e.description]),
        organizer: e.organizer.clone(),
        attendees: e.attendees.clone(),
        all_day: e.all_day,
        start,
        end,
        recurring,
    }
}

/// Start instants of a recurring master, up to `to`.
fn series(e: &Event, r: &RRule, to: i64) -> Vec<i64> {
    let d0 = e.start.div_euclid(DAY);
    let (day0, tod) = if e.all_day {
        (d0, 0)
    } else {
        let local = e.start + e.zone.offset_at(e.start);
        (local.div_euclid(DAY), local.rem_euclid(DAY))
    };
    let until = r.until.map(|u| match u {
        Until::Date(d) => (d + 1) * DAY - 1,
        Until::Utc(t) => t,
        Until::Local(l) => e.zone.local_to_utc(l),
    });
    let mut out = Vec::new();
    let mut n = 0usize;
    for p in 0..MAX_PERIODS {
        let mut past = false;
        for day in period_days(r, day0, p) {
            if day < day0 {
                continue;
            }
            let t = if e.all_day {
                day * DAY
            } else {
                e.zone.local_to_utc(day * DAY + tod)
            };
            if t > to || until.is_some_and(|u| t > u) {
                past = true;
                break;
            }
            n += 1;
            if r.count.is_some_and(|c| n > c) || out.len() >= MAX_PER_EVENT {
                return out;
            }
            out.push(t);
        }
        if past {
            break;
        }
    }
    out
}

/// Occurrences overlapping `from..to` (instants), start order, at most `limit`.
/// All-day events overlap with a day of slack each side (they are dates, and
/// the caller's zone is unknown here): the client filters them by its own date.
pub fn expand(p: &Parsed, from: i64, to: i64, limit: usize) -> Vec<Occurrence> {
    let overlaps = |e: &Event, s: i64, en: i64| {
        let slack = if e.all_day { DAY } else { 0 };
        if en > s {
            en > from - slack && s < to + slack
        } else {
            s >= from - slack && s < to + slack
        }
    };
    let mut overrides: HashMap<(&str, i64), &Event> = HashMap::new();
    for e in &p.events {
        if let Some(rid) = e.recurrence_id {
            overrides.insert((e.uid.as_str(), rid), e);
        }
    }
    let mut out = Vec::new();
    for e in &p.events {
        if e.recurrence_id.is_some() {
            if !e.cancelled && overlaps(e, e.start, e.end) {
                out.push(occurrence(e, e.start, e.end, true));
            }
            continue;
        }
        if e.cancelled {
            continue;
        }
        let Some(r) = &e.rrule else {
            if overlaps(e, e.start, e.end) {
                out.push(occurrence(e, e.start, e.end, false));
            }
            continue;
        };
        let len = e.end - e.start;
        for s in series(e, r, to) {
            if e.exdates.contains(&s) || overrides.contains_key(&(e.uid.as_str(), s)) {
                continue;
            }
            if overlaps(e, s, s + len) {
                out.push(occurrence(e, s, s + len, true));
            }
        }
    }
    out.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.title.cmp(&b.title)));
    out.truncate(limit);
    out
}

// ---------------------------------------------------------- join links

const MEETING_HOSTS: &[&str] = &[
    "teams.microsoft.com",
    "teams.live.com",
    "zoom.us",
    "zoomgov.com",
    "meet.google.com",
    "webex.com",
    "meet.jit.si",
    "whereby.com",
    "gotomeet.me",
    "gotomeeting.com",
    "bluejeans.com",
];

fn host_of(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let auth = rest.split(['/', '?', '#']).next()?;
    // A userinfo part would let "https://zoom.us@evil.example" pass as zoom.
    if auth.contains('@') {
        return None;
    }
    auth.split(':').next()
}

/// The first Teams / Zoom / Meet / Webex (and a few more) meeting link in the
/// given texts, scanned in order. Only links on those hosts: an arbitrary URL
/// in a description is not offered as a "Join" button.
pub fn join_link(texts: &[&str]) -> Option<String> {
    for text in texts {
        let mut rest = *text;
        while let Some(i) = rest.find("http") {
            let tail = &rest[i..];
            rest = &tail[4..];
            if !(tail.starts_with("https://") || tail.starts_with("http://")) {
                continue;
            }
            let end = tail
                .find(|c: char| c.is_whitespace() || "<>\"')]".contains(c))
                .unwrap_or(tail.len());
            let url = tail[..end].trim_end_matches(['.', ',', ';', ')']);
            let Some(host) = host_of(url).map(str::to_ascii_lowercase) else {
                continue;
            };
            if MEETING_HOSTS
                .iter()
                .any(|d| host == *d || host.ends_with(&format!(".{d}")))
            {
                return Some(url.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests;
