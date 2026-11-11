//! The Settings window's content: every setting yravgSubMeetly has, in a
//! sidebar of sections (General, Appearance, Island, Media and lyrics,
//! Pop-ups, Tabs, Add-ons, Focus, Prayer, AI, Oyenza, About), called
//! Advanced settings. The last row of the island's Settings page (behind
//! the gear) and the menu's Advanced settings… open it, in a window of its
//! own: on Windows a borderless one (`settings_host.rs`), on the Mac a real
//! window with the system's title bar (`mac/settings_host.rs`). Both draw
//! this [`View`].
//!
//! It draws with the island's widgets ([`Ui`], the Settings page's switch
//! and picker) on the same [`AppState`], and changes settings the way the
//! island's pages do: `Command::SaveSettings` after a change, which the app
//! applies as a menu change is. Each section is a list of [`Block`]s, most
//! of them groups of rows ([`Item`]: a label, a dim line under it, and a
//! switch, a picker, a stepper or a button), laid out from the top; a click
//! comes back as an [`Act`] on the row's [`Key`] ([`apply`]).
//!
//! It follows the system's light or dark mode: the window's own surfaces in
//! [`Surfaces`], and everything on them through the Glass look of that mode,
//! which turns the island's white ink dark on the light window.

use crate::commands::{Command, WinLangCmd};
use crate::gfx::{Canvas, TextStyle, Weight};
use crate::icons::Icon;
use crate::pages::settings::picker_width;
use crate::pages::PageKind;
use crate::pill::status;
use crate::state::AppState;
use crate::ui::{wid, wid_n, CursorKind, Hit, Input, MouseButton, PillStyle, Ui, PILL_GAP, PILL_SMALL};
use crate::version::VERSION;
use poni_core::capture;
use poni_core::geom::{palette, Color, Point, Rect};
use poni_core::library::{Action as LibAction, Filter, Light};
use poni_core::models::Kind;
use poni_core::settings::{IdleStyle, MonitorChoice, PrayerSound, Theme, TranslationColor};
use std::collections::HashMap;

/// The card, in DIPs. Windows' window gives it room for its shadow and is
/// less tall on a short screen (the content scrolls).
pub const CARD_W: f32 = 840.0;
pub const CARD_H: f32 = 580.0;
/// Its corners when the window draws its own (Windows).
const RADIUS: f32 = 14.0;
const SIDEBAR_W: f32 = 220.0;
/// The content column: its left and right padding, and where it starts.
const PAD: f32 = 28.0;
const TITLE_Y: f32 = 22.0;
const TITLE_H: f32 = 30.0;
const CONTENT_Y: f32 = 70.0;
/// Sidebar rows.
const NAV_Y: f32 = 64.0;
const NAV_H: f32 = 32.0;
const NAV_GAP: f32 = 2.0;
const NAV_TILE: f32 = 22.0;
/// Rows: one line, or a label over a dim line.
const ROW_H: f32 = 40.0;
const ROW_H_SUB: f32 = 52.0;
const ROW_PAD: f32 = 14.0;
/// Radius of a model row's andon light.
const LIGHT_R: f32 = 5.0;
const GROUP_TITLE_H: f32 = 24.0;
const GROUP_GAP: f32 = 18.0;
const GROUP_R: f32 = 10.0;
const SWITCH_W: f32 = 30.0;
const SWITCH_H: f32 = 18.0;
const PICKER_H: f32 = 26.0;
/// The picker's and the switch's insides, as the island's Settings page has them.
const SEG_INSET: f32 = 2.0;
const SEG_PAD: f32 = 11.0;
const KNOB_INSET: f32 = 2.0;
const STEP_BTN: f32 = 26.0;
const STEP_VALUE_W: f32 = 84.0;
/// The Appearance section's theme cards.
const THEME_CARD_H: f32 = 154.0;
const THEME_PREVIEW_H: f32 = 74.0;
const THEME_GAP: f32 = 12.0;
/// A wheel notch scrolls this far.
pub const WHEEL_STEP: f32 = 48.0;

/// The window's own surfaces, painted as they are; text and widgets on
/// them go through the look of the same mode.
#[derive(Clone, Copy, Debug)]
pub struct Surfaces {
    pub ground: Color,
    sidebar: Color,
    group: Color,
    group_hover: Color,
    group_press: Color,
}

const DARK: Surfaces = Surfaces {
    ground: Color::hex(0x1C1C1E),
    sidebar: Color::hex(0x242426),
    group: Color::hex(0x2C2C2E),
    group_hover: Color::hex(0x333336),
    group_press: Color::hex(0x3A3A3D),
};
const LIGHT: Surfaces = Surfaces {
    ground: Color::hex(0xF2F2F7),
    sidebar: Color::hex(0xE6E6EB),
    group: Color::hex(0xFFFFFF),
    group_hover: Color::hex(0xF7F7F9),
    group_press: Color::hex(0xEDEDF1),
};

pub fn surfaces(light: bool) -> Surfaces {
    if light {
        LIGHT
    } else {
        DARK
    }
}

/// Lines and edges, in the look's ink.
const RULE: Color = Color::white(0.08);
const EDGE: Color = Color::white(0.10);
/// Behind the theme cards' little screens.
const WALLPAPER: Color = Color::hex(0x3B4A7A);

/// The window's sections, in the sidebar's order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    General,
    Appearance,
    Island,
    Music,
    Speech,
    Models,
    Popups,
    Tabs,
    Addons,
    Focus,
    Prayer,
    About,
}

impl Section {
    pub const ALL: [Section; 12] = [
        Section::General,
        Section::Appearance,
        Section::Island,
        Section::Music,
        Section::Speech,
        Section::Models,
        Section::Popups,
        Section::Tabs,
        Section::Addons,
        Section::Focus,
        Section::Prayer,
        Section::About,
    ];

    pub fn title(self) -> &'static str {
        match self {
            Section::General => "General",
            Section::Appearance => "Appearance",
            Section::Island => "Island",
            Section::Music => "Media and lyrics",
            Section::Speech => "Captions and languages",
            Section::Models => "Models",
            Section::Popups => "Pop-ups",
            Section::Tabs => "Tabs",
            Section::Addons => "Add-ons",
            Section::Focus => "Focus",
            Section::Prayer => "Prayer times",
            Section::About => "About",
        }
    }

    /// For the self-test's file names.
    pub fn key(self) -> &'static str {
        match self {
            Section::General => "general",
            Section::Appearance => "appearance",
            Section::Island => "island",
            Section::Music => "music",
            Section::Speech => "speech",
            Section::Models => "models",
            Section::Popups => "popups",
            Section::Tabs => "tabs",
            Section::Addons => "addons",
            Section::Focus => "focus",
            Section::Prayer => "prayer",
            Section::About => "about",
        }
    }

    fn icon(self) -> Icon {
        match self {
            Section::General => Icon::Gear,
            Section::Appearance => Icon::Eye,
            Section::Island => Icon::AppWindow,
            Section::Music => Icon::Music,
            Section::Speech => Icon::Lyrics,
            Section::Models => Icon::Download,
            Section::Popups => Icon::Volume,
            Section::Tabs => Icon::App,
            Section::Addons => Icon::Addons,
            Section::Focus => Icon::Timer,
            Section::Prayer => Icon::Moon,
            Section::About => Icon::Gear,
        }
    }

    /// The colour of its tile in the sidebar.
    fn tint(self) -> Color {
        match self {
            Section::General => Color::hex(0x8E8E93),
            Section::Appearance => Color::hex(0x5E5CE6),
            Section::Island => palette::BLUE,
            Section::Music => palette::PINK,
            Section::Speech => palette::PURPLE,
            Section::Models => palette::YELLOW,
            Section::Popups => palette::CYAN,
            Section::Tabs => palette::GREEN,
            Section::Addons => Color::hex(0x0A84FF),
            Section::Focus => palette::ORANGE,
            Section::Prayer => Color::hex(0x30B0A0),
            Section::About => Color::hex(0x8E8E93),
        }
    }

    /// Prayer times has a section only while its add-on is on.
    pub fn shown(self, st: &AppState) -> bool {
        match self {
            Section::Prayer => st.prayer_on(),
            _ => true,
        }
    }
}

/// Where the engine reads a model downloaded by hand (`models::manual_dir` in the engine):
/// `%USERPROFILE%\yravgSubMeetly-models\<owner>--<name>`.
fn manual_model_dir(id: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join("yravgSubMeetly-models").join(id.replace('/', "--"))
}

/// A model's rows: the choice (steps through what the engine offers, with what is true of it
/// underneath) and, when downloading helps, a Download or Retry button.
fn model_items(m: &poni_core::models::Models, k: Kind) -> Vec<Item> {
    let d = m.describe(k);
    let value = m.step(k, 1).and_then(|_| m.chosen(k)).map(|id| m.label_of(&id));
    let mut pick = item(Key::ModelPick(k), k.label(), Some(&d.text), value.map_or(Ctl::None, Ctl::Stepper));
    if let Some(st) = m.chosen(k).and_then(|id| m.status(&id)) {
        pick = pick.lit(st);
    }
    let mut rows = vec![pick];
    if let Some(b) = d.button {
        rows.push(item(Key::ModelPull(k), &format!("{} download", k.label()), None, Ctl::Button(b)));
    }
    // A download that keeps failing (slow or blocked link): the files by hand from the browser.
    if let Some(id) = m.chosen(k) {
        let dir = manual_model_dir(&id);
        rows.push(item(Key::ModelManual(k), "Download by hand", Some(&format!("Opens the files page and this folder: save the model's files into {}", dir.display())), Ctl::Button("Open page")));
    }
    if let Some(p) = m.place(k) {
        rows.push(item(Key::ModelFolder(k), &format!("{} folder", k.label()), Some(&p.text), if p.change { Ctl::Button("Choose…") } else { Ctl::None }));
        if p.reset {
            rows.push(item(Key::ModelFolderReset(k), "Use the default folder", Some("Moves the model back"), Ctl::Button("Reset")));
        }
    }
    rows
}

/// Settings › Models › Summaries and AI: the engine's custom AI connector and default summary template.
fn ai_items(ai: &crate::ai::AiView) -> Vec<Item> {
    let set = |v: &str, empty: &'static str| if v.is_empty() { empty.to_string() } else { v.to_string() };
    let key = if ai.has_key { if ai.key_hint.is_empty() { "Saved. Never shown again.".to_string() } else { format!("Saved, ends in {}. Never shown again.", ai.key_hint) } } else { "Not set (some local servers need none)".to_string() };
    vec![
        switch(Key::AiEnabled, "Use my own AI model", Some("Off: everything stays on this computer. On: transcripts and questions go to your endpoint for summaries and Ask"), ai.enabled),
        item(Key::AiUrl, "Endpoint", Some(&set(&ai.base_url, "Copy an OpenAI-compatible URL (https://…/v1, or http://localhost:11434/v1 for Ollama), then press Paste")), Ctl::Button("Paste URL")),
        item(Key::AiModel, "Model name", Some(&set(&ai.model, "Copy the model's name, then press Paste")), Ctl::Button("Paste name")),
        item(Key::AiKey, "API key", Some(&key), Ctl::Button("Paste key")),
        item(Key::AiTest, "Check the connection", Some("Sends one tiny test message"), Ctl::Button("Test")),
        item(Key::SummaryTemplate, "Summary template", Some("How notes are laid out: General, Standup, 1:1, Sales call, Interview, Retro, Project status"), Ctl::Stepper(ai.template_name())),
    ]
}

/// Settings › Models › Download from: Hugging Face or ModelScope (modelscope.cn mirrors the
/// catalog and answers where huggingface.co is slow or blocked).
fn source_item(source: &str) -> Item {
    let at = poni_core::library::SOURCES.iter().position(|(k, _)| *k == source);
    let names = poni_core::library::SOURCES.iter().map(|(_, n)| *n).collect();
    item(Key::ModelSource, "Download from", Some("ModelScope when Hugging Face is slow or blocked"), Ctl::Choice(names, at))
}

/// Advanced settings › Models › Library: the filter, then one row per model it lets through with
/// its buttons. No search box here: the settings kit has no text field (the pill's group has one).
fn library_items(st: &AppState) -> Vec<Item> {
    let f = st.ui.lib_filter;
    let mut rows = vec![item(Key::LibFilter, "Show", None, Ctl::Choice(Filter::ALL.iter().map(|f| f.label()).collect(), Filter::ALL.iter().position(|x| *x == f)))];
    let shown = library_shown(st, "");
    if shown.is_empty() {
        rows.push(item(Key::LibLang, "No models here", Some("Try All, or start the engine from the tray menu"), Ctl::None));
    }
    for (i, e) in shown.iter().enumerate().take(u8::MAX as usize) {
        let acts = e.actions(&st.models);
        let ctl = if acts.is_empty() { Ctl::None } else { Ctl::Choice(acts.iter().map(|a| a.label()).collect(), None) };
        rows.push(item(Key::LibModel(i as u8), &e.c.label, Some(&e.sub(&st.models)), ctl).lit(&e.c.st));
    }
    rows
}

/// The library rows for the filter and `query`, with the person's spoken → translate-into languages.
pub fn library_shown<'a>(st: &'a AppState, query: &str) -> Vec<poni_core::library::Entry<'a>> {
    poni_core::library::shown(&st.models, st.ui.lib_filter, query, &st.settings.source_lang, &st.settings.target_lang)
}

/// What a library button does; shared with the pill's Captions › Models group.
pub fn library_act(st: &mut AppState, id: String, kind: Kind, pair: bool, dir: Option<String>, a: LibAction) {
    match a {
        LibAction::Use if !pair => st.cmd(Command::ModelSelect(kind, id)),
        LibAction::Download => st.cmd(Command::ModelPullId(id)),
        LibAction::ByHand => {
            let folder = manual_model_dir(&id);
            let _ = std::fs::create_dir_all(&folder);
            st.cmd(Command::OpenUrl(poni_core::library::files_url(&st.settings.model_source, &id)));
            st.cmd(Command::OpenPath(folder.display().to_string()));
        }
        LibAction::Folder => {
            if let Some(d) = dir {
                st.cmd(Command::OpenPath(d));
            }
        }
        LibAction::Delete => st.models.deleting = Some(id),
        LibAction::Confirm => st.cmd(Command::ModelDelete(id)),
        LibAction::Keep | LibAction::Use => st.models.deleting = None,
    }
}

/// The sections the sidebar lists now.
pub fn sections(st: &AppState) -> Vec<Section> {
    Section::ALL.into_iter().filter(|s| s.shown(st)).collect()
}

// ---------------------------------------------------------------- rows

/// What a row changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Autostart,
    Sounds,
    Clock24,
    SystemHistory,
    IdleLook,
    HoverDelay,
    TranslationColor,
    CloseDelay,
    Width,
    Display,
    Fullscreen,
    GameStats,
    GamePeek,
    Lyrics,
    Pronunciation,
    MediaActivity,
    LyricsOffset,
    Captions,
    AutoCaptions,
    DetectMeetings,
    ShowSpeakers,
    TranslateCaptions,
    LogCards,
    SpokenLang,
    TargetLang,
    LyricsTranslate,
    /// The choice of a model (steps through the engine's catalog).
    ModelPick(poni_core::models::Kind),
    /// The Download (or Retry) button of a model.
    ModelPull(poni_core::models::Kind),
    /// The folder a model is stored in, and its Choose button.
    ModelFolder(poni_core::models::Kind),
    /// Move a model back to the default folder.
    ModelFolderReset(poni_core::models::Kind),
    /// Download by hand: the model's files page and the folder the engine reads them from.
    ModelManual(poni_core::models::Kind),
    /// Model library: the On device / All / Recommended filter.
    LibFilter,
    ModelSource,
    /// Summaries and AI: the connector's switch, its three fields (pasted), a test, and the default template.
    AiEnabled,
    AiUrl,
    AiModel,
    AiKey,
    AiTest,
    SummaryTemplate,
    /// Model library: a row's buttons; the index into the filtered list.
    LibModel(u8),
    /// Languages on this PC: a line that only says something.
    LibLang,
    HudVolume,
    HudPower,
    HudBluetooth,
    RememberPage,
    StartPage,
    Tab(PageKind),
    FocusMin,
    ShortBreak,
    LongBreak,
    LongEvery,
    AutoBreaks,
    AutoFocus,
    PrayerSound,
    PrayerCountdown,
    PrayerPause,
    PrayerFollow,
    SettingsFile,
    DataFolder,
    ReleaseNotes,
    LyricsCredit,
    /// A Windows language feature's row (its place in `poni_core::winlang::ALL`).
    WinLang(usize),
    /// Open Windows' own page for adding a language.
    WinLangSettings,
    /// A built-in meeting family's switch.
    MeetingFamily(poni_core::meeting_source::Family),
    /// Remove the person's meeting app or host at this place in `meeting_apps`.
    MeetingRemove(usize),
    /// Add: the host of the meeting link on the clipboard.
    MeetingAddLink,
    /// Add: list the running apps to pick from.
    MeetingPickApps,
    /// Add the running app at this place in `AppState::meeting_pick`.
    MeetingPickApp(usize),
    OpenMeetingTab,
    /// Webhooks (the engine's, by their place in `AppState::webhooks`): the switch, Test, Remove; Add
    /// takes the URL on the clipboard; Info only says something.
    Webhook(u8),
    WebhookTest(u8),
    WebhookRemove(u8),
    WebhookAdd,
    WebhookInfo,
}

/// A row's control, at its right end.
#[derive(Clone, Debug, PartialEq)]
pub enum Ctl {
    /// `None` = not known yet (Start with Windows until it's read): dimmed.
    Switch(Option<bool>),
    /// A picker; `None` = none of its choices (a value typed into the file).
    Choice(Vec<&'static str>, Option<usize>),
    /// − and + around the value.
    Stepper(String),
    /// A button with this label.
    Button(&'static str),
    /// Nothing to press: the row only says something.
    None,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub key: Key,
    pub label: String,
    pub sub: Option<String>,
    pub ctl: Ctl,
    /// A model row's andon light, and its download bar (0 to 1) while one runs.
    pub light: Option<Light>,
    pub progress: Option<f32>,
}

fn item(key: Key, label: &str, sub: Option<&str>, ctl: Ctl) -> Item {
    Item { key, label: label.to_string(), sub: sub.map(str::to_string), ctl, light: None, progress: None }
}

impl Item {
    /// The light and bar of a model in state `st`.
    fn lit(mut self, st: &poni_core::models::Status) -> Item {
        self.light = Some(Light::of(st));
        self.progress = poni_core::library::progress(st);
        self
    }
}

/// Settings › General › Webhooks: the engine's list, one switch, Test and Remove each, and the Add row.
/// The kit has no text field: Paste URL reads the clipboard (as the calendar link does).
fn webhook_rows(st: &AppState) -> Vec<Item> {
    let w = &st.webhooks;
    let mut rows = Vec::new();
    for (i, h) in w.list.iter().enumerate().take(20) {
        let name = h.name();
        rows.push(item(Key::Webhook(i as u8), &name, Some(&h.sub()), Ctl::Switch(Some(h.enabled))));
        rows.push(item(Key::WebhookTest(i as u8), &format!("Send a test to {name}"), None, Ctl::Button("Test")));
        rows.push(item(Key::WebhookRemove(i as u8), &format!("Remove {name}"), None, Ctl::Button("Remove")));
    }
    rows.push(item(Key::WebhookAdd, "Add a webhook", Some("Copy its URL, then press Paste URL"), Ctl::Button("Paste URL")));
    if let Some(e) = &w.error {
        rows.push(item(Key::WebhookInfo, "The engine's webhooks are not available", Some(e), Ctl::None));
    }
    rows
}

fn switch(key: Key, label: &str, sub: Option<&str>, on: bool) -> Item {
    item(key, label, sub, Ctl::Switch(Some(on)))
}

/// Settings › Captions and languages › Meeting apps (canvas P07): the five families, the person's
/// own entries, the Add rows, and the running apps while the picker is open. The kit has no dialog
/// or text field: Paste link reads the clipboard (as the calendar does) and Pick lists apps inline.
fn meeting_rows(st: &AppState) -> Vec<Item> {
    use poni_core::meeting_source::{app_listed, Family, MeetingAppKind};
    let s = &st.settings;
    let mut rows: Vec<Item> = Family::ALL.iter().map(|&f| switch(Key::MeetingFamily(f), f.row().0, Some(f.row().1), f.on(&s.meeting_families))).collect();
    for (i, a) in s.meeting_apps.iter().enumerate() {
        let from = if a.kind == MeetingAppKind::Host { "a link" } else { "a running app" };
        rows.push(item(Key::MeetingRemove(i), &a.label, Some(&format!("Added from {from}: {}", a.value)), Ctl::Button("Remove")));
    }
    rows.push(item(Key::MeetingAddLink, "Add a meeting app or link", Some("Pick a running app or paste a meeting link"), Ctl::Button("Paste link")));
    match &st.meeting_pick {
        None => rows.push(item(Key::MeetingPickApps, "Add a running app", Some("Its process name is kept; remove it later from the list"), Ctl::Button("Pick"))),
        Some(apps) => rows.extend(apps.iter().enumerate().map(|(i, a)| {
            if app_listed(a, &s.meeting_apps) {
                item(Key::MeetingPickApp(i), a, Some("already in the list"), Ctl::None)
            } else {
                item(Key::MeetingPickApp(i), a, None, Ctl::Button("Add"))
            }
        })),
    }
    rows
}

/// A section's content, top to bottom.
#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    /// Rows on one card, with a caption above it.
    Group(Option<&'static str>, Vec<Item>),
    /// This copy's version, Check now, and a new version when there is one.
    Version,
    /// The four themes as cards with a small picture of each.
    Themes,
    /// The Add-ons page itself.
    Addons,
    /// A dim line of text.
    Note(&'static str),
}

/// What a click on a row's control did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Toggle,
    Pick(usize),
    Step(i32),
    Press,
}

/// How long the pointer rests on the island before it opens (ms).
const HOVER: [(u32, &str); 4] = [(220, "0.22 s"), (1500, "1.5 s"), (3000, "3 s"), (poni_core::settings::HOVER_OFF_MS, "Off")];
/// How long it stays open after the pointer leaves (ms).
const CLOSE: [(u32, &str); 3] = [(0, "At once"), (400, "Short"), (1000, "Long")];
const DISPLAYS: [(MonitorChoice, &str); 2] = [(MonitorChoice::Primary, "Main display"), (MonitorChoice::Cursor, "Under the pointer")];
const FULLSCREEN: [(bool, &str); 2] = [(true, "Hide"), (false, "Stay on top")];
const SOUNDS: [(PrayerSound, &str); 3] = [(PrayerSound::Adzan, "Adzan"), (PrayerSound::Tone, "Tone"), (PrayerSound::Silent, "Silent")];
const THEMES: [(Theme, &str, &str); 4] = [
    (Theme::Classic, "Classic", "A black island at the top edge"),
    (Theme::Glass, "Glass", "Frosted glass over your screen"),
    (Theme::Paper, "Paper", "Light card, floats below the top edge"),
    (Theme::Pill, "Pill", "Dark capsule, floats below the top edge"),
];
/// Start with Windows, or at login on a Mac (its menu bar says so).
const AUTOSTART: (&str, &str) = if cfg!(target_os = "macos") {
    ("Start at login", "Opens yravgSubMeetly when you log in")
} else {
    ("Start with Windows", "Opens yravgSubMeetly when you sign in")
};
const WIDTH_STEP: f32 = 20.0;
const OFFSET_STEP: i32 = 100;

fn chosen<T: PartialEq>(list: &[(T, &str)], v: T) -> Option<usize> {
    list.iter().position(|(x, _)| *x == v)
}

fn names<T>(list: &[(T, &'static str)]) -> Vec<&'static str> {
    list.iter().map(|(_, n)| *n).collect()
}

/// The preset nearest to `ms` (a hand-edited file's value lands on one).
fn nearest(list: &[(u32, &str)], ms: u32) -> Option<usize> {
    list.iter().enumerate().min_by_key(|(_, (v, _))| v.abs_diff(ms)).map(|(i, _)| i)
}

fn idle_name(s: IdleStyle, _theme: Theme) -> &'static str {
    match s {
        IdleStyle::Clock => "Clock",
        IdleStyle::Eyes => "Eyes",
        IdleStyle::Minimal => "Minimal",
        IdleStyle::Hidden => "Hidden",
        IdleStyle::Status => "Status",
    }
}

/// The pages the island may open on: its tabs, but not the Add-ons "+".
fn start_pages(st: &AppState) -> Vec<PageKind> {
    crate::pages::tabs(st).into_iter().filter(|p| *p != PageKind::Addons).collect()
}

fn minutes(m: u32) -> String {
    format!("{m} min")
}

/// The lyrics' shift as people say it.
fn offset_text(ms: i32) -> String {
    match ms {
        0 => "On time".into(),
        _ => format!("{}{:.1} s", if ms > 0 { "−" } else { "+" }, ms.unsigned_abs() as f32 / 1000.0),
    }
}

/// One row per Windows language feature (installed, or Install), and the way
/// round: Windows' own page for adding a language.
fn winlang_rows(st: &AppState) -> Vec<Item> {
    use poni_core::winlang::{State, ALL};
    let mut rows: Vec<Item> = ALL
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let (sub, label) = match st.winlang_state(f.id) {
                State::Unknown => (f.why.to_string(), "Check"),
                State::Installed => (format!("Installed \u{b7} {}", f.why), "Check again"),
                State::Missing => (format!("Not installed \u{b7} {}", f.why), "Install"),
                State::Installing => ("Installing\u{2026} allow Windows to make changes, then wait a moment".to_string(), "Installing\u{2026}"),
                State::Failed(why) => (why, "Try again"),
            };
            item(Key::WinLang(i), f.name, Some(&sub), Ctl::Button(label))
        })
        .collect();
    rows.push(item(Key::WinLangSettings, "Add a language yourself", Some("Windows Settings > Time & language"), Ctl::Button("Open")));
    rows
}

/// What `section` shows for `st`.
pub fn blocks(section: Section, st: &AppState) -> Vec<Block> {
    let s = &st.settings;
    match section {
        Section::General => {
            let mut rows = vec![
                item(Key::Autostart, AUTOSTART.0, Some(AUTOSTART.1), Ctl::Switch(st.ui.autostart)),
                switch(Key::Sounds, "Sounds", Some("A soft sound for timers, drops and reminders"), s.sounds),
                switch(Key::Clock24, "24-hour clock", None, s.use_24h),
            ];
            if s.system_on() {
                rows.push(switch(Key::SystemHistory, "Keep System page history", Some("The charts keep the last minute while the page is closed"), s.system_history));
            }
            vec![
                Block::Version,
                Block::Group(None, rows),
                Block::Group(Some("Webhooks"), webhook_rows(st)),
                Block::Note("A webhook is a web address the engine calls when a meeting is saved or action items appear (signed with a secret if you set one). The MCP server and the command line are in docs/INTEGRATIONS.md."),
            ]
        }
        Section::Appearance => {
            let looks = status::looks(s.theme);
            let look_names = looks.iter().map(|l| idle_name(*l, s.theme)).collect();
            let shown = status::shown(s.theme, s.idle_style);
            vec![
                Block::Themes,
                Block::Group(
                    Some("Island at rest"),
                    vec![item(Key::IdleLook, "Idle look", Some("What the closed island shows"), Ctl::Choice(look_names, looks.iter().position(|l| *l == shown)))],
                ),
            ]
        }
        Section::Island => {
            // The Mac's island goes where the notch is; the game readout is Windows'.
            let mut shows = Vec::new();
            if cfg!(windows) {
                shows.push(item(Key::Display, "Display", Some("The screen the island hangs on"), Ctl::Choice(names(&DISPLAYS), chosen(&DISPLAYS, s.monitor))));
            }
            shows.push(item(Key::Fullscreen, "In full-screen apps", Some("Games and videos that fill the screen"), Ctl::Choice(names(&FULLSCREEN), chosen(&FULLSCREEN, s.hide_in_fullscreen))));
            if cfg!(windows) {
                shows.push(switch(Key::GameStats, "Show FPS, GPU and CPU over games", Some("Keeps the island on top of full-screen apps"), s.game_stats));
                shows.push(switch(Key::GamePeek, "Only for a few seconds", Some("Then the island hides and adds no delay to the game"), s.game_peek));
            }
            vec![
                Block::Group(
                    Some("Opening and closing"),
                    vec![
                        item(Key::HoverDelay, "Opens after", Some("How long the pointer rests on the island first"), Ctl::Choice(names(&HOVER), nearest(&HOVER, s.hover_delay_ms))),
                        item(Key::TranslationColor, "Translation colour", Some("The translated line on the Live page"), Ctl::Choice(TranslationColor::ALL.iter().map(|c| c.name()).collect(), TranslationColor::ALL.iter().position(|c| *c == s.translation_color))),
                        item(Key::CloseDelay, "Closes", Some("Once the pointer leaves the open island"), Ctl::Choice(names(&CLOSE), nearest(&CLOSE, s.collapse_delay_ms))),
                        item(Key::Width, "Width when open", Some("Wider gives the pages more room"), Ctl::Stepper(format!("{:.0}", s.expanded_width))),
                    ],
                ),
                Block::Group(Some("Where it shows"), shows),
            ]
        }
        Section::Music => {
            let mut blocks = vec![
                Block::Group(
                    Some("Lyrics"),
                    vec![
                        switch(Key::Lyrics, "Synced lyrics", Some("Lyrics move with the song, from LRCLIB"), s.lyrics),
                        switch(Key::Pronunciation, "Lyrics pronunciation", Some("Romaji, pinyin and Korean under the lines"), s.lyrics_pronunciation),
                        item(Key::LyricsOffset, "Timing", Some("Shift every line earlier or later"), Ctl::Stepper(offset_text(s.lyrics_offset_ms))),
                    ],
                ),
                Block::Group(Some("Closed island"), vec![switch(Key::MediaActivity, "Show what's playing", Some("The song and its cover on the closed island"), s.show_media_activity)]),
            ];
            // Windows' own language features (the Mac has none).
            if cfg!(windows) {
                blocks.insert(1, Block::Group(Some("Windows language features"), winlang_rows(st)));
            }
            blocks
        }
        Section::Speech => vec![
            Block::Group(
                Some("Captions"),
                vec![
                    switch(Key::Captions, "Caption what this PC plays", Some("The engine writes what it hears on the island, in the language it hears"), st.capture.running()),
                    switch(Key::DetectMeetings, "Tell me when a meeting starts", Some("A meeting app using the microphone, or a calendar meeting; it only tells you, nothing is recorded"), s.detect_meetings),
                    switch(Key::AutoCaptions, "Start captions by themselves", Some("When the PC plays sound (a call, a video, a meeting; not a music app); they stop after it ends"), s.auto_captions),
                    switch(Key::ShowSpeakers, "Show who is speaking", Some("Names the speaker in front of a caption line when the engine could tell (You, Others, Speaker 2); a reading aid, not exact"), s.show_speakers),
                    switch(Key::TranslateCaptions, "Translate captions", Some("A second line in the language under Translate into (English by default)"), s.translate_captions),
                    item(Key::LogCards, "Recent lines", Some("Cards of the lines before the caption on Live; Off hides them"), Ctl::Stepper(if s.log_cards == 0 { "Off".to_string() } else { s.log_cards.to_string() })),
                ],
            ),
            Block::Group(Some("Meeting apps"), meeting_rows(st)),
            Block::Group(None, vec![switch(Key::OpenMeetingTab, "Open the Meeting tab when a meeting starts", Some("Otherwise captions start on Live and the tab only shows in the row"), s.open_meeting_tab)]),
            Block::Group(
                Some("Languages"),
                vec![
                    item(Key::SpokenLang, "Spoken language", Some("What the sound is in; Auto-detect works it out"), Ctl::Stepper(capture::lang_name(&s.source_lang))),
                    item(Key::TargetLang, "Translate into", Some("Captions and synced lyrics are translated into this"), Ctl::Stepper(capture::lang_name(&s.target_lang))),
                ],
            ),
            Block::Group(Some("Lyrics"), vec![switch(Key::LyricsTranslate, "Translate synced lyrics", Some("A second row under the sung line; needs a translation model"), s.lyrics_translate)]),
            Block::Group(Some("Languages on this PC"), poni_core::library::language_rows(&st.models).into_iter().map(|(name, text)| item(Key::LibLang, name, Some(&text), Ctl::None)).collect()),
        ],
        Section::Models => [Block::Group(Some("Downloads"), vec![source_item(&s.model_source)])]
            .into_iter()
            .chain([Block::Group(Some("Summaries and AI"), ai_items(&st.ai))])
            .chain([Kind::Asr, Kind::Translate].into_iter().map(|k| Block::Group(Some(if k == Kind::Asr { "Speech recognition" } else { "Translation" }), model_items(&st.models, k))))
            .chain([Block::Group(Some("Library"), library_items(st))])
            .collect(),
        Section::Popups => vec![Block::Group(
            Some("The island shows a pop-up for"),
            vec![
                switch(Key::HudVolume, "Volume", Some("When you change the volume or mute"), s.hud_volume),
                switch(Key::HudPower, "Charger and battery", Some("When you plug in, unplug or run low"), s.hud_power),
                switch(Key::HudBluetooth, "Bluetooth", Some("When headphones and other devices connect"), s.hud_bluetooth),
            ],
        )],
        Section::Tabs => {
            let pages = start_pages(st);
            let start = PageKind::from_key(&s.start_page);
            let start_name = if pages.contains(&start) { start.title() } else { pages.first().map_or("Media", |p| p.title()) };
            let mut open = vec![switch(Key::RememberPage, "Open where you left off", Some("The page you last had open"), s.remember_page)];
            if !s.remember_page {
                open.push(item(Key::StartPage, "Opens on", None, Ctl::Stepper(start_name.to_string())));
            }
            // Notifications only in a copy that can read them; off, nothing listens.
            let tabs = crate::pages::hideable_tabs(st)
                .iter()
                .map(|&p| {
                    let sub = match p {
                        PageKind::Notifications => Some("Messages from WhatsApp, Telegram and your phone"),
                        PageKind::Call => Some("Shown while a meeting is running, and 10 minutes after"),
                        PageKind::Captions => Some("Every caption and translation setting on the pill"),
                        _ => None,
                    };
                    item(Key::Tab(p), p.title(), sub, Ctl::Switch(Some(!st.tab_hidden(p))))
                })
                .collect();
            vec![Block::Group(Some("When the island opens"), open), Block::Group(Some("Tabs in the island"), tabs), Block::Note("The add-ons' pages always have a tab.")]
        }
        Section::Addons => vec![Block::Addons],
        Section::Focus => {
            let p = &s.pomodoro;
            let every = match p.long_every {
                0 => "Never".to_string(),
                1 => "1 session".to_string(),
                n => format!("{n} sessions"),
            };
            vec![
                Block::Group(
                    Some("Lengths"),
                    vec![
                        item(Key::FocusMin, "Focus", None, Ctl::Stepper(minutes(p.focus_min))),
                        item(Key::ShortBreak, "Short break", None, Ctl::Stepper(minutes(p.short_break_min))),
                        item(Key::LongBreak, "Long break", None, Ctl::Stepper(minutes(p.long_break_min))),
                        item(Key::LongEvery, "Long break after", Some("Focus sessions before a long break"), Ctl::Stepper(every)),
                    ],
                ),
                Block::Group(
                    Some("Starting by itself"),
                    vec![
                        switch(Key::AutoBreaks, "Breaks", Some("A break starts when a focus session ends"), p.auto_start_breaks),
                        switch(Key::AutoFocus, "Focus sessions", Some("The next session starts when a break ends"), p.auto_start_focus),
                    ],
                ),
            ]
        }
        Section::Prayer => {
            let p = &s.prayer;
            let countdown = if p.remind_before_min == 0 { "Off".to_string() } else { minutes(p.remind_before_min) };
            vec![
                Block::Group(
                    Some("When it's time"),
                    vec![
                        item(Key::PrayerSound, "Sound", Some("Subuh plays the tone"), Ctl::Choice(names(&SOUNDS), chosen(&SOUNDS, p.sound))),
                        switch(Key::PrayerPause, "Pause music for the adzan", None, p.pause_music),
                        item(Key::PrayerCountdown, "Countdown before each prayer", Some("On the closed island"), Ctl::Stepper(countdown)),
                    ],
                ),
                Block::Group(Some("Place"), vec![switch(Key::PrayerFollow, "Follow my location", Some("Windows' location picks the nearest place"), p.follow_location)]),
                Block::Note("Pick a place by hand on the island's Prayer page."),
            ]
        }
        Section::About => vec![
            Block::Version,
            Block::Group(
                None,
                vec![
                    item(Key::ReleaseNotes, "What's new", Some("This version's release notes"), Ctl::Button("Open")),
                    item(Key::LyricsCredit, "Lyrics", Some("Synced lyrics come from LRCLIB"), Ctl::Button("lrclib.net")),
                ],
            ),
            Block::Group(
                Some("Files"),
                vec![
                    item(Key::SettingsFile, "Settings file", Some("settings.json, the same settings as a file"), Ctl::Button("Open")),
                    item(Key::DataFolder, "Data folder", Some("Tasks, the Shelf and your Focus history"), Ctl::Button("Open")),
                ],
            ),
        ],
    }
}

/// The widget id of `key`'s row in `section` (the self-test's film).
#[cfg(windows)]
pub fn row_id(section: Section, st: &AppState, key: Key) -> Option<u64> {
    blocks(section, st).iter().enumerate().find_map(|(bi, b)| match b {
        Block::Group(_, items) => items.iter().position(|it| it.key == key).map(|ri| wid_n(&format!("settingswin.row.{bi}"), ri as u64)),
        _ => None,
    })
}

/// The widget id of `section`'s row in the sidebar (the self-test's film).
#[cfg(windows)]
pub fn nav_id(st: &AppState, section: Section) -> Option<u64> {
    sections(st).iter().position(|s| *s == section).map(|i| wid_n("settingswin.nav", i as u64))
}

/// Step a number of minutes: by 5, by 1 below 5.
fn step_min(v: u32, d: i32, lo: u32, hi: u32) -> u32 {
    let by = if (d < 0 && v <= 5) || (d > 0 && v < 5) { 1 } else { 5 };
    (v as i64 + d as i64 * by).clamp(lo as i64, hi as i64) as u32
}

/// Carry out `act` on the row `key`. Settings save through
/// `Command::SaveSettings`, as the island's pages save them.
pub fn apply(st: &mut AppState, key: Key, act: Act) {
    let theme = st.settings.theme;
    let s = &mut st.settings;
    let step = if let Act::Step(d) = act { d } else { 0 };
    match key {
        Key::Autostart => {
            if let Some(on) = st.ui.autostart {
                st.cmd(Command::SetAutostart(!on));
            }
            return;
        }
        Key::Sounds => s.sounds = !s.sounds,
        Key::Clock24 => s.use_24h = !s.use_24h,
        Key::SystemHistory => s.system_history = !s.system_history,
        Key::IdleLook => {
            let looks = status::looks(theme);
            match act {
                Act::Pick(i) if i < looks.len() => s.idle_style = looks[i],
                _ => return,
            }
        }
        Key::HoverDelay => match act {
            Act::Pick(i) if i < HOVER.len() => s.hover_delay_ms = HOVER[i].0,
            _ => return,
        },
        Key::TranslationColor => match act {
            Act::Pick(i) if i < TranslationColor::ALL.len() => s.translation_color = TranslationColor::ALL[i],
            _ => return,
        },
        Key::CloseDelay => match act {
            Act::Pick(i) if i < CLOSE.len() => s.collapse_delay_ms = CLOSE[i].0,
            _ => return,
        },
        Key::Width => s.expanded_width = (s.expanded_width + step as f32 * WIDTH_STEP).clamp(480.0, 900.0),
        Key::Display => match act {
            Act::Pick(i) if i < DISPLAYS.len() => s.monitor = DISPLAYS[i].0,
            _ => return,
        },
        Key::Fullscreen => match act {
            Act::Pick(i) if i < FULLSCREEN.len() => s.hide_in_fullscreen = FULLSCREEN[i].0,
            _ => return,
        },
        Key::GameStats => s.game_stats = !s.game_stats,
        Key::GamePeek => s.game_peek = !s.game_peek,
        Key::Lyrics => s.lyrics = !s.lyrics,
        Key::Pronunciation => s.lyrics_pronunciation = !s.lyrics_pronunciation,
        Key::MediaActivity => s.show_media_activity = !s.show_media_activity,
        // + shows the lines later, as people hear a late line.
        Key::LyricsOffset => s.lyrics_offset_ms = (s.lyrics_offset_ms - step * OFFSET_STEP).clamp(-5000, 5000),
        Key::Captions => {
            let on = st.capture.running();
            st.cmd(Command::Captions(!on));
            return;
        }
        Key::AutoCaptions => s.auto_captions = !s.auto_captions,
        Key::DetectMeetings => s.detect_meetings = !s.detect_meetings,
        Key::ShowSpeakers => s.show_speakers = !s.show_speakers,
        Key::AiEnabled => {
            let on = !st.ai.enabled;
            st.cmd(Command::Ai(crate::ai::AiCmd::Enable(on)));
            return;
        }
        Key::AiUrl => {
            st.cmd(Command::Ai(crate::ai::AiCmd::PasteUrl));
            return;
        }
        Key::AiModel => {
            st.cmd(Command::Ai(crate::ai::AiCmd::PasteModel));
            return;
        }
        Key::AiKey => {
            st.cmd(Command::Ai(crate::ai::AiCmd::PasteKey));
            return;
        }
        Key::AiTest => {
            st.cmd(Command::Ai(crate::ai::AiCmd::Test));
            return;
        }
        Key::SummaryTemplate => {
            if step != 0 {
                let next = st.ai.step_template(step);
                st.cmd(Command::Ai(crate::ai::AiCmd::SetTemplate(next)));
            }
            return;
        }
        Key::TranslateCaptions => s.translate_captions = !s.translate_captions,
        Key::LogCards => s.log_cards = poni_core::history_cards::clamp_count((s.log_cards as i32 + step).clamp(0, poni_core::history_cards::MAX_CARDS as i32) as u8),
        Key::SpokenLang => s.source_lang = capture::step_lang(&s.source_lang, step, true).into(),
        Key::TargetLang => s.target_lang = capture::step_lang(&s.target_lang, step, false).into(),
        Key::LyricsTranslate => s.lyrics_translate = !s.lyrics_translate,
        Key::ModelPick(k) => {
            // A model not on disk waits for its Download button; one that is switches at once.
            let Some(id) = st.models.step(k, step).filter(|_| step != 0) else { return };
            let now = st.models.selected(k).as_deref() == Some(id.as_str());
            if st.models.switchable(k, &id) {
                st.cmd(Command::ModelSelect(k, id.clone()));
            }
            st.models.set_pick(k, (!now).then_some(id));
            return;
        }
        Key::ModelPull(k) => {
            st.cmd(Command::ModelPull(k));
            return;
        }
        Key::ModelFolder(k) => {
            st.cmd(Command::ModelFolder(k));
            return;
        }
        Key::ModelManual(k) => {
            if let Some(id) = st.models.chosen(k) {
                let dir = manual_model_dir(&id);
                let _ = std::fs::create_dir_all(&dir);
                st.cmd(Command::OpenUrl(poni_core::library::files_url(&st.settings.model_source, &id)));
                st.cmd(Command::OpenPath(dir.display().to_string()));
            }
            return;
        }
        Key::ModelFolderReset(k) => {
            st.cmd(Command::ModelFolderReset(k));
            return;
        }
        Key::ModelSource => {
            let Act::Pick(i) = act else { return };
            let Some((key, _)) = poni_core::library::SOURCES.get(i) else { return };
            s.model_source = (*key).into();
        }
        Key::LibFilter => {
            if let Act::Pick(i) = act {
                st.ui.lib_filter = Filter::ALL.get(i).copied().unwrap_or_default();
                st.models.deleting = None;
            }
            return;
        }
        Key::LibModel(n) => {
            let Act::Pick(i) = act else { return };
            let Some((id, kind, pair, dir, a)) = library_shown(st, "").get(n as usize).and_then(|e| Some((e.c.id.clone(), e.c.kind, e.pair, e.c.st.dir.clone(), *e.actions(&st.models).get(i)?))) else { return };
            library_act(st, id, kind, pair, dir, a);
            return;
        }
        Key::LibLang => return,
        Key::HudVolume => s.hud_volume = !s.hud_volume,
        Key::HudPower => s.hud_power = !s.hud_power,
        Key::HudBluetooth => s.hud_bluetooth = !s.hud_bluetooth,
        Key::RememberPage => s.remember_page = !s.remember_page,
        Key::StartPage => {
            let pages = start_pages(st);
            if pages.is_empty() || step == 0 {
                return;
            }
            let at = pages.iter().position(|p| p.key() == st.settings.start_page).unwrap_or(0) as i32;
            let next = (at + step).rem_euclid(pages.len() as i32) as usize;
            st.settings.start_page = pages[next].key().to_string();
        }
        Key::Tab(p) => s.toggle_tab(p.key()),
        Key::FocusMin => s.pomodoro.focus_min = step_min(s.pomodoro.focus_min, step, 1, 180),
        Key::ShortBreak => s.pomodoro.short_break_min = (s.pomodoro.short_break_min as i32 + step).clamp(1, 60) as u32,
        Key::LongBreak => s.pomodoro.long_break_min = step_min(s.pomodoro.long_break_min, step, 1, 120),
        Key::LongEvery => s.pomodoro.long_every = (s.pomodoro.long_every as i32 + step).clamp(0, 12) as u32,
        Key::AutoBreaks => s.pomodoro.auto_start_breaks = !s.pomodoro.auto_start_breaks,
        Key::AutoFocus => s.pomodoro.auto_start_focus = !s.pomodoro.auto_start_focus,
        Key::PrayerSound => match act {
            Act::Pick(i) if i < SOUNDS.len() => s.prayer.sound = SOUNDS[i].0,
            _ => return,
        },
        Key::PrayerCountdown => s.prayer.remind_before_min = step_min(s.prayer.remind_before_min, step, 0, 60),
        Key::PrayerPause => s.prayer.pause_music = !s.prayer.pause_music,
        Key::PrayerFollow => s.prayer.follow_location = !s.prayer.follow_location,
        Key::SettingsFile => {
            st.cmd(Command::OpenPath(crate::paths::settings_path().to_string_lossy().into_owned()));
            return;
        }
        Key::DataFolder => {
            st.cmd(Command::OpenPath(crate::paths::data_dir().to_string_lossy().into_owned()));
            return;
        }
        Key::ReleaseNotes => {
            st.cmd(Command::OpenUrl(crate::version::notes_url()));
            return;
        }
        Key::LyricsCredit => {
            st.cmd(Command::OpenUrl("https://lrclib.net".into()));
            return;
        }
        Key::WinLang(i) => {
            let Some(f) = poni_core::winlang::ALL.get(i) else { return };
            let cmd = if st.winlang_state(f.id).can_install() { WinLangCmd::Install(f.id) } else { WinLangCmd::Check };
            // A press while it installs adds nothing: the check would only race the install.
            if st.winlang_state(f.id) != poni_core::winlang::State::Installing {
                st.cmd(Command::WinLang(cmd));
            }
            return;
        }
        Key::WinLangSettings => {
            st.cmd(Command::WinLang(WinLangCmd::OpenSettings));
            return;
        }
        Key::MeetingFamily(f) => {
            let on = f.switch(&mut s.meeting_families);
            *on = !*on;
        }
        Key::MeetingRemove(i) => {
            if i >= s.meeting_apps.len() {
                return;
            }
            s.meeting_apps.remove(i);
        }
        Key::MeetingAddLink => {
            st.cmd(Command::MeetingAddLink);
            return;
        }
        Key::Webhook(i) => {
            if let Some(h) = st.webhooks.list.get(i as usize) {
                st.cmd(Command::WebhookEnable(h.id.clone(), !h.enabled));
            }
            return;
        }
        Key::WebhookTest(i) => {
            if let Some(h) = st.webhooks.list.get(i as usize) {
                st.cmd(Command::WebhookTest(h.id.clone()));
            }
            return;
        }
        Key::WebhookRemove(i) => {
            if let Some(h) = st.webhooks.list.get(i as usize) {
                st.cmd(Command::WebhookRemove(h.id.clone()));
            }
            return;
        }
        Key::WebhookAdd => {
            st.cmd(Command::WebhookAddFromClipboard);
            return;
        }
        Key::WebhookInfo => return,
        Key::MeetingPickApps => {
            st.cmd(Command::MeetingPickApps);
            return;
        }
        Key::MeetingPickApp(i) => {
            let Some(name) = st.meeting_pick.as_ref().and_then(|a| a.get(i)).cloned() else { return };
            if !poni_core::meeting_source::add_app(&mut st.settings.meeting_apps, &name) {
                return;
            }
            st.meeting_pick = None;
        }
        Key::OpenMeetingTab => s.open_meeting_tab = !s.open_meeting_tab,
    }
    st.cmd(Command::SaveSettings);
}

// ---------------------------------------------------------------- the view

/// Where the content goes in the window that shows it.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    /// The card: what the window shows of the content (DIPs).
    pub card: Rect,
    /// The window draws its own shadow, edge and close button (Windows' is
    /// borderless); the Mac's window has the system's.
    pub own_chrome: bool,
    /// Room at the top of the sidebar for the Mac's window buttons.
    pub top: f32,
    /// Everything lands where it's going at once: the system asks for less
    /// motion, or a picture is taken.
    pub still: bool,
}

/// What a frame of the window asked for.
#[derive(Clone, Copy, Debug, Default)]
pub struct Painted {
    /// A click changed something: draw it again (after the app ran the
    /// commands it pushed).
    pub again: bool,
    /// The close button was clicked.
    pub close: bool,
    /// Something still glides: draw the next frame at the display's rate.
    pub moving: bool,
}

/// The content and its input, whichever window shows it.
pub struct View {
    pub input: Input,
    hits: Vec<Hit>,
    pub section: Section,
    scroll: Scroll,
    motion: Motion,
    /// Something it shows changed: draw it again.
    pub dirty: bool,
    /// Something glided in the last frame: the window keeps drawing frames.
    pub moving: bool,
}

/// `a` and `b` together.
fn span(a: Rect, b: Rect) -> Rect {
    let (x0, y0) = (a.x.min(b.x), a.y.min(b.y));
    Rect::new(x0, y0, a.right().max(b.right()) - x0, a.bottom().max(b.bottom()) - y0)
}

/// How far the content is scrolled (DIPs): where it is, where it's going
/// (a wheel glides there; a trackpad goes there at once, under the
/// fingers), and how tall it was last drawn.
#[derive(Default)]
struct Scroll {
    at: f32,
    to: f32,
    content_h: f32,
    /// A trackpad's points since the last frame.
    pending: f32,
}

impl View {
    pub fn new(section: Section) -> Self {
        View { input: Input::default(), hits: Vec::new(), section, scroll: Scroll::default(), motion: Motion::default(), dirty: true, moving: false }
    }

    /// Show `section`, from outside the window (it opens on it): no glide,
    /// it's there at once.
    pub fn show_section(&mut self, section: Section) {
        if section != self.section {
            self.section = section;
            self.scroll = Scroll::default();
            self.input.focused = None;
            self.motion.leave_section();
        }
        self.motion.snap_next = true;
        self.dirty = true;
    }

    /// The hit under `p` in the last frame.
    pub fn hit_at(&self, p: Point) -> Option<Hit> {
        self.hits.iter().rev().find(|h| h.rect.contains(p)).copied()
    }

    /// Where the widget `id` was in the last frame (the self-test's film).
    #[cfg(windows)]
    pub fn hit_rect(&self, id: u64) -> Option<Rect> {
        self.hits.iter().find(|h| h.id == id).map(|h| h.rect)
    }

    /// The pointer's cursor over `p`.
    pub fn cursor_at(&self, p: Point) -> CursorKind {
        self.hit_at(p).map_or(CursorKind::Arrow, |h| h.cursor)
    }

    /// The pointer moved to `p`. True when what's under it changed (or a
    /// press is held): the window is drawn again only then.
    pub fn hover(&mut self, p: Point) -> bool {
        let was = self.input.mouse.and_then(|m| self.hit_at(m)).map(|h| h.id);
        let entered = self.input.mouse.is_none();
        self.input.mouse = Some(p);
        entered || self.input.down || was != self.hit_at(p).map(|h| h.id)
    }

    /// The pointer left the window.
    pub fn leave(&mut self) {
        self.input.mouse = None;
    }

    pub fn press(&mut self, p: Point) {
        self.input.mouse = Some(p);
        self.input.down = true;
        self.input.just_pressed = true;
        self.input.press_pos = Some(p);
        self.input.pressed_id = self.hit_at(p).map(|h| h.id);
    }

    /// The button came up at `p`: a click when it's still on what it went
    /// down on (it shows on the next frame).
    pub fn release(&mut self, p: Point) {
        self.input.mouse = Some(p);
        if let (Some(pid), Some(h)) = (self.input.pressed_id, self.hit_at(p).map(|h| h.id)) {
            if pid == h {
                self.input.clicked = Some((h, MouseButton::Left));
            }
        }
        if self.input.down {
            self.input.released = self.input.pressed_id.map(|id| (id, p));
        }
        self.input.down = false;
        self.input.pressed_id = None;
    }

    /// A mouse wheel: whole notches, the content glides.
    pub fn wheel(&mut self, p: Point, notches: f32) {
        self.input.mouse = Some(p);
        self.input.wheel += notches;
    }

    /// What the next frame of a glide must redraw (DIPs): only what still
    /// moves. None = nothing moves, or the whole window must be drawn.
    pub fn next_clip(&self) -> Option<Rect> {
        self.motion.next.filter(|_| self.moving && !self.dirty)
    }

    /// A trackpad: `points` (+ = up), the content follows the fingers.
    pub fn scroll_by(&mut self, p: Point, points: f32) {
        self.input.mouse = Some(p);
        self.scroll.pending += points;
    }

    /// Draw the window on `c` for `st`, light or dark.
    pub fn draw(&mut self, c: &mut Canvas, st: &mut AppState, now: f64, frame: Frame, light: bool) -> Painted {
        self.dirty = false;
        // A section that went away (Prayer times switched off) is General.
        if !self.section.shown(st) {
            self.section = Section::General;
            self.scroll = Scroll::default();
            self.motion.leave_section();
        }
        self.motion.begin(now, frame.still);
        let mut out = Painted::default();
        let mut hits = std::mem::take(&mut self.hits);
        hits.clear();
        {
            let mut ui = Ui::new(c, &mut self.input, &mut hits, now);
            match draw(&mut ui, st, self.section, frame, light, &mut self.scroll, &mut self.motion) {
                Some(Nav::Section(s)) => {
                    self.section = s;
                    self.scroll = Scroll::default();
                    self.motion.leave_section();
                    out.again = true;
                }
                Some(Nav::Close) => out.close = true,
                None => {}
            }
            out.again |= ui.repaint_requested();
        }
        self.hits = hits;
        self.input.end_frame();
        out.moving = self.motion.moving;
        self.moving = out.moving;
        out
    }
}

// ---------------------------------------------------------------- motion

/// How fast a value glides: a critically damped spring of this many
/// radians a second, so it never overshoots and has all but arrived after
/// about 4.5 / pace seconds.
/// Hover and press washes: about a tenth of a second.
const WASH: f32 = 46.0;
/// A switch's knob and colour.
const SWITCHING: f32 = 24.0;
/// A highlight going to another row or choice.
const SLIDE: f32 = 24.0;
/// The content after a mouse wheel.
const SCROLLING: f32 = 22.0;
/// A motion's first step out of rest: about one refresh (144 Hz's is 1/144,
/// 60 Hz's 1/60), however long the window was still.
const FIRST_STEP: f32 = 1.0 / 120.0;

/// Values that glide to where they're going, a step a frame at the
/// display's own rate (120 Hz on ProMotion, 144 Hz on a 144 Hz screen),
/// and stop there. Only answers to the person move: a value first asked
/// for starts where it's going, so the window opens complete.
#[derive(Default)]
struct Motion {
    /// Each value, its speed, and whether it is the section's content's,
    /// by key.
    vals: HashMap<u64, (f32, f32, bool)>,
    /// Values asked for from now on (this frame) are the section's content's.
    content: bool,
    /// Seconds since the last frame, at most a thirtieth: a long pause
    /// doesn't jump.
    dt: f32,
    last: f64,
    /// Something hasn't arrived yet.
    moving: bool,
    /// This frame, everything lands at once.
    snap: bool,
    /// So does the next one (a section opened from outside).
    snap_next: bool,
    /// Where what still moves will be drawn on the next frame (from where
    /// it is to where it's going): a frame of a glide redraws only that.
    next: Option<Rect>,
}

impl Motion {
    fn begin(&mut self, now: f64, still: bool) {
        // Out of rest, a motion starts with one refresh's step, not the whole
        // time since the last frame (a jump on its first frame).
        let dt = if self.moving { (now - self.last) as f32 } else { FIRST_STEP };
        self.dt = dt.clamp(0.0, 1.0 / 30.0);
        self.last = now;
        self.moving = false;
        self.snap = still || std::mem::take(&mut self.snap_next);
        self.next = None;
        self.content = false;
    }

    /// Another section opens: its rows start where they're going, not where
    /// the last section's rows in their place were (a switch would slide).
    fn leave_section(&mut self) {
        self.vals.retain(|_, v| !v.2);
    }

    /// Something in `r` still moves: the next frame redraws it.
    fn cover(&mut self, r: Rect) {
        self.next = Some(match self.next {
            Some(n) => {
                let (x0, y0) = (n.x.min(r.x), n.y.min(r.y));
                Rect::new(x0, y0, n.right().max(r.right()) - x0, n.bottom().max(r.bottom()) - y0)
            }
            None => r,
        });
    }

    /// `key`'s value this frame on its way to `target` at `pace`; within
    /// `near` it has arrived.
    fn glide(&mut self, key: u64, target: f32, pace: f32, near: f32) -> f32 {
        let content = self.content;
        let e = self.vals.entry(key).or_insert((target, 0.0, content));
        let (x, v, _) = *e;
        if self.snap || ((x - target).abs() < near && v.abs() < near * pace) {
            *e = (target, 0.0, content);
            return target;
        }
        self.moving = true;
        if self.dt <= 0.0 {
            return x;
        }
        let (t, d) = (self.dt, x - target);
        let k = (-pace * t).exp();
        let nd = (d + (v + pace * d) * t) * k;
        let nv = (v - pace * (v + pace * d) * t) * k;
        *e = (target + nd, nv, content);
        target + nd
    }

    /// A 0..1 value (an opacity, a switch's way across): within 0.4 % it
    /// has arrived.
    fn fade(&mut self, key: u64, target: f32, pace: f32) -> f32 {
        self.glide(key, target, pace, 0.004)
    }

    /// A position or a size, in DIPs: within a third of one it has arrived
    /// (under a pixel at any scale), so no frames go to a tail nobody sees.
    fn slide(&mut self, key: u64, target: f32, pace: f32) -> f32 {
        self.glide(key, target, pace, 0.3)
    }

    /// Put `key` at `value` now (a trackpad's scroll).
    fn jump(&mut self, key: u64, value: f32) {
        self.vals.insert(key, (value, 0.0, self.content));
    }
}

/// A key for one of a widget's moving values.
fn mkey(id: u64, what: u64) -> u64 {
    id.wrapping_mul(0x9E3779B97F4A7C15) ^ what
}

const K_WASH: u64 = 1;
const K_ON: u64 = 2;
const K_X: u64 = 3;
const K_W: u64 = 4;
const K_Y: u64 = 5;
const K_LIT: u64 = 6;

// ---------------------------------------------------------------- drawing

/// Where a click in the window's frame goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Nav {
    Section(Section),
    Close,
}

/// The whole window: the card, the sidebar and the section. Returns the
/// section picked in the sidebar, or the close button.
fn draw(ui: &mut Ui, st: &mut AppState, section: Section, frame: Frame, light: bool, sc: &mut Scroll, m: &mut Motion) -> Option<Nav> {
    let card = frame.card;
    let sf = surfaces(light);
    // Windows' borderless window: its own shadow and rounded corners.
    let radius = if frame.own_chrome { RADIUS } else { 0.0 };
    ui.c.unthemed(|c| {
        if frame.own_chrome {
            let shadow = Color::black(if light { 0.30 } else { 0.55 });
            c.rrect_shadow(card.offset(0.0, 4.0), RADIUS, shadow, &crate::pill::shape::SHADOW_RAMP);
        }
        c.fill_rrect(card, radius, sf.ground);
    });
    // The sidebar: the card's left part in its own shade, rounded only where
    // the card is. Nothing of it reaches past its edge, so no clip is needed
    // (a glide's frame elsewhere doesn't draw it).
    let side = Rect::new(card.x, card.y, SIDEBAR_W, card.h);
    ui.c.unthemed(|c| {
        c.fill_rrect(side, radius, sf.sidebar);
        if radius > 0.0 {
            c.fill_rect(Rect::new(side.right() - radius, side.y, radius, side.h), sf.sidebar);
        }
    });
    let px = 1.0 / ui.c.scale().max(0.5);
    ui.c.fill_rect(Rect::new(side.right() - px, side.y, px, side.h), RULE);
    if frame.own_chrome {
        ui.c.stroke_rrect(card.inset(px / 2.0, px / 2.0), RADIUS, EDGE, px);
    }

    let picked = draw_sidebar(ui, st, side, section, frame.top, m);
    let content = Rect::new(side.right() + PAD, card.y, card.right() - side.right() - 2.0 * PAD, card.h);
    ui.c.text(section.title(), Rect::new(content.x, card.y + TITLE_Y, content.w - 40.0, TITLE_H), &TextStyle::new(22.0).weight(Weight::Bold));
    let close = frame.own_chrome && draw_close(ui, card, m);

    let view = Rect::new(content.x - PAD / 2.0, card.y + CONTENT_Y, content.w + PAD, card.bottom() - CONTENT_Y - card.y - 1.0);
    // From here on, the section's own: its scroll and rows, whose values go
    // when another section opens.
    m.content = true;
    // Scrolling: a wheel glides to where it points, a trackpad follows the fingers.
    let max_scroll = (sc.content_h - view.h + 16.0).max(0.0);
    let wheel = ui.wheel_in(view);
    if wheel != 0.0 {
        sc.to -= wheel * WHEEL_STEP;
    }
    let skey = mkey(wid("settingswin.scroll"), K_Y);
    if sc.pending != 0.0 {
        sc.to = (sc.to - sc.pending).clamp(0.0, max_scroll);
        sc.pending = 0.0;
        m.jump(skey, sc.to);
    }
    sc.to = sc.to.clamp(0.0, max_scroll);
    sc.at = m.slide(skey, sc.to, SCROLLING);
    if sc.at != sc.to {
        // The whole content moves, and the edge it scrolls under.
        m.cover(view.inset(0.0, -2.0));
    }
    ui.c.clip(view);
    let mut y = view.y - sc.at;
    let x = content.x;
    if matches!(section, Section::Speech | Section::Models) && st.models.due(st.now) {
        st.cmd(Command::ModelsRefresh);
    }
    if section == Section::General && st.webhooks.due(st.now) {
        st.cmd(Command::WebhooksRefresh);
    }
    for (bi, b) in blocks(section, st).into_iter().enumerate() {
        y = draw_block(ui, st, &b, bi, Rect::new(x, y, content.w, 0.0), view, &sf, m);
    }
    ui.c.unclip();
    sc.content_h = y + sc.at - view.y;
    // The edge the content scrolls under.
    if sc.at > 0.5 {
        ui.c.fill_rect(Rect::new(view.x, view.y, view.w, px), RULE);
    }
    if close {
        return Some(Nav::Close);
    }
    picked.filter(|p| *p != section).map(Nav::Section)
}

/// The close button at the card's top right (Windows). True when clicked.
fn draw_close(ui: &mut Ui, card: Rect, m: &mut Motion) -> bool {
    let r = Rect::new(card.right() - 14.0 - 28.0, card.y + 14.0, 28.0, 28.0);
    let id = wid("settingswin.close");
    let resp = ui.button(id, r);
    let to = if resp.pressed { 0.8 } else if resp.hovered { 0.6 } else { 0.0 };
    let a = m.fade(mkey(id, K_WASH), to, WASH);
    if a != to {
        m.cover(r);
    }
    if a > 0.0 {
        ui.c.fill_rrect(r, 8.0, palette::RED.with_alpha(a));
    }
    let t = (a / 0.6).min(1.0);
    let x = Rect::from_center(r.center(), 14.0, 14.0);
    ui.c.icon(Icon::Close, x, palette::TEXT_DIM.mul_alpha(1.0 - t));
    if t > 0.0 {
        ui.c.icon(Icon::Close, x, palette::ON_ACCENT.mul_alpha(t));
    }
    resp.clicked
}

/// The sidebar: Oyen's tile and the window's name, then a row per section
/// (About at the bottom). The highlight glides to the section picked.
/// `top`: room for the Mac's window buttons.
fn draw_sidebar(ui: &mut Ui, st: &mut AppState, side: Rect, section: Section, top: f32, m: &mut Motion) -> Option<Section> {
    let icon_c = Point::new(side.x + 20.0 + 12.0, side.y + top + 32.0);
    ui.c.fill_rrect(Rect::from_center(icon_c, 24.0, 24.0), 6.0, Color::white(0.14));
    ui.c.text("Advanced settings", Rect::new(icon_c.x + 20.0, side.y + top + 20.0, side.w - 60.0, 24.0), &TextStyle::headline());
    let list = sections(st);
    let about_at = side.bottom() - 12.0 - NAV_H;
    let row_y = |i: usize, s: Section| if s == Section::About { about_at } else { side.y + top + NAV_Y + i as f32 * (NAV_H + NAV_GAP) };
    // The highlight, under the rows.
    let sel_key = mkey(wid("settingswin.nav.sel"), K_Y);
    if let Some(i) = list.iter().position(|s| *s == section) {
        let to = row_y(i, section);
        let y = m.slide(sel_key, to, SLIDE);
        let r = Rect::new(side.x + 10.0, y, side.w - 20.0, NAV_H);
        if y != to {
            m.cover(span(r, Rect::new(r.x, to, r.w, r.h)));
        }
        ui.c.fill_rrect(r, 8.0, Color::white(0.12));
    }
    let mut picked = None;
    for (i, s) in list.iter().enumerate() {
        let r = Rect::new(side.x + 10.0, row_y(i, *s), side.w - 20.0, NAV_H);
        let id = wid_n("settingswin.nav", i as u64);
        let resp = ui.button(id, r);
        if resp.clicked {
            picked = Some(*s);
        }
        let on = *s == section;
        let to = if on { 0.0 } else if resp.pressed { 0.09 } else if resp.hovered { 0.05 } else { 0.0 };
        let wash = m.fade(mkey(id, K_WASH), to, WASH);
        if wash != to {
            m.cover(r);
        }
        if wash > 0.0 {
            ui.c.fill_rrect(r, 8.0, Color::white(wash));
        }
        let tile = Rect::new(r.x + 8.0, r.center().y - NAV_TILE / 2.0, NAV_TILE, NAV_TILE);
        if *s == Section::About {
            ui.c.fill_rrect(tile, 6.0, Color::white(0.14));
        } else {
            ui.c.fill_rrect(tile, 6.0, s.tint());
            ui.c.icon(s.icon(), Rect::from_center(tile.center(), 14.0, 14.0), palette::ON_ACCENT);
        }
        let tx = tile.right() + 10.0;
        let style = TextStyle::body().weight(if on { Weight::Semibold } else { Weight::Regular }).color(if on { palette::TEXT } else { Color::white(0.82) });
        ui.c.text(s.title(), Rect::new(tx, r.y, (r.right() - tx - 6.0).max(0.0), r.h), &style);
    }
    picked
}

/// Where `r` meets the scrolled view (None = not on screen): widgets take
/// the pointer only there.
fn visible(r: Rect, view: Rect) -> Option<Rect> {
    let x0 = r.x.max(view.x);
    let y0 = r.y.max(view.y);
    let x1 = r.right().min(view.right());
    let y1 = r.bottom().min(view.bottom());
    (x1 > x0 && y1 > y0).then(|| Rect::new(x0, y0, x1 - x0, y1 - y0))
}

fn row_h(it: &Item) -> f32 {
    if it.sub.is_some() {
        ROW_H_SUB
    } else {
        ROW_H
    }
}

/// How tall a block is drawn.
fn block_h(st: &AppState, b: &Block) -> f32 {
    match b {
        Block::Group(title, items) => title.map_or(0.0, |_| GROUP_TITLE_H) + items.iter().map(row_h).sum::<f32>(),
        Block::Version => {
            if st.update.offer.is_some() {
                112.0
            } else {
                72.0
            }
        }
        Block::Themes => GROUP_TITLE_H + THEME_CARD_H,
        Block::Addons => crate::pages::addons::height(st),
        Block::Note(_) => 18.0,
    }
}

/// A group's card.
fn fill_group(ui: &mut Ui, r: Rect, color: Color) {
    ui.c.unthemed(|c| c.fill_rrect(r, GROUP_R, color));
}

/// Draw block `b` (the `bi`-th) from `at`'s top left, `at.w` wide; returns
/// where the next one starts.
#[allow(clippy::too_many_arguments)]
fn draw_block(ui: &mut Ui, st: &mut AppState, b: &Block, bi: usize, at: Rect, view: Rect, sf: &Surfaces, m: &mut Motion) -> f32 {
    let h = block_h(st, b);
    let r = Rect::new(at.x, at.y, at.w, h);
    let next = r.bottom() + GROUP_GAP;
    if visible(r.inset(-4.0, -4.0), view).is_none() {
        return next;
    }
    match b {
        Block::Group(title, items) => {
            let mut y = r.y;
            if let Some(t) = title {
                ui.c.text(t, Rect::new(r.x + 2.0, y, r.w, GROUP_TITLE_H - 6.0), &TextStyle::footnote().weight(Weight::Semibold).color(palette::TEXT_DIM));
                y += GROUP_TITLE_H;
            }
            let card = Rect::new(r.x, y, r.w, r.bottom() - y);
            fill_group(ui, card, sf.group);
            let accent = st.accent;
            let px = 1.0 / ui.c.scale().max(0.5);
            for (i, it) in items.iter().enumerate() {
                let rh = row_h(it);
                let row = Rect::new(card.x, y, card.w, rh);
                if i > 0 {
                    ui.c.fill_rect(Rect::new(row.x + ROW_PAD, row.y, row.w - ROW_PAD, px), RULE);
                }
                if let Some(act) = draw_row(ui, it, (bi, i), row, view, accent, (i == 0, i + 1 == items.len()), m) {
                    apply(st, it.key, act);
                }
                y += rh;
            }
        }
        Block::Version => draw_version(ui, st, r, view, sf),
        Block::Themes => draw_themes(ui, st, r, view, sf, m),
        Block::Addons => crate::pages::addons::draw(ui, st, r),
        Block::Note(t) => ui.c.text(t, Rect::new(r.x + 2.0, r.y, r.w, r.h), &TextStyle::footnote().color(palette::TEXT_FAINT)),
    }
    next
}

/// One row: its label (and dim line), and its control. Returns what a
/// click did. `ends`: the row is the card's first, its last.
#[allow(clippy::too_many_arguments)]
fn draw_row(ui: &mut Ui, it: &Item, at: (usize, usize), row: Rect, view: Rect, accent: Color, ends: (bool, bool), m: &mut Motion) -> Option<Act> {
    let id = |what: &str| wid_n(&format!("settingswin.{what}.{}", at.0), at.1 as u64);
    let shown = visible(row, view);
    let whole = shown.is_some_and(|v| v.h >= row.h - 0.5);
    let inner = row.inset(ROW_PAD, 0.0);
    let mut act = None;
    // The control's room at the right end.
    let ctl_w = match &it.ctl {
        Ctl::Switch(_) => SWITCH_W,
        Ctl::Choice(names, _) => picker_width(ui, names),
        // A long value ("Qwen2.5 0.5B") gets its own width plus a gap to each button, not the fixed slot.
        Ctl::Stepper(v) => 2.0 * STEP_BTN + STEP_VALUE_W.max(ui.c.measure(v, &TextStyle::body().weight(Weight::Semibold).tabular(), 300.0).0.ceil() + 16.0),
        Ctl::Button(label) => ui.pill_width(label, true, true),
        Ctl::None => 0.0,
    };
    let ctl_x = inner.right() - ctl_w;
    match &it.ctl {
        Ctl::Switch(on) => {
            // The whole row toggles, as on the island's Settings page.
            let rid = id("row");
            let resp = match (on, shown) {
                (Some(_), Some(hit)) => ui.button(rid, hit),
                _ => Default::default(),
            };
            let to = if resp.pressed { 0.07 } else if resp.hovered { 0.04 } else { 0.0 };
            let wash = m.fade(mkey(rid, K_WASH), to, WASH);
            if wash != to {
                m.cover(row);
            }
            if wash > 0.0 {
                fill_row(ui, row, Color::white(wash), ends);
            }
            if resp.clicked {
                act = Some(Act::Toggle);
            }
            // The knob slides and the track takes the colour as it goes.
            let to = if *on == Some(true) { 1.0 } else { 0.0 };
            let k = m.fade(mkey(rid, K_ON), to, SWITCHING);
            let sw = Rect::new(ctl_x, row.center().y - SWITCH_H / 2.0, SWITCH_W, SWITCH_H);
            if k != to {
                m.cover(sw.inset(-1.0, -1.0));
            }
            let alpha = if on.is_some() { 1.0 } else { 0.5 };
            ui.c.with_alpha(alpha, |c| draw_switch_at(c, sw, k, accent));
        }
        Ctl::Choice(names, sel) => {
            let y = row.center().y - PICKER_H / 2.0;
            if let Some(i) = picker_glide(ui, m, &format!("settingswin.pick.{}.{}", at.0, at.1), ctl_x, y, names, *sel, whole) {
                act = Some(Act::Pick(i));
            }
        }
        Ctl::Stepper(value) => {
            let cy = row.center().y;
            let minus = Rect::new(ctl_x, cy - STEP_BTN / 2.0, STEP_BTN, STEP_BTN);
            let plus = Rect::new(inner.right() - STEP_BTN, cy - STEP_BTN / 2.0, STEP_BTN, STEP_BTN);
            for (r, icon, d, what) in [(minus, Icon::Minus, -1, "minus"), (plus, Icon::Plus, 1, "plus")] {
                let bid = id(what);
                let resp = match visible(r, view) {
                    Some(hit) => ui.button(bid, hit),
                    None => Default::default(),
                };
                let to = if resp.pressed { 1.0 } else if resp.hovered { 0.5 } else { 0.0 };
                let lit = m.fade(mkey(bid, K_WASH), to, WASH);
                if lit != to {
                    m.cover(r.inset(-1.0, -1.0));
                }
                let fill = if lit <= 0.5 { Color::lerp(palette::SURFACE, palette::SURFACE_HOVER, lit * 2.0) } else { Color::lerp(palette::SURFACE_HOVER, palette::SURFACE_PRESSED, lit * 2.0 - 1.0) };
                ui.c.fill_circle(r.center(), STEP_BTN / 2.0, fill);
                ui.c.icon(icon, Rect::from_center(r.center(), 12.0, 12.0), palette::TEXT);
                if resp.clicked {
                    act = Some(Act::Step(d));
                }
            }
            let vr = Rect::new(minus.right(), row.y, plus.x - minus.right(), row.h);
            ui.c.text(value, vr, &TextStyle::body().weight(Weight::Semibold).tabular().center());
        }
        Ctl::None => {}
        Ctl::Button(label) => {
            let icon = if matches!(it.key, Key::ModelPull(_)) { Icon::Download } else { Icon::Open };
            let r = Rect::new(ctl_x, row.center().y - PILL_SMALL / 2.0, ctl_w, PILL_SMALL);
            let clicked = match visible(r, view).filter(|v| v.h >= r.h - 0.5) {
                Some(_) => ui.pill(id("button"), r, label, Some(icon), PillStyle::Utility).clicked,
                None => {
                    let mut none = Input::default();
                    let mut no_hits = Vec::new();
                    let mut ghost = Ui::new(&mut *ui.c, &mut none, &mut no_hits, 0.0);
                    ghost.pill(0, r, label, Some(icon), PillStyle::Utility);
                    false
                }
            };
            if clicked {
                act = Some(Act::Press);
            }
        }
    }
    // A model's andon light before the label: green on device, yellow downloading, orange part
    // there, red failed, grey absent.
    let lx = match it.light {
        Some(l) => {
            let cy = if it.sub.is_some() { row.center().y - 9.5 } else { row.center().y };
            ui.c.fill_circle(Point::new(inner.x + LIGHT_R, cy), LIGHT_R, l.color());
            inner.x + 2.0 * LIGHT_R + 8.0
        }
        None => inner.x,
    };
    // The label, and the dim line under it.
    let tw = (ctl_x - 16.0 - lx).max(0.0);
    match &it.sub {
        Some(sub) => {
            let cy = row.center().y;
            ui.c.text(&it.label, Rect::new(lx, cy - 19.0, tw, 19.0), &TextStyle::body());
            ui.c.text(sub, Rect::new(lx, cy + 1.0, tw, 17.0), &TextStyle::footnote().color(palette::TEXT_DIM));
        }
        None => ui.c.text(&it.label, Rect::new(lx, row.y, tw, row.h), &TextStyle::body()),
    }
    // The download bar along the row's foot while one runs.
    if let Some(p) = it.progress {
        let bar = Rect::new(lx, row.bottom() - 7.0, (inner.right() - lx).max(0.0), 3.0);
        ui.c.fill_rrect(bar, 1.5, palette::TRACK);
        ui.c.fill_rrect(Rect::new(bar.x, bar.y, (bar.w * p.clamp(0.0, 1.0)).max(3.0), bar.h), 1.5, palette::YELLOW);
    }
    act
}

/// A switch `k` of the way on (0 off, 1 on): the knob slides across and
/// the track takes the accent as it goes (the island's switch, in motion).
fn draw_switch_at(c: &mut Canvas, r: Rect, k: f32, accent: Color) {
    let k = k.clamp(0.0, 1.0);
    c.fill_rrect(r, r.h / 2.0, palette::TRACK.mul_alpha(1.0 - k));
    if k > 0.0 {
        c.fill_rrect(r, r.h / 2.0, accent.mul_alpha(k));
    }
    let d = r.h - 2.0 * KNOB_INSET;
    let x0 = r.x + KNOB_INSET + d / 2.0;
    let x1 = r.right() - KNOB_INSET - d / 2.0;
    c.fill_circle(Point::new(x0 + (x1 - x0) * k, r.center().y), d / 2.0, palette::ON_ACCENT);
}

/// The island's picker (choices side by side in a track, the chosen one
/// lifted) with the lift gliding to the choice picked. `live`: it takes
/// clicks (not while partly scrolled away). Returns the choice clicked.
#[allow(clippy::too_many_arguments)]
fn picker_glide(ui: &mut Ui, m: &mut Motion, id: &str, x: f32, y: f32, names: &[&str], sel: Option<usize>, live: bool) -> Option<usize> {
    let st = TextStyle::footnote().weight(Weight::Semibold);
    let h = PICKER_H;
    let inner_h = h - 2.0 * SEG_INSET;
    let mut cx = x + SEG_INSET;
    let cells: Vec<Rect> = names
        .iter()
        .map(|n| {
            let w = (2.0 * SEG_PAD + ui.c.measure(n, &st, 300.0).0).ceil();
            let cell = Rect::new(cx, y + SEG_INSET, w, inner_h);
            cx += w;
            cell
        })
        .collect();
    ui.c.fill_rrect(Rect::new(x, y, cx + SEG_INSET - x, h), h / 2.0, palette::SURFACE);
    let base = wid(id);
    // The lift, under the names.
    let track = Rect::new(x, y, cx + SEG_INSET - x, h);
    if let Some(cell) = sel.and_then(|s| cells.get(s)) {
        let lx = m.slide(mkey(base, K_X), cell.x - x, SLIDE);
        let lw = m.slide(mkey(base, K_W), cell.w, SLIDE);
        if lx != cell.x - x || lw != cell.w {
            m.cover(track);
        }
        ui.c.fill_rrect(Rect::new(x + lx, cell.y, lw, inner_h), inner_h / 2.0, Color::white(0.16));
    }
    let mut picked = None;
    for (i, (name, cell)) in names.iter().zip(&cells).enumerate() {
        let cid = wid_n(id, i as u64);
        let chosen = sel == Some(i);
        let resp = if live && !chosen { ui.button(cid, Rect::new(cell.x, y, cell.w, h)) } else { Default::default() };
        if resp.clicked {
            picked = Some(i);
        }
        let to = if resp.pressed { 0.10 } else if resp.hovered { 0.06 } else { 0.0 };
        let wash = m.fade(mkey(cid, K_WASH), to, WASH);
        if wash > 0.0 {
            ui.c.fill_rrect(*cell, inner_h / 2.0, Color::white(wash));
        }
        let lit_to = if chosen || resp.hovered || resp.pressed { 1.0 } else { 0.0 };
        let lit = m.fade(mkey(cid, K_LIT), lit_to, WASH);
        if wash != to || lit != lit_to {
            m.cover(*cell);
        }
        ui.c.text(name, *cell, &st.color(Color::lerp(palette::TEXT_DIM, palette::TEXT, lit)).center());
    }
    picked
}

/// A row's hover wash, rounded where the row meets the card's corners.
fn fill_row(ui: &mut Ui, row: Rect, c: Color, (first, last): (bool, bool)) {
    if !(first || last) {
        ui.c.fill_rect(row, c);
        return;
    }
    ui.c.clip(row);
    let top = if first { row.y } else { row.y - GROUP_R };
    let bottom = if last { row.bottom() } else { row.bottom() + GROUP_R };
    ui.c.fill_rrect(Rect::new(row.x, top, row.w, bottom - top), GROUP_R, c);
    ui.c.unclip();
}

/// The version card: the app's tile, "yravgSubMeetly" and this version, and
/// Check now; with a later version out, what it brings and how to get it
/// (the island's Update sheet does the same).
fn draw_version(ui: &mut Ui, st: &mut AppState, r: Rect, view: Rect, sf: &Surfaces) {
    fill_group(ui, r, sf.group);
    let head = Rect::new(r.x + ROW_PAD, r.y, r.w - 2.0 * ROW_PAD, 72.0);
    let cy = head.center().y;
    ui.c.fill_rrect(Rect::from_center(Point::new(head.x + 20.0, cy), 40.0, 40.0), 10.0, Color::white(0.14));
    let tx = head.x + 54.0;
    let clickable = visible(r, view).is_some_and(|v| v.h >= r.h - 0.5);
    let check = clickable.then(|| crate::pages::settings::check_slot(ui, st, head)).flatten();
    let right = check.map_or(head.right(), |b| b.x - 12.0);
    ui.c.text("yravgSubMeetly", Rect::new(tx, cy - 20.0, (right - tx).max(0.0), 22.0), &TextStyle::headline());
    ui.c.text(&format!("Version {VERSION}"), Rect::new(tx, cy + 2.0, (right - tx).max(0.0), 17.0), &TextStyle::footnote().color(palette::TEXT_DIM));
    if let Some(b) = check {
        crate::pages::settings::draw_check(ui, st, b);
    }
    let Some(rel) = st.update.offer.clone() else { return };
    let px = 1.0 / ui.c.scale().max(0.5);
    let row = Rect::new(head.x, head.bottom(), head.w, r.bottom() - head.bottom());
    ui.c.fill_rect(Rect::new(row.x, row.y, row.w, px), RULE);
    let accent = st.accent;
    // Windows with the Setup in: now or next start; otherwise its page (or the Mac's DMG).
    let mut buttons: Vec<(&str, Command, PillStyle)> = Vec::new();
    if st.update.ready {
        buttons.push(("Install now", Command::Update, PillStyle::Primary(accent)));
        let later = if st.update.next_start { "Set for next start" } else { "On next start" };
        buttons.push((later, Command::InstallOnNextStart, PillStyle::Utility));
    } else {
        buttons.push(("Download", Command::Update, PillStyle::Primary(accent)));
    }
    buttons.push(("What's new", Command::OpenUrl(rel.notes.clone()), PillStyle::Utility));
    let mut x = row.right();
    let by = row.center().y - PILL_SMALL / 2.0;
    let mut picked = None;
    for (i, (label, cmd, style)) in buttons.into_iter().enumerate().rev() {
        let w = ui.pill_width(label, false, true);
        x -= w;
        let b = Rect::new(x, by, w, PILL_SMALL);
        x -= PILL_GAP;
        let clicked = if clickable {
            ui.pill(wid_n("settingswin.update", i as u64), b, label, None, style).clicked
        } else {
            let mut none = Input::default();
            let mut no_hits = Vec::new();
            Ui::new(&mut *ui.c, &mut none, &mut no_hits, 0.0).pill(0, b, label, None, style);
            false
        };
        if clicked {
            picked = Some(cmd);
        }
    }
    let tw = (x - 12.0 - row.x).max(0.0);
    let cy = row.center().y;
    crate::activities::text_with_dim(ui, "Update available", &rel.version, Rect::new(row.x, cy - 19.0, tw, 19.0), TextStyle::body().weight(Weight::Semibold));
    ui.c.text(&rel.headline, Rect::new(row.x, cy + 1.0, tw, 17.0), &TextStyle::footnote().color(palette::TEXT_DIM));
    if let Some(c) = picked {
        st.cmd(c);
    }
}

/// The four themes, a card each: a small screen with the island on it as
/// the theme draws it, the name and a line. The ring and the tick fade to
/// the theme picked.
fn draw_themes(ui: &mut Ui, st: &mut AppState, r: Rect, view: Rect, sf: &Surfaces, m: &mut Motion) {
    ui.c.text("Theme", Rect::new(r.x + 2.0, r.y, r.w, GROUP_TITLE_H - 6.0), &TextStyle::footnote().weight(Weight::Semibold).color(palette::TEXT_DIM));
    let n = THEMES.len() as f32;
    let w = ((r.w - (n - 1.0) * THEME_GAP) / n).floor();
    let accent = st.accent;
    let mut picked = None;
    for (i, (theme, name, line)) in THEMES.iter().enumerate() {
        let c = Rect::new(r.x + i as f32 * (w + THEME_GAP), r.y + GROUP_TITLE_H, w, THEME_CARD_H);
        let id = wid_n("settingswin.theme", i as u64);
        let resp = match visible(c, view) {
            Some(hit) => ui.button(id, hit),
            None => Default::default(),
        };
        let on = st.settings.theme == *theme;
        fill_group(ui, c, sf.group);
        let lit_to = if resp.pressed { 1.0 } else if resp.hovered { 0.6 } else { 0.0 };
        let lit = m.fade(mkey(id, K_WASH), lit_to, WASH);
        if lit > 0.0 {
            let over = if lit > 0.6 { sf.group_press } else { sf.group_hover };
            ui.c.unthemed(|cv| cv.fill_rrect(c, GROUP_R, over.mul_alpha((lit / 0.6).min(1.0))));
        }
        let ring_to = if on { 1.0 } else { 0.0 };
        let ring = m.fade(mkey(id, K_ON), ring_to, SWITCHING);
        if lit != lit_to || ring != ring_to {
            m.cover(c.inset(-2.0, -2.0));
        }
        if ring > 0.0 {
            ui.c.stroke_rrect(c.inset(1.0, 1.0), GROUP_R - 1.0, accent.mul_alpha(ring), 2.0);
        }
        let screen = Rect::new(c.x + 10.0, c.y + 10.0, c.w - 20.0, THEME_PREVIEW_H);
        ui.c.unthemed(|cv| draw_theme_preview(cv, *theme, screen));
        let tx = c.x + 12.0;
        let ty = screen.bottom() + 10.0;
        let tw = c.w - 24.0 - if on { 20.0 } else { 0.0 };
        ui.c.text(name, Rect::new(tx, ty, tw, 19.0), &TextStyle::body().weight(Weight::Semibold));
        ui.c.text(line, Rect::new(tx, ty + 20.0, c.w - 24.0, 34.0), &TextStyle::footnote().color(palette::TEXT_DIM).wrap().top());
        if ring > 0.0 {
            let dot = Point::new(c.right() - 20.0, ty + 9.5);
            ui.c.with_alpha(ring, |cv| {
                cv.fill_circle(dot, 8.0, accent);
                cv.icon(Icon::Check, Rect::from_center(dot, 10.0, 10.0), palette::ON_ACCENT);
            });
        }
        if resp.clicked {
            picked = Some(*theme);
        }
    }
    if let Some(t) = picked.filter(|t| *t != st.settings.theme) {
        st.settings.theme = t;
        st.cmd(Command::SaveSettings);
    }
}

/// A theme's island on a small screen: hanging from its top edge, glass,
/// or floating below it. Drawn as it is, in either mode.
fn draw_theme_preview(c: &mut Canvas, theme: Theme, screen: Rect) {
    c.clip(screen);
    c.fill_rrect(screen, 7.0, WALLPAPER);
    c.fill_rrect(Rect::new(screen.x, screen.y + screen.h * 0.55, screen.w, screen.h), 7.0, Color::hex(0x56679C));
    let cx = screen.center().x;
    let clock = TextStyle::caption().weight(Weight::Semibold).tabular().center();
    match theme {
        Theme::Classic | Theme::Glass => {
            let body = Rect::new(cx - 34.0, screen.y, 68.0, 20.0);
            let (fill, border) = match theme {
                Theme::Glass => (Color::white(0.30), Some(Color::white(0.45))),
                _ => (palette::ISLAND, None),
            };
            c.notch(body, 9.0, 5.0, fill, border);
            c.text("10:08", body, &clock.color(palette::TEXT));
        }
        Theme::Pill | Theme::Paper => {
            let body = Rect::new(cx - 36.0, screen.y + 7.0, 72.0, 20.0);
            c.fill_rrect(body.offset(0.0, 2.0), 10.0, Color::black(0.25));
            c.fill_rrect(body, 10.0, palette::ISLAND);
            c.text("10:08", body, &clock.color(palette::TEXT));
        }
    }
    c.unclip();
}

#[cfg(test)]
mod tests {
    use super::*;
    use poni_core::settings::Settings;
    use poni_core::store::Store;

    #[test]
    fn media_section_title() {
        assert_eq!(Section::Music.title(), "Media and lyrics");
    }

    fn state() -> AppState {
        AppState::new(Settings::default(), Store::default())
    }

    fn rows(section: Section, st: &AppState) -> Vec<Item> {
        blocks(section, st)
            .into_iter()
            .flat_map(|b| match b {
                Block::Group(_, items) => items,
                _ => Vec::new(),
            })
            .collect()
    }

    fn row(section: Section, st: &AppState, key: Key) -> Option<Item> {
        rows(section, st).into_iter().find(|i| i.key == key)
    }

    #[test]
    fn every_setting_the_window_has_saves_through_the_app() {
        let mut st = state();
        for s in Section::ALL {
            for it in rows(s, &st) {
                st.cmds.clear();
                let act = match it.ctl {
                    Ctl::Switch(_) => Act::Toggle,
                    Ctl::Choice(..) => Act::Pick(0),
                    Ctl::Stepper(_) => Act::Step(1),
                    Ctl::Button(_) => Act::Press,
                    Ctl::None => continue,
                };
                apply(&mut st, it.key, act);
                let saved = st.cmds.iter().any(|c| matches!(c, Command::SaveSettings));
                let opens = st.cmds.iter().any(|c| matches!(c, Command::OpenPath(_) | Command::OpenUrl(_)));
                match it.key {
                    // Start with Windows waits for its reading; the buttons open things.
                    Key::Autostart => assert!(st.cmds.is_empty()),
                    Key::Captions => assert!(st.cmds.iter().any(|c| matches!(c, Command::Captions(true))), "starts the captions"),
                    Key::SettingsFile | Key::DataFolder | Key::ReleaseNotes | Key::LyricsCredit => assert!(opens, "{:?}", it.key),
                    // Windows' language rows ask the app, not the settings file.
                    Key::WinLang(_) | Key::WinLangSettings => assert!(st.cmds.iter().any(|c| matches!(c, Command::WinLang(_))), "{:?}", it.key),
                    // Paste reads the clipboard and Pick lists running apps: the app does both.
                    Key::MeetingAddLink => assert!(st.cmds.contains(&Command::MeetingAddLink)),
                    // The AI connector's rows ask the engine through the app.
                    Key::AiEnabled | Key::AiUrl | Key::AiModel | Key::AiKey | Key::AiTest | Key::SummaryTemplate => assert!(st.cmds.iter().any(|c| matches!(c, Command::Ai(_))), "{:?}", it.key),
                    Key::MeetingPickApps => assert!(st.cmds.contains(&Command::MeetingPickApps)),
                    // The webhooks live in the engine: the app asks it, nothing goes to the settings file.
                    Key::WebhookAdd => assert!(st.cmds.contains(&Command::WebhookAddFromClipboard) && !saved),
                    Key::Webhook(_) | Key::WebhookTest(_) | Key::WebhookRemove(_) => assert!(!st.cmds.is_empty() && !saved, "{:?}", it.key),
                    // The library's filter is a view of the list, not a setting.
                    Key::LibFilter => assert!(st.cmds.is_empty()),
                    _ => assert!(saved, "{:?} didn't save", it.key),
                }
            }
        }
    }

    #[test]
    fn webhook_rows_come_from_the_engines_list_and_ask_the_app() {
        use poni_core::webhooks::Webhook;
        let mut st = state();
        st.webhooks.list = vec![Webhook { id: "wh-1".into(), url: "https://hooks.example.com/in".into(), enabled: true, has_secret: true, last_ok: Some(true), last_error: String::new() }];
        let general = rows(Section::General, &st);
        let hook = general.iter().find(|i| i.key == Key::Webhook(0)).expect("the hook's row");
        assert_eq!(hook.label, "hooks.example.com");
        assert_eq!(hook.sub.as_deref(), Some("On, last delivery worked. Signed with your secret"));
        assert_eq!(hook.ctl, Ctl::Switch(Some(true)));
        for (key, want) in [
            (Key::Webhook(0), Command::WebhookEnable("wh-1".into(), false)),
            (Key::WebhookTest(0), Command::WebhookTest("wh-1".into())),
            (Key::WebhookRemove(0), Command::WebhookRemove("wh-1".into())),
        ] {
            st.cmds.clear();
            apply(&mut st, key, Act::Press);
            assert_eq!(st.cmds, vec![want]);
        }
        // A row for a hook that has gone does nothing.
        st.cmds.clear();
        apply(&mut st, Key::WebhookRemove(5), Act::Press);
        assert!(st.cmds.is_empty());
        st.webhooks.error = Some("The engine is not answering".into());
        assert!(rows(Section::General, &st).iter().any(|i| i.key == Key::WebhookInfo));
    }

    #[test]
    fn meeting_apps_rows_follow_the_drawing() {
        use poni_core::meeting_source::{Family, MeetingApp, MeetingAppKind};
        let mut st = state();
        st.settings.meeting_apps.push(MeetingApp { kind: MeetingAppKind::Host, value: "meeting.tencent.com".into(), label: "Tencent Meeting".into() });
        let group = blocks(Section::Speech, &st)
            .into_iter()
            .find_map(|b| match b {
                Block::Group(Some("Meeting apps"), items) => Some(items),
                _ => None,
            })
            .expect("a Meeting apps group");
        let shown: Vec<(&str, &str)> = group.iter().map(|i| (i.label.as_str(), i.sub.as_deref().unwrap_or(""))).collect();
        assert_eq!(
            shown,
            [
                ("Microsoft Teams", "Desktop app and classic Teams"),
                ("Zoom", "Zoom.exe"),
                ("Google Meet", "In a browser window that uses the microphone"),
                ("Webex", "Desktop app"),
                ("Slack huddles", "Huddle windows only"),
                ("Tencent Meeting", "Added from a link: meeting.tencent.com"),
                ("Add a meeting app or link", "Pick a running app or paste a meeting link"),
                ("Add a running app", "Its process name is kept; remove it later from the list"),
            ]
        );
        let open = row(Section::Speech, &st, Key::OpenMeetingTab).unwrap();
        assert_eq!((open.label.as_str(), open.ctl), ("Open the Meeting tab when a meeting starts", Ctl::Switch(Some(true))));
        assert!(group[..5].iter().all(|i| i.ctl == Ctl::Switch(Some(true))), "all five on by default");
        apply(&mut st, Key::MeetingFamily(Family::Slack), Act::Toggle);
        assert!(!st.settings.meeting_families.slack && st.settings.meeting_families.zoom);
        apply(&mut st, Key::OpenMeetingTab, Act::Toggle);
        assert!(!st.settings.open_meeting_tab);
        apply(&mut st, Key::MeetingRemove(0), Act::Press);
        assert!(st.settings.meeting_apps.is_empty());
    }

    #[test]
    fn picking_a_running_app_keeps_its_process_name() {
        let mut st = state();
        st.meeting_pick = Some(vec!["ZohoMeeting.exe".into(), "Zoom.exe".into()]);
        let pick: Vec<Item> = rows(Section::Speech, &st).into_iter().filter(|i| matches!(i.key, Key::MeetingPickApp(_))).collect();
        assert_eq!(pick[0].ctl, Ctl::Button("Add"));
        assert_eq!((pick[1].ctl.clone(), pick[1].sub.as_deref()), (Ctl::None, Some("already in the list")));
        apply(&mut st, Key::MeetingPickApp(0), Act::Press);
        assert_eq!(st.settings.meeting_apps[0].value, "ZohoMeeting.exe");
        assert!(st.meeting_pick.is_none(), "the list closes after a pick");
        let added = row(Section::Speech, &st, Key::MeetingRemove(0)).unwrap();
        assert_eq!((added.sub.as_deref(), added.ctl), (Some("Added from a running app: ZohoMeeting.exe"), Ctl::Button("Remove")));
    }

    #[test]
    fn steppers_stay_in_range() {
        let mut st = state();
        for _ in 0..100 {
            apply(&mut st, Key::Width, Act::Step(1));
            apply(&mut st, Key::FocusMin, Act::Step(1));
            apply(&mut st, Key::LongEvery, Act::Step(1));
            apply(&mut st, Key::LyricsOffset, Act::Step(1));
        }
        let s = &st.settings;
        assert_eq!((s.expanded_width, s.pomodoro.focus_min, s.pomodoro.long_every, s.lyrics_offset_ms), (900.0, 180, 12, -5000));
        for _ in 0..100 {
            apply(&mut st, Key::Width, Act::Step(-1));
            apply(&mut st, Key::FocusMin, Act::Step(-1));
            apply(&mut st, Key::PrayerCountdown, Act::Step(-1));
        }
        let s = &st.settings;
        assert_eq!((s.expanded_width, s.pomodoro.focus_min, s.prayer.remind_before_min), (480.0, 1, 0));
        // Minutes go by five, and by one below five.
        assert_eq!((step_min(25, -1, 1, 180), step_min(5, -1, 1, 180), step_min(3, 1, 1, 180), step_min(5, 1, 1, 180)), (20, 4, 4, 10));
    }

    #[test]
    fn the_language_rows_cycle_and_show_the_name() {
        let mut st = state();
        let value = |st: &AppState, k| match row(Section::Speech, st, k).map(|i| i.ctl) {
            Some(Ctl::Stepper(v)) => v,
            _ => String::new(),
        };
        // Spoken language starts on Auto-detect and also offers it; the target never does.
        assert_eq!((value(&st, Key::SpokenLang).as_str(), value(&st, Key::TargetLang).as_str()), ("Auto-detect", "English"));
        apply(&mut st, Key::SpokenLang, Act::Step(-1));
        assert_eq!((st.settings.source_lang.as_str(), value(&st, Key::SpokenLang).as_str()), ("vi", "Vietnamese"));
        apply(&mut st, Key::SpokenLang, Act::Step(1));
        assert_eq!(st.settings.source_lang, "auto");
        apply(&mut st, Key::TargetLang, Act::Step(-1));
        assert_eq!(st.settings.target_lang, "vi");
        apply(&mut st, Key::TargetLang, Act::Step(1));
        assert_eq!(st.settings.target_lang, "en");
        // Captions start and stop through the app, which remembers the choice.
        st.cmds.clear();
        apply(&mut st, Key::Captions, Act::Toggle);
        assert!(st.cmds.iter().any(|c| matches!(c, Command::Captions(true))));
    }

    #[test]
    fn the_library_filters_the_models_and_its_buttons_act_on_the_row() {
        use poni_core::models::parse;
        let mut st = state();
        let body = r#"{"models":[{"kind":"asr","id":"org/speech-base","downloaded":true,"bytes":150000000}],
            "catalog":[{"kind":"asr","id":"org/speech-base","label":"Base","selected":true,"downloaded":true,"bytes":150000000,"dir":"D:/hf"},
                       {"kind":"asr","id":"org/speech-small","label":"Small","downloaded":true,"bytes":490000000,"dir":"D:/hf"},
                       {"kind":"translate","id":"org/mt-big","label":"Qwen big","approxBytes":6000000000}]}"#;
        st.models.apply(Ok(parse(body).unwrap()), 1.0);
        let lib = |st: &AppState| rows(Section::Models, st).into_iter().filter(|i| matches!(i.key, Key::LibModel(_))).map(|i| (i.label, i.ctl)).collect::<Vec<_>>();
        // On device first: the one in use has only its folder; another can be used or deleted.
        assert_eq!(lib(&st), [("Base".into(), Ctl::Choice(vec!["Folder"], None)), ("Small".into(), Ctl::Choice(vec!["Use", "Folder", "Delete"], None))]);
        apply(&mut st, Key::LibFilter, Act::Pick(1));
        assert_eq!(lib(&st).len(), 3);
        assert_eq!(lib(&st)[2], ("Qwen big".into(), Ctl::Choice(vec!["Download", "By hand"], None)));
        apply(&mut st, Key::LibModel(1), Act::Pick(0));
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelSelect(Kind::Asr, id) if id == "org/speech-small")));
        apply(&mut st, Key::LibModel(1), Act::Pick(2));
        let small = rows(Section::Models, &st).into_iter().find(|i| i.key == Key::LibModel(1)).unwrap();
        assert_eq!((small.sub.as_deref(), small.ctl), (Some("Speech · All languages · Delete Small? Frees 490 MB."), Ctl::Choice(vec!["Delete", "Keep"], None)));
        apply(&mut st, Key::LibModel(1), Act::Pick(0));
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelDelete(id) if id == "org/speech-small")));
        // Languages on this PC: one line per caption language.
        assert!(rows(Section::Speech, &st).iter().any(|i| i.key == Key::LibLang && i.label == "Indonesian" && i.sub.as_deref() == Some("Speech on device · translation off")));
    }

    #[test]
    fn model_rows_carry_an_andon_light_and_downloads_can_come_from_modelscope() {
        use poni_core::models::parse;
        let mut st = state();
        let body = r#"{"models":[{"kind":"asr","id":"openai/whisper-base","downloaded":true,"bytes":150000000}],
            "catalog":[{"kind":"asr","id":"openai/whisper-base","label":"Base","selected":true,"downloaded":true,"bytes":150000000},
                       {"kind":"translate","id":"org/mt-big","label":"Big","approxBytes":6000000000,"pulling":true,"pct":25},
                       {"kind":"translate","id":"org/mt-mid","label":"Mid","approxBytes":1000000000,"pullError":"download failed (Hugging Face): timed out"}]}"#;
        st.models.apply(Ok(parse(body).unwrap()), 1.0);
        apply(&mut st, Key::LibFilter, Act::Pick(1));
        let lib: Vec<(Option<Light>, Option<f32>)> = rows(Section::Models, &st).into_iter().filter(|i| matches!(i.key, Key::LibModel(_))).map(|i| (i.light, i.progress)).collect();
        assert_eq!(lib, [(Some(Light::Ready), None), (Some(Light::Working), Some(0.25)), (Some(Light::Failed), None)]);
        assert_eq!(row(Section::Models, &st, Key::ModelPick(Kind::Asr)).and_then(|i| i.light), Some(Light::Ready));

        let source = |st: &AppState| row(Section::Models, st, Key::ModelSource).map(|i| i.ctl);
        assert_eq!(source(&st), Some(Ctl::Choice(vec!["Hugging Face", "ModelScope"], Some(0))));
        apply(&mut st, Key::ModelSource, Act::Pick(1));
        assert_eq!(st.settings.model_source, "modelscope");
        assert_eq!(source(&st), Some(Ctl::Choice(vec!["Hugging Face", "ModelScope"], Some(1))));
        st.cmds.clear();
        apply(&mut st, Key::ModelManual(Kind::Asr), Act::Press);
        assert!(st.cmds.contains(&Command::OpenUrl("https://www.modelscope.cn/models/openai-mirror/whisper-base/files".into())));
    }

    #[test]
    fn the_model_rows_offer_the_catalog_and_download_what_is_missing() {
        use poni_core::models::{parse, Kind, OFF};
        let mut st = state();
        let pick = |st: &AppState, k| row(Section::Models, st, Key::ModelPick(k)).map(|i| (i.sub.unwrap_or_default(), i.ctl));
        let button = |st: &AppState, k| row(Section::Models, st, Key::ModelPull(k)).map(|i| i.ctl);
        // Before the engine answered: a line, nothing to step or press.
        assert_eq!(pick(&st, Kind::Asr), Some(("Checking…".into(), Ctl::None)));
        assert_eq!(button(&st, Kind::Asr), None);
        let body = r#"{"models":[{"key":"asr","id":"org/speech-base","downloaded":false},{"key":"translate","id":"org/mt-small","loaded":true,"downloaded":true}],
            "catalog":[{"kind":"asr","id":"org/speech-base","label":"Base","downloaded":false},{"kind":"asr","id":"org/speech-small","label":"Small","downloaded":true},
                       {"kind":"translate","id":"org/mt-small","label":"Qwen small","downloaded":true},{"kind":"translate","id":"org/mt-big","label":"Qwen big","downloaded":false}]}"#;
        st.models.apply(Ok(parse(body).unwrap()), 1.0);
        assert_eq!(pick(&st, Kind::Asr), Some(("org/speech-base · not downloaded".into(), Ctl::Stepper("Base".into()))));
        assert_eq!(button(&st, Kind::Asr), Some(Ctl::Button("Download")));
        assert_eq!(button(&st, Kind::Translate), None, "a model on disk has nothing to download");
        st.cmds.clear();
        apply(&mut st, Key::ModelPull(Kind::Asr), Act::Press);
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelPull(Kind::Asr))));
        // Stepping to a model on disk switches at once; to one that is not, it waits for Download.
        st.cmds.clear();
        apply(&mut st, Key::ModelPick(Kind::Asr), Act::Step(1));
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelSelect(Kind::Asr, id) if id == "org/speech-small")));
        st.cmds.clear();
        apply(&mut st, Key::ModelPick(Kind::Translate), Act::Step(1));
        assert!(st.cmds.is_empty());
        assert_eq!(button(&st, Kind::Translate), Some(Ctl::Button("Download")));
        assert_eq!(pick(&st, Kind::Translate).map(|r| r.1), Some(Ctl::Stepper("Qwen big".into())));
        // Off needs no files.
        apply(&mut st, Key::ModelPick(Kind::Translate), Act::Step(1));
        assert!(st.cmds.iter().any(|c| matches!(c, Command::ModelSelect(Kind::Translate, id) if id == OFF)));
        // While it downloads the button is gone.
        st.models.pulling = Some(Kind::Asr);
        assert_eq!(button(&st, Kind::Asr), None);
    }

    #[test]
    fn a_model_row_offers_its_folder_and_locks_while_a_job_runs() {
        use poni_core::models::{parse, Kind};
        let mut st = state();
        let find = |st: &AppState, key| row(Section::Models, st, key).map(|i| (i.sub.unwrap_or_default(), i.ctl));
        let body = |extra: &str| {
            format!(r#"{{"models":[{{"key":"asr","id":"org/speech-base","downloaded":true,"dir":"D:\\m","dirIsDefault":false,"dirAvailable":true,"freeBytes":5000000000{extra}}},{{"key":"translate","id":null}}],"catalog":[]}}"#)
        };
        // An engine without folders shows no row.
        st.models.apply(Ok(parse(r#"{"models":[{"key":"asr","id":"org/speech-base","downloaded":true}]}"#).unwrap()), 1.0);
        assert_eq!(find(&st, Key::ModelFolder(Kind::Asr)), None);
        st.models.apply(Ok(parse(&body("")).unwrap()), 2.0);
        assert_eq!(find(&st, Key::ModelFolder(Kind::Asr)), Some(("Your folder · 5.0 GB free · D:\\m".into(), Ctl::Button("Choose…"))));
        assert!(find(&st, Key::ModelFolderReset(Kind::Asr)).is_some());
        st.cmds.clear();
        apply(&mut st, Key::ModelFolder(Kind::Asr), Act::Press);
        apply(&mut st, Key::ModelFolderReset(Kind::Asr), Act::Press);
        assert!(matches!(st.cmds[..], [Command::ModelFolder(Kind::Asr), Command::ModelFolderReset(Kind::Asr)]));
        // A move under way: progress in the line, no buttons.
        st.models.apply(Ok(parse(&body(r#","moving":true,"movePct":10,"movePhase":"copying""#)).unwrap()), 3.0);
        let (line, ctl) = find(&st, Key::ModelFolder(Kind::Asr)).unwrap();
        assert!(line.contains("copying 10%") && ctl == Ctl::None);
        assert_eq!(find(&st, Key::ModelFolderReset(Kind::Asr)), None);
    }

    #[test]
    fn delays_show_the_nearest_choice() {
        let mut st = state();
        let pick = |st: &AppState, k| match row(Section::Island, st, k).map(|i| i.ctl) {
            Some(Ctl::Choice(_, sel)) => sel,
            _ => None,
        };
        assert_eq!((pick(&st, Key::HoverDelay), pick(&st, Key::CloseDelay)), (Some(0), Some(0)));
        st.settings.hover_delay_ms = 2900;
        assert_eq!(pick(&st, Key::HoverDelay), Some(2));
        st.settings.hover_delay_ms = poni_core::settings::HOVER_OFF_MS;
        assert_eq!(pick(&st, Key::HoverDelay), Some(3));
        apply(&mut st, Key::HoverDelay, Act::Pick(0));
        assert_eq!(st.settings.hover_delay_ms, 220);
        apply(&mut st, Key::TranslationColor, Act::Pick(2));
        assert_eq!(st.settings.translation_color, TranslationColor::Teal);
        // A pick past the list changes nothing.
        st.cmds.clear();
        apply(&mut st, Key::CloseDelay, Act::Pick(9));
        assert!(st.cmds.is_empty());
    }

    #[test]
    fn tabs_flip_and_the_start_page_cycles_through_the_tabs() {
        let mut st = state();
        apply(&mut st, Key::Tab(PageKind::Shelf), Act::Toggle);
        assert!(st.tab_hidden(PageKind::Shelf));
        apply(&mut st, Key::Tab(PageKind::Shelf), Act::Toggle);
        assert!(!st.tab_hidden(PageKind::Shelf));
        // Opens on shows only while the island doesn't open where it was left.
        assert!(row(Section::Tabs, &st, Key::StartPage).is_none());
        apply(&mut st, Key::RememberPage, Act::Toggle);
        assert!(row(Section::Tabs, &st, Key::StartPage).is_some());
        let pages = start_pages(&st);
        st.settings.start_page = pages[0].key().to_string();
        apply(&mut st, Key::StartPage, Act::Step(1));
        assert_eq!(st.settings.start_page, pages[1].key());
        apply(&mut st, Key::StartPage, Act::Step(-1));
        apply(&mut st, Key::StartPage, Act::Step(-1));
        assert_eq!(st.settings.start_page, pages[pages.len() - 1].key());
        assert!(!pages.contains(&PageKind::Addons) && !pages.contains(&PageKind::Settings));
    }

    #[test]
    fn notifications_switches_off_under_tabs_only_where_the_copy_can_read_them() {
        let mut st = state();
        let listed = |st: &AppState| row(Section::Tabs, st, Key::Tab(PageKind::Notifications)).is_some();
        assert!(!listed(&st), "the download has no Notifications");
        st.notify_can = true;
        assert!(listed(&st) && st.notifications_on(), "on from the start in the Store copy");
        apply(&mut st, Key::Tab(PageKind::Notifications), Act::Toggle);
        assert!(!st.notifications_on() && st.cmds.iter().any(|c| matches!(c, Command::SaveSettings)));
        apply(&mut st, Key::Tab(PageKind::Notifications), Act::Toggle);
        assert!(st.notifications_on());
    }

    #[test]
    fn prayer_has_a_section_only_while_its_add_on_is_on() {
        let st = state();
        assert!(!sections(&st).contains(&Section::Prayer));
        assert_eq!(sections(&st).first(), Some(&Section::General));
        assert_eq!(sections(&st).last(), Some(&Section::About));
    }

    #[test]
    fn idle_looks_follow_the_theme() {
        let mut st = state();
        st.settings.theme = Theme::Classic;
        let looks = |st: &AppState| match row(Section::Appearance, st, Key::IdleLook).map(|i| i.ctl) {
            Some(Ctl::Choice(names, _)) => names,
            _ => Vec::new(),
        };
        assert!(!looks(&st).contains(&"Status"));
        st.settings.theme = Theme::Pill;
        assert!(looks(&st).contains(&"Status"));
    }

    #[test]
    fn motion_glides_without_overshoot_and_stops() {
        let mut m = Motion::default();
        // Asked for the first time, a value starts where it's going: the
        // window opens complete.
        m.begin(1.0, false);
        assert_eq!(m.slide(7, 100.0, SLIDE), 100.0);
        assert!(!m.moving);
        // Sent elsewhere, it moves a little every frame at 144 Hz, never
        // past where it's going, and stops there.
        let (mut t, mut last, mut frames) = (1.0, 100.0f32, 0);
        loop {
            t += 1.0 / 144.0;
            m.begin(t, false);
            let x = m.slide(7, 0.0, SLIDE);
            assert!(x <= last + 1e-4 && x >= 0.0, "frame {frames}: {x} after {last}");
            last = x;
            frames += 1;
            if !m.moving {
                break;
            }
            assert!(frames < 144, "still moving after a second");
        }
        assert_eq!(last, 0.0);
        // About a third of a second, then no more frames.
        assert!((30..60).contains(&frames), "{frames} frames");
        m.begin(t + 1.0 / 144.0, false);
        assert_eq!(m.slide(7, 0.0, SLIDE), 0.0);
        assert!(!m.moving);
        // A switch's knob arrives sooner; a hover wash sooner still.
        let count = |pace: f32| {
            let mut m = Motion::default();
            m.begin(1.0, false);
            m.fade(1, 0.0, pace);
            let (mut t, mut n) = (1.0, 0);
            loop {
                t += 1.0 / 144.0;
                m.begin(t, false);
                m.fade(1, 1.0, pace);
                n += 1;
                if !m.moving || n > 300 {
                    return n;
                }
            }
        };
        assert!(count(WASH) < count(SWITCHING) && count(SWITCHING) <= 48, "wash {} switch {}", count(WASH), count(SWITCHING));
        // Less motion (or a picture): everything lands at once.
        m.begin(t + 1.0, true);
        assert_eq!(m.slide(7, 50.0, SLIDE), 50.0);
        assert!(!m.moving);
        // Out of rest, the first step is about one refresh, however long the
        // window was still: no jump as it starts.
        let mut m = Motion::default();
        m.begin(1.0, false);
        m.slide(9, 0.0, SLIDE);
        m.begin(10.0, false);
        let first = m.slide(9, 100.0, SLIDE);
        assert!(first > 0.0 && first < 3.0, "first step {first}");
        // A long pause on the way doesn't jump either: a step is at most a 30th of a second.
        m.begin(20.0, false);
        let next = m.slide(9, 100.0, SLIDE);
        assert!(next < 40.0, "{first} then {next}");
        // Another section opens: the switch in a row's place starts as it is
        // (no slide from the last section's), while the sidebar's highlight
        // glides on.
        let mut m = Motion::default();
        m.begin(1.0, false);
        m.slide(1, 0.0, SLIDE);
        m.content = true;
        m.fade(2, 1.0, SWITCHING);
        m.begin(1.0 + 1.0 / 144.0, false);
        m.leave_section();
        let highlight = m.slide(1, 100.0, SLIDE);
        m.content = true;
        assert_eq!(m.fade(2, 0.0, SWITCHING), 0.0);
        assert!(highlight > 0.0 && highlight < 100.0 && m.moving, "{highlight}");
    }

    #[test]
    fn lyrics_timing_reads_as_earlier_or_later() {
        assert_eq!(offset_text(0), "On time");
        assert_eq!(offset_text(300), "−0.3 s");
        assert_eq!(offset_text(-1200), "+1.2 s");
    }

    #[cfg(windows)]
    #[test]
    fn windows_language_rows_follow_where_the_feature_stands() {
        use poni_core::winlang::{State, JAPANESE_TYPING};
        let mut st = state();
        let label = |st: &AppState| match row(Section::Music, st, Key::WinLang(0)).map(|r| r.ctl) {
            Some(Ctl::Button(l)) => l,
            other => panic!("{other:?}"),
        };
        assert_eq!(label(&st), "Check");
        // Missing: Install asks the app to add exactly this feature.
        st.set_winlang(JAPANESE_TYPING.id, State::Missing);
        assert_eq!(label(&st), "Install");
        apply(&mut st, Key::WinLang(0), Act::Press);
        assert_eq!(st.cmds.pop(), Some(Command::WinLang(WinLangCmd::Install("ja-typing"))));
        // Installed: the button checks again; installing: a press adds nothing.
        st.set_winlang(JAPANESE_TYPING.id, State::Installed);
        assert!(row(Section::Music, &st, Key::WinLang(0)).unwrap().sub.unwrap().starts_with("Installed"));
        apply(&mut st, Key::WinLang(0), Act::Press);
        assert_eq!(st.cmds.pop(), Some(Command::WinLang(WinLangCmd::Check)));
        st.set_winlang(JAPANESE_TYPING.id, State::Installing);
        apply(&mut st, Key::WinLang(0), Act::Press);
        assert!(st.cmds.is_empty());
        // A failure says why and offers another try.
        st.set_winlang(JAPANESE_TYPING.id, State::Failed("Windows couldn't add it".into()));
        assert_eq!(label(&st), "Try again");
        assert_eq!(row(Section::Music, &st, Key::WinLang(0)).unwrap().sub.as_deref(), Some("Windows couldn't add it"));
        // The way round is always there.
        apply(&mut st, Key::WinLangSettings, Act::Press);
        assert_eq!(st.cmds.pop(), Some(Command::WinLang(WinLangCmd::OpenSettings)));
    }
}
