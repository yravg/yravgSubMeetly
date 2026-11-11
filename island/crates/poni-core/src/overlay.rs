//! The subtitle overlay: a borderless, transparent, always-on-top strip that shows the live captions and
//! their translation over whatever is on screen (games, videos, calls). The look is the person's:
//! background colour and opacity, a colour for the original and one for the translation, a font size, how
//! many sentences stay up, and whether the strip lets the mouse through ("click-through": it becomes
//! part of the screen).
//!
//! Everything here is pure: the settings, which lines are shown, where the strip sits, and the compositor
//! that turns text coverage into the premultiplied pixels a layered Windows window wants. The windows
//! themselves are the platforms' (`poni/src/overlay_win.rs`, `poni/src/mac/overlay.rs`).
//!
//! The idea of a configurable caption overlay (colours, opacity, sentence count, click-through) is
//! LiveCaptions-Translator's (Apache-2.0, github.com/SakiRinn/LiveCaptions-Translator); the code is ours.

use crate::geom::Rect;
use serde::{Deserialize, Serialize};

/// What the strip shows of each line.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Show {
    /// The original and, under it, the translation.
    #[default]
    Both,
    Original,
    Translation,
}

impl Show {
    pub const ALL: [Show; 3] = [Show::Both, Show::Original, Show::Translation];
    pub fn label(self) -> &'static str {
        match self {
            Show::Both => "Both",
            Show::Original => "Original",
            Show::Translation => "Translation",
        }
    }
}

/// An sRGB colour as the person picks it; text is always opaque, the background's opacity is its own number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// `#RRGGBB` (the `#` is optional); None for anything else.
    pub fn parse(s: &str) -> Option<Rgb> {
        let h = s.trim().trim_start_matches('#');
        if h.len() != 6 || !h.is_ascii() {
            return None;
        }
        let v = u32::from_str_radix(h, 16).ok()?;
        Some(Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8))
    }
    pub fn hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.0, self.1, self.2)
    }
    pub fn to_color(self, alpha: f32) -> crate::geom::Color {
        crate::geom::Color::rgba(self.0 as f32 / 255.0, self.1 as f32 / 255.0, self.2 as f32 / 255.0, alpha)
    }
}

/// Preset colours (Settings steps through them; the file may hold any `Rgb`).
pub const TEXT_PRESETS: [(&str, Rgb); 6] = [
    ("White", Rgb(255, 255, 255)),
    ("Yellow", Rgb(255, 201, 27)),
    ("Cyan", Rgb(110, 220, 255)),
    ("Green", Rgb(130, 230, 150)),
    ("Pink", Rgb(255, 150, 200)),
    ("Orange", Rgb(255, 170, 90)),
];
pub const BACKGROUND_PRESETS: [(&str, Rgb); 4] = [("Black", Rgb(0, 0, 0)), ("Navy", Rgb(33, 44, 95)), ("Grey", Rgb(60, 60, 64)), ("White", Rgb(245, 244, 239))];

pub const FONT_MIN: u32 = 12;
pub const FONT_MAX: u32 = 72;
pub const SENTENCES_MIN: u32 = 1;
pub const SENTENCES_MAX: u32 = 6;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlaySettings {
    /// The strip is on screen (the menu and Settings toggle it).
    pub enabled: bool,
    pub background: Rgb,
    /// Background opacity, 0 (only the text floats) to 100.
    pub background_opacity: u32,
    pub original_color: Rgb,
    pub translation_color: Rgb,
    /// Font size in points (the translation is drawn at the same size).
    pub font_size: u32,
    /// How many sentences stay up at once.
    pub sentences: u32,
    pub show: Show,
    /// The mouse goes through the strip (and it can't be dragged); off, it can be dragged.
    pub click_through: bool,
    /// Where the person dragged it: the strip's centre as a share of the screen's width and its bottom
    /// edge as a share of its height. None: bottom-centre.
    pub spot: Option<(f32, f32)>,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            background: Rgb(0, 0, 0),
            background_opacity: 70,
            original_color: Rgb(255, 255, 255),
            translation_color: Rgb(255, 201, 27),
            font_size: 26,
            sentences: 2,
            show: Show::Both,
            click_through: false,
            spot: None,
        }
    }
}

impl OverlaySettings {
    /// Settings read from a file may hold anything: every number back into its range.
    pub fn sanitized(mut self) -> Self {
        self.background_opacity = self.background_opacity.min(100);
        self.font_size = self.font_size.clamp(FONT_MIN, FONT_MAX);
        self.sentences = self.sentences.clamp(SENTENCES_MIN, SENTENCES_MAX);
        self.spot = self.spot.map(|(x, y)| (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)));
        self
    }
    pub fn background_alpha(&self) -> f32 {
        self.background_opacity.min(100) as f32 / 100.0
    }
}

/// One sentence to put up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sentence {
    pub original: String,
    pub translation: String,
    /// Still being spoken (its text may change under it).
    pub live: bool,
}

/// What the strip draws: up to `sentences` of the newest, each reduced to what `show` allows; sentences
/// with nothing left to show are skipped (a translation not made yet leaves a Translation-only strip
/// showing the original until it arrives, so the strip is never blank while someone talks).
pub fn visible(lines: &[Sentence], s: &OverlaySettings) -> Vec<Sentence> {
    let n = s.sentences.clamp(SENTENCES_MIN, SENTENCES_MAX) as usize;
    let mut out: Vec<Sentence> = lines
        .iter()
        .rev()
        .filter_map(|l| {
            let (original, translation) = (l.original.trim(), l.translation.trim());
            let (o, t) = match s.show {
                Show::Both => (original, translation),
                Show::Original => (original, ""),
                Show::Translation if translation.is_empty() => (original, ""),
                Show::Translation => ("", translation),
            };
            (!o.is_empty() || !t.is_empty()).then(|| Sentence { original: o.to_string(), translation: t.to_string(), live: l.live })
        })
        .take(n)
        .collect();
    out.reverse();
    out
}

/// Greedy word wrap by a width estimate (`char_w` per character, wide CJK characters count double); the
/// platforms measure the real text for drawing, this only decides where the strip's height comes from
/// before they have. Never returns an empty vec.
pub fn wrap(text: &str, max_w: f32, char_w: f32) -> Vec<String> {
    let w = |c: char| if (c as u32) >= 0x1100 { 2.0 * char_w } else { char_w };
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut cur_w = 0.0;
    for word in text.split_whitespace() {
        let ww: f32 = word.chars().map(w).sum();
        // A word wider than the strip breaks by characters.
        if ww > max_w {
            for c in word.chars() {
                if cur_w + w(c) > max_w && !cur.is_empty() {
                    lines.push(std::mem::take(&mut cur));
                    cur_w = 0.0;
                }
                cur.push(c);
                cur_w += w(c);
            }
            continue;
        }
        let gap = if cur.is_empty() { 0.0 } else { char_w };
        if cur_w + gap + ww > max_w && !cur.is_empty() {
            lines.push(std::mem::take(&mut cur));
            cur_w = 0.0;
        }
        if !cur.is_empty() {
            cur.push(' ');
            cur_w += char_w;
        }
        cur.push_str(word);
        cur_w += ww;
    }
    if !cur.is_empty() || lines.is_empty() {
        lines.push(cur);
    }
    lines
}

/// The strip's width: most of the screen, but never a ribbon across an ultrawide one.
pub fn strip_width(screen_w: f32) -> f32 {
    (screen_w * 0.8).min(1400.0).max(320.0).min(screen_w)
}

/// Padding around the text, and the gap above the screen's bottom edge, in points.
pub const PAD_X: f32 = 24.0;
pub const PAD_Y: f32 = 12.0;
pub const BOTTOM_GAP: f32 = 56.0;
pub const LINE_GAP: f32 = 4.0;
pub const SENTENCE_GAP: f32 = 8.0;

/// Where the strip goes on `screen` (a rect in points, y down) for content `content_h` points tall
/// (padding included): bottom-centre unless the person dragged it, and always fully on the screen.
pub fn place(screen: Rect, width: f32, content_h: f32, spot: Option<(f32, f32)>) -> Rect {
    let w = width.min(screen.w);
    let h = content_h.min(screen.h);
    let (cx, bottom) = match spot {
        Some((sx, sy)) => (screen.x + sx.clamp(0.0, 1.0) * screen.w, screen.y + sy.clamp(0.0, 1.0) * screen.h),
        None => (screen.x + screen.w / 2.0, screen.y + screen.h - BOTTOM_GAP),
    };
    let x = (cx - w / 2.0).clamp(screen.x, screen.x + screen.w - w);
    let y = (bottom - h).clamp(screen.y, screen.y + screen.h - h);
    Rect::new(x, y, w, h)
}

/// The share of the screen a dragged strip's centre and bottom edge stand at (what `spot` keeps).
pub fn spot_of(screen: Rect, strip: Rect) -> (f32, f32) {
    let sx = ((strip.x + strip.w / 2.0 - screen.x) / screen.w.max(1.0)).clamp(0.0, 1.0);
    let sy = ((strip.y + strip.h - screen.y) / screen.h.max(1.0)).clamp(0.0, 1.0);
    (sx, sy)
}

/// The text the Copy button puts on the clipboard: the newest sentence, original then translation.
pub fn copy_text(lines: &[Sentence]) -> Option<String> {
    let l = lines.iter().rev().find(|l| !l.original.trim().is_empty() || !l.translation.trim().is_empty())?;
    let (o, t) = (l.original.trim(), l.translation.trim());
    Some(match (o.is_empty(), t.is_empty()) {
        (false, false) => format!("{o}\n{t}"),
        (false, true) => o.to_string(),
        _ => t.to_string(),
    })
}

/// A coverage mask: one byte per pixel, 255 where the glyphs are solid (what a text rasteriser draws in
/// white on black).
#[derive(Clone, Debug)]
pub struct Mask {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

/// Compose the strip's pixels for a layered window: the background (`bg`, `bg_alpha` 0..=1) as a rounded
/// rectangle, then each text mask in its colour over it. Output is BGRA with premultiplied alpha, the
/// form `UpdateLayeredWindow` wants. `radius` in pixels.
pub fn compose_bgra(w: usize, h: usize, bg: Rgb, bg_alpha: f32, radius: f32, texts: &[(Rgb, &Mask, usize, usize)]) -> Vec<u8> {
    let mut out = vec![0u8; w * h * 4];
    let a_bg = (bg_alpha.clamp(0.0, 1.0) * 255.0).round();
    for y in 0..h {
        for x in 0..w {
            let cov = rounded_coverage(x as f32 + 0.5, y as f32 + 0.5, w as f32, h as f32, radius);
            let a = a_bg * cov;
            let i = (y * w + x) * 4;
            // Premultiplied: channel = colour * alpha.
            out[i] = (bg.2 as f32 * a / 255.0).round() as u8;
            out[i + 1] = (bg.1 as f32 * a / 255.0).round() as u8;
            out[i + 2] = (bg.0 as f32 * a / 255.0).round() as u8;
            out[i + 3] = a.round() as u8;
        }
    }
    for (color, mask, ox, oy) in texts {
        for my in 0..mask.h {
            let y = oy + my;
            if y >= h {
                break;
            }
            for mx in 0..mask.w {
                let x = ox + mx;
                if x >= w {
                    break;
                }
                let c = mask.px[my * mask.w + mx] as f32 / 255.0;
                if c <= 0.0 {
                    continue;
                }
                let i = (y * w + x) * 4;
                let keep = 1.0 - c;
                // Source-over of an opaque colour at coverage c onto premultiplied pixels.
                out[i] = (color.2 as f32 * c + out[i] as f32 * keep).round().min(255.0) as u8;
                out[i + 1] = (color.1 as f32 * c + out[i + 1] as f32 * keep).round().min(255.0) as u8;
                out[i + 2] = (color.0 as f32 * c + out[i + 2] as f32 * keep).round().min(255.0) as u8;
                out[i + 3] = (255.0 * c + out[i + 3] as f32 * keep).round().min(255.0) as u8;
            }
        }
    }
    out
}

/// 1.0 inside a rounded rectangle, 0.0 outside, anti-aliased over about a pixel at the corners.
fn rounded_coverage(px: f32, py: f32, w: f32, h: f32, r: f32) -> f32 {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    if r <= 0.0 {
        return 1.0;
    }
    let dx = (px - w / 2.0).abs() - (w / 2.0 - r);
    let dy = (py - h / 2.0).abs() - (h / 2.0 - r);
    if dx <= 0.0 || dy <= 0.0 {
        return 1.0;
    }
    let d = (dx * dx + dy * dy).sqrt() - r;
    (0.5 - d).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(o: &str, t: &str) -> Sentence {
        Sentence { original: o.into(), translation: t.into(), live: false }
    }

    #[test]
    fn colours_parse_and_print() {
        assert_eq!(Rgb::parse("#FFC91B"), Some(Rgb(255, 201, 27)));
        assert_eq!(Rgb::parse("212c5f"), Some(Rgb(33, 44, 95)));
        assert_eq!(Rgb::parse("#12345"), None);
        assert_eq!(Rgb::parse("#GGGGGG"), None);
        assert_eq!(Rgb(33, 44, 95).hex(), "#212C5F");
    }

    #[test]
    fn a_file_with_wild_numbers_is_brought_back_in_range() {
        let st = OverlaySettings { background_opacity: 900, font_size: 1, sentences: 99, spot: Some((-3.0, 4.0)), ..Default::default() }.sanitized();
        assert_eq!((st.background_opacity, st.font_size, st.sentences), (100, FONT_MIN, SENTENCES_MAX));
        assert_eq!(st.spot, Some((0.0, 1.0)));
        // Missing keys fall back to the defaults.
        let d: OverlaySettings = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        assert!(d.enabled);
        assert_eq!(d.font_size, 26);
    }

    #[test]
    fn the_newest_sentences_stay_up_in_order() {
        let lines = [s("one", "1"), s("two", "2"), s("three", "3")];
        let st = OverlaySettings { sentences: 2, ..Default::default() };
        let v = visible(&lines, &st);
        assert_eq!(v.iter().map(|x| x.original.as_str()).collect::<Vec<_>>(), ["two", "three"]);
    }

    #[test]
    fn show_picks_what_each_sentence_keeps() {
        let lines = [s("hello", "halo")];
        let mut st = OverlaySettings::default();
        st.show = Show::Original;
        assert_eq!(visible(&lines, &st)[0].translation, "");
        st.show = Show::Translation;
        let v = visible(&lines, &st);
        assert_eq!((v[0].original.as_str(), v[0].translation.as_str()), ("", "halo"));
        // Not translated yet: the original stands in, the strip isn't blank.
        let v = visible(&[s("hello", "")], &st);
        assert_eq!(v[0].original, "hello");
        // Nothing said: nothing shown.
        assert!(visible(&[s("  ", "")], &st).is_empty());
    }

    #[test]
    fn wrap_breaks_at_words_and_at_long_words() {
        assert_eq!(wrap("aaa bbb ccc", 7.0, 1.0), ["aaa bbb", "ccc"]);
        assert_eq!(wrap("abcdefghij", 4.0, 1.0), ["abcd", "efgh", "ij"]);
        assert_eq!(wrap("", 10.0, 1.0), [""]);
        // Wide characters count double.
        assert_eq!(wrap("日本語日本語", 6.0, 1.0).len(), 2);
    }

    #[test]
    fn the_strip_sits_bottom_centre_and_stays_on_screen() {
        let screen = Rect::new(0.0, 0.0, 1920.0, 1080.0);
        let r = place(screen, 1000.0, 100.0, None);
        assert_eq!(r.x, 460.0);
        assert_eq!(r.y + r.h, 1080.0 - BOTTOM_GAP);
        // Dragged past the corner: pulled back on.
        let r = place(screen, 1000.0, 100.0, Some((1.0, 1.0)));
        assert!(r.x + r.w <= 1920.0 && r.y + r.h <= 1080.0);
        // Wider than the screen: as wide as the screen.
        assert_eq!(place(screen, 5000.0, 100.0, None).w, 1920.0);
        // A second monitor to the right keeps its own origin.
        let two = Rect::new(1920.0, 0.0, 1280.0, 720.0);
        let r = place(two, 800.0, 80.0, None);
        assert!(r.x >= 1920.0 && r.x + r.w <= 3200.0);
    }

    #[test]
    fn a_drag_is_kept_as_a_share_of_the_screen() {
        let screen = Rect::new(100.0, 50.0, 1000.0, 800.0);
        let strip = Rect::new(400.0, 600.0, 400.0, 100.0);
        let (sx, sy) = spot_of(screen, strip);
        assert!((sx - 0.5).abs() < 1e-6 && (sy - 0.8125).abs() < 1e-6);
        let back = place(screen, 400.0, 100.0, Some((sx, sy)));
        assert!((back.x - strip.x).abs() < 1e-3 && (back.y - strip.y).abs() < 1e-3);
    }

    #[test]
    fn copy_takes_the_newest_non_empty_sentence() {
        assert_eq!(copy_text(&[s("a", "b"), s("", "")]), Some("a\nb".into()));
        assert_eq!(copy_text(&[s("only", "")]), Some("only".into()));
        assert_eq!(copy_text(&[]), None);
    }

    #[test]
    fn the_compositor_premultiplies_and_rounds_the_corners() {
        let mask = Mask { w: 2, h: 1, px: vec![255, 0] };
        let px = compose_bgra(4, 2, Rgb(0, 0, 0), 0.5, 0.0, &[(Rgb(255, 0, 0), &mask, 1, 0)]);
        // Pixel (0,0): background only, half opaque black.
        assert_eq!(&px[0..4], &[0, 0, 0, 128]);
        // Pixel (1,0): solid red text (BGRA = 0,0,255,255).
        assert_eq!(&px[4..8], &[0, 0, 255, 255]);
        // Pixel (2,0): coverage 0, the background again.
        assert_eq!(&px[8..12], &[0, 0, 0, 128]);
        // Transparent background: only the text has alpha.
        let px = compose_bgra(4, 1, Rgb(10, 20, 30), 0.0, 0.0, &[(Rgb(255, 255, 255), &mask, 0, 0)]);
        assert_eq!(px[3], 255);
        assert_eq!(px[7], 0);
        // A big radius leaves the corner pixel clear.
        let px = compose_bgra(20, 20, Rgb(0, 0, 0), 1.0, 10.0, &[]);
        assert_eq!(px[3], 0);
        assert_eq!(px[(10 * 20 + 10) * 4 + 3], 255);
    }
}
