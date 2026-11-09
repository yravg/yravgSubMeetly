//! Messages from service threads to the UI thread.
//!
//! Services hold an [`EventSink`]. `send` pushes onto an mpsc channel and posts
//! `WM_APP_EVENT` to the island window; the UI thread drains the channel.

use crate::gfx::Image;
use crate::state::{MediaSession, PowerState, SysStats};
use poni_core::lrc::Lyrics;
use poni_core::romanize::Ruby;
use poni_core::timeline::Timeline;
use std::sync::mpsc::Sender;
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_APP};

pub const WM_APP_EVENT: u32 = WM_APP + 1;
pub const WM_APP_FRAME: u32 = WM_APP + 2;
pub const WM_APP_TRAY: u32 = WM_APP + 3;
pub const WM_APP_APPBAR: u32 = WM_APP + 4;

/// An HWND that can cross threads (only used for PostMessage).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SendHwnd(pub isize);
unsafe impl Send for SendHwnd {}
unsafe impl Sync for SendHwnd {}

impl SendHwnd {
    pub fn new(h: HWND) -> Self {
        Self(h.0 as isize)
    }
    pub fn hwnd(self) -> HWND {
        HWND(self.0 as *mut core::ffi::c_void)
    }
}

#[derive(Clone)]
pub struct EventSink {
    tx: Sender<AppEvent>,
    hwnd: SendHwnd,
}

impl EventSink {
    pub fn new(tx: Sender<AppEvent>, hwnd: SendHwnd) -> Self {
        Self { tx, hwnd }
    }

    pub fn send(&self, ev: AppEvent) {
        if self.tx.send(ev).is_ok() {
            unsafe {
                let _ = PostMessageW(self.hwnd.hwnd(), WM_APP_EVENT, WPARAM(0), LPARAM(0));
            }
        }
    }

    pub fn hwnd(&self) -> SendHwnd {
        self.hwnd
    }
}

/// What Apple Music said about the user's token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppleMusicStatus {
    /// The token works; Apple's synced lyrics come first from now on.
    Accepted,
    /// Apple refuses the token (expired, signed out, copied wrong).
    Rejected,
    /// Apple couldn't be reached to check; lookups will try again.
    Unreachable,
    /// The token works, but the account gets no lyrics (no subscription?).
    NoAccess,
}

#[derive(Clone, Debug)]
pub enum LyricsResult {
    /// `ruby`: each line's pieces with their readings (empty = none needed).
    /// `wants_ja_readings`: kanji went unread for want of the Japanese
    /// readings add-on (`services::romanize::Pronounced`).
    Found { lyrics: Lyrics, source: String, ruby: Vec<Vec<Ruby>>, wants_ja_readings: bool },
    /// The song is marked instrumental (no words to show).
    Instrumental,
    NotFound,
    Error(String),
}

pub enum AppEvent {
    /// The current media session changed (None = nothing playing / no session).
    Media(Option<MediaSession>),
    /// Only the timeline/playback state of the current track changed.
    MediaTimeline { track_key: String, timeline: Timeline },
    /// Album art finished decoding for a track.
    MediaArt { track_key: String, art: Option<Image> },
    Lyrics { track_key: String, result: LyricsResult },
    /// The outcome of checking or using the user's Apple Music token.
    AppleMusic(AppleMusicStatus),
    /// Master volume changed (0..=1).
    Volume { level: f32, muted: bool },
    Power(PowerState),
    Bluetooth { name: String, connected: bool, battery: Option<u8>, audio: bool },
    /// A full-screen app took over (or left) the island's monitor. `true` is
    /// sent again when another window comes to the foreground while the
    /// monitor stays full-screen, so the island can be raised back on top.
    Fullscreen(bool),
    /// Another window came to the foreground on a monitor that isn't
    /// full-screen. It may have made itself topmost and now cover the island.
    Foreground,
    /// Step aside: the app windows at the top edge of the island's monitor
    /// changed (a browser maximized or restored, a window snapped or dragged
    /// to the top). Screen pixels (left, top, right, bottom), each clipped
    /// to the thin band along the edge.
    TopWindows(Vec<[i32; 4]>),
    /// Files dropped on the island.
    ShelfAdd(Vec<String>),
    /// Files are being dragged over the island (true) or left (false).
    DragHover(bool),
    ShelfThumb { path: String, image: Option<Image> },
    Stats(SysStats),
    /// The System page's latest reading and the minute behind it
    /// (`services::sysmon`, each second while the page is open).
    System(Box<poni_core::sysmon::Monitor>),
    /// Show over games: whether Windows lets Poni read frames (a check, or
    /// the one-time OK's outcome).
    FpsAccess(crate::state::FpsAccess),
    /// Phone drop's server: a phone opened the page, asked, sent, gave up.
    Phone(poni_core::phonedrop::Event),
    /// Paired phones: pairing done, the list changed, files from a phone.
    Paired(poni_core::pairdrop::MeetEvent),
    /// Where an add-on's files stand (`services::addons`).
    Addon { id: &'static str, status: poni_core::addons::Status },
    /// What the update file said (`services::update`).
    Update(crate::services::update::UpdateEvent),
    /// Where Windows says the PC is (`services::location`), for prayer times.
    Located(crate::services::location::Located),
    /// One of prayer times' online city files (`services::cities`).
    Cities { file: String, got: Result<poni_core::prayer::World, String> },
    /// One of yt-dlp's lines for download `id` (`services::downloader`).
    Download { id: u64, line: poni_core::ytdlp::Line },
    /// yt-dlp for download `id` ended (`ok`: it exited with 0).
    DownloadEnded { id: u64, ok: bool },
    /// Notifications: what Windows allows, and new notifications
    /// (`services::notifications`).
    Notify(crate::services::notifications::NotifyEvent),
    /// Where a Windows language feature stands (`services::winlang`).
    WinLang { id: &'static str, state: poni_core::winlang::State },
    /// The adzan finished playing, or couldn't play on.
    AdzanEnded,
    /// Start with Windows is on (true) or off, read for the Settings page.
    Autostart(bool),
    /// The helper's answer: notes and health with the round trip in ms, or why not.
    Helper(Result<(poni_core::helper::Snapshot, u32), String>),
    /// A decision the helper refused or could not be reached for.
    HelperNotice(String),
    /// The engine link: what answers /health, and whether the island started it.
    Engine(poni_core::engine_link::EngineInfo),
    /// System-audio captions: a state change, or words heard (`services::capture`).
    Capture(crate::services::capture::CaptureEvent),
    /// A captioned session saved as a meeting (its id), or why not, with its lines back.
    MeetingSaved(Result<String, (String, Vec<poni_core::helper::Line>)>),
    /// A song's lyrics translated so far (index-aligned with the lines) and where that stands.
    LyricsTr { track_key: String, tgt: String, lines: Vec<String>, state: poni_core::lyric_tr::TrState },
    /// What the engine says its models are (or why it could not say), during a download too.
    Models(Result<poni_core::models::Inventory, String>),
    /// A model download ended.
    ModelPulled { kind: poni_core::models::Kind, id: String, result: Result<(), String> },
    /// The engine switched (or refused to switch) its model.
    ModelSelected { kind: poni_core::models::Kind, result: Result<(), String> },
    /// Free-form log line from a service thread.
    Log(String),
    /// The Glass theme's screen copy has new pixels (or stopped).
    Backdrop,
}
