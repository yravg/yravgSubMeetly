//! The three meeting add-ins (boards I06, I07), each a tab while its switch
//! on the Add-ons page is on:
//!
//! - Agenda timer: a ring of the agenda items covered, a stopwatch beside it.
//! - Talk time: bars of who owns how many items. The helper's transcript
//!   lines carry no speaker, so this is the register's share, not seconds.
//! - Engine monitor: what `GET /health` says (engine, model, device, compute,
//!   translation) and the last round trips as bars.
//!
//! Each has the page states of `poni_core::helper::PageState`; the engine
//! has no Locked (nothing there to protect).

use super::hkit;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::state::AppState;
use crate::ui::{wid, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Point, Rect};
use poni_core::helper::{self, PageState};

const HEIGHT: f32 = 176.0;
const BARS_MAX: usize = 5;

pub fn height(_st: &AppState) -> f32 {
    HEIGHT
}

/// The stopwatch needs a frame each second while it runs.
pub fn timer_wake(st: &AppState) -> Option<f64> {
    st.helper.timer.running().then(|| st.now.floor() + 1.0)
}

fn offline(ui: &mut Ui, st: &mut AppState, area: Rect, id: &str) {
    hkit::offline(ui, st, area, wid(id));
}

pub fn draw_timer(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let accent = st.accent;
    let state = helper::timer_state(&st.helper.link, &st.helper.snap.notes);
    match state {
        PageState::Error => return offline(ui, st, area, "timer.retry"),
        PageState::Empty => {
            hkit::message(ui, area, accent, Icon::Clock, "No meeting yet", "The timer counts an agenda once a meeting exists. The stopwatch works on its own after that.", false, None);
            return;
        }
        _ => {}
    }
    let (covered, total, issued) = st.helper.note().map(|n| (n.agenda_covered, n.agenda_total, n.issued)).unwrap_or((0, 0, false));
    let c = Point::new(area.x + 60.0, area.y + area.h / 2.0);
    let progress = if total == 0 { 0.0 } else { (covered as f32 / total as f32).clamp(0.0, 1.0) };
    ui.c.ring(c, 52.0, 8.0, progress, palette::TRACK, if issued { palette::TEXT_FAINT } else { accent });
    let elapsed = helper::clock(st.helper.timer.elapsed(ui.now));
    ui.c.text(&elapsed, Rect::from_center(c, 84.0, 24.0), &TextStyle::headline().center());

    let x = area.x + 140.0;
    let w = (area.right() - x).max(0.0);
    let agenda = if total == 0 { "No agenda".to_string() } else { format!("{covered} of {total} agenda items covered") };
    ui.c.text(&agenda, Rect::new(x, c.y - 44.0, w, 22.0), &TextStyle::headline());
    let line = match state {
        PageState::Locked => "Issued meeting. The agenda is read-only.",
        PageState::Needs => "Add an agenda in the Minutes register to count coverage.",
        _ => "Counted from the register. The stopwatch is the island's own.",
    };
    ui.c.text(line, Rect::new(x, c.y - 20.0, w, 34.0), &TextStyle::footnote().color(palette::TEXT_DIM).wrap().top());
    if state == PageState::Locked {
        return;
    }
    let run = st.helper.timer.running();
    let label = if run { "Pause" } else if st.helper.timer.elapsed(ui.now) > 0.0 { "Resume" } else { "Start" };
    let bw = ui.pill_width(label, false, true);
    let b = Rect::new(x, c.y + 20.0, bw, PILL_SMALL);
    if ui.pill(wid("timer.toggle"), b, label, None, PillStyle::Primary(accent)).clicked {
        st.helper.timer.toggle(ui.now);
    }
    let rw = ui.pill_width("Reset", false, true);
    let r = Rect::new(b.right() + PILL_GAP, b.y, rw, PILL_SMALL);
    if ui.pill(wid("timer.reset"), r, "Reset", None, PillStyle::Utility).clicked {
        st.helper.timer.reset();
    }
}

pub fn draw_talk(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let accent = st.accent;
    let state = helper::talk_state(&st.helper.link, &st.helper.snap.notes);
    match state {
        PageState::Error => return offline(ui, st, area, "talk.retry"),
        PageState::Empty => {
            hkit::message(ui, area, accent, Icon::Volume, "No owners yet", "Bars appear once items in the meeting have an owner.", false, None);
            return;
        }
        _ => {}
    }
    let Some(note) = st.helper.note() else { return };
    let share = helper::talk_share(note);
    let hint = match state {
        PageState::Locked => "Issued meeting \u{b7} read-only".to_string(),
        PageState::Needs => format!("{} items have no owner yet", helper::unowned(note)),
        _ => "Items per owner. The helper sends no speaker time yet.".to_string(),
    };
    let tone = if state == PageState::Needs { palette::ORANGE } else { palette::TEXT_DIM };
    ui.c.text(&hint, Rect::new(area.x, area.y, area.w, 18.0), &TextStyle::footnote().color(tone));
    let name_w = 110.0;
    let pct_w = 40.0;
    let bar_x = area.x + name_w + 8.0;
    let bar_w = (area.w - name_w - pct_w - 16.0).max(10.0);
    for (i, (name, frac)) in share.iter().take(BARS_MAX).enumerate() {
        let y = area.y + 26.0 + i as f32 * 26.0;
        ui.c.text(name, Rect::new(area.x, y, name_w, 22.0), &TextStyle::body());
        let bar = Rect::new(bar_x, y + 7.0, bar_w, 8.0);
        ui.c.fill_rrect(bar, 4.0, palette::TRACK);
        let fill = if state == PageState::Locked { palette::TEXT_FAINT } else { accent };
        ui.c.fill_rrect(Rect::new(bar.x, bar.y, (bar.w * frac).max(8.0), bar.h), 4.0, fill);
        let pct = format!("{}%", (frac * 100.0).round() as u32);
        ui.c.text(&pct, Rect::new(bar.right() + 8.0, y, pct_w, 22.0), &TextStyle::footnote().color(palette::TEXT_DIM).weight(Weight::Semibold));
    }
}

pub fn draw_engine(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let accent = st.accent;
    let state = helper::engine_state(&st.helper.link, &st.helper.snap.health);
    match state {
        PageState::Error => return offline(ui, st, area, "engine.retry"),
        PageState::Empty => {
            hkit::message(ui, area, accent, Icon::Cpu, "Looking for the helper", "Asking the helper on its port.", false, None);
            return;
        }
        _ => {}
    }
    let h = &st.helper.snap.health;
    let dev = match (h.device.as_str(), h.compute.as_str()) {
        ("", "") => "unknown".to_string(),
        (d, "") => d.to_string(),
        (d, c) => format!("{d} \u{b7} {c}"),
    };
    let rows = [("Engine", h.engine.clone()), ("Model", h.model.clone()), ("Device", dev), ("Translation", (if h.translate { "on" } else { "off" }).to_string()),
        ("CPU", engine_cpu_text(st.system.latest.as_ref().and_then(|r| r.watched_cpu))),
        ("Speed", engine_rtf_text(st.helper.snap.live.as_ref()))];
    let col = 96.0;
    for (i, (k, v)) in rows.iter().enumerate() {
        let y = area.y + i as f32 * 22.0;
        ui.c.text(k, Rect::new(area.x, y, col, 20.0), &TextStyle::footnote().color(palette::TEXT_DIM));
        let tone = if *k == "Translation" && !h.translate { palette::ORANGE } else { palette::TEXT };
        let v = if v.is_empty() { "\u{2014}" } else { v.as_str() };
        ui.c.text(v, Rect::new(area.x + col, y, (area.w * 0.55 - col).max(0.0), 20.0), &TextStyle::body().color(tone));
    }
    if state == PageState::Needs {
        ui.c.text("This engine cannot translate. Install the fast model to turn it on.", Rect::new(area.x, area.y + rows.len() as f32 * 22.0 + 4.0, area.w * 0.55, 34.0), &TextStyle::footnote().color(palette::ORANGE).wrap().top());
    }
    // The last round trips, newest on the right.
    let box_ = Rect::new(area.x + area.w * 0.6, area.y, area.w * 0.4, 96.0);
    let last = st.helper.rtt.last().copied().unwrap_or(0);
    ui.c.text(&format!("{last} ms"), Rect::new(box_.x, box_.y, box_.w, 22.0), &TextStyle::headline());
    ui.c.text("round trip", Rect::new(box_.x, box_.y + 22.0, box_.w, 16.0), &TextStyle::caption().color(palette::TEXT_DIM));
    let top = st.helper.rtt.iter().copied().max().unwrap_or(1).max(20) as f32;
    let n = helper::RTT_KEPT as f32;
    let slot = box_.w / n;
    let base = box_.bottom();
    for (i, ms) in st.helper.rtt.iter().enumerate() {
        let hgt = (*ms as f32 / top * 48.0).clamp(3.0, 48.0);
        let x = box_.x + (helper::RTT_KEPT - st.helper.rtt.len() + i) as f32 * slot;
        ui.c.fill_rrect(Rect::new(x + 1.0, base - hgt, (slot - 2.0).max(2.0), hgt), 1.5, accent);
    }
}

/// The engine process's share of the whole PC's processor, as measured; a dash when nothing was.
fn engine_cpu_text(share: Option<f32>) -> String {
    share.map_or_else(|| "\u{2014}".to_string(), |s| format!("{:.1} % of the PC", s * 100.0))
}

/// The last clip's compute time over its audio length (`/live`); a dash until the engine has heard one.
fn engine_rtf_text(live: Option<&helper::Live>) -> String {
    match live.filter(|l| l.seq > 0).and_then(|l| l.rtf) {
        Some(r) => format!("{r:.2} \u{d7} real time (last clip)"),
        None => "\u{2014} (no clip heard yet)".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engine_rows_show_only_what_was_measured() {
        assert_eq!(engine_cpu_text(None), "\u{2014}");
        assert_eq!(engine_cpu_text(Some(0.0312)), "3.1 % of the PC");
        assert_eq!(engine_rtf_text(None), "\u{2014} (no clip heard yet)");
        let idle = helper::Live::default();
        assert_eq!(engine_rtf_text(Some(&idle)), "\u{2014} (no clip heard yet)");
        let heard = helper::Live { seq: 3, rtf: Some(0.3456), ..helper::Live::default() };
        assert_eq!(engine_rtf_text(Some(&heard)), "0.35 \u{d7} real time (last clip)");
    }
}
