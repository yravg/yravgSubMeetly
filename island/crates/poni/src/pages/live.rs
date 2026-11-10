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
//! "Aa" (every state) shows the quick caption strip at the bottom
//! (`pill::quick_captions`, PMM-011): the page grows by its height.

use super::hkit;
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::pill::quick_captions;
use crate::state::AppState;
use crate::ui::{wid, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Color, Rect};
use poni_core::helper::{Captions, PageState};
use poni_core::capture::TranslateHint;
use poni_core::models::Kind;

const HEAD_H: f32 = 34.0;
const HEIGHT: f32 = 168.0;

pub fn height(st: &AppState) -> f32 {
    HEIGHT + hkit::GUIDE_H + quick_captions::extra_height(st)
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let area = hkit::guide(ui, st, area, PageKind::Live, "Live captions of the meeting now, line by line.");
    let (area, strip) = quick_captions::split(st, area);
    let state = st.helper.live_state();
    match state {
        PageState::Error => {
            hkit::offline(ui, st, area, wid("live.retry"));
        }
        PageState::Empty => empty(ui, st, area),
        _ => lines(ui, st, area, state),
    }
    // The header row has "Aa"; the other states put it in the top right corner.
    if matches!(state, PageState::Error | PageState::Empty) {
        quick_captions::aa_button(ui, st, area.right(), area.y + PILL_SMALL / 2.0);
    }
    if let Some(r) = strip {
        quick_captions::strip(ui, st, r, area);
    }
}

/// What the button of the empty page does.
enum Go {
    Captions(bool),
    Follow,
    Download(Kind),
}

/// Nothing to show yet: say what to do, or what the capture is doing.
fn empty(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let running = st.capture.running();
    let problem = st.capture.problem().map(str::to_string);
    // (title, line, bad, button label, what it does)
    let (title, line, bad, label, go) = if !st.helper.following {
        ("Unfollowed", "The island left the meeting alone. Follow shows the newest line again.".to_string(), false, Some("Follow"), Go::Follow)
    } else if st.capture.needs_model() {
        // The engine downloads nothing by itself: the person presses Download.
        if st.models.due(st.now) {
            st.cmd(Command::ModelsRefresh);
        }
        let d = st.models.describe(Kind::Asr);
        let busy = st.models.pulling.is_some();
        let what = "Captions need a speech model on this PC, and it is not downloaded yet.";
        let line = if busy || st.models.failed.is_some() { d.text } else { format!("{what} It downloads once and stays.") };
        let label = (!busy).then_some(if st.models.failed.is_some() { "Retry" } else { "Download speech model" });
        ("Speech model needed", line, st.models.failed.is_some(), label, Go::Download(Kind::Asr))
    } else if let Some(why) = problem {
        let label = if running { "Stop captions" } else { "Try again" };
        ("Captions need attention", why, true, Some(label), Go::Captions(!running))
    } else if running {
        ("Listening to this PC", "Play a video or join a meeting. Its captions show up here and in the island, and are saved when you stop: a meeting as a meeting, a video as a transcript.".to_string(), false, Some("Stop captions"), Go::Captions(false))
    } else {
        ("Nothing to follow", "Start captions to caption whatever this PC plays: videos, Teams, Zoom. They also start by themselves when a video or a calendar meeting begins.".to_string(), false, Some("Start captions"), Go::Captions(true))
    };
    if hkit::message(ui, area, st.accent, Icon::Lyrics, title, &line, bad, label.map(|l| (l, wid("live.start")))) {
        match go {
            Go::Captions(on) => st.cmd(Command::Captions(on)),
            Go::Follow => st.helper.set_following(true),
            Go::Download(k) => st.cmd(Command::ModelPull(k)),
        }
    }
}

/// Under the source line, while the caption has no translation yet: a note that is not a stop.
/// Missing offers Download (a press is the only thing that starts one); Loading is only said.
fn translation_hint(ui: &mut Ui, st: &mut AppState, area: Rect, y: f32, hint: TranslateHint) {
    let style = TextStyle::caption().color(palette::TEXT_DIM);
    let row = Rect::new(area.x, y, area.w, 18.0);
    let (text, button) = match hint {
        TranslateHint::Loading => ("Loading the translation model\u{2026}".to_string(), None),
        TranslateHint::NotDownloaded => {
            if st.models.due(st.now) {
                st.cmd(Command::ModelsRefresh);
            }
            let (busy, failed) = (st.models.pulling.is_some(), st.models.failed.is_some());
            if busy || failed {
                (st.models.describe(Kind::Translate).text, (!busy).then_some("Retry"))
            } else {
                ("Translation model not downloaded".to_string(), Some("Download"))
            }
        }
    };
    let w = ui.c.measure(&text, &style, row.w).0.ceil();
    ui.c.text(&text, row, &style);
    if let Some(label) = button {
        let pw = ui.pill_width(label, false, true);
        let b = Rect::new(row.x + w + 10.0, row.center().y - PILL_SMALL / 2.0, pw, PILL_SMALL);
        if ui.pill(wid("live.translation.download"), b, label, None, PillStyle::Neutral).clicked {
            st.cmd(Command::ModelPull(Kind::Translate));
        }
    }
}

/// The previous line dim, the current line large in `now`, its translation under it in the
/// person's colour, from `y` in a column `w` wide (Live, and the Media page's caption column).
/// Returns where the translation goes.
pub(crate) fn caption_lines(ui: &mut Ui, st: &AppState, cap: &Captions, x: f32, mut y: f32, w: f32, now: Color) -> f32 {
    if !cap.previous.is_empty() {
        ui.c.text(&cap.previous, Rect::new(x, y, w, 18.0), &TextStyle::footnote().color(palette::TEXT_FAINT));
    }
    y += 22.0;
    ui.c.text(&cap.current, Rect::new(x, y, w, 46.0), &TextStyle::headline().color(now).wrap().top());
    y += 50.0;
    if !cap.translation.is_empty() {
        let color = hkit::translation_color(ui, st.settings.translation_color);
        ui.c.text(&cap.translation, Rect::new(x, y, w, 40.0), &TextStyle::body().color(color).wrap().top());
    }
    y
}

fn lines(ui: &mut Ui, st: &mut AppState, area: Rect, state: PageState) {
    let locked = state == PageState::Locked;
    // No note yet (a meeting is saved when it ends): the engine's line stands alone.
    // The engine's fresh line wins over a saved meeting: a new session is not that meeting.
    let note = st.helper.note().filter(|_| !st.helper.on_live_line());
    let (title, waiting, total) = match note {
        Some(n) => (n.title.clone(), n.waiting(), n.transcript.len()),
        None => ("Live from the engine".to_string(), 0, 0),
    };
    let paused = st.helper.paused();
    let head = Rect::new(area.x, area.y, area.w, HEAD_H);
    let cy = head.center().y;

    // Right to left: Stop captions, Unfollow, Hold, Aa, then the "waiting" pill.
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
    right = quick_captions::aa_button(ui, st, right, cy) - PILL_GAP;
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
    let y = caption_lines(ui, st, &cap, area.x, head.bottom() + 6.0, area.w, if locked { palette::TEXT_DIM } else { palette::TEXT });
    if let Some(h) = st.caption_hint.filter(|_| cap.translation.is_empty() && !locked && st.capture.running()) {
        translation_hint(ui, st, area, y, h);
    }
    // Hold and Unfollow act on this view only. Start captions is the island's own capture of what
    // the PC plays; recordings in the extension or the Mac app are theirs. A capture problem
    // is said here, never silently.
    if !locked {
        let (note, tone) = match st.capture.problem() {
            Some(why) => (why, palette::ORANGE),
            None if st.capture.running() => ("Saved when you stop: a meeting as a meeting, a video as a transcript.", palette::TEXT_FAINT),
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
