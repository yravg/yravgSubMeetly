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
use poni_core::capture::{lang_name, resolve_px, step_px, Show, Source};
use poni_core::library::{Action as LibAction, Filter, Light};
use poni_core::livecap;
use poni_core::geom::{palette, Color, Point, Rect};
use poni_core::meeting_source::Family;
use poni_core::models::Kind;
use poni_core::utterance::Latency;

const ROW_H: f32 = 30.0;
const SOURCE_GAP: f32 = 10.0;
const SOURCE_LABEL_W: f32 = 112.0;
const SW_W: f32 = 24.0;
const SW_H: f32 = 14.0;
const STEP: f32 = 22.0;
const NAME_W: f32 = 104.0;
const PAD: f32 = 4.0;
/// The group row under the guide.
const SUB_H: f32 = 28.0;
/// A sentence under a row, up to two lines.
const NOTE_H: f32 = 34.0;

/// The five groups of board P09, in order, then the model library (PMM-028).
const SUBS: [&str; 6] = ["Sources", "Speed", "Translation", "Display", "Apps", "Models"];
/// A library row: the name over its kind · languages · state line.
const LIB_H: f32 = 40.0;

/// One row of a group. Every setting the single page had is in exactly one group.
#[derive(Clone, Debug, PartialEq)]
enum Row {
    Source,
    Mic,
    Spoken,
    Latency,
    /// What Fast does, or why it cannot.
    Note(String),
    Restore,
    On,
    Auto,
    Translate,
    Into,
    Lyrics,
    Model,
    Offer,
    Show,
    Font,
    Readout,
    Apps,
    OpenTab,
    /// Models: the search box and the On device / All / Recommended filter.
    LibSearch,
    /// Models: the n-th row the filter and the search let through.
    LibModel(usize),
}

impl Row {
    fn h(&self) -> f32 {
        match self {
            Row::Source => SOURCE_H + 4.0,
            Row::Note(_) => NOTE_H,
            Row::Offer => SOURCE_H + 4.0,
            Row::LibSearch => ROW_H + 4.0,
            Row::LibModel(_) => LIB_H,
            _ => ROW_H,
        }
    }
}

/// What Fast says: how it works, or in plain words why it falls back.
fn fast_note(st: &AppState) -> String {
    if let Some(why) = &st.livecap_why {
        return format!("{why} Fast uses the quicker timing of our own captions instead.");
    }
    match livecap::why_unavailable(st.livecap_installed, Source::parse(&st.settings.captions_source) == Source::Pc) {
        Some(why) => why.to_string(),
        None => "Reads Windows Live Captions: first words in under a second. Its own caption bar is moved off screen while Fast runs.".to_string(),
    }
}

fn rows(st: &AppState, sub: u8) -> Vec<Row> {
    match sub {
        0 => vec![Row::Source, Row::Mic, Row::Spoken],
        1 => {
            let mut v = vec![Row::On, Row::Latency];
            if Latency::parse(&st.settings.latency_mode) == Latency::Fast {
                v.push(Row::Note(fast_note(st)));
            }
            v.push(Row::Restore);
            v
        }
        2 => {
            let mut v = vec![Row::Translate, Row::Into, Row::Lyrics, Row::Model];
            if offer(st).is_some() {
                v.push(Row::Offer);
            }
            v
        }
        3 => vec![Row::Show, Row::Font, Row::Readout],
        4 => vec![Row::Auto, Row::Apps, Row::OpenTab],
        _ => {
            let n = settings_window::library_shown(st, &st.ui.lib_query).len();
            let mut v = vec![Row::LibSearch];
            v.extend((0..n).map(Row::LibModel));
            if n == 0 {
                v.push(Row::Note("No models here. Try All, clear the search, or start the engine from the tray menu.".into()));
            }
            v
        }
    }
}

/// The pill is as tall as the group needs (no height limit, owner 2026-11-11).
pub fn height(st: &AppState) -> f32 {
    hkit::GUIDE_H + SUB_H + 6.0 + rows(st, st.ui.captions_sub.min(5)).iter().map(Row::h).sum::<f32>() + 6.0
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
    let sub = st.ui.captions_sub.min(5);
    sub_tabs(ui, st, Rect::new(area.x, area.y, area.w, SUB_H), sub);
    let mut y = area.y + SUB_H + 6.0;
    let mut clicked = false;
    for row in rows(st, sub) {
        let r = Rect::new(area.x, y, area.w, row.h());
        y += row.h();
        clicked |= draw_row(ui, st, &row, r);
    }
    // The models' state is read while this page is open, as Advanced settings does.
    if st.models.due(st.now) {
        st.cmd(Command::ModelsRefresh);
    }
    quick_captions::language_list(ui, st, area, area.bottom(), clicked);
}

/// The group names, the open one underlined in the accent.
fn sub_tabs(ui: &mut Ui, st: &mut AppState, r: Rect, sub: u8) {
    let mut x = r.x + PAD;
    for (i, name) in SUBS.iter().enumerate() {
        let on = i as u8 == sub;
        let style = TextStyle::caption().weight(if on { Weight::Semibold } else { Weight::Regular }).color(if on { st.accent } else { palette::TEXT_DIM });
        let w = ui.c.measure(name, &style, 200.0).0.ceil();
        let b = Rect::new(x - 6.0, r.y, w + 12.0, r.h);
        let resp = ui.button(wid_n("cap.sub", i as u64), b);
        ui.c.text(name, Rect::new(x, r.y, w + 1.0, r.h), &if resp.hovered && !on { style.color(palette::TEXT) } else { style });
        if on {
            ui.c.fill_rrect(Rect::new(x, r.bottom() - 2.0, w, 2.0), 1.0, st.accent);
        }
        if resp.clicked && !on {
            st.ui.captions_sub = i as u8;
            st.ui.quick.list = None;
        }
        x += w + 22.0;
    }
}

/// Draw one row; true when the press belongs to the language list (it must not close it at once).
fn draw_row(ui: &mut Ui, st: &mut AppState, row: &Row, r: Rect) -> bool {
    let accent = st.accent;
    let s = st.settings.clone();
    let running = st.capture.running();
    let sw = |ui: &mut Ui, n: u64, label: &str, on: bool| switch_row(ui, accent, n, r, label, on);
    match row {
        Row::Source => {
            ui.c.text("Live listens to", Rect::new(r.x + PAD, r.y, SOURCE_LABEL_W, r.h), &TextStyle::body().weight(Weight::Regular));
            source_row(ui, st, Rect::new(r.x + SOURCE_LABEL_W, r.y, r.w - SOURCE_LABEL_W, SOURCE_H));
        }
        Row::Mic => {
            ui.c.text("Microphone", Rect::new(r.x + PAD, r.y, r.w * 0.4, r.h), &TextStyle::body().weight(Weight::Regular));
            let w = ui.pill_width("Change", false, true);
            let b = Rect::new(r.right() - PAD - w, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
            if ui.pill(wid("cap.mic"), b, "Change", None, PillStyle::Utility).clicked {
                st.cmd(Command::OpenSettingsAt(Section::Speech));
            }
            let now = if s.mic_device.is_empty() { "Windows' default, used by Room and Both" } else { "The one chosen in Settings" };
            ui.c.text(now, Rect::new(r.x + r.w * 0.3, r.y, (b.x - 8.0 - r.x - r.w * 0.3).max(0.0), r.h), &TextStyle::caption().color(palette::TEXT_DIM).right());
        }
        Row::Spoken => return lang(ui, st, r, 0, Which::Spoken, "Spoken language"),
        Row::Into => return lang(ui, st, r, 1, Which::Into, "Translate into"),
        Row::Latency => latency_row(ui, st, r),
        Row::Note(text) => {
            ui.c.text(text, Rect::new(r.x + PAD, r.y, r.w - 2.0 * PAD, r.h), &TextStyle::caption().color(palette::TEXT_DIM).wrap().top());
        }
        Row::Restore => {
            ui.c.text("Windows caption bar", Rect::new(r.x + PAD, r.y, r.w * 0.45, r.h), &TextStyle::body().weight(Weight::Regular));
            let w = ui.pill_width("Restore Windows captions", false, true);
            let b = Rect::new(r.right() - PAD - w, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
            if ui.pill(wid("cap.restore"), b, "Restore Windows captions", None, PillStyle::Utility).clicked {
                st.cmd(Command::RestoreLiveCaptions);
            }
        }
        Row::On => {
            if sw(ui, 0, "Captions on", running) {
                st.cmd(Command::Captions(!running));
            }
        }
        Row::Auto => {
            if sw(ui, 1, "Start by themselves", s.auto_captions) {
                quick_captions::run(st, Act::Toggle(Ctl::Auto));
            }
        }
        Row::Translate => {
            if sw(ui, 2, "Translate captions", s.translate_captions) {
                quick_captions::run(st, Act::Toggle(Ctl::Translate));
            }
        }
        Row::Lyrics => {
            if sw(ui, 3, "Translate lyrics", s.lyrics_translate) {
                settings_window::apply(st, Key::LyricsTranslate, settings_window::Act::Toggle);
                st.cmd(Command::SaveSettings);
            }
        }
        Row::OpenTab => {
            if sw(ui, 4, "Meeting tab opens", s.open_meeting_tab) {
                settings_window::apply(st, Key::OpenMeetingTab, settings_window::Act::Toggle);
                st.cmd(Command::SaveSettings);
            }
        }
        Row::Readout => {
            if sw(ui, 5, "Latency readout [ 820 ms ]", s.caption_readout) {
                st.settings.caption_readout = !s.caption_readout;
                st.cmd(Command::SaveSettings);
            }
        }
        Row::Apps => {
            ui.c.text("Meeting apps", Rect::new(r.x + PAD, r.y, r.w * 0.5, r.h), &TextStyle::body().weight(Weight::Regular));
            let w = ui.pill_width("Manage", false, true);
            let b = Rect::new(r.right() - PAD - w, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
            if ui.pill(wid("cap.apps"), b, "Manage", None, PillStyle::Utility).clicked {
                st.cmd(Command::OpenSettingsAt(Section::Speech));
            }
            let count = format!("{} on", meeting_apps_on(st));
            ui.c.text(&count, Rect::new(r.x + r.w * 0.5, r.y, (b.x - 8.0 - r.x - r.w * 0.5).max(0.0), r.h), &TextStyle::caption().color(palette::TEXT_DIM).right());
        }
        Row::Model => model_row(ui, st, r),
        Row::Offer => offer_row(ui, st, r),
        Row::Show => show_row(ui, st, r),
        Row::Font => font_row(ui, st, r),
        Row::LibSearch => lib_search_row(ui, st, r),
        Row::LibModel(n) => lib_row(ui, st, r, *n),
    }
    false
}

/// The search box at the left, the filter at the right.
fn lib_search_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let names: Vec<&str> = Filter::ALL.iter().map(|f| f.label()).collect();
    let pw = picker_width(ui, &names);
    let sel = Filter::ALL.iter().position(|f| *f == st.ui.lib_filter).unwrap_or(0);
    if let Some(i) = picker(ui, "cap.libfilter", r.right() - PAD - pw, r.center().y - 12.0, 24.0, &names, sel) {
        st.ui.lib_filter = Filter::ALL[i];
        st.models.deleting = None;
    }
    let field = Rect::new(r.x, r.y + 2.0, (r.w - pw - 3.0 * PAD).max(0.0), r.h - 4.0);
    let accent = st.accent;
    ui.text_input_row(wid("cap.libsearch"), field, &mut st.ui.lib_query, "Search models or languages", 40, accent, Some(Icon::Search));
}

/// One model: its name over kind · languages · state, its buttons at the right.
fn lib_row(ui: &mut Ui, st: &mut AppState, r: Rect, n: usize) {
    let Some((id, kind, pair, dir, label, sub, acts, light, bar)) = settings_window::library_shown(st, &st.ui.lib_query).get(n).map(|e| (e.c.id.clone(), e.c.kind, e.pair, e.c.st.dir.clone(), e.c.label.clone(), e.sub(&st.models), e.actions(&st.models), Light::of(&e.c.st), poni_core::library::progress(&e.c.st))) else { return };
    let mut x = r.right() - PAD;
    let mut pressed = None;
    for (k, a) in acts.iter().enumerate().rev() {
        let w = ui.pill_width(a.label(), false, true);
        x -= w;
        let b = Rect::new(x, r.center().y - PILL_SMALL / 2.0, w, PILL_SMALL);
        x -= 4.0;
        let style = if matches!(a, LibAction::Confirm) { PillStyle::Primary(palette::RED) } else { PillStyle::Utility };
        if ui.pill(wid_n("cap.libact", (n * 8 + k) as u64), b, a.label(), None, style).clicked {
            pressed = Some(*a);
        }
    }
    // The andon light (as in Advanced settings › Models), then the name.
    ui.c.fill_circle(Point::new(r.x + PAD + 4.0, r.y + 12.0), 4.0, light.color());
    let lx = r.x + PAD + 14.0;
    let tw = (x - 4.0 - lx).max(0.0);
    ui.c.text(&label, Rect::new(lx, r.y + 3.0, tw, 18.0), &TextStyle::body().weight(Weight::Regular));
    ui.c.text(&sub, Rect::new(lx, r.y + 20.0, tw, 16.0), &TextStyle::caption().color(palette::TEXT_DIM));
    if let Some(p) = bar {
        let track = Rect::new(lx, r.bottom() - 3.0, (r.right() - PAD - lx).max(0.0), 2.0);
        ui.c.fill_rrect(track, 1.0, palette::TRACK);
        ui.c.fill_rrect(Rect::new(track.x, track.y, (track.w * p.clamp(0.0, 1.0)).max(2.0), 2.0), 1.0, palette::YELLOW);
    }
    if let Some(a) = pressed {
        settings_window::library_act(st, id, kind, pair, dir, a);
    }
}

/// A language row (the step buttons, the name that opens the list); true when the list was touched.
fn lang(ui: &mut Ui, st: &mut AppState, r: Rect, n: u64, w: Which, label: &str) -> bool {
    let s = st.settings.clone();
    match lang_row(ui, st, n, r, w, label) {
        Some(Lang::Step(d)) => {
            quick_captions::run(st, Act::Step(w, d));
            true
        }
        Some(Lang::Name) => {
            st.ui.quick.press_name(w, &s);
            st.ui.quick.notice = false;
            true
        }
        None => false,
    }
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

/// Font size (board P09): the main caption line in px, "15 px" by default (Live's size today); the
/// other caption styles scale with it. An older step in the settings file is read once into px.
fn font_row(ui: &mut Ui, st: &mut AppState, r: Rect) {
    let cy = r.center().y;
    ui.c.text("Font size", Rect::new(r.x + PAD, r.y, (r.w - 2.0 * STEP - NAME_W - 2.0 * PAD).max(0.0), r.h), &TextStyle::body().weight(Weight::Regular));
    let plus = Rect::new(r.right() - PAD - STEP, cy - STEP / 2.0, STEP, STEP);
    let name = Rect::new(plus.x - NAME_W, r.y, NAME_W, r.h);
    let minus = Rect::new(name.x - STEP, cy - STEP / 2.0, STEP, STEP);
    let px = resolve_px(st.settings.caption_px, st.settings.caption_font);
    for (k, (b, icon, d)) in [(minus, Icon::Minus, -1), (plus, Icon::Plus, 1)].into_iter().enumerate() {
        let live = step_px(px, d) != px;
        if ui.icon_button(wid_n("cap.font", k as u64), b, icon, if live { palette::TEXT_DIM } else { palette::TEXT_FAINT }, 11.0).clicked && live {
            st.settings.caption_px = step_px(px, d);
            st.settings.caption_font = 0;
            st.cmd(Command::SaveSettings);
        }
    }
    ui.c.text(&format!("{px} px"), name, &TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT).center());
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

#[cfg(test)]
mod tests {
    use super::*;
    use poni_core::store::Store;

    fn state() -> AppState {
        AppState::new(poni_core::settings::Settings::default(), Store::default())
    }

    #[test]
    fn every_setting_of_the_single_page_is_in_one_of_the_five_groups() {
        let st = state();
        let all: Vec<Row> = (0..5).flat_map(|g| rows(&st, g)).collect();
        for want in [Row::Source, Row::Mic, Row::Spoken, Row::Latency, Row::On, Row::Auto, Row::Translate, Row::Into, Row::Lyrics, Row::Model, Row::Show, Row::Font, Row::Readout, Row::Apps, Row::OpenTab, Row::Restore] {
            assert_eq!(all.iter().filter(|r| **r == want).count(), 1, "{want:?} is in exactly one group");
        }
    }

    #[test]
    fn fast_says_why_it_falls_back_and_only_fast_has_a_note() {
        let mut st = state();
        assert!(!rows(&st, 1).iter().any(|r| matches!(r, Row::Note(_))), "Balanced has no note");
        st.settings.latency_mode = "fast".into();
        st.livecap_installed = false;
        let note = rows(&st, 1).into_iter().find_map(|r| if let Row::Note(t) = r { Some(t) } else { None }).expect("Fast explains itself");
        assert!(note.contains("not on this PC"), "{note}");
        st.livecap_installed = true;
        st.settings.captions_source = "pc".into();
        let note = rows(&st, 1).into_iter().find_map(|r| if let Row::Note(t) = r { Some(t) } else { None }).unwrap();
        assert!(note.contains("under a second"), "{note}");
        st.livecap_why = Some("The Windows Live Captions window was closed.".into());
        let note = rows(&st, 1).into_iter().find_map(|r| if let Row::Note(t) = r { Some(t) } else { None }).unwrap();
        assert!(note.contains("was closed") && note.contains("our own captions"), "{note}");
    }

    #[test]
    fn the_models_group_lists_the_library_with_search_and_filter() {
        let mut st = state();
        let body = r#"{"models":[{"kind":"asr","id":"openai/whisper-base","downloaded":true,"bytes":290000000}],"catalog":[
          {"kind":"asr","id":"openai/whisper-base","label":"Whisper base","approxBytes":290000000,"selected":true,"downloaded":true,"bytes":290000000},
          {"kind":"translate","id":"Qwen/q","label":"Qwen","approxBytes":988000000},
          {"kind":"translate-pair","id":"Helsinki-NLP/opus-mt-en-id","label":"OPUS-MT English to Indonesian","approxBytes":291000000}]}"#;
        st.models.apply(Ok(poni_core::models::parse(body).unwrap()), 0.0);
        assert_eq!(rows(&st, 5), [Row::LibSearch, Row::LibModel(0)], "On device by default");
        st.ui.lib_filter = Filter::All;
        assert_eq!(rows(&st, 5).len(), 4);
        st.ui.lib_query = "indonesian".into();
        assert_eq!(rows(&st, 5), [Row::LibSearch, Row::LibModel(0)]);
        st.ui.lib_query = "nothing like it".into();
        assert!(matches!(rows(&st, 5)[..], [Row::LibSearch, Row::Note(_)]), "an empty list says why");
        // Download on a row asks for that model by id; Delete asks first, Keep takes it back.
        st.ui.lib_query.clear();
        let e = settings_window::library_shown(&st, "")[1];
        let (id, kind, dir) = (e.c.id.clone(), e.c.kind, e.c.st.dir.clone());
        settings_window::library_act(&mut st, id.clone(), kind, false, dir, LibAction::Download);
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelPullId(i) if *i == id)));
        settings_window::library_act(&mut st, id.clone(), kind, false, None, LibAction::Delete);
        assert_eq!(st.models.deleting.as_deref(), Some(id.as_str()));
        settings_window::library_act(&mut st, id.clone(), kind, false, None, LibAction::Keep);
        assert_eq!(st.models.deleting, None);
        settings_window::library_act(&mut st, id.clone(), kind, false, None, LibAction::Confirm);
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelDelete(i) if *i == id)));
    }

    #[test]
    fn the_pill_grows_with_the_group_and_has_no_cap() {
        let mut st = state();
        let h: Vec<f32> = (0..6u8).map(|g| { st.ui.captions_sub = g; height(&st) }).collect();
        assert!(h.iter().all(|h| *h > hkit::GUIDE_H + SUB_H), "{h:?}");
        assert!(h[2] > h[0], "Translation has more rows than Sources: {h:?}");
        st.ui.captions_sub = 1;
        let balanced = height(&st);
        st.settings.latency_mode = "fast".into();
        assert!(height(&st) > balanced, "Fast adds its note, so the pill grows");
    }
}
