//! All state shared by pages, activities and the app loop.
//!
//! Owned by the UI thread. Services never touch it directly; they send
//! [`crate::events::AppEvent`]s that the app applies here.

use crate::commands::{Command, MediaCmd, Sound};
use crate::gfx::Image;
use crate::icons::Icon;
use crate::pages::PageKind;
use poni_core::addons::Status as AddonStatus;
use poni_core::datetime::LocalDateTime;
use poni_core::geom::{palette, Color};
use poni_core::lrc::Lyrics;
use poni_core::phonedrop::QrMatrix;
use poni_core::pomodoro::Pomodoro;
use poni_core::prayer::{Place, PlaceList, PrayerMoment, Site, World};
use poni_core::romanize::Ruby;
use poni_core::settings::Settings;
use poni_core::store::Store;
use poni_core::timeline::Timeline;
use std::collections::{BTreeMap, HashMap};

/// A notice held while a full-screen app hides the island is dropped after
/// this long (mono seconds).
pub const HELD_MAX_S: f64 = 30.0 * 60.0;

#[derive(Clone, Debug)]
pub struct MediaSession {
    /// AppUserModelId of the player (e.g. `Spotify.exe`, `Chrome`).
    pub app_id: String,
    /// Friendly player name ("Spotify", "Chrome", …).
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art: Option<Image>,
    /// Accent derived from the art (for progress bars / the activity glow).
    pub art_color: Option<Color>,
    pub timeline: Timeline,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_play_pause: bool,
    pub can_seek: bool,
    /// Identity of the track: `title\u{1}artist\u{1}album`.
    pub track_key: String,
}

impl MediaSession {
    pub fn make_track_key(title: &str, artist: &str, album: &str) -> String {
        format!("{title}\u{1}{artist}\u{1}{album}")
    }
    pub fn is_playing(&self) -> bool {
        self.timeline.playing
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum LyricsStatus {
    Idle,
    Loading,
    Found,
    Instrumental,
    NotFound,
    Error(String),
}

#[derive(Clone, Debug)]
pub struct LyricsState {
    pub track_key: String,
    pub status: LyricsStatus,
    pub lyrics: Option<Lyrics>,
    pub source: String,
    /// Each line's pieces with their readings in Latin letters (Japanese,
    /// Korean, Chinese); empty for lines that need none.
    pub ruby: Vec<Vec<Ruby>>,
    /// The song's kanji went unread because Windows has no Japanese reading
    /// data and the Japanese readings add-on isn't on this PC: the app
    /// switches the add-on on the first time, and the Music page shows how
    /// it comes in (or offers it, after a switch-off by hand).
    pub wants_ja_readings: bool,
}

impl Default for LyricsState {
    fn default() -> Self {
        Self { track_key: String::new(), status: LyricsStatus::Idle, lyrics: None, source: String::new(), ruby: Vec::new(), wants_ja_readings: false }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VolumeState {
    pub level: f32,
    pub muted: bool,
    pub known: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PowerState {
    pub has_battery: bool,
    /// 0..=100 (meaningful only with a battery).
    pub percent: u8,
    pub charging: bool,
    pub on_ac: bool,
    pub saver: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SysStats {
    pub valid: bool,
    /// 0..=1
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_free: u64,
    pub disk_total: u64,
    pub uptime_s: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum HudKind {
    Volume { level: f32, muted: bool },
    Charging { percent: u8, plugged: bool },
    Bluetooth { name: String, connected: bool, battery: Option<u8>, audio: bool },
    LowBattery { percent: u8 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Hud {
    pub kind: HudKind,
    /// Monotonic time when it disappears.
    pub until: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum NoticeAction {
    OpenPage(PageKind),
    /// Open Focus and start the (idle) timer.
    StartFocus,
    /// Open the Update sheet in Settings (a new version's notice).
    OpenUpdate,
    /// Open the app another app's notification came from (its
    /// AppUserModelID; Notifications). The island stays closed.
    OpenApp(String),
}

/// A one-click action shown as a small pill inside a notice (doesn't expand).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineAction {
    /// Start the idle Pomodoro phase.
    StartFocus,
    /// Put the notice's hidden words in place: an Oyenza sum (and sender),
    /// or a message and who it's from (Notifications).
    ShowAmount,
    /// Stop the adzan (Prayer times).
    StopAdzan,
    /// Put the notice away now (a new version's: the menu and Settings
    /// keep offering it).
    Hide,
    /// Open this version's release notes ("Updated to").
    WhatsNew,
    /// Open the app a notification came from (the notice's `OpenApp`).
    Open,
}

/// Whether this copy may read other apps' notifications (the Notifications
/// add-on, `services::notifications`), for its page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NotifyAccess {
    /// Not looked at yet: the add-on is off, or just came on.
    #[default]
    Unknown,
    /// This copy has no package identity (the download from GitHub), and
    /// Windows lets only a packaged app read notifications.
    NoPackage,
    /// Windows hasn't been asked yet, or its question was closed unanswered.
    Ask,
    /// Windows' question is on screen.
    Asking,
    /// Asked, and Windows came back without an answer (the question was
    /// closed, or never showed): ask again, or turn it on in Windows' settings.
    Unanswered,
    /// Turned off for yravgSubMeetly in Windows' settings.
    Denied,
    /// Windows lets it read them: new ones show on the island.
    Allowed,
    /// Windows' notification listener didn't answer (an older Windows, or a
    /// failure the log names).
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Notice {
    pub icon: Icon,
    pub color: Color,
    pub title: String,
    /// Dimmer words after the title, on its line ("0.2.5" after "Update
    /// available"); empty for most notices.
    pub title_dim: String,
    pub subtitle: String,
    pub until: f64,
    pub action: Option<NoticeAction>,
    pub inline: Option<InlineAction>,
    /// The subtitle Show puts in place of `subtitle` ([`InlineAction::ShowAmount`]).
    pub reveal: Option<String>,
}

impl Notice {
    /// No time limit (a new version's): it stays until clicked or put away,
    /// and lets a volume change or a game's readout show over it meanwhile.
    pub fn stays(&self) -> bool {
        self.until.is_infinite()
    }
}

/// What the app knows about new versions.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UpdateView {
    /// A later release than this copy, with a download for this system.
    pub offer: Option<poni_core::update::Release>,
    /// Settings shows the Update sheet in place of its rows (until the
    /// island closes or the page changes).
    pub sheet: bool,
    /// Its Setup is downloaded and checked (Windows): the sheet offers
    /// Install now and Install on next start.
    pub ready: bool,
    /// Install on next start was picked for it.
    pub next_start: bool,
    /// This copy reads the update file itself (not a Microsoft Store copy):
    /// Settings has Check now.
    pub looks: bool,
    /// What Settings says in Check now's place since it was clicked, until
    /// the island closes or the page changes.
    pub said: Option<Said>,
}

/// Check now's answer in Settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Said {
    Checking,
    UpToDate,
    Failed,
}

/// A phone wants to send these files; the Shelf asks the person at the PC.
#[derive(Clone, Debug, PartialEq)]
pub struct PhoneAsk {
    pub id: u64,
    /// "iPhone", "Android phone", …
    pub from: String,
    /// (name, size) in the order the phone sends them.
    pub files: Vec<(String, u64)>,
    pub total: u64,
}

/// Files coming in from the phone.
#[derive(Clone, Debug, PartialEq)]
pub struct PhoneTransfer {
    pub id: u64,
    pub from: String,
    /// The file being sent (0-based) and how many there are.
    pub file: usize,
    pub files: usize,
    pub done: u64,
    pub total: u64,
}

/// What the phone panel shows on its left and right.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum PhoneView {
    /// Today's same-Wi-Fi QR code.
    #[default]
    Lan,
    /// A pairing QR code (`services::pairdrop`): the link, its code and
    /// until when (app clock) it works.
    Pairing { url: String, qr: Option<QrMatrix>, until: f64 },
    /// The paired phones, each with Remove.
    Paired,
}

/// A paired phone as the panel lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairedPhone {
    /// Its room on the meeting server (what Remove names).
    pub room: String,
    pub name: String,
    /// Unix seconds it last connected (0 = not yet).
    pub seen: i64,
}

/// Phone drop while the Shelf's phone panel is open: the link, its QR code
/// and what the phone is doing (`services::phonedrop` runs the server).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PhoneDrop {
    pub view: PhoneView,
    /// A second line under `outcome` (None = the usual hint).
    pub outcome_line: Option<String>,
    /// The link the QR code carries (empty while starting or after an error).
    pub url: String,
    pub qr: Option<QrMatrix>,
    /// Why it couldn't start, as a sentence for the island.
    pub error: Option<String>,
    /// The kind of phone that last opened the page ("iPhone").
    pub visitor: Option<String>,
    pub ask: Option<PhoneAsk>,
    pub transfer: Option<PhoneTransfer>,
    /// The last result, whether it's good news, and until when it shows.
    pub outcome: Option<(String, bool, f64)>,
}

impl PhoneDrop {
    /// The island stays open while a QR code waits for its first phone and
    /// while a phone waits for an answer. Once the panel has shown a result
    /// (a phone paired, files arrived), or on the list of paired phones,
    /// nothing waits: the island closes when the pointer leaves.
    pub fn holds_island(&self) -> bool {
        let waiting = !matches!(self.view, PhoneView::Paired) && self.outcome.is_none();
        self.ask.is_some() || (waiting && self.error.is_none() && self.visitor.is_none() && self.transfer.is_none())
    }
}

/// Transient per-page UI state (scroll offsets, text being typed, …).
#[derive(Clone, Debug, Default)]
pub struct PageUiState {
    pub task_input: String,
    pub task_scroll: f32,
    pub shelf_scroll: f32,
    /// The Today page's list: how far it's scrolled (DIPs), the date clicked
    /// in its grid (days since 1970-01-01), and when it was last drawn (mono
    /// time; a page drawn again after a while starts at today).
    pub today_scroll: f32,
    pub today_pick: Option<i64>,
    /// The next draw scrolls the list to `today_pick` (or back to today).
    pub today_jump: bool,
    pub today_drawn: f64,
    /// Smoothly animated lyric scroll position (line index as float).
    pub lyric_pos: f32,
    pub lyric_track: String,
    /// Volume HUD bar position, gliding toward the real level.
    pub hud_level: f32,
    /// Collapsed media pill shows the track title until this mono time.
    pub peek_until: f64,
    /// Header tab under the pointer and since when (for hover labels).
    pub tab_hover: Option<(usize, f64)>,
    /// The header's Menu: whether its list is open, the row and the keyboard ring ([`crate::pages::menu`]).
    pub menu: crate::pages::menu::MenuUi,
    /// The module the System page shows under its strip.
    pub system_module: poni_core::sysmon::Module,
    /// The last System reading had a GPU (keeps its chip while the next one is on its way).
    pub system_gpu: bool,
    /// The last full System reading had the whole PC's power (keeps its chip
    /// while the page's first, light reading shows).
    pub system_power: bool,
    /// The page the Settings button was pressed on (pressing it again goes back).
    pub before_settings: Option<PageKind>,
    /// Start with Windows, as last read off the UI thread (None until Settings first opens).
    pub autostart: Option<bool>,
    /// The Eyes look on a MacBook's notch: the pointer the eyes follow and
    /// the side of the camera they peek out from (`mac/notch.rs`).
    #[cfg(target_os = "macos")]
    pub peek: poni_core::peek::Peek,
    /// The Downloads page: its link field, mode and scroll.
    pub downloads: crate::pages::downloads::DownloadsUi,
    /// The Pro add-on whose "what it does" page shows on the Add-ons page.
    pub addon_about: Option<&'static str>,
}

/// Whether Windows lets yravgSubMeetly read a game's frames. Its event tracing
/// is open to admins and to the Performance Log Users group; the one-time
/// OK adds the account to that group, which counts from the next sign-in.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum FpsAccess {
    /// Not asked yet.
    #[default]
    Unknown,
    /// Being checked.
    Checking,
    /// Frames can be read.
    Ready,
    /// The one-time OK is needed.
    NeedsOk,
    /// Windows' prompt for it is open.
    Asking,
    /// The account is in the group; Windows applies it at the next sign-in.
    SignOut,
    /// The OK didn't go through (why, in a few words).
    Failed(String),
}

/// Show over games: the readout in the island over a full-screen app
/// (`activities::Activity::Game`) and the System page's Games view.
#[derive(Clone, Debug, Default)]
pub struct GameState {
    /// The readout is on screen: Show over games is on and a full-screen
    /// app is in front.
    pub active: bool,
    /// The full-screen app ("cs2.exe").
    pub app: Option<String>,
    /// Its frame rate, while it draws and the frames can be read.
    pub rate: Option<poni_core::frames::FrameRate>,
    /// Frames per second over the last minute in front.
    pub history: poni_core::sysmon::Series,
    pub access: FpsAccess,
}

/// Where finding the PC's place stands.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Locate {
    /// Not asked (following the location is off, or not yet).
    #[default]
    Idle,
    Asking,
    /// Picked the nearest place, this far from the PC (km).
    Found { km: f64 },
    /// The nearest place in either list is too far away to use (km).
    Far { km: f64 },
    /// Away from Kemenag's places, and the cities around couldn't be looked
    /// up (offline): the place stays as it was.
    Offline,
    /// Windows' location is off, or not allowed for yravgSubMeetly.
    Denied,
    /// Windows couldn't tell where the PC is.
    Unknown,
}

/// One of Prayer times' online city files, while it's wanted.
#[derive(Clone, Debug)]
pub enum CityFile {
    Asking,
    Here(std::sync::Arc<World>),
    /// Offline, or the website didn't answer.
    Failed,
}

/// The Prayer times add-on's live state.
#[derive(Clone, Debug, Default)]
pub struct PrayerState {
    /// The add-on's place list, read once its files are in place.
    pub places: Option<std::sync::Arc<PlaceList>>,
    /// The online city files asked for (`poni_core::prayer::world`): the
    /// picker's, dropped when it closes, and a location's squares, dropped
    /// once its place is found.
    pub cities: HashMap<String, CityFile>,
    /// A location waiting for its squares: the point (never saved) and the
    /// files it needs.
    pub fix: Option<(f64, f64, Vec<String>)>,
    /// The last location that went online and the place it found: the next
    /// one within a kilometre takes it again without asking.
    pub last_fix: Option<(f64, f64, Option<(Place, f64)>)>,
    /// The picker's last search: what was typed, and what it found.
    pub found: Option<(String, Vec<Place>)>,
    /// The place the times are for: the chosen one, or the time zone's
    /// suggestion while none is chosen.
    pub place: Option<Place>,
    /// `place` is the time zone's suggestion.
    pub suggested: bool,
    pub locate: Locate,
    /// When the PC's location was last asked (UTC seconds).
    pub located_at: Option<i64>,
    /// The place picker shows (Change), and what's typed in it.
    pub picking: bool,
    pub query: String,
    /// Prayer times up to this moment (UTC seconds) have had their moment.
    pub handled_until: Option<i64>,
    /// The adzan is playing.
    pub adzan: bool,
    /// OK on the countdown put it away until this prayer's time (UTC
    /// seconds): the closed island shows what it would otherwise (the song
    /// and its sung line) until then. Kept in memory only.
    pub countdown_ok: Option<i64>,
    /// Self-test only: moves the prayer clock by this many seconds.
    pub clock_shift: i64,
}

impl PrayerState {
    pub fn site(&self) -> Option<Site> {
        self.place.as_ref().and_then(|p| p.site())
    }
}

pub struct AppState {
    pub settings: Settings,
    pub store: Store,
    /// Monotonic seconds at the current frame.
    pub now: f64,
    pub local: LocalDateTime,
    pub unix: i64,
    pub media: Option<MediaSession>,
    pub lyrics: LyricsState,
    pub pomodoro: Pomodoro,
    pub volume: VolumeState,
    pub power: PowerState,
    pub hud: Option<Hud>,
    pub notice: Option<Notice>,
    pub stats: SysStats,
    /// The System page's readings and their last minute (empty while it's closed).
    pub system: poni_core::sysmon::Monitor,
    /// Show over games.
    pub game: GameState,
    pub shelf_thumbs: HashMap<String, Option<Image>>,
    /// Icons of the apps the System page lists, by executable path (None = loading or none).
    pub app_icons: HashMap<String, Option<Image>>,
    pub ui: PageUiState,
    /// System accent colour (falls back to blue).
    pub accent: Color,
    /// The page currently shown when expanded.
    pub page: PageKind,
    /// A notice held while a full-screen app hid the island, and when it came.
    pub held: Option<(Notice, f64)>,
    /// When playback went from playing to paused (the pill lingers 30 s).
    pub media_paused_at: Option<f64>,
    pub pinned: bool,
    /// Stepped aside (Settings › Over maximized windows): an app window sits
    /// under where the island rests, so the closed island rests as an
    /// invisible strip at the top edge (`activities::Mode::Aside`). Windows
    /// sets it; the Mac never does.
    pub aside: bool,
    /// Files are being dragged over the island right now.
    pub drag_hover: bool,
    /// Phone drop, while it's open.
    pub phone: Option<PhoneDrop>,
    /// Paired phones, newest first (`services::pairdrop`).
    pub paired: Vec<PairedPhone>,
    /// Whether the meeting server answers (None = not asked yet: no pairs).
    pub pair_server: Option<bool>,
    /// Where each add-on stands, by id (every one in `poni_core::addons::ALL`).
    pub addons: BTreeMap<&'static str, AddonStatus>,
    /// New versions (`crate::updates`): what Settings, the menu and the
    /// island's notice show.
    pub update: UpdateView,
    /// The Prayer times add-on, while it is on (its choices: `settings.prayer`).
    pub prayer: PrayerState,
    /// The Script page's reading (its script and pace are in `store.script`).
    pub script: poni_core::script::Reader,
    /// A message under the script until a time (mono seconds).
    pub script_note: Option<(&'static str, f64)>,
    /// Whether Windows leaves the island out of screen capture while the
    /// Script page shows (None = not asked yet, or not on Windows).
    pub script_hidden: Option<bool>,
    /// The Downloads page's jobs (`poni_core::downloads`), in memory only.
    pub downloads: poni_core::downloads::Jobs,
    /// This app offers the Downloader: Windows outside the Microsoft Store
    /// build, and the Mac (set at start).
    pub downloader_offered: bool,
    /// Whether Windows lets the island read notifications.
    pub notify_access: NotifyAccess,
    /// This copy can read other apps' notifications: Windows lets only an app
    /// with a package identity, the Microsoft Store copy, do it. The download
    /// can't, so it offers no Notifications at all. Set once at start (the
    /// self-test sets it per scene).
    pub notify_can: bool,
    /// What the helper said last (`services::helper`), for the meeting pages.
    pub helper: poni_core::helper::View,
    /// What the engine link knows (`services::engine`): the menu's status line.
    pub engine: poni_core::engine_link::EngineInfo,
    /// A line the Meeting page shows for a moment: what a button did, or why
    /// the helper refused (until mono seconds; true: it went wrong).
    pub helper_notice: Option<(String, f64, bool)>,
    /// Side effects requested during the frame.
    pub cmds: Vec<Command>,
}

impl AppState {
    /// The Shelf's phone panel keeps the open island from closing, only
    /// while the Shelf is the page on screen.
    pub fn phone_holds_island(&self) -> bool {
        self.page == PageKind::Shelf && self.phone.as_ref().is_some_and(|p| p.holds_island())
    }

    /// A reading under way on the Script page keeps the open island from
    /// closing, while that page is on screen.
    pub fn script_holds_island(&self) -> bool {
        self.page == PageKind::Script && self.script.active
    }

    /// Something on the page on screen keeps the open island from closing.
    pub fn page_holds_island(&self) -> bool {
        self.phone_holds_island() || self.script_holds_island()
    }

    pub fn new(settings: Settings, store: Store) -> Self {
        let pomodoro = Pomodoro::new(settings.pomodoro.clone());
        let page = PageKind::from_key(if settings.remember_page && !store.last_page.is_empty() {
            &store.last_page
        } else {
            &settings.start_page
        });
        let mut st = Self {
            settings,
            store,
            now: 0.0,
            local: LocalDateTime::default(),
            unix: 0,
            media: None,
            lyrics: LyricsState::default(),
            pomodoro,
            volume: VolumeState::default(),
            power: PowerState::default(),
            hud: None,
            notice: None,
            stats: SysStats::default(),
            system: poni_core::sysmon::Monitor::default(),
            game: GameState::default(),
            shelf_thumbs: HashMap::new(),
            app_icons: HashMap::new(),
            ui: PageUiState::default(),
            accent: palette::BLUE,
            page,
            held: None,
            media_paused_at: None,
            pinned: false,
            aside: false,
            drag_hover: false,
            phone: None,
            paired: Vec::new(),
            pair_server: None,
            addons: BTreeMap::new(),
            update: UpdateView::default(),
            prayer: PrayerState::default(),
            script: poni_core::script::Reader::default(),
            script_note: None,
            script_hidden: None,
            downloads: poni_core::downloads::Jobs::default(),
            downloader_offered: false,
            notify_access: NotifyAccess::Unknown,
            notify_can: false,
            helper: Default::default(),
            engine: Default::default(),
            helper_notice: None,
            cmds: Vec::new(),
        };
        // On ones start by checking their files (the worker reports back);
        // one without files is ready at once.
        for a in poni_core::addons::ALL {
            let on = st.settings.addon_on(a.id);
            st.addons.insert(a.id, if !on { AddonStatus::Off } else if a.downloads() { AddonStatus::Checking } else { AddonStatus::Ready });
        }
        // Last open on the Script, System or Downloads page, since switched
        // off, or on a tab since hidden: open on the first tab.
        let off = match st.page {
            PageKind::Script => !st.script_on(),
            PageKind::System => !st.system_on(),
            PageKind::Timer | PageKind::Talk | PageKind::Engine => !crate::pages::tabs(&st).contains(&st.page),
            PageKind::Downloads => !st.downloader_on(),
            PageKind::Notifications => !st.notifications_on(),
            p => st.tab_hidden(p),
        };
        if off {
            st.page = crate::pages::first_tab(&st);
        }
        st
    }

    /// Where the add-on `id` stands (`Off` for one this version doesn't know).
    pub fn addon(&self, id: &str) -> AddonStatus {
        self.addons.get(id).copied().unwrap_or(AddonStatus::Off)
    }

    /// The Script reader add-on is on: the Script tab shows.
    pub fn script_on(&self) -> bool {
        self.addon(poni_core::addons::SCRIPT_READER.id) == AddonStatus::Ready
    }

    /// The System add-on is on: the System tab shows.
    pub fn system_on(&self) -> bool {
        self.addon(poni_core::addons::SYSTEM.id) == AddonStatus::Ready
    }

    /// Prayer times is on and its places are read: the tab and reminders run.
    pub fn prayer_on(&self) -> bool {
        self.addon(poni_core::addons::PRAYER_TIMES.id) == AddonStatus::Ready && self.prayer.places.is_some()
    }

    /// The prayer clock, UTC seconds (the self-test moves it).
    pub fn prayer_now(&self) -> i64 {
        self.unix + self.prayer.clock_shift
    }

    /// OK on the countdown before a prayer: it goes away until that prayer's
    /// time (`activities::prayer_countdown`). The adzan still comes then,
    /// since what rings follows the prayer clock, not the countdown. Returns
    /// the prayer put away (none when no countdown runs).
    pub fn prayer_countdown_ok(&mut self) -> Option<PrayerMoment> {
        let site = self.prayer.site()?;
        let (m, _) = poni_core::prayer::countdown(&site, self.prayer_now(), self.settings.prayer.remind_before_min)?;
        self.prayer.countdown_ok = Some(m.at);
        Some(m)
    }

    /// Show `n` now or, while a full-screen app hides the island (`hidden`), keep
    /// it for when the island is back, the way money notices wait
    /// (`OyenzaState::held`, shown then if no older than `HELD_MAX_S`). One
    /// notice waits at a time, and a money or bill notice already waiting stays.
    pub fn show_or_hold(&mut self, n: Notice, hidden: bool) {
        if !hidden {
            self.notice = Some(n);
        } else if self.held.as_ref().is_none_or(|(_, at)| self.now - at > HELD_MAX_S) {
            self.held = Some((n, self.now));
        }
    }

    /// The Downloader add-on is on, with its tools in place: the Downloads tab shows.
    pub fn downloader_on(&self) -> bool {
        self.downloader_offered && self.addon(poni_core::addons::DOWNLOADER.id) == AddonStatus::Ready
    }

    /// Notifications is on: its tab shows, and new notifications from the
    /// apps picked there show on the island. On by default wherever this copy
    /// can read them (`notify_can`); its chip in Settings' tabs row switches
    /// it off.
    pub fn notifications_on(&self) -> bool {
        self.notify_can && !self.tab_hidden(PageKind::Notifications)
    }

    /// Settings took this page's tab off the header's row (Music, Shelf,
    /// Tasks, Focus or Notifications).
    pub fn tab_hidden(&self, p: PageKind) -> bool {
        p.hideable() && self.settings.hidden_tabs.iter().any(|k| k == p.key())
    }

    pub fn cmd(&mut self, c: Command) {
        self.cmds.push(c);
    }

    pub fn media_cmd(&mut self, c: MediaCmd) {
        self.cmds.push(Command::Media(c));
    }

    /// Mark the persisted store as changed.
    pub fn save(&mut self) {
        if !self.cmds.contains(&Command::SaveStore) {
            self.cmds.push(Command::SaveStore);
        }
    }

    pub fn chime(&mut self) {
        if self.settings.sounds {
            self.cmds.push(Command::Play(Sound::Chime));
        }
    }

    /// Show a notice pill for `secs` seconds.
    pub fn notify(&mut self, icon: Icon, color: Color, title: impl Into<String>, subtitle: impl Into<String>, secs: f64, action: Option<NoticeAction>) {
        self.notice = Some(Notice { icon, color, title: title.into(), title_dim: String::new(), subtitle: subtitle.into(), until: self.now + secs, action, inline: None, reveal: None });
    }

    /// The Update sheet: Settings, with the sheet in place of its rows (the
    /// gear goes back to the page it was opened from).
    pub fn open_update(&mut self) {
        if self.page != PageKind::Settings {
            self.ui.before_settings = Some(self.page);
        }
        self.page = PageKind::Settings;
        self.update.sheet = true;
    }

    /// Give the current notice a one-click inline action pill.
    pub fn set_notice_inline(&mut self, a: InlineAction) {
        if let Some(n) = self.notice.as_mut() {
            n.inline = Some(a);
        }
    }

    pub fn show_hud(&mut self, kind: HudKind, secs: f64) {
        self.hud = Some(Hud { kind, until: self.now + secs });
    }

    pub fn day_key(&self) -> String {
        self.local.day_key()
    }

    pub fn day_start_unix(&self) -> i64 {
        crate::clock::day_start_unix(&self.local, self.unix)
    }

    /// Accent for media UI: art colour when available, else the system accent.
    pub fn media_accent(&self) -> Color {
        self.media.as_ref().and_then(|m| m.art_color).unwrap_or(self.accent)
    }
}
