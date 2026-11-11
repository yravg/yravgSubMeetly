//! The subtitle overlay on Windows: a layered, topmost, non-activating popup window with the live
//! captions in it. What it shows and where it sits is `poni_core::overlay`; this file is the window.
//!
//! The text is rasterised with GDI (anti-aliased, white on black) into coverage masks, and
//! `poni_core::overlay::compose_bgra` lays them over the rounded, translucent background as the
//! premultiplied pixels `UpdateLayeredWindow` wants, so the background opacity and the text are separate
//! (the background can be 0% while the text stays solid). Click-through is `WS_EX_TRANSPARENT`; without
//! it the strip is dragged by its body (`HTCAPTION`) and where it was left is read back by [`dragged_to`].
//!
//! Everything runs on the UI thread.

use crate::window::MonitorInfo;
use poni_core::geom::Rect;
use poni_core::overlay::{self, Mask, OverlaySettings, Sentence, LINE_GAP, PAD_X, PAD_Y, SENTENCE_GAP};
use std::sync::Mutex;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextColor, ANTIALIASED_QUALITY,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CALCRECT, DT_CENTER, DT_NOPREFIX, DT_WORDBREAK, FF_DONTCARE, FW_MEDIUM, FW_SEMIBOLD,
    HBITMAP, HDC, HGDIOBJ, OUT_DEFAULT_PRECIS, TRANSPARENT, DEFAULT_PITCH, AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::*;

const CLASS: PCWSTR = w!("yravgSubMeetly.Overlay");

/// What the strip is asked to show.
#[derive(Clone, Debug, PartialEq)]
pub struct Content {
    pub sentences: Vec<Sentence>,
    pub settings: OverlaySettings,
    pub paused: bool,
}

struct Overlay {
    hwnd: HWND,
    shown: Option<(Content, RECT)>,
    /// Where the strip was placed last (physical pixels), to tell a drag from our own move.
    placed: RECT,
    click_through: bool,
}

thread_local! {
    static OVERLAY: std::cell::RefCell<Option<Overlay>> = const { std::cell::RefCell::new(None) };
}

/// Where a drag ended: set by the window procedure, taken by the app's tick.
static DRAGGED: Mutex<Option<RECT>> = Mutex::new(None);

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        // The body is the title bar: the system drags it, and snaps it to nothing.
        WM_NCHITTEST => LRESULT(HTCAPTION as isize),
        WM_EXITSIZEMOVE => {
            let mut r = RECT::default();
            if GetWindowRect(hwnd, &mut r).is_ok() {
                if let Ok(mut d) = DRAGGED.lock() {
                    *d = Some(r);
                }
            }
            LRESULT(0)
        }
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_DPICHANGED => LRESULT(0),
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

fn create() -> Option<Overlay> {
    unsafe {
        let hinst = GetModuleHandleW(None).ok()?;
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(wndproc),
            hInstance: hinst.into(),
            lpszClassName: CLASS,
            ..Default::default()
        };
        // Registered again after the first time: the call fails harmlessly.
        RegisterClassExW(&wc);
        let hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, CLASS, w!("yravgSubMeetly overlay"), WS_POPUP, 0, 0, 1, 1, None, None, hinst, None).ok()?;
        Some(Overlay { hwnd, shown: None, placed: RECT::default(), click_through: false })
    }
}

struct Font(windows::Win32::Graphics::Gdi::HFONT);
impl Font {
    fn new(px: i32, bold: bool) -> Font {
        let weight = if bold { FW_SEMIBOLD.0 } else { FW_MEDIUM.0 } as i32;
        Font(unsafe {
            CreateFontW(-px, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET.0 as u32, OUT_DEFAULT_PRECIS.0 as u32, CLIP_DEFAULT_PRECIS.0 as u32, ANTIALIASED_QUALITY.0 as u32, (DEFAULT_PITCH.0 | FF_DONTCARE.0) as u32, w!("Segoe UI"))
        })
    }
}
impl Drop for Font {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.0 .0));
        }
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// A 32-bit top-down DIB section of `w`×`h` and its pixel pointer.
unsafe fn dib(hdc: HDC, w: i32, h: i32) -> Option<(HBITMAP, *mut u8)> {
    let bmi = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let bmp = CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
    (!bits.is_null()).then_some((bmp, bits as *mut u8))
}

/// How tall `text` is at the font's size when wrapped to `width` px.
fn measure(hdc: HDC, font: &Font, text: &str, width: i32) -> i32 {
    unsafe {
        let old = SelectObject(hdc, HGDIOBJ(font.0 .0));
        let mut t = wide(text);
        let mut r = RECT { left: 0, top: 0, right: width, bottom: 0 };
        DrawTextW(hdc, &mut t, &mut r, DT_CALCRECT | DT_WORDBREAK | DT_NOPREFIX | DT_CENTER);
        SelectObject(hdc, old);
        (r.bottom - r.top).max(1)
    }
}

/// The coverage of `text` drawn white on black into a `width`×`height` mask.
fn raster(hdc: HDC, font: &Font, text: &str, width: i32, height: i32) -> Option<Mask> {
    unsafe {
        let (bmp, bits) = dib(hdc, width, height)?;
        let old_bmp = SelectObject(hdc, HGDIOBJ(bmp.0));
        let old_font = SelectObject(hdc, HGDIOBJ(font.0 .0));
        std::ptr::write_bytes(bits, 0, (width * height * 4) as usize);
        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, COLORREF(0x00FF_FFFF));
        let mut t = wide(text);
        let mut r = RECT { left: 0, top: 0, right: width, bottom: height };
        DrawTextW(hdc, &mut t, &mut r, DT_WORDBREAK | DT_NOPREFIX | DT_CENTER);
        let px: Vec<u8> = (0..(width * height) as usize).map(|i| *bits.add(i * 4)).collect();
        SelectObject(hdc, old_font);
        SelectObject(hdc, old_bmp);
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        Some(Mask { w: width as usize, h: height as usize, px })
    }
}

/// Show `content` on `mon`, building the strip if it isn't what is up.
pub fn show(content: &Content, mon: &MonitorInfo) {
    OVERLAY.with(|o| {
        let mut o = o.borrow_mut();
        if o.is_none() {
            *o = create();
        }
        let Some(ov) = o.as_mut() else { return };
        let rect = mon.rect;
        if ov.shown.as_ref().is_some_and(|(c, r)| c == content && r.left == rect.left && r.top == rect.top && r.right == rect.right && r.bottom == rect.bottom) {
            return;
        }
        let s = &content.settings;
        let scale = mon.scale();
        let screen_dip = Rect::new(0.0, 0.0, (rect.right - rect.left) as f32 / scale, (rect.bottom - rect.top) as f32 / scale);
        let width_dip = overlay::strip_width(screen_dip.w);
        let (width_px, pad_x, pad_y) = ((width_dip * scale).round() as i32, (PAD_X * scale).round() as i32, (PAD_Y * scale).round() as i32);
        let inner = (width_px - 2 * pad_x).max(40);
        let px_size = (s.font_size as f32 * mon.dpi as f32 / 72.0).round() as i32;

        unsafe {
            let screen_dc = GetDC(None);
            let hdc = CreateCompatibleDC(screen_dc);

            // The lines, top to bottom: each sentence's original, then its translation.
            struct Line {
                text: String,
                color: overlay::Rgb,
                bold: bool,
                small: bool,
                gap: i32,
                h: i32,
            }
            let mut lines: Vec<Line> = Vec::new();
            let n = content.sentences.len();
            for (i, sent) in content.sentences.iter().enumerate() {
                let mut first = true;
                for (text, color, bold) in [(&sent.original, s.original_color, false), (&sent.translation, s.translation_color, true)] {
                    if text.is_empty() {
                        continue;
                    }
                    let text = if sent.live && i + 1 == n && !content.paused { format!("{text} …") } else { text.clone() };
                    let gap = if lines.is_empty() { 0.0 } else if first { SENTENCE_GAP } else { LINE_GAP };
                    lines.push(Line { text, color, bold, small: false, gap: (gap * scale).round() as i32, h: 0 });
                    first = false;
                }
            }
            if content.paused {
                lines.push(Line { text: "Paused".into(), color: overlay::Rgb(200, 200, 200), bold: false, small: true, gap: (SENTENCE_GAP * scale).round() as i32, h: 0 });
            }
            if lines.is_empty() {
                lines.push(Line { text: "Listening …".into(), color: overlay::Rgb(180, 180, 180), bold: false, small: true, gap: 0, h: 0 });
            }
            for l in lines.iter_mut() {
                let size = if l.small { ((px_size as f32 * 0.6).round() as i32).max(12) } else { px_size };
                l.h = measure(hdc, &Font::new(size, l.bold), &l.text, inner);
            }
            let text_h: i32 = lines.iter().map(|l| l.h + l.gap).sum();
            let height_px = text_h + 2 * pad_y;

            // Where it goes: the same rule as on every platform, in DIPs, then back to pixels.
            let placed = overlay::place(screen_dip, width_dip, height_px as f32 / scale, s.spot);
            let (x, y) = (rect.left + (placed.x * scale).round() as i32, rect.top + (placed.y * scale).round() as i32);
            let (w, h) = (((placed.w * scale).round() as i32).max(1), ((placed.h * scale).round() as i32).max(1));

            // The pixels.
            let masks: Vec<(overlay::Rgb, Mask, usize, usize)> = {
                let mut out = Vec::new();
                let mut top = pad_y;
                for l in &lines {
                    top += l.gap;
                    let size = if l.small { ((px_size as f32 * 0.6).round() as i32).max(12) } else { px_size };
                    if let Some(m) = raster(hdc, &Font::new(size, l.bold), &l.text, inner, l.h) {
                        out.push((l.color, m, pad_x as usize, top as usize));
                    }
                    top += l.h;
                }
                out
            };
            let refs: Vec<(overlay::Rgb, &Mask, usize, usize)> = masks.iter().map(|(c, m, ox, oy)| (*c, m, *ox, *oy)).collect();
            let buf = overlay::compose_bgra(w as usize, h as usize, s.background, s.background_alpha(), 14.0 * scale, &refs);

            if let Some((bmp, bits)) = dib(hdc, w, h) {
                std::ptr::copy_nonoverlapping(buf.as_ptr(), bits, buf.len());
                let old = SelectObject(hdc, HGDIOBJ(bmp.0));
                // Click-through: the mouse goes to what is under it.
                let mut ex = GetWindowLongPtrW(ov.hwnd, GWL_EXSTYLE);
                let want = s.click_through;
                if want != ov.click_through || (ex & WS_EX_TRANSPARENT.0 as isize != 0) != want {
                    if want {
                        ex |= WS_EX_TRANSPARENT.0 as isize;
                    } else {
                        ex &= !(WS_EX_TRANSPARENT.0 as isize);
                    }
                    SetWindowLongPtrW(ov.hwnd, GWL_EXSTYLE, ex);
                    ov.click_through = want;
                }
                let pos = POINT { x, y };
                let size = SIZE { cx: w, cy: h };
                let src = POINT { x: 0, y: 0 };
                let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
                let _ = UpdateLayeredWindow(ov.hwnd, screen_dc, Some(&pos), Some(&size), hdc, Some(&src), COLORREF(0), Some(&blend), ULW_ALPHA);
                let _ = SetWindowPos(ov.hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
                SelectObject(hdc, old);
                let _ = DeleteObject(HGDIOBJ(bmp.0));
                ov.placed = RECT { left: x, top: y, right: x + w, bottom: y + h };
            }
            let _ = DeleteDC(hdc);
            ReleaseDC(None, screen_dc);
        }
        ov.shown = Some((content.clone(), rect));
    });
}

/// Take the strip off the screen.
pub fn hide() {
    OVERLAY.with(|o| {
        if let Some(ov) = o.borrow_mut().as_mut() {
            if ov.shown.is_some() {
                unsafe {
                    let _ = ShowWindow(ov.hwnd, SW_HIDE);
                }
                ov.shown = None;
            }
        }
    });
}

/// When the person dragged the strip: the share of the screen its centre and bottom edge now stand at
/// (what `OverlaySettings::spot` keeps).
pub fn dragged_to(mon: &MonitorInfo) -> Option<(f32, f32)> {
    let r = DRAGGED.lock().ok()?.take()?;
    let scale = mon.scale();
    let screen = Rect::new(0.0, 0.0, (mon.rect.right - mon.rect.left) as f32 / scale, (mon.rect.bottom - mon.rect.top) as f32 / scale);
    let strip = Rect::new((r.left - mon.rect.left) as f32 / scale, (r.top - mon.rect.top) as f32 / scale, (r.right - r.left) as f32 / scale, (r.bottom - r.top) as f32 / scale);
    Some(overlay::spot_of(screen, strip))
}
