//! Messages from service threads to the UI (main) thread.
//!
//! Services hold an [`EventSink`]. `send` pushes onto an mpsc channel and
//! queues a drain on the main dispatch queue; the main thread then applies
//! every waiting event. The event types match the Windows app's, so the
//! services that arrive in later slices plug in the same way.

use crate::gfx::Image;
use crate::state::{MediaSession, PowerState, SysStats};
use poni_core::lrc::Lyrics;
use poni_core::romanize::Ruby;
use poni_core::timeline::Timeline;
use std::sync::mpsc::Sender;

#[derive(Clone)]
pub struct EventSink {
    tx: Sender<AppEvent>,
}

impl EventSink {
    pub fn new(tx: Sender<AppEvent>) -> Self {
        Self { tx }
    }

    pub fn send(&self, ev: AppEvent) {
        if self.tx.send(ev).is_ok() {
            dispatch2::DispatchQueue::main().exec_async(|| {
                crate::app::drain_events();
            });
        }
    }
}

/// What Apple Music said about the user's token.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppleMusicStatus {
    Accepted,
    Rejected,
    Unreachable,
    NoAccess,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum LyricsResult {
    /// `ruby`: each line's pieces with their readings (empty = none needed).
    /// `wants_ja_readings`: kanji went unread for want of the Japanese
    /// readings add-on (the Music page offers it).
    Found { lyrics: Lyrics, source: String, ruby: Vec<Vec<Ruby>>, wants_ja_readings: bool },
    Instrumental,
    NotFound,
    Error(String),
}

#[allow(dead_code)]
pub enum AppEvent {
    /// The engine's AI connector and templates, or how a change to them ended (`crate::ai`).
    Ai(crate::ai::AiEvent),
    /// The current media session changed (None = nothing playing / no session).
    Media(Option<MediaSession>),
    /// Only the timeline/playback state of the current track changed.
    MediaTimeline { track_key: String, timeline: Timeline },
    /// Album art finished decoding for a track.
    MediaArt { track_key: String, art: Option<Image> },
    Lyrics { track_key: String, result: LyricsResult },
    AppleMusic(AppleMusicStatus),
    /// Master volume changed (0..=1). `switched`: the output device changed
    /// (headphones connected, say), not its volume.
    Volume { level: f32, muted: bool, switched: bool },
    Power(PowerState),
    Bluetooth { name: String, connected: bool, battery: Option<u8>, audio: bool },
    /// A full-screen app took over (or left) the island's screen.
    Fullscreen(bool),
    /// Files dropped on the island.
    ShelfAdd(Vec<String>),
    /// Files are being dragged over the island (true) or left (false).
    DragHover(bool),
    ShelfThumb { path: String, image: Option<Image> },
    Stats(SysStats),
    /// The System page's latest reading and the minute behind it
    /// (`services::sysmon`, each second while the page is open).
    System(Box<poni_core::sysmon::Monitor>),
    /// An app's icon for the System page, by its path (`Command::LoadAppIcon`).
    AppIcon { path: String, image: Option<Image> },
    /// The displays went to sleep (true) or woke.
    ScreensAsleep(bool),
    /// The Mac was locked (true) or unlocked.
    Locked(bool),
    /// Something happened in Phone drop (a phone visited, asked, sent files).
    Phone(poni_core::phonedrop::Event),
    /// Where an add-on's files stand (`services::addons`).
    Addon { id: &'static str, status: poni_core::addons::Status },
    /// One of yt-dlp's lines for download `id` (`services::downloader`).
    Download { id: u64, line: poni_core::ytdlp::Line },
    /// yt-dlp for download `id` ended (`ok`: it exited with 0).
    DownloadEnded { id: u64, ok: bool },
    /// What the update file said (`services::update`).
    Update(crate::services::update::UpdateEvent),
    /// Where the Mac is, for Prayer times (`services::location`).
    Located(crate::services::location::Located),
    /// One of Prayer times' online city files (`services::cities`).
    Cities { file: String, got: Result<poni_core::prayer::World, String> },
    /// Prayer times' adzan played to its end (`services::adzan`).
    AdzanEnded,
    /// Free-form log line from a service thread.
    Log(String),
    /// macOS asked this app to end (a signal, Quit from the Dock or AppleScript, logout): save and leave.
    Terminate,
    /// What the meeting probe saw (`services::meeting_probe`).
    MeetingSignals(crate::services::meeting_probe::Seen),
    /// A meeting exported to a file (`Command::ExportNote`), or why not.
    NoteExported(Result<std::path::PathBuf, String>),
    /// A CSV export ended: the file it wrote (its full path), or why it could not.
    Exported(Result<String, String>),
    /// A transcript translated again (`crate::retranslate`): how it goes, or how it ended.
    Retranslate(crate::retranslate::Event),
    /// What the engine supervisor sees (`services::engine`).
    Engine(poni_core::engine_link::EngineInfo),
    /// The engine's webhooks (`services::integrations`), and one line about the change just made.
    Webhooks(Result<Vec<poni_core::webhooks::Webhook>, String>),
    WebhookNote { ok: bool, text: String },
    /// The engine's models (`services::models`), and how each action on one ended.
    Models(Result<poni_core::models::Inventory, String>),
    ModelPulled { kind: poni_core::models::Kind, id: String, result: Result<(), String> },
    ModelDeleted { id: String, result: Result<u64, String> },
    ModelSelected { kind: poni_core::models::Kind, result: Result<(), String> },
    ModelPlaced { kind: poni_core::models::Kind, result: Result<(), String> },
    /// What the engine says about the model speed tests (or why it could not say).
    Speed(Result<poni_core::speed::Report, String>),
    /// A speed test was refused by the engine (the reason).
    SpeedStarted(Result<(), String>),
    /// The helper link's answer (engine health, notes, the live line) with its poll counter.
    Helper(Result<(poni_core::helper::Snapshot, u32), String>),
    HelperNotice(String),
    /// The calendar, as the helper link reads it once a minute.
    Calendar(Result<poni_core::calendar::Calendar, String>),
    CalendarNotes(Result<String, String>),
    /// Live captions: the capture's state, a heard line, the interim (`services::capture`).
    Capture(crate::services::capture::CaptureEvent),
    /// The captioned session became a meeting (or why not, with its lines back).
    MeetingSaved(crate::services::capture::Saved),
    /// The notes so far, drafted by the engine for the Meeting view.
    CallNotes(Option<Vec<poni_core::live_notes::Item>>),
}

/// Windows' window handle, which `services::models::relocate` names; the Mac has no picker (a model's
/// folder is the engine's own), so it is never made.
pub struct SendHwnd(pub isize);
