//! The app: owns the island window, state, renderer and services; routes
//! window messages, service events and page commands.

use crate::activities::{self, Mode};
use crate::clock;
use crate::commands::{CalendarCmd, Command, MediaCmd, NotifyCmd, PairCmd, PhoneCmd, WinLangCmd};
use crate::events::{AppEvent, AppleMusicStatus, EventSink, SendHwnd, WM_APP_APPBAR, WM_APP_EVENT, WM_APP_FRAME, WM_APP_TRAY};
use crate::gfx::{px_rect, px_union, scale_about, union_rect, Canvas, Gfx, HitMask};
use crate::icons::Icon;
use crate::island::{Geom, Island, SHOULDER};
use crate::pages::{self, PageKind};
use crate::paths;
use crate::pill;
use crate::services::notifications::NotifyEvent;
use crate::services::{self, Services};
use crate::settings_host::{self, SettingsWindow};
use crate::settings_window::Section;
use crate::state::{
    AppState, FpsAccess, HudKind, InlineAction, Locate, LyricsState, LyricsStatus, Notice, NoticeAction, NotifyAccess, PairedPhone, PhoneAsk,
    PhoneDrop, PhoneTransfer, PhoneView, PrayerState,
};
use crate::tray::{self, Tray};
use crate::ui::{wid, CursorKind, Hit, Input, KeyInput, MouseButton, Ui};
use crate::window::{self, FrameClock, FrameTick, MonitorInfo};
use crate::{dragdrop, shell};
use poni_core::spot;
use poni_core::addons::Status as AddonStatus;
use poni_core::frametime::{ambient_divisor, MotionStats};
use poni_core::geom::{palette, Color, Point, Rect};
use poni_core::pairdrop::{MeetEvent, PeerEvent};
use poni_core::phonedrop::{Event as PhoneEvent, QrMatrix};
use poni_core::prayer::{Due, PlaceList, Prayer, PrayerMoment};
use poni_core::settings::{IdleStyle, PrayerSound, Settings, Theme};
use poni_core::settings::MonitorChoice;
use poni_core::store::{load_json, parse_json, save_json_atomic, LoadOutcome, Store};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use windows::core::{w, Result, HSTRING};
use windows::Foundation::Numerics::Matrix3x2;
use windows::Win32::Foundation::*;
use windows::Win32::System::Ole::{OleInitialize, OleUninitialize};
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

/// The engine takes a calendar file up to this size (its own limit is 5 MB).
const ICS_MAX_BYTES: u64 = 5 * 1024 * 1024;

/// Not exported by windows-rs 0.58's WindowsAndMessaging module.
const WM_MOUSELEAVE: u32 = 0x02A3;

const TIMER_HOVER: usize = 1;
/// A notice shown now stays this long (mono seconds).
const NOTICE_S: f64 = 8.0;
/// How long a revealed sum stays in its notice (mono seconds).
const SHOWN_S: f64 = 5.0;
const TIMER_COLLAPSE: usize = 2;
const TIMER_WAKE: usize = 3;
const TIMER_SAVE: usize = 4;
const TIMER_STATS: usize = 5;
const TIMER_MINUTE: usize = 6;
const TIMER_TRAY: usize = 8;
const TIMER_RAISE: usize = 9;
/// Show over games: the readout's peek ends.
const TIMER_PEEK: usize = 10;
/// The next read of the update file (`crate::updates`).
const TIMER_UPDATE: usize = 11;
/// Show over games: how long the readout shows over a game, the least time
/// between two peeks for a frame-rate drop, and Alt+Shift+F's id.
const PEEK_S: f64 = 5.0;
const DROP_PEEK_EVERY_S: f64 = 30.0;
const HOTKEY_PEEK: i32 = 1;
/// Alt+Shift+S pauses and resumes the Script page's reading from any app.
const HOTKEY_SCRIPT: i32 = 2;
/// Record pressed: how long the Record page says "Opening the recorder"
/// without word from it (a cold start of the recorder takes a few seconds).
const REC_OPENING_S: f64 = 15.0;
/// How long the Record page shows why a recording didn't start.
const REC_ERROR_S: f64 = 8.0;
/// Raises that follow a new foreground window, and their spacing.
const RAISE_REPEATS: u8 = 4;
const RAISE_INTERVAL_MS: u32 = 500;

const WM_CAPTURECHANGED_: u32 = 0x0215;
const WM_WTSSESSION_CHANGE_: u32 = 0x02B1;
const WTS_SESSION_LOCK_: usize = 7;
const WTS_SESSION_UNLOCK_: usize = 8;

/// Steps for copying the Apple Music token (README).
const APPLE_MUSIC_HELP_URL: &str = "https://github.com/yravg/yravgSubMeetly#apple-music-lyrics";
/// Phone drop closes itself after this long without a request from a phone.
const PHONE_IDLE_S: f64 = 600.0;

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
    /// Posted messages that arrived while the app was borrowed (a nested
    /// message loop ran inside a handler). Replayed when the borrow ends.
    static MISSED: RefCell<Vec<(u32, WPARAM, LPARAM)>> = const { RefCell::new(Vec::new()) };
    /// A WM_APP_FRAME was swallowed: re-arm the frame clock.
    static FRAME_MISSED: Cell<bool> = const { Cell::new(false) };
}

/// Modal work that must run without the App borrowed (it pumps messages).
pub enum Deferred {
    DragOut(Vec<String>),
    Menu(POINT),
}

pub fn main_entry() -> i32 {
    let args: Vec<String> = std::env::args().collect();
    // Show over games' one-time OK runs this exe elevated, just for this.
    if let Some(i) = args.iter().position(|a| a == services::frames::ALLOW_ARG) {
        return services::frames::allow_main(args.get(i + 1).map_or("", String::as_str));
    }
    crate::plog::init(paths::log_path());
    pinfo!("Poni {} starting (args: {:?})", env!("CARGO_PKG_VERSION"), &args[1..]);
    std::panic::set_hook(Box::new(|info| {
        perror!("panic: {info}");
    }));

    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    // Single instance. A run with its own PONI_HOME (dev, self-test) is its own instance, next to the installed one.
    let mutex_name = HSTRING::from(instance_mutex_name(std::env::var_os("PONI_HOME").as_deref()));
    let _mutex = unsafe { CreateMutexW(None, true, &mutex_name) };
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        pinfo!("another instance is running; exiting");
        // A Start-menu "Minutes register" or "Open yravgSubMeetly" launch while the island runs: the running one has the engine.
        if let Some(path) = services::engine::open_arg(&args) {
            services::engine::open_now(path);
        }
        return 0;
    }
    if let Err(e) = unsafe { OleInitialize(None) } {
        perror!("OleInitialize failed: {e}");
        return 2;
    }
    if crate::autostart::packaged() {
        pinfo!("running as the Microsoft Store package");
    }
    // Install on next start: the new version's Setup, downloaded and checked
    // earlier, runs now, before any window, and opens the new version.
    if !crate::autostart::packaged() && crate::updates::pending_install() {
        unsafe { OleUninitialize() };
        return 0;
    }
    if let Some(path) = services::engine::open_arg(&args) {
        services::engine::open_when_ready(path);
    }
    let code = match run() {
        Ok(code) => code,
        Err(e) => {
            perror!("fatal: {e}");
            3
        }
    };
    unsafe { OleUninitialize() };
    pinfo!("Poni exiting with code {code}");
    code
}

fn run() -> Result<i32> {
    window::register_classes(island_wndproc, helper_wndproc)?;
    if let Err(e) = settings_host::register(settings_wndproc) {
        pwarn!("settings window: class not registered ({e})");
    }
    let hwnd = window::create_island_window()?;
    let helper = window::create_helper_window()?;
    pinfo!("windows created");

    let (raw_settings, s_out): (Settings, _) = load_json(&paths::settings_path());
    if let Some(m) = s_out.message() {
        pwarn!("settings: {m}");
    }
    let raw_settings = if s_out == LoadOutcome::Missing { raw_settings.fresh_install() } else { raw_settings };
    let settings = raw_settings.clone().sanitized();
    // Write new files, and write migrated / clamped values back so a
    // migration (e.g. the v2 hover delay) happens once and sticks.
    if s_out == LoadOutcome::Missing || (settings != raw_settings && s_out.writable()) {
        if let Err(e) = save_json_atomic(&paths::settings_path(), &settings) {
            pwarn!("saving settings failed: {e}");
        } else if s_out != LoadOutcome::Missing {
            pinfo!("settings: wrote back migrated / out-of-range values (v{})", settings.settings_version);
        }
    }
    let (store, d_out): (Store, _) = load_json(&paths::store_path());
    if let Some(m) = d_out.message() {
        pwarn!("data: {m}");
    }

    let (tx, rx) = mpsc::channel();
    let sink = EventSink::new(tx, SendHwnd::new(hwnd));
    let app = App::new(hwnd, helper, sink, rx, settings, store, s_out.writable(), d_out.writable())?;
    APP.with(|c| *c.borrow_mut() = Some(app));
    with_app(|app| app.start());
    pinfo!("started; entering message loop");

    let mut msg = MSG::default();
    unsafe {
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    let code = APP.with(|c| c.borrow_mut().take().map(|mut a| a.shutdown()).unwrap_or(0));
    Ok(code)
}

/// Run `f` with the app if it isn't already borrowed (re-entrancy safe).
pub fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    let (r, hwnd) = APP.with(|c| match c.try_borrow_mut() {
        Ok(mut g) => match g.as_mut() {
            Some(app) => {
                let r = f(app);
                if FRAME_MISSED.with(|m| m.replace(false)) {
                    app.clock.frame_handled();
                    app.request_frame();
                }
                (Some(r), Some(app.hwnd))
            }
            None => (None, None),
        },
        Err(_) => (None, None),
    });
    // Re-post messages a nested loop swallowed while we were borrowed.
    if let Some(hwnd) = hwnd {
        let missed = MISSED.with(|m| std::mem::take(&mut *m.borrow_mut()));
        for (msg, wp, lp) in missed {
            unsafe {
                let _ = PostMessageW(hwnd, msg, wp, lp);
            }
        }
    }
    r
}

/// Remember a message that couldn't be handled because the app was borrowed.
fn note_missed(msg: u32, wp: WPARAM, lp: LPARAM) -> bool {
    match msg {
        WM_APP_FRAME => {
            FRAME_MISSED.with(|f| f.set(true));
            true
        }
        WM_APP_EVENT | WM_MOUSELEAVE | WM_TIMER | WM_LBUTTONUP | WM_APP_TRAY | WM_APP_APPBAR => {
            MISSED.with(|m| {
                let mut v = m.borrow_mut();
                if v.len() < 64 && !(msg != WM_TIMER && v.iter().any(|x| x.0 == msg && x.1 == wp)) {
                    v.push((msg, wp, lp));
                }
            });
            true
        }
        _ => false,
    }
}

unsafe extern "system" fn island_wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_COPYDATA {
    }
    let mut deferred = Vec::new();
    let res = with_app(|app| app.handle_island(msg, wp, lp, &mut deferred));
    for d in deferred {
        run_deferred(d);
    }
    match res {
        Some(Some(r)) => r,
        Some(None) => DefWindowProcW(hwnd, msg, wp, lp),
        None if note_missed(msg, wp, lp) => LRESULT(0),
        None => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

unsafe extern "system" fn helper_wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let mut deferred = Vec::new();
    let res = with_app(|app| app.handle_helper(msg, wp, lp, &mut deferred));
    for d in deferred {
        run_deferred(d);
    }
    match res {
        Some(Some(r)) => r,
        Some(None) => DefWindowProcW(hwnd, msg, wp, lp),
        // Helper messages are re-posted to the island window, which forwards
        // tray/appbar ids back to the helper handler.
        None if matches!(msg, WM_APP_TRAY | WM_APP_APPBAR) => {
            let _ = note_missed(msg, wp, lp);
            LRESULT(0)
        }
        None => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// The single-instance mutex's name. The installed app's is fixed; a run with its own
/// `PONI_HOME` (dev, self-test) gets one per home, so dev islands run side by side.
fn instance_mutex_name(home: Option<&std::ffi::OsStr>) -> String {
    match home {
        None => "Local\\yravgSubMeetly.Island".into(),
        // FNV-1a: a short stable tag, not a security hash.
        Some(h) => format!("Local\\yravgSubMeetly.Island.dev.{:08x}", h.to_string_lossy().to_lowercase().bytes().fold(0x811c9dc5u32, |a, b| (a ^ b as u32).wrapping_mul(0x0100_0193))),
    }
}

/// The Settings window's messages (`settings_window`).
unsafe extern "system" fn settings_wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let mut deferred = Vec::new();
    let res = with_app(|app| app.handle_settings_window(hwnd, msg, wp, lp, &mut deferred));
    for d in deferred {
        run_deferred(d);
    }
    match res {
        Some(Some(r)) => r,
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

fn run_deferred(d: Deferred) {
    match d {
        Deferred::DragOut(paths) => {
            with_app(|app| app.release_mouse());
            if let Err(e) = dragdrop::drag_out(&paths) {
                pwarn!("drag out failed: {e}");
            }
            with_app(|app| app.request_frame());
        }
        Deferred::Menu(pt) => {
            let Some((helper, items)) = with_app(|app| {
                // Right-clicked on the open island (the tray's menu leaves it as it is).
                app.menu_open = app.expanded && app.hovering;
                (app.helper, tray::menu_items(&app.st.settings, app.st.pinned, crate::updates::menu_line(&app.st, app.updater.is_some()), &app.st.engine, app.st.capture.running()))
            }) else {
                return;
            };
            let cmd = tray::show_menu(helper, pt, &items);
            with_app(|app| {
                app.menu_closed();
                if let Some(cmd) = cmd {
                    app.on_menu(cmd);
                }
            });
        }
    }
}

pub struct App {
    hwnd: HWND,
    helper: HWND,
    gfx: Gfx,
    pub st: AppState,
    island: Island,
    mode: Mode,
    input: Input,
    hits: Vec<Hit>,
    hovering: bool,
    expanded: bool,
    drag_hover: bool,
    text_focus: bool,
    prev_foreground: HWND,
    monitor: MonitorInfo,
    /// The Settings window, while it is open.
    settings_win: Option<SettingsWindow>,
    clock: FrameClock,
    sink: EventSink,
    rx: Receiver<AppEvent>,
    services: Option<Services>,
    /// The Glass theme's screen copy, light/dark choice and glass.
    glass: crate::glass::Glass,
    /// Prayer times' adzan, while it plays.
    adzan: services::adzan::AdzanPlayer,
    /// The glass was still changing on the last frame (turning light or dark).
    glass_moving: bool,
    /// Animation time of the last frame (the vblank it was shown on).
    last_frame_t: f64,
    /// The window: a fixed-size surface the island is drawn in, centred on
    /// the monitor unless the island was dragged along the top edge.
    surface: Surface,
    /// The island's centre in the window, DIPs (where it hangs from): where
    /// it rests (`home_cx`), unless its outline needs more room there.
    cx: f32,
    /// Where the island's centre rests in the window, DIPs: the window's
    /// middle, or off it once dragged towards an edge (`place_surface`).
    home_cx: f32,
    /// Canvas pixels drawn last frame (the next frame clears them).
    prev_canvas_px: Option<RECT>,
    /// GPU renderer: the hit mask last pushed to the window, and when.
    mask: Option<(HitMask, f64)>,
    /// Smoothness of the morph in progress (logged when it settles).
    motion: Option<MotionStats>,
    motion_name: &'static str,
    /// Motions logged so far, and when a hitchy one was last logged.
    motions_logged: u32,
    hitch_logged_at: f64,
    /// Per-frame timing of the first few morphs (for the log): vblanks since
    /// the last frame, then ms from vblank to drawing, to draw, to present
    /// and to update the hit mask.
    trace: Vec<(u32, [f32; 4])>,
    /// DWM's counters when the morph began (refreshes, frames composed,
    /// frames missed), to tell our dropped frames from the compositor's.
    dwm_at_start: Option<(u64, u64, u64)>,
    /// Log lines written off the frame path (file writes can take tens of ms).
    log_queue: Vec<String>,
    fullscreen_hidden: bool,
    /// The last full-screen state reported, hidden or not.
    fullscreen_on: bool,
    /// Step aside: the app windows at the top edge of the island's monitor
    /// (screen pixels, cut to the band along it), as last reported.
    top_windows: Vec<[i32; 4]>,
    /// Follow-up raises still due (TIMER_RAISE).
    raises_left: u8,
    /// Window classes already logged for covering the island (once each).
    covered_by: HashSet<String>,
    shown: bool,
    stats_on: bool,
    /// The System page's sampler thread: from the start while its history is
    /// kept (`Settings::system_history_on`: System on, its history kept),
    /// else from the first time the page opens or a game's readout needs it.
    sysmon: Option<services::sysmon::SysMon>,
    /// The System page is open (its readings come each second).
    sysmon_on: bool,
    /// What the System reader was last told about nobody being there and battery saver.
    sysmon_rest: poni_core::sysmon::Rest,
    /// Show over games: the game's frames, counted while the readout shows.
    frames: Option<services::frames::Frames>,
    /// The process whose frames count (the full-screen app).
    game_pid: Option<u32>,
    /// Show over games, peeks only: the readout shows over the game until this
    /// mono time (a peek), else the island hides so the game goes straight to
    /// the screen.
    game_peek_until: f64,
    /// When a frame-rate drop last made it peek.
    game_drop_at: f64,
    /// Show over games, the readout that stays: Alt+Shift+F hid it until the
    /// next game (or until pressed again).
    game_hidden: bool,
    /// Alt+Shift+F is registered (only while a game is in front).
    peek_hotkey: bool,
    /// Alt+Shift+S is registered (only while the Script page can read).
    script_hotkey: bool,
    /// The Script page has asked for the island to stay out of screen capture.
    script_excluded: bool,
    /// A reading held the island open at the last tick.
    script_held: bool,
    /// The Script page was on screen at the last tick.
    script_shown: bool,
    /// App icons the System page asked for and hasn't got yet (the Shelf's
    /// thumbnail worker answers both pages with the same event).
    icon_wait: HashSet<String>,
    tray: Option<Tray>,
    taskbar_created_msg: u32,
    exit_code: i32,
    /// Settings as last written to disk (to diff page-made changes).
    saved_settings: Settings,
    /// False when the file existed but couldn't be read: never overwrite it.
    settings_writable: bool,
    store_writable: bool,
    /// Captions that start by themselves with a video or a meeting.
    auto_captions: poni_core::capture::Auto,
    /// The PC plays sound now (`services::meter`).
    sound_on: bool,
    /// The current press started as a double-click (its click is ignored).
    dbl_press: bool,
    /// Pending high surrogate from WM_CHAR.
    high_surrogate: Option<u16>,
    /// Unconsumed wheel notches accumulated for page switching.
    wheel_acc: f32,
    wheel_t: f64,
    page_switch_t: f64,
    /// Session locked / display off: pause ambient animation.
    locked: bool,
    display_off: bool,
    tray_retries: u32,
    /// Content of the previous mode, fading out while the outline morphs:
    /// (mode, start time, its geometry, the opacity it fades from).
    outgoing: Option<(Mode, f64, Geom, f32)>,
    /// A page switch in progress: (from page, start time, slide direction).
    page_anim: Option<(PageKind, f64, f32)>,
    /// Where the hover (dwell) timer was last armed; None when it isn't.
    hover_arm: Option<Point>,
    /// The pointer left the open island: close it on the next frame.
    collapse_due: bool,
    /// When the pointer last closed the island by leaving it.
    left_at: f64,
    /// The right-click menu is open over the open island. The pointer on
    /// the menu has left the island as far as Windows is concerned, so the
    /// menu holds the island open until it closes.
    menu_open: bool,
    /// Phone drop's web server while the Shelf's phone panel is open.
    phone: Option<services::phonedrop::PhoneDrop>,
    /// The Shelf paths last handed to it (to notice changes).
    phone_offer: Vec<String>,
    /// The Shelf paths last handed to the paired-phones service.
    pair_offer: Option<Vec<String>>,
    /// Whether the island floated when the window was last laid out (its
    /// room differs: see `sync_room`).
    laid_floating: bool,
    /// The spot along the top edge (`Settings::island_x`) the window was
    /// last laid out for (see `sync_spot`).
    laid_spot: Option<f32>,
    /// A press on the closed island, which a sideways move turns into a drag.
    grab: Option<Grab>,
    /// New versions (`crate::updates`); None in the self-test and in a
    /// Store copy, which the Store updates.
    updater: Option<crate::updates::Updater>,
    /// Notifications' listener while it is on; None while it's
    /// off, in the download (no package identity) and in the self-test.
    notify: Option<services::notifications::Listener>,
}

/// The island window: position and size in screen pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Surface {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// A press on the closed island: let go where it was, it opens the
/// island; moved sideways first, it drags the island along the top edge.
#[derive(Clone, Copy, Debug)]
struct Grab {
    /// Where the pointer was pressed, screen pixels across.
    from_px: i32,
    /// The island's centre then, DIPs from the monitor's left edge.
    centre: f32,
    /// The pointer went past `spot::DRAG_SLOP`: a drag, not a click.
    moved: bool,
}

/// The grow springs overshoot by about 3 %; the surface leaves 5 %.
const OVERSHOOT: f32 = 1.05;
/// Hit-mask updates while the island moves (the mask is invisible, so it
/// may trail the outline by a frame or two).
const MASK_INTERVAL: f64 = 1.0 / 30.0;

/// How long outgoing content takes to fade (seconds).
const OUTGOING_FADE: f64 = 0.14;
/// Page switch cross-fade duration (seconds).
const PAGE_SWITCH: f64 = 0.26;
/// Pointer travel (DIPs) that restarts the hover dwell: the island opens
/// only once the pointer rests on it, not when it brushes past.
const DWELL_SLOP: f32 = 4.0;
/// The pointer coming back onto the island this soon after leaving it
/// (while it is still shrinking) opens it again at once, from where the
/// outline is: overshooting an edge costs no close-and-reopen.
const REOPEN_S: f64 = 0.3;
/// A hold that kept the island open (typing, a file drag, Phone drop, the
/// pin) ended while the pointer is elsewhere: close after this grace, so
/// the change can be seen.
const HOLD_GRACE_MS: u32 = 380;
/// Collapsed pill growth (w, h, radius) while the pointer is on it.
const HOVER_LIFT: (f32, f32, f32) = (12.0, 4.0, 2.0);
/// Step aside: an app window is at the top when its top edge is within this
/// many DIPs of the edge the island hangs from (a maximized window overhangs
/// it, a snapped one starts on it). One placed lower keeps its title and
/// tabs below the island, which covers a sliver of its frame at most.
const TOP_BAND: f32 = 8.0;
/// How long the inline notice pill shows its check mark (seconds).
const INLINE_DONE_S: f64 = 0.6;
/// Incoming content starts at this scale and this many DIPs up, and
/// settles down from the bezel as it fades in.
const CONTENT_SCALE_FROM: f32 = 0.94;
const CONTENT_DROP: f32 = 6.0;
/// Smallest scale the outgoing content shrinks to as the outline narrows.
const GHOST_MIN_SCALE: f32 = 0.6;

/// How much of the outgoing content still shows `age` seconds into its fade
/// (a smoothstep: it holds, then leaves).
fn outgoing_left(age: f64) -> f32 {
    let t = ((age / OUTGOING_FADE) as f32).clamp(0.0, 1.0);
    1.0 - t * t * (3.0 - 2.0 * t)
}

impl App {
    #[allow(clippy::too_many_arguments)]
    fn new(
        hwnd: HWND,
        helper: HWND,
        sink: EventSink,
        rx: Receiver<AppEvent>,
        settings: Settings,
        store: Store,
        settings_writable: bool,
        store_writable: bool,
    ) -> Result<Self> {
        let monitor = window::pick_monitor(settings.monitor);
        let gfx = Gfx::new(monitor.dpi as f32, hwnd)?;
        let mut st = AppState::new(settings, store);
        st.now = clock::mono();
        st.local = clock::local_now();
        st.unix = clock::unix_now();
        st.accent = theme_accent(st.settings.theme);
        // Notifications only where Windows lets this copy read them (the Store copy).
        st.notify_can = crate::autostart::packaged();
        let mode = Mode::Idle;
        let mut island = Island::new(activities::geom(&mode, &st));
        island.set_floating(pill::on(st.settings.theme).then_some(pill::TOP_GAP));
        let clock = FrameClock::start(SendHwnd::new(hwnd), monitor.handle);
        let taskbar_created_msg = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
        // The Downloader: not in the Microsoft Store build.
        st.downloader_offered = !crate::autostart::packaged();
        let saved_settings = st.settings.clone();
        Ok(Self {
            hwnd,
            helper,
            gfx,
            st,
            island,
            mode,
            input: Input::default(),
            hits: Vec::new(),
            hovering: false,
            expanded: false,
            drag_hover: false,
            text_focus: false,
            prev_foreground: HWND::default(),
            monitor,
            settings_win: None,
            clock,
            sink,
            rx,
            services: None,
            glass: crate::glass::Glass::new(services::apps_use_light_theme()),
            adzan: Default::default(),
            glass_moving: false,
            last_frame_t: 0.0,
            surface: Surface::default(),
            cx: 0.0,
            home_cx: 0.0,
            prev_canvas_px: None,
            mask: None,
            motion: None,
            motion_name: "morph",
            motions_logged: 0,
            hitch_logged_at: f64::NEG_INFINITY,
            trace: Vec::new(),
            dwm_at_start: None,
            log_queue: Vec::new(),
            fullscreen_hidden: false,
            fullscreen_on: false,
            top_windows: Vec::new(),
            raises_left: 0,
            covered_by: HashSet::new(),
            shown: false,
            stats_on: false,
            sysmon: None,
            sysmon_on: false,
            sysmon_rest: poni_core::sysmon::Rest::default(),
            frames: None,
            game_pid: None,
            game_peek_until: 0.0,
            game_drop_at: f64::NEG_INFINITY,
            game_hidden: false,
            peek_hotkey: false,
            script_hotkey: false,
            script_excluded: false,
            script_held: false,
            script_shown: false,
            icon_wait: HashSet::new(),
            tray: None,
            taskbar_created_msg,
            exit_code: 0,
            saved_settings,
            settings_writable,
            store_writable,
            auto_captions: Default::default(),
            sound_on: false,
            dbl_press: false,
            high_surrogate: None,
            wheel_acc: 0.0,
            wheel_t: 0.0,
            page_switch_t: 0.0,
            locked: false,
            display_off: false,
            tray_retries: 0,
            outgoing: None,
            page_anim: None,
            hover_arm: None,
            collapse_due: false,
            left_at: f64::NEG_INFINITY,
            menu_open: false,
            phone: None,
            phone_offer: Vec::new(),
            pair_offer: None,
            laid_floating: false,
            laid_spot: None,
            grab: None,
            updater: None,
            notify: None,
        })
    }

    fn start(&mut self) {
        self.layout_surface();
        self.st.power = services::power::query();
        services::power::register(self.helper);
        {
            self.services = Some(Services::start(&self.sink, self.hwnd, self.helper, &self.st.settings));
            self.sync_top_watch();
            self.st.paired = self.services.as_ref().map(|s| paired_phones(s.pairs())).unwrap_or_default();
            self.sync_pair_offer();
            if self.st.settings.system_history_on() {
                self.start_sysmon();
            }
            // A frame count left running by a Poni that crashed, and whether
            // Windows lets this sign-in read frames (the System page shows it).
            services::frames::stop_stale();
            if self.st.settings.game_stats {
                self.check_fps();
            }
            // Notifications on: listen if Windows already allows it (its
            // question waits for the page's Allow).
            if self.st.notifications_on() {
                self.start_notify(false);
            }
            // Which Windows language features the island can use (off the UI
            // thread; Settings and the Music page show the answer).
            services::winlang::check(self.sink.clone());
            self.try_add_tray();
            services::power::register_session(self.helper);
            if self.st.settings.captions_on {
                self.set_captions(true);
            }
            if !crate::autostart::packaged() {
                self.updater = Some(crate::updates::Updater::start(paths::data_dir().join("update.json"), &mut self.st, crate::updates::unix_now()));
                self.schedule_update();
                self.fetch_setup();
            }
        }
        if let Err(e) = dragdrop::register(self.hwnd, self.sink.clone()) {
            pwarn!("drop target registration failed: {e}");
        }
        // Refresh shelf thumbnails.
        for p in self.st.store.shelf.paths() {
            self.st.cmds.push(Command::LoadThumb(p));
        }
        self.schedule_minute_timer();
    }

    fn shutdown(&mut self) -> i32 {
        self.save_now();
        self.settings_win = None;
        // Stops the frame count's trace session (it would outlive Poni).
        self.frames = None;
        self.set_peek_hotkey(false);
        self.set_script_hotkey(false);
        self.glass.stop(self.hwnd, &mut self.gfx);
        if let Some(p) = self.phone.take() {
            p.stop();
        }
        if let Some(t) = self.tray.take() {
            t.remove();
        }
        if self.st.capture.running() {
            self.end_session(true);
        }
        if let Some(s) = self.services.take() {
            s.stop(self.helper);
        }
        dragdrop::revoke(self.hwnd);
        unsafe {
            let _ = DestroyWindow(self.hwnd);
            let _ = DestroyWindow(self.helper);
        }
        self.exit_code
    }

    /// Leave the message loop. Never call DestroyWindow while the app is
    /// borrowed: WM_DESTROY would re-enter and be swallowed.
    fn quit(&mut self, code: i32) {
        self.exit_code = code;
        self.clock.set_active(false);
        unsafe { PostQuitMessage(code) };
    }

    pub fn request_frame(&mut self) {
        self.clock.set_active(true);
    }

    /// Switch the renderer to `dpi` and size the window for that scale.
    fn set_dpi(&mut self, dpi: u32) {
        self.gfx.set_dpi(dpi as f32);
        self.layout_surface();
    }

    /// Size and place the window once for the largest island (the widest,
    /// tallest expanded page plus spring overshoot). The island is drawn
    /// centred in it, so a morph never moves or resizes the window: the
    /// centre stays put and both edges glide at sub-pixel precision. Call at
    /// start and whenever the scale, the monitor or the expanded width changes.
    fn layout_surface(&mut self) {
        let tallest = PageKind::ALL.iter().map(|p| pages::content_height(*p, &self.st)).fold(0.0f32, f32::max);
        self.layout_surface_for(self.st.settings.expanded_width, pages::HEADER_H + tallest + pages::PAD);
        // The band Step aside watches follows the monitor and its scale.
        self.sync_top_watch();
    }

    /// Step aside on: have the full-screen watcher report the app windows
    /// at the top edge of the island's monitor, where the island hangs from
    /// (below a taskbar at the top). Off (always, since 0.2.6; the self-test
    /// still draws it): it looks at nothing, and nothing is under the island.
    fn sync_top_watch(&mut self) {
        let m = &self.monitor;
        let px = (TOP_BAND * self.gfx.scale()).ceil() as i32;
        let band = self.st.settings.step_aside.then(|| RECT { left: m.rect.left, top: m.top(), right: m.rect.right, bottom: m.top() + px });
        if band.is_none() {
            self.top_windows.clear();
        }
        if let Some(s) = &self.services {
            s.watch_top(band);
        }
    }

    /// Lay the window out for an island body up to `body_w`×`body_h` DIPs.
    fn layout_surface_for(&mut self, body_w: f32, body_h: f32) {
        let s = self.gfx.scale();
        let mon_w = self.monitor.rect.right - self.monitor.rect.left;
        let (w, h) = surface_size(&self.island, body_w, body_h, s, mon_w);
        self.laid_floating = self.island.floating();
        self.place_surface(w, h);
    }

    /// Put the `w`×`h` px window at the top of the monitor: centred, or as
    /// near the spot the island was dragged to as the monitor allows. Past
    /// that the island goes the rest of the way inside the window
    /// (`place_island`).
    fn place_surface(&mut self, w: i32, h: i32) {
        let s = self.gfx.scale();
        let (left, mon_w) = (self.monitor.rect.left, self.monitor.rect.right - self.monitor.rect.left);
        self.laid_spot = self.st.settings.island_x;
        let (x, home) = match self.laid_spot {
            None => (left + (mon_w - w) / 2, w as f32 / 2.0 / s),
            Some(f) => {
                let at = left + (f * mon_w as f32).round() as i32;
                let x = spot::window_left(left, mon_w, w, at);
                (x, (at - x) as f32 / s)
            }
        };
        self.home_cx = home;
        let surface = Surface { x, y: self.monitor.top(), w, h };
        if surface != self.surface {
            self.surface = surface;
            self.prev_canvas_px = None;
            self.mask = None;
            if let Err(e) = self.gfx.set_surface(w, h) {
                pwarn!("window surface {w}x{h} failed: {e}");
            }
        }
        self.place_island();
    }

    /// The island's centre in the window this frame. In the middle, where
    /// it rests. Dragged towards an edge, moved in just enough to keep its
    /// outline (as wide as it is now) in the window: opening there, it
    /// grows away from the edge.
    fn place_island(&mut self) {
        self.cx = match self.laid_spot {
            None => self.home_cx,
            Some(_) => spot::fit_centre(self.home_cx, self.surface.w as f32 / self.gfx.scale(), self.island.current().w, self.island.side_room()),
        };
    }

    /// The spot along the top edge changed since the window was laid out
    /// (a drag, the menu's Move island to the centre, Reload settings): lay
    /// it out there. Called every frame; a layout only on that change.
    fn sync_spot(&mut self) {
        if self.st.settings.island_x != self.laid_spot {
            self.place_surface(self.surface.w, self.surface.h);
        }
    }

    /// Where a mouse message's point is on the screen, pixels across.
    fn screen_x(&self, lp: LPARAM) -> i32 {
        let mut pt = POINT { x: (lp.0 & 0xffff) as u16 as i16 as i32, y: ((lp.0 >> 16) & 0xffff) as u16 as i16 as i32 };
        unsafe {
            let _ = windows::Win32::Graphics::Gdi::ClientToScreen(self.hwnd, &mut pt);
        }
        pt.x
    }

    /// The pointer moved while pressing the closed island: once it has
    /// gone `spot::DRAG_SLOP` sideways, the island follows it along the top
    /// edge, as far as it stays on the screen, and back to the middle when
    /// it comes within `spot::SNAP` of it.
    fn drag_island(&mut self, lp: LPARAM) {
        let Some(g) = self.grab else { return };
        let s = self.gfx.scale();
        let dx = self.screen_x(lp) - g.from_px;
        if !g.moved {
            if (dx.abs() as f32) < spot::DRAG_SLOP * s {
                return;
            }
            pinfo!("island: dragged along the top edge");
            // No WM_SETCURSOR comes while the mouse is captured.
            unsafe {
                if let Ok(c) = LoadCursorW(None, IDC_SIZEWE) {
                    SetCursor(c);
                }
            }
        }
        self.grab = Some(Grab { moved: true, ..g });
        let mon_w = (self.monitor.rect.right - self.monitor.rect.left) as f32 / s;
        let centre = spot::fit_centre(g.centre + dx as f32 / s, mon_w, self.island.current().w, self.island.side_room());
        self.st.settings.island_x = spot::remember(centre, mon_w);
        self.sync_spot();
        self.request_frame();
    }

    /// A drag along the top edge ended: the island stays there (saved), and
    /// doesn't open under the pointer that just let go of it.
    fn dropped_island(&mut self) {
        self.cancel_hover();
        match self.st.settings.island_x {
            Some(x) => pinfo!("island: moved to {:.0} % across the screen", x * 100.0),
            None => pinfo!("island: back in the middle"),
        }
        self.save_settings();
    }

    /// The island started or stopped floating since the window was laid out
    /// (a theme switch into or out of Pill, the self-test picking its theme
    /// after start, or the outline docking at the edge after rising back to
    /// it): lay the window out again for the new room, grown for the gap and
    /// the shadow or given back, so Classic, Oyen and Glass keep exactly the
    /// window they start with and Pill gets its own. Called every frame
    /// after the island steps; a layout only on that change.
    fn sync_room(&mut self) {
        let floats = self.island.floating();
        if floats != self.laid_floating {
            self.layout_surface();
            let (w, h) = (self.surface.w, self.surface.h);
            self.log_queue.push(format!("island {}; window {w}x{h}", if floats { "floats below the top edge" } else { "hangs from the top edge" }));
        }
    }

    /// The island no longer fits the window (a target beyond the laid-out
    /// size, with room for its overshoot, or an outline past it): grow it.
    fn ensure_room(&mut self) {
        let g = self.island.current();
        let t = self.island.target();
        let (bw, bh) = ((t.w * OVERSHOOT).max(g.w), (t.h * OVERSHOOT).max(g.h));
        let s = self.gfx.scale();
        let need_w = ((bw + 2.0 * self.island.side_room()) * s).ceil() as i32;
        let need_h = ((bh + self.island.bottom_room() + self.island.top()) * s).ceil() as i32;
        if need_w > self.surface.w || need_h > self.surface.h {
            let tallest = PageKind::ALL.iter().map(|p| pages::content_height(*p, &self.st)).fold(0.0f32, f32::max);
            let body_h = (pages::HEADER_H + tallest + pages::PAD).max(bh / OVERSHOOT * 1.1);
            pinfo!("island outgrew the window; growing it to fit {bw:.0}x{bh:.0} DIP");
            self.layout_surface_for(self.st.settings.expanded_width.max(bw / OVERSHOOT * 1.1), body_h);
        }
    }

    /// Add the tray icon; Explorer can be busy at logon, so retry a few times.
    fn try_add_tray(&mut self) {
        if self.tray.is_some() {
            return;
        }
        match Tray::add(self.helper) {
            Ok(t) => {
                self.tray = Some(t);
                self.tray_retries = 0;
            }
            Err(e) => {
                self.tray_retries += 1;
                if self.tray_retries <= 15 {
                    pwarn!("tray icon failed ({e}); retry {} in 2 s", self.tray_retries);
                    unsafe {
                        SetTimer(self.hwnd, TIMER_TRAY, 2000, None);
                    }
                } else {
                    pwarn!("tray icon failed ({e}); giving up");
                }
            }
        }
    }

    /// Write settings only when they changed and the file is safe to overwrite.
    fn save_settings(&mut self) {
        if self.st.settings == self.saved_settings {
            return;
        }
        if !self.settings_writable {
            pwarn!("settings.json couldn't be read at start; not overwriting it");
            return;
        }
        match save_json_atomic(&paths::settings_path(), &self.st.settings) {
            Ok(()) => self.saved_settings = self.st.settings.clone(),
            Err(e) => pwarn!("saving settings failed: {e}"),
        }
    }

    /// A click on the closed island (pressed and let go without dragging
    /// it): a notice jumps to its page or app, the download pill to its
    /// page, and the island opens.
    fn open_from_press(&mut self) {
        // Clicking a notice jumps to its page (a new version's
        // may be waiting under a volume change or a game's readout).
        let shown = self.mode == Mode::Notice;
        // Another app's notification opens that app instead.
        let mut opened = false;
        if let Some(n) = self.st.notice.take_if(|_| shown) {
            match n.action {
                Some(NoticeAction::OpenPage(p)) => self.st.page = p,
                Some(NoticeAction::OpenUpdate) => self.st.open_update(),
                Some(NoticeAction::StartFocus) => {
                    self.st.page = PageKind::Focus;
                    if !self.st.pomodoro.is_active() {
                        self.st.pomodoro.start(self.st.now);
                    }
                }
                Some(NoticeAction::OpenApp(id)) => {
                    shell::open_app(&id);
                    opened = true;
                }
                Some(NoticeAction::DownloadModel) => self.pull_model(poni_core::models::Kind::Asr),
                None => {}
            }
        }
        // The download pill opens on its page.
        if self.mode == Mode::Activity(activities::Activity::Download) {
            self.st.page = PageKind::Downloads;
        }
        self.st.hud = None;
        if !opened {
            self.expand();
        }
    }

    fn release_mouse(&mut self) {
        self.input.down = false;
        self.input.pressed_id = None;
        unsafe {
            let _ = ReleaseCapture();
        }
    }

    // ------------------------------------------------------------ messages

    fn handle_island(&mut self, msg: u32, wp: WPARAM, lp: LPARAM, deferred: &mut Vec<Deferred>) -> Option<LRESULT> {
        match msg {
            WM_APP_FRAME => {
                // Clear `pending` after the frame so a slow frame can't keep the
                // queue permanently non-empty (which starves WM_TIMER).
                let tick = self.clock.tick();
                self.frame(deferred, Some(tick));
                self.clock.frame_handled();
                Some(LRESULT(0))
            }
            WM_APP_EVENT => {
                while let Ok(ev) = self.rx.try_recv() {
                    self.on_event(ev);
                }
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_TIMER => {
                self.on_timer(wp.0);
                Some(LRESULT(0))
            }
            WM_MOUSEMOVE => {
                let p = self.mouse_dip(lp);
                if self.grab.is_some() {
                    self.input.mouse = Some(p);
                    self.drag_island(lp);
                    return Some(LRESULT(0));
                }
                if self.over_stale_mask(p) {
                    // The pointer is over a part of the hit mask the outline
                    // already left: it isn't on the island.
                    if self.hovering {
                        self.hovering = false;
                        self.input.mouse = None;
                        self.cancel_hover();
                        self.pointer_left();
                        self.request_frame();
                    }
                    return Some(LRESULT(0));
                }
                self.input.mouse = Some(p);
                if !self.hovering {
                    self.hovering = true;
                    self.collapse_due = false;
                    unsafe {
                        let mut tme = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: self.hwnd, dwHoverTime: 0 };
                        let _ = TrackMouseEvent(&mut tme);
                        let _ = KillTimer(self.hwnd, TIMER_COLLAPSE);
                    }
                    if !self.expanded && clock::mono() - self.left_at < REOPEN_S {
                        // Back onto the island while it is still closing.
                        self.expand();
                    } else if !self.expanded {
                        self.arm_hover(p);
                    }
                } else if let Some(p0) = self.hover_arm.filter(|_| !self.expanded) {
                    // Dwell: moving on restarts the wait, so brushing past on
                    // the way to a tab or title bar doesn't open the island.
                    if (p.x - p0.x).hypot(p.y - p0.y) > DWELL_SLOP {
                        self.arm_hover(p);
                    }
                }
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_MOUSELEAVE => {
                self.hovering = false;
                self.input.mouse = None;
                self.cancel_hover();
                self.pointer_left();
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_LBUTTONDOWN | WM_LBUTTONDBLCLK => {
                let p = self.mouse_dip(lp);
                if self.over_shadow(p) {
                    // A press on the floating pill's shadow (software renderer): not the island.
                    return Some(LRESULT(0));
                }
                self.dbl_press = msg == WM_LBUTTONDBLCLK;
                self.input.mouse = Some(p);
                self.input.down = true;
                self.input.just_pressed = true;
                self.input.press_pos = Some(p);
                self.input.pressed_id = self.hit_at(p).map(|h| h.id);
                unsafe { SetCapture(self.hwnd) };
                if !self.expanded {
                    let inline = self.st.notice.as_ref().and_then(|n| n.inline).filter(|_| self.input.pressed_id == Some(wid("notice.act")));
                    if let Some(a) = inline {
                        // The notice's inline pill acts in place without
                        // expanding. The press is consumed here, so the
                        // release can't click the pill a second time.
                        self.input.pressed_id = None;
                        self.run_inline_action(a);
                    } else if self.input.pressed_id == Some(wid(activities::PRAYER_OK_ID)) {
                        // The prayer countdown's OK, the same way.
                        self.input.pressed_id = None;
                        self.prayer_countdown_ok();
                    } else {
                        // Opens when the button comes up (`open_from_press`),
                        // unless the pointer moves sideways first: then it
                        // drags the island along the top edge (`drag_island`).
                        let centre = (self.surface.x - self.monitor.rect.left) as f32 / self.gfx.scale() + self.cx;
                        self.grab = Some(Grab { from_px: self.screen_x(lp), centre, moved: false });
                        // Held still on it, it doesn't open by itself either.
                        self.cancel_hover();
                    }
                } else if self.text_focus && self.input.pressed_id != self.input.focused {
                    self.blur_text();
                }
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_LBUTTONUP => {
                if let Some(g) = self.grab.take() {
                    // What the closed island showed under the press doesn't click.
                    self.input.pressed_id = None;
                    if g.moved {
                        self.dropped_island();
                    } else {
                        self.open_from_press();
                    }
                }
                let p = self.mouse_dip(lp);
                self.input.mouse = Some(p);
                let hit = self.hit_at(p).map(|h| h.id);
                if let (Some(pid), Some(h)) = (self.input.pressed_id, hit) {
                    // The second press of a double-click doesn't click again
                    // (no double toggles / double opens).
                    if pid == h && !self.dbl_press {
                        self.input.clicked = Some((h, MouseButton::Left));
                    }
                }
                if self.input.down {
                    self.input.released = self.input.pressed_id.map(|id| (id, p));
                }
                self.dbl_press = false;
                self.release_mouse();
                if !self.hovering_inside(p) {
                    self.input.mouse = None;
                }
                if !self.hovering {
                    // Released outside after a press inside (a slider drag).
                    self.pointer_left();
                }
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_CAPTURECHANGED_ => {
                // Capture taken by someone else mid-press: drop the stale press
                // (a drag leaves the island where it got to).
                if lp.0 != self.hwnd.0 as isize && self.grab.take().is_some_and(|g| g.moved) {
                    self.dropped_island();
                }
                if lp.0 != self.hwnd.0 as isize && (self.input.down || self.input.pressed_id.is_some()) {
                    self.input.down = false;
                    self.input.pressed_id = None;
                    if !self.hovering {
                        self.pointer_left();
                    }
                    self.request_frame();
                }
                Some(LRESULT(0))
            }
            WM_SYSCOMMAND if (wp.0 & 0xFFF0) == SC_CLOSE as usize => {
                // Alt+F4 while typing in a field just closes the island, not the app.
                self.blur_text();
                self.collapse();
                Some(LRESULT(0))
            }
            WM_RBUTTONUP => {
                let p = self.mouse_dip(lp);
                if self.over_shadow(p) {
                    return Some(LRESULT(0));
                }
                match self.hit_at(p) {
                    Some(h) => self.input.clicked = Some((h.id, MouseButton::Right)),
                    None => {
                        let mut pt = POINT::default();
                        unsafe {
                            let _ = GetCursorPos(&mut pt);
                        }
                        deferred.push(Deferred::Menu(pt));
                    }
                }
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_MOUSEWHEEL => {
                let delta = ((wp.0 >> 16) & 0xffff) as u16 as i16 as f32 / WHEEL_DELTA as f32;
                self.input.wheel += delta;
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_SETCURSOR => {
                let kind = self.input.mouse.and_then(|p| self.hit_at(p)).map(|h| h.cursor).unwrap_or(CursorKind::Arrow);
                unsafe {
                    let id = match kind {
                        CursorKind::Arrow => IDC_ARROW,
                        CursorKind::Hand => IDC_HAND,
                        CursorKind::Text => IDC_IBEAM,
                    };
                    if let Ok(c) = LoadCursorW(None, id) {
                        SetCursor(c);
                    }
                }
                Some(LRESULT(1))
            }
            WM_MOUSEACTIVATE => Some(LRESULT(if self.text_focus { MA_ACTIVATE as isize } else { MA_NOACTIVATE as isize })),
            WM_CHAR => {
                if self.text_focus {
                    let u = wp.0 as u32;
                    let c = if (0xD800..0xDC00).contains(&u) {
                        self.high_surrogate = Some(u as u16);
                        None
                    } else if (0xDC00..0xE000).contains(&u) {
                        self.high_surrogate.take().and_then(|h| char::decode_utf16([h, u as u16]).next().and_then(|r| r.ok()))
                    } else {
                        self.high_surrogate = None;
                        char::from_u32(u)
                    };
                    if let Some(c) = c.filter(|c| !c.is_control()) {
                        self.input.keys.push(KeyInput::Char(c));
                        self.request_frame();
                    }
                }
                Some(LRESULT(0))
            }
            WM_KEYDOWN => {
                if self.text_focus {
                    let k = match VIRTUAL_KEY(wp.0 as u16) {
                        VK_BACK => Some(KeyInput::Backspace),
                        VK_DELETE => Some(KeyInput::Delete),
                        VK_RETURN => Some(KeyInput::Enter),
                        VK_TAB => Some(KeyInput::Tab),
                        VK_ESCAPE => Some(KeyInput::Escape),
                        VK_LEFT => Some(KeyInput::Left),
                        VK_RIGHT => Some(KeyInput::Right),
                        VK_UP => Some(KeyInput::Up),
                        VK_DOWN => Some(KeyInput::Down),
                        VK_HOME => Some(KeyInput::Home),
                        VK_END => Some(KeyInput::End),
                        VK_V if unsafe { GetKeyState(VK_CONTROL.0 as i32) } < 0 => {
                            if let Some(text) = services::clipboard::read_text(self.hwnd) {
                                for c in text.chars().filter(|c| !c.is_control()) {
                                    self.input.keys.push(KeyInput::Char(c));
                                }
                            }
                            None
                        }
                        _ => None,
                    };
                    if let Some(k) = k {
                        self.input.keys.push(k);
                    }
                    self.request_frame();
                    return Some(LRESULT(0));
                }
                None
            }
            WM_ACTIVATE => {
                if (wp.0 & 0xffff) as u32 == WA_INACTIVE && self.text_focus {
                    self.text_focus = false;
                    self.input.focused = None;
                    self.set_noactivate(true);
                    self.maybe_schedule_collapse();
                    self.request_frame();
                }
                None
            }
            WM_DISPLAYCHANGE | WM_DPICHANGED | WM_SETTINGCHANGE => {
                self.refresh_monitor();
                if msg == WM_SETTINGCHANGE {
                    self.glass.app_light = services::apps_use_light_theme();
                }
                if msg == WM_SETTINGCHANGE && self.st.settings.theme == Theme::Glass {
                    self.st.accent = theme_accent(Theme::Glass);
                }
                Some(LRESULT(0))
            }
            WM_CLOSE => {
                self.quit(0);
                Some(LRESULT(0))
            }
            _ => None,
        }
    }

    fn handle_helper(&mut self, msg: u32, wp: WPARAM, lp: LPARAM, deferred: &mut Vec<Deferred>) -> Option<LRESULT> {
        if msg == self.taskbar_created_msg && msg != 0 {
            if let Some(t) = self.tray.take() {
                t.remove();
            }
            self.tray_retries = 0;
            self.try_add_tray();
            if let Some(s) = self.services.as_ref() {
                s.on_taskbar_created();
            }
            // A restarted Explorer puts its taskbar at the top of the topmost band.
            self.start_raises();
            return Some(LRESULT(0));
        }
        match msg {
            WM_APP_TRAY => {
                let ev = (lp.0 & 0xffff) as u32;
                match ev {
                    WM_LBUTTONUP => {
                        if self.expanded {
                            self.collapse();
                        } else {
                            self.expand();
                        }
                        self.request_frame();
                    }
                    WM_RBUTTONUP | WM_CONTEXTMENU => {
                        let mut pt = POINT::default();
                        unsafe {
                            let _ = GetCursorPos(&mut pt);
                        }
                        deferred.push(Deferred::Menu(pt));
                    }
                    _ => {}
                }
                Some(LRESULT(0))
            }
            WM_APP_APPBAR => {
                if let Some(s) = self.services.as_ref() {
                    if let Some(fs) = s.on_appbar_message(wp, lp, self.monitor.handle) {
                        self.on_event(AppEvent::Fullscreen(fs));
                    }
                }
                Some(LRESULT(0))
            }
            WM_POWERBROADCAST => {
                if let Some(on) = services::power::display_state_change(wp, lp) {
                    self.display_off = !on;
                }
                let p = services::power::query();
                self.on_event(AppEvent::Power(p));
                self.tell_sysmon_rest();
                self.update_due();
                self.request_frame();
                Some(LRESULT(1))
            }
            WM_WTSSESSION_CHANGE_ => {
                match wp.0 {
                    WTS_SESSION_LOCK_ => self.locked = true,
                    WTS_SESSION_UNLOCK_ => self.locked = false,
                    _ => {}
                }
                self.tell_sysmon_rest();
                self.update_due();
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_HOTKEY if wp.0 == HOTKEY_PEEK as usize => {
                self.toggle_readout();
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_HOTKEY if wp.0 == HOTKEY_SCRIPT as usize => {
                self.st.now = clock::mono();
                pages::script::toggle(&mut self.st);
                self.request_frame();
                Some(LRESULT(0))
            }
            WM_QUERYENDSESSION => Some(LRESULT(1)),
            WM_ENDSESSION => {
                self.save_now();
                // Windows ends Poni without shutdown(): stop the frame count's
                // trace session now, or it would outlive the sign-in.
                if wp.0 != 0 {
                    self.frames = None;
                }
                Some(LRESULT(0))
            }
            WM_DISPLAYCHANGE | WM_SETTINGCHANGE => {
                self.refresh_monitor();
                None
            }
            _ => None,
        }
    }

    // ------------------------------------------------------------ the Settings window

    /// Advanced settings (the Settings page's last row, the menu's
    /// Advanced settings…): the island closes and the window opens, so the
    /// open island never sits over it.
    fn show_settings(&mut self, deferred: &mut Vec<Deferred>) {
        self.collapse();
        self.open_settings_window(None, deferred);
    }

    /// Open the Settings window on `section` (General when it opens), or
    /// bring it forward, on that section when one is given.
    fn open_settings_window(&mut self, section: Option<Section>, deferred: &mut Vec<Deferred>) {
        match self.settings_win.as_mut() {
            Some(w) => {
                if let Some(s) = section {
                    w.view.show_section(s);
                }
                w.raise();
            }
            None => match SettingsWindow::new(self.monitor.work, self.gfx.dpi.round() as u32, section.unwrap_or(Section::General)) {
                Ok(w) => {
                    pinfo!("settings window: open");
                    self.settings_win = Some(w);
                    // Start with Windows is read off the UI thread; its answer draws the switch.
                    crate::autostart::report(self.sink.clone(), None);
                }
                Err(e) => {
                    pwarn!("settings window: couldn't open it ({e})");
                    return;
                }
            },
        }
        self.paint_settings(deferred);
    }

    /// Close it: the window, its renderer and its pixels go.
    fn close_settings_window(&mut self) {
        if self.settings_win.take().is_some() {
            pinfo!("settings window: closed");
        }
    }

    /// Draw the Settings window, run what its clicks asked for and draw it
    /// again with the result (a few times at most).
    fn paint_settings(&mut self, deferred: &mut Vec<Deferred>) {
        for _ in 0..4 {
            self.st.now = self.st.now.max(clock::mono());
            let now = self.st.now;
            let Some(w) = self.settings_win.as_mut() else { return };
            let before = w.view.section;
            let out = w.paint(&mut self.st, now, None, false);
            let after = w.view.section;
            if out.close {
                self.close_settings_window();
                return;
            }
            let ran = !self.st.cmds.is_empty();
            if ran {
                self.run_commands(deferred);
                self.request_frame();
            }
            let dirty = self.settings_win.as_ref().is_some_and(|w| w.view.dirty);
            if !(out.again || ran || dirty) {
                break;
            }
        }
        // A switch sliding, a highlight gliding: the next frames come from the clock.
        if self.settings_moving() {
            self.request_frame();
        }
    }

    /// Draw the Settings window on this frame when something in it changed
    /// (all of it), or still glides (only what moves).
    fn paint_settings_if_dirty(&mut self, deferred: &mut Vec<Deferred>) {
        let Some(w) = self.settings_win.as_ref() else { return };
        if w.view.dirty {
            self.paint_settings(deferred);
        } else if w.view.moving {
            self.st.now = self.st.now.max(clock::mono());
            let now = self.st.now;
            if let Some(w) = self.settings_win.as_mut() {
                let only = w.view.next_clip();
                let _ = w.paint(&mut self.st, now, only, false);
            }
        }
    }

    /// Something in the Settings window glides: the frame clock keeps
    /// ticking at the display's rate until it has arrived.
    fn settings_moving(&self) -> bool {
        self.settings_win.as_ref().is_some_and(|w| w.view.moving)
    }

    fn handle_settings_window(&mut self, hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, deferred: &mut Vec<Deferred>) -> Option<LRESULT> {
        let w = self.settings_win.as_mut().filter(|w| w.hwnd == hwnd)?;
        let xy = |lp: LPARAM| ((lp.0 & 0xffff) as u16 as i16 as i32, ((lp.0 >> 16) & 0xffff) as u16 as i16 as i32);
        match msg {
            WM_NCHITTEST => {
                // Empty parts of the card move the window; the shadow takes nothing.
                let (x, y) = xy(lp);
                let p = w.mouse_dip(x - w.at.0, y - w.at.1);
                let hit = if !w.card().contains(p) {
                    HTNOWHERE
                } else if w.drags_at(p) {
                    HTCAPTION
                } else {
                    HTCLIENT
                };
                Some(LRESULT(hit as isize))
            }
            // A double-click on an empty part doesn't maximize it.
            WM_NCLBUTTONDBLCLK => Some(LRESULT(0)),
            WM_MOUSEMOVE => {
                let (x, y) = xy(lp);
                let p = w.mouse_dip(x, y);
                if !w.tracking {
                    w.tracking = true;
                    unsafe {
                        let mut tme = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                        let _ = TrackMouseEvent(&mut tme);
                    }
                }
                // Drawn again only when what's under the pointer changes.
                if w.view.hover(p) {
                    self.paint_settings(deferred);
                }
                Some(LRESULT(0))
            }
            WM_MOUSELEAVE => {
                w.tracking = false;
                w.view.leave();
                self.paint_settings(deferred);
                Some(LRESULT(0))
            }
            WM_LBUTTONDOWN => {
                let (x, y) = xy(lp);
                let p = w.mouse_dip(x, y);
                w.view.press(p);
                unsafe {
                    SetCapture(hwnd);
                }
                self.paint_settings(deferred);
                Some(LRESULT(0))
            }
            WM_LBUTTONUP => {
                let (x, y) = xy(lp);
                let p = w.mouse_dip(x, y);
                w.view.release(p);
                unsafe {
                    let _ = ReleaseCapture();
                }
                self.paint_settings(deferred);
                Some(LRESULT(0))
            }
            WM_MOUSEWHEEL => {
                let raw = ((wp.0 >> 16) & 0xffff) as u16 as i16 as i32;
                let delta = raw as f32 / WHEEL_DELTA as f32;
                let (x, y) = xy(lp);
                let p = w.mouse_dip(x - w.at.0, y - w.at.1);
                // Whole notches glide; a precision touchpad's small steps follow the fingers.
                if raw % WHEEL_DELTA as i32 == 0 {
                    w.view.wheel(p, delta);
                } else {
                    w.view.scroll_by(p, delta * crate::settings_window::WHEEL_STEP);
                }
                self.paint_settings(deferred);
                Some(LRESULT(0))
            }
            WM_SETCURSOR if (lp.0 & 0xffff) as u32 == HTCLIENT => {
                let kind = w.view.input.mouse.map_or(CursorKind::Arrow, |p| w.view.cursor_at(p));
                unsafe {
                    let id = match kind {
                        CursorKind::Arrow => IDC_ARROW,
                        CursorKind::Hand => IDC_HAND,
                        CursorKind::Text => IDC_IBEAM,
                    };
                    if let Ok(c) = LoadCursorW(None, id) {
                        SetCursor(c);
                    }
                }
                Some(LRESULT(1))
            }
            // Windows switched between light and dark: the window follows.
            WM_SETTINGCHANGE => {
                w.refresh_mode();
                self.paint_settings(deferred);
                None
            }
            WM_KEYDOWN => {
                let ctrl = unsafe { GetKeyState(VK_CONTROL.0 as i32) } < 0;
                if wp.0 == VK_ESCAPE.0 as usize || (ctrl && wp.0 == b'W' as usize) {
                    self.close_settings_window();
                }
                Some(LRESULT(0))
            }
            WM_CLOSE => {
                self.close_settings_window();
                Some(LRESULT(0))
            }
            WM_MOVE => {
                w.at = xy(lp);
                Some(LRESULT(0))
            }
            WM_DPICHANGED => {
                // Dragged onto a display with another scale: Windows' place for it, drawn at that scale.
                if let Some(r) = unsafe { (lp.0 as *const RECT).as_ref() } {
                    w.at = (r.left, r.top);
                }
                w.set_dpi((wp.0 & 0xffff) as u32);
                self.paint_settings(deferred);
                Some(LRESULT(0))
            }
            _ => None,
        }
    }

    fn on_timer(&mut self, id: usize) {
        match id {
            TIMER_HOVER => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_HOVER);
                }
                if !self.hovering || self.expanded || self.grab.is_some() {
                    self.hover_arm = None;
                } else if self.mode == Mode::Notice && self.st.notice.as_ref().is_some_and(|n| n.inline.is_some()) {
                    // A notice with an inline pill stays put under a resting
                    // pointer so the pill can be clicked (a click on the rest
                    // of the notice still opens its page). The dwell stays
                    // armed: the next movement restarts it.
                } else if self.input.mouse.and_then(|p| self.hit_at(p)).is_some_and(|h| h.id == wid(activities::PRAYER_OK_ID)) {
                    // So does the prayer countdown under a pointer resting on
                    // its OK (resting on the rest of it still opens).
                } else {
                    self.expand();
                }
            }
            TIMER_RAISE => {
                self.raises_left = self.raises_left.saturating_sub(1);
                if self.shown && !self.fullscreen_hidden {
                    self.raise_if_covered();
                } else {
                    self.raises_left = 0;
                }
                if self.raises_left == 0 {
                    unsafe {
                        let _ = KillTimer(self.hwnd, TIMER_RAISE);
                    }
                }
            }
            TIMER_PEEK => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_PEEK);
                }
                let now = clock::mono();
                if self.expanded || self.hovering {
                    // Not from under the pointer: it hides once the island closes.
                    self.game_peek_until = now + 1.0;
                    unsafe {
                        SetTimer(self.hwnd, TIMER_PEEK, 1000, None);
                    }
                } else {
                    self.game_peek_until = 0.0;
                    self.apply_fullscreen(now);
                }
            }
            TIMER_COLLAPSE => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_COLLAPSE);
                }
                if self.free_to_collapse() {
                    self.collapse();
                }
            }
            TIMER_WAKE => unsafe {
                let _ = KillTimer(self.hwnd, TIMER_WAKE);
            },
            TIMER_SAVE => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_SAVE);
                }
                self.save_now();
            }
            TIMER_STATS => {
                self.st.stats = services::sysstats::sample();
            }
            TIMER_MINUTE => {
                self.schedule_minute_timer();
                self.close_idle_phone();
            }
            TIMER_TRAY => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_TRAY);
                }
                self.try_add_tray();
            }
            TIMER_UPDATE => {
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_UPDATE);
                }
                self.update_due();
            }
            _ => {}
        }
        self.request_frame();
    }

    /// Save the Apple Music token copied from the browser (sealed with DPAPI)
    /// and take it off the clipboard.
    fn use_apple_music_token(&mut self) {
        let text = services::clipboard::read_text(self.hwnd).unwrap_or_default();
        let Some(token) = poni_core::applemusic::clean_user_token(&text) else {
            self.st.notify(Icon::Lyrics, palette::ORANGE, "No Apple Music token copied", "Copy media-user-token first", 6.0, None);
            return;
        };
        if let Err(e) = services::secret::save(&paths::apple_music_token_path(), &token) {
            pwarn!("apple music: cannot save the token ({e})");
            self.st.notify(Icon::Lyrics, palette::ORANGE, "Couldn't save the token", "Details in the log", 5.0, None);
            return;
        }
        pinfo!("apple music: token saved");
        services::clipboard::set_text(self.helper, "");
        if let Some(s) = self.services.as_ref() {
            s.apple_music_token_changed();
        }
        self.refetch_lyrics();
        self.st.notify(Icon::Lyrics, palette::BLUE, "Checking the Apple Music token", "One moment", 4.0, None);
    }

    fn forget_apple_music_token(&mut self) {
        if let Err(e) = services::secret::delete(&paths::apple_music_token_path()) {
            pwarn!("apple music: cannot remove the token ({e})");
            self.st.notify(Icon::Lyrics, palette::ORANGE, "Couldn't remove the token", "Details in the log", 5.0, None);
            return;
        }
        pinfo!("apple music: token removed");
        if let Some(s) = self.services.as_ref() {
            s.apple_music_token_changed();
        }
        self.refetch_lyrics();
        self.st.notify(Icon::Lyrics, palette::BLUE, "Apple Music lyrics off", "Lyrics from LRCLIB only", 4.0, None);
    }

    /// Captions from what the PC plays on (true) or off, in the languages of Settings. On or off
    /// is remembered (`captions_on`): the next start of the island picks it up again.
    fn set_captions(&mut self, on: bool) {
        let sink = self.sink.clone();
        let s = &self.st.settings;
        let (src, tgt) = (s.source_lang.clone(), poni_core::capture::caption_target(s.translate_captions, &s.target_lang).to_string());
        self.st.settings.captions_on = on;
        self.save_settings();
        self.st.caption_hint = None;
        let Some(svc) = self.services.as_mut() else { return };
        if on {
            svc.engine_start();
            self.st.capture = match svc.capture_start(&sink, poni_core::helper::configured_port(), &src, &tgt) {
                Ok(()) => poni_core::capture::CaptureState::On,
                Err(e) => poni_core::capture::CaptureState::Failed(e),
            };
            self.st.helper.set_following(true);
        } else {
            svc.capture_stop();
            self.st.capture = poni_core::capture::CaptureState::Off;
            self.end_session(false);
        }
        self.st.helper.capturing = self.st.capture.running();
        self.request_frame();
    }

    /// Start or Stop pressed by the person: the automatic captions leave that choice alone.
    fn captions_by_hand(&mut self, on: bool) {
        let wanted = self.captions_wanted();
        self.auto_captions.manual(on, wanted);
        self.set_captions(on);
    }

    /// The PC plays sound that is not a music app (a call, a video, a meeting), a video plays, or a
    /// calendar meeting with a join link runs now.
    fn captions_wanted(&self) -> bool {
        let playing = self.st.media.as_ref().filter(|m| m.is_playing());
        let music = playing.is_some_and(|m| !poni_core::capture::captionable_app(&m.app_id));
        let video = playing.is_some_and(|m| poni_core::capture::captionable_app(&m.app_id));
        (self.sound_on && !music && !self.st.prayer.adzan) || video || self.st.helper.calendar.as_ref().is_some_and(|c| poni_core::capture::meeting_now(c, self.st.unix))
    }

    fn auto_captions_step(&mut self) {
        use poni_core::capture::AutoStep;
        let wanted = self.captions_wanted();
        match self.auto_captions.step(self.st.settings.auto_captions, wanted, self.st.capture.running(), self.st.now) {
            AutoStep::Start => {
                self.set_captions(true);
                if self.st.capture.running() {
                    self.captions_notice();
                }
            }
            AutoStep::Stop => self.set_captions(false),
            AutoStep::Nothing => {}
        }
    }

    /// The clipboard's transcript becomes a meeting: into the shown one when it was started from
    /// Calendar and is still empty, else a new one (the same text twice is the same meeting).
    fn paste_transcript(&mut self) {
        use poni_core::transcript_paste as tp;
        let text = services::clipboard::read_text(self.hwnd).unwrap_or_default();
        if !tp::looks_like_transcript(&text) {
            self.st.helper_notice = Some(("Copy a transcript first (Teams, read.ai, or a .vtt / .srt file's text), then press Paste.".into(), self.st.now + 7.0, true));
            return;
        }
        let p = tp::parse(&text);
        if p.lines.is_empty() {
            self.st.helper_notice = Some(("No lines found in what you copied.".into(), self.st.now + 6.0, true));
            return;
        }
        let base = self.st.helper.note().filter(|n| n.transcript.is_empty() && n.items.is_empty() && !n.issued).map(|n| n.raw.clone());
        let t = clock::local_now();
        let digest = poni_core::sha256::hex(&poni_core::sha256::sha256(text.trim().as_bytes()));
        let m = services::capture::Meeting {
            id: format!("MOM-PASTE-{}", &digest[..12]),
            title: format!("Pasted transcript {}", poni_core::meeting_doc::start_stamp(&t).replace('T', " ")),
            date: t.day_key(),
            start: poni_core::meeting_doc::start_stamp(&t),
            locale: self.st.settings.source_lang.clone(),
            lines: p.lines,
        };
        let cut = if p.dropped > 0 { format!(" (the first {} left out)", p.dropped) } else { String::new() };
        self.st.helper_notice = Some((format!("Drafting minutes from {} lines{cut}\u{2026}", m.lines.len()), self.st.now + 30.0, false));
        self.set_page(PageKind::Meeting);
        let (sink, port, speakers) = (self.sink.clone(), poni_core::helper::configured_port(), p.speakers);
        std::thread::spawn(move || sink.send(AppEvent::MeetingSaved(services::capture::save_pasted(port, m, base, speakers))));
    }

    /// "Captions on", with the one question that matters then: translate or not (Translate pill).
    fn captions_notice(&mut self) {
        let s = &self.st.settings;
        let sub = if s.translate_captions { format!("Translating into {}", poni_core::capture::lang_name(&s.target_lang)) } else { "Original language only".to_string() };
        let accent = self.st.accent;
        self.st.notify(Icon::Lyrics, accent, "Captions on", sub, 8.0, Some(NoticeAction::OpenPage(PageKind::Live)));
        self.st.set_notice_inline(InlineAction::Translate);
    }

    /// What names a meeting that no calendar event does. shortcut: no calendar hook yet; when the
    /// Calendar page lands, return the running event's title here.
    fn running_event_title(&self) -> Option<String> {
        let cal = self.st.helper.calendar.as_ref()?;
        cal.events.iter().find(|e| !e.all_day && e.start <= self.st.unix && self.st.unix < e.end).map(|e| e.title.clone())
    }

    /// Captions stopped: what they heard becomes a meeting in the engine. `wait`: on quit, answer
    /// before the engine goes; otherwise it is saved off the UI thread and reported by an event.
    fn end_session(&mut self, wait: bool) {
        let Some(svc) = self.services.as_ref() else { return };
        let lines = svc.take_session();
        if lines.is_empty() {
            return;
        }
        let t = clock::local_now();
        let m = services::capture::Meeting {
            id: format!("MOM-WIN-{}", self.st.unix),
            title: self.running_event_title().unwrap_or_else(|| poni_core::meeting_doc::default_title(&t)),
            date: t.day_key(),
            start: poni_core::meeting_doc::start_stamp(&t),
            locale: self.st.settings.source_lang.clone(),
            lines,
        };
        let port = poni_core::helper::configured_port();
        if wait {
            match services::capture::save_meeting(port, m) {
                Ok(id) => pinfo!("meeting {id} saved at quit"),
                Err((e, _)) => pwarn!("meeting not saved at quit: {e}"),
            }
        } else {
            let sink = self.sink.clone();
            std::thread::spawn(move || sink.send(AppEvent::MeetingSaved(services::capture::save_meeting(port, m))));
        }
    }

    fn on_meeting_saved(&mut self, r: std::result::Result<String, (String, Vec<poni_core::helper::Line>)>) {
        match r {
            Ok(id) => {
                pinfo!("meeting {id} saved");
                // The new meeting is the one shown, from its first item.
                self.st.helper.select(&id);
                self.st.meeting_page = 0;
                if self.st.helper_notice.as_ref().is_some_and(|n| n.0.starts_with("Drafting minutes")) {
                    self.st.helper_notice = None;
                }
                if let Some(s) = self.services.as_ref() {
                    s.helper_poll();
                }
                self.set_page(PageKind::Meeting);
                self.st.notify(Icon::Lyrics, palette::GREEN, "Meeting saved", "Tap to open it", 8.0, Some(NoticeAction::OpenPage(PageKind::Meeting)));
            }
            Err((e, lines)) => {
                pwarn!("meeting not saved: {e}");
                if self.st.helper_notice.as_ref().is_some_and(|n| n.0.starts_with("Drafting minutes")) {
                    self.st.helper_notice = None;
                }
                if lines.is_empty() {
                    // A paste: nothing to keep for a Stop; the clipboard still has it.
                    self.st.notify(Icon::Lyrics, palette::ORANGE, "Transcript not saved", format!("{e} Press Paste transcript again."), 8.0, None);
                    return;
                }
                // The lines wait for the next Stop rather than being lost.
                if let Some(s) = self.services.as_ref() {
                    s.restore_session(lines);
                }
                self.st.notify(Icon::Lyrics, palette::ORANGE, "Meeting not saved", "The engine did not take it. It is kept for the next Stop.", 8.0, None);
            }
        }
    }

    /// Ask the engine which models it has (Settings shows them, every 10 s while open).
    fn refresh_models(&mut self) {
        if self.st.models.busy {
            return;
        }
        self.st.models.busy = true;
        services::models::fetch(self.sink.clone(), poni_core::helper::configured_port());
    }

    /// Download the model Settings shows for `kind` (the engine's own unless one was stepped to);
    /// the engine is started first. One job per model: nothing starts while it already downloads.
    fn pull_model(&mut self, kind: poni_core::models::Kind) {
        let m = &mut self.st.models;
        let Some(id) = m.chosen(kind).filter(|id| id != poni_core::models::OFF) else { return };
        if m.pulling.is_some() || m.status(&id).is_some_and(|s| s.pulling) {
            return;
        }
        m.pulling = Some(kind);
        m.failed = None;
        if let Some(svc) = self.services.as_mut() {
            svc.engine_start();
        }
        services::models::pull(self.sink.clone(), poni_core::helper::configured_port(), kind, id);
    }

    fn select_model(&mut self, kind: poni_core::models::Kind, id: String) {
        services::models::select(self.sink.clone(), poni_core::helper::configured_port(), kind, id);
    }

    fn on_model_pulled(&mut self, kind: poni_core::models::Kind, id: String, result: std::result::Result<(), String>) {
        self.st.models.pulling = None;
        self.st.models.failed = result.err().map(|e| (kind, e));
        // A model stepped to and now on disk is what the person asked for: switch to it.
        if self.st.models.failed.is_none() && self.st.models.chosen(kind).as_deref() == Some(id.as_str()) && self.st.models.selected(kind).as_deref() != Some(id.as_str()) {
            self.select_model(kind, id);
        }
        if kind == poni_core::models::Kind::Translate && self.st.models.failed.is_none() {
            self.start_lyric_translation();
        }
        self.refresh_models();
        let title = if self.st.models.failed.is_none() { format!("{} downloaded", kind.label()) } else { format!("{} download failed", kind.label()) };
        let (icon, color) = if self.st.models.failed.is_none() { (Icon::Check, palette::GREEN) } else { (Icon::Download, palette::ORANGE) };
        let sub = self.st.models.failed.as_ref().map_or_else(|| "Captions start by themselves".to_string(), |(_, e)| e.clone());
        self.st.notify(icon, color, title, sub, 6.0, None);
    }

    /// Choose the folder of the model Settings shows for `kind` (`pick`), or send it back to the default.
    /// The Settings row is already locked while this runs (`Models::place`); this guards the commands too.
    fn place_model(&mut self, kind: poni_core::models::Kind, pick: bool) {
        let m = &mut self.st.models;
        if m.place(kind).is_none_or(|p| !(if pick { p.change } else { p.reset })) {
            return;
        }
        let Some(id) = m.chosen(kind) else { return };
        m.placing = Some(kind);
        let owner = self.settings_win.as_ref().map(|w| crate::events::SendHwnd::new(w.hwnd));
        services::models::relocate(self.sink.clone(), poni_core::helper::configured_port(), kind, id, pick, owner);
    }

    fn on_model_placed(&mut self, kind: poni_core::models::Kind, result: std::result::Result<(), String>) {
        self.st.models.placing = None;
        if let Err(e) = result {
            self.st.notify(Icon::Download, palette::ORANGE, format!("{} not moved", kind.label()), e, 8.0, None);
        }
        self.refresh_models();
    }

    fn on_model_selected(&mut self, kind: poni_core::models::Kind, result: std::result::Result<(), String>) {
        if let Err(e) = result {
            self.st.models.set_pick(kind, None);
            self.st.notify(Icon::Download, palette::ORANGE, format!("{} not switched", kind.label()), e, 6.0, None);
        }
        self.refresh_models();
    }

    /// Translate the song now followed (once; the engine answers from its cache file next time),
    /// or stop: translation off, no synced lyrics, or the song already in the target language.
    fn start_lyric_translation(&mut self) {
        let Some(svc) = self.services.as_ref() else { return };
        let s = &self.st.settings;
        let l = &self.st.lyrics;
        let lines: Vec<String> = l.lyrics.as_ref().filter(|x| x.synced).map(|x| x.lines.iter().map(|y| y.text.trim().to_string()).collect()).unwrap_or_default();
        let src = poni_core::lyric_tr::song_lang(&lines.iter().map(String::as_str).collect::<Vec<_>>());
        if !s.lyrics_translate || lines.is_empty() || !poni_core::lyric_tr::wants(src, &s.target_lang) {
            svc.translate_lyrics(None);
            self.st.lyrics.translated.clear();
            self.st.lyrics.tr = poni_core::lyric_tr::TrState::Idle;
            return;
        }
        let job = services::lyric_translate::Job { track_key: l.track_key.clone(), lines, src, tgt: s.target_lang.clone(), port: poni_core::helper::configured_port() };
        svc.translate_lyrics(Some(job));
        self.st.lyrics.tr = poni_core::lyric_tr::TrState::Working;
        self.st.lyrics.translated.clear();
    }

    fn on_capture(&mut self, e: services::capture::CaptureEvent) {
        use services::capture::CaptureEvent;
        match e {
            // A late report from before Stop does not bring it back.
            CaptureEvent::State(_) | CaptureEvent::Heard | CaptureEvent::Hint(_) if self.st.capture == poni_core::capture::CaptureState::Off => {}
            CaptureEvent::State(s) => {
                if let (poni_core::capture::CaptureState::Failed(_), Some(svc)) = (&s, self.services.as_mut()) {
                    svc.capture_stop();
                    self.end_session(false);
                }
                self.st.helper.capturing = s.running();
                // Captions cannot start without the speech model: the pill says so and a tap downloads it.
                if s.needs_model() && !self.st.capture.needs_model() {
                    self.st.notify(Icon::Download, palette::ORANGE, "Speech model needed","Tap to download it for captions", 8.0, Some(NoticeAction::DownloadModel));
                    self.refresh_models();
                }
                self.st.capture = s;
            }
            CaptureEvent::Heard => {
                if let Some(s) = self.services.as_ref() {
                    s.helper_poll();
                }
            }
            CaptureEvent::Hint(h) => self.st.caption_hint = h,
        }
    }

    fn on_apple_music(&mut self, status: AppleMusicStatus) {
        let (color, title, subtitle) = match status {
            AppleMusicStatus::Accepted => (palette::GREEN, "Apple Music lyrics on", "LRCLIB fills in the rest"),
            AppleMusicStatus::Rejected => (palette::ORANGE, "Apple Music token not accepted", "Copy a fresh one from music.apple.com"),
            AppleMusicStatus::Unreachable => (palette::ORANGE, "Can't reach Apple Music", "Token saved; trying again later"),
            AppleMusicStatus::NoAccess => (palette::ORANGE, "No lyrics from Apple Music", "They need an Apple Music subscription"),
        };
        self.st.notify(Icon::Lyrics, color, title, subtitle, 6.0, None);
    }

    fn show_held_notice(&mut self, now: f64) {
        if let Some((mut n, at)) = self.st.held.take() {
            if now - at <= crate::state::HELD_MAX_S {
                n.until = now + NOTICE_S;
                self.st.notice = Some(n);
            }
        }
    }

    /// Look up the current track's lyrics again (the sources changed).
    fn refetch_lyrics(&mut self) {
        if !self.st.settings.lyrics {
            return;
        }
        let Some(m) = self.st.media.clone().filter(|m| !m.title.is_empty()) else { return };
        if let Some(svc) = self.services.as_ref() {
            self.st.lyrics = LyricsState { track_key: m.track_key.clone(), status: LyricsStatus::Loading, ..Default::default() };
            svc.request_lyrics(&m);
        }
    }

    /// The engine keeps the spoken and target language (`/ui-prefs`), so the extension and the app
    /// share them: its word wins when it changes or at the start; if it has none yet, ours go up.
    fn on_engine_langs(&mut self, engine: &poni_core::lang_prefs::LangPrefs) {
        use poni_core::lang_prefs::{patch_body, Step};
        let (src, tgt) = (self.st.settings.source_lang.clone(), self.st.settings.target_lang.clone());
        match self.st.lang_sync.on_engine(engine, &src, &tgt) {
            Step::Nothing => {}
            Step::Push => {
                if let Some(s) = self.services.as_ref() {
                    s.helper_post_prefs(patch_body(&src, &tgt));
                }
            }
            Step::Adopt { src, tgt } => {
                if let Some(s) = src {
                    self.st.settings.source_lang = s;
                }
                if let Some(t) = tgt {
                    self.st.settings.target_lang = t;
                }
                self.st.cmd(Command::SaveSettings);
            }
        }
    }

    /// Apply side effects of a settings change (from the menu, a reload or a page).
    fn settings_changed(&mut self, before: &Settings) {
        // Show over games and Hide in full-screen apps follow each other.
        self.st.settings.pair_game_stats(before);
        let now = &self.st.settings;
        if before.theme != now.theme {
            self.st.accent = theme_accent(now.theme);
        }
        if before.hide_in_fullscreen != now.hide_in_fullscreen {
            // Apply at once: show the island over the full-screen app, or hide it.
            self.on_event(AppEvent::Fullscreen(self.fullscreen_on));
        }
        if before.step_aside != self.st.settings.step_aside && true {
            // Step aside starts or stops watching the top of the screen.
            self.sync_top_watch();
        }
        let now = &self.st.settings;
        if !before.lyrics && now.lyrics {
            if let Some(m) = self.st.media.clone() {
                let stale = self.st.lyrics.track_key != m.track_key || self.st.lyrics.status == LyricsStatus::Idle;
                if stale && !m.title.is_empty() {
                    if let Some(svc) = self.services.as_ref() {
                        self.st.lyrics = LyricsState { track_key: m.track_key.clone(), status: LyricsStatus::Loading, ..Default::default() };
                        svc.request_lyrics(&m);
                    }
                }
            }
        }
        let retranslate = before.lyrics_translate != now.lyrics_translate || before.target_lang != now.target_lang;
        let new_language = before.source_lang != now.source_lang || before.target_lang != now.target_lang;
        if retranslate {
            self.start_lyric_translation();
        }
        // The engine keeps the languages for the extension and the app too (a no-op post when it just told us).
        if new_language {
            if let Some(s) = self.services.as_ref() {
                s.helper_post_prefs(poni_core::lang_prefs::patch_body(&self.st.settings.source_lang, &self.st.settings.target_lang));
            }
        }
        // Running captions pick up a new language by starting again.
        if new_language && self.st.capture.running() {
            self.set_captions(true);
        }
        self.st.pomodoro.cfg = self.st.settings.pomodoro.clone();
        // Prayer times: off stops it at once; a new place, or following the location again.
        let prayer_id = poni_core::addons::PRAYER_TIMES.id;
        if before.addon_on(prayer_id) && !self.st.settings.addon_on(prayer_id) {
            self.prayer_off();
        }
        if before.prayer.place != self.st.settings.prayer.place {
            self.resolve_prayer_place();
        }
        if !before.prayer.follow_location && self.st.settings.prayer.follow_location && self.st.prayer_on() {
            self.locate();
        }
        // The Downloader: off stops its downloads before its tools are deleted.
        let downloader_id = poni_core::addons::DOWNLOADER.id;
        if before.addon_on(downloader_id) && !self.st.settings.addon_on(downloader_id) {
            self.downloads_off();
        }
        // An add-on switched on downloads its files; off deletes them.
        for a in poni_core::addons::ALL {
            let on = self.st.settings.addon_on(a.id);
            if before.addon_on(a.id) != on {
                pinfo!("add-ons: {} switched {}", a.id, if on { "on" } else { "off" });
                self.st.addons.insert(a.id, if !on { AddonStatus::Off } else if a.downloads() { AddonStatus::Checking } else { AddonStatus::Ready });
                if let Some(s) = self.services.as_ref() {
                    s.set_addon(a.id, on);
                }
            }
        }
        // Notifications switched on in Settings' tabs row: listen, Windows'
        // question first; off: stop.
        let notify_was = !before.hidden_tabs.iter().any(|k| k == PageKind::Notifications.key());
        if self.st.notify_can && notify_was != self.st.notifications_on() && true {
            if self.st.notifications_on() {
                self.start_notify(true);
            } else {
                self.stop_notify();
            }
        }
        if before.game_stats != self.st.settings.game_stats {
            if self.st.settings.game_stats && self.st.game.access == FpsAccess::Unknown {
                self.check_fps();
            }
            self.sync_game();
        }
        if before.game_peek != self.st.settings.game_peek && self.st.game.active {
            // Over a game: peeks start with one (it hides after its few
            // seconds), and the readout that stays shows at once.
            self.game_peek_until = 0.0;
            unsafe {
                let _ = KillTimer(self.hwnd, TIMER_PEEK);
            }
            self.peek_game(if self.st.settings.game_peek { "peeks picked" } else { "picked to stay" });
        }
        // The display the island hangs on, or its width when open (the
        // Settings window has both).
        if before.monitor != self.st.settings.monitor {
            self.monitor = window::pick_monitor(self.st.settings.monitor);
            self.set_dpi(self.monitor.dpi);
            self.refresh_monitor();
        } else if before.expanded_width != self.st.settings.expanded_width {
            self.layout_surface();
        }
        if let Some(w) = self.settings_win.as_mut() {
            w.view.dirty = true;
        }
        // System's readings at rest: its history switch, while System is on.
        let history = self.st.settings.system_history_on();
        if before.system_history_on() != history && true {
            match &self.sysmon {
                Some(s) => s.background(history),
                None if history => self.start_sysmon(),
                None => {}
            }
            // Off while the page is closed: the kept minute goes, so the next opening starts fresh.
            if !history && !self.sysmon_on && !self.st.game.active {
                self.st.system.clear();
            }
        }
    }

    fn on_menu(&mut self, cmd: tray::MenuCmd) {
        use tray::MenuCmd::*;
        let before = self.st.settings.clone();
        let s = &mut self.st.settings;
        match cmd {
            ToggleIdleStyle(style) => s.idle_style = style,
            SetTheme(theme) => s.theme = theme,
            ToggleSystemHistory => s.system_history = !s.system_history,
            ToggleLyrics => s.lyrics = !s.lyrics,
            TogglePronunciation => s.lyrics_pronunciation = !s.lyrics_pronunciation,
            SetHideFullscreen(hide) => s.hide_in_fullscreen = hide,
            ToggleGameStats => s.game_stats = !s.game_stats,
            ToggleGamePeek => s.game_peek = !s.game_peek,
            ToggleSounds => s.sounds = !s.sounds,
            TogglePinned => self.st.pinned = !self.st.pinned,
            CentreIsland => s.island_x = None,
            ShowSettings => self.show_settings(&mut Vec::new()),
            ToggleAutostart => {
                let on = crate::autostart::is_enabled();
                if let Err(e) = crate::autostart::set_enabled(!on) {
                    pwarn!("autostart toggle failed: {e}");
                }
                // The Settings page's switch follows.
                crate::autostart::report(self.sink.clone(), None);
            }
            OpenSettings => {
                if !paths::settings_path().exists() {
                    let _ = save_json_atomic(&paths::settings_path(), &self.st.settings);
                }
                shell::open(&paths::settings_path().to_string_lossy());
            }
            ReloadSettings => {
                // Never move the user's file aside or reset on a typo: keep the
                // current settings and say what's wrong.
                let path = paths::settings_path();
                match std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| parse_json::<Settings>(&t)) {
                    Ok(s2) => {
                        let s2 = s2.sanitized();
                        let monitor_changed = s2.monitor != self.st.settings.monitor;
                        self.st.settings = s2.clone();
                        self.saved_settings = s2;
                        self.settings_writable = true;
                        if monitor_changed {
                            self.monitor = window::pick_monitor(self.st.settings.monitor);
                            self.set_dpi(self.monitor.dpi);
                        } else {
                            // The expanded width may have changed.
                            self.layout_surface();
                        }
                        self.refresh_monitor();
                    }
                    Err(e) => {
                        pwarn!("settings.json not reloaded: {e}");
                        self.st.notify(crate::icons::Icon::Sliders, palette::ORANGE, "Settings not reloaded", "settings.json has an error; see the log", 5.0, None);
                    }
                }
            }
            OpenDataFolder => shell::open(&paths::data_dir().to_string_lossy()),
            About => shell::open(&crate::version::notes_url()),
            LyricsCredit => shell::open("https://lrclib.net"),
            AppleMusicToken => self.use_apple_music_token(),
            AppleMusicHelp => shell::open(APPLE_MUSIC_HELP_URL),
            AppleMusicForget => self.forget_apple_music_token(),
            // "Update to x…": the island opens on the Update sheet.
            Update => {
                self.st.open_update();
                self.expand();
            }
            CheckForUpdates => self.check_for_updates(),
            OpenLive => self.open_page(PageKind::Live),
            OpenMeeting => self.open_page(PageKind::Meeting),
            OpenInbox => self.open_page(PageKind::Inbox),
            OpenApp => {
                if let Some(svc) = &self.services {
                    svc.engine_start();
                }
                crate::services::engine::open_when_ready("/app/app.html");
            }
            OpenMinutes => {
                if let Some(svc) = &self.services {
                    svc.engine_start();
                }
                crate::services::engine::open_when_ready("/app/minutes.html");
            }
            StartEngine => {
                if let Some(svc) = &self.services {
                    svc.engine_start();
                }
            }
            RestartEngine => {
                if let Some(svc) = &self.services {
                    svc.engine_restart();
                }
            }
            SetupExtension => {
                if let Some(svc) = &self.services {
                    svc.engine_start();
                }
                crate::services::engine::open_when_ready("/app/setup-extension.html");
            }
            StartCaptions => self.captions_by_hand(true),
            StopCaptions => self.captions_by_hand(false),
            OpenCaptionsPanel => shell::open_in_chrome(&format!("chrome-extension://{}/sidepanel.html", crate::services::engine::EXTENSION_ID)),
            Quit => {
                self.quit(0);
                return;
            }
        }
        self.settings_changed(&before);
        self.save_settings();
        self.request_frame();
    }

    // ------------------------------------------------------------ events

    pub fn on_event(&mut self, ev: AppEvent) {
        let now = clock::mono();
        self.st.now = now;
        let media_before = matches!(ev, AppEvent::Media(_) | AppEvent::MediaTimeline { .. }).then(|| self.media_snapshot());
        // What the Settings window shows that a service reports.
        let shown = matches!(
            ev,
            AppEvent::Autostart(_) | AppEvent::Update(_) | AppEvent::Addon { .. } | AppEvent::Located(_) | AppEvent::Notify(_) | AppEvent::WinLang { .. } | AppEvent::Models(_) | AppEvent::ModelPulled { .. } | AppEvent::ModelSelected { .. } | AppEvent::ModelPlaced { .. }
        );
        if let Some(w) = self.settings_win.as_mut().filter(|_| shown) {
            w.view.dirty = true;
        }
        // A download's bytes coming in while nobody can see the island (locked,
        // display off) wait for the next frame something else asks for: the
        // pill catches up then, as nothing else of it moves on its own.
        let unseen = matches!(ev, AppEvent::Download { line: poni_core::ytdlp::Line::Progress { .. }, .. }) && (self.locked || self.display_off);
        match ev {
            AppEvent::Backdrop => {
                if self.glass.on_backdrop(self.hwnd, &mut self.gfx) {
                    self.request_frame();
                }
            }
            AppEvent::Media(session) => {
                let prev_key = self.st.media.as_ref().map(|m| m.track_key.clone());
                match session {
                    Some(mut s) => {
                        // Keep already-decoded art if the track didn't change.
                        if s.art.is_none() {
                            if let Some(prev) = &self.st.media {
                                if prev.track_key == s.track_key {
                                    s.art = prev.art.clone();
                                    s.art_color = prev.art_color;
                                }
                            }
                        }
                        let changed = prev_key.as_deref() != Some(s.track_key.as_str());
                        if changed {
                            self.st.lyrics = LyricsState { track_key: s.track_key.clone(), status: LyricsStatus::Idle, ..Default::default() };
                            if let Some(svc) = self.services.as_ref() {
                                svc.translate_lyrics(None);
                            }
                            if self.st.settings.lyrics && !s.title.is_empty() {
                                if let Some(svc) = self.services.as_ref() {
                                    self.st.lyrics.status = LyricsStatus::Loading;
                                    svc.request_lyrics(&s);
                                }
                            }
                        }
                        self.st.media = Some(s);
                    }
                    None => {
                        self.st.media = None;
                        self.st.lyrics = LyricsState::default();
                    }
                }
                self.auto_captions_step();
            }
            AppEvent::MediaTimeline { track_key, timeline } => {
                if let Some(m) = self.st.media.as_mut() {
                    if m.track_key == track_key {
                        m.timeline = timeline;
                    }
                }
                self.auto_captions_step();
            }
            AppEvent::MediaArt { track_key, art } => {
                if let Some(m) = self.st.media.as_mut() {
                    if m.track_key == track_key {
                        m.art_color = art.as_ref().map(|a| a.accent_color());
                        m.art = art;
                    }
                }
            }
            AppEvent::Lyrics { track_key, result } => {
                if self.st.lyrics.track_key == track_key {
                    match result {
                        crate::events::LyricsResult::Found { lyrics, source, ruby, wants_ja_readings } => {
                            self.st.lyrics.status = LyricsStatus::Found;
                            self.st.lyrics.lyrics = Some(lyrics);
                            self.st.lyrics.source = source;
                            self.st.lyrics.ruby = ruby;
                            self.start_lyric_translation();
                            self.st.lyrics.wants_ja_readings = wants_ja_readings;
                            // The first Japanese song whose kanji went unread
                            // switches Japanese readings on, as its switch in
                            // Add-ons would: it downloads once (3.8 MB) and
                            // the song is read again with romaji. Only people
                            // who play Japanese songs get it; switched off by
                            // hand, it stays off (the Music page still offers it).
                            if poni_core::addons::ja_switches_on(&self.st.settings, wants_ja_readings) {
                                pinfo!("lyrics: a Japanese song's kanji went unread; switching Japanese readings on");
                                self.st.settings.set_addon(poni_core::addons::JAPANESE_READINGS.id, true);
                                self.st.cmd(Command::SaveSettings);
                            }
                        }
                        crate::events::LyricsResult::Instrumental => self.st.lyrics.status = LyricsStatus::Instrumental,
                        crate::events::LyricsResult::NotFound => self.st.lyrics.status = LyricsStatus::NotFound,
                        crate::events::LyricsResult::Error(e) => self.st.lyrics.status = LyricsStatus::Error(e),
                    }
                }
            }
            AppEvent::Volume { level, muted } => {
                let first = !self.st.volume.known;
                self.st.volume = crate::state::VolumeState { level, muted, known: true };
                if !first && self.st.settings.hud_volume {
                    self.st.show_hud(HudKind::Volume { level, muted }, 1.6);
                }
            }
            AppEvent::Power(p) => {
                let old = self.st.power;
                self.st.power = p;
                if self.st.settings.hud_power && p.has_battery {
                    if p.on_ac != old.on_ac {
                        self.st.show_hud(HudKind::Charging { percent: p.percent, plugged: p.on_ac }, 2.2);
                    } else if !p.on_ac && ((old.percent > 20 && p.percent <= 20) || (old.percent > 10 && p.percent <= 10)) {
                        self.st.show_hud(HudKind::LowBattery { percent: p.percent }, 4.0);
                    }
                }
            }
            AppEvent::Bluetooth { name, connected, battery, audio } => {
                if self.st.settings.hud_bluetooth {
                    self.st.show_hud(HudKind::Bluetooth { name, connected, battery, audio }, 2.6);
                }
            }
            AppEvent::Fullscreen(on) => {
                self.fullscreen_on = on;
                // The readout and its peeks first, then whether the island shows.
                self.sync_game();
            }
            AppEvent::Foreground => self.start_raises(),
            AppEvent::TopWindows(places) => {
                // The self-test puts its own window under the island.
                if true {
                    self.top_windows = places;
                    self.request_frame();
                }
            }
            AppEvent::ShelfAdd(paths) if self.expanded && self.st.page == PageKind::Script && pages::script::take_drop(&mut self.st, &paths) => {
                // A text file dropped on the Script page becomes the script.
                self.drag_hover = false;
                self.st.drag_hover = false;
                self.request_frame();
            }
            AppEvent::ShelfAdd(paths) if self.expanded && self.st.page == PageKind::Calendar && paths.iter().any(|p| poni_core::calendar::is_ics_path(p)) => {
                // An .ics file dropped on the Calendar page is imported, not shelved.
                self.import_ics(&paths);
                self.drag_hover = false;
                self.st.drag_hover = false;
                self.request_frame();
            }
            AppEvent::ShelfAdd(paths) => {
                let n = self.st.store.shelf.add_paths(&paths, self.st.unix);
                for p in &paths {
                    self.st.cmds.push(Command::LoadThumb(p.clone()));
                }
                self.st.save();
                self.st.page = PageKind::Shelf;
                self.drag_hover = false;
                self.st.drag_hover = false;
                self.expand();
                pinfo!("shelf: {n} new item(s)");
            }
            AppEvent::DragHover(on) => {
                self.drag_hover = on;
                self.st.drag_hover = on;
                if on {
                    // The Script page takes a text file; everything else goes to the Shelf.
                    if !(self.expanded && matches!(self.st.page, PageKind::Script | PageKind::Calendar)) {
                        self.st.page = PageKind::Shelf;
                    }
                    self.expand();
                } else {
                    self.maybe_schedule_collapse();
                }
            }
            AppEvent::ShelfThumb { path, image } => {
                // The answer to an app icon the System page asked for (only that
                // answer touches its icons), and to the Shelf when it asked too.
                let ours = self.icon_wait.remove(&path);
                let for_shelf = !ours || self.st.shelf_thumbs.contains_key(&path);
                if ours {
                    let px = pages::system::icon_px(self.gfx.scale());
                    self.st.app_icons.insert(path.clone(), image.as_ref().map(|i| pages::system::shrink_icon(i, px)));
                }
                if for_shelf {
                    self.st.shelf_thumbs.insert(path, image);
                }
            }
            AppEvent::Stats(s) => self.st.stats = s,
            AppEvent::System(m) => {
                // A reading still on its way when the page closed is dropped.
                if self.sysmon_on || self.st.game.active {
                    self.st.system = *m;
                }
                // Over a game the frame rate goes with each reading, once a second.
                if self.st.game.active {
                    self.st.game.rate = self.frames.as_ref().and_then(|f| f.rate());
                    let fps = self.st.game.rate.map(|r| r.fps);
                    let before: Vec<f32> = self.st.game.history.values().collect();
                    self.st.game.history.push(fps);
                    // Peeks only: a sharp drop shows the readout (at most every half minute).
                    let now = clock::mono();
                    if let Some(fps) = fps.filter(|_| self.st.settings.game_peek) {
                        if now >= self.game_peek_until && now - self.game_drop_at >= DROP_PEEK_EVERY_S && poni_core::frames::sharp_drop(&before, fps) {
                            self.game_drop_at = now;
                            self.peek_game("the frame rate dropped");
                        }
                    }
                }
            }
            AppEvent::FpsAccess(a) => {
                if self.st.game.access == FpsAccess::Asking {
                    self.blur_text();
                }
                if a != self.st.game.access {
                    pinfo!("show over games: frames {a:?}");
                }
                self.st.game.access = a;
                self.sync_game();
            }
            AppEvent::AppleMusic(status) => self.on_apple_music(status),
            AppEvent::Phone(e) => self.on_phone(e),
            AppEvent::Paired(e) => self.on_paired(e),
            AppEvent::Autostart(on) => self.st.ui.autostart = Some(on),
            AppEvent::Helper(r) => {
                let langs = r.as_ref().ok().map(|(s, _)| s.langs.clone());
                self.st.helper.apply(r);
                // A model move goes on with Settings closed: this poll keeps asking how far it is.
                if !self.st.models.moving().is_empty() && self.st.models.due(now) {
                    self.refresh_models();
                }
                if let Some(l) = langs {
                    self.on_engine_langs(&l);
                }
            }
            AppEvent::Engine(info) => {
                // The engine came back after a translation it could not make: ask again.
                let back = info.running && !self.st.engine.running && matches!(self.st.lyrics.tr, poni_core::lyric_tr::TrState::Unavailable(_));
                self.st.engine = info;
                if back {
                    self.start_lyric_translation();
                }
            }
            AppEvent::HelperNotice(m) => self.st.helper_notice = Some((m, now + 6.0, true)),
            AppEvent::Calendar(r) => {
                // A fresh calendar ends the "Reading your calendar" note; an error notice stays.
                if self.st.helper_notice.as_ref().is_some_and(|n| n.0.starts_with("Reading your calendar")) {
                    self.st.helper_notice = None;
                }
                self.st.helper.apply_calendar(r);
                self.calendar_heads_up();
                // The calendar answers every minute: also the clock that stops captions after a video.
                self.auto_captions_step();
            }
            AppEvent::CalendarNotes(Ok(id)) => {
                // That meeting is the one shown, whether it was just made or already there.
                if !id.is_empty() {
                    self.st.helper.select(&id);
                }
                self.st.meeting_page = 0;
                self.set_page(PageKind::Meeting);
                self.request_frame();
            }
            AppEvent::CalendarNotes(Err(e)) => self.st.helper_notice = Some((e, now + 6.0, true)),
            AppEvent::Capture(e) => self.on_capture(e),
            AppEvent::Sound(on) => {
                self.sound_on = on;
                self.auto_captions_step();
            }
            AppEvent::MeetingSaved(r) => self.on_meeting_saved(r),
            AppEvent::Models(r) => {
                let was = self.st.models.moving();
                self.st.models.apply(r, now);
                // With Settings open the row says how the move went; with it closed a notice does.
                if !self.settings_window_open() {
                    for (kind, end) in self.st.models.move_ends(&was) {
                        match end {
                            Ok(sub) => self.st.notify(Icon::Download, palette::GREEN, format!("{} moved", kind.label()), sub, 6.0, None),
                            Err(e) => self.st.notify(Icon::Download, palette::ORANGE, format!("{} not moved", kind.label()), e, 8.0, None),
                        }
                    }
                }
            }
            AppEvent::ModelPulled { kind, id, result } => self.on_model_pulled(kind, id, result),
            AppEvent::ModelSelected { kind, result } => self.on_model_selected(kind, result),
            AppEvent::ModelPlaced { kind, result } => self.on_model_placed(kind, result),
            AppEvent::LyricsTr { track_key, tgt, lines, state } => {
                // A late answer for another song or another target language is dropped.
                if self.st.lyrics.track_key == track_key && self.st.settings.target_lang == tgt && self.st.settings.lyrics_translate {
                    self.st.lyrics.translated = lines;
                    self.st.lyrics.tr = state;
                }
            }
            AppEvent::Addon { id, status } => {
                // A late report from before a switch-off doesn't bring it back.
                if self.st.settings.addon_on(id) || status == AddonStatus::Off {
                    self.st.addons.insert(id, status);
                }
                if id == poni_core::addons::PRAYER_TIMES.id {
                    if status == AddonStatus::Ready && self.st.settings.addon_on(id) && self.st.prayer.places.is_none() {
                        self.prayer_ready();
                    } else if status == AddonStatus::Off {
                        self.prayer_off();
                    }
                }
                // Japanese readings arrived for the song that asked for them:
                // read it again (its lyrics come from the cache).
                if id == poni_core::addons::JAPANESE_READINGS.id && status == AddonStatus::Ready && self.st.lyrics.wants_ja_readings {
                    if let (Some(svc), Some(m)) = (self.services.as_ref(), self.st.media.as_ref()) {
                        if m.track_key == self.st.lyrics.track_key {
                            pinfo!("lyrics: Japanese readings are on this PC; reading the song again");
                            svc.request_lyrics(m);
                        }
                    }
                }
            }
            AppEvent::Update(services::update::UpdateEvent::Checked(r)) => {
                let open = self.updater.as_mut().is_some_and(|u| u.checked(&mut self.st, r, crate::updates::unix_now()));
                self.schedule_update();
                self.fetch_setup();
                // Check for updates… found one to install: the Update sheet.
                if open {
                    self.expand();
                }
                // A frame, so a new version's notice goes up now, not with the next redraw.
                self.request_frame();
            }
            AppEvent::Update(services::update::UpdateEvent::Downloaded(r)) => {
                if self.updater.as_mut().is_some_and(|u| u.fetched(&mut self.st, r)) {
                    self.expand();
                }
                self.request_frame();
            }
            AppEvent::Located(found) => self.on_located(found),
            AppEvent::Cities { file, got } => pages::prayer::cities_came(&mut self.st, file, got),
            AppEvent::Notify(ev) => self.on_notify(ev),
            AppEvent::WinLang { id, state } => self.on_winlang(id, state),
            AppEvent::AdzanEnded => self.adzan_ended(),
            AppEvent::Download { id, line } => self.download_line(id, line),
            AppEvent::DownloadEnded { id, ok } => self.download_ended(id, ok),
            AppEvent::Log(s) => pinfo!("{s}"),
        }
        if let Some(before) = media_before {
            self.after_media_change(before, now);
        }
        if !unseen {
            self.request_frame();
        }
    }

    /// (player, track, playing) of the current media session.
    fn media_snapshot(&self) -> Option<(String, String, bool)> {
        self.st.media.as_ref().map(|m| (m.app_id.clone(), m.track_key.clone(), m.is_playing()))
    }

    /// Track the pause grace period and the title peek after a media update.
    fn after_media_change(&mut self, before: Option<(String, String, bool)>, now: f64) {
        let Some(m) = self.st.media.as_ref() else {
            self.st.media_paused_at = None;
            return;
        };
        let playing = m.is_playing();
        let same_player = before.as_ref().is_some_and(|b| b.0 == m.app_id);
        let new_track = before.as_ref().is_none_or(|b| b.1 != m.track_key);
        if playing {
            self.st.media_paused_at = None;
        } else if !same_player {
            // A different (or first) session that isn't playing: no grace.
            self.st.media_paused_at = None;
        } else if before.as_ref().is_some_and(|b| b.2) {
            // Playing -> paused: the pill lingers for a while.
            self.st.media_paused_at = Some(now);
        }
        // A new track starting while collapsed: show its title for a moment.
        if playing && new_track && !self.expanded {
            self.st.ui.peek_until = now + 3.0;
        }
    }

    // ------------------------------------------------------------ island state

    fn expand(&mut self) {
        if !self.expanded {
            self.expanded = true;
            self.cancel_hover();
            if self.st.page == PageKind::Notifications {
                self.notify_cmd(NotifyCmd::Check);
            }
        }
        self.request_frame();
    }

    /// (Re)start the hover dwell from `p`.
    fn arm_hover(&mut self, p: Point) {
        // Off: the pointer never opens it; a click does.
        if self.st.settings.hover_delay_ms >= poni_core::settings::HOVER_OFF_MS {
            return;
        }
        self.hover_arm = Some(p);
        unsafe {
            SetTimer(self.hwnd, TIMER_HOVER, self.st.settings.hover_delay_ms.max(1), None);
        }
    }

    fn cancel_hover(&mut self) {
        self.hover_arm = None;
        unsafe {
            let _ = KillTimer(self.hwnd, TIMER_HOVER);
        }
    }

    fn collapse(&mut self) {
        if self.expanded {
            self.expanded = false;
            if self.text_focus {
                self.blur_text();
            }
            self.set_stats(false);
            self.set_sysmon(false);
            // Settings closes with the island: it opens again on the page it was opened from.
            if self.st.page == PageKind::Settings {
                self.st.page = self.st.ui.before_settings.take().filter(|p| pages::tabs(&self.st).contains(p)).unwrap_or_else(|| pages::first_tab(&self.st));
            }
            self.st.update.sheet = false;
            self.st.update.said = None;
            // A notice that arrived while expanded gets its full time now.
            let min_until = self.st.now + 4.0;
            if let Some(n) = self.st.notice.as_mut() {
                n.until = n.until.max(min_until);
            }
        }
        self.request_frame();
    }

    /// Nothing holds the open island: no pointer on it, no pin, typing,
    /// file drag, press or Phone drop.
    fn free_to_collapse(&self) -> bool {
        !self.hovering && !self.st.pinned && !self.text_focus && !self.drag_hover && !self.menu_open && self.input.pressed_id.is_none() && !self.phone_holds()
    }

    /// The right-click menu closed: the island stays open with the pointer
    /// back on it, and closes after the hold's grace without.
    fn menu_closed(&mut self) {
        if !std::mem::take(&mut self.menu_open) || !self.expanded || self.hovering {
            return;
        }
        let mut pt = POINT::default();
        let on_island = unsafe { GetCursorPos(&mut pt).is_ok() && windows::Win32::Graphics::Gdi::ScreenToClient(self.hwnd, &mut pt).as_bool() } && {
            let s = self.gfx.scale();
            self.hovering_inside(Point::new(pt.x as f32 / s, pt.y as f32 / s))
        };
        if on_island {
            // As a move onto it would: watch for the pointer leaving again.
            self.hovering = true;
            unsafe {
                let mut tme = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: self.hwnd, dwHoverTime: 0 };
                let _ = TrackMouseEvent(&mut tme);
            }
        } else {
            self.maybe_schedule_collapse();
        }
    }

    /// The pointer left the open island: it starts closing on the next frame,
    /// or after `collapse_delay_ms` when the user set a grace.
    fn pointer_left(&mut self) {
        if !self.expanded || !self.free_to_collapse() {
            return;
        }
        match self.st.settings.collapse_delay_ms {
            0 => {
                self.collapse_due = true;
                self.request_frame();
            }
            ms => unsafe {
                SetTimer(self.hwnd, TIMER_COLLAPSE, ms, None);
            },
        }
    }

    /// A hold ended (see [`HOLD_GRACE_MS`]): close soon unless the pointer is on the island.
    fn maybe_schedule_collapse(&mut self) {
        if self.expanded && !self.hovering && !self.st.pinned && !self.text_focus && !self.drag_hover && !self.menu_open && !self.phone_holds() {
            unsafe {
                SetTimer(self.hwnd, TIMER_COLLAPSE, HOLD_GRACE_MS.max(self.st.settings.collapse_delay_ms), None);
            }
        }
    }

    fn set_stats(&mut self, on: bool) {
        if on == self.stats_on {
            return;
        }
        self.stats_on = on;
        unsafe {
            if on {
                self.st.stats = services::sysstats::sample();
                SetTimer(self.hwnd, TIMER_STATS, 1000, None);
            } else {
                let _ = KillTimer(self.hwnd, TIMER_STATS);
            }
        }
    }

    /// The System page opened or closed. Open, its readings arrive each
    /// second; with the history kept the minute behind them arrives at once,
    /// else each opening starts a fresh minute.
    fn set_sysmon(&mut self, on: bool) {
        if on == self.sysmon_on {
            return;
        }
        self.sysmon_on = on;
        // The self-test shows sample readings; the real sources get their own check.
        if false {
            return;
        }
        if on && self.sysmon.is_none() {
            self.start_sysmon();
        }
        if let Some(s) = &self.sysmon {
            s.open(on);
        }
        // The readout over a game still draws from them.
        if !on && !self.st.settings.system_history_on() && !self.st.game.active {
            self.st.system.clear();
        }
    }

    fn start_sysmon(&mut self) {
        self.sysmon_rest = self.rest_now();
        match services::sysmon::SysMon::start(self.sink.clone(), self.st.settings.system_history_on(), self.sysmon_rest) {
            Ok(s) => self.sysmon = Some(s),
            Err(e) => pwarn!("sysmon: couldn't start ({e})"),
        }
    }

    /// Nobody at the PC (locked, or the display off) and battery saver.
    fn rest_now(&self) -> poni_core::sysmon::Rest {
        poni_core::sysmon::Rest { away: self.locked || self.display_off, saver: self.st.power.saver }
    }

    /// The System reader rests while nobody is at the PC, and its kept minute
    /// also on battery saver (`poni_core::sysmon::reads`). What it drops, the
    /// page drops too, so a minute from before never shows as the last one.
    fn tell_sysmon_rest(&mut self) {
        let rest = self.rest_now();
        if rest == self.sysmon_rest || false {
            return;
        }
        self.sysmon_rest = rest;
        if let Some(s) = &self.sysmon {
            s.rest(rest);
        }
        if !poni_core::sysmon::reads(self.sysmon_on, self.st.game.active, self.st.settings.system_history_on(), rest) {
            self.st.system.clear();
        }
    }

    /// Over a full-screen app the island hides when the setting says Hide, and
    /// under Show over games while the readout is away: between its peeks
    /// (peeks only), or once Alt+Shift+F hid it. Then nothing covers the game,
    /// and Windows sends its frames straight to the screen.
    fn fullscreen_hides(&self, now: f64) -> bool {
        self.fullscreen_on && (self.st.settings.hide_in_fullscreen || (self.st.game.active && self.readout_away(now)))
    }

    /// Show over games: the readout is off the screen. It stays unless the
    /// person picked peeks (`Settings::game_peek`) or hid it.
    fn readout_away(&self, now: f64) -> bool {
        if self.st.settings.game_peek {
            now >= self.game_peek_until
        } else {
            self.game_hidden
        }
    }

    /// Shows or hides the island for what is in front now.
    fn apply_fullscreen(&mut self, now: f64) {
        let hide = self.fullscreen_hides(now);
        if hide != self.fullscreen_hidden {
            self.fullscreen_hidden = hide;
            unsafe {
                let _ = ShowWindow(self.hwnd, if hide { SW_HIDE } else { SW_SHOWNOACTIVATE });
            }
            self.gfx.set_shown(!hide);
            if hide {
                self.collapse();
                self.cancel_hover();
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_COLLAPSE);
                }
                self.hovering = false;
                self.input.mouse = None;
            }
            let why = if self.fullscreen_on && !self.st.settings.hide_in_fullscreen && self.st.game.active { " (show over games)" } else { "" };
            pinfo!("fullscreen app {}: island {}{why}", if self.fullscreen_on { "in front" } else { "gone" }, if hide { "hidden" } else { "shown" });
            // Notices held back wait for the game to leave, not for a peek.
            if !hide && !self.fullscreen_on {
                self.show_held_notice(now);
            }
        }
        if !hide {
            // A borderless game or a browser in F11 may have taken the
            // top of the topmost band, and an island shown again after
            // a full-screen app is not raised by showing it.
            self.start_raises();
        }
    }

    /// Show over games: the readout shows over the game, and stays (peeks
    /// only: for a few seconds).
    fn peek_game(&mut self, why: &str) {
        let now = clock::mono();
        if !self.st.settings.game_peek {
            self.game_hidden = false;
            pinfo!("show over games: readout shows and stays ({why})");
            self.apply_fullscreen(now);
            return;
        }
        self.game_peek_until = now + PEEK_S;
        unsafe {
            SetTimer(self.hwnd, TIMER_PEEK, (PEEK_S * 1000.0) as u32, None);
        }
        pinfo!("show over games: readout shows ({why})");
        self.apply_fullscreen(now);
    }

    /// Alt+Shift+F: hide the readout, or show it again (peeks only: show it
    /// for a few seconds, or hide it again before its time).
    fn toggle_readout(&mut self) {
        if !self.st.game.active {
            return;
        }
        let now = clock::mono();
        if !self.st.settings.game_peek {
            self.game_hidden = !self.game_hidden;
            pinfo!("show over games: readout {} (Alt+Shift+F)", if self.game_hidden { "hidden until the next game" } else { "shows again" });
            self.apply_fullscreen(now);
            return;
        }
        if now < self.game_peek_until {
            self.game_peek_until = 0.0;
            unsafe {
                let _ = KillTimer(self.hwnd, TIMER_PEEK);
            }
            self.apply_fullscreen(now);
        } else {
            self.peek_game("Alt+Shift+F");
        }
    }

    /// Alt+Shift+F belongs to Poni only while a game is in front.
    fn set_peek_hotkey(&mut self, on: bool) {
        if on == self.peek_hotkey {
            return;
        }
        unsafe {
            if on {
                match RegisterHotKey(self.helper, HOTKEY_PEEK, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, u32::from(b'F')) {
                    Ok(()) => self.peek_hotkey = true,
                    Err(e) => pwarn!("show over games: Alt+Shift+F is taken ({e})"),
                }
            } else {
                let _ = UnregisterHotKey(self.helper, HOTKEY_PEEK);
                self.peek_hotkey = false;
            }
        }
    }

    /// Alt+Shift+S belongs to Poni only while the Script page can read.
    fn set_script_hotkey(&mut self, on: bool) {
        if on == self.script_hotkey {
            return;
        }
        unsafe {
            if on {
                match RegisterHotKey(self.helper, HOTKEY_SCRIPT, MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, u32::from(b'S')) {
                    Ok(()) => self.script_hotkey = true,
                    Err(e) => pwarn!("script: Alt+Shift+S is taken ({e})"),
                }
            } else {
                let _ = UnregisterHotKey(self.helper, HOTKEY_SCRIPT);
                self.script_hotkey = false;
            }
        }
    }

    /// The Script page: a reading pauses while its page isn't on screen, the
    /// island may close once nothing holds it, and the shortcut is Poni's
    /// only while there's a script to read on the page. Whether Record shows
    /// is asked as the page comes on screen.
    fn script_tick(&mut self) {
        let shown = self.expanded && self.st.page == PageKind::Script && !self.locked && !self.display_off && !self.fullscreen_hidden;
        self.script_shown = shown;
        if !shown && self.st.script.playing() {
            self.st.script.pause(self.st.now);
        }
        let held = self.st.script_holds_island();
        if self.script_held && !held {
            self.maybe_schedule_collapse();
        }
        self.script_held = held;
        let can_read = self.st.page == PageKind::Script && !self.st.store.script.is_empty() && (self.expanded || self.st.script.active);
        self.set_script_hotkey(can_read && true);
    }

    fn sync_script_capture(&mut self, on: bool) {
        if on == self.script_excluded {
            return;
        }
        self.script_excluded = on;
        if !on {
            window::exclude_from_capture(self.hwnd, window::CaptureOwner::Script, false);
            return;
        }
        let ok = window::windows_build().is_some_and(|b| b >= crate::glass::EXCLUDE_FROM_CAPTURE_BUILD)
            && window::exclude_from_capture(self.hwnd, window::CaptureOwner::Script, true);
        if self.st.script_hidden != Some(ok) {
            pinfo!("script: {}", if ok { "left out of screen capture" } else { "Windows can't leave the island out of screen capture" });
        }
        self.st.script_hidden = Some(ok);
    }

    /// Show over games: the readout shows while the setting is on and a
    /// full-screen app has the island's monitor with the island over it.
    /// It follows the full-screen app; the readings and the frame count run
    /// only meanwhile.
    fn sync_game(&mut self) {
        let want = self.st.settings.game_stats && self.fullscreen_on && !self.st.settings.hide_in_fullscreen && true;
        if want != self.st.game.active {
            self.st.game.active = want;
            self.set_peek_hotkey(want);
            if !want {
                self.game_peek_until = 0.0;
                self.game_hidden = false;
                unsafe {
                    let _ = KillTimer(self.hwnd, TIMER_PEEK);
                }
            }
            if want && self.sysmon.is_none() {
                self.start_sysmon();
            }
            // A failure last time is tried again with each new game.
            if want && matches!(self.st.game.access, FpsAccess::Failed(_)) {
                self.st.game.access = FpsAccess::Unknown;
            }
            if let Some(s) = &self.sysmon {
                s.game(want);
            }
            if !want {
                self.frames = None;
                self.game_pid = None;
                self.st.game.rate = None;
                self.st.game.app = None;
                if !self.sysmon_on && !self.st.settings.system_history_on() {
                    self.st.system.clear();
                }
            }
            pinfo!("show over games: readout {}", if want { "on" } else { "off" });
        }
        if !want {
            self.apply_fullscreen(clock::mono());
            return;
        }
        let pid = services::fullscreen::fullscreen_pid();
        if pid != self.game_pid {
            self.game_pid = pid;
            self.st.game.app = pid.and_then(services::sysmon::app_name);
            self.st.game.rate = None;
            self.st.game.history = Default::default();
            if let (Some(f), Some(p)) = (&self.frames, pid) {
                f.set_target(p);
            }
            pinfo!("show over games: {} in front", self.st.game.app.as_deref().unwrap_or("an app"));
            // A game came to the front: the readout shows for a moment.
            self.peek_game("a game came to the front");
        } else {
            self.apply_fullscreen(clock::mono());
        }
        let Some(pid) = pid else { return };
        if self.frames.is_none() && matches!(self.st.game.access, FpsAccess::Unknown | FpsAccess::Ready) {
            match services::frames::Frames::start(pid) {
                Ok(f) => {
                    self.frames = Some(f);
                    self.st.game.access = FpsAccess::Ready;
                }
                // Tells the one-time OK apart from a sign-out still to come
                // (once: a check that said yes isn't asked again).
                Err(services::frames::StartError::NoAccess) if self.st.game.access == FpsAccess::Ready => {
                    self.st.game.access = FpsAccess::NeedsOk;
                }
                Err(services::frames::StartError::NoAccess) => self.check_fps(),
                Err(services::frames::StartError::Failed(why)) => {
                    pwarn!("frames: couldn't start ({why})");
                    self.st.game.access = FpsAccess::Failed(why);
                }
            }
        }
    }

    /// Asks (off the UI thread) whether Windows lets Poni read frames.
    fn check_fps(&mut self) {
        if false || matches!(self.st.game.access, FpsAccess::Checking | FpsAccess::Asking) {
            return;
        }
        self.st.game.access = FpsAccess::Checking;
        services::frames::check_async(self.sink.clone());
    }

    /// Puts the island back on top after another window came forward. Apps
    /// often make themselves topmost just after they take the focus, with no
    /// event of their own, so a few more checks follow over the next two
    /// seconds. (Exclusive full-screen still covers every window.)
    fn start_raises(&mut self) {
        if !self.shown || self.fullscreen_hidden {
            return;
        }
        self.raise_if_covered();
        self.raises_left = RAISE_REPEATS;
        unsafe {
            SetTimer(self.hwnd, TIMER_RAISE, RAISE_INTERVAL_MS, None);
        }
    }

    /// Raises the island when a window sits above it or it lost its topmost
    /// style, and logs each culprit once.
    fn raise_if_covered(&mut self) {
        let topmost = unsafe { GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0;
        let above = services::fullscreen::window_above(self.hwnd);
        if topmost && above.is_none() {
            return;
        }
        let key = if topmost { above.clone().unwrap_or_default() } else { String::new() };
        if self.covered_by.insert(key) {
            match (&above, topmost) {
                (_, false) => pinfo!("island lost its topmost style; raised again"),
                (Some(class), true) => pinfo!("island covered by a {class} window; raised again"),
                (None, true) => {}
            }
        }
        self.raise_topmost();
    }

    /// Top of the topmost band, without taking the focus.
    fn raise_topmost(&self) {
        unsafe {
            let _ = SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    fn set_noactivate(&self, on: bool) {
        unsafe {
            let ex = GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE.0 as isize;
            let new = if on { ex | flag } else { ex & !flag };
            if new != ex {
                SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, new);
            }
        }
    }

    fn focus_text(&mut self) {
        if self.text_focus {
            return;
        }
        self.text_focus = true;
        unsafe {
            self.prev_foreground = GetForegroundWindow();
            self.set_noactivate(false);
            let _ = SetForegroundWindow(self.hwnd);
            let _ = SetFocus(self.hwnd);
        }
    }

    fn blur_text(&mut self) {
        self.input.focused = None;
        if !self.text_focus {
            return;
        }
        self.text_focus = false;
        self.set_noactivate(true);
        unsafe {
            if !self.prev_foreground.is_invalid() && IsWindow(self.prev_foreground).as_bool() && GetForegroundWindow() == self.hwnd {
                let _ = SetForegroundWindow(self.prev_foreground);
            }
        }
        self.maybe_schedule_collapse();
    }

    fn refresh_monitor(&mut self) {
        let m = match self.st.settings.monitor {
            MonitorChoice::Cursor => {
                window::monitor_info(windows::Win32::Graphics::Gdi::HMONITOR(self.monitor.handle as *mut core::ffi::c_void))
                    .unwrap_or_else(|| window::pick_monitor(MonitorChoice::Primary))
            }
            c => window::pick_monitor(c),
        };
        if m != self.monitor {
            pinfo!("monitor: {:?} dpi {}", m.rect, m.dpi);
            self.monitor = m;
            self.set_dpi(m.dpi);
            self.layout_surface();
        }
        // The refresh rate may have changed too (60 <-> 144 Hz).
        self.clock.set_monitor(m.handle);
        self.request_frame();
    }

    fn mouse_dip(&self, lp: LPARAM) -> Point {
        let x = (lp.0 & 0xffff) as u16 as i16 as f32;
        let y = ((lp.0 >> 16) & 0xffff) as u16 as i16 as f32;
        let s = self.gfx.scale();
        Point::new(x / s, y / s)
    }

    fn hit_at(&self, p: Point) -> Option<Hit> {
        self.hits.iter().rev().find(|h| h.rect.contains(p)).copied()
    }

    /// Whether `p` is over a part of the window that takes the mouse: the
    /// whole canvas while expanded (hit margin), only the island collapsed
    /// (floating: its outline and the gap above it, see [`hit_mask_for`]).
    fn hovering_inside(&self, p: Point) -> bool {
        if self.expanded {
            return self.island.canvas_rect_at(self.cx).contains(p);
        }
        if self.island.floating() {
            return self.hit_mask().contains(p);
        }
        self.island.body_rect_at(self.cx).contains(p)
    }

    /// Where the window takes the mouse now (see [`hit_mask_for`]).
    fn hit_mask(&self) -> HitMask {
        hit_mask_for(&self.island, self.cx, self.expanded, self.rests_hidden())
    }

    /// The closed island rests invisible, a strip at the top edge that only
    /// catches the pointer: the Hidden idle look, or stepped aside.
    fn rests_hidden(&self) -> bool {
        self.mode == Mode::Aside || (self.mode == Mode::Idle && self.st.settings.idle_style == IdleStyle::Hidden)
    }

    /// Step aside: where the island rests (what it shows at rest, the clock
    /// or the song, never the strip it steps aside to), from the edge it
    /// hangs from to its bottom, in screen pixels. Classic's shoulders and
    /// the floating Pill's gap count: they cover what is under them too.
    fn rest_rect(&self) -> RECT {
        let g = activities::geom(&activities::resting_mode(&self.st), &self.st);
        let floating = self.island.floating();
        let w = g.w + if floating { 0.0 } else { 2.0 * SHOULDER };
        let h = g.h + if floating { pill::TOP_GAP } else { 0.0 };
        let s = self.gfx.scale();
        let cx = self.surface.x as f32 + self.cx * s;
        let left = (cx - w * s / 2.0).floor() as i32;
        let right = (cx + w * s / 2.0).ceil() as i32;
        RECT { left, top: self.surface.y, right, bottom: self.surface.y + (h * s).ceil() as i32 }
    }

    /// Step aside (off since 0.2.6, see `Settings::step_aside`) while an app window
    /// reaches under where the island rests. Over a full-screen app the
    /// full-screen choice decides instead (Hide, or Stay on top for the
    /// readout over games). Each frame, before the mode is picked: it only
    /// compares a few rects.
    fn sync_aside(&mut self) {
        let r = self.rest_rect();
        let under = self.top_windows.iter().any(|t| t[0] < r.right && t[2] > r.left && t[1] < r.bottom && t[3] > r.top);
        let aside = self.st.settings.step_aside && !self.fullscreen_on && under;
        if aside != self.st.aside {
            self.st.aside = aside;
            let why = if aside { "a window is under the island; it rests out of the way" } else { "nothing under the island; it rests as before" };
            self.log_queue.push(format!("step aside: {why}"));
        }
    }

    /// Whether `p`, where the window took the mouse, is off the island.
    /// GPU renderer: the invisible hit mask trails a moving outline by up to
    /// [`MASK_INTERVAL`], and a pointer over the part the island already left
    /// (well outside its shape and shoulders) gets no hover. Software
    /// renderer: see [`App::over_shadow`].
    fn over_stale_mask(&self, p: Point) -> bool {
        if self.input.down {
            return false;
        }
        if !self.gfx.needs_hit_mask() {
            return self.over_shadow(p);
        }
        if self.island.settled() {
            return false;
        }
        let r = if self.expanded { self.island.canvas_rect_at(self.cx) } else { self.island.hover_rect_at(self.cx).inset(-SHOULDER - 2.0, 0.0) };
        !Rect::new(r.x, r.y, r.w, r.h + 2.0).contains(p)
    }

    /// Software renderer, floating island (the Pill theme) collapsed: a
    /// layered window takes the mouse wherever its pixels aren't fully
    /// transparent. That renderer draws the pill without its shadow
    /// (`pill::shape::draw_body`), so what's left beside the outline is its
    /// anti-aliased edge: a pointer there is off the island (no hover, no
    /// click, no menu). (The GPU renderer's hit mask decides on its own.)
    /// `p` is a pixel's corner: its centre is tested, so an edge pixel the
    /// outline mostly covers still counts.
    fn over_shadow(&self, p: Point) -> bool {
        if self.expanded || !self.island.floating() || self.gfx.needs_hit_mask() {
            return false;
        }
        let half = 0.5 / self.gfx.scale();
        !self.hit_mask().contains(Point::new(p.x + half, p.y + half))
    }

    fn target_mode(&self) -> Mode {
        if self.expanded {
            return Mode::Expanded(self.st.page);
        }
        activities::collapsed_mode(&self.st)
    }

    /// Island geometry for `m`. The resting pill lifts a little under the
    /// pointer: instant feedback while the hover dwell runs.
    fn geom_for(&self, m: &Mode) -> Geom {
        let g = activities::geom(m, &self.st);
        let liftable = match m {
            Mode::Idle => self.st.settings.idle_style != IdleStyle::Hidden,
            Mode::Activity(_) => true,
            _ => false,
        };
        if liftable && self.hovering && !self.expanded {
            if pill::on(self.st.settings.theme) {
                // Floating, it swells evenly about its middle and stays a capsule.
                pill::motion::hover_lift(g)
            } else {
                Geom::new(g.w + HOVER_LIFT.0, g.h + HOVER_LIFT.1, g.r + HOVER_LIFT.2)
            }
        } else {
            g
        }
    }

    // ------------------------------------------------------------ frame

    fn refresh_time(&mut self) {
        self.st.now = clock::mono();
        self.st.local = clock::local_now();
        self.st.unix = clock::unix_now();
    }

    fn tick(&mut self) {
        let now = self.st.now;
        if let Some(h) = &self.st.hud {
            if now >= h.until {
                self.st.hud = None;
            }
        }
        if let Some(n) = &self.st.notice {
            if !self.expanded && now >= n.until {
                self.st.notice = None;
            }
        }
        // A new version's notice (or "Updated to") waits for the island to be
        // free. The first frame counts (the window shows at its end).
        let free = !self.fullscreen_hidden && !self.locked && !self.display_off && !self.expanded && self.st.notice.is_none();
        if self.updater.as_mut().is_some_and(|u| u.announce(&mut self.st, free)) {
            self.request_frame();
        }
        if let Some(ended) = self.st.pomodoro.tick(now) {
            pages::focus::on_phase_ended(&mut self.st, ended);
        }
        self.prayer_tick();
        self.script_tick();
        // Prayer times, System, Script or Downloader switched off: its tab is gone.
        let gone = match self.st.page {
            PageKind::Prayer => !self.st.prayer_on(),
            PageKind::System => !self.st.system_on(),
            PageKind::Downloads => !self.st.downloader_on(),
            PageKind::Notifications => !self.st.notifications_on(),
            _ => false,
        };
        if gone {
            self.st.page = PageKind::Addons;
        }
    }

    /// Draw and show one frame. `tick` is the vblank that triggered it (None
    /// for self-test captures, which run off the clock).
    fn frame(&mut self, deferred: &mut Vec<Deferred>, tick: Option<FrameTick>) {
        if self.fullscreen_hidden {
            // Nothing is drawn, but timers, chimes and commands keep working.
            // Glass stops copying the screen: nobody sees the island.
            let off = RECT::default();
            self.glass.sync(false, self.hwnd, &self.sink, self.monitor.handle, off, &mut self.gfx);
            self.refresh_time();
            self.tick();
            self.run_commands(deferred);
            self.paint_settings_if_dirty(deferred);
            self.clock.set_active(self.settings_moving());
            self.motion = None;
            self.schedule_wake();
            return;
        }
        let rendered_at = clock::mono();
        self.refresh_time();
        // Stamp the frame with the vblank it will be shown after, so every
        // animation step is a whole number of refresh periods: even motion at
        // 60, 144 or 240 Hz, whatever the thread's wake-up jitter.
        let period = tick.map_or_else(|| self.clock.period(), |t| t.period);
        let anim_t = tick.map_or(rendered_at, |t| t.vblank + t.period).max(self.last_frame_t);
        let resumed = tick.is_some_and(|t| t.resumed) || self.last_frame_t == 0.0;
        // Coming out of rest, a motion advances one refresh, not the whole
        // time the clock was parked.
        let mut dt = if resumed { period } else { anim_t - self.last_frame_t };
        self.last_frame_t = anim_t;
        self.st.now = self.st.now.max(anim_t);
        self.tick();
        let now = self.st.now;

        // The pointer left the open island since the last frame: the close
        // starts on this frame, no timer in between.
        if std::mem::take(&mut self.collapse_due) && self.expanded && self.free_to_collapse() {
            self.collapse();
            self.left_at = clock::mono();
        }

        // A window under where the island rests: it rests out of the way.
        self.sync_aside();
        let target = self.target_mode();
        let mut retarget = false;
        if target != self.mode {
            let new_content = activities::content_key(&target) != activities::content_key(&self.mode);
            // A morph turned around mid-fade (the pointer came back while the
            // island closed): the content coming back is the one still fading
            // out, and it fades back in from where it is, not from nothing.
            let back = self
                .outgoing
                .filter(|o| new_content && activities::content_key(&o.0) == activities::content_key(&target))
                .map(|(_, t0, _, from)| from * outgoing_left(now - t0));
            if new_content {
                // The leaving content fades from how visible it is now.
                self.outgoing = Some((self.mode, now, self.island.target(), self.island.content_alpha()));
            }
            if let (Mode::Expanded(a), Mode::Expanded(b)) = (self.mode, target) {
                if a != b {
                    let dir = if b.tab_index() > a.tab_index() { 1.0 } else { -1.0 };
                    self.page_anim = Some((a, now, dir));
                }
            }
            self.motion_name = motion_name(&self.mode, &target);
            self.island.set_target(self.geom_for(&target), now, new_content);
            if let Some(a) = back {
                self.island.resume_content(a);
            }
            self.mode = target;
            retarget = true;
            if target == Mode::Expanded(PageKind::Downloads) {
                self.downloads_page_shown();
            }
        } else {
            // Size can change within a mode (a page's height, the hover lift); follow it.
            let g = self.geom_for(&self.mode);
            if g != self.island.target() {
                if self.island.settled() {
                    self.motion_name = "resize";
                }
                self.island.set_target(g, now, false);
                retarget = true;
            }
        }
        // A motion that starts on this frame moves one refresh's worth, even
        // when the previous frame was a slower ambient one.
        if retarget {
            dt = dt.min(period);
        }
        let dt = dt.clamp(0.0, 0.05) as f32;
        // Today's tiles need the readings only while they show (signed out it has the sign-in card, signed in the day).
        let engine_open = self.mode == Mode::Expanded(PageKind::Engine);
        services::sysmon::SysMon::watch(engine_open.then(poni_core::helper::configured_port));
        self.set_sysmon(engine_open || self.mode == Mode::Expanded(PageKind::System));
        // The Pill theme floats the island below the top edge.
        self.island.set_floating(pill::on(self.st.settings.theme).then_some(pill::TOP_GAP));
        self.island.step(dt, now);
        self.sync_room();
        self.ensure_room();
        self.sync_spot();
        self.place_island();
        self.note_motion(retarget, rendered_at, period, dt as f64);

        let scale = self.gfx.scale();
        let (sw, sh) = (self.surface.w, self.surface.h);
        let body = self.island.body_rect_at(self.cx);
        let canvas_r = self.island.canvas_rect_at(self.cx);
        let geom = self.island.current();
        let content_alpha = self.island.content_alpha();
        // Clear what the island covered last frame as well as this one.
        let canvas_px = px_rect(canvas_r, scale, 1, sw, sh);
        let full = RECT { left: 0, top: 0, right: sw, bottom: sh };
        let dirty = px_union(self.prev_canvas_px.unwrap_or(full), canvas_px);
        self.prev_canvas_px = Some(canvas_px);
        let mut hits = std::mem::take(&mut self.hits);
        hits.clear();

        // Stepping aside, the island flattens into the top edge and goes
        // invisible once there; coming back, it drops from the edge.
        let hidden_idle = self.rests_hidden() && (self.mode != Mode::Aside || self.island.settled());
        let floating = self.island.floating();
        // Software renderer: what of the floating island's hit area isn't
        // drawn (the gap above it) is painted at 1/255 (see hit_mask_for).
        let float_hit = if floating && !self.expanded { self.hit_mask().rect } else { None };
        // Content is masked to the island silhouette only while the outline
        // or the content moves. At rest every layout fits inside the body,
        // and skipping the mask layer keeps ambient frames cheap.
        let morphing = !self.island.settled() || self.outgoing.is_some();
        let mode = self.mode;
        let transition = self.page_anim.and_then(|(from, t0, dir)| {
            let t = ((now - t0) / PAGE_SWITCH) as f32;
            (t < 1.0).then_some(pages::PageTransition { from, t, dir })
        });
        if transition.is_none() {
            self.page_anim = None;
        }
        // Pages lay out at their final size, centred on the morphing outline,
        // so the header and the page body don't slide with the edges; the
        // outline reveals them.
        let lay = match mode {
            Mode::Expanded(_) => {
                let tgt = self.island.target();
                Rect::new(body.center().x - tgt.w / 2.0, body.y, tgt.w, tgt.h)
            }
            _ => body,
        };
        let mut wheel_left = 0.0;
        let draw_from = clock::mono();
        let mut drawn_at = draw_from;
        // Glass: copy the screen under the window while the GPU draws (the
        // self-test brings its own backdrop), then draw this frame's glass
        // before the frame starts. The look follows the glass, light or dark.
        let glass_theme = self.st.settings.theme == Theme::Glass;
        let window_px = RECT { left: self.surface.x, top: self.surface.y, right: self.surface.x + sw, bottom: self.surface.y + sh };
        // Only while someone can see it: not while hidden, locked or the display
        // is off. Not over a full-screen app either: copying a game's screen
        // every frame costs the game (Glass draws smoked glass there).
        let copy_on = glass_theme
            && true
            && !hidden_idle
            && !self.locked
            && !self.display_off
            && !self.fullscreen_on
            && matches!(self.gfx.renderer(), crate::gfx::Renderer::Gpu { .. });
        self.glass.sync(copy_on, self.hwnd, &self.sink, self.monitor.handle, window_px, &mut self.gfx);
        self.sync_script_capture(self.st.page == PageKind::Script && (self.expanded || !self.island.settled()));
        let mut glass_moving = false;
        let glass = if glass_theme && !hidden_idle {
            let small = !matches!(mode, Mode::Expanded(_));
            let (light, p, moving) = self.glass.frame(body, geom.r, SHOULDER, small, now, dt, scale, &mut self.gfx);
            glass_moving = moving;
            self.gfx.set_look(poni_core::look::glass(light));
            self.gfx.prepare_glass(&p, canvas_px);
            Some(p)
        } else {
            self.gfx.set_look(poni_core::look::of(self.st.settings.theme));
            None
        };
        let (repaint, anim, focus, ui_live) = match self.gfx.begin(dirty) {
            Ok(mut canvas) => {
                if self.expanded && !canvas.on_gpu() {
                    // Near-invisible hit margin: a forgiving edge for the open
                    // panel. Collapsed, only the visible shape takes the mouse.
                    // (The GPU renderer keeps this in its hit mask instead.)
                    canvas.fill_rect(canvas_r, Color::black(1.0 / 255.0));
                } else if let Some(r) = float_hit.filter(|_| !canvas.on_gpu()) {
                    // The gap above the floating pill (or the Hidden style's
                    // band at the top edge) takes the mouse too.
                    canvas.fill_rect(r, Color::black(1.0 / 255.0));
                }
                if let Some(p) = glass.as_ref() {
                    canvas.glass(p, canvas_r);
                } else {
                    let island_color = if hidden_idle { Color::black(1.0 / 255.0) } else { palette::ISLAND };
                    let border = if hidden_idle { None } else { Some(canvas.look().border) };
                    if floating {
                        // Hidden floats nothing: its band takes the mouse.
                        if !hidden_idle {
                            pill::shape::draw_body(&mut canvas, body, geom.r, island_color, border);
                        }
                    } else {
                        canvas.notch(body, geom.r, SHOULDER, island_color, border);
                    }
                }

                // Content scales about the top centre, where the island hangs
                // (floating, about the middle of the pill end of the morph).
                let pivot = if floating { pill::motion::pivot(body, self.island.target()) } else { Point::new(body.center().x, body.y) };
                if morphing {
                    canvas.clip(body);
                    if floating {
                        canvas.push_outline_mask(&pill::shape::segments(body, geom.r));
                    } else {
                        canvas.push_shape_mask(body, geom.r, SHOULDER);
                    }
                }

                // Outgoing content: laid out at its own (old) size, centred,
                // shrinking with the outline instead of being sliced, and
                // fading out on a smoothstep (it holds, then leaves). Drawn as
                // one layer, so it shrinks as a picture. Ghost input: no clicks.
                if let Some((m, t0, g, from)) = self.outgoing {
                    if now - t0 >= OUTGOING_FADE {
                        self.outgoing = None;
                    } else {
                        let old_body = Rect::new(body.center().x - g.w / 2.0, body.y, g.w, g.h);
                        let alpha = from * outgoing_left(now - t0);
                        let shrink = if floating { pill::motion::ghost_scale(geom, g, GHOST_MIN_SCALE) } else { (geom.w / g.w.max(1.0)).clamp(GHOST_MIN_SCALE, 1.0) };
                        let xf = scale_about(pivot, shrink);
                        let st = &mut self.st;
                        canvas.layered(old_body, alpha, xf, |c| {
                            let mut ghost_input = Input::default();
                            let mut ghost_hits = Vec::new();
                            let mut ghost = Ui::new(c, &mut ghost_input, &mut ghost_hits, now);
                            match m {
                                Mode::Expanded(page) => pages::draw_expanded(&mut ghost, st, old_body, page, None),
                                _ => activities::draw(&mut ghost, st, &m, old_body),
                            }
                        });
                    }
                }

                // Incoming content settles down from the bezel as it fades in,
                // as one layer, so its text doesn't re-hint every frame.
                let out = if content_alpha < 1.0 {
                    let grow = scale_about(pivot, CONTENT_SCALE_FROM + (1.0 - CONTENT_SCALE_FROM) * content_alpha);
                    let drop_by = if floating { pill::motion::CONTENT_DROP } else { CONTENT_DROP };
                    let xf = grow * Matrix3x2::translation(0.0, -drop_by * (1.0 - content_alpha));
                    let (input, st) = (&mut self.input, &mut self.st);
                    canvas.layered(union_rect(lay, body), content_alpha, xf, |c| draw_content(c, input, &mut hits, st, mode, lay, body, transition, now))
                } else {
                    draw_content(&mut canvas, &mut self.input, &mut hits, &mut self.st, mode, lay, body, transition, now)
                };
                wheel_left = self.input.wheel;
                if morphing {
                    canvas.pop_shape_mask();
                    canvas.unclip();
                }
                drop(canvas);
                if let Err(e) = self.gfx.end() {
                    pwarn!("EndDraw failed: {e}");
                }
                drawn_at = clock::mono();
                out
            }
            Err(e) => {
                pwarn!("begin frame failed: {e}");
                (false, false, None, false)
            }
        };
        self.hits = hits;

        // Unconsumed wheel over the header switches pages: one page per whole
        // notch, with a short cooldown so touchpads don't race through. Over
        // page content a wheel the page didn't use does nothing (a short list
        // must not jump pages where a long one would scroll).
        if let Mode::Expanded(p) = self.mode {
            let over_header = self.input.mouse.is_some_and(|m| m.y < body.y + pages::HEADER_H);
            if wheel_left != 0.0 && over_header {
                if now - self.wheel_t > 0.25 || wheel_left.signum() != self.wheel_acc.signum() {
                    self.wheel_acc = 0.0;
                }
                self.wheel_t = now;
                self.wheel_acc += wheel_left;
                if self.wheel_acc.abs() >= 1.0 && now - self.page_switch_t > 0.3 {
                    let next = pages::step_tab(p, &self.st, self.wheel_acc < 0.0);
                    self.st.cmds.push(Command::SetPage(next));
                    self.wheel_acc = 0.0;
                    self.page_switch_t = now;
                }
            }
        }
        self.input.end_frame();

        // Present. A renderer switch (GPU lost, or back) leaves the other
        // renderer's content in the window's bitmap: push the hit mask in
        // full, and redraw everything on the next frame too.
        let mut renderer_changed = self.gfx.take_renderer_changed();
        let (x, y) = (self.surface.x, self.surface.y);
        if let Err(e) = self.gfx.present(x, y) {
            pwarn!("present failed: {e}");
        }
        renderer_changed |= self.gfx.take_renderer_changed();
        if renderer_changed {
            self.mask = None;
            self.prev_canvas_px = None;
        }
        let presented_at = clock::mono();
        if self.gfx.needs_hit_mask() {
            self.update_hit_mask(now);
        }
        if let (Some(t), true) = (tick, self.motion.is_some() && self.motions_logged < 6 && self.trace.len() < 200) {
            let ms = |a: f64, b: f64| ((b - a) * 1000.0) as f32;
            self.trace.push((t.periods, [ms(t.vblank, draw_from), ms(draw_from, drawn_at), ms(drawn_at, presented_at), ms(presented_at, clock::mono())]));
        }
        if !self.shown {
            self.shown = true;
            unsafe {
                let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            self.gfx.set_shown(true);
        }

        match focus {
            Some(true) => self.focus_text(),
            Some(false) => self.blur_text(),
            None => {}
        }
        self.run_commands(deferred);
        self.paint_settings_if_dirty(deferred);

        // Decide whether to keep the frame clock running. Real motion runs
        // at the display's full refresh rate; ambient motion runs on every
        // n-th refresh (the equalizer near 60 fps, a drifting progress bar
        // near 30) and pauses while the session is locked or the display off.
        let ambient_ok = !self.locked && !self.display_off;
        let eq_live = ambient_ok && activities::is_live(&self.mode, &self.st);
        let drift_live = ambient_ok && ui_live;
        self.glass_moving = glass_moving;
        let moving = !self.island.settled()
            || anim
            || repaint
            || renderer_changed
            || glass_moving
            || !self.st.cmds.is_empty()
            || self.outgoing.is_some()
            || self.page_anim.is_some()
            || self.settings_moving();
        // The display mode's rate, not the measured period: a divisor that
        // flips between 1 and 2 would be the uneven cadence it exists to avoid.
        let hz = self.clock.nominal_hz();
        self.clock.set_divisor(if moving {
            1
        } else if eq_live {
            ambient_divisor(hz, 60.0)
        } else {
            ambient_divisor(hz, 30.0)
        });
        self.clock.set_active(moving || eq_live || drift_live);
        self.schedule_wake();
        if !self.log_queue.is_empty() {
            let lines = std::mem::take(&mut self.log_queue);
            std::thread::spawn(move || lines.iter().for_each(|l| crate::plog::write("INFO", l)));
        }
    }

    /// GPU renderer: keep the window's invisible hit mask on the island.
    /// While the outline moves it follows at [`MASK_INTERVAL`]; at rest it
    /// matches exactly.
    fn update_hit_mask(&mut self, now: f64) {
        let mask = self.hit_mask();
        let due = match &self.mask {
            None => true,
            Some((m, at)) => *m != mask && (self.island.settled() || now - at >= MASK_INTERVAL),
        };
        if !due {
            return;
        }
        let prev = self.mask.map(|(m, _)| m);
        match self.gfx.push_hit_mask(self.surface.x, self.surface.y, &mask, prev.as_ref()) {
            Ok(()) => self.mask = Some((mask, now)),
            Err(e) => {
                pwarn!("hit mask update failed: {e}");
                self.mask = None;
            }
        }
    }

    /// Track how smoothly the outline moves. The first morphs after start
    /// are logged (the CI smoke test reads them); after that only morphs
    /// that dropped frames, at most one a minute.
    fn note_motion(&mut self, retarget: bool, t: f64, period: f64, dt: f64) {
        let moving = !self.island.settled();
        if retarget || !moving {
            if let Some(mut m) = self.motion.take() {
                if !moving {
                    m.frame(t);
                }
                let early = self.motions_logged < 20;
                if m.frames >= 4 && (early || (m.hitches > 0 && t - self.hitch_logged_at > 60.0)) {
                    let dwm = match (self.dwm_at_start, dwm_counters()) {
                        (Some(a), Some(b)) => format!(", dwm {} refreshes / {} composed / {} missed", b.0.wrapping_sub(a.0), b.1.wrapping_sub(a.1), b.2.wrapping_sub(a.2)),
                        _ => String::new(),
                    };
                    self.log_queue.push(format!("{} ({}{dwm})", m.summary(), self.renderer_name()));
                    if self.motions_logged < 6 && !self.trace.is_empty() {
                        let col = |i: usize| self.trace.iter().map(|f| format!("{:.1}", f.1[i])).collect::<Vec<_>>().join(" ");
                        let periods: Vec<String> = self.trace.iter().map(|f| f.0.to_string()).collect();
                        self.log_queue.push(format!("  vblanks {}; late ms {}; draw ms {}; present ms {}; mask ms {}", periods.join(" "), col(0), col(1), col(2), col(3)));
                    }
                    self.motions_logged += 1;
                    if !early {
                        self.hitch_logged_at = t;
                    }
                }
            }
        }
        if moving {
            match self.motion.as_mut() {
                Some(m) => m.frame(t),
                None => {
                    self.motion = Some(MotionStats::begin(self.motion_name, t, period, dt));
                    self.trace.clear();
                    self.dwm_at_start = dwm_counters();
                }
            }
        }
    }

    fn renderer_name(&self) -> &'static str {
        match self.gfx.renderer() {
            crate::gfx::Renderer::Gpu { warp: false } => "gpu",
            crate::gfx::Renderer::Gpu { warp: true } => "gpu-warp",
            crate::gfx::Renderer::Software => "software",
        }
    }

    /// Wake up for the next visible change (HUD expiry, countdown second, …).
    fn schedule_wake(&mut self) {
        let now = self.st.now;
        let mut next: Option<f64> = None;
        let mut consider = |t: f64| {
            if t > now {
                next = Some(next.map_or(t, |n: f64| n.min(t)));
            }
        };
        if let Some(h) = &self.st.hud {
            consider(h.until);
        }
        if let Some(n) = &self.st.notice {
            consider(n.until);
        }
        // While hidden for a full-screen app only the phase end matters.
        let visible = !self.fullscreen_hidden;
        if let Some(b) = self.st.pomodoro.next_second_boundary(now).filter(|_| visible) {
            consider(now + b + 0.005);
        }
        if let poni_core::pomodoro::RunState::Running { ends_at } = self.st.pomodoro.run {
            consider(ends_at + 0.005);
        }
        // The music pill wakes for every sung line (in every theme), and Pill's
        // pills for their own changes; nobody sees those while the session is
        // locked or the display is off, so they rest then (the lock and
        // display events ask for a frame, which picks them up again).
        let singing = self.mode == Mode::Activity(activities::Activity::Media);
        let watched = visible && !((pill::on(self.st.settings.theme) || singing) && (self.locked || self.display_off));
        if let Some(t) = activities::next_wake(&self.mode, &self.st).filter(|_| watched) {
            consider(t);
        }
        if let Mode::Expanded(p) = self.mode {
            // A page's own changes rest while nobody is at the PC (the Prayer
            // page's countdown ticks every second); the lock and display
            // events ask for a frame, which picks them up again.
            let away = self.locked || self.display_off;
            if let Some(t) = pages::next_wake(p, &self.st).filter(|_| visible && !away) {
                consider(t + 0.005);
            }
        }
        if let Some(t) = next {
            let ms = (((t - now) * 1000.0).ceil() as u32).clamp(10, 3_600_000);
            unsafe {
                SetTimer(self.hwnd, TIMER_WAKE, ms, None);
            }
        }
    }

    fn schedule_minute_timer(&mut self) {
        let t = clock::local_now();
        let ms = (60 - t.second as u32).max(1) * 1000 + 20;
        unsafe {
            SetTimer(self.hwnd, TIMER_MINUTE, ms, None);
        }
    }

    // ------------------------------------------------------------ new versions

    /// Arm the update file's timer for the next read, or stop it while a
    /// read runs.
    fn schedule_update(&mut self) {
        let secs = self.updater.as_ref().and_then(|u| u.due_in(crate::updates::unix_now()));
        unsafe {
            match secs {
                // SetTimer waits at most about 24 days; reads are an hour apart.
                Some(s) => {
                    SetTimer(self.hwnd, TIMER_UPDATE, s.saturating_mul(1000).clamp(1000, 0x7FFF_FFFF) as u32, None);
                }
                None => {
                    let _ = KillTimer(self.hwnd, TIMER_UPDATE);
                }
            }
        }
    }

    /// The timer fired, or someone came back to the PC: read the update file
    /// if a read is due and someone is here, not on battery saver. Otherwise
    /// it waits; the lock, display and power events call this again.
    fn update_due(&mut self) {
        let now = crate::updates::unix_now();
        let away = self.locked || self.display_off || self.st.power.saver;
        match self.updater.as_ref().and_then(|u| u.due_in(now)) {
            Some(0) if away => {}
            Some(0) => self.read_update_file(now),
            _ => self.schedule_update(),
        }
    }

    /// Check for updates… (the menu): read the update file now, even on
    /// battery saver (someone asked); the answer goes on the island.
    fn check_for_updates(&mut self) {
        let now = crate::updates::unix_now();
        if self.updater.as_mut().is_some_and(|u| u.ask(now)) {
            self.read_update_file(now);
        }
        self.request_frame();
    }

    /// Read the update file on the add-on thread; the answer comes back as
    /// `UpdateEvent::Checked`.
    fn read_update_file(&mut self, now: u64) {
        let job = services::update::check_job(self.sink.clone());
        let started = self.services.as_ref().is_some_and(|s| s.run_job(job));
        if let Some(u) = self.updater.as_mut() {
            u.begin();
            if !started {
                u.checked(&mut self.st, Err("the add-on thread isn't running".into()), now);
                self.schedule_update();
            }
        }
    }

    /// The offered version's Setup, once per release, on the add-on thread
    /// (after a look at the file, and at start for one already offered).
    fn fetch_setup(&mut self) {
        let Some((d, path)) = self.updater.as_mut().and_then(|u| u.want_setup(&mut self.st)) else { return };
        let job = services::update::download_job(self.sink.clone(), d, path);
        if !self.services.as_ref().is_some_and(|s| s.run_job(job)) && self.updater.as_mut().is_some_and(|u| u.fetched(&mut self.st, Err("the add-on thread isn't running".into()))) {
            self.expand();
        }
    }

    /// Install now (the Update sheet): run the downloaded Setup, which
    /// closes this copy and opens the new version, and quit (saving, as on
    /// any quit). Without one it opens the release's page.
    fn update_now(&mut self) {
        if let Some((setup, d)) = self.updater.as_ref().and_then(|u| u.ready_setup(&self.st)) {
            match services::update::install(&setup, &d) {
                Ok(()) => {
                    pinfo!("updates: installing {}", d.file_name());
                    self.quit(0);
                    return;
                }
                Err(e) => pwarn!("updates: couldn't run the Setup ({e}); opening the release page"),
            }
        }
        if let Some(url) = self.updater.as_ref().and_then(|u| u.download_page(&self.st)) {
            pinfo!("updates: opening {url}");
            shell::open(&url);
        }
    }

    /// Run a notice's inline action in place (the island stays collapsed),
    /// then show a check mark in the pill briefly before the notice leaves.
    fn run_inline_action(&mut self, a: InlineAction) {
        self.refresh_time();
        if a == InlineAction::Open {
            // Another app's notification: that app opens and the notice goes.
            if let Some(Notice { action: Some(NoticeAction::OpenApp(id)), .. }) = self.st.notice.take() {
                shell::open_app(&id);
            }
            return;
        }
        if a == InlineAction::Translate {
            // Flip translation for the running captions and say what they do now; the notice stays.
            self.st.settings.translate_captions = !self.st.settings.translate_captions;
            if self.st.capture.running() {
                self.set_captions(true);
            } else {
                self.save_settings();
            }
            self.captions_notice();
            return;
        }
        if a == InlineAction::StopAdzan {
            self.adzan.stop();
            self.st.prayer.adzan = false;
        }
        if a == InlineAction::Hide {
            // Gone at once, the way a notice leaves when its time is up.
            if let Some(n) = self.st.notice.as_mut() {
                n.until = self.st.now;
            }
            // A new version's: it doesn't come back.
            if let Some(u) = self.updater.as_mut() {
                u.seen(&mut self.st);
            }
            return;
        }
        if a == InlineAction::WhatsNew && self.st.notice.as_ref().is_some_and(|n| n.icon != Icon::Check) {
            shell::open(&crate::version::notes_url());
        }
        let st = &mut self.st;
        // Already done: the check mark is showing.
        if st.notice.as_ref().is_none_or(|n| n.icon == Icon::Check) {
            return;
        }
        if a == InlineAction::ShowAmount {
            // The sum and sender take the subtitle's place for a few seconds; the
            // pill turns into a check (activities.rs inline_done).
            let until = st.now + SHOWN_S;
            if let Some(n) = st.notice.as_mut() {
                if let Some(text) = n.reveal.take() {
                    n.subtitle = text;
                    n.until = n.until.max(until);
                }
            }
            return;
        }
        match a {
            InlineAction::StartFocus => st.pomodoro.start(st.now),
            InlineAction::ShowAmount | InlineAction::StopAdzan | InlineAction::Hide | InlineAction::WhatsNew | InlineAction::Open | InlineAction::Translate => {}
        }
        let until = st.now + INLINE_DONE_S;
        if let Some(n) = st.notice.as_mut() {
            n.icon = Icon::Check;
            n.until = until;
        }
        pinfo!("notice: inline action {a:?} done");
    }

    /// A Calendar page request: the engine does the work; the answer comes back as an event.
    fn calendar_cmd(&mut self, c: CalendarCmd) {
        use poni_core::calendar::{self as cal, Req};
        let req = match c {
            CalendarCmd::PasteLink => match services::clipboard::read_text(self.hwnd).as_deref().and_then(cal::looks_like_link) {
                Some(u) => {
                    // The engine reads the whole calendar before it answers; say so instead of looking idle.
                    self.st.helper_notice = Some(("Reading your calendar. A large one can take up to a minute.".into(), self.st.now + 60.0, false));
                    Req::Link(u.to_string())
                }
                None => {
                    self.st.helper_notice = Some(("Copy your calendar link first, then press Paste link.".into(), self.st.now + 5.0, true));
                    return;
                }
            },
            CalendarCmd::Remove(id) => Req::Remove(id),
            CalendarCmd::Refresh => Req::Refresh,
            CalendarCmd::Notes(event) => Req::Notes { event, tz_minutes: cal::utc_offset(&self.st.local, self.st.unix) / 60 },
        };
        if let Some(s) = &self.services {
            s.calendar(req);
        }
    }

    /// The pill says "Standup in 5 min" once, when the calendar answer shows a
    /// meeting about to start (`poni_core::calendar::soon`).
    fn calendar_heads_up(&mut self) {
        let Some(s) = self.st.helper.calendar.as_ref().and_then(|c| poni_core::calendar::soon(c, self.st.unix)) else { return };
        if self.st.calendar_pinged.as_deref() == Some(s.event.id.as_str()) {
            return;
        }
        let (id, title) = (s.event.id.clone(), poni_core::calendar::soon_text(&s));
        self.st.calendar_pinged = Some(id);
        let accent = self.st.accent;
        self.st.notify(Icon::Calendar, accent, title, "Open Calendar", 8.0, Some(NoticeAction::OpenPage(PageKind::Calendar)));
    }

    /// Import the first dropped `.ics` file (at most [`ICS_MAX_BYTES`]).
    fn import_ics(&mut self, paths: &[String]) {
        use poni_core::calendar::{self as cal, Req};
        let Some(path) = paths.iter().find(|p| cal::is_ics_path(p)) else { return };
        let read = std::fs::metadata(path).ok().filter(|m| m.len() <= ICS_MAX_BYTES).and_then(|_| std::fs::read(path).ok());
        let Some(ics) = read.and_then(|b| String::from_utf8(b).ok()) else {
            self.st.helper_notice = Some(("That file is not a calendar this size can read (.ics, up to 5 MB).".into(), self.st.now + 6.0, true));
            return;
        };
        let name = std::path::Path::new(path).file_name().map_or_else(|| "calendar.ics".into(), |n| n.to_string_lossy().into_owned());
        if let Some(s) = &self.services {
            s.calendar(Req::File { ics, name });
        }
    }

    /// Open the island on page `p` (the menu's entries for our own pages).
    fn open_page(&mut self, p: PageKind) {
        self.set_page(p);
        self.expand();
    }

    // ------------------------------------------------------------ prayer times

    /// Prayer times' files are in place: read its places, settle the place,
    /// and ask where the PC is when following the location.
    fn prayer_ready(&mut self) {
        let a = &poni_core::addons::PRAYER_TIMES;
        let path = paths::addons_dir().join(a.id).join(a.tag).join("places.json");
        match std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| PlaceList::parse(&t)) {
            Ok(list) => {
                pinfo!("prayer: {} places", list.places.len());
                self.st.prayer.places = Some(std::sync::Arc::new(list));
            }
            Err(e) => {
                pwarn!("prayer: can't read the places ({e})");
                return;
            }
        }
        self.resolve_prayer_place();
        if self.st.settings.prayer.follow_location {
            self.locate();
        }
    }

    /// Prayer times switched off: nothing plays, nothing is kept.
    fn prayer_off(&mut self) {
        self.adzan.stop();
        self.st.prayer = PrayerState::default();
    }

    /// The place the times are for: the chosen one, or until there is one,
    /// the one the PC's time zone suggests. A place from the world list is
    /// kept as it is once settled; at start it comes from the lines settings
    /// keep of it (nothing online).
    fn resolve_prayer_place(&mut self) {
        let Some(list) = self.st.prayer.places.clone() else { return };
        let chosen = match self.st.settings.prayer.place.as_deref() {
            Some(id) if self.st.prayer.place.as_ref().is_some_and(|p| p.id == id) => self.st.prayer.place.clone(),
            Some(id) => poni_core::prayer::find(&list, self.st.settings.prayer.world_place.as_deref(), id),
            None => None,
        };
        let suggested = chosen.is_none();
        let place = chosen.or_else(|| poni_core::prayer::suggested_place_id(self.utc_offset_min()).and_then(|id| list.find(id)).cloned());
        let changed = place.as_ref().map(|p| &p.id) != self.st.prayer.place.as_ref().map(|p| &p.id);
        self.st.prayer.place = place;
        self.st.prayer.suggested = suggested;
        if changed {
            pinfo!("prayer: times for {}", self.st.prayer.place.as_ref().map_or("no place", |p| p.id.as_str()));
            // A new place: prayer times that passed there don't ring now.
            self.st.prayer.handled_until = Some(self.st.prayer_now());
        }
    }

    /// The PC's UTC offset in minutes, from its clock.
    fn utc_offset_min(&self) -> i32 {
        let l = &self.st.local;
        let local = poni_core::datetime::days_from_civil(l.year, l.month, l.day) * 86_400 + l.hour as i64 * 3600 + l.minute as i64 * 60 + l.second as i64;
        (((local - self.st.unix) as f64 / 900.0).round() * 15.0) as i32
    }

    /// Ask Windows where the PC is (the answer: `AppEvent::Located`).
    fn locate(&mut self) {
        if self.st.prayer.locate == Locate::Asking || false {
            return;
        }
        self.st.prayer.locate = Locate::Asking;
        self.st.prayer.located_at = Some(self.st.unix);
        services::location::locate(self.sink.clone());
    }

    /// The nearest listed place becomes the place, while following the
    /// location (`pages::prayer::located`). The point is never saved.
    fn on_located(&mut self, found: services::location::Located) {
        use services::location::Located;
        match found {
            Located::Denied => self.st.prayer.locate = Locate::Denied,
            Located::Unknown => self.st.prayer.locate = Locate::Unknown,
            // Kemenag's places, or the world's cities around it (looked up online).
            Located::At(lat, lng) => pages::prayer::located(&mut self.st, lat, lng),
        }
    }

    /// Each frame (and each minute): the prayer times that just came, and
    /// asking where the PC is again every 3 hours while following it.
    fn prayer_tick(&mut self) {
        if !self.st.prayer_on() {
            return;
        }
        if self.st.settings.prayer.follow_location && self.st.prayer.located_at.is_none_or(|t| self.st.unix - t >= 3 * 3600) {
            self.locate();
        }
        let Some(site) = self.st.prayer.site() else { return };
        let now = self.st.prayer_now();
        let Some(from) = self.st.prayer.handled_until else {
            self.st.prayer.handled_until = Some(now);
            return;
        };
        if now <= from {
            return;
        }
        self.st.prayer.handled_until = Some(now);
        for m in poni_core::prayer::prayers_between(&site, from, now) {
            match poni_core::prayer::due(m.at, now) {
                Due::Ring => self.prayer_moment(m, true),
                Due::Quiet => self.prayer_moment(m, false),
                Due::Skip => {}
            }
        }
    }

    /// A prayer's time came: the island says so and plays the chosen sound.
    /// Quiet when it's late (after a sleep) or a full-screen app hides the island.
    fn prayer_moment(&mut self, m: PrayerMoment, ring: bool) {
        let Some(site) = self.st.prayer.site() else { return };
        let place = self.st.prayer.place.as_ref().map_or(String::new(), |p| p.label.clone());
        let quiet = !ring || self.fullscreen_hidden;
        let sound = if quiet { PrayerSound::Silent } else { self.st.settings.prayer.sound };
        let mut adzan = false;
        match sound {
            // The recording isn't Subuh's adzan (no "ash-shalatu khairum minan naum"): Subuh gets the tone.
            PrayerSound::Adzan if m.prayer != Prayer::Subuh => {
                adzan = self.play_adzan();
                if !adzan {
                    self.st.cmd(Command::Play(crate::commands::Sound::Chime));
                }
            }
            PrayerSound::Adzan | PrayerSound::Tone => self.st.cmd(Command::Play(crate::commands::Sound::Chime)),
            PrayerSound::Silent => {}
        }
        let title = pages::prayer::moment_title(m.prayer);
        let subtitle = format!("{} \u{b7} {place}", site.hhmm(m.at));
        let secs = if adzan { 200.0 } else { 60.0 };
        self.st.notify(Icon::Moon, self.st.accent, title, subtitle, secs, Some(NoticeAction::OpenPage(PageKind::Prayer)));
        if adzan {
            self.st.set_notice_inline(InlineAction::StopAdzan);
        }
        pinfo!("prayer: {} at {}{}", m.prayer.name(), site.hhmm(m.at), if quiet { ", quietly" } else { "" });
    }

    /// Start the adzan; music that plays pauses (and stays paused).
    fn play_adzan(&mut self) -> bool {
        let a = &poni_core::addons::PRAYER_TIMES;
        let path = paths::addons_dir().join(a.id).join(a.tag).join("adzan.m4a");
        match self.adzan.play(&path, &self.sink) {
            Ok(()) => {
                self.st.prayer.adzan = true;
                if self.st.settings.prayer.pause_music && self.st.media.as_ref().is_some_and(|m| m.is_playing()) {
                    self.st.media_cmd(MediaCmd::PlayPause);
                }
                true
            }
            Err(e) => {
                pwarn!("prayer: the adzan didn't play ({e}); the tone instead");
                false
            }
        }
    }

    /// OK on the countdown before a prayer: the closed island goes back to
    /// what it would show (the song and its sung line) until the prayer's
    /// time. Its moment still comes then: `prayer_tick` doesn't look at the
    /// countdown.
    fn prayer_countdown_ok(&mut self) {
        self.refresh_time();
        if let (Some(m), Some(site)) = (self.st.prayer_countdown_ok(), self.st.prayer.site()) {
            pinfo!("prayer: countdown put away until {} at {}", m.prayer.name(), site.hhmm(m.at));
        }
    }

    // ------------------------------------------------------------ IELTS

    /// The IELTS page's coach, each frame: told when the page comes and goes
    /// (a tab switch, the island closing, the PC locked or the display off,
    /// a full-screen app), ticked for its clock, fed the microphone's level.
    /// The worker goes once the page is closed and nothing is in flight.
    fn adzan_ended(&mut self) {
        self.adzan.stop();
        self.st.prayer.adzan = false;
        // The notice leaves soon after the adzan.
        let soon = self.st.now + 4.0;
        if let Some(n) = self.st.notice.as_mut().filter(|n| n.inline == Some(InlineAction::StopAdzan)) {
            n.until = n.until.min(soon);
        }
    }

    fn set_page(&mut self, p: PageKind) {
        if p != self.st.page {
            self.st.page = p;
            self.st.ui.addon_about = None;
            // Settings is never where the island opens next time.
            if p != PageKind::Settings {
                self.st.update.sheet = false;
                self.st.update.said = None;
                self.st.store.last_page = p.key().to_string();
                unsafe {
                    SetTimer(self.hwnd, TIMER_SAVE, 800, None);
                }
            } else {
                crate::autostart::report(self.sink.clone(), None);
            }
            self.set_sysmon(matches!(p, PageKind::System | PageKind::Engine) && self.expanded);
            if self.text_focus {
                self.blur_text();
            }
            if p == PageKind::Notifications {
                self.notify_cmd(NotifyCmd::Check);
            }
        }
    }

    fn run_commands(&mut self, deferred: &mut Vec<Deferred>) {
        let cmds = std::mem::take(&mut self.st.cmds);
        for c in cmds {
            match c {
                Command::Media(m) => {
                    if let Some(s) = self.services.as_ref() {
                        s.media_cmd(m.clone());
                    }
                    // Optimistic UI for play/pause.
                    if m == MediaCmd::PlayPause {
                        if let Some(ms) = self.st.media.as_mut() {
                            let now = self.st.now;
                            let pos = ms.timeline.position_at(now);
                            ms.timeline.position_s = pos;
                            ms.timeline.sampled_at = now;
                            ms.timeline.playing = !ms.timeline.playing;
                            // The player's confirmation will match this, so
                            // start (or end) the pause grace period here.
                            self.st.media_paused_at = (!ms.timeline.playing).then_some(now);
                        }
                    }
                }
                Command::OpenPath(p) => shell::open(&p),
                Command::RevealPath(p) => shell::reveal(&p),
                Command::DragOut(paths) => deferred.push(Deferred::DragOut(paths)),
                Command::LoadThumb(p) => {
                    if !self.st.shelf_thumbs.contains_key(&p) {
                        self.st.shelf_thumbs.insert(p.clone(), None);
                        services::imaging::load_thumb_async(p, self.sink.clone());
                    }
                }
                Command::FocusText => self.focus_text(),
                Command::BlurText => self.blur_text(),
                Command::ScriptPaste => {
                    // Read here, not through the text field path: that one drops line breaks.
                    let text = services::clipboard::read_text(self.hwnd).map(|t| poni_core::script::clean(&t)).filter(|t| !t.is_empty());
                    match text {
                        Some(text) => pages::script::set_text(&mut self.st, text),
                        None => pages::script::note(&mut self.st, "Copy your script first"),
                    }
                }
                Command::SaveSettings => {
                    let before = self.saved_settings.clone();
                    self.settings_changed(&before);
                    self.save_settings();
                }
                Command::OpenSettings => self.show_settings(deferred),
                Command::SaveStore => unsafe {
                    SetTimer(self.hwnd, TIMER_SAVE, 800, None);
                },
                Command::SetPage(p) => self.set_page(p),
                Command::Menu(c) => self.on_menu(c),
                Command::OpenSystem(m) => {
                    self.st.ui.system_module = m;
                    self.set_page(PageKind::System);
                }
                Command::CheckFps => self.check_fps(),
                Command::AllowFps => {
                    // The island takes the focus for Windows' prompt (a
                    // background app's prompt waits in the taskbar), as for typing.
                    self.focus_text();
                    self.st.game.access = FpsAccess::Asking;
                    services::frames::request_access(self.sink.clone(), SendHwnd::new(self.hwnd));
                }
                Command::LoadAppIcon(path) => {
                    if !self.st.app_icons.contains_key(&path) {
                        self.st.app_icons.insert(path.clone(), None);
                        self.icon_wait.insert(path.clone());
                        services::imaging::load_thumb_async(path, self.sink.clone());
                    }
                }
                Command::SetPinned(b) => {
                    self.st.pinned = b;
                    if !b {
                        self.maybe_schedule_collapse();
                    }
                }
                Command::Collapse => self.collapse(),
                Command::Play(s) => services::sound::play(s),
                Command::OpenUrl(u) => shell::open(&u),
                Command::Update => self.update_now(),
                Command::CheckForUpdates => self.check_for_updates(),
                Command::InstallOnNextStart => {
                    if let Some(u) = self.updater.as_mut() {
                        u.install_on_next_start(&mut self.st);
                    }
                }
                Command::WantStats(b) => self.set_stats(b),
                Command::SetAutostart(on) => {
                    self.st.ui.autostart = Some(on);
                    crate::autostart::report(self.sink.clone(), Some(on));
                }
                Command::Phone(c) => self.phone_cmd(c),
                Command::Pair(c) => self.pair_cmd(c),
                // The self-test's pictures use the files it seeds (none from the website).
                Command::GetCities(file) => {
                    if true {
                        services::cities::fetch(file, self.sink.clone());
                    }
                }
                Command::Download(c) => self.download_cmd(c),
                Command::Notify(c) => self.notify_cmd(c),
                Command::WinLang(c) => self.winlang_cmd(c),
                Command::HelperPost(body) => {
                    if let Some(s) = self.services.as_ref() {
                        s.helper_post(body);
                    }
                }
                Command::HelperPoll => {
                    if let Some(s) = self.services.as_ref() {
                        s.engine_start(); // Try again also starts the engine
                        s.helper_poll();
                    }
                }
                Command::Calendar(c) => self.calendar_cmd(c),
                Command::Captions(on) => self.captions_by_hand(on),
                Command::PasteTranscript => self.paste_transcript(),
                Command::JoinMeeting(u) => match poni_core::calendar::teams_app_link(&u).filter(|_| crate::window::url_scheme_registered("msteams")) {
                    Some(app) => shell::open_teams(&app, &u),
                    None => shell::open(&u),
                },
                Command::ModelsRefresh => self.refresh_models(),
                Command::ModelPull(k) => self.pull_model(k),
                Command::ModelSelect(k, id) => self.select_model(k, id),
                Command::ModelFolder(k) => self.place_model(k, true),
                Command::ModelFolderReset(k) => self.place_model(k, false),
            }
        }
        self.sync_phone_offer();
        self.sync_pair_offer();
    }

    // ------------------------------------------------------------ notifications

    fn winlang_cmd(&mut self, c: WinLangCmd) {
        match c {
            WinLangCmd::Install(id) => {
                // Only a feature of the fixed list, and not while one is running or already there.
                let Some(f) = poni_core::winlang::by_id(id).filter(|_| self.st.winlang_state(id).can_install()) else {
                    return;
                };
                self.st.set_winlang(f.id, poni_core::winlang::State::Installing);
                services::winlang::install(f, self.sink.clone());
            }
            WinLangCmd::Check => services::winlang::check(self.sink.clone()),
            WinLangCmd::OpenSettings => shell::open_language_settings(),
        }
    }

    /// A Windows language feature was looked at or added. One that came in
    /// reads the song that asked for it again (its lyrics come from the cache).
    fn on_winlang(&mut self, id: &'static str, state: poni_core::winlang::State) {
        let before = self.st.winlang_state(id);
        // A check that began before the install and ended during it knows nothing new.
        if before == poni_core::winlang::State::Installing && matches!(state, poni_core::winlang::State::Missing | poni_core::winlang::State::Unknown) {
            return;
        }
        let came = state == poni_core::winlang::State::Installed && before != state;
        if let poni_core::winlang::State::Failed(why) = &state {
            self.st.notify(Icon::Sliders, palette::ORANGE, "Couldn't add the Windows language feature", why, 6.0, None);
        }
        self.st.set_winlang(id, state);
        if came && id == poni_core::winlang::JAPANESE_TYPING.id && self.st.lyrics.wants_ja_readings {
            if let (Some(svc), Some(m)) = (self.services.as_ref(), self.st.media.as_ref()) {
                if m.track_key == self.st.lyrics.track_key {
                    pinfo!("lyrics: Windows reads Japanese now; reading the song again");
                    svc.request_lyrics(m);
                }
            }
        }
    }

    /// Notifications came on (`ask`: by its chip in Settings' tabs row, so
    /// Windows' question comes now) or the app started with it on.
    fn start_notify(&mut self, ask: bool) {
        self.st.notify_access = NotifyAccess::Unknown;
        if self.notify.is_none() {
            self.notify = services::notifications::Listener::start(self.sink.clone(), ask);
        }
    }

    /// Off: stop listening (dropping the listener stops it).
    fn stop_notify(&mut self) {
        self.notify = None;
        self.st.notify_access = NotifyAccess::Unknown;
    }

    fn notify_cmd(&mut self, c: NotifyCmd) {
        match c {
            NotifyCmd::Ask => {
                if let Some(l) = self.notify.as_mut() {
                    l.ask();
                }
            }
            NotifyCmd::Check => {
                if let Some(l) = self.notify.as_mut() {
                    l.check();
                }
            }
            NotifyCmd::OpenWindowsSettings => shell::open_notification_settings(),
        }
    }

    fn on_notify(&mut self, ev: NotifyEvent) {
        if !self.st.notifications_on() {
            return;
        }
        match ev {
            NotifyEvent::Access(a) => {
                self.st.notify_access = a;
                if let Some(l) = self.notify.as_mut() {
                    l.follow(a);
                }
            }
            NotifyEvent::Apps(apps) => {
                let mut changed = false;
                for (id, name) in apps {
                    changed |= self.st.settings.notifications.remember(&id, &name).1;
                }
                if changed {
                    self.st.cmd(Command::SaveSettings);
                }
            }
            NotifyEvent::Seen(seen) => {
                let (shows, changed) = self.st.settings.notifications.remember(&seen.app_id, &seen.app);
                if changed {
                    self.st.cmd(Command::SaveSettings);
                }
                // Nobody would see it: Windows keeps it in its own list.
                if !shows || self.locked || self.display_off {
                    return;
                }
                if let Some(n) = pages::notifications::message_notice(&seen, &self.st.settings.notifications, self.st.accent, self.st.now) {
                    self.st.show_or_hold(n, self.fullscreen_hidden);
                }
            }
        }
    }

    // ------------------------------------------------------------ phone drop

    /// The QR code waits for a phone, or a phone waits for an answer (Shelf
    /// page only), or a reading is under way (Script page only).
    fn phone_holds(&self) -> bool {
        self.st.page_holds_island()
    }

    fn phone_cmd(&mut self, c: PhoneCmd) {
        match c {
            PhoneCmd::Open => self.open_phone(),
            PhoneCmd::Close => self.close_phone(),
            PhoneCmd::Answer { id, accept } => {
                if let Some(svc) = &self.phone {
                    svc.answer(id, accept);
                }
                let until = self.st.now + pages::shelf::PHONE_OUTCOME_S;
                if let Some(pd) = self.st.phone.as_mut() {
                    if let Some(a) = pd.ask.take_if(|a| a.id == id) {
                        if accept {
                            pd.transfer = Some(PhoneTransfer { id, from: a.from, file: 0, files: a.files.len(), done: 0, total: a.total });
                        } else {
                            pd.outcome = Some((format!("Declined {} from {}", files_label(a.files.len()), a.from), false, until));
                        }
                    }
                }
                self.maybe_schedule_collapse();
            }
        }
    }

    fn open_phone(&mut self) {
        if let Some(old) = self.phone.take() {
            old.stop();
        }
        let mut pd = PhoneDrop::default();
        if false {
            pd.error = Some("Phone drop is off in the self-test.".into());
        } else {
            let offer = self.st.store.shelf.paths();
            match services::phonedrop::PhoneDrop::start(self.sink.clone(), offer.iter().map(PathBuf::from).collect()) {
                Ok((svc, url)) => {
                    pd.qr = QrMatrix::encode(&url);
                    pd.url = url;
                    self.phone_offer = offer;
                    self.phone = Some(svc);
                }
                Err(e) => {
                    pwarn!("phone drop: {e}");
                    pd.error = Some(e);
                }
            }
        }
        self.st.phone = Some(pd);
        self.st.page = PageKind::Shelf;
        self.expand();
    }

    fn close_phone(&mut self) {
        if let Some(svc) = self.phone.take() {
            svc.stop();
        }
        if matches!(self.st.phone.as_ref().map(|p| &p.view), Some(PhoneView::Pairing { .. })) {
            if let Some(s) = &self.services {
                s.pair_cancel();
            }
        }
        self.st.phone = None;
        self.phone_offer.clear();
        self.maybe_schedule_collapse();
        self.request_frame();
    }

    /// Minute tick: nobody has used the link for a while, so close it.
    fn close_idle_phone(&mut self) {
        let idle = self.phone.as_ref().is_some_and(|svc| !svc.busy() && svc.idle_secs() >= PHONE_IDLE_S);
        let quiet = self.st.phone.as_ref().is_some_and(|p| p.ask.is_none() && p.transfer.is_none());
        if idle && quiet {
            pinfo!("phone drop: closed after {:.0} minutes without a phone", PHONE_IDLE_S / 60.0);
            self.close_phone();
        }
    }

    /// Keep the files a phone can save in step with the Shelf.
    fn sync_phone_offer(&mut self) {
        let Some(svc) = &self.phone else { return };
        let paths = self.st.store.shelf.paths();
        if paths != self.phone_offer {
            svc.set_offer(paths.iter().map(PathBuf::from).collect());
            self.phone_offer = paths;
        }
    }

    fn on_phone(&mut self, e: PhoneEvent) {
        let now = self.st.now;
        let until = now + pages::shelf::PHONE_OUTCOME_S;
        let Some(pd) = self.st.phone.as_mut() else { return };
        match e {
            PhoneEvent::Visit { from } => {
                pd.visitor = Some(from);
                self.maybe_schedule_collapse();
            }
            PhoneEvent::Ask(a) => {
                pd.outcome = None;
                pd.visitor.get_or_insert_with(|| a.from.clone());
                let files: Vec<(String, u64)> = a.files.iter().map(|f| (f.name.clone(), f.size)).collect();
                pinfo!("phone drop: {} asks to send {}", a.from, files_label(files.len()));
                pd.ask = Some(PhoneAsk { id: a.id, from: a.from.clone(), total: a.total(), files });
                self.st.page = PageKind::Shelf;
                self.expand();
                self.st.chime();
            }
            PhoneEvent::AskEnded { id } => {
                if let Some(a) = pd.ask.take_if(|a| a.id == id) {
                    pd.outcome = Some((format!("{} stopped waiting", a.from), false, until));
                }
                self.maybe_schedule_collapse();
            }
            PhoneEvent::Progress { id, file, files, done, total } => match pd.transfer.as_mut() {
                Some(t) if t.id == id => {
                    t.file = file;
                    t.files = files;
                    t.done = done;
                    t.total = total;
                }
                _ => {
                    let from = pd.visitor.clone().unwrap_or_else(|| "Phone".into());
                    pd.transfer = Some(PhoneTransfer { id, from, file, files, done, total });
                }
            },
            PhoneEvent::Received { from, paths, .. } => {
                pd.transfer = None;
                let n = paths.len();
                let title = format!("{} from {from} {} on the Shelf", files_label(n), if n == 1 { "is" } else { "are" });
                pd.outcome = Some((title.clone(), true, until));
                let added: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                self.st.store.shelf.add_paths(&added, self.st.unix);
                for p in added {
                    self.st.cmds.push(Command::LoadThumb(p));
                }
                self.st.save();
                pinfo!("phone drop: {} from {from}", files_label(n));
                if !self.expanded {
                    self.st.notify(Icon::Phone, palette::GREEN, title, "Open the Shelf to see them", 6.0, Some(NoticeAction::OpenPage(PageKind::Shelf)));
                }
                self.st.chime();
                self.maybe_schedule_collapse();
            }
            PhoneEvent::Failed { from, reason, detail, .. } => {
                pd.transfer = None;
                pd.outcome = Some((format!("Nothing kept from {from}. {reason}."), false, until));
                pwarn!("phone drop: transfer from {from} failed: {reason} {detail}");
                self.maybe_schedule_collapse();
            }
        }
    }

    // ------------------------------------------------------------ paired phones

    fn pair_cmd(&mut self, c: PairCmd) {
        let now = self.st.now;
        match c {
            PairCmd::Begin => {
                let r = match &self.services {
                    Some(s) => s.pair_begin(),
                    None => Err("Pairing is off in the self-test.".into()),
                };
                let Some(pd) = self.st.phone.as_mut() else { return };
                pd.outcome = None;
                match r {
                    Ok(url) => {
                        pinfo!("pair drop: showing a pairing code");
                        pd.view = PhoneView::Pairing { qr: QrMatrix::encode(&url), url, until: now + poni_core::pairdrop::meet::PAIRING_FOR.as_secs_f64() };
                    }
                    Err(e) => {
                        pwarn!("pair drop: {e}");
                        pd.outcome = Some((e, false, now + pages::shelf::PHONE_OUTCOME_S));
                    }
                }
            }
            PairCmd::Back => {
                if matches!(self.st.phone.as_ref().map(|p| &p.view), Some(PhoneView::Pairing { .. })) {
                    if let Some(s) = &self.services {
                        s.pair_cancel();
                    }
                }
                if let Some(pd) = self.st.phone.as_mut() {
                    pd.view = PhoneView::Lan;
                }
            }
            PairCmd::List => {
                if matches!(self.st.phone.as_ref().map(|p| &p.view), Some(PhoneView::Pairing { .. })) {
                    if let Some(s) = &self.services {
                        s.pair_cancel();
                    }
                }
                if let Some(pd) = self.st.phone.as_mut() {
                    pd.view = PhoneView::Paired;
                }
            }
            PairCmd::Remove(room) => {
                if let Some(s) = &self.services {
                    s.pair_remove(&room);
                }
                if let Some(i) = self.st.paired.iter().position(|p| p.room == room) {
                    let p = self.st.paired.remove(i);
                    pinfo!("pair drop: removed a paired phone");
                    if let Some(pd) = self.st.phone.as_mut() {
                        pd.outcome = Some((format!("{} can't send to this PC any more", p.name), false, now + pages::shelf::PHONE_OUTCOME_S));
                        pd.outcome_line = Some("Pair it again any time from Pair a phone.".into());
                    }
                }
            }
        }
        self.request_frame();
    }

    /// Keep the files paired phones may save in step with the Shelf.
    fn sync_pair_offer(&mut self) {
        let Some(svc) = &self.services else { return };
        let paths = self.st.store.shelf.paths();
        if self.pair_offer.as_ref() != Some(&paths) {
            svc.pair_shelf(paths.iter().map(PathBuf::from).collect());
            self.pair_offer = Some(paths);
        }
    }

    fn on_paired(&mut self, e: MeetEvent) {
        let now = self.st.now;
        let until = now + pages::shelf::PHONE_OUTCOME_S;
        match e {
            MeetEvent::Pairs(list) => self.st.paired = paired_phones(list),
            MeetEvent::Server { reachable } => {
                if self.st.pair_server.is_some() || !reachable {
                    pinfo!("pair drop: meeting server {}", if reachable { "reachable again" } else { "unreachable" });
                }
                self.st.pair_server = Some(reachable);
            }
            MeetEvent::Paired { name, .. } => {
                pinfo!("pair drop: a phone finished pairing");
                if let Some(pd) = self.st.phone.as_mut() {
                    pd.view = PhoneView::Lan;
                    pd.outcome = Some((format!("{name} is paired"), true, until));
                    pd.outcome_line = Some("It can now send from any network, even with this panel closed.".into());
                }
                if !self.hovering {
                    // The island closes now that nothing waits: say it on the pill.
                    self.st.notify(Icon::Phone, palette::GREEN, format!("{name} is paired"), "It can send from any network now", 6.0, Some(NoticeAction::OpenPage(PageKind::Shelf)));
                }
                self.st.chime();
                self.maybe_schedule_collapse();
            }
            MeetEvent::Phone { phone, ev, .. } => match ev {
                PeerEvent::Hello { .. } => pinfo!("pair drop: a paired phone connected"),
                PeerEvent::Progress { files, done: 0, .. } => {
                    if !self.expanded {
                        self.st.notify(Icon::Phone, palette::GREEN, format!("{phone} is sending {}", files_label(files)), "They go straight onto the Shelf", 4.0, None);
                    }
                }
                PeerEvent::Progress { .. } => {}
                PeerEvent::Received { paths } => {
                    let n = paths.len();
                    let title = format!("{} from {phone} {} on the Shelf", files_label(n), if n == 1 { "is" } else { "are" });
                    let added: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    self.st.store.shelf.add_paths(&added, self.st.unix);
                    for p in added {
                        self.st.cmds.push(Command::LoadThumb(p));
                    }
                    self.st.save();
                    pinfo!("pair drop: {} from a paired phone", files_label(n));
                    if let Some(pd) = self.st.phone.as_mut() {
                        pd.outcome = Some((title.clone(), true, until));
                        pd.outcome_line = None;
                    }
                    if !self.expanded {
                        self.st.notify(Icon::Phone, palette::GREEN, title, "Open the Shelf to see them", 6.0, Some(NoticeAction::OpenPage(PageKind::Shelf)));
                    }
                    self.st.chime();
                    self.maybe_schedule_collapse();
                }
                PeerEvent::Failed { reason, detail } => {
                    pwarn!("pair drop: a send from a paired phone failed: {reason} {detail}");
                    if !self.expanded {
                        self.st.notify(Icon::Phone, palette::TEXT, format!("Nothing kept from {phone}"), format!("{reason}."), 6.0, None);
                    } else if let Some(pd) = self.st.phone.as_mut() {
                        pd.outcome = Some((format!("Nothing kept from {phone}. {reason}."), false, until));
                        pd.outcome_line = None;
                    }
                }
                PeerEvent::Ended { .. } => {}
            },
        }
        self.request_frame();
    }

    fn save_now(&mut self) {
        if !self.store_writable {
            pwarn!("data.json couldn't be read at start; not overwriting it");
            return;
        }
        if let Err(e) = save_json_atomic(&paths::store_path(), &self.st.store) {
            pwarn!("saving data failed: {e}");
        }
    }

    // ------------------------------------------------------------ self-test hooks

    /// Self-test only: render as if the monitor had `dpi` (120 = 125 %, 144 = 150 %, 192 = 200 %).
    pub fn settings_window_open(&self) -> bool {
        self.settings_win.is_some()
    }

    /// The Settings window on `section`, light or dark, opened if it isn't:
    /// its pixels (premultiplied BGRA) and their size.
    pub fn island_body(&self) -> Rect {
        self.island.body_rect_at(self.cx)
    }

    /// The island body relative to the last captured frame (DIPs).
    pub fn scale(&self) -> f32 {
        self.gfx.scale()
    }

    pub fn hwnd(&self) -> HWND {
        self.hwnd
    }
}

/// Windows' accent colour for the theme.
fn theme_accent(theme: Theme) -> Color {
    if theme == Theme::Glass {
        services::system_accent_base().unwrap_or(palette::BLUE)
    } else {
        services::system_accent().unwrap_or(palette::BLUE)
    }
}

/// The island's current content: a page (expanded) or the collapsed activity.
/// Returns (repaint, anim, focus, live) as requested by the drawing code.
#[allow(clippy::too_many_arguments)]
fn draw_content(
    c: &mut Canvas,
    input: &mut Input,
    hits: &mut Vec<Hit>,
    st: &mut AppState,
    mode: Mode,
    lay: Rect,
    body: Rect,
    transition: Option<pages::PageTransition>,
    now: f64,
) -> (bool, bool, Option<bool>, bool) {
    let mut ui = Ui::new(c, input, hits, now);
    match mode {
        Mode::Expanded(page) => pages::draw_expanded(&mut ui, st, lay, page, transition),
        _ => activities::draw(&mut ui, st, &mode, body),
    }
    (ui.repaint_requested(), ui.anim_requested(), ui.focus_request(), ui.live_requested())
}

/// DWM's (refreshes, frames composed, frames missed) counters, if available.
fn dwm_counters() -> Option<(u64, u64, u64)> {
    use windows::Win32::Graphics::Dwm::{DwmGetCompositionTimingInfo, DWM_TIMING_INFO};
    let mut info = DWM_TIMING_INFO { cbSize: std::mem::size_of::<DWM_TIMING_INFO>() as u32, ..Default::default() };
    unsafe { DwmGetCompositionTimingInfo(HWND::default(), &mut info) }.ok()?;
    Some((info.cRefresh, info.cFrame, info.cFramesMissed))
}

/// The window's size in pixels for an island body up to `body_w`×`body_h`
/// DIPs at `scale`, on a monitor `mon_w` pixels wide: room for the spring's
/// overshoot, and the island's own room around the body (Classic: the
/// shoulders and hit margin; floating: the gap above, the shadow's room
/// beside and below).
fn surface_size(island: &Island, body_w: f32, body_h: f32, scale: f32, mon_w: i32) -> (i32, i32) {
    let mut w = ((body_w * OVERSHOOT + 2.0 * island.side_room()) * scale).ceil() as i32;
    // An even margin on both sides puts the centre on the monitor's centre.
    if (mon_w - w) % 2 != 0 {
        w += 1;
    }
    // The gap the island rests at, not where an outline sliding into or out
    // of it is now: the window never resizes during that motion.
    let top = if island.floating() { pill::TOP_GAP } else { 0.0 };
    let h = ((body_h * OVERSHOOT + island.bottom_room() + top) * scale).ceil() as i32;
    (w, h)
}

/// Where the island window takes the mouse (DIPs, window space). Open: the
/// whole canvas, a forgiving margin around the panel. Collapsed: the
/// island's own outline. While it floats (the Pill theme) the gap above it
/// takes the mouse too, down to the pill's middle, so a pointer thrown at
/// the top edge lands on it as it lands on Classic's island; beside and
/// below the pill (its shadow) clicks pass through. The Hidden idle style's
/// invisible island takes it only in a band at the top edge as tall as its
/// body, as Classic's hidden strip does, so what sits under the gap keeps
/// its clicks. The GPU renderer pushes this as the window's hit mask; the
/// software renderer paints it at alpha 1/255 under the island.
fn hit_mask_for(island: &Island, cx: f32, expanded: bool, hidden: bool) -> HitMask {
    if expanded {
        return HitMask { rect: Some(island.canvas_rect_at(cx)), notch: None, pill: None };
    }
    let body = island.body_rect_at(cx);
    if !island.floating() {
        return HitMask { rect: None, notch: Some((body, island.current().r, SHOULDER)), pill: None };
    }
    if hidden {
        return HitMask { rect: Some(Rect::new(body.x, 0.0, body.w, body.h)), notch: None, pill: None };
    }
    let gap = island.hover_rect_at(cx);
    HitMask { rect: Some(Rect::new(gap.x, gap.y, gap.w, body.y + body.h / 2.0 - gap.y)), notch: None, pill: Some((body, island.current().r)) }
}

/// Name of a morph for the motion log.
fn motion_name(from: &Mode, to: &Mode) -> &'static str {
    match (from, to) {
        (Mode::Expanded(_), Mode::Expanded(_)) => "page",
        (_, Mode::Expanded(_)) => "expand",
        (Mode::Expanded(_), _) => "collapse",
        _ => "pill",
    }
}

/// "1 file", "3 files".
/// The panel's list: most recently used first.
fn paired_phones(pairs: Vec<poni_core::pairdrop::Pair>) -> Vec<PairedPhone> {
    let mut v: Vec<PairedPhone> = pairs.into_iter().map(|p| PairedPhone { room: p.room(), name: p.name, seen: p.seen.max(p.added) }).collect();
    v.sort_by_key(|a| std::cmp::Reverse(a.seen));
    v
}

fn files_label(n: usize) -> String {
    format!("{n} {}", if n == 1 { "file" } else { "files" })
}

// The Downloads page's commands and yt-dlp's reports.
#[path = "app_downloads.rs"]
mod downloads;

#[cfg(test)]
mod tests {
    #[test]
    fn the_installed_apps_mutex_name_is_fixed_and_each_dev_home_has_its_own() {
        use std::ffi::OsStr;
        assert_eq!(super::instance_mutex_name(None), "Local\\yravgSubMeetly.Island");
        let a = super::instance_mutex_name(Some(OsStr::new("E:\\a\\home")));
        let b = super::instance_mutex_name(Some(OsStr::new("E:\\b\\home")));
        assert!(a.starts_with("Local\\yravgSubMeetly.Island.dev."));
        assert_ne!(a, b);
        assert_eq!(a, super::instance_mutex_name(Some(OsStr::new("E:\\A\\HOME"))), "Windows paths ignore case");
    }

    use super::*;
    use crate::island::HIT_MARGIN;

    /// The window's centre in DIPs (any value: the geometry follows it).
    const CX: f32 = 336.6;
    const SCALES: [f32; 4] = [1.0, 1.25, 1.5, 2.0];

    fn island(g: Geom, floating: bool) -> Island {
        let mut i = Island::new(g);
        i.set_floating(floating.then_some(pill::TOP_GAP));
        i
    }

    fn pt(x: f32, y: f32) -> Point {
        Point::new(x, y)
    }

    /// The pixel centre `over_shadow` tests for the pixel at (x, y) px.
    fn px_centre(x: i32, y: i32, s: f32) -> Point {
        pt((x as f32 + 0.5) / s, (y as f32 + 0.5) / s)
    }

    #[test]
    fn classic_hangs_from_the_edge() {
        let i = island(Geom::new(84.0, 30.0, 14.0), false);
        let body = i.body_rect_at(CX);
        assert_eq!(body, Rect::new(CX - 42.0, 0.0, 84.0, 30.0));
        assert_eq!(i.hover_rect_at(CX), body, "Classic hovers on its body");
        let side = SHOULDER + HIT_MARGIN;
        assert_eq!(i.canvas_rect_at(CX), Rect::new(CX - 42.0 - side, 0.0, 84.0 + 2.0 * side, 30.0 + HIT_MARGIN));
        assert_eq!((i.top(), i.side_room(), i.bottom_room()), (0.0, side, HIT_MARGIN));
    }

    #[test]
    fn pill_floats_below_the_edge() {
        let i = island(Geom::new(152.0, 32.0, 16.0), true);
        let (gap, side, below) = (pill::TOP_GAP, i.side_room(), i.bottom_room());
        assert!(i.floating() && i.top() == gap && side > 0.0 && below > 0.0, "room for the gap and the shadow");
        let body = i.body_rect_at(CX);
        assert_eq!(body, Rect::new(CX - 76.0, gap, 152.0, 32.0));
        assert_eq!(i.hover_rect_at(CX), Rect::new(CX - 76.0, 0.0, 152.0, gap + 32.0), "the gap above it and the body");
        assert_eq!(i.canvas_rect_at(CX), Rect::new(CX - 76.0 - side, 0.0, 152.0 + 2.0 * side, gap + 32.0 + below));
    }

    #[test]
    fn classic_masks_are_unchanged() {
        let i = island(Geom::new(84.0, 30.0, 14.0), false);
        let body = i.body_rect_at(CX);
        assert_eq!(hit_mask_for(&i, CX, false, false), HitMask { rect: None, notch: Some((body, 14.0, SHOULDER)), pill: None });
        // Hidden is Classic's own strip there, with its shoulders.
        assert_eq!(hit_mask_for(&i, CX, false, true), HitMask { rect: None, notch: Some((body, 14.0, SHOULDER)), pill: None });
        assert_eq!(hit_mask_for(&i, CX, true, false), HitMask { rect: Some(i.canvas_rect_at(CX)), notch: None, pill: None });
    }

    #[test]
    fn pill_takes_the_gap_not_its_shadow() {
        let i = island(Geom::new(152.0, 32.0, 16.0), true);
        let body = i.body_rect_at(CX);
        let m = hit_mask_for(&i, CX, false, false);
        assert_eq!(m.pill, Some((body, 16.0)));
        // A pointer thrown at the top edge: anywhere above the pill.
        for x in [body.x + 0.1, CX, body.right() - 0.1] {
            assert!(m.contains(pt(x, 0.0)), "top edge at x {x}");
            assert!(m.contains(pt(x, pill::TOP_GAP - 0.1)), "just above the pill at x {x}");
        }
        assert!(m.contains(pt(body.x + 0.5, body.y + 0.5)), "the top corners: the gap reaches the pill's middle");
        assert!(m.contains(pt(CX, body.bottom() - 0.5)), "the pill's bottom edge");
        // Beside it at the top edge, beside and below it (its shadow): through.
        assert!(!m.contains(pt(body.x - 0.5, 0.0)) && !m.contains(pt(body.right() + 0.5, 0.0)));
        for d in [0.5, 3.0, 8.0] {
            assert!(!m.contains(pt(body.x - d, body.center().y)), "beside, {d} out");
            assert!(!m.contains(pt(body.right() + d, body.center().y)), "beside, {d} out");
            assert!(!m.contains(pt(CX, body.bottom() + d)), "below, {d} down");
        }
        assert!(!m.contains(pt(body.x + 1.0, body.bottom() - 1.0)), "the round bottom corners");
    }

    #[test]
    fn pill_open_takes_the_card_its_margin_and_the_gap() {
        let i = island(Geom::new(620.0, 216.0, 40.0), true);
        let canvas = i.canvas_rect_at(CX);
        let m = hit_mask_for(&i, CX, true, false);
        assert_eq!(m, HitMask { rect: Some(canvas), notch: None, pill: None });
        let body = i.body_rect_at(CX);
        assert!(m.contains(pt(CX, 0.0)), "the gap above the card");
        assert!(m.contains(pt(body.x - i.side_room() + 0.5, body.center().y)), "the margin beside it");
        assert!(m.contains(pt(CX, body.bottom() + i.bottom_room() - 0.5)), "the margin below it");
        assert!(!m.contains(pt(canvas.right() + 0.5, body.center().y)) && !m.contains(pt(CX, canvas.bottom() + 0.5)));
    }

    #[test]
    fn hidden_pill_takes_a_band_at_the_edge() {
        // Classic's hidden strip (150 x 5, drawn at least 8 tall), floating:
        // the mouse finds it at the top edge in a band as tall as Classic's,
        // not down the gap and the invisible body under it.
        let i = island(Geom::new(150.0, 5.0, 2.5), true);
        let classic = island(Geom::new(150.0, 5.0, 2.5), false).body_rect_at(CX);
        let body = i.body_rect_at(CX);
        let m = hit_mask_for(&i, CX, false, true);
        assert_eq!(m, HitMask { rect: Some(Rect::new(classic.x, 0.0, classic.w, classic.h)), notch: None, pill: None });
        assert!(m.contains(pt(CX, 0.0)) && m.contains(pt(body.x + 0.1, classic.h - 0.1)));
        assert!(!m.contains(pt(CX, classic.h)) && !m.contains(pt(CX, body.center().y)), "below the band, the invisible body included");
    }

    #[test]
    fn pixels_at_every_scale() {
        // What over_shadow sees, pixel by pixel, at 100 / 125 / 150 / 200 %:
        // every pixel row of the gap above the pill takes the mouse, the
        // pixels beside and under the pill don't.
        let i = island(Geom::new(84.0, 32.0, 16.0), true);
        let body = i.body_rect_at(CX);
        let m = hit_mask_for(&i, CX, false, false);
        for s in SCALES {
            let x = (CX * s) as i32;
            let top_px = (pill::TOP_GAP * s).round() as i32;
            assert_eq!(top_px as f32, pill::TOP_GAP * s, "the gap is whole pixels at {s}");
            for y in 0..top_px {
                assert!(m.contains(px_centre(x, y, s)), "gap row {y} at {s}");
            }
            let mid = ((body.y + body.h / 2.0) * s) as i32;
            let left = (body.x * s).floor() as i32 - 1;
            let right = (body.right() * s).ceil() as i32;
            assert!(!m.contains(px_centre(left, mid, s)) && !m.contains(px_centre(right, mid, s)), "beside at {s}");
            assert!(m.contains(px_centre(left + 2, mid, s)) && m.contains(px_centre(right - 2, mid, s)), "inside the ends at {s}");
            let below = (body.bottom() * s).ceil() as i32;
            assert!(!m.contains(px_centre(x, below, s)) && m.contains(px_centre(x, below - 1, s)), "the bottom edge at {s}");
            assert!(m.contains(px_centre(x, 0, s)), "the top edge at {s}");
        }
    }

    #[test]
    fn window_room_follows_the_theme_and_comes_back() {
        // A theme switch lays the window out again: Pill grows it for the gap
        // (and needs less room beside: no shoulders), Classic gets its exact
        // size back.
        let mut i = island(Geom::new(84.0, 30.0, 14.0), false);
        for s in SCALES {
            for mon_w in [1920, 1366, 2560, 3841] {
                let classic = surface_size(&i, 620.0, 400.0, s, mon_w);
                // The formula Classic has always laid out with.
                let mut w = ((620.0 * OVERSHOOT + 2.0 * (SHOULDER + HIT_MARGIN)) * s).ceil() as i32;
                if (mon_w - w) % 2 != 0 {
                    w += 1;
                }
                assert_eq!(classic, (w, ((400.0 * OVERSHOOT + HIT_MARGIN) * s).ceil() as i32), "Classic at {s} on {mon_w}");
                assert_eq!((mon_w - classic.0) % 2, 0, "centred on whole pixels");

                i.set_floating(Some(pill::TOP_GAP));
                let floating = surface_size(&i, 620.0, 400.0, s, mon_w);
                let want_h = ((400.0 * OVERSHOOT + i.bottom_room() + pill::TOP_GAP) * s).ceil() as i32;
                assert_eq!(floating.1, want_h, "Pill has room for the gap at {s}");
                assert_eq!((mon_w - floating.0) % 2, 0);
                i.set_floating(None);
                assert_eq!(surface_size(&i, 620.0, 400.0, s, mon_w), classic, "back to Classic at {s} on {mon_w}");
            }
        }
    }
}
