//! The subtitle overlay on the Mac: a borderless, non-activating panel that floats above everything
//! (every Space, over full-screen apps), with the live captions in it. What it shows and how it looks is
//! `poni_core::overlay`; this file is the window.
//!
//! The strip is made of plain labels on a layer with a rounded, translucent background, so macOS draws
//! and anti-aliases the text itself. It is rebuilt only when what it shows changes. Click-through is
//! `ignoresMouseEvents`; without it the strip can be dragged by its background, and where it was left is
//! read back by [`dragged_to`].
//!
//! Everything runs on the main thread; the panel lives in a thread-local like the island's.

use objc2::rc::Retained;
use objc2::{msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSBitmapImageFileType, NSBox, NSBoxType, NSColor, NSFont, NSFontWeightMedium, NSFontWeightSemibold, NSPanel, NSTextAlignment, NSTextField, NSView, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
use poni_core::geom::Rect;
use poni_core::overlay::{self, OverlaySettings, Rgb, Sentence, BOTTOM_GAP, LINE_GAP, PAD_X, PAD_Y, SENTENCE_GAP};
use std::cell::RefCell;

/// Above the island's own level (24 + 3) is not wanted: the strip sits on the status level, under it.
const OVERLAY_LEVEL: isize = 25;

/// What the strip is asked to show.
#[derive(Clone, Debug, PartialEq)]
pub struct Content {
    pub sentences: Vec<Sentence>,
    pub settings: OverlaySettings,
    pub paused: bool,
}

struct Overlay {
    panel: Retained<NSPanel>,
    root: Retained<NSBox>,
    /// What is on screen now, so an unchanged strip isn't rebuilt.
    shown: Option<Content>,
    /// Where the strip was placed last (AppKit coordinates), to tell a drag from our own move.
    placed: NSRect,
    /// The screen it was placed on (AppKit frame), for reading a drag back as a share of it.
    screen: Rect,
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
}

fn color(c: Rgb, alpha: f64) -> Retained<NSColor> {
    NSColor::colorWithSRGBRed_green_blue_alpha(c.0 as f64 / 255.0, c.1 as f64 / 255.0, c.2 as f64 / 255.0, alpha)
}

fn make(mtm: MainThreadMarker) -> Overlay {
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 80.0));
    let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
    let panel: Retained<NSPanel> = unsafe { msg_send![NSPanel::alloc(mtm), initWithContentRect: rect, styleMask: style, backing: NSBackingStoreType::Buffered, defer: false] };
    panel.setLevel(OVERLAY_LEVEL);
    panel.setCollectionBehavior(NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary | NSWindowCollectionBehavior::IgnoresCycle);
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setHidesOnDeactivate(false);
    unsafe { panel.setReleasedWhenClosed(false) };
    // The rounded, translucent background is a borderless custom box (drawn by AppKit, so a snapshot of it
    // includes it); the labels sit in its content view.
    let root = NSBox::initWithFrame(NSBox::alloc(mtm), rect);
    root.setBoxType(NSBoxType::Custom);
    root.setBorderWidth(0.0);
    root.setCornerRadius(14.0);
    root.setTitlePosition(objc2_app_kit::NSTitlePosition::NoTitle);
    root.setContentViewMargins(NSSize::new(0.0, 0.0));
    panel.setContentView(Some(&root));
    Overlay { panel, root, shown: None, placed: rect, screen: Rect::new(0.0, 0.0, 1.0, 1.0) }
}

/// A label for `text` at `size` points in `rgb`, wrapped to `width` points.
fn label(mtm: MainThreadMarker, text: &str, size: f64, bold: bool, rgb: Rgb, width: f64) -> Retained<NSTextField> {
    let l = NSTextField::wrappingLabelWithString(&NSString::from_str(text), mtm);
    let weight = unsafe { if bold { NSFontWeightSemibold } else { NSFontWeightMedium } };
    l.setFont(Some(&NSFont::systemFontOfSize_weight(size, weight)));
    l.setTextColor(Some(&color(rgb, 1.0)));
    l.setAlignment(NSTextAlignment::Center);
    l.setDrawsBackground(false);
    l.setBordered(false);
    l.setSelectable(false);
    l.setMaximumNumberOfLines(0);
    l.setPreferredMaxLayoutWidth(width);
    l
}

/// Show `content` on `screen` (AppKit frame, points, y up), building the strip if it isn't what is up.
pub fn show(mtm: MainThreadMarker, content: &Content, screen: Rect) {
    OVERLAY.with(|o| {
        let mut o = o.borrow_mut();
        let ov = o.get_or_insert_with(|| make(mtm));
        let same_screen = ov.screen == screen;
        if ov.shown.as_ref() == Some(content) && same_screen && ov.panel.isVisible() {
            return;
        }
        let s = &content.settings;
        let width = overlay::strip_width(screen.w) as f64;
        let inner = width - 2.0 * PAD_X as f64;
        let size = s.font_size as f64;

        // The labels, top to bottom: each sentence's original, then its translation.
        let mut labels: Vec<Retained<NSTextField>> = Vec::new();
        let mut gaps: Vec<f64> = Vec::new();
        for (i, sent) in content.sentences.iter().enumerate() {
            let mut first = true;
            for (text, rgb, bold) in [(&sent.original, s.original_color, false), (&sent.translation, s.translation_color, true)] {
                if text.is_empty() {
                    continue;
                }
                let text = if sent.live && i + 1 == content.sentences.len() && !content.paused { format!("{text} …") } else { text.clone() };
                labels.push(label(mtm, &text, size, bold, rgb, inner));
                gaps.push(if labels.len() == 1 { 0.0 } else if first { SENTENCE_GAP as f64 } else { LINE_GAP as f64 });
                first = false;
            }
        }
        if content.paused {
            labels.push(label(mtm, "Paused", (size * 0.55).max(11.0), false, Rgb(200, 200, 200), inner));
            gaps.push(SENTENCE_GAP as f64);
        }
        if labels.is_empty() {
            // Nothing said yet: a quiet strip rather than none, so the person sees it is on.
            labels.push(label(mtm, "Listening …", (size * 0.7).max(12.0), false, Rgb(180, 180, 180), inner));
            gaps.push(0.0);
        }
        let heights: Vec<f64> = labels.iter().map(|l| l.intrinsicContentSize().height.ceil().max(size * 1.2)).collect();
        let text_h: f64 = heights.iter().sum::<f64>() + gaps.iter().sum::<f64>();
        let total_h = text_h + 2.0 * PAD_Y as f64;

        // Where it goes: bottom-centre of the screen, or where it was dragged (the same rule on every platform).
        let top_down = Rect::new(0.0, 0.0, screen.w, screen.h);
        let placed = overlay::place(top_down, width as f32, total_h as f32, s.spot);
        let x = screen.x as f64 + placed.x as f64;
        let y = screen.y as f64 + screen.h as f64 - (placed.y as f64 + placed.h as f64);
        let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(placed.w as f64, placed.h as f64));

        let content_view = ov.root.contentView().unwrap_or_else(|| NSView::initWithFrame(NSView::alloc(mtm), rect_of(frame)));
        for old in content_view.subviews().iter() {
            old.removeFromSuperview();
        }
        ov.panel.setFrame_display(frame, false);
        ov.root.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
        content_view.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), frame.size));
        let mut top = frame.size.height - PAD_Y as f64;
        for ((l, h), g) in labels.iter().zip(&heights).zip(&gaps) {
            top -= g;
            l.setFrame(NSRect::new(NSPoint::new(PAD_X as f64, top - h), NSSize::new(inner, *h)));
            content_view.addSubview(l);
            top -= h;
        }
        ov.root.setFillColor(&color(s.background, s.background_alpha() as f64));
        // Click-through lets the mouse pass; otherwise the background drags it.
        ov.panel.setIgnoresMouseEvents(s.click_through);
        ov.panel.setMovableByWindowBackground(!s.click_through);
        ov.panel.orderFrontRegardless();
        pinfo!("overlay: strip {}x{} at ({}, {}) on a {}x{} screen, {} line(s)", frame.size.width as i32, frame.size.height as i32, frame.origin.x as i32, frame.origin.y as i32, screen.w as i32, screen.h as i32, labels.len());
        ov.placed = frame;
        ov.screen = screen;
        ov.shown = Some(content.clone());
        snapshot(&ov.root);
    });
}

/// Take the strip off the screen.
pub fn hide() {
    OVERLAY.with(|o| {
        if let Some(ov) = o.borrow_mut().as_mut() {
            if ov.panel.isVisible() {
                ov.panel.orderOut(None);
            }
            ov.shown = None;
        }
    });
}

/// The strip's frame in AppKit coordinates while it is up (for the self-test's screenshot).
pub fn frame() -> Option<(f64, f64, f64, f64)> {
    OVERLAY.with(|o| o.borrow().as_ref().filter(|ov| ov.panel.isVisible()).map(|ov| {
        let f = ov.panel.frame();
        (f.origin.x, f.origin.y, f.size.width, f.size.height)
    }))
}

/// The window number of the strip, for `screencapture -l`.
pub fn window_number() -> Option<isize> {
    OVERLAY.with(|o| o.borrow().as_ref().filter(|ov| ov.panel.isVisible()).map(|ov| ov.panel.windowNumber()))
}

/// When the person dragged the strip, the share of the screen its centre and bottom edge now stand at
/// (what `OverlaySettings::spot` keeps); None while it is where we put it.
pub fn dragged_to() -> Option<(f32, f32)> {
    OVERLAY.with(|o| {
        let o = o.borrow();
        let ov = o.as_ref()?;
        if !ov.panel.isVisible() {
            return None;
        }
        let f = ov.panel.frame();
        let moved = (f.origin.x - ov.placed.origin.x).abs() > 2.0 || (f.origin.y - ov.placed.origin.y).abs() > 2.0;
        if !moved {
            return None;
        }
        // AppKit y is up; the shared rule is y down from the screen's top.
        let top_down = Rect::new(f.origin.x as f32 - ov.screen.x, (ov.screen.y + ov.screen.h) as f32 - (f.origin.y + f.size.height) as f32, f.size.width as f32, f.size.height as f32);
        let area = Rect::new(0.0, 0.0, ov.screen.w, ov.screen.h);
        Some(overlay::spot_of(area, top_down))
    })
}

/// Bottom gap constant re-exported so the app can say where "home" is in a message.
pub const HOME_GAP: f32 = BOTTOM_GAP;

fn rect_of(f: NSRect) -> NSRect {
    NSRect::new(NSPoint::new(0.0, 0.0), f.size)
}

/// Dev aid: with `YSM_OVERLAY_SNAPSHOT=<file.png>` the strip is also written to that file as it is drawn
/// (screen capture needs a permission a test session may not have).
fn snapshot(view: &NSBox) {
    let Some(path) = std::env::var_os("YSM_OVERLAY_SNAPSHOT") else { return };
    let bounds = view.bounds();
    let Some(rep) = view.bitmapImageRepForCachingDisplayInRect(bounds) else { return };
    view.cacheDisplayInRect_toBitmapImageRep(bounds, &rep);
    let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) };
    if let Some(data) = data {
        let _ = data.writeToFile_atomically(&NSString::from_str(&path.to_string_lossy()), true);
    }
}
