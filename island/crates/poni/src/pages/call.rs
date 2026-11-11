//! The Meeting tab (PMM-005..009, PMM-018; board P03, P04 a): the meeting running now. Left, its
//! captions as rolling lines, newest at the bottom with its translation under each; right, "Notes
//! so far", the engine's draft of the session (marked AI draft; the app refreshes it every 60 s or
//! 12 lines, `poni_core::live_notes`) with Keep / Edit / Remove on each item and "+ Note" for one
//! typed here. Once the session is saved the tab says so for 10 minutes ("Saved · <title>, <n>
//! min", Open in Minutes, Dismiss). With no meeting it offers Paste a meeting link, Start captions
//! and Open Today; a joined link whose host no list knows asks once "Always treat <host> as a
//! meeting". "Aa" opens the quick caption strip, as on Live.

use super::hkit;
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::pill::quick_captions;
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Point, Rect};
use poni_core::live_notes::{Kind, Mark, SAVED_S};
use poni_core::meeting_source::SourceKind;

/// The page without the quick strip: as tall as Minutes, under System's 256.
const BODY_H: f32 = 250.0;
const HEAD_H: f32 = 34.0;
/// The session lines the app keeps for this page (newest last).
pub const LINES: usize = 8;
const ROW_H: f32 = 22.0;
const SUMMARY_H: f32 = 34.0;
const HEADING_H: f32 = 18.0;
const FOOT_H: f32 = 30.0;
const OFFER_H: f32 = 34.0;
const NOTE_MAX: usize = 300;
const EDIT_ID: &str = "call.edit";
const NOTE_ID: &str = "call.note";
const TITLE_ID: &str = "live.title.edit";
/// The kinds "+ Note" offers, in its picker's order.
const ADD: [(Kind, &str, &str); 3] =
    [(Kind::Decision, "Decision", "Type a decision"), (Kind::Action, "Action", "Type an action, @owner at the end"), (Kind::Note, "Note", "Type a note")];

pub fn height(st: &AppState) -> f32 {
    BODY_H + quick_captions::extra_height(st)
}

/// A frame each second while the meeting's captions run (its clock, "Updated 20 s ago"), and one
/// when the saved result leaves.
pub fn next_wake(st: &AppState) -> Option<f64> {
    if st.call_live() {
        Some(st.now.floor() + 1.0)
    } else {
        st.call.saved.as_ref().map(|s| s.at + SAVED_S).filter(|t| *t > st.now)
    }
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let (page, strip) = quick_captions::split(st, area);
    let offer = poni_core::meeting_source::host_offer(st.joined.active(st.now), &st.settings.meeting_apps, &st.call.asked_hosts).map(String::from);
    let (body, band) = match offer {
        Some(_) => {
            let (b, o) = page.split_bottom(OFFER_H);
            (b, Some(o))
        }
        None => (page, None),
    };
    if st.call_live() {
        live(ui, st, body, false);
    } else if let Some((_, t, ..)) = st.call.saving.clone() {
        hkit::message(ui, body, st.accent, Icon::Call, &format!("Saving {t}"), "The engine drafts its minutes with the notes you kept and typed.", false, None);
    } else if st.call.saved.as_ref().is_some_and(|s| !s.dismissed) {
        saved(ui, st, body);
    } else {
        empty(ui, st, body);
    }
    if let (Some(host), Some(r)) = (offer, band) {
        offer_row(ui, st, r, &host);
    }
    if let Some(r) = strip {
        quick_captions::strip(ui, st, r, page);
    }
}

/// The meeting's title (the calendar's, else the app's or the joined link's host) and the app
/// beside it when the title is the calendar's ("Link" for a joined link).
fn title(st: &AppState) -> (String, Option<String>) {
    let source = match &st.meeting_source {
        SourceKind::Meeting { label, via } => Some(if via == "joined link" { (label.clone(), "Link".to_string()) } else { (label.clone(), label.clone()) }),
        _ => st.joined.active(st.now).map(|h| (h.to_string(), "Link".to_string())),
    };
    match (st.running_event_title(), source) {
        (Some(t), s) => (t, s.map(|(_, chip)| chip)),
        (None, Some((label, chip))) => (label.clone(), (chip != label).then_some(chip)),
        (None, None) => ("Meeting".to_string(), None),
    }
}

// ---------------------------------------------------------------- live

/// Live's title for a room session: what the person typed, else the calendar meeting running now,
/// else "In-room meeting" (PMM-020).
fn room_title(st: &AppState) -> String {
    st.call.title.clone().or_else(|| st.running_event_title()).unwrap_or_else(|| poni_core::capture::ROOM_TITLE.to_string())
}

/// The session running now: captions left, "Notes so far" right, under a header with its title and
/// time. The Meeting tab's view, and Live's while it hears the room (`room`, PMM-020): there the
/// title can be edited, Hold and Unfollow stay beside Stop, and the source row sits under the header.
pub(crate) fn live(ui: &mut Ui, st: &mut AppState, area: Rect, room: bool) {
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;
    // Right to left: Stop captions, (Live) Unfollow and Hold, Aa.
    let w = ui.pill_width("Stop captions", false, true);
    let b = Rect::new(head.right() - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid(if room { "live.captions" } else { "call.stop" }), b, "Stop captions", None, PillStyle::Neutral).clicked {
        st.cmd(Command::Captions(false));
    }
    let mut right = b.x - PILL_GAP;
    if room {
        right = super::live::hold_unfollow(ui, st, right, cy);
    }
    let right = quick_captions::aa_button(ui, st, right, cy) - PILL_GAP;

    // Left: title, the app (Live: its source, or Held), a red dot and the time since captions started.
    let (name, chip) = if room {
        (room_title(st), Some(if st.helper.paused() { "Held".to_string() } else { st.live_source().label().to_string() }))
    } else {
        title(st)
    };
    let time = poni_core::datetime::fmt_duration(st.call.started.map_or(0.0, |t| st.now - t));
    let time_st = TextStyle::footnote().weight(Weight::Semibold).tabular().color(palette::RED);
    let chip_st = TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_DIM);
    let name_st = TextStyle::body().weight(Weight::Semibold);
    let tw = ui.c.measure(&time, &time_st, 120.0).0.ceil();
    let cw = chip.as_deref().map_or(0.0, |c| ui.c.measure(c, &chip_st, 160.0).0.ceil() + 12.0);
    let pencil = if room { 22.0 } else { 0.0 };
    let tail = cw + if cw > 0.0 { 8.0 } else { 0.0 } + 14.0 + tw + pencil;
    let room_w = (right - head.x - 8.0 - tail).max(0.0);
    let mut nw = ui.c.measure(&name, &name_st, 400.0).0.ceil().min(room_w);
    if let Some(mut buf) = st.call.title_edit.clone().filter(|_| room) {
        nw = room_w.min(240.0);
        let resp = ui.text_input(wid(TITLE_ID), Rect::new(head.x, cy - 12.0, nw, 24.0), &mut buf, poni_core::capture::ROOM_TITLE, 80);
        if resp.submitted {
            let t = buf.trim();
            st.call.title = (!t.is_empty()).then(|| t.to_string());
            st.call.title_edit = None;
            ui.blur();
        } else if resp.cancelled {
            st.call.title_edit = None;
        } else {
            st.call.title_edit = Some(buf);
        }
    } else {
        ui.c.text(&name, Rect::new(head.x, cy - 10.0, nw, 20.0), &name_st);
        if room && ui.icon_button(wid("live.title"), Rect::new(head.x + nw + 2.0, cy - 10.0, 20.0, 20.0), Icon::Pencil, palette::TEXT_DIM, 12.0).clicked {
            ui.focus_text(wid(TITLE_ID), name.chars().count());
            st.call.title_edit = Some(name.clone());
        }
    }
    let mut x = head.x + nw + 8.0 + pencil;
    if let Some(c) = chip.as_deref() {
        ui.c.fill_rrect(Rect::new(x, cy - 9.0, cw, 18.0), 9.0, palette::SURFACE);
        ui.c.text(c, Rect::new(x, cy - 9.0, cw, 18.0), &chip_st.center());
        x += cw + 8.0;
    }
    ui.c.fill_circle(Point::new(x + 4.0, cy), 4.0, palette::RED);
    ui.c.text(&time, Rect::new(x + 14.0, cy - 9.0, tw + 2.0, 18.0), &time_st);

    let mut top = head.bottom() + 6.0;
    if room {
        super::live::source_row(ui, st, Rect::new(area.x, top, area.w, super::live::SOURCE_H));
        top += super::live::SOURCE_H + 6.0;
    }
    let cols = Rect::new(area.x, top, area.w, (area.bottom() - top).max(0.0));
    let (left, rest) = cols.split_left((cols.w * 0.44).floor());
    ui.c.fill_rect(Rect::new(left.right() + 8.0, cols.y, 1.0, cols.h), palette::BORDER);
    captions(ui, st, Rect::new(left.x, left.y, left.w - 4.0, left.h));
    notes(ui, st, Rect::new(rest.x + 18.0, rest.y, (rest.w - 18.0).max(0.0), rest.h));
}

/// The session's newest lines from the bottom up, each with its translation under it.
fn captions(ui: &mut Ui, st: &AppState, r: Rect) {
    if st.call.lines.is_empty() {
        let line = "Listening. Captions show here, newest at the bottom, as people speak.";
        ui.c.text(line, Rect::new(r.x, r.y + 4.0, r.w, 40.0), &TextStyle::footnote().color(palette::TEXT_DIM).wrap().top());
        return;
    }
    let tr = hkit::translation_color(ui, st.settings.translation_color);
    let newest = st.call.lines.len() - 1;
    ui.c.clip(r);
    let mut y = r.bottom();
    // Captions tab › Show and Font size (PMM-026): which text each line prints, and how large.
    let (show, px) = (poni_core::capture::Show::parse(&st.settings.caption_show), poni_core::capture::resolve_px(st.settings.caption_px, st.settings.caption_font));
    for (i, l) in st.call.lines.iter().enumerate().rev() {
        let (main, under) = show.parts(&l.source, &l.translation);
        // The utterance still being spoken (board P12): lighter than a kept line, with a caret.
        let interim = st.call.interim && i == newest;
        let mut src = if interim {
            TextStyle::body().weight(Weight::Medium).color(palette::TEXT_DIM)
        } else if i == newest {
            TextStyle::body().weight(Weight::Semibold)
        } else {
            TextStyle::footnote().color(palette::TEXT_DIM)
        }
        .wrap()
        .top();
        src.size = poni_core::capture::scale_px(src.size, px);
        let mut tst = TextStyle::footnote().color(if i == newest { tr } else { tr.with_alpha(0.75) }).wrap().top();
        tst.size = poni_core::capture::scale_px(tst.size, px);
        let sh = ui.c.measure(main, &src, r.w).1.ceil();
        let th = under.map_or(0.0, |u| ui.c.measure(u, &tst, r.w).1.ceil() + 2.0);
        y -= sh + th;
        ui.c.text(main, Rect::new(r.x, y, r.w, sh), &src);
        if let Some(u) = under {
            ui.c.text(u, Rect::new(r.x + 0.0, y + sh + 2.0, r.w, th), &tst);
        }
        let ms = st.call.ms.get(i).copied().flatten().filter(|_| st.settings.caption_readout && !interim);
        if interim || ms.is_some() {
            let (ex, ey) = end_of_text(ui, main, &src, r.w);
            if interim {
                // Blinks once a second; a caret that is not drawn this half-second leaves the line as it is.
                if st.now.fract() < 0.5 {
                    ui.c.fill_rrect(Rect::new((r.x + ex + 2.0).min(r.right() - 2.0), y + ey + 2.0, 2.0, src.size), 1.0, st.accent);
                }
            } else if let Some(ms) = ms {
                let label = poni_core::capture::readout(ms);
                let rs = TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_DIM);
                let w = ui.c.measure(&label, &rs, 200.0).0.ceil();
                let x = (r.x + ex + 8.0).min(r.right() - w);
                ui.c.text(&label, Rect::new(x, y + ey, w + 1.0, src.size + 4.0), &rs);
            }
        }
        y -= 8.0;
        if y < r.y {
            break;
        }
    }
    ui.c.unclip();
}

/// Where the last row of `text` (wrapped in `w`) ends: (x from the left, y from the top of the block).
fn end_of_text(ui: &mut Ui, text: &str, style: &TextStyle, w: f32) -> (f32, f32) {
    let (tw, th) = ui.c.measure(text, style, w);
    let one = ui.c.measure("Ag", style, w).1.max(1.0);
    let rows = (th / one).round().max(1.0);
    // The last row's width is not measured by the text engine: a single row is exact, a wrapped
    // text puts it at the remainder (shortcut: a caret or readout on a wrapped line can sit a few px off).
    let x = if rows <= 1.0 { tw } else { tw % w };
    (x, (rows - 1.0) * one)
}

fn ago(secs: f64) -> String {
    if secs < 60.0 {
        format!("{} s", secs.max(0.0).floor())
    } else {
        format!("{} min", (secs / 60.0).floor())
    }
}

/// What a press on a note row asks for (applied once the rows are drawn).
enum Act {
    Keep(usize),
    Edit(usize),
    Remove(usize),
    Save(usize, String),
    Cancel,
}

/// "Notes so far": the stamp, the engine-down line, the sections, and the footer.
fn notes(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let accent = st.accent;
    let cap = TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_DIM);
    let top = Rect::new(r.x, r.y, r.w, 20.0);
    let lw = ui.c.measure("NOTES SO FAR", &cap, 200.0).0.ceil();
    ui.c.text("NOTES SO FAR", Rect::new(top.x, top.y, lw + 1.0, top.h), &cap);
    let chip_st = TextStyle::caption().weight(Weight::Semibold).color(accent).center();
    let aw = ui.c.measure("AI draft", &chip_st, 120.0).0.ceil() + 12.0;
    let chip = Rect::new(top.x + lw + 8.0, top.center().y - 8.0, aw, 16.0);
    ui.c.fill_rrect(chip, 8.0, accent.with_alpha(0.2));
    ui.c.text("AI draft", chip, &chip_st);
    let n = &st.call.notes;
    let stamp = if n.busy {
        "Refreshing\u{2026}".to_string()
    } else if st.power.saver {
        "Paused on battery saver".to_string()
    } else {
        match (n.updated, n.down) {
            (Some(t), true) => format!("Paused \u{b7} last draft {} ago", ago(st.now - t)),
            (Some(t), false) => format!("Updated {} ago", ago(st.now - t)),
            (None, _) => "First draft after a minute".to_string(),
        }
    };
    let sx = chip.right() + 8.0;
    ui.c.text(&stamp, Rect::new(sx, top.y, (top.right() - sx).max(0.0), top.h), &TextStyle::caption().color(palette::TEXT_FAINT).right());

    let foot = Rect::new(r.x, r.bottom() - FOOT_H, r.w, FOOT_H);
    let mut list = Rect::new(r.x, top.bottom() + 4.0, r.w, (foot.y - top.bottom() - 6.0).max(0.0));
    if st.call.notes.down {
        // Captions go on; only the notes wait for the engine.
        let row = Rect::new(list.x, list.y, list.w, 24.0);
        let w = ui.pill_width("Try again", false, true);
        let b = Rect::new(row.right() - w, row.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("call.retry"), b, "Try again", None, PillStyle::Utility).clicked {
            st.cmd(Command::CallNotesRefresh);
        }
        let warn = TextStyle::footnote().weight(Weight::Semibold).color(palette::ORANGE);
        ui.c.text("Notes paused: engine not answering", Rect::new(row.x, row.y, (b.x - row.x - 8.0).max(0.0), row.h), &warn);
        list = Rect::new(list.x, list.y + 28.0, list.w, (list.h - 28.0).max(0.0));
    }
    rows(ui, st, list);
    footer(ui, st, foot);
}

/// The sections in order, each item with its marks and, under the pointer, its buttons.
fn rows(ui: &mut Ui, st: &mut AppState, list: Rect) {
    let accent = st.accent;
    let sections = [(Kind::Summary, "SUMMARY"), (Kind::Decision, "DECISIONS"), (Kind::Action, "ACTION ITEMS"), (Kind::Question, "QUESTIONS"), (Kind::Note, "NOTES")];
    // (heading or item, its height)
    let mut layout: Vec<(Result<&str, usize>, f32)> = Vec::new();
    for (kind, head) in sections {
        let idx: Vec<usize> = st.call.notes.items.iter().enumerate().filter(|(_, i)| i.kind == kind).map(|(n, _)| n).collect();
        if !idx.is_empty() {
            layout.push((Ok(head), HEADING_H));
            layout.extend(idx.into_iter().map(|n| (Err(n), if kind == Kind::Summary { SUMMARY_H } else { ROW_H })));
        }
    }
    if layout.is_empty() {
        let line = "Summary, decisions, action items and questions show here as the meeting goes on. Keep the ones that matter; they go into the minutes.";
        ui.c.text(line, Rect::new(list.x, list.y + 2.0, list.w, 48.0), &TextStyle::footnote().color(palette::TEXT_DIM).wrap().top());
        return;
    }
    let total: f32 = layout.iter().map(|(_, h)| h).sum();
    let max = (total - list.h).max(0.0);
    st.call.scroll = (st.call.scroll - ui.wheel_in(list) * ROW_H).clamp(0.0, max);
    let mut y = list.y - st.call.scroll;
    let mut act = None;
    ui.c.clip(list);
    for (row, h) in layout {
        let r = Rect::new(list.x, y, list.w, h);
        y += h;
        if r.bottom() < list.y || r.y > list.bottom() {
            continue;
        }
        match row {
            Ok(head) => ui.c.text(head, Rect::new(r.x, r.y + 2.0, r.w, h - 2.0), &TextStyle::caption().weight(Weight::Semibold).color(accent)),
            Err(i) => {
                if let Some(a) = item(ui, st, r, i) {
                    act = Some(a);
                }
            }
        }
    }
    ui.c.unclip();
    let n = &mut st.call.notes;
    match act {
        Some(Act::Keep(i)) => {
            n.keep(i);
        }
        Some(Act::Edit(i)) => {
            let j = n.keep(i);
            let text = n.items[j].text.clone();
            ui.focus_text(wid(EDIT_ID), text.chars().count());
            st.call.editing = Some((j, text));
        }
        Some(Act::Remove(i)) => {
            n.remove(i);
            st.call.editing = None;
        }
        Some(Act::Save(i, text)) => {
            n.edit(i, &text);
            st.call.editing = None;
            ui.blur();
        }
        Some(Act::Cancel) => st.call.editing = None,
        None => {}
    }
}

/// One note in `r`: a field while it is edited, else its text, owner and mark, and its buttons
/// under the pointer (Keep for a draft item, Edit, Remove).
fn item(ui: &mut Ui, st: &mut AppState, r: Rect, i: usize) -> Option<Act> {
    let it = st.call.notes.items.get(i)?.clone();
    if let Some((_, mut buf)) = st.call.editing.clone().filter(|(e, _)| *e == i) {
        let resp = ui.text_input(wid(EDIT_ID), r.inset(0.0, 1.0), &mut buf, "Empty removes it", NOTE_MAX);
        if resp.submitted {
            return Some(Act::Save(i, buf));
        }
        if resp.cancelled {
            return Some(Act::Cancel);
        }
        st.call.editing = Some((i, buf));
        return None;
    }
    let hover = ui.hovered(r);
    if hover {
        ui.c.fill_rrect(r, 6.0, palette::SURFACE);
    }
    let mut right = r.right() - 4.0;
    let mut act = None;
    if hover {
        let mut buttons: Vec<(Icon, &str)> = vec![(Icon::Close, "remove"), (Icon::Pencil, "edit")];
        if it.mark == Mark::Draft {
            buttons.push((Icon::Pin, "keep"));
        }
        for (icon, what) in buttons {
            let b = Rect::new(right - 20.0, r.y + (ROW_H - 20.0) / 2.0, 20.0, 20.0);
            if ui.icon_button(wid_n(&format!("call.{what}"), i as u64), b, icon, palette::TEXT_DIM, 13.0).clicked {
                act = Some(match what {
                    "remove" => Act::Remove(i),
                    "edit" => Act::Edit(i),
                    _ => Act::Keep(i),
                });
            }
            right = b.x - 2.0;
        }
    } else {
        let mark = match it.mark {
            Mark::Draft => None,
            Mark::Kept => Some(("Kept", palette::GREEN)),
            Mark::Edited => Some(("Edited", palette::GREEN)),
            Mark::Typed => Some(("You", st.accent)),
        };
        let small = TextStyle::caption().weight(Weight::Semibold);
        for (text, color) in mark.into_iter().chain(it.owner.as_deref().map(|o| (o, palette::TEXT_DIM))) {
            let w = ui.c.measure(text, &small, 140.0).0.ceil();
            let tr = Rect::new(right - w, r.y + (ROW_H - 18.0) / 2.0, w, 18.0);
            ui.c.text(text, tr, &small.color(color).right());
            right = tr.x - 8.0;
        }
    }
    let style = if it.kind == Kind::Summary { TextStyle::footnote().wrap().top() } else { TextStyle::footnote() };
    let tr = if it.kind == Kind::Summary { Rect::new(r.x + 4.0, r.y + 3.0, (right - r.x - 8.0).max(0.0), r.h - 4.0) } else { Rect::new(r.x + 4.0, r.y, (right - r.x - 8.0).max(0.0), r.h) };
    ui.c.text(&it.text, tr, &style);
    act
}

/// "Kept and typed notes never get overwritten" and "+ Note", or the note being typed: its kind,
/// the field and Add.
fn footer(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let accent = st.accent;
    let cy = r.center().y;
    let Some((kind, mut buf)) = st.call.adding.clone() else {
        let w = ui.pill_width("+ Note", false, true);
        let b = Rect::new(r.right() - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("call.add"), b, "+ Note", None, PillStyle::Primary(accent)).clicked {
            st.call.adding = Some((Kind::Note, String::new()));
            ui.focus_text(wid(NOTE_ID), 0);
        }
        let line = "Kept and typed notes never get overwritten";
        ui.c.text(line, Rect::new(r.x, r.y, (b.x - r.x - 8.0).max(0.0), r.h), &TextStyle::caption().color(palette::TEXT_FAINT));
        return;
    };
    let names: Vec<&str> = ADD.iter().map(|(_, n, _)| *n).collect();
    let sel = ADD.iter().position(|(k, ..)| *k == kind).unwrap_or(2);
    let pw = super::settings::picker_width(ui, &names);
    let picked = super::settings::picker(ui, "call.kind", r.x, cy - 12.0, 24.0, &names, sel);
    let w = ui.pill_width("Add", false, true);
    let b = Rect::new(r.right() - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    let field = Rect::new(r.x + pw + 6.0, r.y + 1.0, (b.x - r.x - pw - 12.0).max(0.0), r.h - 2.0);
    let resp = ui.text_input(wid(NOTE_ID), field, &mut buf, ADD[sel].2, NOTE_MAX);
    let add = ui.pill(wid("call.add.go"), b, "Add", None, PillStyle::Primary(accent)).clicked || resp.submitted;
    if resp.cancelled {
        st.call.adding = None;
        return;
    }
    let kind = picked.map_or(kind, |i| ADD[i].0);
    if add && st.call.notes.add(kind, &buf) {
        st.call.adding = None;
        ui.blur();
        return;
    }
    st.call.adding = Some((kind, buf));
}

// ---------------------------------------------------------------- saved and empty

/// "Saved · <title>, <n> min", what it holds, Open in Minutes and Dismiss (board P04 a).
pub(crate) fn saved(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let Some(s) = st.call.saved.as_ref() else { return };
    let (id, head, line) = (s.id.clone(), format!("Saved \u{b7} {}, {} min", s.title, s.minutes), s.counts.line());
    let top = area.y + ((area.h - 132.0) / 2.0).max(0.0);
    let c = Point::new(area.center().x, top + 16.0);
    ui.c.fill_circle(c, 16.0, palette::GREEN.with_alpha(0.22));
    ui.c.icon(Icon::Check, Rect::from_center(c, 18.0, 18.0), palette::GREEN);
    ui.c.text(&head, Rect::new(area.x, top + 40.0, area.w, 20.0), &TextStyle::headline().center());
    ui.c.text(&line, Rect::new(area.x + 40.0, top + 64.0, (area.w - 80.0).max(0.0), 32.0), &TextStyle::footnote().color(palette::TEXT_DIM).center().wrap().top());
    let (ow, dw) = (ui.pill_width("Open in Minutes", false, true), ui.pill_width("Dismiss", false, true));
    let x = area.center().x - (ow + PILL_GAP + dw) / 2.0;
    let y = top + 104.0;
    if ui.pill(wid("call.open"), Rect::new(x, y, ow, PILL_SMALL), "Open in Minutes", None, PillStyle::Primary(st.accent)).clicked {
        st.show_record(&id);
        st.cmd(Command::SetPage(PageKind::Meeting));
    }
    if ui.pill(wid("call.dismiss"), Rect::new(x + ow + PILL_GAP, y, dw, PILL_SMALL), "Dismiss", None, PillStyle::Utility).clicked {
        if let Some(s) = st.call.saved.as_mut() {
            s.dismissed = true;
        }
    }
}

/// No meeting captioned now: Paste a meeting link, Start captions, Open Today.
fn empty(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let on = st.meeting_now();
    let (head, line) = if on {
        (format!("{} is on", title(st).0), "Start captions to caption it here, with the notes so far beside them.")
    } else {
        ("No meeting running".to_string(), "Start captions to caption this PC now, open Today to join the next meeting, or paste a link.")
    };
    if hkit::message(ui, area, st.accent, Icon::Call, &head, line, false, Some(("Paste a meeting link", wid("call.paste")))) {
        st.cmd(Command::JoinPastedLink);
    }
    let y = area.y + ((area.h - hkit::MESSAGE_H) / 2.0).max(0.0) + hkit::MESSAGE_H + 6.0;
    let mut x = area.x + 48.0;
    if !st.capture.running() {
        let w = ui.pill_width("Start captions", false, true);
        if ui.pill(wid("call.start"), Rect::new(x, y, w, PILL_SMALL), "Start captions", None, PillStyle::Neutral).clicked {
            st.cmd(Command::Captions(true));
        }
        x += w + PILL_GAP;
    }
    let w = ui.pill_width("Open Today", false, true);
    if ui.pill(wid("call.today"), Rect::new(x, y, w, PILL_SMALL), "Open Today", None, PillStyle::Utility).clicked {
        st.cmd(Command::SetPage(PageKind::Calendar));
    }
    quick_captions::aa_button(ui, st, area.right(), area.y + PILL_SMALL / 2.0);
}

/// A joined link no list knows: "<host> is not a known meeting app", asked once.
fn offer_row(ui: &mut Ui, st: &mut AppState, r: Rect, host: &str) {
    let cy = r.center().y;
    let yes = format!("Always treat {host} as a meeting");
    let (nw, yw) = (ui.pill_width("Not now", false, true), ui.pill_width(&yes, false, true));
    let not_now = Rect::new(r.right() - nw, cy - PILL_SMALL / 2.0, nw, PILL_SMALL);
    let always = Rect::new(not_now.x - PILL_GAP - yw, not_now.y, yw, PILL_SMALL);
    ui.c.fill_rect(Rect::new(r.x, r.y, r.w, 1.0), palette::BORDER);
    let text = format!("{host} is not a known meeting app.");
    ui.c.text(&text, Rect::new(r.x, r.y, (always.x - r.x - 8.0).max(0.0), r.h), &TextStyle::footnote().color(palette::TEXT_DIM));
    if ui.pill(wid("call.always"), always, &yes, None, PillStyle::Primary(st.accent)).clicked {
        st.cmd(Command::MeetingAddHost(host.to_string()));
    }
    if ui.pill(wid("call.notnow"), not_now, "Not now", None, PillStyle::Utility).clicked {
        st.call.asked_hosts.push(host.to_string());
    }
}
