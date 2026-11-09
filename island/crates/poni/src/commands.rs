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
    /// Notifications.
    Notify(NotifyCmd),
    /// `POST /notes` to the helper with this body (a decision on a page).
    HelperPost(String),
    /// Ask the helper again now.
    HelperPoll,
    Calendar(CalendarCmd),
}
