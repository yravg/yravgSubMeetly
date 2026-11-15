//! Kasi on the island: [`poni_core::kasi`]'s head mark drawn with the
//! canvas, in the brand's flat colours (unthemed, so Paper's colour swaps
//! leave them alone). The Kasi resting look draws it beside the time
//! (`pill::idle`, `activities`); around a MacBook's notch it peeks out
//! beside the camera (`mac/notch.rs`).

use crate::gfx::Canvas;
use crate::state::AppState;
use crate::ui::Ui;
use poni_core::geom::Point;
use poni_core::kasi::{self, Pose};

/// The mark's width at rest (the landing page's 28 px box in a 32 px
/// pill); it stands `kasi::height(MARK_W)` tall.
pub const MARK_W: f32 = 28.0;
/// From the mark's box to the time beside it.
pub const MARK_GAP: f32 = 6.0;

/// The mark in `pose`, `w` DIPs wide, its box centred on `centre`.
pub fn draw(c: &mut Canvas, centre: Point, w: f32, pose: &Pose) {
    c.unthemed(|c| {
        for sh in kasi::place(kasi::mark(pose), centre, w) {
            c.path(&sh.segs, sh.fill, sh.stroke);
        }
    });
}

/// The resting Kasi at `centre`, its eyes turned `gaze` (-1 to 1 each way):
/// it blinks on its own wakes (`activities::next_wake`) and draws frames
/// while an ear twitches.
pub fn draw_resting(ui: &mut Ui, st: &AppState, centre: Point, gaze: (f32, f32)) {
    if kasi::moving(st.now) {
        ui.request_anim();
    }
    draw(ui.c, centre, MARK_W, &kasi::rest(st.now).looking(gaze));
}

/// Where the eyes look for a pointer over the island: toward it, across
/// (`None` = straight ahead).
pub fn gaze_at(pointer: Option<Point>, centre: Point, reach: f32) -> (f32, f32) {
    pointer.map_or((0.0, 0.0), |p| (((p.x - centre.x) / reach.max(1.0)).clamp(-1.0, 1.0), 0.0))
}
