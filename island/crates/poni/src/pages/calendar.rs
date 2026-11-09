//! Calendar page: the meetings of the next week from the calendars the engine
//! syncs (an Outlook or Google ICS link, or an imported .ics file), grouped by
//! day. Each meeting has Join (when its invitation holds a meeting link),
//! Captions (opens the captions panel) and Notes (starts the meeting's notes
//! in the register and opens the Meeting page). The meeting that is on now is
//! tinted.
//!
//! "Calendars" lists the sources: Remove (asks twice: the link cannot be read
//! back, so it has to be pasted again), Paste link, Refresh. A file dropped on
//! the page is imported (`App::import_ics`).
//!
//! States: engine offline, loading, the engine has no calendar, no calendar
//! yet, a calendar that failed, nothing in the next 7 days, meetings.

use super::hkit;
use crate::commands::{CalendarCmd, Command};
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::calendar::{self, Calendar, Event, Source, SourceKind};
use poni_core::geom::{palette, Rect};
use poni_core::helper::Link;

/// As tall as the tallest page, so opening the Calendar never moves the island.
const HEIGHT: f32 = 250.0;
const DAY_H: f32 = 18.0;
const ROW_H: f32 = 40.0;
const FOOT_H: f32 = 28.0;
const SOURCE_ROWS: usize = 4;
/// How far ahead the page looks (days, today included).
const DAYS: i64 = 7;

pub fn height(_st: &AppState) -> f32 {
    HEIGHT
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let body = hkit::guide(ui, st, area, PageKind::Calendar, "Your meetings this week. Join, caption or take notes.");
    let accent = st.accent;
    if matches!(st.helper.link, Link::Offline(_)) {
        return hkit::offline(ui, st, body, wid("calendar.retry"));
    }
    let Some(cal) = st.helper.calendar.clone() else {
        // Not answered yet, or the answer was an error with nothing to keep.
        let (title, line, bad, button) = match &st.helper.calendar_err {
            Some(e) => ("Calendar not available", e.clone(), true, Some(("Try again", wid("calendar.again")))),
            None => ("Loading your calendar", "Asking the engine for your meetings.".into(), false, None),
        };
        if hkit::message(ui, body, accent, Icon::Calendar, title, &line, bad, button) {
            st.cmd(Command::Calendar(CalendarCmd::Refresh));
        }
        return;
    };
    if cal.sources.is_empty() {
        let line = "Copy the ICS link from Outlook or Google Calendar, then Paste link. Or drop an .ics file here.";
        if hkit::message(ui, body, accent, Icon::Calendar, "No calendar yet", line, false, Some(("Paste link", wid("calendar.paste")))) {
            st.cmd(Command::Calendar(CalendarCmd::PasteLink));
        }
        toast(ui, st, body);
        return;
    }
    if st.calendar_manage {
        sources(ui, st, body, &cal);
    } else {
        meetings(ui, st, body, &cal);
    }
}

/// The last answer or refusal, for a few seconds, over the foot of the page.
fn toast(ui: &mut Ui, st: &AppState, body: Rect) {
    if let Some((m, _, bad)) = st.helper_notice.as_ref().filter(|(_, until, _)| *until > ui.now) {
        let tone = if *bad { palette::ORANGE } else { palette::GREEN };
        let st_ = TextStyle::footnote().weight(Weight::Semibold).color(tone).center();
        ui.c.text(m, Rect::new(body.x, body.bottom() - 20.0, body.w, 18.0), &st_);
    }
}

fn clipped(e: &Event, now: i64, off: i64) -> i64 {
    // A meeting that started before now (still running) sits under today.
    calendar::local_day(e.span(off).0.max(now), off)
}

enum Line<'a> {
    Day(String),
    Meeting(&'a Event),
}

fn meetings(ui: &mut Ui, st: &mut AppState, body: Rect, cal: &Calendar) {
    let accent = st.accent;
    let off = calendar::utc_offset(&st.local, st.unix);
    let now = st.unix;
    let today = calendar::local_day(now, off);
    let list = calendar::upcoming(cal, now, off, DAYS);
    let broken = cal.sources.iter().filter(|s| s.last_error.is_some()).count();

    let foot = Rect::new(body.x, body.bottom() - FOOT_H, body.w, FOOT_H);
    let mut right = foot.right();
    let mut open_sources = false;
    let mut refresh = false;
    for (n, label) in ["Refresh", "Calendars"].into_iter().enumerate() {
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, foot.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid_n("calendar.foot", n as u64), b, label, None, PillStyle::Utility).clicked {
            if n == 0 {
                refresh = true;
            } else {
                open_sources = true;
            }
        }
        right = b.x - PILL_GAP;
    }

    if list.is_empty() {
        let area = Rect::new(body.x, body.y, body.w, body.h - FOOT_H);
        let (title, line, bad) = match (broken, cal.sources.len()) {
            (0, _) => ("Nothing in the next 7 days".to_string(), "Your calendars have no meetings this week. Refresh asks them again.".to_string(), false),
            (n, total) => {
                let first = cal.sources.iter().find_map(|s| s.last_error.clone()).unwrap_or_default();
                (if n == total { "Calendar did not sync".into() } else { "A calendar did not sync".into() }, first, true)
            }
        };
        hkit::message(ui, area, accent, Icon::Calendar, &title, &line, bad, None);
    } else {
        let mut lines: Vec<Line> = Vec::new();
        let mut shown = 0;
        let mut used = 0.0;
        let room = body.h - FOOT_H - 4.0;
        let mut day = i64::MIN;
        for e in &list {
            let d = clipped(e, now, off);
            let need = ROW_H + if d != day { DAY_H } else { 0.0 };
            if used + need > room {
                break;
            }
            if d != day {
                lines.push(Line::Day(calendar::day_label(d, today)));
                day = d;
            }
            lines.push(Line::Meeting(e));
            shown += 1;
            used += need;
        }
        let mut y = body.y;
        let mut act: Option<(u8, String, Option<String>)> = None;
        let mut slot = 0u64;
        for l in &lines {
            match l {
                Line::Day(label) => {
                    ui.c.text(label, Rect::new(body.x, y, body.w, DAY_H), &TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_FAINT));
                    y += DAY_H;
                }
                Line::Meeting(e) => {
                    let row = Rect::new(body.x, y, body.w, ROW_H);
                    if let Some(a) = meeting_row(ui, st, row, e, off, slot) {
                        act = Some((a, e.id.clone(), e.join_url.clone()));
                    }
                    slot += 1;
                    y += ROW_H;
                }
            }
        }
        if let Some((a, id, url)) = act {
            match (a, url) {
                (0, Some(u)) => st.cmd(Command::OpenUrl(u)),
                (1, _) => st.cmd(Command::Menu(if st.engine.ext_seen { crate::tray::MenuCmd::OpenCaptionsPanel } else { crate::tray::MenuCmd::SetupExtension })),
                (2, _) => st.cmd(Command::Calendar(CalendarCmd::Notes(id))),
                _ => {}
            }
        }
        let more = list.len() - shown;
        let note = match (more, broken) {
            (0, 0) => None,
            (m, 0) => Some(format!("+{m} more this week")),
            (0, n) => Some(format!("{n} calendar{} did not sync. Open Calendars.", if n == 1 { "" } else { "s" })),
            (m, n) => Some(format!("+{m} more \u{b7} {n} calendar{} did not sync", if n == 1 { "" } else { "s" })),
        };
        if let Some(n) = note {
            let tone = if broken > 0 { palette::ORANGE } else { palette::TEXT_FAINT };
            ui.c.text(&n, Rect::new(foot.x, foot.y, (right - foot.x).max(0.0), foot.h), &TextStyle::caption().color(tone));
        }
    }
    toast(ui, st, Rect::new(body.x, body.y, body.w, body.h - FOOT_H + 8.0));
    if refresh {
        st.cmd(Command::Calendar(CalendarCmd::Refresh));
    }
    if open_sources {
        st.calendar_manage = true;
    }
}

/// One meeting. Returns 0 (Join), 1 (Captions) or 2 (Notes) when a button was pressed.
fn meeting_row(ui: &mut Ui, st: &AppState, row: Rect, e: &Event, off: i64, slot: u64) -> Option<u8> {
    let accent = st.accent;
    let on = e.is_now(st.unix, off);
    if on {
        ui.c.fill_rrect(row, 8.0, accent.with_alpha(0.12));
    }
    let cy = row.center().y;
    let mut hit = None;
    let mut right = row.right() - 4.0;
    for (n, label) in [(2u8, "Notes"), (1, "Captions"), (0, "Join")] {
        if n == 0 && e.join_url.is_none() {
            continue;
        }
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        let style = if n == 0 { PillStyle::Primary(accent) } else { PillStyle::Utility };
        if ui.pill(wid_n("calendar.btn", slot * 3 + n as u64), b, label, None, style).clicked {
            hit = Some(n);
        }
        right = b.x - PILL_GAP;
    }
    let when = calendar::range_label(e, off, st.settings.use_24h);
    let wst = TextStyle::footnote().weight(if on { Weight::Semibold } else { Weight::Regular }).color(if on { accent } else { palette::TEXT_DIM });
    let when_w = if e.all_day { 52.0 } else if st.settings.use_24h { 100.0 } else { 148.0 };
    ui.c.text(&when, Rect::new(row.x + 8.0, cy - 9.0, when_w, 18.0), &wst);
    let tx = row.x + 8.0 + when_w + 6.0;
    let tw = (right - tx - 4.0).max(0.0);
    let mut sub: Vec<String> = Vec::new();
    if let Some(l) = &e.location {
        sub.push(l.clone());
    }
    if let Some(o) = &e.organizer {
        sub.push(o.clone());
    }
    if e.recurring {
        sub.push("repeats".into());
    }
    if on {
        sub.insert(0, "Now".into());
    }
    // A title with nothing under it sits at the row's middle, level with the buttons.
    ui.c.text(&e.title, Rect::new(tx, if sub.is_empty() { cy - 10.0 } else { cy - 18.0 }, tw, 20.0), &TextStyle::body());
    if !sub.is_empty() {
        ui.c.text(&sub.join(" \u{b7} "), Rect::new(tx, cy + 2.0, tw, 16.0), &TextStyle::caption().weight(Weight::Regular).color(palette::TEXT_DIM));
    }
    hit
}

/// The calendars list: what each is, whether it synced, Remove.
fn sources(ui: &mut Ui, st: &mut AppState, body: Rect, cal: &Calendar) {
    let accent = st.accent;
    // The confirm is gone with its calendar.
    if st.calendar_confirm.as_ref().is_some_and(|c| !cal.sources.iter().any(|s| &s.id == c)) {
        st.calendar_confirm = None;
    }
    let row_h = 36.0;
    let mut remove: Option<String> = None;
    // shortcut: the list shows the first SOURCE_ROWS calendars; the engine keeps 8, remove one to reach the rest.
    for (i, s) in cal.sources.iter().take(SOURCE_ROWS).enumerate() {
        let row = Rect::new(body.x, body.y + i as f32 * row_h, body.w, row_h);
        let cy = row.center().y;
        let mut right = row.right();
        let asked = st.calendar_confirm.as_deref() == Some(s.id.as_str());
        let (label, style) = if asked { ("Confirm", PillStyle::Primary(palette::ORANGE)) } else { ("Remove", PillStyle::Utility) };
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid_n("calendar.rm", i as u64), b, label, None, style).clicked {
            if asked {
                remove = Some(s.id.clone());
            } else {
                st.calendar_confirm = Some(s.id.clone());
            }
        }
        right = b.x - PILL_GAP;
        if asked {
            let w = ui.pill_width("Keep", false, true);
            let k = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
            if ui.pill(wid_n("calendar.keep", i as u64), k, "Keep", None, PillStyle::Neutral).clicked {
                st.calendar_confirm = None;
            }
            right = k.x - PILL_GAP;
        }
        let tw = (right - row.x - 6.0).max(0.0);
        ui.c.text(&s.name, Rect::new(row.x, cy - 17.0, tw, 20.0), &TextStyle::body());
        let (line, tone) = source_line(s, asked);
        ui.c.text(&line, Rect::new(row.x, cy + 2.0, tw, 16.0), &TextStyle::caption().weight(Weight::Regular).color(tone));
    }
    if cal.sources.len() > SOURCE_ROWS {
        let n = format!("+{} more calendars", cal.sources.len() - SOURCE_ROWS);
        let y = body.y + SOURCE_ROWS as f32 * row_h;
        ui.c.text(&n, Rect::new(body.x, y, body.w, 16.0), &TextStyle::caption().color(palette::TEXT_FAINT));
    }
    let hint = Rect::new(body.x, body.bottom() - FOOT_H - 18.0, body.w, 16.0);
    ui.c.text("Drop an .ics file here to import it. A calendar link is secret: it stays on this computer.", hint, &TextStyle::caption().color(palette::TEXT_FAINT));

    let foot = Rect::new(body.x, body.bottom() - FOOT_H, body.w, FOOT_H);
    let mut right = foot.right();
    for (n, label) in ["Done", "Refresh", "Paste link"].into_iter().enumerate() {
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, foot.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
        let style = if n == 2 { PillStyle::Primary(accent) } else { PillStyle::Utility };
        if ui.pill(wid_n("calendar.src", n as u64), b, label, None, style).clicked {
            match n {
                0 => {
                    st.calendar_manage = false;
                    st.calendar_confirm = None;
                }
                1 => st.cmd(Command::Calendar(CalendarCmd::Refresh)),
                _ => st.cmd(Command::Calendar(CalendarCmd::PasteLink)),
            }
        }
        right = b.x - PILL_GAP;
    }
    if let Some(id) = remove {
        st.calendar_confirm = None;
        st.cmd(Command::Calendar(CalendarCmd::Remove(id)));
    }
    toast(ui, st, Rect::new(body.x, body.y, body.w, body.h - FOOT_H + 8.0));
}

/// Under a calendar's name: why it failed, else what it is.
fn source_line(s: &Source, asked: bool) -> (String, poni_core::geom::Color) {
    if asked {
        let what = if s.kind == SourceKind::Link { "The link cannot be read back: paste it again to add it later." } else { "Drop the file again to add it later." };
        return (format!("Remove this calendar? {what}"), palette::ORANGE);
    }
    if let Some(e) = &s.last_error {
        return (e.clone(), palette::ORANGE);
    }
    let from = match (&s.kind, &s.link) {
        (SourceKind::Link, Some(l)) => l.clone(),
        (SourceKind::Link, None) => "Link".into(),
        (SourceKind::File, _) => "Imported file".into(),
    };
    let mut line = format!("{from} \u{b7} {} meeting{}", s.events, if s.events == 1 { "" } else { "s" });
    if let Some(w) = s.warnings.first() {
        line = format!("{line} \u{b7} {w}");
    }
    (line, palette::TEXT_DIM)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(kind: SourceKind, link: Option<&str>, events: usize, err: Option<&str>, warn: &[&str]) -> Source {
        Source { id: "s1".into(), kind, name: "Work".into(), link: link.map(str::to_string), events, last_error: err.map(str::to_string), warnings: warn.iter().map(|w| w.to_string()).collect() }
    }

    #[test]
    fn a_source_says_what_it_is_then_why_it_failed() {
        let (l, c) = source_line(&src(SourceKind::Link, Some("https://example.com/x"), 1, None, &[]), false);
        assert_eq!(l, "https://example.com/x \u{b7} 1 meeting");
        assert_eq!(c, palette::TEXT_DIM);
        let (l, _) = source_line(&src(SourceKind::File, None, 3, None, &["Repeats by day of the year are skipped."]), false);
        assert_eq!(l, "Imported file \u{b7} 3 meetings \u{b7} Repeats by day of the year are skipped.");
        let (l, c) = source_line(&src(SourceKind::Link, Some("https://example.com/x"), 0, Some("The server said 404."), &[]), false);
        assert_eq!((l.as_str(), c), ("The server said 404.", palette::ORANGE));
    }

    #[test]
    fn the_first_remove_press_only_asks() {
        let (l, c) = source_line(&src(SourceKind::Link, Some("https://example.com/x"), 1, None, &[]), true);
        assert!(l.starts_with("Remove this calendar?") && l.contains("paste it again"), "{l}");
        assert_eq!(c, palette::ORANGE);
    }

    #[test]
    fn a_running_meeting_sits_under_today() {
        let off = 0;
        let now = 86_400 * 10 + 3600;
        let e = |start: i64| Event { id: "e".into(), title: "t".into(), start, end: start + 7200, all_day: false, location: None, organizer: None, attendees: 0, join_url: None, recurring: false };
        assert_eq!(clipped(&e(now - 90_000), now, off), 10, "started yesterday, still running");
        assert_eq!(clipped(&e(now + 86_400), now, off), 11);
    }
}
