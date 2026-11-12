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
/// The button that opens the full Minutes app (its own window, not the pill).
pub(super) const OPEN_APP: &str = "Open Minutes app";
/// From this page width the transcript sits beside the items; narrower, it takes their place.
const SPLIT_FROM_W: f32 = 760.0;
/// The pill widens to this while a record's transcript is open, so it sits beside the items.
pub(super) const SPLIT_PILL_W: f32 = 860.0;

/// Minutes shows one record with its transcript open (the pill then widens to [`SPLIT_PILL_W`]).
pub fn transcript_open(st: &AppState) -> bool {
    st.records.transcript && !(st.records.list && !st.helper.snap.notes.is_empty()) && st.helper.note().is_some_and(|n| !n.transcript.is_empty())
}

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
        st.records.transcript_scroll = 0.0;
    }
    // The full Minutes app in its own window, and the transcript beside the items.
    let w = ui.pill_width(OPEN_APP, false, true);
    let b = Rect::new(px - PILL_GAP * 2.0 - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("meeting.open_app"), b, OPEN_APP, None, PillStyle::Utility).clicked {
        st.cmd(Command::Menu(crate::tray::MenuCmd::OpenMinutes));
    }
    let mut px = b.x;
    let lines = note.transcript.len();
    let show_tx = st.records.transcript && lines > 0;
    if lines > 0 {
        let label = format!("Transcript {lines}");
        let w = ui.pill_width(&label, false, true);
        let b = Rect::new(px - PILL_GAP - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        let style = if show_tx { PillStyle::Primary(accent) } else { PillStyle::Utility };
        if ui.pill(wid("meeting.transcript"), b, &label, None, style).clicked {
            st.records.transcript = !st.records.transcript;
        }
        px = b.x;
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
    // Export the meeting: PDF and Word, written by the engine into Documents (skipped when the foot is tight),
    // and the transcript as a CSV file in Downloads (Excel opens it; only when there are lines).
    let mut b = all;
    if foot.w >= 520.0 {
        for (label, fmt, id) in [("Word", "docx", "meeting.export.docx"), ("PDF", "pdf", "meeting.export.pdf")] {
            let w = ui.pill_width(label, false, true);
            let r = Rect::new(b.x - PILL_GAP - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
            if ui.pill(wid(id), r, label, None, PillStyle::Utility).clicked {
                st.cmd(Command::ExportNote(note.id.clone(), fmt));
            }
            b = r;
        }
    }
    if !note.transcript.is_empty() {
        let w = ui.pill_width("Export CSV", false, true);
        let c = Rect::new(b.x - PILL_GAP - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("meeting.csv"), c, "Export CSV", None, PillStyle::Utility).clicked {
            st.cmd(Command::ExportCsv(note.id.clone()));
        }
        b = c;
    }
    let toast = st.helper_notice.as_ref().filter(|(_, until, _)| *until > ui.now).map(|(m, _, bad)| (m.clone(), *bad));
    let status = match (&toast, locked, waiting) {
        (Some((t, _)), _, _) => t.clone(),
        (None, true, _) => "Issued \u{b7} read-only".into(),
        (None, false, 0) => "All settled".into(),
        (None, false, n) => format!("{n} wait on you"),
    };
    let tone = if let Some((_, bad)) = &toast { if *bad { palette::ORANGE } else { palette::GREEN } } else if waiting > 0 && !locked { palette::ORANGE } else { palette::TEXT_DIM };
    ui.c.text(&status, Rect::new(foot.x, fy - 9.0, (b.x - foot.x - 10.0).max(0.0), 18.0), &TextStyle::footnote().weight(Weight::Semibold).color(tone));

    // The transcript beside the items when the page is wide, in their place when it is narrow.
    let body = Rect::new(area.x, head.bottom() + 4.0, area.w, (foot.y - head.bottom() - 8.0).max(0.0));
    let area = if show_tx {
        if area.w >= SPLIT_FROM_W {
            let tw = (body.w * 0.48).floor();
            draw_transcript(ui, st, &note, Rect::new(body.x, body.y, tw, body.h));
            ui.c.fill_rect(Rect::new(body.x + tw + 8.0, body.y, 1.0, body.h), palette::TRACK);
            Rect::new(body.x + tw + 17.0, area.y, (body.w - tw - 17.0).max(0.0), area.h)
        } else {
            draw_transcript(ui, st, &note, body);
            return;
        }
    } else {
        area
    };

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

/// "m:ss" (or "h:mm:ss") from the start of the recording.
pub fn stamp(secs: f64) -> String {
    let s = if secs.is_finite() { secs.max(0.0) as u64 } else { 0 };
    let (h, m, s) = (s / 3600, (s / 60) % 60, s % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

/// The row over the transcript: translate it again into another language (to share it with people
/// who read that one), or how far that has come. Returns what is left under it.
fn translate_bar(ui: &mut Ui, st: &mut AppState, note: &helper::Note, r: Rect) -> Rect {
    const BAR_H: f32 = 28.0;
    let bar = Rect::new(r.x, r.y, r.w, BAR_H);
    let cy = bar.center().y;
    let accent = st.accent;
    let dim = TextStyle::footnote().color(palette::TEXT_DIM);
    if st.records.translate_to.is_empty() {
        st.records.translate_to = st.settings.target_lang.clone();
    }
    let running = st.records.job.as_ref().filter(|j| j.id == note.id).cloned();
    let mut right = bar.right();
    if let Some(j) = running {
        let w = ui.pill_width("Stop", false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("meeting.translate.stop"), b, "Stop", None, PillStyle::Neutral).clicked {
            st.records.job = None;
            st.cmd(Command::RetranslateStop);
        }
        right = b.x - PILL_GAP * 2.0;
        let line = if j.total == 0 { format!("Translating into {}\u{2026}", poni_core::capture::lang_name(&j.tgt)) } else { format!("Translating into {} \u{b7} {} / {}", poni_core::capture::lang_name(&j.tgt), j.done, j.total) };
        ui.c.text(&line, Rect::new(bar.x, cy - 9.0, (right - bar.x).max(0.0), 18.0), &dim);
        // How far, as a thin bar under the row.
        if j.total > 0 {
            let track = Rect::new(bar.x, bar.bottom() - 3.0, (bar.w - 6.0).max(0.0), 2.0);
            ui.c.fill_rrect(track, 1.0, palette::TRACK);
            ui.c.fill_rrect(Rect::new(track.x, track.y, track.w * j.done as f32 / j.total as f32, 2.0), 1.0, accent);
        }
    } else {
        let w = ui.pill_width("Translate", false, true);
        let b = Rect::new(right - 6.0 - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("meeting.translate.go"), b, "Translate", None, PillStyle::Primary(accent)).clicked {
            let tgt = st.records.translate_to.clone();
            st.records.job = Some(crate::state::TranslateJob { id: note.id.clone(), tgt: tgt.clone(), done: 0, total: note.transcript.len() });
            st.cmd(Command::Retranslate(note.id.clone(), st.settings.source_lang.clone(), tgt));
        }
        // "Into ‹ Japanese ›": steps through the app's languages.
        let x = b.x - PILL_GAP * 2.0;
        let next = ui.pill_width("\u{203a}", false, true);
        let nb = Rect::new(x - next, cy - PILL_SMALL / 2.0, next, PILL_SMALL);
        if ui.pill(wid("meeting.translate.next"), nb, "\u{203a}", None, PillStyle::Utility).clicked {
            st.records.translate_to = poni_core::capture::step_lang(&st.records.translate_to, 1, false).to_string();
        }
        let name = poni_core::capture::lang_name(&st.records.translate_to);
        let nst = TextStyle::footnote().weight(Weight::Semibold);
        let nw = ui.c.measure(&name, &nst, 160.0).0.ceil();
        let nx = nb.x - PILL_GAP - nw;
        ui.c.text(&name, Rect::new(nx, cy - 9.0, nw + 1.0, 18.0), &nst);
        let prev = ui.pill_width("\u{2039}", false, true);
        let pb = Rect::new(nx - PILL_GAP - prev, cy - PILL_SMALL / 2.0, prev, PILL_SMALL);
        if ui.pill(wid("meeting.translate.prev"), pb, "\u{2039}", None, PillStyle::Utility).clicked {
            st.records.translate_to = poni_core::capture::step_lang(&st.records.translate_to, -1, false).to_string();
        }
        let lead = if pb.x - bar.x >= 100.0 { "Translate into" } else { "Into" };
        ui.c.text(lead, Rect::new(bar.x, cy - 9.0, (pb.x - PILL_GAP - bar.x).max(0.0), 18.0), &dim);
    }
    Rect::new(r.x, r.y + BAR_H + 4.0, r.w, (r.h - BAR_H - 4.0).max(0.0))
}

/// The open record's transcript, oldest first, as the Meeting tab shows captions: each line under
/// its time and speaker, the translation under it. The wheel scrolls it.
fn draw_transcript(ui: &mut Ui, st: &mut AppState, note: &helper::Note, r: Rect) {
    if r.w <= 0.0 || r.h <= 0.0 {
        return;
    }
    let r = translate_bar(ui, st, note, r);
    let tr = hkit::translation_color(ui, st.settings.translation_color);
    // Checking the minutes wants what was said and its translation, whatever the captions print.
    let show = poni_core::capture::Show::Both;
    let meta = TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_DIM);
    let src = TextStyle::footnote().color(palette::TEXT).wrap().top();
    let tst = TextStyle::footnote().color(tr).wrap().top();
    const META_H: f32 = 16.0;
    const GAP: f32 = 8.0;
    // Each line's height first, so the wheel knows how far it can go.
    let heights: Vec<(f32, f32)> = note
        .transcript
        .iter()
        .map(|l| {
            let (main, under) = show.parts(&l.source, &l.translation);
            let sh = ui.c.measure(main, &src, r.w).1.ceil();
            let th = under.map_or(0.0, |u| ui.c.measure(u, &tst, r.w).1.ceil() + 2.0);
            (sh, th)
        })
        .collect();
    let total: f32 = heights.iter().map(|(s, t)| META_H + s + t + GAP).sum();
    let max = (total - r.h).max(0.0);
    st.records.transcript_scroll = (st.records.transcript_scroll - ui.wheel_in(r) * ROW_H).clamp(0.0, max);
    let mut y = r.y - st.records.transcript_scroll;
    ui.c.clip(r);
    for (l, (sh, th)) in note.transcript.iter().zip(heights) {
        let h = META_H + sh + th + GAP;
        if y + h >= r.y && y <= r.bottom() {
            let who = if l.speaker.is_empty() { stamp(l.t0) } else { format!("{} \u{b7} {}", stamp(l.t0), l.speaker) };
            ui.c.text(&who, Rect::new(r.x, y, r.w, META_H), &meta);
            let (main, under) = show.parts(&l.source, &l.translation);
            ui.c.text(main, Rect::new(r.x, y + META_H, r.w, sh), &src);
            if let Some(u) = under {
                ui.c.text(u, Rect::new(r.x, y + META_H + sh + 2.0, r.w, th), &tst);
            }
        }
        y += h;
        if y > r.bottom() {
            break;
        }
    }
    ui.c.unclip();
    // A scrollbar thumb while there is more than fits.
    if max > 0.0 {
        let th = (r.h * r.h / total).max(18.0);
        let ty = r.y + (r.h - th) * (st.records.transcript_scroll / max);
        ui.c.fill_rrect(Rect::new(r.right() - 3.0, ty, 3.0, th), 1.5, palette::TRACK);
    }
}

#[cfg(test)]
mod tests {
    use super::stamp;

    #[test]
    fn stamp_reads_minutes_and_hours() {
        assert_eq!(stamp(0.0), "0:00");
        assert_eq!(stamp(75.4), "1:15");
        assert_eq!(stamp(3725.0), "1:02:05");
        assert_eq!(stamp(f64::NAN), "0:00");
        assert_eq!(stamp(-3.0), "0:00");
    }
}
