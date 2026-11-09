//! Live page (board I02): what the helper is hearing now. The previous line
//! dim, the current line large, its translation under it in the person's
//! colour (Settings), and Hold / Unfollow beside the title.
//!
//! The line comes from the engine's `GET /live` (the last line it heard, while
//! it is fresh), else from the tail of the newest note's `transcript[]`
//! (`poni_core::helper`). Hold (was Pause) keeps the page on the line it shows; Unfollow (was Stop)
//! leaves the note alone and stops following until Start. Neither controls
//! capture, so the labels and a line on the page say "this view". Capture has
//! two sources: the Chrome extension and the Mac app, and (Windows) the
//! island's own "Start captions", a loopback capture of what the PC plays
//! (`services::capture`), whose state and problems show on this page.
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
use poni_core::models::Kind;

const HEAD_H: f32 = 34.0;
const HEIGHT: f32 = 168.0;

pub fn height(_st: &AppState) -> f32 {
    HEIGHT
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let state = st.helper.live_state();
    match state {
        PageState::Error => {
            hkit::offline(ui, st, area, wid("live.retry"));
        }
        PageState::Empty => empty(ui, st, area),
        _ => lines(ui, st, area, state),
    }
}

/// What the button of the empty page does.
enum Go {
    Captions(bool),
    Follow,
    Download,
}

/// Nothing to show yet: say what to do, or what the capture is doing.
fn empty(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let running = st.capture.running();
    let problem = st.capture.problem().map(str::to_string);
    // (title, line, bad, button label, what it does)
    let (title, line, bad, label, go) = if !st.helper.following {
        ("Unfollowed", "The island left the meeting alone. Follow shows the newest line again.".to_string(), false, Some("Follow"), Go::Follow)
    } else if st.capture.needs_model() {
        // The first caption would otherwise start a download nobody asked for.
        if st.models.due(st.now) {
            st.cmd(Command::ModelsRefresh);
        }
        let d = st.models.describe(Kind::Asr);
        let busy = st.models.pulling.is_some();
        let line = if busy || st.models.failed.is_some() { d.text } else { "Captions need a speech model on this PC, and it is not downloaded yet. It downloads once and stays.".to_string() };
        let label = (!busy).then_some(if st.models.failed.is_some() { "Retry" } else { "Download speech model" });
        ("Speech model needed", line, st.models.failed.is_some(), label, Go::Download)
    } else if let Some(why) = problem {
        let label = if running { "Stop captions" } else { "Try again" };
        ("Captions need attention", why, true, Some(label), Go::Captions(!running))
    } else if running {
        ("Listening to this PC", "Play a video or join a meeting. Its captions show up here and in the island.".to_string(), false, Some("Stop captions"), Go::Captions(false))
    } else {
        ("Nothing to follow", "Start captions to caption whatever this PC plays, or record in the extension or the Mac app.".to_string(), false, Some("Start captions"), Go::Captions(true))
    };
    if hkit::message(ui, area, st.accent, Icon::Lyrics, title, &line, bad, label.map(|l| (l, wid("live.start")))) {
        match go {
            Go::Captions(on) => st.cmd(Command::Captions(on)),
            Go::Follow => st.helper.set_following(true),
            Go::Download => st.cmd(Command::ModelPull(Kind::Asr)),
        }
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
        let on = st.capture.running();
        let label = if on { "Stop captions" } else { "Start captions" };
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("live.captions"), b, label, None, if on { PillStyle::Neutral } else { PillStyle::Primary(st.accent) }).clicked {
            st.cmd(Command::Captions(!on));
        }
        right = b.x - PILL_GAP;
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
    // Hold and Unfollow act on this view only. Start captions is the island's own capture of what
    // the PC plays; recordings in the extension or the Mac app are theirs. A capture problem
    // is said here, never silently.
    if !locked {
        let (note, tone) = match st.capture.problem() {
            Some(why) => (why, palette::ORANGE),
            None if st.capture.running() => ("Captioning what this PC plays. Hold and Unfollow change this view.", palette::TEXT_FAINT),
            None => ("Hold and Unfollow change this view. Start captions listens to what this PC plays.", palette::TEXT_FAINT),
        };
        ui.c.text(note, Rect::new(area.x, area.bottom() - 14.0, (area.w - 70.0).max(0.0), 14.0), &TextStyle::caption().color(tone));
    }
    if total > 0 {
        let n = st.helper.frozen.map_or(total, |i| i + 1);
        let count = format!("{n} / {total}");
        let w = ui.c.measure(&count, &TextStyle::caption(), 200.0).0.ceil();
        ui.c.text(&count, Rect::new(area.right() - w, area.bottom() - 14.0, w, 14.0), &TextStyle::caption().color(palette::TEXT_FAINT).right());
    }
}
