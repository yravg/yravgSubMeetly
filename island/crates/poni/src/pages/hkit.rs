//! Drawing the meeting pages share: the message a page shows in place of
//! its content when the helper is offline, the meeting is empty or there is
//! nothing to follow (`poni_core::helper::PageState`), and the item chips.

use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::PageKind;
use crate::ui::{wid, wid_n, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use poni_core::geom::{palette, Color, Point, Rect};
use crate::commands::Command;
use crate::state::AppState;
use poni_core::engine_link;
use poni_core::helper::{self, Kind, Link};

/// Height of the block [`message`] draws.
pub const MESSAGE_H: f32 = 56.0;

/// A disc with an icon, a title, a line under it, and a button at the right.
/// Centred in `area`. Returns true when the button was pressed.
#[allow(clippy::too_many_arguments)]
pub fn message(ui: &mut Ui, area: Rect, accent: Color, icon: Icon, title: &str, line: &str, bad: bool, button: Option<(&str, u64)>) -> bool {
    block(ui, area, accent, Some(icon), title, line, bad, button)
}

/// [`message`] with a turning arc in the disc instead of an icon (`None`): something on its way.
#[allow(clippy::too_many_arguments)]
fn block(ui: &mut Ui, area: Rect, accent: Color, icon: Option<Icon>, title: &str, line: &str, bad: bool, button: Option<(&str, u64)>) -> bool {
    let top = area.y + ((area.h - MESSAGE_H) / 2.0).max(0.0);
    let c = Point::new(area.x + 18.0, top + 20.0);
    let tone = if bad { palette::ORANGE } else { accent };
    ui.c.fill_circle(c, 18.0, tone.with_alpha(0.22));
    match icon {
        Some(icon) => ui.c.icon(icon, Rect::from_center(c, 20.0, 20.0), tone),
        None => {
            ui.c.stroke_circle(c, 9.0, tone.with_alpha(0.25), 2.5);
            ui.c.arc(c, 9.0, (ui.now * 0.9).fract() as f32, 0.28, tone, 2.5);
            ui.request_anim();
        }
    }
    let mut right = area.right();
    let mut clicked = false;
    if let Some((label, id)) = button {
        let w = ui.pill_width(label, false, true);
        let b = Rect::new(right - w, top + 20.0 - PILL_SMALL / 2.0, w, PILL_SMALL);
        clicked = ui.pill(id, b, label, None, PillStyle::Primary(accent)).clicked;
        right = b.x - 12.0;
    }
    let x = area.x + 48.0;
    let w = (right - x).max(0.0);
    ui.c.text(title, Rect::new(x, top, w, 20.0), &TextStyle::headline());
    ui.c.text(line, Rect::new(x, top + 22.0, w, 34.0), &TextStyle::footnote().color(palette::TEXT_DIM).wrap().top());
    clicked
}

/// The page shown while the engine does not answer: what the supervisor is
/// doing (`poni_core::engine_link::offline_message`) and a Try again button,
/// which also asks it to start the engine. Draws in `area`.
pub fn offline(ui: &mut Ui, st: &mut AppState, area: Rect, retry_id: u64) {
    let why = match &st.helper.link {
        Link::Offline(why) => why.as_str(),
        _ => "no answer yet",
    };
    let (title, line, bad) = engine_link::offline_message(&st.engine, why, helper::configured_port());
    // Starting or connecting is not a fault: a spinner, no error icon, nothing to retry.
    if !bad {
        block(ui, area, st.accent, None, title, &line, false, None);
    } else if message(ui, area, st.accent, Icon::Unlink, title, &line, bad, Some(("Try again", retry_id))) {
        st.cmd(Command::HelperPoll);
    }
}

pub fn kind_color(k: Kind) -> Color {
    match k {
        Kind::Decision => palette::BLUE,
        Kind::Action => palette::GREEN,
        Kind::Question => palette::PURPLE,
        Kind::Risk => palette::ORANGE,
        Kind::Metric => palette::CYAN,
        Kind::Info => palette::TEXT_DIM,
    }
}

/// A small label in the kind's colour, left of an item's text. Returns its width.
pub fn kind_chip(ui: &mut Ui, x: f32, cy: f32, k: Kind) -> f32 {
    chip(ui, x, cy, k.label(), kind_color(k))
}

/// A tinted capsule with `label` from `x`, centred on `cy`. Returns its width.
pub fn chip(ui: &mut Ui, x: f32, cy: f32, label: &str, color: Color) -> f32 {
    let st = TextStyle::caption().weight(Weight::Semibold).color(color);
    let w = ui.c.measure(label, &st, 200.0).0.ceil() + 12.0;
    let r = Rect::new(x, cy - 9.0, w, 18.0);
    ui.c.fill_rrect(r, 9.0, color.with_alpha(0.16));
    ui.c.text(label, r, &st.center());
    w
}

/// Height of the row [`guide`] draws, with its gap to the content.
pub const GUIDE_H: f32 = 26.0;
const NAV_GAP: f32 = 14.0;

/// The meeting pages in the order a meeting goes: the plan, the room, the notes, what is left.
const STEPS: [(PageKind, &str); 6] = [(PageKind::Calendar, "Today"), (PageKind::Live, "Live"), (PageKind::Call, "Meeting"), (PageKind::Meeting, "Minutes"), (PageKind::Inbox, "Inbox"), (PageKind::Timer, "Agenda")];

/// What this page is for (one line, left) and the way to the other meeting
/// pages (right, the open one marked). The nav is dropped when it would
/// leave the purpose too little room. Returns the area under the row.
pub fn guide(ui: &mut Ui, st: &mut AppState, area: Rect, page: PageKind, purpose: &str) -> Rect {
    let row = Rect::new(area.x, area.y, area.w, GUIDE_H - 6.0);
    let tabs = super::tabs(st);
    let steps: Vec<(PageKind, &str)> = STEPS.into_iter().filter(|(p, _)| tabs.contains(p)).collect();
    let on = TextStyle::caption().weight(Weight::Semibold).color(st.accent);
    let off = TextStyle::caption().weight(Weight::Regular).color(palette::TEXT_DIM);
    let widths: Vec<f32> = steps.iter().map(|(p, l)| ui.c.measure(l, if *p == page { &on } else { &off }, 200.0).0.ceil()).collect();
    let nav_w = widths.iter().sum::<f32>() + NAV_GAP * steps.len().saturating_sub(1) as f32;
    let show_nav = steps.len() > 1 && row.w - nav_w - 12.0 >= 260.0;
    let purpose_w = if show_nav { row.w - nav_w - 12.0 } else { row.w };
    ui.c.text(purpose, Rect::new(row.x, row.y, purpose_w, row.h), &off);
    if show_nav {
        let mut x = row.right() - nav_w;
        for (i, ((p, label), w)) in steps.iter().zip(&widths).enumerate() {
            let r = Rect::new(x, row.y, *w, row.h);
            if *p == page {
                ui.c.text(label, r, &on);
            } else {
                let resp = ui.button(wid_n("guide.nav", i as u64), r.inset(-4.0, 0.0));
                ui.c.text(label, r, &off.clone().color(if resp.hovered { palette::TEXT } else { palette::TEXT_DIM }));
                if resp.clicked {
                    st.go_tab(*p);
                }
            }
            x += w + NAV_GAP;
        }
    }
    Rect::new(area.x, area.y + GUIDE_H, area.w, (area.h - GUIDE_H).max(0.0))
}

/// The colour of the translated line:the person's pick on a light island
/// (the swatches are made for white), cyan on the dark ones.
pub fn translation_color(ui: &Ui, pick: poni_core::settings::TranslationColor) -> Color {
    if ui.c.look().light {
        let v = pick.rgb();
        Color::hex(v)
    } else {
        palette::CYAN
    }
}

/// How many pages `n` rows fill at `per` a page (at least 1).
pub fn pages(n: usize, per: usize) -> usize {
    n.div_ceil(per.max(1)).max(1)
}

/// "‹  2 / 3  ›" ending at `right`, centred on `cy`; `label` (e.g. "Meeting") goes before the
/// numbers when given. Returns the step pressed (-1 / +1) and the x where it starts.
pub fn pager(ui: &mut Ui, right: f32, cy: f32, id: &str, at: usize, of: usize, label: &str) -> (Option<i32>, f32) {
    let mut step = None;
    let mut x = right;
    let next = ui.pill_width("\u{203a}", false, true);
    let b = Rect::new(x - next, cy - PILL_SMALL / 2.0, next, PILL_SMALL);
    if at < of && ui.pill(wid(&format!("{id}.next")), b, "\u{203a}", None, PillStyle::Utility).clicked {
        step = Some(1);
    }
    x = b.x - PILL_GAP;
    let text = if label.is_empty() { format!("{at} / {of}") } else { format!("{label} {at} / {of}") };
    let st = TextStyle::footnote().color(palette::TEXT_DIM);
    let w = ui.c.measure(&text, &st, 200.0).0.ceil();
    ui.c.text(&text, Rect::new(x - w, cy - 9.0, w, 18.0), &st);
    x -= w + PILL_GAP;
    let prev = ui.pill_width("\u{2039}", false, true);
    let b = Rect::new(x - prev, cy - PILL_SMALL / 2.0, prev, PILL_SMALL);
    if at > 1 && ui.pill(wid(&format!("{id}.prev")), b, "\u{2039}", None, PillStyle::Utility).clicked {
        step = Some(-1);
    }
    (step, b.x)
}

