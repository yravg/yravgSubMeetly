//! PMM-023: every saved record in one list. Minutes opens on it (filter chips with counts, then one
//! row per record: source chip, title, when, Open), and Live, Meeting and Media each show their own
//! History, the same rows narrowed to their records. One store: the engine's notes
//! (`st.helper.snap.notes`); the filtering is `poni_core::records`.

use super::hkit;
use super::meeting::{FOOT_H, HEAD_H, MAX_ROWS, ROW_H};
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Color, Rect};
use poni_core::records::{self, Filter, Source};

/// The filter a tab's History shows (None: the page has no History).
pub fn history_filter(p: PageKind) -> Option<Filter> {
    match p {
        PageKind::Live => Some(Filter::Live),
        PageKind::Call => Some(Filter::Meeting),
        PageKind::Media => Some(Filter::Media),
        _ => None,
    }
}

/// `p` shows its History instead of its page.
pub fn history_shows(st: &AppState, p: PageKind) -> bool {
    st.records.history == Some(p) && history_filter(p).is_some()
}

/// A History is Minutes' list without its guide row.
pub fn history_height() -> f32 {
    HEAD_H + 4.0 + MAX_ROWS as f32 * ROW_H + FOOT_H
}

fn source_color(s: Source, accent: Color) -> Color {
    match s {
        Source::Meeting => accent,
        Source::Room => palette::GREEN,
        Source::Media => palette::ORANGE,
        Source::Pasted => palette::PURPLE,
    }
}

/// Minutes' list of every record, under its guide row: the filter chips, the rows, and the pages.
/// `area` is what the guide left.
pub fn draw_list(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let accent = st.accent;
    let notes = st.helper.snap.notes.clone();
    let counts = records::counts(&notes);
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;
    let mut x = head.x;
    for (i, f) in Filter::ALL.into_iter().enumerate() {
        let label = format!("{} {}", f.label(), counts[i]);
        let w = ui.pill_width(&label, false, true);
        let style = if st.records.filter == f { PillStyle::Primary(accent) } else { PillStyle::Utility };
        if ui.pill(wid_n("records.filter", i as u64), Rect::new(x, cy - PILL_SMALL / 2.0, w, PILL_SMALL), &label, None, style).clicked {
            st.records.filter = f;
            st.records.page = 0;
        }
        x += w + PILL_GAP;
    }
    // The full Minutes app (its own window), when the chips leave room for it.
    let w = ui.pill_width(super::meeting::OPEN_APP, false, true);
    if x + PILL_GAP + w <= head.right() {
        let b = Rect::new(head.right() - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("records.open_app"), b, super::meeting::OPEN_APP, None, PillStyle::Utility).clicked {
            st.cmd(Command::Menu(crate::tray::MenuCmd::OpenMinutes));
        }
    }
    let rows = records::filtered(&notes, st.records.filter);
    let foot = Rect::new(area.x, area.bottom() - FOOT_H, area.w, FOOT_H);
    let rest = Rect::new(area.x, head.bottom() + 4.0, area.w, MAX_ROWS as f32 * ROW_H);
    let hint = format!("{} of {}", rows.len(), notes.len());
    foot_and_rows(ui, st, rows, rest, foot, "records.list", &hint, "No records in this filter", "Press All to see every saved record.");
}

/// A tab's own History in place of its page: a header with a way back, the tab's records, pages.
pub fn draw_history(ui: &mut Ui, st: &mut AppState, area: Rect, page: PageKind) {
    let Some(f) = history_filter(page) else { return };
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;
    let back = format!("Back to {}", page.title().to_lowercase());
    let w = ui.pill_width(&back, false, true);
    let b = Rect::new(head.right() - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("records.back"), b, &back, None, PillStyle::Neutral).clicked {
        st.records.history = None;
    }
    let title = format!("History \u{b7} {}", f.label());
    ui.c.text(&title, Rect::new(head.x, cy - 11.0, (b.x - head.x - 10.0).max(0.0), 22.0), &TextStyle::headline());
    let notes = st.helper.snap.notes.clone();
    let rows = records::filtered(&notes, f);
    let foot = Rect::new(area.x, area.bottom() - FOOT_H, area.w, FOOT_H);
    let rest = Rect::new(area.x, head.bottom() + 4.0, area.w, MAX_ROWS as f32 * ROW_H);
    let (title, line) = match f {
        Filter::Live => ("Nothing kept from Live yet", "Stop captions with the room heard and the session is saved here."),
        Filter::Media => ("No video transcripts yet", "Captions of a video are kept here when they stop."),
        _ => ("No meetings saved yet", "Captions of a meeting are saved here when they stop."),
    };
    let hint = format!("{} saved", rows.len());
    foot_and_rows(ui, st, rows, rest, foot, "records.history", &hint, title, line);
}

/// The rows of one page in `rest`, and the foot: a count on the left, the pager and Paste on the right.
#[allow(clippy::too_many_arguments)]
fn foot_and_rows(ui: &mut Ui, st: &mut AppState, rows: Vec<&poni_core::helper::Note>, rest: Rect, foot: Rect, id: &str, hint: &str, none_title: &str, none_line: &str) {
    let accent = st.accent;
    let fy = foot.center().y;
    let pages = hkit::pages(rows.len(), MAX_ROWS);
    st.records.page = st.records.page.min(pages - 1);
    let mut right = foot.right();
    if pages > 1 {
        let (step, x) = hkit::pager(ui, right, fy, id, st.records.page + 1, pages, "Page");
        if let Some(d) = step {
            st.records.page = (st.records.page as i32 + d).clamp(0, pages as i32 - 1) as usize;
        }
        right = x - PILL_GAP * 2.0;
    }
    let w = ui.pill_width("Paste transcript", false, true);
    let b = Rect::new(right - w, fy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid(&format!("{id}.paste")), b, "Paste transcript", None, PillStyle::Utility).clicked {
        st.cmd(Command::PasteTranscript);
    }
    // What a press just did (a paste being drafted, a save) outranks the count.
    let toast = st.helper_notice.as_ref().filter(|(_, until, _)| *until > ui.now).map(|(m, _, bad)| (m.clone(), *bad));
    let (said, tone) = match toast {
        Some((m, bad)) => (m, if bad { palette::ORANGE } else { palette::GREEN }),
        None => (hint.to_string(), palette::TEXT_DIM),
    };
    ui.c.text(&said, Rect::new(foot.x, fy - 9.0, (b.x - foot.x - 10.0).max(0.0), 18.0), &TextStyle::footnote().weight(Weight::Semibold).color(tone));

    if rows.is_empty() {
        hkit::message(ui, rest, accent, Icon::Clipboard, none_title, none_line, false, None);
        return;
    }
    let today = st.day_key();
    let mut open: Option<String> = None;
    let mut save: Option<String> = None;
    for (slot, n) in rows.iter().skip(st.records.page * MAX_ROWS).take(MAX_ROWS).enumerate() {
        let row = Rect::new(rest.x, rest.y + slot as f32 * ROW_H, rest.w, ROW_H);
        let rcy = row.center().y;
        let source = records::source_of(&n.raw);
        // Right to left: the button, then when it was.
        let (label, tone) = if source == Source::Media { ("Save as meeting", PillStyle::Primary(accent)) } else { ("Open", PillStyle::Utility) };
        let bw = ui.pill_width(label, false, true);
        let bb = Rect::new(row.right() - bw, rcy - PILL_SMALL / 2.0, bw, PILL_SMALL);
        if ui.pill(wid_n(&format!("{id}.act"), slot as u64), bb, label, None, tone).clicked {
            if source == Source::Media {
                save = Some(n.id.clone());
            } else {
                open = Some(n.id.clone());
            }
        }
        // The rest of the row opens the record too.
        let body = Rect::new(row.x, row.y, (bb.x - PILL_GAP - row.x).max(0.0), row.h);
        let resp = ui.button(wid_n(&format!("{id}.row"), slot as u64), body);
        if resp.hovered {
            ui.c.fill_rrect(body, 8.0, palette::SURFACE);
        }
        if resp.clicked {
            open = Some(n.id.clone());
        }
        let when = records::when(n, &today);
        let wst = TextStyle::footnote().color(palette::TEXT_DIM).right();
        let ww = ui.c.measure(&when, &wst, 200.0).0.ceil();
        ui.c.text(&when, Rect::new(body.right() - ww - 4.0, rcy - 9.0, ww, 18.0), &wst);
        let chip = hkit::chip(ui, row.x + 4.0, rcy, &records::chip(&n.raw), source_color(source, accent));
        let tx = row.x + 4.0 + chip.max(CHIP_COL) + 8.0;
        let tst = TextStyle::body().weight(Weight::Regular);
        ui.c.text(&n.title, Rect::new(tx, rcy - 10.0, (body.right() - ww - 12.0 - tx).max(0.0), 20.0), &tst);
    }
    if let Some(id) = save {
        st.cmd(Command::SaveAsMeeting(id));
    }
    if let Some(id) = open {
        st.show_record(&id);
        st.records.history = None;
        st.cmd(Command::SetPage(PageKind::Meeting));
    }
}

/// Titles start in one column when the chips are shorter than this.
const CHIP_COL: f32 = 118.0;
