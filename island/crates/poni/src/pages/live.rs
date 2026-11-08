//! Live page (board I02): what the helper is hearing now. The previous line
//! dim, the current line large, its translation under it in the person's
//! colour (Settings), and Hold / Unfollow beside the title.
//!
//! The line comes from the engine's `GET /live` (the last line it heard, while
//! it is fresh), else from the tail of the newest note's `transcript[]`
//! (`poni_core::helper`). Hold (was Pause) keeps the page on the line it shows; Unfollow (was Stop)
//! leaves the note alone and stops following until Start. Neither controls
//! capture: it lives in the Chrome extension and the Mac app, and the helper
//! has no capture route (ISL-002 gap), so the labels and a line on the page
//! say "this view".
//! The five states are `PageState`: normal, empty (nothing to follow, or
//! stopped), error (helper offline), locked (an issued meeting) and needs
//! input (items wait on a person; a pill opens the Meeting page).

use super::hkit;
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::state::AppState;
use crate::ui::{wid, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Rect};
use poni_core::helper::PageState;

const HEAD_H: f32 = 34.0;
const HEIGHT: f32 = 168.0;

pub fn height(_st: &AppState) -> f32 {
    HEIGHT
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let accent = st.accent;
    let state = st.helper.live_state();
    match state {
        PageState::Error => {
            let line = hkit::offline_line(&st.helper.link);
            if hkit::message(ui, area, accent, Icon::Unlink, "Helper offline", &line, true, Some(("Try again", wid("live.retry")))) {
                st.cmd(Command::HelperPoll);
            }
        }
        PageState::Empty => {
            let (title, line) = if st.helper.following {
                ("Nothing to follow", "Start a recording in the extension or the Mac app. The newest line shows up here.")
            } else {
                ("Unfollowed", "The island left the meeting alone. Follow shows the newest line again.")
            };
            let button = if st.helper.following { None } else { Some(("Follow", wid("live.start"))) };
            if hkit::message(ui, area, accent, Icon::Lyrics, title, line, false, button) {
                st.helper.set_following(true);
            }
        }
        _ => lines(ui, st, area, state),
    }
}

fn lines(ui: &mut Ui, st: &mut AppState, area: Rect, state: PageState) {
    let locked = state == PageState::Locked;
    // No note yet (a meeting is saved when it ends): the engine's line stands alone.
    let (title, waiting, total) = match st.helper.note() {
        Some(n) => (n.title.clone(), n.waiting(), n.transcript.len()),
        None => ("Live from the engine".to_string(), 0, 0),
    };
    let paused = st.helper.paused();
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;

    // Right to left: Unfollow, Hold, then the "waiting" pill.
    let mut right = head.right();
    if !locked {
        let w = ui.pill_width("Unfollow", false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("live.stop"), b, "Unfollow", None, PillStyle::Utility).clicked {
            st.helper.set_following(false);
        }
        right = b.x - PILL_GAP;
        let label = if paused { "Release" } else { "Hold" };
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("live.pause"), b, label, None, PillStyle::Neutral).clicked {
            st.helper.toggle_pause();
        }
        right = b.x - PILL_GAP;
    }
    if state == PageState::Needs {
        let label = format!("{waiting} wait on you");
        let w = ui.pill_width(&label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("live.needs"), b, &label, None, PillStyle::Primary(palette::ORANGE)).clicked {
            st.cmd(Command::SetPage(PageKind::Meeting));
        }
        right = b.x - PILL_GAP;
    }
    let tag = if locked {
        "Issued \u{b7} read-only"
    } else if paused {
        "Held"
    } else {
        "Following"
    };
    let dot = if locked { palette::TEXT_FAINT } else if paused { palette::ORANGE } else { palette::GREEN };
    ui.c.fill_circle(poni_core::geom::Point::new(head.x + 5.0, cy), 4.0, dot);
    let w = (right - head.x - 18.0).max(0.0);
    let caption = format!("{tag}  {title}");
    ui.c.text(&caption, Rect::new(head.x + 16.0, cy - 10.0, w, 20.0), &TextStyle::footnote().weight(Weight::Semibold).color(palette::TEXT_DIM));

    let cap = st.helper.captions();
    let color = hkit::translation_color(ui, st.settings.translation_color);
    let mut y = head.bottom() + 6.0;
    if !cap.previous.is_empty() {
        ui.c.text(&cap.previous, Rect::new(area.x, y, area.w, 18.0), &TextStyle::footnote().color(palette::TEXT_FAINT));
    }
    y += 22.0;
    let now_st = TextStyle::headline().color(if locked { palette::TEXT_DIM } else { palette::TEXT });
    ui.c.text(&cap.current, Rect::new(area.x, y, area.w, 46.0), &now_st.wrap().top());
    y += 50.0;
    if !cap.translation.is_empty() {
        ui.c.text(&cap.translation, Rect::new(area.x, y, area.w, 40.0), &TextStyle::body().color(color).wrap().top());
    }
    // Capture runs in the Chrome extension or the Mac app, which the helper has no
    // route to control: these two buttons act on this view only, and it says so.
    if !locked {
        let note = "Hold and Unfollow change this view. Recording runs in the extension.";
        ui.c.text(note, Rect::new(area.x, area.bottom() - 14.0, (area.w - 70.0).max(0.0), 14.0), &TextStyle::caption().color(palette::TEXT_FAINT));
    }
    if total > 0 {
        let n = st.helper.frozen.map_or(total, |i| i + 1);
        let count = format!("{n} / {total}");
        let w = ui.c.measure(&count, &TextStyle::caption(), 200.0).0.ceil();
        ui.c.text(&count, Rect::new(area.right() - w, area.bottom() - 14.0, w, 14.0), &TextStyle::caption().color(palette::TEXT_FAINT).right());
    }
}
