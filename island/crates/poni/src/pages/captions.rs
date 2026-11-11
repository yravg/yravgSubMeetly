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
use crate::pages::settings::{draw_switch, picker, picker_width};
use crate::pages::PageKind;
use crate::pill::quick_captions::{self, Act, Ctl, Which};
use crate::settings_window::{self, Key, Section};
use crate::state::AppState;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_SMALL};
use poni_core::capture::{lang_name, step_font, Show};
use poni_core::geom::{palette, Color, Rect};
use poni_core::meeting_source::Family;
use poni_core::models::Kind;
use poni_core::utterance::Latency;

const ROW_H: f32 = 30.0;
const ROWS: usize = 6;
const COL_GAP: f32 = 28.0;
const SOURCE_GAP: f32 = 10.0;
const SOURCE_LABEL_W: f32 = 112.0;
const SW_W: f32 = 24.0;
const SW_H: f32 = 14.0;
const STEP: f32 = 22.0;
const NAME_W: f32 = 104.0;
const PAD: f32 = 4.0;

pub fn height(st: &AppState) -> f32 {
    let line = if offer(st).is_some() { SOURCE_GAP + SOURCE_H } else { 0.0 };
    hkit::GUIDE_H + ROWS as f32 * ROW_H + SOURCE_GAP + SOURCE_H + line + 6.0
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
    let switches: [(&str, bool); 5] = [
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
    latency_row(ui, st, right(3));
    model_row(ui, st, right(4));
    show_row(ui, st, left(5));
    font_row(ui, st, right(5));

    // Bottom: what Live listens to, and the microphone.
    let row = Rect::new(area.x, area.y + ROWS as f32 * ROW_H + SOURCE_GAP, area.w, SOURCE_H);
    ui.c.text("Live listens to", Rect::new(row.x + PAD, row.y, SOURCE_LABEL_W, row.h), &TextStyle::body().weight(Weight::Regular));
    source_row(ui, st, Rect::new(row.x + SOURCE_LABEL_W, row.y, row.w - SOURCE_LABEL_W, row.h));
    offer_row(ui, st, Rect::new(area.x, row.bottom() + SOURCE_GAP, area.w, SOURCE_H));

    // The models' state is read while this page is open, as Advanced settings does.
    if st.models.due(st.now) {
        st.cmd(Command::ModelsRefresh);
    }
    quick_captions::language_list(ui, st, area, area.bottom(), clicked);
}

/// Show (PMM-026): Original, Translation or Both, for Live, Meeting and the Media caption column.
fn show_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    ui.c.text("Show", Rect::new(r.x + PAD, r.y, r.w * 0.3, r.h), &TextStyle::body().weight(Weight::Regular));
    let names: Vec<&str> = Show::ALL.iter().map(|s| s.label()).collect();
    let sel = Show::ALL.iter().position(|s| *s == Show::parse(&st.settings.caption_show)).unwrap_or(2);
    let pw = picker_width(ui, &names);
    if let Some(i) = picker(ui, "cap.show", r.right() - PAD - pw, r.y + 3.0, r.h - 6.0, &names, sel) {
        st.settings.caption_show = Show::ALL[i].key().to_string();
        st.cmd(Command::SaveSettings);
    }
}

/// Font size (PMM-026): px added to the caption text of Live, Meeting and the Media column.
fn font_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let cy = r.center().y;
    ui.c.text("Font size", Rect::new(r.x + PAD, r.y, (r.w - 2.0 * STEP - NAME_W - 2.0 * PAD).max(0.0), r.h), &TextStyle::body().weight(Weight::Regular));
    let plus = Rect::new(r.right() - PAD - STEP, cy - STEP / 2.0, STEP, STEP);
    let name = Rect::new(plus.x - NAME_W, r.y, NAME_W, r.h);
    let minus = Rect::new(name.x - STEP, cy - STEP / 2.0, STEP, STEP);
    let step = st.settings.caption_font;
    for (k, (b, icon, d)) in [(minus, Icon::Minus, -1), (plus, Icon::Plus, 1)].into_iter().enumerate() {
        let live = step_font(step, d) != step;
        if ui.icon_button(wid_n("cap.font", k as u64), b, icon, if live { palette::TEXT_DIM } else { palette::TEXT_FAINT }, 11.0).clicked && live {
            st.settings.caption_font = step_font(step, d);
            st.cmd(Command::SaveSettings);
        }
    }
    let shown = if step == 0 { "Default".to_string() } else { format!("{step:+} px") };
    ui.c.text(&shown, name, &TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT).center());
}

/// Fast / Balanced / Accurate: the utterance timing, the engine's mode and the model rows each one
/// runs best on (`Latency`). A change applies to running captions at their next utterance.
fn latency_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    ui.c.text("Latency", Rect::new(r.x + PAD, r.y, r.w * 0.4, r.h), &TextStyle::body().weight(Weight::Regular));
    let names: Vec<&str> = Latency::ALL.iter().map(|l| l.label()).collect();
    let sel = Latency::ALL.iter().position(|l| *l == Latency::parse(&st.settings.latency_mode)).unwrap_or(1);
    let pw = picker_width(ui, &names);
    if let Some(i) = picker(ui, "cap.latency", r.right() - PAD - pw, r.y + 3.0, r.h - 6.0, &names, sel) {
        st.settings.latency_mode = Latency::ALL[i].key().to_string();
        st.cmd(Command::SaveSettings);
    }
}

/// The translation model of Advanced settings › Models: stepped here, switched at once when it is
/// on disk, otherwise named here with its Download on the line below.
fn model_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let cy = r.center().y;
    ui.c.text("Translation model", Rect::new(r.x + PAD, r.y, (r.w - 2.0 * STEP - NAME_W - 2.0 * PAD).max(0.0), r.h), &TextStyle::body().weight(Weight::Regular));
    let plus = Rect::new(r.right() - PAD - STEP, cy - STEP / 2.0, STEP, STEP);
    let name = Rect::new(plus.x - NAME_W, r.y, NAME_W, r.h);
    let minus = Rect::new(name.x - STEP, cy - STEP / 2.0, STEP, STEP);
    let can_step = st.models.step(Kind::Translate, 1).is_some();
    for (k, (b, icon, d)) in [(minus, Icon::Minus, -1), (plus, Icon::Plus, 1)].into_iter().enumerate() {
        if ui.icon_button(wid_n("cap.model.step", k as u64), b, icon, if can_step { palette::TEXT_DIM } else { palette::TEXT_FAINT }, 11.0).clicked && can_step {
            settings_window::apply(st, Key::ModelPick(Kind::Translate), settings_window::Act::Step(d));
        }
    }
    let shown = st.models.chosen(Kind::Translate).map_or_else(|| "Checking\u{2026}".to_string(), |id| st.models.label_of(&id));
    ui.c.text(&shown, name, &TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT).center());
}

/// What the line under the models says and offers: the person's own pick when it still needs a
/// download (or its download failed), else the recommended model while the engine says it is not on
/// disk. (sentence, button, the model to pick first: only the recommendation is not picked yet.)
fn offer(st: &AppState) -> Option<(String, &'static str, Option<String>)> {
    let d = st.models.describe(Kind::Translate);
    if let Some(button) = d.button {
        return Some((d.text, button, None));
    }
    let (id, label, bytes) = st.models.recommended_offer()?;
    let about = if bytes > 0 { format!(", about {:.1} GB", bytes as f64 / 1e9) } else { String::new() };
    Some((format!("Recommended: {label}{about}. Captions use the model you have until it is here."), "Download", Some(id)))
}

/// The line under the models: what is to download, and the one press that does it.
fn offer_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let Some((text, button, pick)) = offer(st) else { return };
    let w = ui.pill_width(button, false, true);
    let b = Rect::new(r.right() - w, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
    ui.c.text(&text, Rect::new(r.x + PAD, r.y, (b.x - 8.0 - r.x).max(0.0), r.h), &TextStyle::caption().color(palette::TEXT_DIM));
    if ui.pill(wid("cap.offer"), b, button, None, PillStyle::Primary(st.accent)).clicked {
        if let Some(id) = pick {
            st.models.set_pick(Kind::Translate, Some(id));
        }
        st.cmd(Command::ModelPull(Kind::Translate));
    }
}
