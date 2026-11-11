//! Quick caption settings on the pill (PMM-011..013, boards P05 and P06): an
//! "Aa" button shows or hides a strip of Captions on/off, Auto start,
//! Translate, Spoken language (− name +) and Translate into (→ − name +).
//! Pressing a language name opens the list of the 12 languages (Spoken also
//! Auto-detect) over the page; the "Captions on" pop-up opens the same list
//! from its two language pills.
//!
//! Every control writes the setting Advanced settings › Speech writes and is
//! saved through `Command::SaveSettings`, so `App::settings_changed` posts the
//! languages to the engine and retunes running captions (the 1.2.9 path).
//!
//! Keyboard (once a press on the strip gave it the keyboard, the Menu's way):
//! Tab walks the controls left to right, Space or Enter toggles a switch or
//! opens a language's list, Left/Right steps a language; in the list the
//! arrows move, Space or Enter picks, Esc closes. The pure parts are tested below.

use crate::commands::Command;
use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::settings::draw_switch;
use crate::state::AppState;
use crate::ui::{wid, wid_n, KeyInput, PillStyle, Ui, WidgetId, PILL_SMALL};
use poni_core::capture::{lang_name, step_lang, LANGS};
use poni_core::geom::{palette, Color, Point, Rect};
use poni_core::settings::Settings;

/// The strip's height at the bottom of a page; the page grows by it.
pub const STRIP_H: f32 = 40.0;
/// How long the pop-up stays after the last touch of its pills or list.
pub const NOTICE_TOUCH_S: f64 = 8.0;
/// The ids the app routes presses on the closed island's pop-up by.
pub const NOTICE_SPOKEN: &str = "qc.notice.spoken";
pub const NOTICE_INTO: &str = "qc.notice.into";
/// The id the strip's and the list's keyboard focus lives under.
pub const KB_ID: &str = "qc.kb";
const ROW_ID: &str = "qc.row";
const PANEL_ID: &str = "qc.panel";

const CHIP_H: f32 = 28.0;
const CHIP_PAD: f32 = 9.0;
const CHIP_GAP: f32 = 6.0;
const SW_W: f32 = 24.0;
const SW_H: f32 = 14.0;
const STEP: f32 = 20.0;
/// The list: a grid filled row by row, as the board draws it.
const COLS: usize = 4;
const CELL_W: f32 = 96.0;
const ROW_H: f32 = 24.0;
const LIST_PAD: f32 = 10.0;
const LIST_HEAD: f32 = 20.0;

/// The strip's controls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ctl {
    Captions,
    Auto,
    Translate,
    Spoken,
    Into,
}

/// Left to right: the Tab order.
pub const CTLS: [Ctl; 5] = [Ctl::Captions, Ctl::Auto, Ctl::Translate, Ctl::Spoken, Ctl::Into];

/// One of the two languages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    Spoken,
    Into,
}

/// What a press or a key asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Captions, Auto or Translate.
    Toggle(Ctl),
    Step(Which, i32),
    Pick(Which, &'static str),
}

/// Strip and list state kept between frames (`PageUiState::quick`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QuickUi {
    /// The control the keyboard is on (index into [`CTLS`]).
    pub ring: Option<usize>,
    /// The open list, and the row the keyboard is on.
    pub list: Option<Which>,
    pub sel: usize,
    /// The open list belongs to the "Captions on" pop-up, not a page.
    pub notice: bool,
    /// A press outside the drawing code opened the list: the next frame takes the keyboard.
    pub grab: bool,
}

/// The codes a list offers, in order.
pub fn codes(w: Which) -> Vec<&'static str> {
    let auto = (w == Which::Spoken).then_some("auto");
    auto.into_iter().chain(LANGS.iter().map(|(c, _)| *c)).collect()
}

fn current(s: &Settings, w: Which) -> &str {
    match w {
        Which::Spoken => &s.source_lang,
        Which::Into => &s.target_lang,
    }
}

fn ctl_of(w: Which) -> usize {
    match w {
        Which::Spoken => 3,
        Which::Into => 4,
    }
}

/// Where the arrows, Tab, Home and End take row `sel` of `n` in the grid.
pub fn grid_nav(sel: usize, n: usize, k: KeyInput) -> usize {
    let last = n.saturating_sub(1);
    match k {
        KeyInput::Left => sel.saturating_sub(1),
        KeyInput::Right | KeyInput::Tab => (sel + 1).min(last),
        KeyInput::Up => sel.checked_sub(COLS).unwrap_or(sel),
        KeyInput::Down if sel + COLS <= last => sel + COLS,
        KeyInput::Home => 0,
        KeyInput::End => last,
        _ => sel,
    }
}

impl QuickUi {
    /// Open `w`'s list on the current language.
    pub fn open(&mut self, w: Which, s: &Settings) {
        let cur = current(s, w);
        self.list = Some(w);
        self.sel = codes(w).iter().position(|c| *c == cur).unwrap_or(0);
        self.ring = Some(ctl_of(w));
    }

    /// A press on a language's name: opens its list, or closes it when it is the one open.
    pub fn press_name(&mut self, w: Which, s: &Settings) {
        if self.list == Some(w) {
            self.list = None;
        } else {
            self.open(w, s);
        }
    }

    /// One key while the strip (or a list) has the keyboard.
    pub fn key(&mut self, k: KeyInput, s: &Settings) -> Option<Act> {
        if let Some(w) = self.list {
            let all = codes(w);
            match k {
                KeyInput::Escape => self.list = None,
                KeyInput::Enter | KeyInput::Char(' ') => {
                    self.list = None;
                    return Some(Act::Pick(w, all[self.sel.min(all.len() - 1)]));
                }
                _ => self.sel = grid_nav(self.sel, all.len(), k),
            }
            return None;
        }
        let i = self.ring.unwrap_or(0).min(CTLS.len() - 1);
        self.ring = Some(i);
        let lang = match CTLS[i] {
            Ctl::Spoken => Some(Which::Spoken),
            Ctl::Into => Some(Which::Into),
            _ => None,
        };
        match (k, lang) {
            (KeyInput::Tab, _) => self.ring = Some((i + 1) % CTLS.len()),
            (KeyInput::Char(' ') | KeyInput::Enter, None) => return Some(Act::Toggle(CTLS[i])),
            (KeyInput::Char(' ') | KeyInput::Enter, Some(w)) => self.open(w, s),
            (KeyInput::Left, Some(w)) => return Some(Act::Step(w, -1)),
            (KeyInput::Right, Some(w)) => return Some(Act::Step(w, 1)),
            _ => {}
        }
        None
    }
}

/// Write what Advanced settings writes for `act`. Captions on/off is not a
/// setting written here (the caller starts or stops them): false.
pub fn apply(s: &mut Settings, act: Act) -> bool {
    match act {
        Act::Toggle(Ctl::Auto) => s.auto_captions = !s.auto_captions,
        Act::Toggle(Ctl::Translate) => s.translate_captions = !s.translate_captions,
        Act::Toggle(_) => return false,
        Act::Step(Which::Spoken, d) => s.source_lang = step_lang(&s.source_lang, d, true).into(),
        Act::Step(Which::Into, d) => s.target_lang = step_lang(&s.target_lang, d, false).into(),
        Act::Pick(Which::Spoken, c) => s.source_lang = c.into(),
        Act::Pick(Which::Into, c) => s.target_lang = c.into(),
    }
    true
}

/// Do `act`: captions start or stop as Start/Stop captions does; the rest is saved, which applies it.
pub fn run(st: &mut AppState, act: Act) {
    if act == Act::Toggle(Ctl::Captions) {
        st.cmd(Command::Captions(!st.capture.running()));
    } else if apply(&mut st.settings, act) {
        st.cmd(Command::SaveSettings);
    }
}

/// The pop-up's language pills: the spoken language, and the target while captions translate.
pub fn notice_langs(s: &Settings) -> (String, Option<String>) {
    (lang_name(&s.source_lang), s.translate_captions.then(|| lang_name(&s.target_lang)))
}

/// A press on the closed island's pop-up (the app acts on presses there at
/// mouse-down): its language pills or its open list. True when it was one;
/// the pop-up then stays [`NOTICE_TOUCH_S`] from now.
pub fn notice_press(st: &mut AppState, id: WidgetId) -> bool {
    let q = &mut st.ui.quick;
    let name = [(NOTICE_SPOKEN, Which::Spoken), (NOTICE_INTO, Which::Into)].into_iter().find(|(n, _)| wid(n) == id);
    if let Some((_, w)) = name {
        q.press_name(w, &st.settings);
        q.notice = q.list.is_some();
        q.grab = q.notice;
    } else if let Some(w) = q.list.filter(|_| q.notice) {
        match codes(w).into_iter().enumerate().find(|(i, _)| wid_n(ROW_ID, *i as u64) == id) {
            Some((_, c)) => {
                q.list = None;
                run(st, Act::Pick(w, c));
            }
            // The panel's gaps: nothing, but it counts as a touch.
            None if id == wid(PANEL_ID) => {}
            None => return false,
        }
    } else {
        return false;
    }
    touch_notice(st);
    true
}

fn touch_notice(st: &mut AppState) {
    let until = st.now + NOTICE_TOUCH_S;
    if let Some(n) = st.notice.as_mut() {
        n.until = n.until.max(until);
    }
}

// ---------------------------------------------------------------- drawing

/// The page area without the strip, and the strip's row when it shows.
pub fn split(st: &AppState, area: Rect) -> (Rect, Option<Rect>) {
    if !st.settings.quick_captions_open {
        return (area, None);
    }
    let (body, strip) = area.split_bottom(STRIP_H);
    (body, Some(strip))
}

/// What the strip adds to a page's height.
pub fn extra_height(st: &AppState) -> f32 {
    if st.settings.quick_captions_open {
        STRIP_H
    } else {
        0.0
    }
}

/// The "Aa" button with its right edge at `right`, centred on `cy`. Returns its left edge.
/// The "History" button of Live, Meeting and Media (PMM-023): the page's own saved records in place
/// of the page. Its right edge at `right`; returns its left edge.
pub fn history_button(ui: &mut Ui, st: &mut AppState, right: f32, cy: f32) -> f32 {
    let w = ui.pill_width("History", false, true);
    let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("qc.history"), b, "History", None, PillStyle::Utility).clicked {
        st.records.history = Some(st.page);
        st.records.page = 0;
    }
    b.x
}

/// The "Aa" button with its right edge at `right`, centred on `cy`, and History to its left.
/// Returns the left edge of both.
pub fn aa_button(ui: &mut Ui, st: &mut AppState, right: f32, cy: f32) -> f32 {
    let open = st.settings.quick_captions_open;
    let w = ui.pill_width("Aa", false, true);
    let b = Rect::new(right - w, cy - PILL_SMALL / 2.0, w, PILL_SMALL);
    if ui.pill(wid("qc.aa"), b, "Aa", None, if open { PillStyle::Primary(st.accent) } else { PillStyle::Neutral }).clicked {
        st.settings.quick_captions_open = !open;
        st.ui.quick = QuickUi::default();
        st.cmd(Command::SaveSettings);
    }
    history_button(ui, st, b.x - PILL_GAP, cy)
}

fn chip_text() -> TextStyle {
    TextStyle::caption().weight(Weight::Semibold)
}

/// The strip in `r`, its list over `page` when one is open, and their keys.
pub fn strip(ui: &mut Ui, st: &mut AppState, r: Rect, page: Rect) {
    let focused = ui.input.focused == Some(wid(KB_ID));
    let q = st.ui.quick.clone();
    let cy = r.center().y;
    let mut x = r.x;
    let mut pressed: Option<usize> = None;
    let mut act = None;
    let mut name = None;
    for (i, c) in CTLS.iter().enumerate() {
        let lang = match c {
            Ctl::Spoken => Some(Which::Spoken),
            Ctl::Into => Some(Which::Into),
            _ => None,
        };
        let chip = match lang {
            None => {
                let (label, on) = match c {
                    Ctl::Captions => ("Captions", st.capture.running()),
                    Ctl::Auto => ("Auto", st.settings.auto_captions),
                    _ => ("Translate", st.settings.translate_captions),
                };
                let tw = ui.c.measure(label, &chip_text(), 200.0).0.ceil();
                let chip = Rect::new(x, cy - CHIP_H / 2.0, CHIP_PAD + tw + 6.0 + SW_W + CHIP_PAD, CHIP_H);
                let resp = ui.button(wid_n("qc.chip", i as u64), chip);
                fill_chip(ui, chip, resp.hovered || resp.pressed, false);
                ui.c.text(label, Rect::new(chip.x + CHIP_PAD, chip.y, tw + 2.0, CHIP_H), &chip_text().color(palette::TEXT));
                draw_switch(ui.c, Rect::new(chip.right() - CHIP_PAD - SW_W, cy - SW_H / 2.0, SW_W, SW_H), on, st.accent);
                if resp.clicked {
                    pressed = Some(i);
                    act = Some(Act::Toggle(*c));
                }
                chip
            }
            Some(w) => {
                let key = if w == Which::Spoken { "Spoken" } else { "\u{2192}" };
                let lang = lang_name(current(&st.settings, w));
                let kw = ui.c.measure(key, &chip_text(), 200.0).0.ceil();
                let nw = ui.c.measure(&lang, &chip_text(), 200.0).0.ceil() + 10.0;
                let chip = Rect::new(x, cy - CHIP_H / 2.0, CHIP_PAD + kw + 4.0 + STEP + nw + STEP + 4.0, CHIP_H);
                fill_chip(ui, chip, false, q.list == Some(w));
                ui.c.text(key, Rect::new(chip.x + CHIP_PAD, chip.y, kw + 2.0, CHIP_H), &chip_text().color(palette::TEXT_DIM));
                let minus = Rect::new(chip.x + CHIP_PAD + kw + 4.0, cy - STEP / 2.0, STEP, STEP);
                let name_r = Rect::new(minus.right(), chip.y, nw, CHIP_H);
                let plus = Rect::new(name_r.right(), cy - STEP / 2.0, STEP, STEP);
                for (n, (b, icon, d)) in [(minus, Icon::Minus, -1), (plus, Icon::Plus, 1)].into_iter().enumerate() {
                    if ui.icon_button(wid_n("qc.step", (i * 2 + n) as u64), b, icon, palette::TEXT_DIM, 11.0).clicked {
                        pressed = Some(i);
                        act = Some(Act::Step(w, d));
                    }
                }
                let resp = ui.button(wid_n("qc.name", i as u64), name_r);
                if resp.hovered || resp.pressed {
                    ui.c.fill_rrect(name_r.inset(0.0, 3.0), 8.0, Color::white(if resp.pressed { 0.10 } else { 0.06 }));
                }
                ui.c.text(&lang, name_r, &chip_text().color(palette::TEXT).center());
                if resp.clicked {
                    pressed = Some(i);
                    name = Some(w);
                }
                chip
            }
        };
        if focused && q.ring == Some(i) && q.list.is_none() {
            ui.c.stroke_rrect(chip.inset(-1.0, -1.0), CHIP_H / 2.0 + 1.0, st.accent, 1.5);
        }
        x = chip.right() + CHIP_GAP;
    }
    if let Some(i) = pressed {
        st.ui.quick.ring = Some(i);
    }
    if let Some(w) = name {
        let s = st.settings.clone();
        st.ui.quick.press_name(w, &s);
        st.ui.quick.notice = false;
    }
    if let Some(a) = act {
        run(st, a);
    }
    let mut clicked = pressed.is_some();
    if st.ui.quick.list.is_some() && !st.ui.quick.notice {
        // Anything outside the list closes it; the rows below win over this.
        if ui.button(wid("qc.scrim"), Rect::new(page.x, page.y, page.w, r.bottom() - page.y)).clicked {
            st.ui.quick.list = None;
        } else {
            let (lw, lh) = list_size(st.ui.quick.list.unwrap_or(Which::Into));
            let panel = Rect::new(page.center().x - lw / 2.0, page.y, lw, lh.min(page.h));
            ui.c.fill_rrect(panel, 14.0, crate::pages::TIP_FILL);
            ui.c.stroke_rrect(panel, 14.0, Color::white(0.14), 1.0);
            clicked |= list(ui, st, panel);
        }
    }
    keyboard(ui, st, clicked, false);
}

fn fill_chip(ui: &mut Ui, r: Rect, hover: bool, sel: bool) {
    let f = if sel {
        Color::white(0.20)
    } else if hover {
        palette::SURFACE_HOVER
    } else {
        palette::SURFACE
    };
    ui.c.fill_rrect(r, r.h / 2.0, f);
}

/// The list's panel size for `w`.
pub fn list_size(w: Which) -> (f32, f32) {
    let rows = codes(w).len().div_ceil(COLS) as f32;
    (COLS as f32 * CELL_W + 2.0 * LIST_PAD, 2.0 * LIST_PAD + LIST_HEAD + rows * ROW_H)
}

/// The open list's rows in `panel` (a [`list_size`] box). A row clicked
/// picks its language and closes the list. True when anything in it was pressed.
pub fn list(ui: &mut Ui, st: &mut AppState, panel: Rect) -> bool {
    let Some(w) = st.ui.quick.list else { return false };
    // Swallow clicks on the panel's gaps.
    let mut clicked = ui.button(wid(PANEL_ID), panel).clicked;
    let focused = ui.input.focused == Some(wid(KB_ID));
    let head = Rect::new(panel.x + LIST_PAD, panel.y + LIST_PAD, panel.w - 2.0 * LIST_PAD, LIST_HEAD - 4.0);
    let faint = TextStyle::caption().weight(Weight::Semibold).color(palette::TEXT_FAINT);
    ui.c.text(if w == Which::Spoken { "SPOKEN LANGUAGE" } else { "TRANSLATE INTO" }, head, &faint);
    ui.c.text("ESC CLOSES", head, &faint.right());
    let cur = current(&st.settings, w).to_string();
    let mut picked = None;
    for (i, code) in codes(w).into_iter().enumerate() {
        let cell = Rect::new(head.x + (i % COLS) as f32 * CELL_W, panel.y + LIST_PAD + LIST_HEAD + (i / COLS) as f32 * ROW_H, CELL_W, ROW_H).inset(2.0, 2.0);
        let resp = ui.button(wid_n(ROW_ID, i as u64), cell);
        let here = code == cur;
        let fill = if here {
            st.accent.with_alpha(0.22)
        } else if resp.pressed {
            palette::SURFACE_PRESSED
        } else if resp.hovered {
            palette::SURFACE_HOVER
        } else {
            palette::SURFACE
        };
        ui.c.fill_rrect(cell, cell.h / 2.0, fill);
        if focused && st.ui.quick.sel == i {
            ui.c.stroke_rrect(cell, cell.h / 2.0, st.accent, 1.5);
        }
        let text = Rect::new(cell.x + 8.0, cell.y, cell.w - 26.0, cell.h);
        ui.c.text(&lang_name(code), text, &TextStyle::caption().weight(Weight::Semibold).color(if here { st.accent } else { palette::TEXT }));
        if here {
            ui.c.icon(Icon::Check, Rect::from_center(Point::new(cell.right() - 11.0, cell.center().y), 11.0, 11.0), st.accent);
        }
        if resp.clicked {
            picked = Some(code);
        }
    }
    if let Some(c) = picked {
        clicked = true;
        st.ui.quick.list = None;
        run(st, Act::Pick(w, c));
    }
    clicked
}

/// The strip's and the list's keys this frame. `clicked`: a control was
/// pressed (the strip takes the keyboard). On the pop-up (`notice`) Esc
/// closes the list and lets go of the keyboard, and once no list is open the
/// keyboard goes back; on a page Esc closes the list first, as the Menu does.
pub fn keyboard(ui: &mut Ui, st: &mut AppState, clicked: bool, notice: bool) {
    let id = wid(KB_ID);
    let clicked = clicked || std::mem::take(&mut st.ui.quick.grab);
    let esc_closes = !notice && st.ui.quick.list.is_some() && ui.input.keys.contains(&KeyInput::Escape);
    if esc_closes {
        ui.input.keys.retain(|k| *k != KeyInput::Escape);
    }
    let keys = ui.key_focus(id, clicked);
    if esc_closes {
        st.ui.quick.list = None;
        ui.key_focus(id, true);
    }
    let touched = !keys.is_empty();
    for k in keys {
        let s = st.settings.clone();
        if let Some(a) = st.ui.quick.key(k, &s) {
            run(st, a);
        }
    }
    if notice {
        if touched {
            touch_notice(st);
        }
        if st.ui.quick.list.is_none() {
            st.ui.quick.notice = false;
            if ui.input.focused == Some(id) {
                ui.blur();
            }
        }
    }
    if ui.input.focused != Some(id) {
        st.ui.quick.ring = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s() -> Settings {
        Settings::default()
    }

    #[test]
    fn the_lists_offer_twelve_languages_and_spoken_also_auto() {
        assert_eq!(codes(Which::Into).len(), 12);
        assert_eq!(codes(Which::Spoken).len(), 13);
        assert_eq!(codes(Which::Spoken)[0], "auto");
        assert_eq!(codes(Which::Into)[0], "en");
    }

    #[test]
    fn tab_walks_left_to_right_and_wraps() {
        let mut q = QuickUi::default();
        let mut seen = Vec::new();
        for _ in 0..6 {
            q.key(KeyInput::Tab, &s());
            seen.push(q.ring.unwrap());
        }
        assert_eq!(seen, [1, 2, 3, 4, 0, 1]);
    }

    #[test]
    fn space_toggles_a_switch_and_arrows_step_a_language() {
        let mut q = QuickUi::default();
        assert_eq!(q.key(KeyInput::Char(' '), &s()), Some(Act::Toggle(Ctl::Captions)));
        q.ring = Some(1);
        assert_eq!(q.key(KeyInput::Char(' '), &s()), Some(Act::Toggle(Ctl::Auto)));
        assert_eq!(q.key(KeyInput::Left, &s()), None, "arrows do nothing on a switch");
        q.ring = Some(3);
        assert_eq!(q.key(KeyInput::Right, &s()), Some(Act::Step(Which::Spoken, 1)));
        q.ring = Some(4);
        assert_eq!(q.key(KeyInput::Left, &s()), Some(Act::Step(Which::Into, -1)));
    }

    #[test]
    fn a_name_opens_its_list_on_the_current_one_and_esc_closes_it() {
        let mut st = s();
        st.target_lang = "ja".into();
        let mut q = QuickUi::default();
        q.press_name(Which::Into, &st);
        assert_eq!((q.list, q.sel), (Some(Which::Into), 3));
        q.key(KeyInput::Escape, &st);
        assert_eq!(q.list, None);
        // Space on Spoken opens its list; Auto-detect (the default) is row 0.
        q.ring = Some(3);
        q.key(KeyInput::Char(' '), &st);
        assert_eq!((q.list, q.sel), (Some(Which::Spoken), 0));
        // Pressing the open name again closes it.
        q.press_name(Which::Spoken, &st);
        assert_eq!(q.list, None);
    }

    #[test]
    fn enter_in_the_list_picks_and_closes() {
        let st = s();
        let mut q = QuickUi::default();
        q.open(Which::Spoken, &st);
        q.key(KeyInput::Down, &st);
        q.key(KeyInput::Right, &st);
        // Row two of the board's grid: Japanese, Korean, Spanish, French.
        assert_eq!(q.key(KeyInput::Enter, &st), Some(Act::Pick(Which::Spoken, "ko")));
        assert_eq!(q.list, None);
    }

    #[test]
    fn the_grid_moves_by_rows_of_four_and_stops_at_its_ends() {
        assert_eq!(grid_nav(0, 13, KeyInput::Left), 0);
        assert_eq!(grid_nav(0, 13, KeyInput::Down), 4);
        assert_eq!(grid_nav(9, 13, KeyInput::Down), 9, "no row below");
        assert_eq!(grid_nav(8, 13, KeyInput::Down), 12);
        assert_eq!(grid_nav(2, 13, KeyInput::Up), 2);
        assert_eq!(grid_nav(12, 13, KeyInput::Right), 12);
        assert_eq!((grid_nav(5, 12, KeyInput::Home), grid_nav(5, 12, KeyInput::End)), (0, 11));
    }

    #[test]
    fn acts_write_the_settings_advanced_settings_writes() {
        let mut st = s();
        assert!(apply(&mut st, Act::Toggle(Ctl::Auto)) && !st.auto_captions);
        assert!(apply(&mut st, Act::Toggle(Ctl::Translate)) && !st.translate_captions);
        assert!(apply(&mut st, Act::Step(Which::Spoken, -1)));
        assert_eq!(st.source_lang, "vi", "auto steps back to the last language");
        assert!(apply(&mut st, Act::Step(Which::Into, 1)));
        assert_eq!(st.target_lang, "id");
        assert!(apply(&mut st, Act::Pick(Which::Into, "ja")));
        assert_eq!(st.target_lang, "ja");
        let before = st.clone();
        assert!(!apply(&mut st, Act::Toggle(Ctl::Captions)), "captions on/off is a command, not a setting");
        assert_eq!(st, before);
    }

    #[test]
    fn the_pop_up_shows_the_target_only_while_translating() {
        let mut st = s();
        st.target_lang = "zh".into();
        assert_eq!(notice_langs(&st), ("Auto-detect".to_string(), Some("Chinese".to_string())));
        st.translate_captions = false;
        assert_eq!(notice_langs(&st), ("Auto-detect".to_string(), None));
    }

    #[test]
    fn a_press_on_the_pop_up_opens_its_list_picks_and_keeps_it() {
        let mut st = AppState::new(Settings::default(), Default::default());
        st.now = 100.0;
        st.notify(Icon::Lyrics, palette::GREEN, "Captions on", "Translating", 8.0, None);
        assert!(notice_press(&mut st, wid(NOTICE_INTO)));
        assert_eq!((st.ui.quick.list, st.ui.quick.notice, st.ui.quick.grab), (Some(Which::Into), true, true));
        st.now = 105.0;
        assert!(notice_press(&mut st, wid_n(ROW_ID, 3)));
        assert_eq!(st.settings.target_lang, "ja");
        assert_eq!(st.ui.quick.list, None);
        assert_eq!(st.notice.as_ref().unwrap().until, 113.0, "8 s after the last touch");
        assert!(!notice_press(&mut st, wid_n(ROW_ID, 3)), "no list open: a row id is not this pop-up's");
        assert!(!notice_press(&mut st, wid("notice")));
    }
}
