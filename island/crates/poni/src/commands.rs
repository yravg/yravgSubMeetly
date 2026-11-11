//! Side effects requested by pages; executed by the app after each frame.

use crate::pages::PageKind;

#[derive(Clone, Debug, PartialEq)]
pub enum MediaCmd {
    PlayPause,
    Next,
    Prev,
    /// Seek to absolute position in seconds.
    Seek(f64),
    /// The pointer reached the progress bar or the back button: get ready
    /// (Apple Music's own controls are looked up before the press, not during it).
    Prepare,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sound {
    /// Gentle chime (timer finished, reminder).
    Chime,
    /// Short tick (button feedback) — currently unused.
    Tick,
}

/// Phone drop (the Shelf's phone panel).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PhoneCmd {
    /// Start it (or try again after an error).
    Open,
    /// Stop it; files still coming in are dropped.
    Close,
    /// Answer the phone's question.
    Answer { id: u64, accept: bool },
}

/// Paired phones (also in the Shelf's phone panel; `services::pairdrop`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PairCmd {
    /// Show a pairing QR code in the panel.
    Begin,
    /// Back to the same-Wi-Fi code (a pairing code stops working).
    Back,
    /// Show the paired phones.
    List,
    /// Forget a paired phone (by its room on the meeting server).
    Remove(String),
}

/// Requests for the Calendar page (`poni_core::calendar`, run by `services::helper`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarCmd {
    /// Add the calendar link on the clipboard.
    PasteLink,
    /// Stop reading this source (its id).
    Remove(String),
    /// Read every link again now.
    Refresh,
    /// Make (or find) the note of this event (its id) and open the Meeting page on it.
    Notes(String),
}

/// Requests for Notifications (`services::notifications`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotifyCmd {
    /// Ask Windows to let the island read notifications (its question).
    Ask,
    /// Look again at what Windows allows: the page opened, and the person
    /// may have changed it in Windows' settings meanwhile.
    Check,
    /// Open Windows' settings for which apps may read notifications.
    OpenWindowsSettings,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Media(MediaCmd),
    /// Open a file/folder with its default handler.
    OpenPath(String),
    /// Settings › Meeting apps: add the host of the link on the clipboard.
    MeetingAddLink,
    /// Settings › Meeting apps: list the running apps with windows to pick from.
    MeetingPickApps,
    /// Show a file in Explorer.
    RevealPath(String),
    /// Begin an OLE drag of these paths out of the island.
    DragOut(Vec<String>),
    /// Request a thumbnail for a shelf item (async; arrives as `AppEvent::ShelfThumb`).
    LoadThumb(String),
    /// Give the island keyboard focus for a text field.
    FocusText,
    /// The Script page's Paste: the clipboard's text, line breaks kept,
    /// becomes the script.
    ScriptPaste,
    /// Drop keyboard focus.
    BlurText,
    /// Persist `AppState::store` soon.
    SaveStore,
    /// Persist `AppState::settings` now (after a page toggled a setting).
    SaveSettings,
    /// Open the Settings window, or bring it forward (the gear, Windows).
    OpenSettings,
    /// The same, on one section (the Captions tab's "Manage" opens Captions and languages).
    OpenSettingsAt(crate::settings_window::Section),
    /// Captions tab › Speed › Restore Windows captions: put Live Captions' window back on screen.
    RestoreLiveCaptions,
    SetPage(PageKind),
    /// A menu entry chosen in the island's Menu list (same as the tray menu).
    Menu(crate::tray::MenuCmd),
    /// Keep the island open even when the cursor leaves.
    SetPinned(bool),
    Collapse,
    Play(Sound),
    /// Open a URL in the default browser.
    OpenUrl(String),
    /// Update to the version the update file offers: install it (Windows,
    /// once its Setup is downloaded), or its release page or DMG.
    Update,
    /// Install it the next time the app starts (Windows).
    InstallOnNextStart,
    /// Settings' Check now: read the update file now, as the menu's Check
    /// for updates… does (`AppState::update.said` takes the answer).
    CheckForUpdates,
    /// Start/stop the 1 Hz system-stats sampler.
    WantStats(bool),
    /// Start with Windows on or off (the Settings page's switch).
    SetAutostart(bool),
    /// Open the System page on this module (a Today ring was clicked).
    OpenSystem(poni_core::sysmon::Module),
    /// Request an app's icon for the System page (arrives in `AppState::app_icons`).
    LoadAppIcon(String),
    /// Show over games: find out whether Windows lets Poni read frames
    /// (the answer lands in `AppState::game.access`).
    CheckFps,
    /// Show over games: ask Windows once for the right to read frames.
    AllowFps,
    Phone(PhoneCmd),
    Pair(PairCmd),
    /// Get one of Prayer times' online city files ("ed", "near/55_-5"; the
    /// answer: `AppEvent::Cities`).
    GetCities(String),
    /// Notifications.
    Notify(NotifyCmd),
    /// `POST /notes` to the helper with this body (a decision on a page).
    HelperPost(String),
    /// A kept transcript (this id) becomes a meeting (PMM-015).
    SaveAsMeeting(String),
    /// Ask the helper again now.
    HelperPoll,
    Calendar(CalendarCmd),
    /// Start (true) or stop (false) captions from what the PC plays.
    Captions(bool),
    /// Live › Start captions: from Live's source (Room, This PC or Both; PMM-019).
    LiveCaptions,
    /// Live › source picker: listen to this from now on.
    LiveSource(poni_core::capture::Source),
    /// Live › mic chip: the next of Windows' microphones.
    NextMic,
    /// Live › mic blocked: Windows' Settings › Privacy & security › Microphone.
    MicPrivacy,
    /// Read a transcript from the clipboard and save it as a meeting (Meeting page).
    PasteTranscript,
    /// Open a meeting's join link: the Teams app when it is installed, else the browser.
    JoinMeeting(String),
    /// Meeting tab › Paste a meeting link: join the link on the clipboard (PMM-018).
    JoinPastedLink,
    /// Meeting tab › Always treat <host> as a meeting: add it to Meeting apps.
    MeetingAddHost(String),
    /// Meeting tab › Try again: ask for the notes so far now.
    CallNotesRefresh,
    /// Ask the engine which models it has.
    ModelsRefresh,
    /// Download this model.
    ModelPull(poni_core::models::Kind),
    /// Switch the engine to this model (`models::OFF` for no translation).
    ModelSelect(poni_core::models::Kind, String),
    /// Pick a folder for this model and move it there (the engine copies, verifies, then switches).
    ModelFolder(poni_core::models::Kind),
    /// Move this model back to the engine's default folder.
    ModelFolderReset(poni_core::models::Kind),
    /// Model library: download this model by id (a catalog model or a fast pair).
    ModelPullId(String),
    /// Model library: delete this model's files (never the one in use; the engine refuses it too).
    ModelDelete(String),
    /// Settings › Models › Speed: look at the engine's speed tests now.
    SpeedRefresh,
    /// Run the speed test of this model id.
    SpeedTest(String),
    /// Run the speed test of every downloaded model.
    SpeedTestAll,
    /// The Downloads page (`pages::downloads`).
    Download(DownloadCmd),
    /// A Windows language feature (`poni_core::winlang`): Settings' rows and
    /// the Music page's hint.
    WinLang(WinLangCmd),
}

/// What the Windows language rows ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WinLangCmd {
    /// Add the feature with this id (`poni_core::winlang::ALL`): Windows asks
    /// for permission first.
    Install(&'static str),
    /// Look again at what Windows has.
    Check,
    /// Open Windows' own page for adding a language.
    OpenSettings,
}

/// What the Downloads page asks for.
#[derive(Clone, Debug, PartialEq)]
pub enum DownloadCmd {
    /// Download `url`'s video or sound.
    Start { url: String, mode: poni_core::ytdlp::Mode },
    /// Stop a download; one still waiting its turn leaves the list (Cancel).
    Stop(u64),
    /// Take a finished, failed or stopped job off the list.
    Remove(u64),
    ClearDone,
    /// Open the finished file, or show it in its folder.
    Open(u64),
    Reveal(u64),
    /// Put the clipboard's link in the page's link field.
    PasteLink,
}
