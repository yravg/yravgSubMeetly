//! Drawing the meeting pages share: the message a page shows in place of
//! its content when the helper is offline, the meeting is empty or there is
//! nothing to follow (`poni_core::helper::PageState`), and the item chips.

use crate::gfx::{TextStyle, Weight};
use crate::icons::Icon;
use crate::ui::{PillStyle, Ui, PILL_SMALL};
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
    let st = TextStyle::caption().weight(Weight::Semibold).color(kind_color(k));
    let w = ui.c.measure(k.label(), &st, 200.0).0.ceil() + 12.0;
    let r = Rect::new(x, cy - 9.0, w, 18.0);
    ui.c.fill_rrect(r, 9.0, kind_color(k).with_alpha(0.16));
    ui.c.text(k.label(), r, &st.center());
    w
}

/// The colour of the translated line: the person's pick on a light island
/// (the swatches are made for white), cyan on the dark ones.
pub fn translation_color(ui: &Ui, pick: poni_core::settings::TranslationColor) -> Color {
    if ui.c.look().light {
        let v = pick.rgb();
        Color::hex(v)
    } else {
        palette::CYAN
    }
}
