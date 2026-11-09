//! Inbox page (board I04): the open actions, questions and risks of every
//! meeting that is not issued, newest meeting first. Done closes an item;
//! Carry moves it to the next meeting (both `POST /notes` through
//! `poni_core::helper::decide`). Items in issued meetings are read-only and
//! only counted. Nothing open: "Inbox zero".

use super::hkit;
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Rect};
use poni_core::helper::{self, Decision, PageState};

const HEAD_H: f32 = 26.0;
const ROW_H: f32 = 36.0;
pub const MAX_ROWS: usize = 5;
const FOOT_H: f32 = 16.0;

pub fn height(_st: &AppState) -> f32 {
    HEAD_H + 4.0 + MAX_ROWS as f32 * ROW_H + FOOT_H + hkit::GUIDE_H
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let area = hkit::guide(ui, st, area, PageKind::Inbox, "Open actions and questions from all your meetings.");
    let accent = st.accent;
    let notes = &st.helper.snap.notes;
    let state = helper::inbox_state(&st.helper.link, notes);
    match state {
        PageState::Error => {
            hkit::offline(ui, st, area, wid("inbox.retry"));
            return;
        }
        PageState::Empty => {
            hkit::message(ui, area, accent, Icon::CheckCircle, "Inbox zero", "No open actions, questions or risks in your meetings.", false, None);
            return;
        }
        PageState::Locked => {
            let n = helper::inbox_locked(notes);
            let line = format!("{n} open in issued meetings. Issued meetings are read-only, so nothing here can be changed.");
            hkit::message(ui, area, accent, Icon::Pin, "Nothing to act on", &line, false, None);
            return;
        }
        _ => {}
    }
    let rows = helper::inbox(notes);
    let locked = helper::inbox_locked(notes);
    let head = format!("{} open", rows.len());
    ui.c.text(&head, Rect::new(area.x, area.y, area.w, HEAD_H), &TextStyle::headline());

    let mut done: Option<(String, String, Decision)> = None;
    for (slot, r) in rows.iter().take(MAX_ROWS).enumerate() {
        let row = Rect::new(area.x, area.y + HEAD_H + 4.0 + slot as f32 * ROW_H, area.w, ROW_H);
        let cy = row.center().y;
        let mut right = row.right();
        for (n, (label, d)) in [("Done", Decision::Answered), ("Carry", Decision::Carry)].into_iter().enumerate().rev() {
            let w = ui.pill_width(label, false, true);
            let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
            let style = if n == 0 { PillStyle::Primary(accent) } else { PillStyle::Utility };
            if ui.pill(wid_n("inbox.btn", (slot * 2 + n) as u64), b, label, None, style).clicked {
                done = Some((r.note.id.clone(), r.item.rf.clone(), d));
            }
            right = b.x - PILL_GAP;
        }
        let chip = hkit::kind_chip(ui, row.x, cy - 8.0, r.item.kind);
        let tx = row.x + chip + 8.0;
        let w = (right - tx - 6.0).max(0.0);
        ui.c.text(&r.item.text, Rect::new(tx, cy - 16.0, w, 20.0), &TextStyle::body());
        let mut from = r.note.title.clone();
        if let Some(o) = &r.item.owner {
            from = format!("{from} \u{b7} {o}");
        }
        if let Some(d) = &r.item.due {
            from = format!("{from} \u{b7} due {d}");
        }
        ui.c.text(&from, Rect::new(tx, cy + 2.0, w, 16.0), &TextStyle::caption().weight(Weight::Regular).color(palette::TEXT_DIM));
    }
    let foot = match (rows.len() > MAX_ROWS, locked) {
        (true, 0) => Some(format!("+{} more in the register", rows.len() - MAX_ROWS)),
        (true, n) => Some(format!("+{} more in the register \u{b7} {n} in issued meetings (read-only)", rows.len() - MAX_ROWS)),
        (false, 0) => None,
        (false, n) => Some(format!("{n} more in issued meetings (read-only)")),
    };
    if let Some(f) = foot {
        ui.c.text(&f, Rect::new(area.x, area.bottom() - FOOT_H, area.w, FOOT_H), &TextStyle::caption().color(palette::TEXT_FAINT));
    }

    if let Some((note_id, rf, d)) = done {
        let body = st.helper.snap.notes.iter().find(|n| n.id == note_id).and_then(|n| helper::decide(n, &rf, d));
        if let Some(b) = body {
            st.cmd(Command::HelperPost(b));
        }
    }
}
