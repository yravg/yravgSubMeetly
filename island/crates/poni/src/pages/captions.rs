//! Captions tab (PMM-022): every caption and translation setting of Advanced settings ›
//! Captions and languages on the pill, so a change never needs the window. The tab is off until
//! Settings › Tabs switches it on (`Settings::captions_tab`); the "Aa" strip on Live, Meeting and
//! Media stays as the quick subset.
//!
//! Each control writes what its Advanced-settings row writes: the switches through
//! `settings_window::apply` and `quick_captions::run`, the languages through the strip's list and
//! `Act`, the source through `Command::LiveSource`. All of them save through `Command::SaveSettings`,
//! which retunes running captions (the 1.2.9 path). Meeting apps are a list with an add and a
//! remove row, so its row here counts them and opens that section of the window.

use super::hkit;
use super::live::{source_row, SOURCE_H};
use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::settings::draw_switch;
use crate::pages::PageKind;
use crate::pill::quick_captions::{self, Act, Ctl, Which};
use crate::settings_window::{self, Key, Section};
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_SMALL};
use poni_core::capture::lang_name;
use poni_core::geom::{palette, Color, Rect};
use poni_core::meeting_source::Family;

const ROW_H: f32 = 34.0;
const ROWS: usize = 5;
const COL_GAP: f32 = 28.0;
const SOURCE_GAP: f32 = 10.0;
const SOURCE_LABEL_W: f32 = 112.0;
const SW_W: f32 = 24.0;
const SW_H: f32 = 14.0;
const STEP: f32 = 22.0;
const NAME_W: f32 = 104.0;
const PAD: f32 = 4.0;

pub fn height(_st: &AppState) -> f32 {
    hkit::GUIDE_H + ROWS as f32 * ROW_H + SOURCE_GAP + SOURCE_H + 6.0
}

/// How many meeting apps count: the built-in families still on and the ones the person added.
pub fn meeting_apps_on(st: &AppState) -> usize {
    let s = &st.settings;
    Family::ALL.iter().filter(|f| f.on(&s.meeting_families)).count() + s.meeting_apps.len()
}

/// A label and a switch over the whole row. True when pressed.
fn switch_row(ui: &mut Ui, accent: Color, n: u64, r: Rect, label: &str, on: bool) -> bool {
    let resp = ui.button(wid_n("cap.sw", n), r);
    if resp.hovered || resp.pressed {
        ui.c.fill_rrect(r.inset(0.0, 2.0), 8.0, Color::white(if resp.pressed { 0.10 } else { 0.06 }));
    }
    ui.c.text(label, Rect::new(r.x + PAD, r.y, (r.w - SW_W - 3.0 * PAD).max(0.0), r.h), &TextStyle::body().weight(Weight::Regular));
    draw_switch(ui.c, Rect::new(r.right() - PAD - SW_W, r.center().y - SW_H / 2.0, SW_W, SW_H), on, accent);
    resp.clicked
}

/// What a language row was pressed for.
enum Lang {
    Step(i32),
    Name,
}

/// A label, then − name + at the right. The name opens the list of languages.
fn lang_row(ui: &mut Ui, st: &AppState, n: u64, r: Rect, w: Which, label: &str) -> Option<Lang> {
    let cy = r.center().y;
    ui.c.text(label, Rect::new(r.x + PAD, r.y, (r.w - 2.0 * STEP - NAME_W - 2.0 * PAD).max(0.0), r.h), &TextStyle::body().weight(Weight::Regular));
    let plus = Rect::new(r.right() - PAD - STEP, cy - STEP / 2.0, STEP, STEP);
    let name = Rect::new(plus.x - NAME_W, r.y, NAME_W, r.h);
    let minus = Rect::new(name.x - STEP, cy - STEP / 2.0, STEP, STEP);
    let mut out = None;
    for (k, (b, icon, d)) in [(minus, Icon::Minus, -1), (plus, Icon::Plus, 1)].into_iter().enumerate() {
        if ui.icon_button(wid_n("cap.step", n * 2 + k as u64), b, icon, palette::TEXT_DIM, 11.0).clicked {
            out = Some(Lang::Step(d));
        }
    }
    let resp = ui.button(wid_n("cap.name", n), name);
    let open = st.ui.quick.list == Some(w);
    if resp.hovered || resp.pressed || open {
        ui.c.fill_rrect(name.inset(0.0, 3.0), 8.0, Color::white(if resp.pressed || open { 0.10 } else { 0.06 }));
    }
    let code = if w == Which::Spoken { &st.settings.source_lang } else { &st.settings.target_lang };
    ui.c.text(&lang_name(code), name, &TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT).center());
    if resp.clicked {
        out = Some(Lang::Name);
    }
    out
}

pub fn draw(ui: &mut Ui, st: &mut AppState, area: Rect) {
    let area = hkit::guide(ui, st, area, PageKind::Captions, "Every caption and translation setting. The Aa strip on Live keeps the quick ones.");
    let col_w = (area.w - COL_GAP) / 2.0;
    let left = |i: usize| Rect::new(area.x, area.y + i as f32 * ROW_H, col_w, ROW_H);
    let right = |i: usize| Rect::new(area.x + col_w + COL_GAP, area.y + i as f32 * ROW_H, col_w, ROW_H);
    let accent = st.accent;
    let s = st.settings.clone();
    let running = st.capture.running();
    let mut clicked = false;

    // Left: the switches, in the order of Advanced settings.
    let switches: [(&str, bool); ROWS] = [
        ("Captions on", running),
        ("Start by themselves", s.auto_captions),
        ("Translate captions", s.translate_captions),
        ("Translate lyrics", s.lyrics_translate),
        ("Meeting tab opens", s.open_meeting_tab),
    ];
    let mut flip = None;
    for (i, (label, on)) in switches.into_iter().enumerate() {
        if switch_row(ui, accent, i as u64, left(i), label, on) {
            flip = Some(i);
        }
    }
    match flip {
        Some(0) => st.cmd(Command::Captions(!running)),
        Some(1) => quick_captions::run(st, Act::Toggle(Ctl::Auto)),
        Some(2) => quick_captions::run(st, Act::Toggle(Ctl::Translate)),
        Some(i) => {
            settings_window::apply(st, if i == 3 { Key::LyricsTranslate } else { Key::OpenMeetingTab }, settings_window::Act::Toggle);
            st.cmd(Command::SaveSettings);
        }
        None => {}
    }

    // Right: the languages, and the meeting apps.
    for (i, (w, label)) in [(Which::Spoken, "Spoken language"), (Which::Into, "Translate into")].into_iter().enumerate() {
        match lang_row(ui, st, i as u64, right(i), w, label) {
            Some(Lang::Step(d)) => {
                clicked = true;
                quick_captions::run(st, Act::Step(w, d));
            }
            Some(Lang::Name) => {
                clicked = true;
                st.ui.quick.press_name(w, &s);
                st.ui.quick.notice = false;
            }
            None => {}
        }
    }
    let r = right(2);
    ui.c.text("Meeting apps", Rect::new(r.x + PAD, r.y, r.w * 0.5, r.h), &TextStyle::body().weight(Weight::Regular));
    let w = ui.pill_width("Manage", false, true);
    let b = Rect::new(r.right() - PAD - w, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("cap.apps"), b, "Manage", None, PillStyle::Utility).clicked {
        st.cmd(Command::OpenSettingsAt(Section::Speech));
    }
    let count = format!("{} on", meeting_apps_on(st));
    ui.c.text(&count, Rect::new(r.x + r.w * 0.5, r.y, (b.x - 8.0 - r.x - r.w * 0.5).max(0.0), r.h), &TextStyle::caption().color(palette::TEXT_DIM).right());
    // PMM-026 (step 4.7 island half): latency mode, translation engine, original / translation / both
    // and font size go in right(3) and right(4). Nothing is drawn there until each one is wired to
    // what the engine can really do; no control stands in for it.

    // Bottom: what Live listens to, and the microphone.
    let row = Rect::new(area.x, area.y + ROWS as f32 * ROW_H + SOURCE_GAP, area.w, SOURCE_H);
    ui.c.text("Live listens to", Rect::new(row.x + PAD, row.y, SOURCE_LABEL_W, row.h), &TextStyle::body().weight(Weight::Regular));
    source_row(ui, st, Rect::new(row.x + SOURCE_LABEL_W, row.y, row.w - SOURCE_LABEL_W, row.h));

    quick_captions::language_list(ui, st, area, area.bottom(), clicked);
}
