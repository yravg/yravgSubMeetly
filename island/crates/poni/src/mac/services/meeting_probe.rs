//! What could be a meeting, on the Mac: the apps CoreAudio says are recording the microphone right
//! now (per process, macOS 14.2+; on older systems the default input's "running somewhere" flag with
//! the running meeting apps as the candidates) and, only while one does, the on-screen windows'
//! owners and titles. Window titles need Screen Recording permission, which this never asks for:
//! without it macOS hands back owners only, so a call in a browser tab is recognised by its title
//! when the person has allowed that and by the calendar otherwise. Read every 2 s on its own
//! thread while [`MeetingProbe::set_active`] is on; changes leave as `AppEvent::MeetingSignals`.
//! Names go through `poni_core::meeting_detect::normalize`. Nothing leaves the Mac.

use super::cf;
use crate::events::{AppEvent, EventSink};
use poni_core::meeting_detect::normalize;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

const EVERY: Duration = Duration::from_secs(2);
/// This app's own bundle id: its own microphone use is not a meeting.
const OWN_BUNDLE: &str = "com.yraverage.submeetly";

/// What the probe saw: (process name, title) per window, and the microphone users.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Seen {
    pub windows: Vec<(String, String)>,
    pub mic: Vec<String>,
}

const fn fourcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
}

#[repr(C)]
struct Addr {
    selector: u32,
    scope: u32,
    element: u32,
}

const SYSTEM: u32 = 1;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
/// `kAudioHardwarePropertyProcessObjectList`, and a process object's pid, bundle id and
/// "is running input" (macOS 14.2+).
const PROCESS_LIST: u32 = fourcc(b"prs#");
const PROCESS_PID: u32 = fourcc(b"ppid");
const PROCESS_BUNDLE: u32 = fourcc(b"pbid");
const PROCESS_INPUT: u32 = fourcc(b"piri");
/// `kAudioHardwarePropertyDefaultInputDevice` and `kAudioDevicePropertyDeviceIsRunningSomewhere`.
const DEFAULT_INPUT: u32 = fourcc(b"dIn ");
const RUNNING_SOMEWHERE: u32 = fourcc(b"gone");

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(id: u32, addr: *const Addr, qual_size: u32, qual: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
    fn AudioObjectGetPropertyDataSize(id: u32, addr: *const Addr, qual_size: u32, qual: *const c_void, size: *mut u32) -> i32;
    fn AudioObjectHasProperty(id: u32, addr: *const Addr) -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> cf::CFTypeRef;
}

/// `kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements`.
const ON_SCREEN: u32 = (1 << 0) | (1 << 4);

fn addr(selector: u32) -> Addr {
    Addr { selector, scope: SCOPE_GLOBAL, element: 0 }
}

fn get_u32(id: u32, selector: u32) -> Option<u32> {
    let a = addr(selector);
    let mut v = 0u32;
    let mut size = 4u32;
    (unsafe { AudioObjectGetPropertyData(id, &a, 0, std::ptr::null(), &mut size, &mut v as *mut u32 as *mut c_void) } == 0).then_some(v)
}

/// The bundle ids of the processes recording input now, or None when this macOS has no
/// per-process list.
fn input_processes() -> Option<Vec<String>> {
    let a = addr(PROCESS_LIST);
    if unsafe { AudioObjectHasProperty(SYSTEM, &a) } == 0 {
        return None;
    }
    let mut size = 0u32;
    if unsafe { AudioObjectGetPropertyDataSize(SYSTEM, &a, 0, std::ptr::null(), &mut size) } != 0 {
        return None;
    }
    let mut ids = vec![0u32; size as usize / 4];
    if !ids.is_empty() && unsafe { AudioObjectGetPropertyData(SYSTEM, &a, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) } != 0 {
        return None;
    }
    let mut out = Vec::new();
    for id in ids {
        if get_u32(id, PROCESS_INPUT) != Some(1) {
            continue;
        }
        let _ = get_u32(id, PROCESS_PID);
        let b = addr(PROCESS_BUNDLE);
        let mut s: cf::CFTypeRef = std::ptr::null();
        let mut n = std::mem::size_of::<cf::CFTypeRef>() as u32;
        if unsafe { AudioObjectGetPropertyData(id, &b, 0, std::ptr::null(), &mut n, &mut s as *mut cf::CFTypeRef as *mut c_void) } == 0 && !s.is_null() {
            // A retained CFString: read it, then give it back.
            let name = cf::text(s);
            unsafe { cf::CFRelease(s) };
            if let Some(name) = name.filter(|n| !n.is_empty() && n != OWN_BUNDLE) {
                out.push(name);
            }
        }
    }
    Some(out)
}

/// Whether the default input device is recording for anyone.
fn input_running() -> bool {
    let Some(dev) = get_u32(SYSTEM, DEFAULT_INPUT).filter(|d| *d != 0) else { return false };
    get_u32(dev, RUNNING_SOMEWHERE) == Some(1)
}

/// Bundle ids of the running apps, for the older-macOS fallback (what could be using the microphone).
fn running_apps() -> Vec<String> {
    use objc2_app_kit::NSWorkspace;
    NSWorkspace::sharedWorkspace().runningApplications().iter().filter_map(|a| a.bundleIdentifier().map(|b| b.to_string())).collect()
}

/// Apps using the microphone now, as the names `source_kind` knows (anything that isn't a meeting
/// app or a browser is dropped: what else listens is none of this probe's business).
pub fn mic_users() -> Vec<String> {
    let known = |n: &str| n.ends_with(".exe");
    let ids = match input_processes() {
        Some(ids) => ids,
        None if input_running() => running_apps(),
        None => Vec::new(),
    };
    let mut out: Vec<String> = ids.iter().map(|i| normalize(i)).filter(|n| known(n)).collect();
    out.sort();
    out.dedup();
    out
}

fn dict_text(d: cf::CFTypeRef, k: &str) -> Option<String> {
    let key = cf::key(k);
    let v = unsafe { cf::CFDictionaryGetValue(d, &*key as *const _ as cf::CFTypeRef) };
    cf::text(v)
}

/// Titled windows of the app windows on screen: (normalized owner, title). Titles are empty without
/// Screen Recording permission; those windows are left out.
pub fn windows() -> Vec<(String, String)> {
    let list = unsafe { CGWindowListCopyWindowInfo(ON_SCREEN, 0) };
    if list.is_null() {
        return Vec::new();
    }
    let mut out: Vec<(String, String)> = Vec::new();
    for i in 0..unsafe { cf::CFArrayGetCount(list) } {
        let d = unsafe { cf::CFArrayGetValueAtIndex(list, i) };
        if cf::dict_i64(d, "kCGWindowLayer") != Some(0) {
            continue;
        }
        let (Some(owner), Some(title)) = (dict_text(d, "kCGWindowOwnerName"), dict_text(d, "kCGWindowName")) else { continue };
        if title.trim().is_empty() {
            continue;
        }
        let item = (normalize(&owner), title);
        if !out.contains(&item) {
            out.push(item);
        }
    }
    unsafe { cf::CFRelease(list) };
    out
}

pub struct MeetingProbe {
    stop: Sender<()>,
    active: Arc<AtomicBool>,
}

impl MeetingProbe {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let (stop, rx) = channel::<()>();
        let active = Arc::new(AtomicBool::new(false));
        let on = active.clone();
        std::thread::Builder::new().name("poni-meeting-probe".into()).spawn(move || {
            let mut last = Seen::default();
            loop {
                match rx.recv_timeout(EVERY) {
                    Err(RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
                let seen = if on.load(Ordering::Relaxed) {
                    let mic = mic_users();
                    // The window list is read only while a meeting app or a browser has the microphone.
                    let windows = if mic.is_empty() { Vec::new() } else { windows() };
                    Seen { windows, mic }
                } else {
                    Seen::default()
                };
                // A change, and while an app has the microphone a beat every 2 s: the detector counts
                // how long it has held (`meeting_detect::DETECT_S`).
                if seen != last || !seen.mic.is_empty() {
                    last = seen.clone();
                    sink.send(AppEvent::MeetingSignals(seen));
                }
            }
        })?;
        Ok(Self { stop, active })
    }

    /// Probe only while Settings › "Tell me when a meeting starts" is on.
    pub fn set_active(&self, on: bool) {
        self.active.store(on, Ordering::Relaxed);
    }
}

impl Drop for MeetingProbe {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The CoreAudio and window-list calls answer on this Mac without crashing, and only meeting
    /// apps and browsers are ever named.
    #[test]
    fn the_probe_reads_this_mac() {
        let mic = mic_users();
        assert!(mic.iter().all(|m| m.ends_with(".exe")), "only meeting apps and browsers are named: {mic:?}");
        let _ = windows();
        let _ = input_running();
    }
}
