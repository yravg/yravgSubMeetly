//! The header's Menu: a button left of the tab row that lists every page by
//! name with its icon, so nobody has to guess what a bare tab icon opens.
//!
//! Pointer: click the button, click a row. Keyboard (once the header has the
//! keyboard, which a click on the button gives it): Left/Right/Tab move a
//! focus ring over the Menu button and the tabs, Enter opens; in the list
//! Up/Down/Left/Right/Tab move, Enter opens, Esc closes. The pure parts
//! (which pages, how the keys move) are tested below.

use super::PageKind;
use crate::commands::Command;
use crate::gfx::TextStyle;
use crate::state::AppState;
use crate::ui::{wid, wid_n, KeyInput, Ui};
use poni_core::geom::{palette, Color, Rect};

/// Width the Menu button takes at the left of the tab row (button + gap).
pub const SLOT: f32 = 32.0;
/// List columns, filled top to bottom: board order reads down, then across.
const COLS: usize = 3;
const ROW_H: f32 = 28.0;
const COL_W: f32 = 150.0;
const PANEL_PAD: f32 = 8.0;
const ICON: f32 = 16.0;
/// The id the header's keyboard focus lives under.
pub const KEY_ID: &str = "header.kb";

/// Menu state kept between frames.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MenuUi {
    pub open: bool,
    /// The list row the keyboard is on.
    pub sel: usize,
    /// The header's focus ring: 0 = the Menu button, n = the n-th tab. None = the keyboard is elsewhere.
    pub ring: Option<usize>,
}

/// Every page the list names: the tab row's order (the board's), then
/// Settings, which has the gear rather than a tab.
pub fn pages(st: &AppState) -> Vec<PageKind> {
    let mut v = super::tabs(st);
    v.push(PageKind::Settings);
    v
}

fn rows(n: usize) -> usize {
    n.div_ceil(COLS).max(1)
}

/// Where the keys Up/Down/Left/Right/Tab/Home/End take row `sel` of `n`.
pub fn nav(sel: usize, n: usize, key: KeyInput) -> usize {
    if n == 0 {
        return 0;
    }
    let r = rows(n);
    let last = n - 1;
    match key {
        KeyInput::Down | KeyInput::Tab => (sel + 1) % n,
        KeyInput::Up => (sel + n - 1) % n,
        KeyInput::Right => (sel + r).min(last),
        KeyInput::Left => sel.saturating_sub(r),
        KeyInput::Home => 0,
        KeyInput::End => last,
        _ => sel,
    }
}

/// The ring over the Menu button (0) and `tabs` tabs (1..=tabs).
pub fn ring_nav(cur: usize, tabs: usize, key: KeyInput) -> usize {
    let n = tabs + 1;
    match key {
        KeyInput::Right | KeyInput::Tab => (cur + 1) % n,
        KeyInput::Left => (cur + n - 1) % n,
        KeyInput::Home => 0,
        KeyInput::End => n - 1,
        _ => cur,
    }
}

impl MenuUi {
    /// One key. `list` = the pages the list names, `tabs` = the tab row.
    /// Returns the page to open, if the key chose one. Esc is the caller's
    /// (it closes the list but keeps the keyboard).
    pub fn key(&mut self, k: KeyInput, list: &[PageKind], tabs: &[PageKind], current: PageKind) -> Option<PageKind> {
        if self.open {
            match k {
                KeyInput::Enter => {
                    self.open = false;
                    return list.get(self.sel).copied();
                }
                _ => self.sel = nav(self.sel, list.len(), k),
            }
            return None;
        }
        let ring = self.ring.unwrap_or(0).min(tabs.len());
        match k {
            KeyInput::Enter => {
                if ring == 0 {
                    self.open_at(list, current);
                } else {
                    return tabs.get(ring - 1).copied();
                }
            }
            KeyInput::Down => self.open_at(list, current),
            _ => self.ring = Some(ring_nav(ring, tabs.len(), k)),
        }
        None
    }

    /// Open the list with the current page selected.
    pub fn open_at(&mut self, list: &[PageKind], current: PageKind) {
        self.open = true;
        self.sel = list.iter().position(|p| *p == current).unwrap_or(0);
    }
}

/// Run the header's keyboard and the Menu button's click for this frame.
pub(crate) fn keyboard(ui: &mut Ui, st: &mut AppState, clicked: bool, row: &[PageKind]) {
    let id = wid(KEY_ID);
    let list = pages(st);
    if clicked {
        if st.ui.menu.open {
            st.ui.menu.open = false;
        } else {
            let page = st.page;
            st.ui.menu.open_at(&list, page);
        }
    }
    // Esc closes the list but keeps the keyboard; a second Esc lets go.
    let esc_closes = st.ui.menu.open && ui.input.keys.contains(&KeyInput::Escape);
    if esc_closes {
        ui.input.keys.retain(|k| *k != KeyInput::Escape);
    }
    let keys = ui.key_focus(id, clicked);
    if esc_closes {
        st.ui.menu.open = false;
        st.ui.menu.ring = Some(0);
        ui.key_focus(id, true);
    }
    if ui.input.focused != Some(id) {
        st.ui.menu = MenuUi::default();
        return;
    }
    if clicked && st.ui.menu.ring.is_none() {
        st.ui.menu.ring = Some(0);
    }
    for k in keys {
        let page = st.page;
        if let Some(p) = st.ui.menu.key(k, &list, row, page) {
            go(st, p);
        }
    }
}

fn go(st: &mut AppState, p: PageKind) {
    if p == st.page {
        return;
    }
    if p == PageKind::Settings {
        st.ui.before_settings = Some(st.page);
    }
    st.cmd(Command::SetPage(p));
}

/// The open list, over the page. Call after the page is drawn.
pub(crate) fn draw_list(ui: &mut Ui, st: &mut AppState, body: Rect, header: Rect, page: PageKind) {
    if !st.ui.menu.open {
        return;
    }
    let list = pages(st);
    let n = list.len();
    let r = rows(n);
    let scale = ui.c.scale().max(0.5);
    // Anything outside the list closes it; the rows below win over this.
    if ui.button(wid("menu.scrim"), body).clicked {
        st.ui.menu.open = false;
        return;
    }
    let cols = n.div_ceil(r);
    let w = (cols as f32 * COL_W + 2.0 * PANEL_PAD).min(body.w - 2.0 * super::PAD);
    let h = r as f32 * ROW_H + 2.0 * PANEL_PAD;
    let panel = Rect::new(super::snap(header.x, scale), super::snap(header.bottom() + 2.0, scale), w, h);
    ui.c.fill_rrect(panel, 14.0, super::TIP_FILL);
    ui.c.stroke_rrect(panel, 14.0, Color::white(0.14), 1.0);
    // Swallow clicks on the panel's gaps.
    let _ = ui.button(wid("menu.panel"), panel);
    let colw = (w - 2.0 * PANEL_PAD) / cols as f32;
    let name = TextStyle::body();
    for (i, p) in list.iter().enumerate() {
        let (col, row) = (i / r, i % r);
        let cell = Rect::new(panel.x + PANEL_PAD + col as f32 * colw, panel.y + PANEL_PAD + row as f32 * ROW_H, colw, ROW_H);
        let resp = ui.button(wid_n("menu.row", i as u64), cell);
        let here = *p == page;
        if resp.hovered || resp.pressed {
            ui.c.fill_rrect(cell, 8.0, if resp.pressed { palette::SURFACE_PRESSED } else { palette::SURFACE_HOVER });
        } else if here {
            ui.c.fill_rrect(cell, 8.0, palette::SURFACE);
        }
        if st.ui.menu.sel == i && st.ui.menu.ring.is_some() {
            ui.c.stroke_rrect(cell, 8.0, st.accent, 1.5);
        }
        let ic = Rect::new(cell.x + 8.0, super::snap(cell.center().y - ICON / 2.0, scale), ICON, ICON);
        ui.c.icon(p.icon(), ic, if here { st.accent } else { palette::TEXT_DIM });
        ui.c.text(p.title(), Rect::new(ic.right() + 8.0, cell.y, cell.right() - ic.right() - 12.0, cell.h), &name);
        if resp.clicked {
            st.ui.menu.open = false;
            go(st, *p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use poni_core::settings::Settings;
    use poni_core::store::Store;
    use PageKind::*;

    fn state() -> AppState {
        AppState::new(Settings::default(), Store::default())
    }

    #[test]
    fn the_list_names_every_page_in_board_order_then_settings() {
        let mut st = state();
        assert_eq!(pages(&st), [Live, Meeting, Inbox, Timer, Talk, Engine, Media, Shelf, Tasks, Focus, Addons, Settings]);
        // An add-on's page joins the list when it is on, as it joins the row.
        st.addons.insert(poni_core::addons::SYSTEM.id, poni_core::addons::Status::Ready);
        assert!(pages(&st).contains(&System));
        // Every page in the list has a name to show.
        assert!(pages(&st).iter().all(|p| !p.title().is_empty()));
    }

    #[test]
    fn keys_move_through_the_columns_and_wrap() {
        // 12 pages in 3 columns of 4.
        assert_eq!(nav(0, 12, KeyInput::Down), 1);
        assert_eq!(nav(11, 12, KeyInput::Down), 0);
        assert_eq!(nav(0, 12, KeyInput::Up), 11);
        assert_eq!(nav(1, 12, KeyInput::Right), 5);
        assert_eq!(nav(9, 12, KeyInput::Right), 11, "the last column may be short");
        assert_eq!(nav(5, 12, KeyInput::Left), 1);
        assert_eq!(nav(2, 12, KeyInput::Left), 0);
        assert_eq!(nav(3, 12, KeyInput::Tab), 4);
        assert_eq!((nav(5, 12, KeyInput::Home), nav(5, 12, KeyInput::End)), (0, 11));
        assert_eq!(nav(0, 0, KeyInput::Down), 0);
    }

    #[test]
    fn the_ring_walks_the_menu_button_then_the_tabs() {
        assert_eq!(ring_nav(0, 3, KeyInput::Right), 1);
        assert_eq!(ring_nav(3, 3, KeyInput::Right), 0);
        assert_eq!(ring_nav(0, 3, KeyInput::Left), 3);
        assert_eq!(ring_nav(1, 3, KeyInput::Tab), 2);
        assert_eq!((ring_nav(2, 3, KeyInput::Home), ring_nav(2, 3, KeyInput::End)), (0, 3));
    }

    #[test]
    fn enter_opens_what_the_ring_or_the_list_is_on() {
        let st = state();
        let list = pages(&st);
        let tabs = super::super::tabs(&st);
        let mut m = MenuUi { ring: Some(0), ..MenuUi::default() };
        // On the Menu button Enter opens the list on the page being shown.
        assert_eq!(m.key(KeyInput::Enter, &list, &tabs, Inbox), None);
        assert!(m.open);
        assert_eq!(list[m.sel], Inbox);
        // In the list Down moves, Enter opens that page and closes the list.
        m.key(KeyInput::Down, &list, &tabs, Inbox);
        assert_eq!(m.key(KeyInput::Enter, &list, &tabs, Inbox), Some(list[m.sel]));
        assert!(!m.open);
        // On a tab Enter opens that tab's page.
        let mut m = MenuUi { ring: Some(0), ..MenuUi::default() };
        m.key(KeyInput::Right, &list, &tabs, Live);
        m.key(KeyInput::Right, &list, &tabs, Live);
        assert_eq!(m.ring, Some(2));
        assert_eq!(m.key(KeyInput::Enter, &list, &tabs, Live), Some(tabs[1]));
        // Settings is in the list even though it has no tab.
        let mut m = MenuUi::default();
        m.open_at(&list, Live);
        m.key(KeyInput::End, &list, &tabs, Live);
        assert_eq!(m.key(KeyInput::Enter, &list, &tabs, Live), Some(Settings));
    }
}
