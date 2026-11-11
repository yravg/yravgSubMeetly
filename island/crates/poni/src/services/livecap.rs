//! Fast latency (PMM-026, board P09): Windows 11's own Live Captions is the caption source. Its
//! window (class `LiveCaptionsDesktopWindow`) holds the recognized text in an element with the
//! automation id `CaptionsTextBlock`; this reads it with UI Automation about 8 times a second, as
//! LiveCaptions-Translator does, and `poni_core::livecap::Differ` turns it into an interim and
//! final lines. Our engine translates each final line (`/translate`); the spoken text needs no
//! engine at all, which is why the first words show in well under a second.
//!
//! Windows' own caption bar is moved off screen while this runs and put back where it was when it
//! stops. The place it came from is saved in `Settings::livecap_origin` by the caller BEFORE the
//! move, so a crash cannot strand the window: every island start (and the Captions tab's "Restore
//! Windows captions") puts it back (`restore_stranded`).
//!
//! NOT verified on a real Windows 11 PC from the machine this was written on (a Linux VPS cross
//! build): the element names, the off-screen move and whether Live Captions fights it are as
//! LiveCaptions-Translator and the Windows docs describe them.

use crate::events::{AppEvent, EventSink};
use crate::services::audio::ComApartment;
use crate::services::capture::{CaptureEvent, SessionLog};
use poni_core::livecap::{self, Differ, Fix};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement, TreeScope_Descendants};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect, IsIconic, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER};

const CLASS: PCWSTR = w!("LiveCaptionsDesktopWindow");
const TEXT_ID: &str = "CaptionsTextBlock";
const POLL: Duration = Duration::from_millis(120);
/// How long a start waits for the Live Captions window to appear.
const APPEAR: Duration = Duration::from_secs(10);
const STOP_TIMEOUT: Duration = Duration::from_millis(800);

/// `LiveCaptions.exe` ships with Windows 11 22H2 and newer.
pub fn installed() -> bool {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    std::path::Path::new(&root).join("System32").join("LiveCaptions.exe").exists()
}

fn window() -> Option<HWND> {
    unsafe { FindWindowW(CLASS, None).ok() }.filter(|h| !h.is_invalid())
}

/// The window's top-left corner and whether it is minimized; `None` when it is not running.
pub fn position() -> Option<((i32, i32), bool)> {
    let hwnd = window()?;
    let mut rc = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rc).ok()? };
    Some(((rc.left, rc.top), unsafe { IsIconic(hwnd) }.as_bool()))
}

fn move_to(at: (i32, i32)) -> bool {
    let Some(hwnd) = window() else { return false };
    unsafe { SetWindowPos(hwnd, None, at.0, at.1, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) }.is_ok()
}

/// Where Live Captions is now, if it is on screen: what a start records as the place to go back to.
pub fn on_screen_origin() -> Option<(i32, i32)> {
    position().filter(|(at, iconic)| !iconic && !livecap::is_parked(*at)).map(|(at, _)| at)
}

/// Put Live Captions' window back if it is off screen (a crash, or Fast still running): to the
/// recorded `origin`, else a place on screen. `Some(place)` when it was moved.
pub fn restore_stranded(origin: &str) -> Option<(i32, i32)> {
    let (at, iconic) = position()?;
    match livecap::restore(origin, at, iconic) {
        Fix::MoveTo(x, y) => move_to((x, y)).then_some((x, y)),
        Fix::Nothing => None,
    }
}

fn launch() {
    // A GUI program: no console. Failing to start it is told by the window never appearing.
    let _ = std::process::Command::new("LiveCaptions.exe").spawn();
}

struct Reader {
    uia: IUIAutomation,
    all: IUIAutomationCondition,
    element: Option<IUIAutomationElement>,
}

impl Reader {
    fn new() -> Option<Self> {
        let uia: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok()?;
        let all = unsafe { uia.CreateTrueCondition() }.ok()?;
        Some(Self { uia, all, element: None })
    }

    fn find(&self, hwnd: HWND) -> Option<IUIAutomationElement> {
        unsafe {
            let root = self.uia.ElementFromHandle(hwnd).ok()?;
            let found = root.FindAll(TreeScope_Descendants, &self.all).ok()?;
            (0..found.Length().ok()?).filter_map(|i| found.GetElement(i).ok()).find(|e| e.CurrentAutomationId().is_ok_and(|id| id.to_string() == TEXT_ID))
        }
    }

    /// The caption text now; `None` when the window or the element is gone.
    fn text(&mut self) -> Option<String> {
        if let Some(e) = &self.element {
            if let Ok(name) = unsafe { e.CurrentName() } {
                return Some(name.to_string());
            }
            self.element = None;
        }
        self.element = self.find(window()?);
        let e = self.element.as_ref()?;
        unsafe { e.CurrentName() }.ok().map(|n| n.to_string())
    }
}

pub struct LiveCapService {
    stop: Arc<AtomicBool>,
    langs: Arc<Mutex<(String, String)>>,
    thread: Option<JoinHandle<()>>,
    done: Receiver<()>,
}

impl LiveCapService {
    /// Start reading Live Captions. `origin` is where its window was (already saved by the caller).
    /// When Live Captions cannot be reached the service says `CaptureEvent::LiveCapGone` and the
    /// app falls back to our own captions with the Fast timing.
    pub fn start(sink: EventSink, port: u16, src: String, tgt: String, log: SessionLog, origin: Option<(i32, i32)>, hang_s: f32) -> std::io::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let langs = Arc::new(Mutex::new((src, tgt)));
        let (s, l) = (stop.clone(), langs.clone());
        let (done_tx, done) = channel();
        let thread = std::thread::Builder::new().name("poni-livecap".into()).spawn(move || {
            run(sink, port, l, log, origin, hang_s, s);
            let _ = done_tx.send(());
        })?;
        Ok(Self { stop, langs, thread: Some(thread), done })
    }

    pub fn set_langs(&self, src: String, tgt: String) {
        *self.langs.lock().unwrap_or_else(|e| e.into_inner()) = (src, tgt);
    }
}

impl Drop for LiveCapService {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let Some(thread) = self.thread.take() else { return };
        match self.done.recv_timeout(STOP_TIMEOUT) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                let _ = thread.join();
            }
            // The thread restores the window as soon as it wakes; the start of the island does it too.
            Err(RecvTimeoutError::Timeout) => crate::pwarn!("livecap: worker did not stop in time; detaching it"),
        }
    }
}

/// A line to translate: the spoken text and the seconds it covered.
struct Final {
    text: String,
    span_s: f64,
}

fn translator(port: u16, langs: Arc<Mutex<(String, String)>>, log: SessionLog, rx: Receiver<Final>, sink: EventSink) {
    use poni_core::lyric_tr::{parse_translation, translate_path};
    while let Ok(f) = rx.recv() {
        let (src, tgt) = langs.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let asked = Instant::now();
        let translation = if tgt == poni_core::capture::NO_TRANSLATION || tgt == src {
            String::new()
        } else {
            let path = format!("{}&fast=1", translate_path((src != "auto").then_some(src.as_str()), &tgt));
            helper_translate(port, &path, &f.text).and_then(|(c, b)| parse_translation(c, &b).ok()).unwrap_or_default()
        };
        let mut l = log.lock().unwrap_or_else(|e| e.into_inner());
        l.push_with_ms(f.text, translation, f.span_s, asked.elapsed().as_millis().min(u32::MAX as u128) as u32);
        drop(l);
        sink.send(AppEvent::Capture(CaptureEvent::Heard));
    }
}

fn helper_translate(port: u16, path: &str, text: &str) -> Option<(u16, String)> {
    poni_core::helper::request_bytes(port, "POST", path, "text/plain; charset=utf-8", text.as_bytes(), Duration::from_secs(20)).ok()
}

fn gone(sink: &EventSink, why: &str) {
    sink.send(AppEvent::Capture(CaptureEvent::LiveCapGone(why.to_string())));
}

fn run(sink: EventSink, port: u16, langs: Arc<Mutex<(String, String)>>, log: SessionLog, origin: Option<(i32, i32)>, hang_s: f32, stop: Arc<AtomicBool>) {
    let _com = ComApartment::enter_mta();
    let Some(mut reader) = Reader::new() else { return gone(&sink, "Windows could not give the island its caption text (UI Automation).") };
    if window().is_none() {
        launch();
        let t = Instant::now();
        while window().is_none() && t.elapsed() < APPEAR && !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    if window().is_none() {
        return gone(&sink, "Windows Live Captions did not open. It may need its first-run setup in Windows (Win + Ctrl + L).");
    }
    // The caption bar leaves the screen; the origin was saved before this runs.
    let _ = move_to(livecap::PARK);
    let (tx, rx) = channel::<Final>();
    let (l, g, s) = (langs, log.clone(), sink.clone());
    let tr = std::thread::Builder::new().name("poni-livecap-tr".into()).spawn(move || translator(port, l, g, rx, s));
    let mut differ = Differ::new(hang_s);
    let began = Instant::now();
    let mut last_seen = Instant::now();
    let mut last_park = Instant::now();
    let mut last_end = 0.0f64;
    let mut reason: Option<&str> = None;
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(POLL);
        let now = began.elapsed().as_secs_f32();
        match reader.text() {
            Some(text) => {
                last_seen = Instant::now();
                let out = differ.push(&text, now);
                for f in out.finals {
                    let _ = tx.send(Final { span_s: (now as f64 - last_end).clamp(0.5, 15.0), text: f });
                    last_end = now as f64;
                }
                let interim = out.interim;
                let mut l = log.lock().unwrap_or_else(|e| e.into_inner());
                if l.set_interim_if_changed(interim) {
                    drop(l);
                    sink.send(AppEvent::Capture(CaptureEvent::Interim));
                }
            }
            None if last_seen.elapsed() > Duration::from_secs(3) => {
                reason = Some("The Windows Live Captions window was closed.");
                break;
            }
            None => {}
        }
        // Live Captions docks itself to the top edge and can move back: park it again.
        if last_park.elapsed() > Duration::from_millis(600) {
            last_park = Instant::now();
            if position().is_some_and(|(at, iconic)| !iconic && !livecap::is_parked(at)) {
                let _ = move_to(livecap::PARK);
            }
        }
    }
    for f in differ.finish() {
        let _ = tx.send(Final { span_s: 2.0, text: f });
    }
    drop(tx);
    // Back where it was (or, with no record, on screen). A window the person closed is not there.
    let at = origin.unwrap_or(livecap::FALLBACK);
    if position().is_some_and(|(p, iconic)| !iconic && livecap::is_parked(p)) {
        let _ = move_to(at);
    }
    if let Ok(t) = tr {
        let _ = t.join();
    }
    if let Some(why) = reason {
        gone(&sink, why);
    }
}
