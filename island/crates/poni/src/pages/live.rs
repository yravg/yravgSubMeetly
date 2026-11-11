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
//! Live is also the room around the laptop (PMM-019/020): its source row picks Room (the
//! microphone, default), This PC or Both, and while the island's captions hear the room the page
//! is the Meeting tab's view (`call::live`): captions left, "Notes so far" right, an editable
//! title and its time, with Hold and Unfollow kept. A blocked microphone says so with Windows'
//! privacy switch; Stop saves an "In-room" meeting, shown here like on the Meeting tab.

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
use poni_core::capture::{Source, TranslateHint};
use poni_core::models::Kind;

const HEAD_H: f32 = 34.0;
const HEIGHT: f32 = 168.0;
/// The source row: Room / This PC / Both and the mic chip.
pub(crate) const SOURCE_H: f32 = 26.0;

/// Live is the room's session view (the Meeting tab's layout and the source row).
fn room_view(st: &AppState) -> bool {
    st.room_live() && st.helper.following
}

/// While nothing runs (and the engine answers), the source row sits at the bottom: pick before Start.
fn picker_shown(st: &AppState, state: PageState) -> bool {
    !st.capture.running() && st.helper.following && !matches!(state, PageState::Error | PageState::Locked)
}

pub fn height(st: &AppState) -> f32 {
    if room_view(st) {
        return super::call::height(st) + SOURCE_H + 6.0 + hkit::GUIDE_H;
    }
    let row = if picker_shown(st, st.helper.live_state()) { SOURCE_H } else { 0.0 };
    HEIGHT + row + hkit::GUIDE_H + quick_captions::extra_height(st)
}

/// The mic chip's level moves and the session's clock ticks while Live hears the room.
pub fn next_wake(st: &AppState) -> Option<f64> {
    room_view(st).then_some(st.now + 0.1)
}

/// An in-room session saved in the last 10 minutes, its result not dismissed.
fn room_saved(st: &AppState) -> bool {
    st.call.saved.as_ref().is_some_and(|s| s.room && !s.dismissed && st.now - s.at < poni_core::live_notes::SAVED_S)
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let area = hkit::guide(ui, st, area, PageKind::Live, "Live captions of the meeting now, line by line.");
    let (area, strip) = quick_captions::split(st, area);
    let state = st.helper.live_state();
    if room_view(st) {
        if st.capture.mic_blocked() {
            blocked(ui, st, area);
        } else {
            super::call::live(ui, st, area, true);
        }
        if let Some(r) = strip {
            quick_captions::strip(ui, st, r, area);
        }
        return;
    }
    let full = area;
    let area = if picker_shown(st, state) {
        let (rest, row) = area.split_bottom(SOURCE_H);
        source_row(ui, st, row);
        rest
    } else {
        area
    };
    // A room session on its way to Minutes, then its result (board P08 "saved"), over today's views.
    let saving = st.call.saving.clone().filter(|s| s.3 && state != PageState::Error);
    if let Some((_, t, ..)) = saving {
        hkit::message(ui, area, st.accent, Icon::Call, &format!("Saving {t}"), "The engine drafts its minutes with the notes you kept and typed.", false, None);
    } else if room_saved(st) && st.helper.following && state != PageState::Error {
        super::call::saved(ui, st, area);
    } else {
        page(ui, st, area, state);
    }
    if let Some(r) = strip {
        quick_captions::strip(ui, st, r, full);
    }
}

/// Today's Live: offline, empty, or the lines.
fn page(ui: &mut Ui, st: &mut AppState, area: Rect, state: PageState) {
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
}

/// Windows' privacy switch keeps the microphone closed: say so, offer the switch and This PC.
/// The capture keeps trying, so allowing it starts the captions by themselves.
fn blocked(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let line = "Allow desktop apps to use the microphone in Windows Settings \u{203a} Privacy & security \u{203a} Microphone, then try again. Nothing was recorded.";
    if hkit::message(ui, area, st.accent, Icon::Lyrics, "Windows is blocking the microphone", line, true, Some(("Open Windows privacy settings", wid("live.mic.privacy")))) {
        st.cmd(Command::MicPrivacy);
    }
    let y = area.y + ((area.h - hkit::MESSAGE_H) / 2.0).max(0.0) + hkit::MESSAGE_H + 6.0;
    let w = ui.pill_width("Use This PC instead", false, true);
    if ui.pill(wid("live.mic.pc"), Rect::new(area.x + 48.0, y, w, PILL_SMALL), "Use This PC instead", None, PillStyle::Utility).clicked {
        st.cmd(Command::LiveSource(Source::Pc));
    }
    let w = ui.pill_width("Stop captions", false, true);
    if ui.pill(wid("live.captions"), Rect::new(area.right() - w, area.y, w, PILL_SMALL), "Stop captions", None, PillStyle::Neutral).clicked {
        st.cmd(Command::Captions(false));
    }
}

/// Room / This PC / Both (PMM-019) and, with the room in it, the microphone: its name and level
/// (a press picks the next of Windows' microphones), or "No access" while Windows blocks it.
pub(crate) fn source_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let source = st.live_source();
    let names: Vec<&str> = Source::ALL.iter().map(|s| s.label()).collect();
    let sel = Source::ALL.iter().position(|s| *s == source).unwrap_or(0);
    let pw = super::settings::picker_width(ui, &names);
    if let Some(i) = super::settings::picker(ui, "live.source", r.x, r.y + 1.0, r.h - 2.0, &names, sel) {
        st.cmd(Command::LiveSource(Source::ALL[i]));
    }
    if !source.room() {
        return;
    }
    let blocked = st.capture.mic_blocked();
    let name = if blocked {
        "No access".to_string()
    } else if st.settings.mic_device.is_empty() {
        "Default microphone".to_string()
    } else {
        st.mics.iter().find(|(id, _)| *id == st.settings.mic_device).map_or_else(|| "Microphone".to_string(), |(_, n)| n.clone())
    };
    let style = TextStyle::caption().weight(Weight::Semibold).color(if blocked { palette::RED } else { palette::TEXT_DIM });
    let bars_w = if st.room_live() && !blocked { 5.0 * 4.0 + 6.0 } else { 0.0 };
    let x = r.x + pw + 8.0;
    let tw = ui.c.measure(&name, &style, 220.0).0.ceil().min((r.right() - x - 20.0 - bars_w).max(0.0));
    let chip = Rect::new(x, r.y + 2.0, tw + 20.0 + bars_w, r.h - 4.0);
    let resp = ui.button(wid("live.mic"), chip);
    ui.c.fill_rrect(chip, chip.h / 2.0, if resp.hovered { palette::BORDER } else { palette::SURFACE });
    ui.c.text(&name, Rect::new(chip.x + 10.0, chip.y, tw, chip.h), &style);
    if bars_w > 0.0 {
        // RMS 0.001 (quiet room) to 0.1 (close speech) over five bars, on a log scale.
        let lit = ((st.mic_level.max(1e-4).log10() + 3.0) / 2.0 * 5.0).clamp(0.0, 5.0).round() as usize;
        for i in 0..5 {
            let h = 4.0 + i as f32 * 2.0;
            let b = Rect::new(chip.right() - 10.0 - bars_w + 6.0 + i as f32 * 4.0, chip.center().y + 7.0 - h, 2.5, h);
            ui.c.fill_rrect(b, 1.0, if i < lit { palette::GREEN } else { palette::TEXT_FAINT });
        }
    }
    if resp.clicked {
        st.cmd(if blocked { Command::MicPrivacy } else { Command::NextMic });
    }
}

/// Hold and Unfollow, right to left from `right` (Live's header, and its room view): they act on
/// this view only. Returns the next free right edge.
pub(crate) fn hold_unfollow(ui: &mut Ui, st: &mut AppState, mut right: f32, cy: f32) -> f32 {
    let w = ui.pill_width("Unfollow", false, true);
    let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("live.stop"), b, "Unfollow", None, PillStyle::Utility).clicked {
        st.helper.set_following(false);
    }
    right = b.x - PILL_GAP;
    let label = if st.helper.paused() { "Release" } else { "Hold" };
    let w = ui.pill_width(label, false, true);
    let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("live.pause"), b, label, None, PillStyle::Neutral).clicked {
        st.helper.toggle_pause();
    }
    b.x - PILL_GAP
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
    } else if running && st.call.room {
        ("Listening to the room", "People speaking near this PC show up here, and are saved as an in-room meeting when you stop.".to_string(), false, Some("Stop captions"), Go::Captions(false))
    } else if running {
        ("Listening to this PC", "Play a video or join a meeting. Its captions show up here and in the island, and are saved when you stop: a meeting as a meeting, a video as a transcript.".to_string(), false, Some("Stop captions"), Go::Captions(false))
    } else {
        ("Nothing to follow", "Start captions to caption the room around this PC (Room), what it plays (This PC), or both. They also start by themselves for a video or a calendar meeting.".to_string(), false, Some("Start captions"), Go::Captions(true))
    };
    if hkit::message(ui, area, st.accent, Icon::Lyrics, title, &line, bad, label.map(|l| (l, wid("live.start")))) {
        match go {
            Go::Captions(true) => st.cmd(Command::LiveCaptions),
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
    // Captions tab › Show and Font size (PMM-026). A larger size grows each box by the same px.
    let (show, px) = (poni_core::capture::Show::parse(&st.settings.caption_show), poni_core::capture::resolve_px(st.settings.caption_px, st.settings.caption_font));
    let grow = (px as f32 - poni_core::capture::FONT_DEFAULT as f32).max(0.0) * 2.0;
    let sized = |s: TextStyle| TextStyle { size: poni_core::capture::scale_px(s.size, px), ..s };
    let (main, under) = show.parts(&cap.current, &cap.translation);
    // Who is speaking, in front of the line (Settings › Captions › Show who is speaking).
    let tagged;
    let main = if st.settings.show_speakers && !cap.speaker.is_empty() && !main.is_empty() {
        tagged = format!("{}: {main}", cap.speaker);
        tagged.as_str()
    } else {
        main
    };
    if !cap.previous.is_empty() {
        ui.c.text(&cap.previous, Rect::new(x, y, w, 18.0), &sized(TextStyle::footnote().color(palette::TEXT_FAINT)));
    }
    y += 22.0;
    ui.c.text(main, Rect::new(x, y, w, 46.0 + grow), &sized(TextStyle::headline().color(now).wrap().top()));
    y += 50.0 + grow;
    if let Some(u) = under {
        let color = hkit::translation_color(ui, st.settings.translation_color);
        ui.c.text(u, Rect::new(x, y, w, 40.0 + grow), &sized(TextStyle::body().color(color).wrap().top()));
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
            st.cmd(if on { Command::Captions(false) } else { Command::LiveCaptions });
        }
        right = hold_unfollow(ui, st, b.x - PILL_GAP, cy);
    }
    right = quick_captions::aa_button(ui, st, right, cy) - PILL_GAP;
    if state == PageState::Needs {
        let label = format!("{waiting} wait on you");
        let w = ui.pill_width(&label, false, true);
        let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
        if ui.pill(wid("live.needs"), b, &label, None, PillStyle::Primary(palette::ORANGE)).clicked {
            st.records.list = false;
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
            None => ("Hold and Unfollow change this view. Start captions listens to the source picked on Live.", palette::TEXT_FAINT),
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
