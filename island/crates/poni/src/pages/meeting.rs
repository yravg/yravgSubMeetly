//! Meeting page (board I03): the newest meeting's register, with a button row
//! on each item that waits on a person. Accept confirms what the engine
//! wrote; Answered closes a question; Carry moves an item to the next
//! meeting; Assign gives it to the next attendee. Each press edits the
//! helper's own document and `POST /notes` it (`poni_core::helper::decide`),
//! like `src/lib/notes-sync.js`. An issued meeting is read-only: no buttons.

use super::hkit;
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Rect};
use poni_core::helper::{self, Decision, Item, Kind, PageState, Review, Status};

const HEAD_H: f32 = 30.0;
const ROW_H: f32 = 36.0;
pub const MAX_ROWS: usize = 5;
const FOOT_H: f32 = 16.0;

pub fn height(_st: &AppState) -> f32 {
    HEAD_H + 4.0 + MAX_ROWS as f32 * ROW_H + FOOT_H + hkit::GUIDE_H
}

/// The buttons an item gets: Accept (or Answered for a question), Carry, Assign.
pub fn buttons(k: Kind) -> [(&'static str, Decision); 3] {
    [(if k == Kind::Question { "Answered" } else { "Accept" }, if k == Kind::Question { Decision::Answered } else { Decision::Accept }), ("Carry", Decision::Carry), ("Assign", Decision::Assign)]
}

/// What a row says when nothing waits on it.
pub fn settled(i: &Item) -> &'static str {
    match (i.status, i.review) {
        (Status::Closed, _) => "Closed",
        (Status::Carried, _) => "Carried",
        (_, Review::Accepted) => "Accepted",
        (_, Review::Edited) => "Edited",
        _ => "",
    }
}

fn verb(d: Decision) -> &'static str {
    match d {
        Decision::Accept => "Accepted",
        Decision::Answered => "Answered",
        Decision::Carry => "Carried",
        Decision::Assign => "Assigned",
    }
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let area = hkit::guide(ui, st, area, PageKind::Meeting, "Decisions, actions and questions from the latest meeting.");
    let accent = st.accent;
    let state = helper::meeting_state(&st.helper.link, &st.helper.snap.notes);
    match state {
        PageState::Error => {
            hkit::offline(ui, st, area, wid("meeting.retry"));
            return;
        }
        PageState::Empty => {
            // A note from Calendar's Notes button exists but holds no items yet: say so, with its name.
            let started = st.helper.note().map(|n| n.title.clone());
            let (title, line) = match &started {
                Some(t) => (t.as_str(), "Notes started from Calendar. Start captions during the meeting; when you stop, the draft decisions and actions land here."),
                None => ("No decisions yet", "A meeting lands here when you stop captions. Pick a meeting in Calendar to start its notes. Items that wait on you get buttons."),
            };
            if hkit::message(ui, area, accent, Icon::Clipboard, title, line, false, Some(("Open Calendar", wid("meeting.calendar")))) {
                st.cmd(Command::SetPage(PageKind::Calendar));
            }
            return;
        }
        _ => {}
    }
    let Some(note) = st.helper.note() else { return };
    let locked = state == PageState::Locked;
    let (title, waiting) = (note.title.clone(), note.waiting());

    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;
    let toast = st.helper_notice.as_ref().filter(|(_, until, _)| *until > ui.now).map(|(m, _, bad)| (m.clone(), *bad));
    let status = match (&toast, locked, waiting) {
        (Some((t, _)), _, _) => t.clone(),
        (None, true, _) => "Issued \u{b7} read-only".into(),
        (None, false, 0) => "All settled".into(),
        (None, false, n) => format!("{n} wait on you"),
    };
    let tone = if let Some((_, bad)) = &toast { if *bad { palette::ORANGE } else { palette::GREEN } } else if waiting > 0 && !locked { palette::ORANGE } else { palette::TEXT_DIM };
    let sst = TextStyle::footnote().weight(Weight::Semibold).color(tone).right();
    let sw = ui.c.measure(&status, &sst, 260.0).0.ceil();
    ui.c.text(&status, Rect::new(head.right() - sw, cy - 9.0, sw, 18.0), &sst);
    ui.c.text(&title, Rect::new(head.x, cy - 11.0, (head.w - sw - 12.0).max(0.0), 22.0), &TextStyle::headline());

    // Waiting items first, then the rest, in the register's order.
    let mut order: Vec<usize> = (0..note.items.len()).collect();
    order.sort_by_key(|&i| !note.items[i].waits());
    let mut done: Option<(String, Decision)> = None;
    for (slot, &idx) in order.iter().take(MAX_ROWS).enumerate() {
        let item = &note.items[idx];
        let row = Rect::new(area.x, head.bottom() + 4.0 + slot as f32 * ROW_H, area.w, ROW_H);
        let rcy = row.center().y;
        let mut right = row.right();
        if item.waits() && !locked {
            for (n, (label, d)) in buttons(item.kind).iter().enumerate().rev() {
                let w = ui.pill_width(label, false, true);
                let b = Rect::new(right - w, rcy - PILL_SMALL / 2.0, w, PILL_SMALL);
                let style = if n == 0 { PillStyle::Primary(accent) } else { PillStyle::Utility };
                if ui.pill(wid_n("meeting.btn", (slot * 4 + n) as u64), b, label, None, style).clicked {
                    done = Some((item.rf.clone(), *d));
                }
                right = b.x - PILL_GAP;
            }
        } else {
            let said = match (&item.owner, settled(item)) {
                (Some(o), s) if !s.is_empty() => format!("{o} \u{b7} {s}"),
                (Some(o), _) => o.clone(),
                (None, s) => s.to_string(),
            };
            let st_ = TextStyle::footnote().color(palette::TEXT_DIM).right();
            let w = ui.c.measure(&said, &st_, 220.0).0.ceil();
            ui.c.text(&said, Rect::new(right - w, rcy - 9.0, w, 18.0), &st_);
            right -= w + 10.0;
        }
        let chip = hkit::kind_chip(ui, row.x, rcy, item.kind);
        let tx = row.x + chip + 8.0;
        let dim = locked || !item.waits();
        let tst = TextStyle::body().color(if dim { palette::TEXT_DIM } else { palette::TEXT });
        ui.c.text(&item.text, Rect::new(tx, rcy - 10.0, (right - tx - 6.0).max(0.0), 20.0), &tst);
    }
    if note.items.len() > MAX_ROWS {
        let more = format!("+{} more in the register", note.items.len() - MAX_ROWS);
        ui.c.text(&more, Rect::new(area.x, area.bottom() - FOOT_H, area.w, FOOT_H), &TextStyle::caption().color(palette::TEXT_FAINT));
    }

    if let Some((rf, d)) = done {
        let body = st.helper.note().and_then(|n| helper::decide(n, &rf, d));
        match body {
            Some(b) => {
                st.helper_notice = Some((format!("{} {rf}", verb(d)), ui.now + 3.0, false));
                st.cmd(Command::HelperPost(b));
            }
            None => {
                let why = if d == Decision::Assign { "Nobody to assign to: the meeting lists no attendees." } else { "That item is no longer there." };
                st.helper_notice = Some((why.into(), ui.now + 5.0, true));
            }
        }
    }
}
