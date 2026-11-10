//! What could be a meeting: visible top-level windows (process name, title) and the apps Windows
//! records as using the microphone now (ConsentStore\microphone, `LastUsedTimeStop == 0`). Read
//! every 2 s on its own thread, only while [`MeetingProbe::set_active`] says sound or media plays;
//! changes leave as `AppEvent::MeetingSignals`. Nothing leaves the PC.

use crate::events::{AppEvent, EventSink};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, TRUE};
use windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_QWORD};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible};

const EVERY: Duration = Duration::from_secs(2);
const MIC: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone");

/// What the probe saw: (process name, title) per window, and the microphone users.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Seen {
    pub windows: Vec<(String, String)>,
    pub mic: Vec<String>,
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
                let seen = if on.load(Ordering::Relaxed) { Seen { windows: windows(), mic: mic_users() } } else { Seen::default() };
                if seen != last {
                    last = seen.clone();
                    sink.send(AppEvent::MeetingSignals(seen));
                }
            }
        })?;
        Ok(Self { stop, active })
    }

    /// Probe only while the PC plays sound or media.
    pub fn set_active(&self, on: bool) {
        self.active.store(on, Ordering::Relaxed);
    }
}

impl Drop for MeetingProbe {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

/// Visible titled top-level windows with their process name (`chrome.exe`), one per (process, title).
pub fn windows() -> Vec<(String, String)> {
    unsafe extern "system" fn visit(hwnd: HWND, lp: LPARAM) -> BOOL {
        let out = &mut *(lp.0 as *mut Vec<(u32, String)>);
        let n = GetWindowTextLengthW(hwnd);
        if n > 0 && IsWindowVisible(hwnd).as_bool() {
            let mut buf = vec![0u16; n as usize + 1];
            let got = GetWindowTextW(hwnd, &mut buf).max(0) as usize;
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 && got > 0 {
                out.push((pid, String::from_utf16_lossy(&buf[..got])));
            }
        }
        TRUE
    }
    let mut found: Vec<(u32, String)> = Vec::new();
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut found as *mut _ as isize)) };
    let mut names: Vec<(u32, Option<String>)> = Vec::new();
    let mut out: Vec<(String, String)> = Vec::new();
    for (pid, title) in found {
        let name = match names.iter().find(|(p, _)| *p == pid) {
            Some((_, n)) => n.clone(),
            None => {
                let n = process_name(pid);
                names.push((pid, n.clone()));
                n
            }
        };
        if let Some(n) = name {
            if !out.iter().any(|(a, b)| *a == n && *b == title) {
                out.push((n, title));
            }
        }
    }
    out
}

fn process_name(pid: u32) -> Option<String> {
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.is_ok();
    unsafe {
        let _ = CloseHandle(h);
    }
    let path = String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]);
    ok.then(|| path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string())
}

/// Apps using the microphone now: packaged ones by family name (`MSTeams_8wekyb3d8bbwe`), desktop
/// ones by path with `#` for `\` (`C:#Program Files#Zoom#bin#Zoom.exe`).
pub fn mic_users() -> Vec<String> {
    let mut out = Vec::new();
    in_use(MIC, &mut out);
    let mut np: Vec<u16> = format!("{}\\NonPackaged", String::from_utf16_lossy(unsafe { MIC.as_wide() })).encode_utf16().collect();
    np.push(0);
    in_use(PCWSTR(np.as_ptr()), &mut out);
    out
}

fn in_use(path: PCWSTR, out: &mut Vec<String>) {
    let mut key = HKEY::default();
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path, 0, KEY_READ, &mut key) }.is_err() {
        return;
    }
    for i in 0.. {
        let mut name = [0u16; 512];
        let mut len = name.len() as u32;
        if unsafe { RegEnumKeyExW(key, i, PWSTR(name.as_mut_ptr()), &mut len, None, PWSTR::null(), None, None) }.is_err() {
            break;
        }
        let mut zname = name[..len as usize].to_vec();
        zname.push(0);
        let (mut start, mut stop) = (0u64, 1u64);
        let mut size = 8u32;
        let a = unsafe { RegGetValueW(key, PCWSTR(zname.as_ptr()), w!("LastUsedTimeStart"), RRF_RT_REG_QWORD, None, Some(&mut start as *mut u64 as *mut _), Some(&mut size)) };
        size = 8;
        let b = unsafe { RegGetValueW(key, PCWSTR(zname.as_ptr()), w!("LastUsedTimeStop"), RRF_RT_REG_QWORD, None, Some(&mut stop as *mut u64 as *mut _), Some(&mut size)) };
        // Started and not stopped yet: in use now.
        if a.is_ok() && b.is_ok() && start != 0 && stop == 0 {
            out.push(String::from_utf16_lossy(&name[..len as usize]));
        }
    }
    unsafe {
        let _ = RegCloseKey(key);
    }
}
