//! Kasi, the yravgSubMeetly tarsier, as the resting island draws it: the
//! head **mark** of `site/kasi.js` (`Kasi.svg({ pose: 'mark' })`, the
//! source of truth): two spoon ears with their inner ear and ridges, the
//! curl on top, the head, the cream face plate, two big ink eyes with their
//! highlights and the nose. No amber rims and no mouth: the brand's rule
//! below 64 px and inside the 32 px resting pill. Never the eyes alone.
//!
//! The shapes are in the drawing's own units (the head centre at the
//! origin, `viewBox="-104 -118 208 190"`), the same numbers as kasi.js, so a
//! change there is a change here. [`place`] scales them to the screen.
//!
//! Motion, after the brand sheet: a blink of 120 ms every 2.4 to 6 s, and
//! now and then one ear twitches up by 7 degrees and settles. Both come
//! from fixed, uneven sequences, so the island wakes for them one shot at a
//! time ([`next_change`]) instead of polling.

use crate::geom::{Color, Point};
use crate::svgpath::Seg;

/// The flat colours (kasi.js `C`).
pub const FUR: Color = Color::hex(0xC7864E);
pub const SHADE: Color = Color::hex(0xA0653A);
pub const DEEP: Color = Color::hex(0x7E4A26);
pub const EAR: Color = Color::hex(0xE2AE7F);
pub const FACE: Color = Color::hex(0xFFF0D9);
pub const INK: Color = Color::hex(0x1B120B);
pub const HI: Color = Color::hex(0xFFFFFF);

/// The mark's box in drawing units (kasi.js's head `viewBox`).
pub const VIEW_X: f32 = -104.0;
pub const VIEW_Y: f32 = -118.0;
pub const VIEW_W: f32 = 208.0;
pub const VIEW_H: f32 = 190.0;

/// The ears' resting angle out from upright (kasi.js `earAngle`).
const EAR_ANGLE: f32 = 36.0;
const EAR_LEN: f32 = 70.0;
const EAR_W: f32 = 72.0;
/// The mark's eyes (kasi.js `small`): radius and centres.
const EYE_R: f32 = 32.0;
const EYE_X: f32 = 33.5;
const EYE_Y: f32 = 2.0;
/// How far the eyes move toward what they look at, at gaze 1 (drawing
/// units; kasi.js moves the pupils 3.4, which a 28 px mark can't show).
const GAZE: f32 = 7.0;

/// One moment of the mark: whether the eyes are shut (the blink's lash
/// line), each ear's turn on top of the resting angle (degrees, negative =
/// more upright), and where the eyes look (-1 to 1 each way).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub blink: bool,
    pub ear_l: f32,
    pub ear_r: f32,
    pub gaze: (f32, f32),
}

impl Pose {
    pub const REST: Pose = Pose { blink: false, ear_l: 0.0, ear_r: 0.0, gaze: (0.0, 0.0) };

    pub fn looking(self, gaze: (f32, f32)) -> Pose {
        Pose { gaze: (gaze.0.clamp(-1.0, 1.0), gaze.1.clamp(-1.0, 1.0)), ..self }
    }
}

/// A filled or stroked path in drawing units.
#[derive(Clone, Debug, PartialEq)]
pub struct Shape {
    pub segs: Vec<Seg>,
    pub fill: Option<Color>,
    /// Colour and width (drawing units); round caps, as both renderers stroke.
    pub stroke: Option<(Color, f32)>,
}

fn fill(segs: Vec<Seg>, c: Color) -> Shape {
    Shape { segs, fill: Some(c), stroke: None }
}

fn stroke(segs: Vec<Seg>, c: Color, w: f32) -> Shape {
    Shape { segs, fill: None, stroke: Some((c, w)) }
}

/// A 2-D affine map: (x, y) -> (a x + c y + e, b x + d y + f).
#[derive(Clone, Copy, Debug)]
struct Xf {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
}

impl Xf {
    const ID: Xf = Xf { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    fn translate(x: f32, y: f32) -> Xf {
        Xf { e: x, f: y, ..Xf::ID }
    }

    /// SVG's `rotate(deg)`: clockwise on a y-down screen.
    fn rotate(deg: f32) -> Xf {
        let (s, c) = deg.to_radians().sin_cos();
        Xf { a: c, b: s, c: -s, d: c, e: 0.0, f: 0.0 }
    }

    /// `self` after `o` (SVG's `transform="self o"`).
    fn then(self, o: Xf) -> Xf {
        Xf {
            a: self.a * o.a + self.c * o.b,
            b: self.b * o.a + self.d * o.b,
            c: self.a * o.c + self.c * o.d,
            d: self.b * o.c + self.d * o.d,
            e: self.a * o.e + self.c * o.f + self.e,
            f: self.b * o.e + self.d * o.f + self.f,
        }
    }

    fn pt(&self, x: f32, y: f32) -> (f32, f32) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }

    fn apply(&self, segs: &[Seg]) -> Vec<Seg> {
        segs.iter()
            .map(|s| match *s {
                Seg::MoveTo(x, y) => {
                    let (x, y) = self.pt(x, y);
                    Seg::MoveTo(x, y)
                }
                Seg::LineTo(x, y) => {
                    let (x, y) = self.pt(x, y);
                    Seg::LineTo(x, y)
                }
                Seg::QuadTo(x1, y1, x, y) => {
                    let ((x1, y1), (x, y)) = (self.pt(x1, y1), self.pt(x, y));
                    Seg::QuadTo(x1, y1, x, y)
                }
                Seg::CubicTo(x1, y1, x2, y2, x, y) => {
                    let ((x1, y1), (x2, y2), (x, y)) = (self.pt(x1, y1), self.pt(x2, y2), self.pt(x, y));
                    Seg::CubicTo(x1, y1, x2, y2, x, y)
                }
                // The mark has no arcs; a uniform map keeps one as it is.
                Seg::ArcTo(rx, ry, rot, large, sweep, x, y) => {
                    let (x, y) = self.pt(x, y);
                    Seg::ArcTo(rx, ry, rot, large, sweep, x, y)
                }
                Seg::Close => Seg::Close,
            })
            .collect()
    }
}

/// An ellipse as four cubics (no arcs, so every renderer draws it alike).
fn ellipse(cx: f32, cy: f32, rx: f32, ry: f32) -> Vec<Seg> {
    const K: f32 = 0.552_284_8;
    let (kx, ky) = (K * rx, K * ry);
    vec![
        Seg::MoveTo(cx + rx, cy),
        Seg::CubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
        Seg::CubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
        Seg::CubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
        Seg::CubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
        Seg::Close,
    ]
}

/// kasi.js `spoon(L, W, tip)`: the ear, its base at the origin and its tip
/// at (0, -L).
fn spoon(l: f32, w_full: f32, tip: f32) -> Vec<Seg> {
    let w = w_full / 2.0;
    vec![
        Seg::MoveTo(-w * 0.62, 4.0),
        Seg::CubicTo(-w, -l * 0.35, -w * 1.04, -l * 0.78, -w_full * tip * 0.5, -l * 0.97),
        Seg::QuadTo(0.0, -l * 1.04, w_full * tip * 0.5, -l * 0.97),
        Seg::CubicTo(w * 1.04, -l * 0.78, w, -l * 0.35, w * 0.62, 4.0),
        Seg::QuadTo(0.0, w_full * 0.2, -w * 0.62, 4.0),
        Seg::Close,
    ]
}

/// kasi.js `ear(side)` facing front: the base beside the curl, turned out
/// by the resting angle plus `turn`.
fn ear(side: f32, turn: f32, out: &mut Vec<Shape>) {
    let (l, w) = (EAR_LEN, EAR_W);
    let xf = Xf::translate(34.0 * side, -42.0).then(Xf::rotate((EAR_ANGLE + turn) * side));
    out.push(fill(xf.apply(&spoon(l, w, 0.65)), FUR));
    out.push(fill(xf.then(Xf::translate(0.0, -8.0)).apply(&spoon(l * 0.74, w * 0.6, 0.7)), EAR));
    let ridges = [
        Seg::MoveTo(-w * 0.17, -l * 0.42),
        Seg::QuadTo(0.0, -l * 0.5, w * 0.17, -l * 0.42),
        Seg::MoveTo(-w * 0.14, -l * 0.62),
        Seg::QuadTo(0.0, -l * 0.69, w * 0.14, -l * 0.62),
    ];
    out.push(stroke(xf.apply(&ridges), SHADE, 3.0));
}

/// kasi.js `eye(side)` for the mark: an ink disc as big as the eye, its two
/// highlights, or the blink's lash line.
fn eye(side: f32, p: &Pose, out: &mut Vec<Shape>) {
    let (cx, cy, r) = (EYE_X * side, EYE_Y, EYE_R);
    if p.blink {
        // A fully shut eye is a lash line, not a fur disc (a disc reads as sunglasses).
        let line = vec![Seg::MoveTo(cx - r * 0.62, cy + 2.0), Seg::QuadTo(cx, cy + r * 0.42, cx + r * 0.62, cy + 2.0)];
        out.push(stroke(line, DEEP, 5.0));
        return;
    }
    let (cx, cy) = (cx + p.gaze.0 * GAZE, cy + p.gaze.1 * GAZE);
    out.push(fill(ellipse(cx, cy, r, r), INK));
    out.push(fill(ellipse(cx - r * 0.33, cy - r * 0.36, r * 0.27, r * 0.24), HI));
    out.push(fill(ellipse(cx + r * 0.33, cy + r * 0.33, r * 0.1, r * 0.1), HI.with_alpha(0.85)));
}

/// The mark in `p`, back to front, in drawing units.
pub fn mark(p: &Pose) -> Vec<Shape> {
    let mut out = Vec::with_capacity(16);
    ear(-1.0, p.ear_l, &mut out);
    ear(1.0, p.ear_r, &mut out);
    out.push(fill(ellipse(0.0, 0.0, 70.0, 61.0), FUR));
    // One tall curl on top: the silhouette's signature.
    out.push(fill(
        vec![
            Seg::MoveTo(-6.0, -58.0),
            Seg::CubicTo(-12.0, -84.0, 4.0, -104.0, 20.0, -92.0),
            Seg::CubicTo(11.0, -93.0, 3.0, -86.0, 6.0, -74.0),
            Seg::CubicTo(8.0, -66.0, 7.0, -61.0, 6.0, -58.0),
            Seg::Close,
        ],
        FUR,
    ));
    // The face plate; its top edge is the brow line (kasi.js's resting brow).
    let (dip, bump, inner) = (-22.0, -38.0, 0.0);
    let brow = bump + 6.0 + inner;
    out.push(fill(
        vec![
            Seg::MoveTo(-63.0, -2.0),
            Seg::CubicTo(-64.0, -30.0, -44.0, bump, -24.0, brow),
            Seg::QuadTo(0.0, dip, 24.0, brow),
            Seg::CubicTo(44.0, bump, 64.0, -30.0, 63.0, -2.0),
            Seg::CubicTo(62.0, 30.0, 36.0, 50.0, 0.0, 50.0),
            Seg::CubicTo(-36.0, 50.0, -62.0, 30.0, -63.0, -2.0),
            Seg::Close,
        ],
        FACE,
    ));
    eye(-1.0, p, &mut out);
    eye(1.0, p, &mut out);
    out.push(fill(
        vec![
            Seg::MoveTo(-5.0, 27.0),
            Seg::QuadTo(0.0, 24.0, 5.0, 27.0),
            Seg::QuadTo(3.0, 32.0, 0.0, 32.5),
            Seg::QuadTo(-3.0, 32.0, -5.0, 27.0),
            Seg::Close,
        ],
        INK,
    ));
    out
}

/// The mark `w` DIPs wide, its box centred on `centre`: each shape's
/// segments and its stroke width on the screen.
pub fn place(shapes: Vec<Shape>, centre: Point, w: f32) -> Vec<Shape> {
    let s = w / VIEW_W;
    // The box's centre in drawing units goes to `centre`.
    let (bx, by) = (VIEW_X + VIEW_W / 2.0, VIEW_Y + VIEW_H / 2.0);
    let xf = Xf { a: s, b: 0.0, c: 0.0, d: s, e: centre.x - bx * s, f: centre.y - by * s };
    shapes
        .into_iter()
        .map(|sh| Shape { segs: xf.apply(&sh.segs), fill: sh.fill, stroke: sh.stroke.map(|(c, width)| (c, width * s)) })
        .collect()
}

/// The mark's height for a width (its box's proportions).
pub fn height(w: f32) -> f32 {
    w * VIEW_H / VIEW_W
}

// ---- motion ----

/// Seconds from one blink to the next (2.4 to 6 s, uneven), looped.
const BLINK_GAPS: [f64; 8] = [3.1, 5.6, 2.4, 4.3, 6.0, 3.6, 2.9, 5.1];
pub const BLINK_LEN: f64 = 0.12;
/// Seconds from one ear twitch to the next, looped; even entries twitch
/// the right ear, odd the left. Out of step with the blinks.
const TWITCH_GAPS: [f64; 4] = [7.3, 11.6, 9.1, 13.4];
/// A twitch: up by `TWITCH_DEG` in `TWITCH_UP` s, back over `TWITCH_DOWN` s.
const TWITCH_DEG: f32 = 7.0;
const TWITCH_UP: f64 = 0.08;
const TWITCH_DOWN: f64 = 0.3;
pub const TWITCH_LEN: f64 = TWITCH_UP + TWITCH_DOWN;

/// Where `now` falls in a looped sequence of gaps: the index of the gap it
/// is in, the time that gap ends and the time it began.
fn cycle(gaps: &[f64], now: f64) -> (usize, f64, f64) {
    let total: f64 = gaps.iter().sum();
    let now = now.max(0.0);
    let base = (now / total).floor() * total;
    let mut start = base;
    for (i, g) in gaps.iter().enumerate() {
        if now < start + g {
            return (i, start + g, start);
        }
        start += g;
    }
    // Only float rounding lands here: the next loop's first gap.
    (0, start + gaps[0], start)
}

/// A blink is the last `BLINK_LEN` of each gap.
fn blinking(now: f64) -> bool {
    let (_, end, _) = cycle(&BLINK_GAPS, now);
    now >= end - BLINK_LEN
}

/// A twitch plays at the start of each gap but the island's very first:
/// (the right ear?, seconds into it).
fn twitch(now: f64) -> Option<(bool, f64)> {
    let (i, _, start) = cycle(&TWITCH_GAPS, now);
    let t = now - start;
    (t < TWITCH_LEN && start > 0.0).then_some((i % 2 == 0, t))
}

fn twitch_deg(t: f64) -> f32 {
    let k = if t < TWITCH_UP {
        t / TWITCH_UP
    } else {
        // Ease out on the way back down.
        let u = ((t - TWITCH_UP) / TWITCH_DOWN).clamp(0.0, 1.0);
        (1.0 - u).powi(3)
    };
    -TWITCH_DEG * k as f32
}

/// The resting mark at `now` (the island's monotonic seconds).
pub fn rest(now: f64) -> Pose {
    let mut p = Pose { blink: blinking(now), ..Pose::REST };
    if let Some((right, t)) = twitch(now) {
        let a = twitch_deg(t);
        if right {
            p.ear_r = a;
        } else {
            p.ear_l = a;
        }
    }
    p
}

/// Whether an ear is moving at `now` (the island draws frames until it settles).
pub fn moving(now: f64) -> bool {
    twitch(now).is_some()
}

/// The next time the resting mark changes after `now`: a blink starting or
/// ending, or a twitch starting or ending (in between it runs on frames,
/// [`moving`]).
pub fn next_change(now: f64) -> f64 {
    let (_, end, _) = cycle(&BLINK_GAPS, now);
    let blink = if now < end - BLINK_LEN { end - BLINK_LEN } else { end };
    let (_, t_end, start) = cycle(&TWITCH_GAPS, now);
    let twitch = if now < start + TWITCH_LEN && start > 0.0 { start + TWITCH_LEN } else { t_end };
    // A hair past the edge, so the wake lands inside the new state.
    blink.min(twitch) + 1e-3
}

/// The mark as an SVG (for checking it against kasi.js in a browser).
pub fn svg(p: &Pose) -> String {
    let hex = |c: Color| format!("#{:02X}{:02X}{:02X}", (c.r * 255.0).round() as u8, (c.g * 255.0).round() as u8, (c.b * 255.0).round() as u8);
    let mut s = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VIEW_X} {VIEW_Y} {VIEW_W} {VIEW_H}">"#);
    for sh in mark(p) {
        let mut d = String::new();
        for seg in &sh.segs {
            d += &match *seg {
                Seg::MoveTo(x, y) => format!("M{x:.2} {y:.2}"),
                Seg::LineTo(x, y) => format!("L{x:.2} {y:.2}"),
                Seg::QuadTo(a, b, x, y) => format!("Q{a:.2} {b:.2} {x:.2} {y:.2}"),
                Seg::CubicTo(a, b, c, e, x, y) => format!("C{a:.2} {b:.2} {c:.2} {e:.2} {x:.2} {y:.2}"),
                Seg::ArcTo(..) => String::new(),
                Seg::Close => "Z".into(),
            };
        }
        let paint = match (sh.fill, sh.stroke) {
            (Some(c), _) => format!(r#"fill="{}" fill-opacity="{}""#, hex(c), c.a),
            (None, Some((c, w))) => format!(r#"fill="none" stroke="{}" stroke-width="{w}" stroke-linecap="round""#, hex(c)),
            _ => String::new(),
        };
        s += &format!(r#"<path d="{d}" {paint}/>"#);
    }
    s + "</svg>"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(shapes: &[Shape]) -> Vec<(f32, f32)> {
        shapes
            .iter()
            .flat_map(|s| s.segs.iter())
            .filter_map(|s| match *s {
                Seg::MoveTo(x, y) | Seg::LineTo(x, y) | Seg::QuadTo(_, _, x, y) | Seg::CubicTo(_, _, _, _, x, y) => Some((x, y)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn the_mark_is_the_whole_head_inside_its_box_never_eyes_alone() {
        let shapes = mark(&Pose::REST);
        let colours: Vec<Color> = shapes.iter().filter_map(|s| s.fill).collect();
        for c in [FUR, EAR, FACE, INK] {
            assert!(colours.contains(&c), "{c:?} missing");
        }
        // Two ears with an inner ear each; two eyes and the nose in ink.
        assert_eq!(shapes.iter().filter(|s| s.fill == Some(EAR)).count(), 2);
        assert_eq!(shapes.iter().filter(|s| s.fill == Some(INK)).count(), 3);
        for (x, y) in points(&shapes) {
            assert!(x.is_finite() && y.is_finite());
            assert!((VIEW_X..=VIEW_X + VIEW_W).contains(&x), "x {x}");
            assert!((VIEW_Y..=VIEW_Y + VIEW_H).contains(&y), "y {y}");
        }
        // The left ear's tip sits high and out to the left at 36 degrees
        // (kasi.js puts it near (-55, -111)).
        let left_tip = points(&shapes[..1]).into_iter().fold((0.0f32, 0.0f32), |a, p| if p.1 < a.1 { p } else { a });
        assert!((left_tip.0 + 55.0).abs() < 1.0 && (left_tip.1 + 110.7).abs() < 1.0, "{left_tip:?}");
    }

    #[test]
    fn a_blink_is_a_lash_line_and_the_gaze_moves_the_eyes() {
        let shut = mark(&Pose { blink: true, ..Pose::REST });
        assert_eq!(shut.iter().filter(|s| s.stroke.map(|(c, _)| c) == Some(DEEP)).count(), 2);
        assert_eq!(shut.iter().filter(|s| s.fill == Some(INK)).count(), 1, "only the nose");
        assert_ne!(mark(&Pose::REST), mark(&Pose::REST.looking((1.0, 0.0))));
        assert_eq!(Pose::REST.looking((3.0, -2.0)).gaze, (1.0, -1.0));
    }

    #[test]
    fn place_fits_the_box_to_the_width_and_scales_the_strokes() {
        let placed = place(mark(&Pose::REST), Point::new(50.0, 16.0), 28.0);
        for (x, y) in points(&placed) {
            assert!((36.0..=64.0).contains(&x), "x {x}");
            assert!((16.0 - height(28.0) / 2.0..=16.0 + height(28.0) / 2.0).contains(&y), "y {y}");
        }
        let ridge = placed.iter().find_map(|s| s.stroke).unwrap();
        assert!((ridge.1 - 3.0 * 28.0 / 208.0).abs() < 1e-4);
    }

    #[test]
    fn blinks_come_2_4_to_6_s_apart_and_last_120_ms() {
        let mut t = 0.0;
        let mut starts = vec![];
        let mut was = blinking(0.0);
        while t < 70.0 {
            let b = blinking(t);
            if b && !was {
                starts.push(t);
            }
            was = b;
            t += 0.005;
        }
        assert!(starts.len() >= 14, "{starts:?}");
        for w in starts.windows(2) {
            let gap = w[1] - w[0];
            assert!((2.39..=6.01).contains(&gap), "gap {gap}");
        }
        let s = starts[3];
        assert!(blinking(s + 0.11) && !blinking(s + 0.13));
    }

    #[test]
    fn ears_twitch_now_and_then_one_at_a_time_and_settle_back() {
        assert!(!moving(1.0), "the first seconds are still");
        let start: f64 = TWITCH_GAPS[0];
        let p = rest(start + TWITCH_UP);
        assert!((p.ear_l + TWITCH_DEG).abs() < 0.01, "{p:?}");
        assert_eq!(p.ear_r, 0.0);
        assert!(moving(start + 0.2));
        let after = rest(start + TWITCH_LEN + 0.01);
        assert_eq!((after.ear_l, after.ear_r), (0.0, 0.0));
        // The next one is the other ear.
        let p2 = rest(start + TWITCH_GAPS[1] + TWITCH_UP);
        assert!(p2.ear_r < -6.9 && p2.ear_l == 0.0, "{p2:?}");
        assert!(twitch_deg(TWITCH_LEN) > -0.01);
    }

    #[test]
    fn the_next_change_is_the_next_blink_edge_or_twitch() {
        let mut now = 0.5;
        for _ in 0..60 {
            let next = next_change(now);
            assert!(next > now && next - now <= 6.1, "{now} -> {next}");
            // Nothing changes in between, unless an ear is moving.
            let mid = (now + next) / 2.0;
            if !moving(now) && !moving(mid) {
                assert_eq!(rest(mid).blink, rest(now + 1e-4).blink, "at {mid}");
            }
            now = next;
        }
    }

    #[test]
    fn the_svg_carries_every_shape() {
        let s = svg(&Pose::REST);
        assert!(s.starts_with("<svg") && s.ends_with("</svg>"));
        assert_eq!(s.matches("<path").count(), mark(&Pose::REST).len());
        if let Ok(path) = std::env::var("KASI_SVG_OUT") {
            std::fs::write(&path, &s).unwrap();
            std::fs::write(path.replace(".svg", "-blink.svg"), svg(&Pose { blink: true, ear_r: -7.0, ..Pose::REST })).unwrap();
        }
    }
}
