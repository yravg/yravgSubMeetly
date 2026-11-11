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

pub(super) const HEAD_H: f32 = 30.0;
pub(super) const ROW_H: f32 = 36.0;
pub const MAX_ROWS: usize = 5;
pub(super) const FOOT_H: f32 = 28.0;

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
    let purpose = if st.records.list { "Every saved record: meetings, live sessions, video transcripts and pastes." } else { "Decisions, actions and questions of any meeting. Paste reads a copied transcript." };
    let area = hkit::guide(ui, st, area, PageKind::Meeting, purpose);
    let accent = st.accent;
    let state = helper::note_state(&st.helper.link, st.helper.note());
    if state == PageState::Error {
        hkit::offline(ui, st, area, wid("meeting.retry"));
        return;
    }
    // Minutes opens on every record (PMM-023); a press opens one in the register below.
    if st.records.list && !st.helper.snap.notes.is_empty() {
        super::records::draw_list(ui, st, area);
        return;
    }
    let Some(note) = st.helper.note().cloned() else {
        let line = "Captions save a meeting when they stop. Or copy a transcript (Teams, read.ai, .vtt) and press Paste transcript.";
        if hkit::message(ui, area, accent, Icon::Clipboard, "No meetings yet", line, false, Some(("Paste transcript", wid("meeting.paste.empty")))) {
            st.cmd(Command::PasteTranscript);
        }
        return;
    };
    let locked = state == PageState::Locked;
    let waiting = note.waiting();
    // A media session kept as a transcript (PMM-015): tagged "Video", one press makes it a meeting.
    let transcript = poni_core::meeting_doc::is_transcript(&note.raw);

    // Head: the meeting's title, and which of all meetings it is.
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;
    let (at, of) = st.helper.position();
    let (step, px) = hkit::pager(ui, head.right(), cy, "meeting.pick", at, of, "Meeting");
    if let Some(d) = step {
        st.helper.select_step(d);
        st.meeting_page = 0;
    }
    let title = if note.date.is_empty() { note.title.clone() } else { format!("{} \u{b7} {}", note.title, note.date) };
    // A meeting held in the room around the laptop (Live, PMM-020): tagged "In-room".
    let tag = if transcript { Some("Video") } else { poni_core::meeting_doc::is_in_room(&note.raw).then_some("In-room") };
    let tx = tag.map_or(head.x, |t| head.x + hkit::chip(ui, head.x, cy, t, accent) + 8.0);
    ui.c.text(&title, Rect::new(tx, cy - 11.0, (px - tx - 10.0).max(0.0), 22.0), &TextStyle::headline());

    // Foot: what the meeting waits on (or the last press), Paste, and the item pages.
    let foot = Rect::new(area.x, area.bottom() - FOOT_H, area.w, FOOT_H);
    let fy = foot.center().y;
    let per = MAX_ROWS;
    let pages = hkit::pages(note.items.len(), per);
    st.meeting_page = st.meeting_page.min(pages - 1);
    let mut right = foot.right();
    if pages > 1 {
        let (step, x) = hkit::pager(ui, right, fy, "meeting.items", st.meeting_page + 1, pages, "Items");
        if let Some(d) = step {
            st.meeting_page = (st.meeting_page as i32 + d).clamp(0, pages as i32 - 1) as usize;
        }
        right = x - PILL_GAP * 2.0;
    }
    let w = ui.pill_width("Paste transcript", false, true);
    let b = Rect::new(right - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("meeting.paste"), b, "Paste transcript", None, PillStyle::Utility).clicked {
        st.cmd(Command::PasteTranscript);
    }
    let b = if transcript {
        let w = ui.pill_width("Save as meeting", false, true);
        let s = Rect::new(b.x - PILL_GAP - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("meeting.save_as_meeting"), s, "Save as meeting", None, PillStyle::Primary(accent)).clicked {
            st.cmd(Command::SaveAsMeeting(note.id.clone()));
        }
        s
    } else {
        b
    };
    // Back to the list of every record.
    let w = ui.pill_width("All records", false, true);
    let all = Rect::new(b.x - PILL_GAP - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("meeting.records"), all, "All records", None, PillStyle::Utility).clicked {
        st.records.list = true;
        st.records.page = 0;
    }
    let b = all;
    let toast = st.helper_notice.as_ref().filter(|(_, until, _)| *until > ui.now).map(|(m, _, bad)| (m.clone(), *bad));
    let status = match (&toast, locked, waiting) {
        (Some((t, _)), _, _) => t.clone(),
        (None, true, _) => "Issued \u{b7} read-only".into(),
        (None, false, 0) => "All settled".into(),
        (None, false, n) => format!("{n} wait on you"),
    };
    let tone = if let Some((_, bad)) = &toast { if *bad { palette::ORANGE } else { palette::GREEN } } else if waiting > 0 && !locked { palette::ORANGE } else { palette::TEXT_DIM };
    ui.c.text(&status, Rect::new(foot.x, fy - 9.0, (b.x - foot.x - 10.0).max(0.0), 18.0), &TextStyle::footnote().weight(Weight::Semibold).color(tone));

    if note.items.is_empty() {
        let body = Rect::new(area.x, head.bottom(), area.w, foot.y - head.bottom());
        let n = note.transcript.len();
        let line = if n > 0 {
            format!("{n} transcript lines. No decisions or actions found in them.")
        } else {
            "Nothing here yet. Start captions during the meeting, or copy its transcript and press Paste transcript.".to_string()
        };
        hkit::message(ui, body, accent, Icon::Clipboard, "No items", &line, false, None);
        return;
    }

    // Waiting items first, then the rest, in the register's order.
    let mut order: Vec<usize> = (0..note.items.len()).collect();
    order.sort_by_key(|&i| !note.items[i].waits());
    let mut done: Option<(String, Decision)> = None;
    for (slot, &idx) in order.iter().skip(st.meeting_page * per).take(per).enumerate() {
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
