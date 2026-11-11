//! User settings, stored as JSON next to the data store.

use crate::pomodoro::PomodoroConfig;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdleStyle {
    /// Small pill with a clock and battery ring.
    Clock,
    /// Small blank pill (like a MacBook notch).
    Minimal,
    /// A friendly pair of blinking eyes.
    Eyes,
    /// Nothing visible until the cursor reaches the top edge.
    Hidden,
    /// A wider pill like a status bar: the date and time, the volume and
    /// the battery (the Pill theme; the other themes show the clock).
    Status,
}

/// How the island looks. Pages and live activities work the same in every theme.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    /// The plain black island.
    Classic,
    /// Liquid glass: the island bends, frosts and tints what's under it.
    Glass,
    /// Pill: the island floats a little below the top edge as a black
    /// capsule, with its own layouts: the time and battery at rest, the song
    /// while music plays, a rounded card when it opens.
    Pill,
    /// Paper: the Pill in the SubMeetly paper look (white, navy ink). The
    /// default.
    #[default]
    Paper,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MonitorChoice {
    Primary,
    /// The monitor under the cursor when Poni starts.
    Cursor,
}

/// `hover_delay_ms` value for "Off": the island opens on click only.
pub const HOVER_OFF_MS: u32 = 600_000;
/// Longest dwell the settings offer besides Off.
pub const HOVER_MAX_MS: u32 = 3000;

/// The colour of the translated line on the Live page (board I08). Five
/// swatches that read on the paper ground; Indigo is the default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranslationColor {
    #[default]
    Indigo,
    Navy,
    Teal,
    Neutral,
    Bronze,
}

impl TranslationColor {
    pub const ALL: [TranslationColor; 5] = [Self::Indigo, Self::Navy, Self::Teal, Self::Neutral, Self::Bronze];

    pub fn name(self) -> &'static str {
        match self {
            Self::Indigo => "Indigo",
            Self::Navy => "Navy",
            Self::Teal => "Teal",
            Self::Neutral => "Neutral",
            Self::Bronze => "Bronze",
        }
    }

    /// 0xRRGGBB.
    pub fn rgb(self) -> u32 {
        match self {
            Self::Indigo => 0x4A3C94,
            Self::Navy => 0x2F3D80,
            Self::Teal => 0x0B6E83,
            Self::Neutral => 0x4F5675,
            Self::Bronze => 0x7A5200,
        }
    }
}

/// Bumped when defaults change in a way existing files should pick up.
pub const SETTINGS_VERSION: u32 = 6;

fn version_zero() -> u32 {
    0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Missing in files written before versioning (treated as 0).
    #[serde(default = "version_zero")]
    pub settings_version: u32,
    pub theme: Theme,
    pub idle_style: IdleStyle,
    pub use_24h: bool,
    /// Delay before hover expands the island; `HOVER_OFF_MS` = never.
    pub hover_delay_ms: u32,
    /// Colour of the translated line on the Live page.
    pub translation_color: TranslationColor,
    /// Grace period after the cursor leaves before collapsing (0 = the
    /// island starts closing on the next frame).
    pub collapse_delay_ms: u32,
    /// Width of the expanded island in DIPs (bigger = roomier pages).
    pub expanded_width: f32,
    pub hide_in_fullscreen: bool,
    /// Step aside over maximized windows: the resting island turned into the
    /// Hidden look's invisible strip while an app window reached the top of
    /// the screen under it. 0.2.4 and 0.2.5 did it by default and it read as
    /// the island vanishing, so it's gone from the menu and Settings and
    /// always off (`sanitized`); the Hidden idle look is the way to keep the
    /// top edge clear. The key stays so files from those versions still load.
    pub step_aside: bool,
    pub monitor: MonitorChoice,
    /// Where the island sits along the top edge once dragged there: its
    /// centre as a share of the monitor's width (0 the left edge, 1 the
    /// right), kept on screen ([`crate::spot`]). None: the middle.
    pub island_x: Option<f32>,
    pub show_media_activity: bool,
    pub lyrics: bool,
    /// Romanized "pronunciation" line under Japanese, Korean and Chinese lyrics.
    pub lyrics_pronunciation: bool,
    /// Shift synced lyrics: positive shows each line earlier (ms).
    pub lyrics_offset_ms: i32,
    /// Translate synced lyrics into `target_lang` under the sung line.
    pub lyrics_translate: bool,
    /// Language the PC's speech is in for live captions: `auto` or an engine code (`capture::LANGS`).
    pub source_lang: String,
    /// Language captions and lyrics are translated into.
    pub target_lang: String,
    /// Live captions were on when the island last ran.
    pub captions_on: bool,
    /// What those captions listened to (`capture::Source::key`): the next start reopens the same
    /// source. `pc` for an old file, which only knew what the PC plays.
    pub captions_source: String,
    /// Where model downloads come from: `huggingface` or `modelscope` (the engine's `source`).
    pub model_source: String,
    /// Captions start by themselves while a video plays or a calendar meeting runs, and stop after
    /// it ends ([`crate::capture::Auto`]).
    pub auto_captions: bool,
    /// Tell me when a meeting starts (the Mac: a meeting app on the microphone, or a calendar
    /// meeting, held a few seconds; [`crate::meeting_detect`]). It only tells: nothing is recorded.
    pub detect_meetings: bool,
    /// Name who said a caption line ("You", "Others", "Speaker 2") when the engine labelled it.
    pub show_speakers: bool,
    /// Captions carry a translation into `target_lang` (on by default, English); off: the spoken line only.
    pub translate_captions: bool,
    /// "Recent lines" on the Live page: how many earlier lines stay as cards above the caption
    /// (0 = off; [`crate::history_cards`]).
    pub log_cards: u8,
    /// What Live captions listen to (`capture::Source::key`): `room` (default), `pc` or `both`.
    pub live_source: String,
    /// The microphone for Room and Both: a Windows endpoint id, empty for Windows' default.
    pub mic_device: String,
    /// Meeting apps and hosts the person added (Settings › Meeting apps).
    pub meeting_apps: Vec<crate::meeting_source::MeetingApp>,
    /// One switch per built-in meeting family; one switched off counts as media.
    pub meeting_families: crate::meeting_source::MeetingFamilies,
    /// Open the Meeting tab when a meeting starts; off: captions start on Live.
    pub open_meeting_tab: bool,
    /// The pill's quick caption strip ("Aa") is shown.
    pub quick_captions_open: bool,
    /// Captions tab › Latency (`utterance::Latency::key`): `fast`, `balanced` (default) or `accurate`.
    pub latency_mode: String,
    /// Captions tab › Show (`capture::Show::key`): `both` (default), `original` or `translation`.
    pub caption_show: String,
    /// Captions tab › Font size, before 1.3.9: a step in px. Read once into `caption_px` (`capture::resolve_px`).
    pub caption_font: i32,
    /// Captions tab › Font size: the main caption line in px (`capture::resolve_px`). 0 = a file from
    /// before 1.3.9, which still has `caption_font`.
    #[serde(default = "px_unset")]
    pub caption_px: u32,
    /// Where Windows Live Captions was before Fast moved it off screen, "x,y"; empty when it is not
    /// moved. Written BEFORE the move so a crash cannot lose it (`livecap::restore`).
    pub livecap_origin: String,
    /// Captions tab › Display › Latency readout: "[ 820 ms ]" after each line (off by default).
    pub caption_readout: bool,
    pub hud_volume: bool,
    pub hud_power: bool,
    pub hud_bluetooth: bool,
    pub sounds: bool,
    /// Page shown first when expanding ("media", "shelf", "tasks", "focus").
    pub start_page: String,
    /// Remember the last page instead of `start_page`.
    pub remember_page: bool,
    /// Tabs taken off the header's row in Settings, by page key: Music,
    /// Today, Shelf, Tasks and Focus can go, and Notifications, which is off
    /// while its key is here. Keys this version doesn't know are kept, so a
    /// newer Studio's choices survive a save.
    pub hidden_tabs: Vec<String>,
    /// The optional Captions tab (PMM-022) is in the row. Off by default, and a switch of its own
    /// rather than a `hidden_tabs` key: that list says what to hide, and a tab that starts hidden
    /// must not appear in files written before it existed.
    pub captions_tab: bool,
    pub pomodoro: PomodoroConfig,
    /// Keep the System page's charts going while it's closed (a light reading
    /// of the kernel counters once a second), so they're full when it opens.
    /// Only while the System add-on is on ([`Settings::system_history_on`]).
    pub system_history: bool,
    /// Add-ons switched on, by id (`poni_core::addons`). Ids this version
    /// doesn't know are kept, so a newer Poni's choices survive a save.
    pub addons: BTreeMap<String, bool>,
    /// The Prayer times add-on's choices.
    pub prayer: PrayerSettings,
    /// Show over games: while a full-screen app is in front, the island
    /// shows its frame rate, the GPU's load and temperature and the CPU's
    /// load. Turning it on also keeps the island on top of full-screen apps.
    pub game_stats: bool,
    /// Show over games, readout only for a few seconds (when the game comes
    /// to the front, when the frame rate drops sharply, on Alt+Shift+F),
    /// then the island hides and Windows sends the game's frames straight to
    /// the screen. Off (the default), the readout stays while the game is in
    /// front. Its own name: the corner test build wrote `game_readout`
    /// ("peek" as its default) into the files of the people who tried it.
    pub game_peek: bool,
    /// Notifications' choices: which apps the island shows, and
    /// whether who it's from and the message show at once.
    pub notifications: crate::notifications::NotificationSettings,
}

/// What plays when a prayer's time comes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrayerSound {
    /// The adzan recording (Subuh plays the tone: the recording isn't Subuh's adzan).
    Adzan,
    /// A short system tone.
    #[default]
    Tone,
    Silent,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PrayerSettings {
    /// The place the times are for: its id in the add-on's place list, or
    /// "w:lat,lng" for a city abroad. None until one is found or picked.
    pub place: Option<String>,
    /// That city abroad as its own few lines (`prayer::World::excerpt`): its
    /// name, country, point and clock, so its times need nothing online.
    pub world_place: Option<String>,
    /// Let Windows' location pick the nearest place, and pick again when the
    /// PC moves. Picking a place by hand turns this off.
    pub follow_location: bool,
    pub sound: PrayerSound,
    /// Minutes before each prayer the island counts down (0 = no countdown).
    pub remind_before_min: u32,
    /// Pause music that is playing when the adzan starts (it stays paused).
    pub pause_music: bool,
}

impl Default for PrayerSettings {
    fn default() -> Self {
        Self { place: None, world_place: None, follow_location: true, sound: PrayerSound::Tone, remind_before_min: 10, pause_music: true }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: SETTINGS_VERSION,
            theme: Theme::Paper,
            idle_style: IdleStyle::Clock,
            use_24h: true,
            hover_delay_ms: 220,
            translation_color: TranslationColor::Indigo,
            collapse_delay_ms: 0,
            expanded_width: 620.0,
            hide_in_fullscreen: true,
            step_aside: false,
            monitor: MonitorChoice::Primary,
            island_x: None,
            show_media_activity: true,
            lyrics: true,
            lyrics_pronunciation: true,
            lyrics_offset_ms: 0,
            lyrics_translate: true,
            source_lang: "auto".into(),
            target_lang: "en".into(),
            captions_on: false,
            captions_source: "pc".into(),
            model_source: "huggingface".into(),
            auto_captions: true,
            detect_meetings: true,
            show_speakers: true,
            translate_captions: true,
            log_cards: crate::history_cards::DEFAULT_CARDS,
            live_source: "room".into(),
            mic_device: String::new(),
            meeting_apps: Vec::new(),
            meeting_families: Default::default(),
            open_meeting_tab: true,
            quick_captions_open: false,
            latency_mode: "balanced".into(),
            caption_show: "both".into(),
            caption_font: 0,
            caption_px: crate::capture::FONT_DEFAULT,
            livecap_origin: String::new(),
            caption_readout: false,
            hud_volume: true,
            hud_power: true,
            hud_bluetooth: true,
            sounds: true,
            start_page: "media".into(),
            remember_page: true,
            hidden_tabs: Vec::new(),
            captions_tab: false,
            pomodoro: PomodoroConfig::default(),
            system_history: true,
            addons: BTreeMap::new(),
            prayer: PrayerSettings::default(),
            game_stats: false,
            game_peek: false,
            notifications: crate::notifications::NotificationSettings::default(),
        }
    }
}

fn px_unset() -> u32 {
    0
}

impl Settings {
    /// Settings › Tabs flipped the tab with this page key: Captions through its own switch, the
    /// others in or out of `hidden_tabs`.
    pub fn toggle_tab(&mut self, key: &str) {
        if key == "captions" {
            self.captions_tab = !self.captions_tab;
        } else if let Some(i) = self.hidden_tabs.iter().position(|k| k == key) {
            self.hidden_tabs.remove(i);
        } else {
            self.hidden_tabs.push(key.to_string());
        }
    }

    /// Show over games needs the island on top of full-screen apps, so the
    /// two follow each other: turning the readout on picks Stay on top, and
    /// picking Hide afterwards turns the readout off. `before` is the state
    /// the change started from.
    pub fn pair_game_stats(&mut self, before: &Settings) {
        if !(self.game_stats && self.hide_in_fullscreen) {
            return;
        }
        if before.game_stats && !before.hide_in_fullscreen {
            self.game_stats = false;
        } else {
            self.hide_in_fullscreen = false;
        }
    }

    /// Is the add-on `id` switched on?
    pub fn addon_on(&self, id: &str) -> bool {
        self.addons.get(id).copied().unwrap_or_else(|| crate::addons::on_by_default(id))
    }

    pub fn set_addon(&mut self, id: &str, on: bool) {
        self.addons.insert(id.to_string(), on);
    }

    /// The System add-on is on: the System tab shows.
    pub fn system_on(&self) -> bool {
        self.addon_on(crate::addons::SYSTEM.id)
    }

    /// The System page's readings go on while it's closed: its history
    /// switch, and only while System itself is on.
    pub fn system_history_on(&self) -> bool {
        self.system_on() && self.system_history
    }

    /// The settings of an install with no settings file yet: the meeting tabs
    /// (Live, Meeting, Inbox and the add-ons' tools) show, the others (Music,
    /// Shelf, Tasks, Focus) are tucked away behind Settings > Tabs, one chip
    /// each, and the island opens on Live. Existing files are never touched
    /// (`Default` keeps every tab shown), so no one loses a tab they use.
    pub fn fresh_install(mut self) -> Self {
        self.hidden_tabs = ["media", "shelf", "tasks", "focus"].map(String::from).to_vec();
        self.start_page = "live".into();
        self
    }

    /// Has the person never switched the add-on `id` on or off? An add-on
    /// that switches itself on when first needed (Japanese readings) does so
    /// only then: one switched off by hand stays off.
    pub fn addon_unset(&self, id: &str) -> bool {
        !self.addons.contains_key(id)
    }

    /// Clamp values a user may have hand-edited into nonsense.
    pub fn sanitized(mut self) -> Self {
        // Only untouched old defaults move.
        // v2: hover opens after a 220 ms dwell (140 ms caught pointers on
        // their way to browser tabs).
        if self.settings_version < 2 && self.hover_delay_ms == 140 {
            self.hover_delay_ms = 220;
        }
        // v3: the island closes as soon as the pointer leaves it (the old
        // 380 ms grace read as lag; coming back while it closes reopens it).
        if self.settings_version < 3 && self.collapse_delay_ms == 380 {
            self.collapse_delay_ms = 0;
        }
        // v4: Clipboard history became an add-on, off by default (it left the
        // app after 0.2.8, and its old `clipboard_history` key is dropped on
        // the next save). A Clipboard start page opens Music.
        if self.settings_version < 4 && self.start_page == "clipboard" {
            self.start_page = "media".into();
        }
        // v5: Notifications left the add-ons (it's on wherever Windows lets the
        // copy read notifications, and its chip in Settings' tabs row switches
        // it off). One switched off by hand as an add-on stays off, as a hidden
        // tab. Its old key stays in the file, unread, as keys this version
        // doesn't know do.
        if self.settings_version < 5 && self.addons.get("notifications") == Some(&false) && !self.hidden_tabs.iter().any(|k| k == "notifications") {
            self.hidden_tabs.push("notifications".into());
        }
        // v6: Paper became the default theme; the old default, Pill, moves.
        if self.settings_version < 6 && self.theme == Theme::Pill {
            self.theme = Theme::Paper;
        }
        self.settings_version = self.settings_version.max(SETTINGS_VERSION);
        // Step aside is no longer offered: the island stays over maximized windows.
        self.step_aside = false;
        // Show over games needs the island on top of full-screen apps.
        if self.game_stats {
            self.hide_in_fullscreen = false;
        }
        if self.hover_delay_ms != HOVER_OFF_MS {
            self.hover_delay_ms = self.hover_delay_ms.min(HOVER_MAX_MS);
        }
        self.lyrics_offset_ms = self.lyrics_offset_ms.clamp(-5000, 5000);
        self.collapse_delay_ms = self.collapse_delay_ms.min(5000);
        self.log_cards = crate::history_cards::clamp_count(self.log_cards);
        if !self.expanded_width.is_finite() {
            self.expanded_width = 620.0;
        }
        self.expanded_width = self.expanded_width.clamp(480.0, 900.0);
        self.island_x = self.island_x.filter(|x| x.is_finite()).map(|x| x.clamp(0.0, 1.0));
        let p = &mut self.pomodoro;
        p.focus_min = p.focus_min.clamp(1, 180);
        p.short_break_min = p.short_break_min.clamp(1, 60);
        p.long_break_min = p.long_break_min.clamp(1, 120);
        p.long_every = p.long_every.min(12);
        self.prayer.remind_before_min = self.prayer.remind_before_min.min(60);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_captions_tab_is_off_until_switched_on_and_flips_like_the_others() {
        let old: Settings = serde_json::from_str(r#"{"hidden_tabs":["shelf"]}"#).unwrap();
        assert!(!old.captions_tab, "an existing install does not get a new tab by itself");
        let mut s = Settings::default();
        s.toggle_tab("captions");
        assert!(s.captions_tab && s.hidden_tabs.is_empty(), "Captions has its own switch, not the hidden list");
        s.toggle_tab("captions");
        assert!(!s.captions_tab);
        s.toggle_tab("shelf");
        assert_eq!(s.hidden_tabs, ["shelf"]);
        s.toggle_tab("shelf");
        assert!(s.hidden_tabs.is_empty());
    }

    #[test]
    fn an_old_file_gets_the_meeting_defaults() {
        let s: Settings = serde_json::from_str(r#"{"auto_captions":false}"#).unwrap();
        assert!(s.meeting_apps.is_empty() && s.open_meeting_tab && s.meeting_families.slack && s.meeting_families.teams);
        assert!(!s.quick_captions_open, "the pill's caption strip starts hidden");
        assert_eq!(crate::utterance::Latency::parse(&s.latency_mode), crate::utterance::Latency::Balanced, "an old file captions as before");
        assert_eq!((crate::capture::Show::parse(&s.caption_show), crate::capture::resolve_px(s.caption_px, s.caption_font)), (crate::capture::Show::Both, 15), "and looks as before");
        let s: Settings = serde_json::from_str(r#"{"caption_font":3}"#).unwrap();
        assert_eq!(crate::capture::resolve_px(s.caption_px, s.caption_font), 18, "an old step becomes px");
        assert!(s.livecap_origin.is_empty());
        assert_eq!((s.live_source.as_str(), s.mic_device.as_str()), ("room", ""), "Live starts on the room, Windows' default mic");
        assert_eq!(s.captions_source, "pc", "captions on from an old file restart on what the PC plays");
        let s: Settings = serde_json::from_str(r#"{"captions_on":true,"captions_source":"both"}"#).unwrap();
        assert_eq!(crate::capture::Source::parse(&s.captions_source), crate::capture::Source::Both, "a restart reopens the source that ran");
        let s: Settings = serde_json::from_str(r#"{"meeting_families":{"slack":false},"meeting_apps":[{"kind":"host","value":"meeting.tencent.com","label":"Tencent Meeting"}]}"#).unwrap();
        assert!(!s.meeting_families.slack && s.meeting_families.zoom);
        assert_eq!(s.meeting_apps[0].value, "meeting.tencent.com");
    }

    #[test]
    fn partial_json_fills_defaults() {
        // An old file's "water" block (the page Health replaced) is ignored.
        let s: Settings = serde_json::from_str(r#"{"idle_style":"eyes","water":{"goal_ml":1500}}"#).unwrap();
        assert_eq!(s.idle_style, IdleStyle::Eyes);
        assert_eq!(s.pomodoro.focus_min, 25);
    }

    #[test]
    fn addons_are_off_until_switched_on_and_unknown_ones_survive() {
        let mut s = Settings::default();
        assert!(!s.addon_on("sholat"));
        s.set_addon("sholat", true);
        assert!(s.addon_on("sholat"));
        // A newer Poni's add-on stays in the file when this one saves it.
        let s: Settings = serde_json::from_str(r#"{"addons":{"sholat":true,"future":true}}"#).unwrap();
        assert!(s.addon_on("sholat"));
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(back.addon_on("future"));
        // Files from before add-ons have none on.
        let old: Settings = serde_json::from_str(r#"{"settings_version":3}"#).unwrap();
        assert!(old.addons.is_empty());
    }

    #[test]
    fn an_addon_switched_off_by_hand_is_no_longer_unset() {
        let mut s = Settings::default();
        assert!(s.addon_unset("ja"));
        s.set_addon("ja", true);
        assert!(!s.addon_unset("ja"));
        s.set_addon("ja", false);
        assert!(!s.addon_unset("ja"), "off by hand: the person's word, kept");
        assert!(!s.addon_on("ja"));
        // It survives a save and a load.
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(!back.addon_unset("ja"));
    }

    #[test]
    fn prayer_defaults_follow_location_with_a_tone_ten_minutes_before() {
        let p = Settings::default().prayer;
        assert_eq!((p.place, p.follow_location, p.sound, p.remind_before_min, p.pause_music), (None, true, PrayerSound::Tone, 10, true));
        let s: Settings = serde_json::from_str(r#"{"prayer":{"place":"jakarta","sound":"adzan","remind_before_min":600}}"#).unwrap();
        let s = s.sanitized();
        assert_eq!((s.prayer.place.as_deref(), s.prayer.sound, s.prayer.remind_before_min), (Some("jakarta"), PrayerSound::Adzan, 60));
        assert!(s.prayer.follow_location);
    }

    #[test]
    fn theme_defaults_to_paper() {
        // Files written before themes existed get the paper pill.
        let s: Settings = serde_json::from_str(r#"{"idle_style":"eyes"}"#).unwrap();
        assert_eq!(s.theme, Theme::Paper);
        let s: Settings = serde_json::from_str(r#"{"theme":"classic"}"#).unwrap();
        assert_eq!(s.theme, Theme::Classic);
        let s: Settings = serde_json::from_str(r#"{"theme":"glass"}"#).unwrap();
        assert_eq!(s.theme, Theme::Glass);
        let s: Settings = serde_json::from_str(r#"{"theme":"pill"}"#).unwrap();
        assert_eq!(s.theme, Theme::Pill);
        let s: Settings = serde_json::from_str(r#"{"theme":"paper"}"#).unwrap();
        assert_eq!(s.theme, Theme::Paper);
    }

    #[test]
    fn old_pill_default_moves_to_paper_once() {
        let old = serde_json::from_str::<Settings>(r#"{"settings_version":5,"theme":"pill"}"#).unwrap().sanitized();
        assert_eq!(old.theme, Theme::Paper);
        // A Pill chosen after v6 stays.
        let kept = serde_json::from_str::<Settings>(r#"{"settings_version":6,"theme":"pill"}"#).unwrap().sanitized();
        assert_eq!(kept.theme, Theme::Pill);
    }

    #[test]
    fn sanitize_clamps() {
        let s = Settings { expanded_width: 5000.0, hover_delay_ms: 99999, ..Default::default() }.sanitized();
        assert_eq!(s.expanded_width, 900.0);
        assert_eq!(s.hover_delay_ms, HOVER_MAX_MS);
        // Off survives; so does a pick inside the range.
        let off = Settings { hover_delay_ms: HOVER_OFF_MS, ..Default::default() }.sanitized();
        assert_eq!(off.hover_delay_ms, HOVER_OFF_MS);
    }

    #[test]
    fn translation_colour_swatches() {
        let hex: Vec<u32> = TranslationColor::ALL.iter().map(|c| c.rgb()).collect();
        assert_eq!(hex, [0x4A3C94, 0x2F3D80, 0x0B6E83, 0x4F5675, 0x7A5200]);
        assert_eq!(Settings::default().translation_color, TranslationColor::Indigo);
        let s: Settings = serde_json::from_str(r#"{"translation_color":"teal"}"#).unwrap();
        assert_eq!(s.translation_color, TranslationColor::Teal);
        // Older files have no key.
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.translation_color, TranslationColor::Indigo);
    }

    #[test]
    fn migrates_old_hover_default_once() {
        let s: Settings = serde_json::from_str(r#"{"hover_delay_ms":140}"#).unwrap();
        assert_eq!(s.settings_version, 0);
        let s = s.sanitized();
        assert_eq!((s.hover_delay_ms, s.settings_version), (220, SETTINGS_VERSION));
        // A user's own choice is kept, and a current file isn't touched.
        let s: Settings = serde_json::from_str(r#"{"hover_delay_ms":90}"#).unwrap();
        assert_eq!(s.sanitized().hover_delay_ms, 90);
        let s: Settings = serde_json::from_str(r#"{"settings_version":2,"hover_delay_ms":140}"#).unwrap();
        assert_eq!(s.sanitized().hover_delay_ms, 140);
    }

    #[test]
    fn files_with_clipboard_history_still_load_and_drop_it() {
        // Files from 0.2.8 and before hold the key: it's ignored, and gone after a save.
        let s = serde_json::from_str::<Settings>(r#"{"settings_version":4,"clipboard_history":true,"theme":"classic"}"#).unwrap().sanitized();
        assert_eq!(s.theme, Theme::Classic);
        assert!(!serde_json::to_string(&s).unwrap().contains("clipboard"));
        // A Clipboard start page from before 0.2.7 opens Music.
        let s = serde_json::from_str::<Settings>(r#"{"settings_version":3,"start_page":"clipboard"}"#).unwrap().sanitized();
        assert_eq!((s.start_page.as_str(), s.settings_version), ("media", SETTINGS_VERSION));
    }

    #[test]
    fn system_history_counts_only_while_system_is_on() {
        // Off by default, so nothing reads the counters at rest; its history
        // switch keeps its default for when it is switched on.
        let mut s = Settings::default();
        assert!(!s.system_on() && s.system_history && !s.system_history_on());
        s.set_addon(crate::addons::SYSTEM.id, true);
        assert!(s.system_on() && s.system_history_on());
        s.system_history = false;
        assert!(!s.system_history_on());
        // Files from before have no System switch: off.
        let old: Settings = serde_json::from_str(r#"{"settings_version":4,"system_history":true}"#).unwrap();
        assert!(!old.sanitized().system_on());
    }

    #[test]
    fn migrates_old_collapse_grace_once() {
        // Files from 0.1.7 and earlier hold the old 380 ms grace.
        let s = serde_json::from_str::<Settings>(r#"{"settings_version":2,"collapse_delay_ms":380}"#).unwrap().sanitized();
        assert_eq!((s.collapse_delay_ms, s.settings_version), (0, SETTINGS_VERSION));
        let s = serde_json::from_str::<Settings>(r#"{"collapse_delay_ms":380,"hover_delay_ms":140}"#).unwrap().sanitized();
        assert_eq!((s.collapse_delay_ms, s.hover_delay_ms), (0, 220));
        // A grace the user chose is kept, a current file isn't touched, and 0 stays 0.
        let s: Settings = serde_json::from_str(r#"{"settings_version":2,"collapse_delay_ms":600}"#).unwrap();
        assert_eq!(s.sanitized().collapse_delay_ms, 600);
        let s: Settings = serde_json::from_str(r#"{"settings_version":3,"collapse_delay_ms":380}"#).unwrap();
        assert_eq!(s.sanitized().collapse_delay_ms, 380);
        assert_eq!(Settings::default().sanitized().collapse_delay_ms, 0);
        // A file from a newer Poni keeps its version.
        let s: Settings = serde_json::from_str(r#"{"settings_version":9}"#).unwrap();
        assert_eq!(s.sanitized().settings_version, 9);
    }

    #[test]
    fn game_stats_and_full_screen_choice_follow_each_other() {
        // The default hides the island over full-screen apps; turning the
        // readout on keeps it on top instead.
        let before = Settings::default();
        let mut s = Settings { game_stats: true, ..before.clone() };
        s.pair_game_stats(&before);
        assert!(s.game_stats && !s.hide_in_fullscreen);
        // Picking Hide afterwards turns the readout off.
        let before = s.clone();
        let mut s = Settings { hide_in_fullscreen: true, ..before.clone() };
        s.pair_game_stats(&before);
        assert!(!s.game_stats && s.hide_in_fullscreen);
        // Stay on top alone, and the readout off, change nothing.
        let before = Settings { hide_in_fullscreen: false, ..Settings::default() };
        let mut s = before.clone();
        s.pair_game_stats(&before);
        assert_eq!(s, before);
        // A hand-edited file with both on keeps the readout, when changed
        // and when loaded.
        let mut s = Settings { game_stats: true, ..Settings::default() };
        s.pair_game_stats(&Settings::default());
        assert!(s.game_stats && !s.hide_in_fullscreen);
        let s: Settings = serde_json::from_str(r#"{"game_stats":true,"hide_in_fullscreen":true}"#).unwrap();
        let s = s.sanitized();
        assert!(s.game_stats && !s.hide_in_fullscreen);
    }

    #[test]
    fn the_readout_stays_unless_peeks_are_picked() {
        // Files from 0.2.0 and before, and from the corner test build (its
        // "peek" was its default, not a choice), get the readout that stays.
        for old in [r#"{"game_stats":true}"#, r#"{"game_stats":true,"game_readout":"peek"}"#, r#"{"game_readout":"corner"}"#] {
            let s: Settings = serde_json::from_str(old).unwrap();
            assert!(!s.game_peek, "{old}");
        }
        let s: Settings = serde_json::from_str(r#"{"game_stats":true,"game_peek":true}"#).unwrap();
        assert!(s.game_peek);
    }

    #[test]
    fn the_island_sits_in_the_middle_until_dragged() {
        assert_eq!(Settings::default().island_x, None);
        // Files from before the drag, and hand-edited ones, stay on screen.
        let old: Settings = serde_json::from_str(r#"{"settings_version":4}"#).unwrap();
        assert_eq!(old.sanitized().island_x, None);
        let far: Settings = serde_json::from_str(r#"{"island_x":3.5}"#).unwrap();
        assert_eq!(far.sanitized().island_x, Some(1.0));
        let moved: Settings = serde_json::from_str(r#"{"island_x":0.8}"#).unwrap();
        assert_eq!(moved.sanitized().island_x, Some(0.8));
    }

    #[test]
    fn the_island_never_steps_aside() {
        assert!(!Settings::default().step_aside);
        // 0.2.4 and 0.2.5 saved Step aside, their default: the island stays now.
        let old: Settings = serde_json::from_str(r#"{"settings_version":3,"step_aside":true}"#).unwrap();
        assert!(!old.sanitized().step_aside);
    }

    #[test]
    fn notifications_switched_off_as_an_add_on_stays_off() {
        // Until 0.2.24 Notifications was an add-on, off by default. One switched
        // off by hand stays off, as a hidden tab.
        let s = serde_json::from_str::<Settings>(r#"{"settings_version":4,"addons":{"notifications":false,"sholat":true}}"#).unwrap().sanitized();
        assert_eq!(s.hidden_tabs, ["notifications"]);
        assert!(s.addon_on("sholat"));
        // Switched on, or never touched: on, like everyone's now.
        for file in [r#"{"settings_version":4,"addons":{"notifications":true}}"#, r#"{"settings_version":4}"#] {
            let s = serde_json::from_str::<Settings>(file).unwrap().sanitized();
            assert!(s.hidden_tabs.is_empty(), "{file}");
        }
        // Once only: after that, the tabs row is its switch.
        let s = serde_json::from_str::<Settings>(r#"{"settings_version":5,"addons":{"notifications":false}}"#).unwrap().sanitized();
        assert!(s.hidden_tabs.is_empty());
    }


    #[test]
    fn a_fresh_install_keeps_the_meeting_tabs_and_tucks_the_rest_away() {
        // Only a settings file that does not exist yet gets this; every file
        // before keeps its tabs as it saved them (Default stays all-shown).
        let s = Settings::default().fresh_install();
        assert_eq!(s.hidden_tabs, ["media", "shelf", "tasks", "focus"]);
        assert_eq!(s.start_page, "live");
        assert!(Settings::default().hidden_tabs.is_empty() && Settings::default().start_page == "media");
        // Nothing is removed: the Settings > Tabs chips bring each one back.
        let s = s.sanitized();
        assert_eq!(s.hidden_tabs.len(), 4);
    }
    #[test]
    fn every_tab_shows_until_hidden() {
        assert!(Settings::default().hidden_tabs.is_empty());
        // Files from before, and a newer Studio's tab, which stays hidden
        // when this one saves the file.
        let old: Settings = serde_json::from_str(r#"{"settings_version":4}"#).unwrap();
        assert!(old.hidden_tabs.is_empty());
        let s: Settings = serde_json::from_str(r#"{"hidden_tabs":["today","future"]}"#).unwrap();
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.hidden_tabs, ["today", "future"]);
    }

    #[test]
    fn roundtrip() {
        let s = Settings::default();
        let j = serde_json::to_string_pretty(&s).unwrap();
        let back: Settings = serde_json::from_str(&j).unwrap();
        assert_eq!(s, back);
    }
}
